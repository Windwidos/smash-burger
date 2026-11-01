(function () {
  'use strict';
  const E = window.SmashEngine;
  const A = window.Art;
  const T = E.TYPES;
  const app = document.getElementById('app');
  const sheet = document.getElementById('sheet');
  const toastEl = document.getElementById('toast');
  const CONFIG = window.SMASH_CONFIG || {};
  const SERVER = CONFIG.server || '';
  const LS_SESSION = 'smashburger.session';
  const LS_NAME = 'smashburger.name';
  const LS_PROFILE = 'smashburger.profile';
  const LS_TUT = 'smashburger.tutstep';

  let session = null;
  try { session = JSON.parse(localStorage.getItem(LS_SESSION)); } catch { /* ignore */ }
  let profileKey = null; // { id, token } – identifies this device's player
  try { profileKey = JSON.parse(localStorage.getItem(LS_PROFILE)); } catch { /* ignore */ }
  let profile = null; // latest profile data from the server (name, xp, …)
  let profileLoading = !!profileKey;
  let mm = null; // quick-match search state
  let view = null;
  let es = null;
  let ui = freshUi();
  let sheetKind = null; // 'info' sheets survive state updates, 'ctx' sheets belong to the current move
  let lastLogN = 0;
  let wasMyTurn = false;

  function freshUi() {
    return { sel: null, mode: null, steal: null, dig: null };
  }

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Netzwerk ----------

  // The free server sleeps when idle; show a hint while the first request wakes it up.
  let serverAwake = false;
  let wakeHintTimer = null;
  function wakeServer() {
    wakeHintTimer = setTimeout(() => {
      if (!serverAwake) toast('Server wird geweckt … das kann bis zu einer Minute dauern.', 60000);
    }, 2500);
    fetch(SERVER + '/api/health').then(() => {
      serverAwake = true;
      clearTimeout(wakeHintTimer);
      if (!toastEl.classList.contains('hidden') && toastEl.textContent.startsWith('Server wird')) toastEl.classList.add('hidden');
    }).catch(() => setTimeout(wakeServer, 5000));
  }

  async function post(path, body) {
    const r = await fetch(SERVER + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let j = {};
    try { j = await r.json(); } catch { /* ignore */ }
    if (!r.ok || j.error) {
      const err = new Error(j.error || 'Verbindungsproblem');
      err.view = j.view;
      throw err;
    }
    return j;
  }

  // Views arrive both over the live connection and as action replies; never go back to an older one.
  function applyView(v) {
    if (!v) return;
    // The same version arrives twice (live event + action reply); redrawing it again would cut animations short.
    if (view && v.code === view.code && v.version <= view.version) return;
    view = v;
    onView();
  }

  function saveSession(s) {
    session = s;
    if (s) localStorage.setItem(LS_SESSION, JSON.stringify(s));
    else localStorage.removeItem(LS_SESSION);
  }

  function connect() {
    if (es) es.close();
    const q = new URLSearchParams(session).toString();
    es = new EventSource(SERVER + '/api/events?' + q);
    lastMsg = Date.now();
    es.onmessage = e => {
      lastMsg = Date.now();
      applyView(JSON.parse(e.data));
    };
    es.addEventListener('ping', () => { lastMsg = Date.now(); });
    es.addEventListener('gone', () => {
      es.close();
      es = null;
      saveSession(null);
      view = null;
      closeSheet();
      toast('Du sitzt nicht mehr an diesem Tisch.');
      render();
    });
  }

  function send(action) {
    ui = freshUi();
    if (sheetKind === 'ctx') closeSheet();
    render();
    return post('/api/action', { ...session, action })
      .then(j => applyView(j.view))
      .catch(e => {
        applyView(e.view);
        toast(e.message);
      });
  }

  // Phones silently drop live connections (screen off, network switch): reconnect when pings stop.
  let lastMsg = 0;
  setInterval(() => {
    if (session && es && Date.now() - lastMsg > 25000) connect();
  }, 5000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && session) connect();
  });
  window.addEventListener('online', () => { if (session) connect(); });

  // ---------- Profil & Level ----------

  const withProfile = body => ({ ...body, profileId: profileKey && profileKey.id, profileToken: profileKey && profileKey.token });

  function dropProfile() {
    profileKey = null;
    profile = null;
    localStorage.removeItem(LS_PROFILE);
  }

  async function loadProfile() {
    if (!profileKey) { profileLoading = false; return render(); }
    try {
      profile = (await post('/api/profile/get', withProfile({}))).profile;
    } catch (e) {
      if (/Profil/.test(e.message)) dropProfile();
      else setTimeout(loadProfile, 4000); // server still waking up
    }
    profileLoading = false;
    if (!session) render();
  }

  async function createProfile() {
    const name = (document.getElementById('name').value || '').trim();
    if (!name) return toast('Bitte gib deinen Namen ein.');
    try {
      const r = await post('/api/profile/create', { name });
      profileKey = { id: r.profile.id, token: r.token };
      localStorage.setItem(LS_PROFILE, JSON.stringify(profileKey));
      localStorage.setItem(LS_NAME, name);
      profile = r.profile;
      render();
    } catch (e) {
      toast(e.message);
    }
  }

  function levelBadge(level) {
    return `<span class="lv" title="Level ${level}">${level}</span>`;
  }

  function xpBar(info, cls) {
    return `<div class="xpbar ${cls || ''}"><i style="width:${Math.round(info.into / info.need * 100)}%"></i><span>${info.into} / ${info.need} XP</span></div>`;
  }

  // Server answered "profile missing": start over with a new profile.
  function handleMissing(e) {
    if (e && /neu an/.test(e.message)) {
      dropProfile();
      render();
      return true;
    }
    return false;
  }

  async function joinTable(path, body) {
    try {
      const r = await post(path, withProfile(body || {}));
      saveSession(r);
      closeSheet();
      history.replaceState(null, '', '?room=' + r.code);
      connect();
    } catch (e) {
      if (!handleMissing(e)) toast(e.message);
    }
  }

  // ---------- Schnelles Spiel (Matchmaking) ----------

  let mmTimer = null;
  async function startQuick() {
    try {
      mm = { status: await post('/api/quick/join', withProfile({})) };
      render();
      pollQuick();
    } catch (e) {
      if (!handleMissing(e)) toast(e.message);
    }
  }

  async function pollQuick() {
    clearTimeout(mmTimer);
    if (!mm) return;
    try {
      const st = await post('/api/quick/status', withProfile({}));
      if (!mm) return;
      if (st.state === 'matched') {
        mm = null;
        saveSession({ code: st.code, pid: st.pid, token: st.token });
        history.replaceState(null, '', '?room=' + st.code);
        connect();
        return;
      }
      if (st.state === 'none') return startQuick();
      mm.status = st;
      render();
    } catch { /* try again */ }
    mmTimer = setTimeout(pollQuick, 1500);
  }

  function cancelQuick() {
    clearTimeout(mmTimer);
    mm = null;
    post('/api/quick/leave', withProfile({})).catch(() => {});
    render();
  }

  function leaveTable() {
    const done = post('/api/action', { ...session, action: { type: 'leave' } }).catch(() => {});
    if (es) es.close();
    es = null;
    saveSession(null);
    view = null;
    tutStep = null;
    closeSheet();
    hideCoach();
    history.replaceState(null, '', '/');
    render();
    return done.then(loadProfile);
  }

  // ---------- Hilfsfunktionen ----------

  const game = () => view && view.game;
  const me = () => view.you;
  const myTurn = () => { const g = game(); return g && g.winner == null && g.current === me(); };
  const myHand = () => game().players[me()].hand || [];
  const recipesOf = g => g.recipes;

  function findCard(id) {
    return myHand().find(c => c.id === id);
  }

  function twinOf(card) {
    return card && myHand().find(c => c.id !== card.id && c.t === card.t);
  }

  function canPair(card) {
    const g = game();
    return myTurn() && !g.pending && twinOf(card) && g.played + 2 <= E.MAX_PLAYS &&
      g.players.some((p, i) => i !== me() && p.handCount > 0);
  }

  function stealSources() {
    const g = game(), R = recipesOf(g), out = [];
    g.players.forEach((src, sp) => src.tray.forEach((st, si) => {
      const opts = stealOptions(sp, si);
      if (opts.whole.length || opts.top.length) out.push(`${sp}:${si}`);
    }));
    return out;
  }

  function stealOptions(sp, si) {
    const g = game(), R = recipesOf(g);
    const st = g.players[sp].tray[si];
    const res = { whole: [], top: [] };
    const complete = E.completeRecipe(st, R) >= 0;
    g.players.forEach((d, dp) => {
      if (dp === sp) return;
      if (complete && E.trayValid(E.withAdded(d.tray, st, 'new'), R)) res.whole.push(`${dp}:new`);
      for (const tg of E.placeTargets(d.tray, [st[st.length - 1]], R)) res.top.push(`${dp}:${tg}`);
    });
    return res;
  }

  // In the tutorial only the spots Kalle is currently talking about light up.
  function targets() {
    const all = rawTargets();
    const step = tutActive();
    if (!step) return all;
    return new Set([...all].filter(k => (step.spots ? step.spots(k) : !step.next)));
  }

  function rawTargets() {
    const g = game();
    if (!g || !myTurn()) return new Set();
    const R = recipesOf(g);
    const mine = g.players[me()].tray;
    if (ui.mode === 'place') {
      const c = findCard(ui.sel);
      return new Set(c ? E.placeTargets(mine, [c], R).map(t => `${me()}:${t}`) : []);
    }
    if (ui.mode === 'digPick') {
      const c = g.trash.find(x => x.id === ui.dig);
      return new Set(c ? E.placeTargets(mine, [c], R).map(t => `${me()}:${t}`) : []);
    }
    if (ui.mode === 'burn') {
      const s = new Set();
      g.players.forEach((p, i) => p.tray.forEach((_, si) => s.add(`${i}:${si}`)));
      return s;
    }
    if (ui.mode === 'stealSrc') return new Set(stealSources());
    if (ui.mode === 'stealDst') {
      const o = stealOptions(ui.steal.from.player, ui.steal.from.stack);
      return new Set(ui.steal.mode === 'whole' ? o.whole : o.top);
    }
    return new Set();
  }

  function stackLabel(st, R) {
    const done = E.completeRecipe(st, R);
    if (done >= 0) return `✓ ${E.RECIPES[done].name}`;
    return E.candidates(st, R).map(i => E.RECIPES[i].name.replace(' Burger', '')).join(' / ');
  }

  // ---------- Rendering ----------

  function render() {
    document.body.classList.toggle('in-game', !!game());
    if (session && view) {
      tutAdvance();
      if (view.phase === 'lobby') renderLobby();
      else renderGame();
      return renderCoach();
    }
    hideCoach();
    if (profileLoading) return renderLoading();
    if (!profile) return renderOnboarding();
    if (mm) return renderMatching();
    renderHome();
  }

  const roomParam = () => (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  const privacyUrl = () => (SERVER ? CONFIG.publicUrl : '') + '/datenschutz.html';
  const legalLinks = () => `<div class="legal-links">
      <a class="link small" href="${esc(privacyUrl())}" target="_blank" rel="noopener">Datenschutz</a>
      <a class="link small" href="${esc(privacyUrl().replace('datenschutz', 'impressum'))}" target="_blank" rel="noopener">Impressum</a>
    </div>`;

  function renderLoading() {
    app.innerHTML = `<div class="home"><img class="logo-img" src="img/logo.png" alt="Smash Burger"><p class="wait">Küche wird vorgeheizt …</p></div>`;
  }

  function renderOnboarding() {
    app.innerHTML = `
      <div class="home">
        <img class="logo-img" src="img/logo.png" alt="Smash Burger">
        <p class="tagline">Bereite deinen Burger zu.<br><b>Smashe die Konkurrenz.</b></p>
        <div class="panel chef-panel">
          <img class="chef-peek" src="img/chef-wave.png" alt="">
          <h2>Willkommen in der Küche!</h2>
          <p class="note">Wie sollen dich die anderen nennen?</p>
          <input id="name" maxlength="18" autocomplete="nickname" value="${esc(localStorage.getItem(LS_NAME) || '')}" placeholder="Dein Name">
          <button class="btn primary big" data-do="onboard">Los geht's!</button>
        </div>
        ${legalLinks()}
      </div>`;
  }

  function renderHome() {
    const info = E.levelInfo(profile.xp);
    const room = roomParam();
    app.innerHTML = `
      <div class="home">
        <img class="logo-img small" src="img/logo.png" alt="Smash Burger">
        <div class="profile-card">
          <div class="pc-top">
            <div class="pc-lv">${levelBadge(info.level)}</div>
            <div class="pc-main">
              <div class="pc-name">${esc(profile.name)} <button class="icon-btn" data-do="editName" aria-label="Namen ändern">✏️</button></div>
              <div class="pc-title">${esc(info.title)}</div>
              ${xpBar(info)}
            </div>
          </div>
          <div class="pc-stats"><span><b>${profile.games}</b> Spiele</span><span><b>${profile.wins}</b> Siege</span></div>
        </div>
        ${room ? `
          <div class="invite">
            <p>Du wurdest an Tisch <b>${esc(room)}</b> eingeladen!</p>
            <button class="btn primary big" data-do="joinInvite">An den Tisch setzen</button>
          </div>` : ''}
        ${!profile.tutorialDone ? `
          <div class="panel chef-panel tut-card">
            <img class="chef-peek" src="img/chef-point.png" alt="">
            <h3>Neu hier?</h3>
            <p>Spiel eine Übungsrunde mit <b>Koch Kalle</b> – er erklärt dir alles Schritt für Schritt.</p>
            <button class="btn primary" data-do="tutorial">🎓 Übungsrunde starten</button>
            <button class="link" data-do="skipTutorial">Kenne ich schon</button>
          </div>` : ''}
        <div class="menu-buttons">
          <button class="mbtn quick" data-do="quick">
            <span class="mb-ico">⚡</span><span class="mb-txt"><b>Schnelles Spiel</b><small>Gegner auf deinem Level</small></span>
          </button>
          <button class="mbtn friends" data-do="friends">
            <span class="mb-ico">👥</span><span class="mb-txt"><b>Mit Freunden</b><small>Eigenen Tisch eröffnen oder beitreten</small></span>
          </button>
        </div>
        <div class="home-links">
          <button class="link" data-do="rules">📖 Regeln</button>
          ${profile.tutorialDone ? '<button class="link" data-do="tutorial">🎓 Tutorial</button>' : ''}
          <button class="link" data-do="levels">🏅 Level</button>
        </div>
        ${legalLinks()}
      </div>`;
  }

  function renderMatching() {
    const st = mm.status || {};
    const lv = E.levelInfo(profile.xp).level;
    const secs = Math.floor((st.waited || 0) / 1000);
    app.innerHTML = `
      <div class="home matching">
        <img class="chef-big bob" src="img/chef-wave.png" alt="">
        <h2>Suche Gegner …</h2>
        <p class="mm-range">Level ${Math.max(1, lv - (st.range || 2))} – ${lv + (st.range || 2)}</p>
        <div class="mm-dots"><i></i><i></i><i></i></div>
        <p class="note">${st.near > 1 ? `${st.near - 1} Spieler:in${st.near > 2 ? 'nen' : ''} in deiner Nähe gefunden` : 'Noch niemand auf deinem Level online'} · ${secs}s</p>
        ${st.botsIn > 0 ? `<p class="note">Falls niemand kommt, spielen in ${st.botsIn}s Bots mit dir.</p>` : ''}
        <button class="btn big" data-do="cancelQuick">Abbrechen</button>
      </div>`;
  }

  function friendsSheet() {
    openSheet(`<h2>👥 Mit Freunden spielen</h2>
      <p class="note">Eröffne einen Tisch und schick den Code an deine Freunde.</p>
      <button class="btn primary big" data-do="create">Neuen Tisch eröffnen</button>
      <div class="or">oder mit Code beitreten</div>
      <div class="join-row">
        <input id="code" maxlength="4" placeholder="CODE" value="${esc(roomParam())}" autocapitalize="characters">
        <button class="btn" data-do="join">Beitreten</button>
      </div>`);
  }

  function nameSheet() {
    openSheet(`<h2>✏️ Name ändern</h2>
      <input id="newName" maxlength="18" value="${esc(profile.name)}">
      <div class="btn-row" style="margin-top:12px"><button class="btn primary" data-do="saveName">Speichern</button></div>
      <hr class="sep">
      <h3>Profil löschen</h3>
      <p class="note">Löscht deinen Namen, dein Level und deine Statistik endgültig.</p>
      <button class="btn danger" data-do="deleteProfile">🗑️ Profil löschen</button>`);
  }

  async function deleteProfile() {
    if (!confirm('Profil wirklich löschen? Dein Level und deine Statistik sind danach weg.')) return;
    try {
      await post('/api/profile/delete', withProfile({}));
    } catch (e) {
      if (!/Profil/.test(e.message)) return toast(e.message);
    }
    dropProfile();
    closeSheet();
    toast('Dein Profil wurde gelöscht.');
    render();
  }

  function levelsSheet() {
    const info = E.levelInfo(profile.xp);
    openSheet(`<h2>🏅 Level & Titel</h2>
      <p>Für jede Runde bekommst du XP: <b>20</b> fürs Mitspielen, <b>15</b> pro fertigem Burger und <b>40+</b> für den Sieg.
      Beim Schnellen Spiel triffst du Gegner auf deinem Level.</p>
      <ul class="titles">${E.TITLES.map(([l, t]) => `<li class="${info.level >= l ? 'got' : ''}">${levelBadge(l)} ${esc(t)}</li>`).join('')}</ul>`);
  }

  function renderLobby() {
    const isHost = view.host === me();
    const n = view.players.length;
    app.innerHTML = `
      <div class="lobby">
        <img class="logo-img small" src="img/logo.png" alt="Smash Burger">
        <div class="panel">
          <div class="code-box">
            <div class="code-label">Tisch-Code</div>
            <div class="code">${esc(view.code)}</div>
            <button class="btn" data-do="share">🔗 Einladung teilen</button>
          </div>
          <h3>Am Tisch (${n}/6)</h3>
          <ul class="plist">
            ${view.players.map((p, i) => `
              <li>
                <span class="dot ${p.connected ? 'on' : ''}"></span>
                ${levelBadge(p.level || 1)}
                <span class="pname">${esc(p.name)}${i === me() ? ' <small>(du)</small>' : ''}</span>
                ${i === view.host ? '<span class="badge">👑 Gastgeber</span>' : ''}
                ${p.isBot ? '<span class="badge">🤖</span>' : ''}
                ${isHost && i !== me() ? `<button class="x" data-do="kick" data-i="${i}" aria-label="Entfernen">✕</button>` : ''}
              </li>`).join('')}
          </ul>
          <p class="note">${n <= 3
            ? '2–3 Spieler:innen: Alle <b>4 Burger</b> der Speisekarte fertigstellen.'
            : '4–6 Spieler:innen: Nur die <b>ersten 3 Burger</b> der Speisekarte fertigstellen.'}</p>
          ${isHost ? `
            <div class="btn-row">
              <button class="btn" data-do="addBot" ${n >= 6 ? 'disabled' : ''}>🤖 Bot dazu</button>
              <button class="btn primary" data-do="start" ${n < 2 ? 'disabled' : ''}>Spiel starten</button>
            </div>` : '<p class="wait">Warte, bis der Gastgeber das Spiel startet …</p>'}
        </div>
        <div class="btn-row center">
          <button class="link" data-do="rules">📖 Regeln</button>
          <button class="link" data-do="menu">📋 Speisekarte</button>
          <button class="link danger" data-do="leave">Tisch verlassen</button>
        </div>
      </div>`;
  }

  function miniCard(c, size) {
    const d = T[c.t];
    return `<div class="mc ${d.kind}" title="${esc(d.name)}">${A.cardArt(c.t, size)}</div>`;
  }

  function trayHTML(p, pi, size, tg) {
    const g = game(), R = recipesOf(g);
    const stacks = p.tray.map((st, si) => {
      const done = E.completeRecipe(st, R) >= 0;
      const key = `${pi}:${si}`;
      return `<div class="stack ${done ? 'done' : ''} ${tg.has(key) ? 'target' : ''}" data-do="stack" data-p="${pi}" data-s="${si}">
        <div class="stack-cards">${st.map(c => miniCard(c, size)).join('')}</div>
        <div class="stack-label">${esc(stackLabel(st, R))}</div>
      </div>`;
    });
    if (tg.has(`${pi}:new`)) {
      stacks.push(`<div class="stack new target" data-do="stack" data-p="${pi}" data-s="new"><div class="stack-cards">＋</div><div class="stack-label">Neuer Burger</div></div>`);
    }
    if (!stacks.length) stacks.push('<div class="empty-tray">Leeres Tablett</div>');
    return `<div class="tray" data-tray="${pi}">${stacks.join('')}</div>`;
  }

  function handCard(c) {
    const d = T[c.t];
    const sel = ui.sel === c.id;
    const twin = myTurn() && twinOf(c);
    return `<button class="card ${d.kind} ${sel ? 'sel' : ''}" data-do="card" data-id="${c.id}" data-t="${c.t}">
      <span class="corner">${twin ? '👯' : ''}</span>
      <span class="art">${A.cardArt(c.t, d.kind === 'act' ? 66 : [0, 66, 46, 34, 28, 24][d.layers.length])}</span>
      <span class="cname">${esc(d.name)}</span>
    </button>`;
  }

  // Always-visible menu: every ingredient already lying on my tray is ticked off.
  function menuStripHTML(tray, R) {
    const assign = E.assignRecipes(tray, R);
    return `<div class="menu-strip">${R.map(r => {
      const si = assign.indexOf(r);
      const have = si >= 0 ? E.layersOf(tray[si]).length : 0;
      const layers = E.RECIPES[r].layers;
      const done = have === layers.length;
      return `<div class="order ${done ? 'done' : ''}">
        <div class="order-name">${done ? '✅' : `${have}/${layers.length}`} ${esc(E.RECIPES[r].name.replace(' Burger', ''))}</div>
        <div class="order-row">${layers.map((l, i) =>
          `<span class="oi ${i < have ? 'got' : ''}">${A.icon(l, 22)}${i < have ? '<b>✓</b>' : ''}</span>`).join('')}</div>
      </div>`;
    }).join('')}</div>`;
  }

  function hintHTML() {
    const g = game();
    const cur = g.players[g.current];
    if (g.winner != null) return '';
    if (!myTurn()) {
      const sel = ui.sel && findCard(ui.sel);
      const extra = sel && T[sel.t].desc ? `<div class="sub">${esc(T[sel.t].name)}: ${esc(T[sel.t].desc)}</div>` : '';
      return `<div class="hint-text">⏳ <b>${esc(cur.name)}</b> ist am Zug${g.pending ? ' und wühlt im Müll' : ''} …</div>${extra}`;
    }
    const played = `<span class="pill">${g.played}/3 gespielt</span>`;
    const cancel = '<button class="btn ghost" data-do="cancel">Abbrechen</button>';
    if (g.pending) {
      return `<div class="hint-text">🗑️ Wähle eine Zutat aus dem Müll${ui.dig ? ' – und tippe dann auf ein markiertes Feld' : ''}.</div>
        <div class="btn-row"><button class="btn" data-do="digOpen">Müll durchsuchen</button></div>`;
    }
    if (ui.mode === 'burn') return `<div class="hint-text">🔥 Tippe auf den Burger, der verbrennen soll.</div><div class="btn-row">${cancel}</div>`;
    if (ui.mode === 'stealSrc') return `<div class="hint-text">✋ Was willst du klauen? Tippe auf einen markierten Burger.</div><div class="btn-row">${cancel}</div>`;
    if (ui.mode === 'stealDst') return `<div class="hint-text">✋ Wohin damit? Tippe auf ein markiertes Feld (anderes Tablett).</div><div class="btn-row">${cancel}</div>`;

    const c = ui.sel && findCard(ui.sel);
    if (!c) {
      const canEnd = g.played > 0 || !myHand().length;
      return `<div class="hint-text">🍳 Du bist dran! Spiele 1–3 Karten. ${played}</div>
        <div class="btn-row"><button class="btn ${canEnd ? 'primary' : ''}" data-do="end" ${canEnd ? '' : 'disabled'}>Zug beenden</button></div>`;
    }
    const d = T[c.t];
    const pairBtn = canPair(c) ? '<button class="btn" data-do="pair">👯 Paar → Karte ziehen</button>' : '';
    if (d.kind === 'ing') {
      const has = targets().size > 0;
      return `<div class="hint-text">${has ? `<b>${esc(d.name)}</b>: Tippe auf ein markiertes Feld auf deinem Tablett.` : `<b>${esc(d.name)}</b> passt gerade nirgends hin.`} ${played}</div>
        <div class="btn-row"><button class="btn" data-do="discard">🗑️ Abwerfen</button>${pairBtn}${cancel}</div>`;
    }
    return `<div class="hint-text"><b>${A.ACTIONS[c.t]} ${esc(d.name)}</b>: ${esc(d.desc)} ${played}</div>
      <div class="btn-row"><button class="btn primary" data-do="play">Ausspielen</button><button class="btn" data-do="discard">🗑️ Abwerfen</button>${pairBtn}${cancel}</div>`;
  }

  function renderGame() {
    const g = game();
    const R = recipesOf(g);
    const tg = targets();
    const mine = g.players[me()];
    const others = g.players.map((p, i) => ({ p, i })).filter(x => x.i !== me());
    // Order opponents in seating order starting after me.
    others.sort((a, b) => ((a.i - me() + g.players.length) % g.players.length) - ((b.i - me() + g.players.length) % g.players.length));
    const top = g.trash[g.trash.length - 1];
    const recent = g.log.slice(-2).reverse();

    app.innerHTML = `
      <div class="game">
        <header class="topbar">
          <button class="pile deck" data-do="noop" title="Nachziehstapel"><span class="back"></span><b>${g.deckCount}</b></button>
          <button class="pile trash" data-do="trash" title="Müll">${top ? miniCard(top, 20) : '<span class="empty">🗑️</span>'}<b>${g.trash.length}</b></button>
          <div class="spacer"></div>
          <button class="tbtn" data-do="menu">📋 Menü</button>
          <button class="tbtn" data-do="more">⋯</button>
        </header>

        <section class="opponents">
          ${others.map(({ p, i }) => `
            <div class="opp ${g.current === i ? 'active' : ''} ${view.players[i] && !view.players[i].connected ? 'offline' : ''}" data-player="${i}">
              <div class="opp-head">
                <span class="oname">${levelBadge((view.players[i] || {}).level || 1)} ${g.current === i ? '🍳 ' : ''}${esc(p.name)}</span>
                <span class="ometa"><span class="hc">${'<i></i>'.repeat(p.handCount)}</span> ✓${E.completedCount(p.tray, R)}/${R.length}</span>
              </div>
              ${trayHTML(p, i, 20, tg)}
            </div>`).join('')}
        </section>

        <button class="ticker" data-do="log">${recent.map((l, k) => `<div class="${k === 0 && l.n > lastLogN ? 'fresh' : ''}">${esc(l.text)}</div>`).join('')}</button>

        <section class="mytray ${myTurn() ? 'active' : ''}" data-player="${me()}">
          <div class="my-head"><b>Deine Bestellung</b><span>✓ ${E.completedCount(mine.tray, R)}/${R.length} Burger</span></div>
          ${menuStripHTML(mine.tray, R)}
          <div class="my-head sub"><b>Dein Tablett</b></div>
          ${trayHTML(mine, me(), 30, tg)}
        </section>

        <section class="hint">${hintHTML()}</section>

        <section class="hand">${myHand().map(handCard).join('') || '<div class="empty-hand">Keine Karten auf der Hand</div>'}</section>

        ${g.winner != null ? resultHTML(g) : ''}
      </div>`;
    animateResult();
    if (g.log.length) lastLogN = Math.max(lastLogN, g.log[g.log.length - 1].n);
  }

  function resultHTML(g) {
    const won = g.winner === me();
    const r = view.result;
    const levelUp = r && r.after.level > r.before.level;
    let buttons;
    if (view.kind === 'tutorial') {
      buttons = '<button class="btn primary big" data-do="home">Zum Hauptmenü</button>';
    } else if (view.kind === 'quick') {
      buttons = `<button class="btn primary big" data-do="again">⚡ Nächstes Spiel</button>
        <button class="link" data-do="home">Hauptmenü</button>`;
    } else {
      buttons = `${view.host === me() ? '<button class="btn primary big" data-do="restart">Nochmal spielen</button>' : '<p class="wait">Warte auf den Gastgeber …</p>'}
        <button class="link" data-do="home">Hauptmenü</button>`;
    }
    return `
      <div class="winner">
        <div class="winner-card">
          <img class="chef-result" src="img/${won ? 'chef-cheer' : 'chef-thumbs'}.png" alt="">
          <h2>${won ? 'Du gewinnst!' : `${esc(g.players[g.winner].name)} gewinnt!`}</h2>
          <p>${view.kind === 'tutorial' ? 'Übungsrunde geschafft – jetzt bist du bereit für echte Gegner!'
            : won ? 'Alle Burger fertig – du bist Küchenchef:in!' : 'Ab in die Küche, nächste Runde!'}</p>
          ${r ? `
            <div class="xp-gain">
              <div class="xp-plus">+${r.xp} XP</div>
              <div class="xp-detail">20 fürs Mitspielen · ${r.burgers} × 15 für Burger${r.won ? ' · Sieg-Bonus' : ''}${r.bonus ? ` · ${r.bonus} Tutorial-Bonus` : ''}</div>
              <div class="xp-row">${levelBadge(r.after.level)}
                <div class="xpbar big"><i data-from="${levelUp ? 0 : Math.round(r.before.into / r.before.need * 100)}" data-to="${Math.round(r.after.into / r.after.need * 100)}"></i><span>${r.after.into} / ${r.after.need} XP</span></div>
              </div>
              ${levelUp ? `<div class="level-up">⭐ Level ${r.after.level} erreicht! <small>${esc(r.after.title)}</small></div>` : ''}
            </div>` : ''}
          ${buttons}
        </div>
      </div>`;
  }

  // Fill the XP bar from the old to the new value once the result appears.
  let animatedFor = null;
  function animateResult() {
    const bar = app.querySelector('.xp-gain .xpbar i');
    if (!bar) return;
    const key = `${view.code}:${view.game.turn}`;
    if (animatedFor === key) { bar.style.width = bar.dataset.to + '%'; return; }
    animatedFor = key;
    bar.style.transition = 'none';
    bar.style.width = bar.dataset.from + '%';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bar.style.transition = '';
      bar.style.width = bar.dataset.to + '%';
    }));
  }

  // ---------- Animationen für Aktionskarten ----------
  // Attacks change the table in one go. To make them readable we remember where everything was before the
  // update, then fly copies of the moved cards from the old spot to the new one under a big banner.

  const fxLayer = document.getElementById('fx');
  const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FX_MS = 2600;
  let fxSeen = null; // { code, n }: newest log entry already animated
  let fxHidden = [];

  // Accusative with article, for "… klaut dir das Brötchen".
  const ACC = {
    bun: 'das Brötchen', tomato: 'die Tomate', salad: 'den Salat', cheese: 'den Käse', beef: 'das Beef-Patty',
    chicken: 'das Chicken-Patty', saladTomato: 'Salat + Tomate', beefCheese: 'das Cheese-Patty',
    fullCheese: 'den fertigen Cheeseburger', fullChicken: 'den fertigen Chicken Burger', fullDeluxe: 'den fertigen Deluxe Burger',
  };

  function snapshot() {
    const snap = { stacks: {}, trays: {}, players: {} };
    if (!game()) return snap;
    app.querySelectorAll('.stack[data-p]').forEach(el => {
      if (el.dataset.s === 'new') return;
      const cards = el.querySelectorAll('.mc');
      const top = cards[cards.length - 1];
      snap.stacks[`${el.dataset.p}:${el.dataset.s}`] = { el, r: el.getBoundingClientRect(), top, topR: top && top.getBoundingClientRect() };
    });
    app.querySelectorAll('.tray[data-tray]').forEach(el => { snap.trays[el.dataset.tray] = { el, r: el.getBoundingClientRect() }; });
    app.querySelectorAll('[data-player]').forEach(el => { snap.players[el.dataset.player] = el.getBoundingClientRect(); });
    const trash = app.querySelector('.pile.trash');
    if (trash) snap.trash = trash.getBoundingClientRect();
    const hand = app.querySelector('.hand');
    if (hand) snap.hand = hand.getBoundingClientRect();
    return snap;
  }

  // Log entries with an fx that arrived since the last update (never replays old ones after a reconnect).
  function freshFx() {
    const g = game();
    if (!g) return [];
    const last = g.log.length ? g.log[g.log.length - 1].n : 0;
    if (!fxSeen || fxSeen.code !== view.code || last < fxSeen.n) {
      fxSeen = { code: view.code, n: last };
      return [];
    }
    const out = g.log.filter(l => l.n > fxSeen.n && l.fx);
    fxSeen.n = last;
    return out;
  }

  const rectOf = el => el && el.getBoundingClientRect();
  const nameOf = p => (p === me() ? 'Du' : game().players[p].name);
  const trayOf = p => (p === me() ? 'Dein Tablett' : `Tablett von ${game().players[p].name}`);
  const verb = (p, mine, theirs) => (p === me() ? mine : theirs);

  function clearFx() {
    fxLayer.getAnimations({ subtree: true }).forEach(a => a.cancel());
    fxLayer.innerHTML = '';
    fxHidden.forEach(el => { el.style.visibility = ''; });
    fxHidden = [];
  }

  function hideUntilLanded(el) {
    if (!el) return;
    el.style.visibility = 'hidden';
    fxHidden.push(el);
  }

  function land(el) {
    if (!el) return;
    el.style.visibility = '';
    el.classList.remove('fx-land');
    void el.offsetWidth;
    el.classList.add('fx-land');
  }

  function addFx(cls, rect, html) {
    const el = document.createElement('div');
    el.className = cls;
    if (rect) Object.assign(el.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
    if (html != null) el.innerHTML = html;
    fxLayer.appendChild(el);
    return el;
  }

  // Lift a copy of `node` at `from`, hold it up so everyone sees it, then fly it to `to`.
  function fly(node, from, to, opts) {
    opts = opts || {};
    const wrap = addFx('fx-fly', from);
    wrap.appendChild(node);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const s = opts.shrink ? 0.2 : Math.max(0.5, Math.min(1.8, Math.min(to.width / (from.width || 1), to.height / (from.height || 1))));
    const lift = 'translate(0px, -26px) scale(1.45) rotate(-5deg)';
    const end = `translate(${dx}px, ${dy}px) scale(${s}) rotate(${opts.shrink ? 25 : 0}deg)`;
    const frames = opts.burn ? [
      { transform: 'none', filter: 'none' },
      { transform: lift, filter: 'none', offset: 0.22 },
      { transform: lift, filter: 'brightness(.35) sepia(1) saturate(3)', offset: 0.6 },
      { transform: end, filter: 'brightness(.2)', opacity: 0 },
    ] : [
      { transform: 'none' },
      { transform: lift, offset: 0.22 },
      { transform: lift, offset: 0.45 },
      { transform: end, opacity: opts.shrink ? 0 : 1 },
    ];
    const a = wrap.animate(frames, { duration: opts.ms || 1800, delay: opts.delay || 250, easing: 'ease-in-out', fill: 'forwards' });
    return a.finished.then(() => wrap.remove(), () => {});
  }

  function banner(title, line, route, bad) {
    addFx('fx-dim');
    addFx(`fx-banner ${bad ? 'bad' : ''}`, null,
      `<div class="fx-title">${title}</div><div class="fx-line">${esc(line)}</div>${route ? `<div class="fx-route">${esc(route)}</div>` : ''}`);
  }

  function ghost(rect) {
    return rect ? addFx('fx-ghost', rect) : null;
  }

  function shake(p) {
    const el = app.querySelector(`[data-player="${p}"]`);
    if (!el) return;
    el.classList.remove('fx-shake');
    void el.offsetWidth;
    el.classList.add('fx-shake');
  }

  function cleanCopy(el) {
    const c = el.cloneNode(true);
    c.classList.remove('target', 'coach-hl');
    c.style.visibility = '';
    return c;
  }

  function playFx(entry, snap) {
    clearFx();
    const fx = entry.fx;
    const g = game();
    const victimIsMe = (fx.from && fx.from.player === me() && fx.by !== me()) || (fx.k === 'pair' && fx.victim === me());
    if (victimIsMe && navigator.vibrate) navigator.vibrate([90, 60, 90]);
    setTimeout(clearFx, FX_MS + 300);

    if (fx.k === 'steal') {
      const what = fx.whole ? fx.label : ACC[fx.cards[0]] || fx.label;
      banner(victimIsMe ? '✋ Du wurdest beklaut!' : fx.by === me() ? '✋ Geklaut!' : '✋ Klau-Alarm!',
        `${nameOf(fx.by)} ${verb(fx.by, 'klaust', 'klaut')} ${what}`, `${trayOf(fx.from.player)} ➜ ${trayOf(fx.to.player)}`, victimIsMe);
      shake(fx.from.player);
      if (calm) return;
      const src = snap.stacks[`${fx.from.player}:${fx.from.stack}`];
      const dstEl = app.querySelector(stackSel(fx.to.player, fx.to.stack));
      if (!src || !dstEl) return;
      const g1 = ghost(fx.whole ? src.r : src.topR);
      const target = fx.whole ? dstEl : [...dstEl.querySelectorAll('.mc')].pop();
      hideUntilLanded(target);
      const node = cleanCopy(fx.whole ? src.el : src.top);
      fly(node, fx.whole ? src.r : src.topR, rectOf(target)).then(() => { if (g1) g1.remove(); land(target); });
      return;
    }

    if (fx.k === 'burn') {
      const what = fx.cards.length === 1 ? ACC[fx.cards[0]] || fx.label : fx.label;
      banner(victimIsMe ? '🔥 Dein Burger brennt!' : fx.by === me() ? '🔥 Verbrannt!' : '🔥 Es brennt!',
        `${nameOf(fx.by)} ${verb(fx.by, 'verbrennst', 'verbrennt')} ${what}`, `${trayOf(fx.from.player)} ➜ Müll`, victimIsMe);
      shake(fx.from.player);
      if (calm) return;
      const src = snap.stacks[`${fx.from.player}:${fx.from.stack}`];
      const trash = app.querySelector('.pile.trash');
      if (!src || !trash) return;
      const g1 = ghost(src.r);
      const node = cleanCopy(src.el);
      const flame = document.createElement('div');
      flame.className = 'fx-flame';
      flame.textContent = '🔥';
      node.appendChild(flame);
      fly(node, src.r, rectOf(trash), { burn: true, shrink: true, ms: 2000 }).then(() => { if (g1) g1.remove(); land(trash); });
      return;
    }

    if (fx.k === 'swap') {
      const n = g.players.length;
      const mineFrom = fx.dir === 'next' ? (me() - 1 + n) % n : (me() + 1) % n;
      banner('🔄 Falscher Tisch!', `${nameOf(fx.by)} ${verb(fx.by, 'lässt', 'lässt')} alle Tabletts weiterwandern`,
        mineFrom === me() ? '' : `Du hast jetzt das Tablett von ${g.players[mineFrom].name}`, false);
      if (calm) return;
      for (let i = 0; i < n; i++) {
        const from = snap.trays[i];
        const to = (fx.dir === 'next' ? i + 1 : i - 1 + n) % n;
        const dstEl = app.querySelector(`.tray[data-tray="${to}"]`);
        if (!from || !dstEl || !from.el.querySelector('.stack')) continue;
        hideUntilLanded(dstEl);
        fly(cleanCopy(from.el), from.r, rectOf(dstEl), { ms: 1900 }).then(() => land(dstEl));
      }
      return;
    }

    if (fx.k === 'dig') {
      banner('🗑️ Mülltaucher!', `${nameOf(fx.by)} ${verb(fx.by, 'fischst', 'fischt')} ${ACC[fx.cards[0]] || ''} aus dem Müll`, `Müll ➜ ${trayOf(fx.by)}`, false);
      if (calm || !snap.trash) return;
      const dstEl = app.querySelector(stackSel(fx.to.player, fx.to.stack));
      const target = dstEl && [...dstEl.querySelectorAll('.mc')].pop();
      if (!target) return;
      hideUntilLanded(target);
      const node = document.createElement('div');
      node.innerHTML = miniCard({ t: fx.cards[0] }, 30);
      fly(node.firstElementChild, snap.trash, rectOf(target)).then(() => land(target));
      return;
    }

    if (fx.k === 'pair') {
      banner(victimIsMe ? '👯 Dir wurde eine Karte geklaut!' : '👯 Paar!',
        `${nameOf(fx.by)} ${verb(fx.by, 'wirfst', 'wirft')} zwei Mal ${T[fx.cards[0]].name} ab`,
        `… und ${verb(fx.by, 'ziehst', 'zieht')} blind eine Karte von ${fx.victim === me() ? 'dir' : g.players[fx.victim].name}`, victimIsMe);
      if (calm) return;
      const from = fx.victim === me() ? snap.hand : snap.players[fx.victim];
      const to = fx.by === me() ? rectOf(app.querySelector('.hand')) : rectOf(app.querySelector(`[data-player="${fx.by}"]`));
      if (!from || !to) return;
      const back = document.createElement('div');
      back.className = 'fx-back';
      const box = r => ({ left: r.left + r.width / 2 - 20, top: r.top + r.height / 2 - 28, width: 40, height: 56 });
      fly(back, box(from), box(to));
    }
  }

  // ---------- Tutorial (Koch Kalle erklärt) ----------

  const coachEl = document.getElementById('coach');
  let tutStep = null;

  const KALLE = 1; // seat of the tutorial cook (you always sit at 0)
  const handHasType = t => myHand().some(c => c.t === t);
  const selType = () => { const c = ui.sel && findCard(ui.sel); return c && c.t; };
  // Index of the stack on a tray whose layers are exactly `layers` (e.g. 'beef,cheese'), or -1.
  const stackOf = (p, layers) => game().players[p].tray.findIndex(st => E.layersOf(st).join(',') === layers);
  const mine = layers => stackOf(me(), layers);
  const kalles = layers => stackOf(KALLE, layers);
  const myDone = () => E.completedCount(game().players[me()].tray, game().recipes);
  const stackSel = (p, s) => `.stack[data-p="${p}"][data-s="${s}"]`;

  // "Play this card on that spot": highlights the card first, then the one spot it may go to.
  function placeStep(card, spot, pick, put, done) {
    return {
      when: () => myTurn(), done, skip: () => myTurn() && !handHasType(card),
      cards: [card], buttons: ['cancel'],
      spots: k => k === `${me()}:${spot()}`,
      target: () => (selType() === card ? stackSel(me(), spot()) : `.hand .card[data-t="${card}"]`),
      text: () => (selType() === card ? put : pick),
    };
  }

  // Action card in three moves: tap the card, tap "Ausspielen", tap the highlighted burger(s).
  function actionStep(card, src, texts, done, dst) {
    const stage = () => (selType() !== card ? 0 : !ui.mode ? 1 : ui.mode === 'stealDst' ? 3 : 2);
    return {
      when: () => myTurn(), done, skip: () => myTurn() && !handHasType(card) && !ui.mode,
      cards: [card], buttons: ['play', 'cancel'],
      spots: k => (ui.mode === 'stealDst' ? k === dst() : k === src()),
      target: () => [`.hand .card[data-t="${card}"]`, '[data-do="play"]', `.stack[data-p="${src().replace(':', '"][data-s="')}"]`,
        dst ? `.stack[data-p="${dst().replace(':', '"][data-s="')}"]` : ''][stage()],
      text: () => texts[stage()],
    };
  }

  // Each step: text, highlight target, `when` (show only then), `done`/`skip` (auto-advance) or `next` (button).
  // While a step is shown only its `cards`, `spots` and `buttons` work, so the round runs exactly as explained.
  // The hands are fixed on the server (TUTORIAL_RIG / TUTORIAL_BOT_RIG), test/tutorial.js checks the same moves.
  const TUT = [
    { chef: 'wave', next: true, text: 'Willkommen in meiner Küche! Ich bin <b>Kalle</b> und spiele diese Übungsrunde mit dir. Ziel des Spiels: Wer zuerst <b>alle 4 Burger seiner Bestellung</b> fertig hat, gewinnt.' },
    { chef: 'point', target: '.menu-strip', next: true, text: 'Das ist <b>deine Bestellung</b>. Jede Zeile ist ein Burger. Die Zutaten legst du <b>genau in dieser Reihenfolge</b>: links ist die unterste Zutat, ganz rechts kommt immer das <b>Brötchen</b> obendrauf.' },
    { chef: 'point', target: '.mytray .tray', next: true, text: 'Das ist <b>dein Tablett</b>. Hier baust du deine Burger Karte für Karte. Jeder Burger bekommt einen <b>eigenen Stapel</b>.' },
    placeStep('beef', () => 'new',
      'Unten liegen deine <b>3 Handkarten</b>. Der Cheeseburger fängt mit dem <b>Beef-Patty</b> an. Tippe auf das Beef-Patty.',
      'Leuchtende Felder zeigen, wo eine Karte hinpasst. Tippe auf <b>„Neuer Burger“</b>. Damit fängst du deinen Cheeseburger an.',
      () => mine('beef') >= 0 || mine('beef,cheese') >= 0),
    placeStep('cheese', () => mine('beef'),
      'Klasse! Pro Zug darfst du <b>bis zu 3 Karten</b> spielen, eine ist schon weg. Beim Cheeseburger kommt nach dem Patty der <b>Käse</b>. Tippe auf den Käse.',
      'Jetzt tippst du auf deinen <b>Stapel mit dem Patty</b>. Der Käse kommt obendrauf.',
      () => mine('beef,cheese') >= 0),
    placeStep('salad', () => 'new',
      'Deine 3. Karte: Mit <b>Salat</b> fangen der Chicken und der Classic Burger an. Tippe auf den Salat.',
      'Der Salat bekommt einen <b>neuen Stapel</b>, denn er gehört zu einem anderen Burger. Tippe auf <b>„Neuer Burger“</b>.',
      () => mine('salad') >= 0 || !myTurn()),
    { chef: 'thumbs', target: '.opponents', next: true, text: 'Das waren 3 Karten, also ist dein Zug vorbei. Du ziehst <b>automatisch wieder auf 3 Karten</b> nach. Jetzt bin ich dran! Oben siehst du <b>mein Tablett</b>, darunter im Laufband steht, was ich gemacht habe.' },
    { chef: 'point', target: '.opponents', next: true, when: () => myTurn(), skip: () => myTurn() && kalles('beef') < 0,
      text: 'Du bist wieder dran! Ich habe ein <b>Beef-Patty</b> und einen Burger mit <b>Salat und Tomate</b> angefangen. Merk dir mein Patty, das brauchen wir gleich. 😉' },
    placeStep('bun', () => mine('beef,cheese'),
      'Du hast ein <b>Brötchen</b> gezogen! Das Brötchen ist bei jedem Burger die <b>letzte Zutat</b>. Tippe auf das Brötchen.',
      'Leg es auf deinen Stapel mit <b>Patty und Käse</b>. Dann ist dein Cheeseburger fertig.',
      () => myDone() >= 1),
    { chef: 'cheer', target: '.menu-strip', next: true, when: () => myTurn(), text: 'Dein erster Burger! ✅ In deiner Bestellung ist er jetzt abgehakt. Fertige Burger bleiben auf deinem Tablett, außer jemand <b>klaut</b> oder <b>verbrennt</b> sie.' },
    placeStep('tomato', () => mine('salad'),
      'Jetzt die <b>Tomate</b>: Beim Chicken und beim Classic Burger kommt sie direkt nach dem Salat. Tippe auf die Tomate.',
      'Leg sie auf deinen <b>Salat</b>.',
      () => mine('salad,tomato') >= 0 || mine('salad,tomato,beef') >= 0),
    actionStep('steal', () => `${KALLE}:${kalles('beef')}`, [
      'Deine letzte Karte ist eine <b>Aktionskarte</b>: ✋ <b>Klauen</b>. Damit nimmst du die <b>oberste Zutat</b> oder einen <b>fertigen Burger</b> von einem Tablett und legst sie woanders hin. Tippe auf „Klauen“.',
      'Aktionskarten spielst du mit <b>„Ausspielen“</b> aus. Tippe darauf.',
      'Jetzt tippst du auf das, was du klauen willst: <b>mein Beef-Patty</b>!',
      'Und wohin damit? Leg das Patty auf deinen Stapel mit <b>Salat und Tomate</b>. Salat, Tomate und Patty, daraus wird ein <b>Classic Burger</b>!',
    ], () => mine('salad,tomato,beef') >= 0 || !myTurn(), () => `${me()}:${mine('salad,tomato')}`),
    { chef: 'cheer', target: '.mytray .tray', next: true, text: 'Geklaut! 😄 Genau so können die anderen auch <b>dir</b> etwas klauen. Pass also gut auf, was am Tisch passiert. Jetzt bin ich wieder dran.' },
    { chef: 'point', target: '.opponents', next: true, when: () => myTurn(), skip: () => myTurn() && kalles('salad,tomato,chicken,bun') < 0,
      text: 'Hoppla, ich habe meinen <b>Chicken Burger</b> fertig gemacht! Das lassen wir nicht einfach so stehen …' },
    placeStep('bun', () => mine('salad,tomato,beef'),
      'Erst mal noch ein <b>Brötchen</b>: Damit wird dein Classic Burger fertig. Tippe auf das Brötchen.',
      'Leg es auf deinen Stapel mit <b>Salat, Tomate und Patty</b>.',
      () => myDone() >= 2),
    actionStep('burn', () => `${KALLE}:${kalles('salad,tomato,chicken,bun')}`, [
      '🔥 <b>Anbrennen</b> wirft einen ganzen Stapel in den Müll, egal ob halb oder fertig. Tippe auf „Anbrennen“.',
      'Tippe auf <b>„Ausspielen“</b>.',
      'Tippe auf <b>meinen fertigen Chicken Burger</b> und bestätige mit „Verbrennen!“.',
    ], () => kalles('salad,tomato,chicken,bun') < 0 || !myTurn()),
    { chef: 'point', target: '[data-do="end"]', when: () => myTurn(), done: () => !myTurn(), cards: [], buttons: ['end'],
      text: 'Bleibt das <b>Chicken-Patty</b>. Es passt gerade nirgends hin, weil der Chicken Burger mit Salat und Tomate anfängt. Behalte es für später! Du musst nicht alle 3 Karten spielen: Tippe auf <b>„Zug beenden“</b>.' },
    { chef: 'point', next: true, text: 'Noch ein Tipp: Karten, die du nicht brauchst, wirfst du mit <b>🗑️ Abwerfen</b> weg. Tippe dazu die Karte an. Aber Achtung: <b>Aussetzen gilt nicht</b>, mindestens 1 Karte pro Zug musst du spielen.' },
    { chef: 'point', next: true, text: 'Zwei Aktionskarten fehlen noch: <b>🗑️ Mülltaucher</b> holt eine Zutat aus dem Müll zurück, und bei <b>🔄 Falscher Tisch</b> wandern alle Tabletts eine Person weiter. Mit zwei gleichen Karten (👯 <b>Paar</b>) ziehst du jemandem blind eine Karte.' },
    { chef: 'thumbs', next: true, text: 'Jetzt kennst du alles! Dir fehlen noch der <b>Chicken</b> und der <b>Deluxe Burger</b>. Ab jetzt spielst du frei. Schlag mich, wenn du kannst! 😄' },
  ];

  // The step currently shown (and therefore steering what may be tapped), or null.
  function tutActive() {
    const g = game();
    if (!view || view.kind !== 'tutorial' || !g || g.winner != null || tutStep == null) return null;
    const step = TUT[tutStep];
    if (!step || (step.when && !step.when())) return null;
    return step;
  }

  // Skip forward over steps whose goal is already reached.
  function tutAdvance() {
    const g = game();
    if (!view || view.kind !== 'tutorial' || !g || g.winner != null) return;
    if (tutStep == null) tutStep = Number(sessionStorage.getItem(LS_TUT + view.code)) || 0;
    const passed = s => (s.done && s.done()) || (s.skip && s.skip());
    while (tutStep < TUT.length && passed(TUT[tutStep])) tutStep++;
    sessionStorage.setItem(LS_TUT + view.code, tutStep);
  }

  // Taps that don't belong to the current step get a friendly nudge instead.
  function tutBlocks(kind, value) {
    const step = tutActive();
    if (!step || !myTurn()) return false;
    const list = kind === 'card' ? step.cards : step.buttons;
    const allowed = list ? list.includes(value) : !step.next;
    if (allowed) return false;
    toast(step.next ? 'Kalle: Tippe erst auf „Weiter“.' : 'Kalle: Mach erst, was ich dir zeige. 😉');
    return true;
  }

  function hideCoach() {
    coachEl.classList.add('hidden');
    coachEl.innerHTML = '';
  }

  function renderCoach() {
    document.querySelectorAll('.coach-hl').forEach(el => el.classList.remove('coach-hl'));
    const step = tutActive();
    if (!step || sheetKind) return hideCoach();
    const sel = typeof step.target === 'function' ? step.target() : step.target;
    const target = sel && app.querySelector(sel);
    if (target) target.classList.add('coach-hl');
    // Keep the bubble away from what it points at; without a target it sits in the middle.
    const pos = !target ? 'mid' : target.getBoundingClientRect().top > window.innerHeight * 0.5 ? 'top' : 'bottom';
    coachEl.className = `coach ${pos}`;
    coachEl.innerHTML = `
      <img src="img/chef-${step.chef || 'point'}.png" alt="Koch Kalle">
      <div class="coach-bubble">
        <div class="coach-text">${typeof step.text === 'function' ? step.text() : step.text}</div>
        <div class="coach-foot">
          <span class="coach-count">${tutStep + 1}/${TUT.length}</span>
          ${step.next ? '<button class="btn primary small" data-do="coachNext">Weiter</button>' : ''}
          <button class="link small-link" data-do="coachSkip">Tutorial beenden</button>
        </div>
      </div>`;
  }

  // ---------- Sheets ----------

  function openSheet(html, kind) {
    sheetKind = kind || 'info';
    sheet.innerHTML = `<div class="sheet-bg" data-do="${sheetKind === 'lock' ? 'noop' : 'closeSheet'}"></div>
      <div class="sheet-card">${sheetKind === 'lock' ? '' : '<button class="sheet-x" data-do="closeSheet">✕</button>'}${html}</div>`;
    sheet.classList.remove('hidden');
  }

  function closeSheet() {
    sheetKind = null;
    sheet.classList.add('hidden');
    sheet.innerHTML = '';
  }

  function menuSheet() {
    const g = game();
    const R = g ? g.recipes : (view && view.players.length <= 3 ? [0, 1, 2, 3] : [0, 1, 2]);
    const tray = g ? g.players[me()].tray : [];
    openSheet(`<h2>Smash Menu</h2>
      <p class="note">Von links nach rechts legen – das Brötchen kommt zum Schluss.</p>
      <div class="menu-list">${E.RECIPES.map((r, i) => {
        const active = R.includes(i);
        const done = tray.some(st => E.completeRecipe(st, [i]) === i);
        return `<div class="menu-item ${active ? '' : 'inactive'} ${done ? 'done' : ''}">
          <div class="menu-name">${done ? '✅ ' : ''}${i + 1}. ${esc(r.name)}${i === 3 ? ' <small>(nur 2–3 Spieler:innen)</small>' : ''}</div>
          <div class="menu-row">${r.layers.map(l => A.icon(l, 34)).join('<span class="plus">+</span>')}</div>
        </div>`;
      }).join('')}</div>`);
  }

  function trashSheet() {
    const g = game();
    const list = g.trash.slice().reverse();
    openSheet(`<h2>🗑️ Müll (${list.length})</h2>
      <p class="note">Oben liegt die zuletzt abgeworfene Karte.</p>
      <div class="card-grid">${list.map(c => `<div class="gcard ${T[c.t].kind}">${A.cardArt(c.t, 28)}<span>${esc(T[c.t].name)}</span></div>`).join('') || '<p>Noch leer.</p>'}</div>`);
  }

  function digSheet() {
    const g = game();
    const opts = new Set(E.digOptions({ trash: g.trash, players: g.players.map(p => ({ tray: p.tray })), recipes: g.recipes }, me()).map(c => c.id));
    const list = g.trash.slice().reverse().filter(c => opts.has(c.id));
    openSheet(`<h2>🗑️ Mülltaucher</h2>
      <p class="note">Nimm dir eine Zutat – du musst sie sofort auf dein Tablett legen.</p>
      <div class="card-grid">${list.map(c => `<button class="gcard ing pick" data-do="digPick" data-id="${c.id}">${A.cardArt(c.t, 28)}<span>${esc(T[c.t].name)}</span></button>`).join('')}</div>`, 'lock');
  }

  function logSheet() {
    const g = game();
    openSheet(`<h2>Was ist passiert?</h2><ol class="log">${g.log.slice().reverse().map(l => `<li>${esc(l.text)}</li>`).join('')}</ol>`);
  }

  function moreSheet() {
    openSheet(`<h2>Tisch ${esc(view.code)}</h2>
      <div class="col">
        <button class="btn" data-do="rules">📖 Spielregeln</button>
        <button class="btn" data-do="log">📜 Spielverlauf</button>
        <button class="btn" data-do="share">🔗 Tisch-Link teilen</button>
        <button class="btn danger" data-do="leave">Tisch verlassen</button>
      </div>`);
  }

  function rulesSheet() {
    openSheet(`<h2>📖 So wird gespielt</h2>
      <div class="rules">
        <p><b>Ziel:</b> Stelle als Erste:r alle Burger der Speisekarte auf deinem Tablett fertig. 2–3 Personen: alle 4 Burger. 4–6 Personen: nur die ersten 3.</p>
        <p><b>Dein Zug:</b> Spiele 1, 2 oder 3 Karten aus deiner Hand – beliebig kombiniert:</p>
        <ul>
          <li><b>Zutat legen</b> – auf einen deiner Burger oder als neuen Burger. Gelegte Zutaten bleiben, wo sie sind.</li>
          <li><b>Abwerfen</b> – unerwünschte Karten in den Müll.</li>
          <li><b>Aktionskarte</b> ausspielen – danach kommt sie in den Müll.</li>
        </ul>
        <p>Aussetzen gilt nicht. Am Ende deines Zugs ziehst du automatisch auf 3 Karten nach. Ist der Stapel leer, wird der Müll umgedreht (ohne Mischen).</p>
        <p><b>Reihenfolge:</b> Burger werden immer in der Reihenfolge der Speisekarte gebaut (von links nach rechts, Brötchen zuletzt). Dasselbe Burger-Rezept darf nie doppelt auf deinem Tablett liegen – die App zeigt dir nur erlaubte Felder.</p>
        <p><b>Kombi-Karten:</b> „Salat + Tomate“ und „Cheese-Patty“ (Patty + Käse) zählen als zwei Zutaten. Die drei „fertigen Burger“ sind ein kompletter Burger auf einer Karte.</p>
        <h3>Aktionskarten</h3>
        <ul>
          <li>🔥 <b>Anbrennen:</b> Verbrenne einen beliebigen Burger oder Zutatenstapel (auch deinen eigenen).</li>
          <li>✋ <b>Klauen:</b> Nimm von einem beliebigen Tablett einen fertigen Burger oder die oberste Zutat (auch das Brötchen) und lege sie auf ein anderes Tablett.</li>
          <li>🗑️ <b>Mülltaucher:</b> Nimm eine Zutat aus dem Müll und lege sie sofort auf dein Tablett.</li>
          <li>🔄 <b>Falscher Tisch:</b> Alle Tabletts wandern gleichzeitig eine Person weiter.</li>
        </ul>
        <p><b>👯 Paar:</b> Hast du zwei identische Karten, darfst du beide abwerfen (zählt als 2 gespielte Karten) und blind eine Karte von einer anderen Person ziehen. Die Person startet ihren nächsten Zug mit einer Karte weniger.</p>
        <p><b>Profi-Tipp:</b> Verbrenne einen Burger mit einer Zutat, die du brauchst – und hol sie dir danach aus dem Müll zurück.</p>
      </div>`);
  }

  // ---------- Toast ----------

  let toastTimer;
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), ms || 2600);
  }

  // ---------- Zustand ----------

  function onView() {
    const g = game();
    if (!g || !myTurn()) {
      ui = freshUi();
      if (sheetKind === 'ctx' || sheetKind === 'lock') closeSheet();
    } else if (ui.sel && !findCard(ui.sel) && !ui.mode?.startsWith('dig')) {
      ui = freshUi();
    }
    if (g && myTurn() && g.pending && g.pending.type === 'dig' && !ui.dig && sheetKind !== 'lock') digSheet();
    if (g && !g.pending && sheetKind === 'lock') closeSheet();
    const mt = myTurn();
    if (mt && !wasMyTurn) {
      if (navigator.vibrate) navigator.vibrate(60);
      document.title = '🍳 Du bist dran! – Smash Burger';
    } else if (!mt) document.title = 'Smash Burger';
    wasMyTurn = mt;
    if (view.phase === 'game') history.replaceState(null, '', '?room=' + view.code);
    const snap = snapshot();
    render();
    const fx = freshFx();
    if (fx.length) playFx(fx[fx.length - 1], snap);
  }

  async function share() {
    const base = SERVER ? CONFIG.publicUrl : location.origin;
    const url = `${base}/?room=${view.code}`;
    const text = `Komm an meinen Smash-Burger-Tisch! Code: ${view.code}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Smash Burger', text, url }); return; } catch { /* abgebrochen */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Link kopiert!');
    } catch {
      toast(url);
    }
  }

  function joinByCode(code) {
    code = (code || '').trim().toUpperCase();
    if (code.length !== 4) return toast('Der Code hat 4 Buchstaben.');
    joinTable('/api/join', { code });
  }

  async function saveName() {
    const name = (document.getElementById('newName').value || '').trim();
    if (!name) return toast('Bitte gib einen Namen ein.');
    try {
      profile = (await post('/api/profile/update', withProfile({ name }))).profile;
      localStorage.setItem(LS_NAME, name);
      closeSheet();
      render();
    } catch (e) {
      if (!handleMissing(e)) toast(e.message);
    }
  }

  function markTutorialDone() {
    if (profile) profile.tutorialDone = true;
    post('/api/profile/update', withProfile({ tutorialDone: true })).catch(() => {});
  }

  // ---------- Eingaben ----------

  function onStack(p, s) {
    const g = game();
    if (!myTurn()) return;
    const key = `${p}:${s}`;
    const tg = targets();
    const stackIdx = s === 'new' ? 'new' : Number(s);
    if (ui.mode === 'place' && tg.has(key)) return send({ type: 'place', cardId: ui.sel, stack: stackIdx });
    if (ui.mode === 'digPick' && tg.has(key)) return send({ type: 'digPick', cardId: ui.dig, stack: stackIdx });
    if (ui.mode === 'burn' && tg.has(key)) {
      const st = g.players[p].tray[stackIdx];
      const owner = p === me() ? 'deinem eigenen Tablett' : `dem Tablett von ${g.players[p].name}`;
      openSheet(`<h2>🔥 Wirklich verbrennen?</h2>
        <div class="stack-preview">${st.map(c => miniCard(c, 30)).join('')}</div>
        <p>${esc(stackLabel(st, g.recipes))} auf ${esc(owner)} landet im Müll.</p>
        <div class="btn-row"><button class="btn primary" data-do="burnYes" data-p="${p}" data-s="${stackIdx}">Verbrennen!</button><button class="btn ghost" data-do="closeSheet">Abbrechen</button></div>`, 'ctx');
      return;
    }
    if (ui.mode === 'stealSrc' && tg.has(key)) {
      const opts = stealOptions(p, stackIdx);
      const st = g.players[p].tray[stackIdx];
      const from = { player: p, stack: stackIdx };
      if (opts.whole.length && opts.top.length) {
        openSheet(`<h2>✋ Was klaust du?</h2>
          <div class="col">
            <button class="btn primary" data-do="stealMode" data-m="whole">Den ganzen fertigen Burger</button>
            <button class="btn" data-do="stealMode" data-m="top">Nur die oberste Zutat (${esc(T[st[st.length - 1].t].name)})</button>
          </div>`, 'ctx');
        ui.steal = { from, mode: null };
        return;
      }
      ui.steal = { from, mode: opts.whole.length ? 'whole' : 'top' };
      ui.mode = 'stealDst';
      return render();
    }
    if (ui.mode === 'stealDst' && tg.has(key)) {
      return send({ type: 'steal', cardId: ui.sel, mode: ui.steal.mode, from: ui.steal.from, to: { player: p, stack: stackIdx } });
    }
  }

  function onCard(id) {
    const g = game();
    if (!myTurn()) {
      ui.sel = ui.sel === id ? null : id;
      return render();
    }
    if (g.pending) return digSheet();
    if (ui.sel !== id && tutBlocks('card', findCard(id).t)) return;
    if (ui.sel === id) {
      ui = freshUi();
      return render();
    }
    const c = findCard(id);
    ui = freshUi();
    ui.sel = id;
    if (T[c.t].kind === 'ing') ui.mode = 'place';
    render();
  }

  function onPlay() {
    const g = game();
    const c = findCard(ui.sel);
    if (!c) return;
    if (c.t === 'burn') {
      if (!g.players.some(p => p.tray.length)) return toast('Es gibt noch nichts zu verbrennen.');
      ui.mode = 'burn';
      return render();
    }
    if (c.t === 'steal') {
      if (!stealSources().length) return toast('Gerade gibt es nichts, was sich klauen lässt.');
      ui.mode = 'stealSrc';
      return render();
    }
    if (c.t === 'dig') return send({ type: 'dig', cardId: c.id });
    if (c.t === 'swap') {
      const n = g.players.length;
      const prev = g.players[(me() - 1 + n) % n].name;
      const next = g.players[(me() + 1) % n].name;
      openSheet(`<h2>🔄 Falscher Tisch!</h2>
        <p class="note">Alle Tabletts wandern gleichzeitig – inklusive aller Burger.</p>
        <div class="col">
          <button class="btn" data-do="swapDir" data-d="next">Weiter an die nächste Person<br><small>Du bekommst das Tablett von ${esc(prev)}</small></button>
          <button class="btn" data-do="swapDir" data-d="prev">Zurück an die vorherige Person<br><small>Du bekommst das Tablett von ${esc(next)}</small></button>
        </div>`, 'ctx');
    }
  }

  function onPair() {
    const g = game();
    const c = findCard(ui.sel);
    const twin = twinOf(c);
    if (!twin) return;
    openSheet(`<h2>👯 Paar abwerfen</h2>
      <p class="note">Du wirfst beide „${esc(T[c.t].name)}“ ab und ziehst blind eine Karte. Von wem?</p>
      <div class="col">${g.players.map((p, i) => i === me() || !p.handCount ? '' :
        `<button class="btn" data-do="pairTarget" data-i="${i}">${esc(p.name)} <small>(${p.handCount} Karten)</small></button>`).join('')}</div>`, 'ctx');
  }

  async function click(e) {
    const el = e.target.closest('[data-do]');
    if (!el) return;
    const d = el.dataset;
    if (['end', 'discard', 'play', 'pair', 'cancel'].includes(d.do) && tutBlocks('button', d.do)) return;
    switch (d.do) {
      case 'onboard': return createProfile();
      case 'create': return joinTable('/api/create');
      case 'join': return joinByCode(document.getElementById('code')?.value);
      case 'joinInvite': return joinByCode(roomParam());
      case 'friends': return friendsSheet();
      case 'quick': return startQuick();
      case 'cancelQuick': return cancelQuick();
      case 'tutorial':
        tutStep = null;
        return joinTable('/api/tutorial');
      case 'skipTutorial':
        markTutorialDone();
        return render();
      case 'coachNext':
        tutStep++;
        return render();
      case 'coachSkip':
        tutStep = TUT.length;
        return render();
      case 'editName': return nameSheet();
      case 'saveName': return saveName();
      case 'deleteProfile': return deleteProfile();
      case 'levels': return levelsSheet();
      case 'home': return leaveTable();
      case 'again':
        await leaveTable();
        return startQuick();
      case 'rules': return rulesSheet();
      case 'menu': return menuSheet();
      case 'trash': return trashSheet();
      case 'log': return logSheet();
      case 'more': return moreSheet();
      case 'share': return share();
      case 'closeSheet':
        if (sheetKind === 'ctx' && ui.steal && !ui.steal.mode) ui = freshUi();
        closeSheet();
        return render();
      case 'addBot': return send({ type: 'addBot' });
      case 'start': return send({ type: 'start' });
      case 'restart': return send({ type: 'restart' });
      case 'kick': return send({ type: 'kick', target: Number(d.i) });
      case 'leave':
        if (!confirm(game() && game().winner == null ? 'Tisch verlassen? Ein Bot spielt für dich weiter.' : 'Tisch verlassen?')) return;
        return leaveTable();
      case 'card': return onCard(Number(d.id));
      case 'stack': return onStack(Number(d.p), d.s);
      case 'cancel':
        ui = freshUi();
        return render();
      case 'end': return send({ type: 'end' });
      case 'discard': return send({ type: 'discard', cardId: ui.sel });
      case 'play': return onPlay();
      case 'pair': return onPair();
      case 'pairTarget': {
        const c = findCard(ui.sel);
        return send({ type: 'pair', cardIds: [c.id, twinOf(c).id], target: Number(d.i) });
      }
      case 'burnYes': return send({ type: 'burn', cardId: ui.sel, target: { player: Number(d.p), stack: Number(d.s) } });
      case 'stealMode':
        ui.steal.mode = d.m;
        ui.mode = 'stealDst';
        closeSheet();
        return render();
      case 'swapDir': return send({ type: 'swap', cardId: ui.sel, dir: d.d });
      case 'digOpen': return digSheet();
      case 'digPick':
        ui = freshUi();
        ui.dig = Number(d.id);
        ui.mode = 'digPick';
        closeSheet();
        return render();
    }
  }

  app.addEventListener('click', click);
  sheet.addEventListener('click', click);
  coachEl.addEventListener('click', click);
  const onEnter = e => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'code') joinByCode(e.target.value);
    if (e.target.id === 'name') createProfile();
    if (e.target.id === 'newName') saveName();
  };
  app.addEventListener('keydown', onEnter);
  sheet.addEventListener('keydown', onEnter);

  // Android back button (in the app): close sheets / cancel the move first, only then leave the app.
  const capApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if (capApp) {
    capApp.addListener('backButton', () => {
      if (sheetKind && sheetKind !== 'lock') {
        closeSheet();
        ui = freshUi();
        return render();
      }
      if (ui.sel || ui.mode) {
        ui = freshUi();
        return render();
      }
      capApp.minimizeApp();
    });
    // Reconnect when the app comes back from the background.
    capApp.addListener('resume', () => { if (session) connect(); });
  }

  wakeServer();
  loadProfile();
  if (session) connect();
  render();
})();
