// Smash Burger – Multiplayer-Server ohne Abhängigkeiten (HTTP + Server-Sent Events).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const E = require('./public/engine.js');
const Shop = require('./public/shop.js');
const Profiles = require('./profiles.js');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MAX_PLAYERS = 6;
const BOT_DELAY = 1100;
const AUTOPILOT_AFTER = 25000; // a disconnected player's turn is played by a bot after this
const ROOM_TTL = 6 * 60 * 60 * 1000;
const BOT_NAMES = ['Bot Bernd', 'Bot Paula', 'Bot Kalle', 'Bot Uschi', 'Bot Ronja', 'Bot Heinz', 'Bot Frieda'];
const TUTORIAL_BOT = 'Koch Kalle';
// Tutorial: the learner gets a hand that teaches the basics, then the first draws.
// Hands for the scripted tutorial (deal + first draws). The coach steps in public/app.js rely on exactly this order:
// you build a Cheeseburger, steal Kalle's patty, then burn his Chicken Burger.
const TUTORIAL_RIG = ['beef', 'cheese', 'salad', 'bun', 'tomato', 'steal', 'bun', 'burn', 'chicken'];
const TUTORIAL_BOT_RIG = ['beef', 'salad', 'tomato', 'chicken', 'bun', 'bun'];
// Attacks get animated on the clients; bots wait this much longer afterwards so nobody misses what happened.
const FX_PAUSE = 2600;
const EMOTE_SHOW_MS = 4000;
const EMOTE_COOLDOWN_MS = 2500;
const BOT_TRAYS = ['classic', 'wood', 'diner', 'mint', 'picnic'];
const TUTORIAL_BONUS_XP = 50;

// Matchmaking: level range starts narrow and widens the longer someone waits.
const MM_TICK = 1500;
const MM_TARGET = 4;
const MM_SMALL_GAME_AFTER = 20000; // start with 2–3 players after this
const MM_BOTS_AFTER = 35000; // nobody there: play with bots
const MM_RANGE = waited => 2 + 2 * Math.floor(waited / 10000);

const rooms = new Map();
const queue = new Map(); // profileId -> entry

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp', '.jpg': 'image/jpeg',
};

function newCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do c = Array.from({ length: 4 }, () => abc[crypto.randomInt(abc.length)]).join('');
  while (rooms.has(c));
  return c;
}

function newPlayer(name, isBot, profile, level) {
  return {
    pid: crypto.randomUUID(), token: crypto.randomBytes(16).toString('hex'),
    name, isBot, clients: new Set(), disconnectedAt: Date.now(),
    profile: profile || null,
    level: profile ? E.levelInfo(profile.xp).level : (level || 1),
  };
}

function newBot(room, level) {
  const used = new Set(room.players.map(p => p.name));
  const bot = newPlayer(BOT_NAMES.find(n => !used.has(n)) || 'Bot', true, null, level);
  bot.botTray = BOT_TRAYS[crypto.randomInt(BOT_TRAYS.length)];
  return bot;
}

function newRoom(kind, players) {
  const room = {
    code: newCode(), kind, players, hostPid: players[0].pid,
    state: null, timer: null, updated: Date.now(), results: null,
  };
  rooms.set(room.code, room);
  return room;
}

function cleanName(n) {
  return String(n || '').replace(/\s+/g, ' ').trim().slice(0, 18);
}

function roomView(room, idx) {
  const st = room.state;
  return {
    code: room.code,
    kind: room.kind,
    theme: st ? st.theme : room.theme || null,
    version: room.version || 0,
    phase: st ? 'game' : 'lobby',
    you: idx,
    host: room.players.findIndex(p => p.pid === room.hostPid),
    players: room.players.map(p => ({
      name: p.name, isBot: p.isBot, connected: p.isBot || p.clients.size > 0, level: p.level,
      tray: p.profile ? trayOf(p.profile) : p.botTray || 'classic',
      supporter: !!(p.profile && p.profile.supporter),
    })),
    game: st ? E.viewFor(st, idx) : null,
    result: room.results ? room.results[idx] : null,
    // Emotes of the last few seconds; clients show each one once (by id).
    emotes: (room.emotes || []).filter(e => Date.now() - e.t < EMOTE_SHOW_MS),
  };
}

function trayOf(prof) {
  const id = prof.equipped && prof.equipped.tray;
  return id && Shop.ownsTray(prof, id) ? id : 'classic';
}

// Hands out XP once when a game has a winner.
function settle(room) {
  const st = room.state;
  if (!st || st.winner == null || room.results) return;
  const n = room.players.length;
  room.results = room.players.map((p, i) => {
    if (p.isBot || !p.profile) return null;
    const prof = p.profile;
    const won = st.winner === i;
    const burgers = E.completedCount(st.players[i].tray, st.recipes);
    let xp = E.gameXp(won, burgers, n);
    let bonus = 0;
    if (room.kind === 'tutorial') {
      bonus = room.tutorialBonus ? TUTORIAL_BONUS_XP : 0;
      xp += bonus;
      prof.tutorialDone = true;
    }
    const coins = Shop.gameCoins(won, burgers) + (bonus ? 50 : 0);
    const before = E.levelInfo(prof.xp);
    prof.xp += xp;
    prof.coins += coins;
    prof.games += 1;
    if (won) prof.wins += 1;
    const after = E.levelInfo(prof.xp);
    p.level = after.level;
    Profiles.save(prof).catch(e => console.error('Profil speichern:', e.message));
    return { xp, coins, won, burgers, bonus, before, after, totalXp: prof.xp, doubled: false };
  });
}

// "Belohnung verdoppeln" after a game (rewarded video, or free for supporters): XP and coins once more.
function doubleResult(room, idx) {
  const r = room.results && room.results[idx];
  const p = room.players[idx];
  if (!r || r.doubled || !p.profile) return null;
  const prof = p.profile;
  prof.xp += r.xp;
  prof.coins += r.coins;
  r.doubled = true;
  r.xp *= 2;
  r.coins *= 2;
  r.after = E.levelInfo(prof.xp);
  r.totalXp = prof.xp;
  p.level = r.after.level;
  return r;
}

// Daily caps for rewarded videos, separately for shop coins and "Belohnung ×2"; returns false when used up.
function useAd(prof, kind) {
  const day = Profiles.today();
  if (prof.adDay !== day) { prof.adDay = day; prof.adCount = 0; prof.doubleCount = 0; }
  if (kind === 'double') {
    if (prof.doubleCount >= Shop.DOUBLES_PER_DAY) return false;
    prof.doubleCount += 1;
  } else {
    if (prof.adCount >= Shop.COIN_ADS_PER_DAY) return false;
    prof.adCount += 1;
  }
  return true;
}

function broadcast(room) {
  settle(room);
  room.updated = Date.now();
  room.version = (room.version || 0) + 1;
  room.players.forEach((p, i) => {
    if (!p.clients.size) return;
    const msg = `data: ${JSON.stringify(roomView(room, i))}\n\n`;
    for (const res of p.clients) res.write(msg);
  });
}

function needsAutopilot(room) {
  const st = room.state;
  if (!st || st.winner != null) return false;
  const cur = room.players[st.current];
  return cur.isBot || (!cur.clients.size && Date.now() - cur.disconnectedAt > AUTOPILOT_AFTER);
}

function schedule(room) {
  clearTimeout(room.timer);
  room.timerActive = false;
  if (!needsAutopilot(room)) return;
  room.timerActive = true;
  // The tutorial cook plays slower so there is time to read.
  let delay = room.kind === 'tutorial' ? BOT_DELAY * 1.6 : BOT_DELAY;
  const last = room.state.log[room.state.log.length - 1];
  if (last && last.fx && room.fxSeen !== last.n) {
    room.fxSeen = last.n;
    delay += FX_PAUSE;
  }
  room.timer = setTimeout(() => {
    room.timerActive = false;
    const st = room.state;
    if (!needsAutopilot(room)) return;
    const p = st.current;
    let r = E.act(st, p, E.botStep(st, p));
    if (!r.ok) {
      console.error('Bot-Fehler:', r.error);
      const hand = st.players[p].hand;
      r = st.played === 0 && hand.length ? E.act(st, p, { type: 'discard', cardId: hand[0].id }) : E.act(st, p, { type: 'end' });
    }
    broadcast(room);
    schedule(room);
  }, delay);
}

function startGame(room, opts) {
  room.results = null;
  room.state = E.newGame(room.players.map(p => p.name), opts && opts.start, null, opts);
}

// Picks up turns of players who dropped their connection, cleans up old tables.
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (now - room.updated > ROOM_TTL) {
      clearTimeout(room.timer);
      for (const p of room.players) for (const res of p.clients) res.end();
      rooms.delete(room.code);
      continue;
    }
    if (!room.timerActive && needsAutopilot(room)) schedule(room);
  }
}, 3000);

setInterval(() => {
  // A named event (not a comment) so the browser can notice when pings stop arriving.
  for (const room of rooms.values()) for (const p of room.players) for (const res of p.clients) res.write('event: ping\ndata: {}\n\n');
}, 10000);

// ---------- Matchmaking ----------

function matchmake() {
  const now = Date.now();
  for (const [id, e] of queue) {
    if (now - e.lastPoll > 15000) queue.delete(id); // closed the app while waiting
  }
  const waiting = [...queue.values()].filter(e => !e.match).sort((a, b) => a.since - b.since);
  for (const e of waiting) {
    if (e.match) continue;
    const waited = now - e.since;
    const range = MM_RANGE(waited);
    const group = waiting.filter(o => !o.match && Math.abs(o.level - e.level) <= range).slice(0, MM_TARGET);
    let take = null;
    if (group.length >= MM_TARGET) take = group;
    else if (waited >= MM_SMALL_GAME_AFTER && group.length >= 2) take = group;
    else if (waited >= MM_BOTS_AFTER) take = group;
    if (!take) continue;
    const players = take.map(o => newPlayer(o.profile.name, false, o.profile));
    const room = newRoom('quick', players);
    const avg = Math.round(players.reduce((s, p) => s + p.level, 0) / players.length);
    while (room.players.length < 3) room.players.push(newBot(room, Math.max(1, avg + crypto.randomInt(-1, 2))));
    startGame(room);
    take.forEach((o, i) => { o.match = { code: room.code, pid: players[i].pid, token: players[i].token }; });
    schedule(room);
  }
}
setInterval(matchmake, MM_TICK);

function queueStatus(e) {
  if (e.match) return { state: 'matched', ...e.match };
  const waited = Date.now() - e.since;
  const range = MM_RANGE(waited);
  const near = [...queue.values()].filter(o => !o.match && Math.abs(o.level - e.level) <= range).length;
  return { state: 'waiting', waited, range, near, botsIn: Math.max(0, Math.ceil((MM_BOTS_AFTER - waited) / 1000)) };
}

// ---------- HTTP ----------

function auth(body) {
  const room = rooms.get(String(body.code || '').toUpperCase());
  if (!room) return {};
  const idx = room.players.findIndex(p => p.pid === body.pid && p.token === body.token);
  return idx < 0 ? { room } : { room, idx, player: room.players[idx] };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', ch => {
      data += ch;
      if (data.length > 1e5) req.destroy();
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
  });
}

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function handleLobbyAction(room, idx, a) {
  const isHost = room.players[idx].pid === room.hostPid;
  switch (a.type) {
    case 'emote': {
      const me = room.players[idx];
      const emote = Shop.EMOTES.find(e => e.id === a.id);
      const allowed = emote && (me.profile ? Shop.ownsPack(me.profile, emote.pack) : emote.pack === 'free');
      if (!allowed) return 'Dieses Emote hast du noch nicht.';
      if (Date.now() - (me.lastEmote || 0) < EMOTE_COOLDOWN_MS) return 'Nicht so schnell!';
      me.lastEmote = Date.now();
      room.emoteSeq = (room.emoteSeq || 0) + 1;
      room.emotes = (room.emotes || []).filter(e => Date.now() - e.t < EMOTE_SHOW_MS).concat({ id: room.emoteSeq, p: idx, e: emote.id, t: Date.now() });
      setTimeout(() => rooms.has(room.code) && broadcast(room), EMOTE_SHOW_MS + 100); // let bubbles disappear
      return null;
    }
    case 'double': {
      const prof = room.players[idx].profile;
      const r = room.results && room.results[idx];
      if (!prof || !r) return 'Hier gibt es nichts zu verdoppeln.';
      if (r.doubled) return 'Schon verdoppelt.';
      if (!prof.supporter && !useAd(prof, 'double')) return `Du hast heute schon ${Shop.DOUBLES_PER_DAY}× verdoppelt – morgen geht es weiter.`;
      doubleResult(room, idx);
      Profiles.save(prof).catch(e => console.error('Profil speichern:', e.message));
      return null;
    }
    case 'addBot': {
      if (!isHost) return 'Nur der Gastgeber kann Bots hinzufügen.';
      if (room.state) return 'Das Spiel läuft schon.';
      if (room.players.length >= MAX_PLAYERS) return 'Der Tisch ist voll (max. 6).';
      room.players.push(newBot(room, room.players[idx].level));
      return null;
    }
    case 'kick': {
      if (!isHost) return 'Nur der Gastgeber kann Leute entfernen.';
      if (room.state) return 'Während des Spiels geht das nicht.';
      const t = room.players[a.target];
      if (!t || t.pid === room.hostPid) return 'Ungültig.';
      for (const res of t.clients) { res.write('event: gone\ndata: {}\n\n'); res.end(); }
      room.players.splice(a.target, 1);
      return null;
    }
    case 'start': {
      if (!isHost) return 'Nur der Gastgeber kann starten.';
      if (room.state) return 'Das Spiel läuft schon.';
      if (room.players.length < 2) return 'Ihr braucht mindestens 2 Leute (oder einen Bot).';
      startGame(room, { theme: room.theme });
      return null;
    }
    case 'setTheme': {
      // Only the host picks, and only a theme pack they bought. Everyone at the table plays it.
      if (!isHost) return 'Nur der Gastgeber wählt das Thema.';
      if (room.state) return 'Das Spiel läuft schon.';
      if (a.theme && !(E.THEMES[a.theme] && Shop.ownsTheme(room.players[idx].profile, a.theme))) return 'Dieses Themen-Pack hast du noch nicht.';
      room.theme = a.theme || null;
      return null;
    }
    case 'restart': {
      if (room.kind !== 'private') return 'Starte ein neues Spiel über das Hauptmenü.';
      if (!isHost) return 'Nur der Gastgeber kann neu starten.';
      if (room.state && room.state.winner == null) return 'Das Spiel läuft noch.';
      room.state = null;
      room.results = null;
      room.players = room.players.filter(p => p.isBot || p.clients.size || p.pid === room.hostPid);
      return null;
    }
    case 'leave': {
      const me = room.players[idx];
      for (const res of me.clients) res.end();
      me.clients.clear();
      if (room.state && room.state.winner == null) {
        me.isBot = true;
        me.name = `${me.name} (Bot)`;
        room.state.players[idx].name = me.name;
      } else if (room.state && room.kind !== 'private') {
        me.left = true; // quick match / tutorial over: others keep their result screen
      } else {
        room.players.splice(idx, 1);
        if (room.state) { room.state = null; room.results = null; }
      }
      const next = room.players.find(p => !p.isBot && !p.left);
      if (!next) { clearTimeout(room.timer); rooms.delete(room.code); return null; }
      if (me.pid === room.hostPid) room.hostPid = next.pid;
      return null;
    }
  }
  return undefined;
}

async function profileFrom(body) {
  return Profiles.auth(body.profileId, body.profileToken);
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/events' && req.method === 'GET') {
    const { room, idx, player } = auth(Object.fromEntries(url.searchParams));
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    if (!player) { res.end('event: gone\ndata: {}\n\n'); return; }
    res.write('retry: 2000\n\n');
    player.clients.add(res);
    res.write(`data: ${JSON.stringify(roomView(room, idx))}\n\n`);
    broadcast(room);
    req.on('close', () => {
      player.clients.delete(res);
      if (!player.clients.size) {
        player.disconnectedAt = Date.now();
        if (rooms.has(room.code)) broadcast(room);
      }
    });
    return;
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'Methode nicht erlaubt' });
  let body;
  try { body = await readBody(req); } catch { return json(res, 400, { error: 'Ungültige Anfrage' }); }

  // --- Profil ---
  if (url.pathname === '/api/profile/create') {
    const name = cleanName(body.name);
    if (!name) return json(res, 400, { error: 'Bitte gib deinen Namen ein.' });
    const { profile, token } = await Profiles.create(name);
    return json(res, 200, { profile: Profiles.publicView(profile), token });
  }
  if (url.pathname === '/api/profile/get') {
    const prof = await profileFrom(body);
    if (!prof) return json(res, 404, { error: 'Profil nicht gefunden.', missing: true });
    return json(res, 200, { profile: Profiles.publicView(prof) });
  }
  if (url.pathname === '/api/profile/update') {
    const prof = await profileFrom(body);
    if (!prof) return json(res, 404, { error: 'Profil nicht gefunden.', missing: true });
    if (body.name != null) {
      const name = cleanName(body.name);
      if (!name) return json(res, 400, { error: 'Bitte gib deinen Namen ein.' });
      prof.name = name;
    }
    if (body.tutorialDone === true) prof.tutorialDone = true;
    await Profiles.save(prof);
    return json(res, 200, { profile: Profiles.publicView(prof) });
  }
  // --- Shop ---
  if (url.pathname.startsWith('/api/shop/') || url.pathname === '/api/iap/grant' || url.pathname === '/api/ads/coins') {
    const prof = await profileFrom(body);
    if (!prof) return json(res, 404, { error: 'Profil nicht gefunden.', missing: true });
    const reply = () => json(res, 200, { profile: Profiles.publicView(prof) });

    if (url.pathname === '/api/shop/buy') {
      const [kind, id] = String(body.item || '').split(':');
      const item = kind === 'tray' ? Shop.trayById(id) : kind === 'pack' ? Shop.packById(id) : null;
      if (!item || item.supporter || item.price <= 0) return json(res, 400, { error: 'Das gibt es nicht zu kaufen.' });
      const key = body.item;
      if (prof.owned.includes(key)) return json(res, 400, { error: 'Das hast du schon.' });
      if (prof.coins < item.price) return json(res, 400, { error: 'Dafür reichen deine Münzen noch nicht.' });
      prof.coins -= item.price;
      prof.owned = prof.owned.concat(key);
      if (kind === 'tray') prof.equipped = { ...prof.equipped, tray: id };
      await Profiles.save(prof);
      return reply();
    }
    if (url.pathname === '/api/shop/equip') {
      if (!Shop.ownsTray(prof, body.tray)) return json(res, 400, { error: 'Dieses Tablett hast du noch nicht.' });
      prof.equipped = { ...prof.equipped, tray: body.tray };
      await Profiles.save(prof);
      return reply();
    }
    if (url.pathname === '/api/ads/coins') {
      if (!useAd(prof, 'coins')) return json(res, 400, { error: 'Für heute sind alle Gratis-Videos aufgebraucht – morgen geht es weiter.' });
      prof.coins += Shop.AD_COINS;
      await Profiles.save(prof);
      return reply();
    }
    if (url.pathname === '/api/iap/grant') {
      // Google Play purchase from the Android app. Each purchase token is redeemed only once.
      const product = Shop.iapById(body.product);
      const token = String(body.purchaseToken || '');
      if (!product || token.length < 10 || token.length > 4000) return json(res, 400, { error: 'Ungültiger Kauf.' });
      const fresh = await Profiles.claimPurchase(token, prof.id, product.id);
      const theme = product.theme && Shop.themeItem(product.theme);
      if (fresh) {
        prof.coins += product.coins;
        if (product.supporter) prof.supporter = true;
        if (theme && !prof.owned.includes(theme)) prof.owned = prof.owned.concat(theme);
        await Profiles.save(prof);
      } else if ((product.supporter && !prof.supporter) || (theme && !prof.owned.includes(theme))) {
        // Restored on a new profile (e.g. app reinstalled): unlocks come back, the coins only came once.
        if (product.supporter) prof.supporter = true;
        if (theme && !prof.owned.includes(theme)) prof.owned = prof.owned.concat(theme);
        await Profiles.save(prof);
      }
      return json(res, 200, { profile: Profiles.publicView(prof), granted: fresh });
    }
    return json(res, 404, { error: 'Nicht gefunden' });
  }

  if (url.pathname === '/api/profile/delete') {
    const prof = await profileFrom(body);
    if (!prof) return json(res, 404, { error: 'Profil nicht gefunden.', missing: true });
    queue.delete(prof.id);
    // Tables keep running; the player just no longer earns XP there.
    for (const room of rooms.values()) for (const p of room.players) if (p.profile && p.profile.id === prof.id) p.profile = null;
    await Profiles.remove(prof);
    return json(res, 200, { ok: true });
  }

  // Everything below needs a profile.
  const prof = await profileFrom(body);

  if (url.pathname === '/api/create') {
    if (!prof) return json(res, 401, { error: 'Bitte melde dich neu an.', missing: true });
    const p = newPlayer(prof.name, false, prof);
    const room = newRoom('private', [p]);
    return json(res, 200, { code: room.code, pid: p.pid, token: p.token });
  }

  if (url.pathname === '/api/join') {
    if (!prof) return json(res, 401, { error: 'Bitte melde dich neu an.', missing: true });
    const room = rooms.get(String(body.code || '').toUpperCase().trim());
    if (!room || room.kind !== 'private') return json(res, 404, { error: 'Diesen Tisch gibt es nicht.' });
    if (room.state) return json(res, 409, { error: 'An diesem Tisch läuft schon ein Spiel.' });
    if (room.players.length >= MAX_PLAYERS) return json(res, 409, { error: 'Der Tisch ist voll (max. 6).' });
    const mine = room.players.find(p => p.profile && p.profile.id === prof.id);
    if (mine) return json(res, 200, { code: room.code, pid: mine.pid, token: mine.token });
    let name = prof.name;
    if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) name = `${name} ${room.players.length + 1}`;
    const p = newPlayer(name, false, prof);
    room.players.push(p);
    broadcast(room);
    return json(res, 200, { code: room.code, pid: p.pid, token: p.token });
  }

  if (url.pathname === '/api/tutorial') {
    if (!prof) return json(res, 401, { error: 'Bitte melde dich neu an.', missing: true });
    const p = newPlayer(prof.name, false, prof);
    const room = newRoom('tutorial', [p, newPlayer(TUTORIAL_BOT, true, null, 1)]);
    room.tutorialBonus = !prof.tutorialDone; // the bonus is paid for the first finished tutorial only
    startGame(room, { start: 0, rig: { 0: TUTORIAL_RIG.slice(), 1: TUTORIAL_BOT_RIG.slice() }, gentle: [1] });
    return json(res, 200, { code: room.code, pid: p.pid, token: p.token });
  }

  if (url.pathname === '/api/quick/join') {
    if (!prof) return json(res, 401, { error: 'Bitte melde dich neu an.', missing: true });
    let e = queue.get(prof.id);
    if (!e || e.match) {
      e = { profile: prof, level: E.levelInfo(prof.xp).level, since: Date.now(), lastPoll: Date.now(), match: null };
      queue.set(prof.id, e);
    }
    return json(res, 200, queueStatus(e));
  }
  if (url.pathname === '/api/quick/status') {
    if (!prof) return json(res, 401, { error: 'Bitte melde dich neu an.', missing: true });
    const e = queue.get(prof.id);
    if (!e) return json(res, 200, { state: 'none' });
    e.lastPoll = Date.now();
    const st = queueStatus(e);
    if (e.match) queue.delete(prof.id);
    return json(res, 200, st);
  }
  if (url.pathname === '/api/quick/leave') {
    if (prof) {
      const e = queue.get(prof.id);
      if (e && !e.match) queue.delete(prof.id);
    }
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/action') {
    const { room, idx, player } = auth(body);
    if (!player) return json(res, 403, { error: 'Du sitzt nicht an diesem Tisch.' });
    const a = body.action || {};
    let err = handleLobbyAction(room, idx, a);
    if (err === undefined) {
      if (!room.state) err = 'Das Spiel hat noch nicht begonnen.';
      else {
        const r = E.act(room.state, idx, a);
        err = r.ok ? null : r.error;
      }
    }
    if (err) return json(res, 400, { error: err, view: roomView(room, idx) });
    if (rooms.has(room.code)) {
      broadcast(room);
      schedule(room);
    }
    // Send the caller's new view directly, so a stalled live connection can't leave them on an old state.
    const still = rooms.has(room.code) ? room.players.indexOf(player) : -1;
    return json(res, 200, { ok: true, view: still >= 0 ? roomView(room, still) : null });
  }

  json(res, 404, { error: 'Nicht gefunden' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    // The Android app loads its UI locally and talks to this server cross-origin.
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' });
      return res.end();
    }
    if (url.pathname === '/api/health') return json(res, 200, { ok: true });
    handleApi(req, res, url).catch(e => {
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: 'Serverfehler' });
    });
    return;
  }
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (url.pathname === '/') file = path.join(PUBLIC, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Nicht gefunden'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🍔 Smash Burger läuft auf http://localhost:${PORT}`);
  console.log(`   Profile: ${Profiles.usingSupabase ? 'Supabase' : 'lokale Datei data/profiles.json'}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal && !ni.address.startsWith('169.254')) {
        console.log(`   Im WLAN:  http://${ni.address}:${PORT}`);
      }
    }
  }
});
