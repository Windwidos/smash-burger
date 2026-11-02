/* Smash Burger – Spiellogik. Läuft auf dem Server (autoritativ) und im Browser (für Hervorhebungen). */
(function (root, factory) {
  const E = factory();
  if (typeof module === 'object' && module.exports) module.exports = E;
  else root.SmashEngine = E;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_PLAYS = 3;
  const HAND_SIZE = 3;

  const LAYERS = {
    bun: 'Brötchen', tomato: 'Tomate', salad: 'Salat',
    cheese: 'Käse', beef: 'Beef-Patty', chicken: 'Chicken-Patty',
    // Themen-Packs
    jalapeno: 'Jalapeños', guacamole: 'Guacamole', nachos: 'Nachos',
    pineapple: 'Ananas', ham: 'Schinken',
    bacon: 'Bacon', bbq: 'BBQ-Soße', onionrings: 'Zwiebelringe',
    pumpkin: 'Kürbis', monstersauce: 'Monster-Soße',
    camembert: 'Camembert', cranberry: 'Preiselbeeren', roestzwiebeln: 'Röstzwiebeln',
  };

  // Ingredient layers are listed bottom → top, i.e. in the order they are laid on the tray.
  const TYPES = {
    bun:         { kind: 'ing', layers: ['bun'], name: 'Brötchen', count: 8 },
    tomato:      { kind: 'ing', layers: ['tomato'], name: 'Tomate', count: 6 },
    salad:       { kind: 'ing', layers: ['salad'], name: 'Salat', count: 6 },
    cheese:      { kind: 'ing', layers: ['cheese'], name: 'Käse', count: 6 },
    beef:        { kind: 'ing', layers: ['beef'], name: 'Beef-Patty', count: 6 },
    chicken:     { kind: 'ing', layers: ['chicken'], name: 'Chicken-Patty', count: 2 },
    saladTomato: { kind: 'ing', layers: ['salad', 'tomato'], name: 'Salat + Tomate', count: 3 },
    beefCheese:  { kind: 'ing', layers: ['beef', 'cheese'], name: 'Cheese-Patty', count: 3 },
    fullCheese:  { kind: 'ing', layers: ['beef', 'cheese', 'bun'], name: 'Fertiger Cheeseburger', count: 1 },
    fullChicken: { kind: 'ing', layers: ['salad', 'tomato', 'chicken', 'bun'], name: 'Fertiger Chicken Burger', count: 1 },
    fullDeluxe:  { kind: 'ing', layers: ['beef', 'cheese', 'salad', 'tomato', 'bun'], name: 'Fertiger Deluxe Burger', count: 1 },
    burn:  { kind: 'act', name: 'Anbrennen', count: 3, desc: 'Verbrenne einen beliebigen Burger oder Zutatenstapel – ab in den Müll.' },
    steal: { kind: 'act', name: 'Klauen', count: 3, desc: 'Klaue einen fertigen Burger oder die oberste Zutat und lege sie auf ein anderes Tablett.' },
    dig:   { kind: 'act', name: 'Mülltaucher', count: 3, desc: 'Nimm dir eine Zutat aus dem Müll und verwende sie sofort.' },
    swap:  { kind: 'act', name: 'Falscher Tisch', count: 2, desc: 'Alle Tabletts wandern gleichzeitig eine Person weiter.' },
    // Themen-Packs: these cards are only shuffled in when a table plays that theme.
    jalapeno:      { kind: 'ing', layers: ['jalapeno'], name: 'Jalapeños', count: 5, theme: 'mexico' },
    guacamole:     { kind: 'ing', layers: ['guacamole'], name: 'Guacamole', count: 5, theme: 'mexico' },
    nachos:        { kind: 'ing', layers: ['nachos'], name: 'Nachos', count: 5, theme: 'mexico' },
    pineapple:     { kind: 'ing', layers: ['pineapple'], name: 'Ananas', count: 6, theme: 'hawaii' },
    ham:           { kind: 'ing', layers: ['ham'], name: 'Schinken', count: 5, theme: 'hawaii' },
    bacon:         { kind: 'ing', layers: ['bacon'], name: 'Bacon', count: 5, theme: 'western' },
    bbq:           { kind: 'ing', layers: ['bbq'], name: 'BBQ-Soße', count: 6, theme: 'western' },
    onionrings:    { kind: 'ing', layers: ['onionrings'], name: 'Zwiebelringe', count: 5, theme: 'western' },
    pumpkin:       { kind: 'ing', layers: ['pumpkin'], name: 'Kürbis', count: 5, theme: 'halloween' },
    monstersauce:  { kind: 'ing', layers: ['monstersauce'], name: 'Monster-Soße', count: 5, theme: 'halloween' },
    camembert:     { kind: 'ing', layers: ['camembert'], name: 'Camembert', count: 6, theme: 'winter' },
    cranberry:     { kind: 'ing', layers: ['cranberry'], name: 'Preiselbeeren', count: 5, theme: 'winter' },
    roestzwiebeln: { kind: 'ing', layers: ['roestzwiebeln'], name: 'Röstzwiebeln', count: 5, theme: 'winter' },
  };

  // Indices 0–3 are the classic menu; themed specials follow. Clients and server share these indices.
  const RECIPES = [
    { id: 'cheese',  name: 'Cheeseburger',   layers: ['beef', 'cheese', 'bun'] },
    { id: 'chicken', name: 'Chicken Burger', layers: ['salad', 'tomato', 'chicken', 'bun'] },
    { id: 'deluxe',  name: 'Deluxe Burger',  layers: ['beef', 'cheese', 'salad', 'tomato', 'bun'] },
    { id: 'classic', name: 'Classic Burger', layers: ['salad', 'tomato', 'beef', 'bun'] },
    { id: 'diablo',      name: 'El Diablo',        theme: 'mexico',    layers: ['beef', 'cheese', 'jalapeno', 'bun'] },
    { id: 'guaca',       name: 'Guaca-Chicken',    theme: 'mexico',    layers: ['chicken', 'guacamole', 'nachos', 'bun'] },
    { id: 'hawaii',      name: 'Hawaii Classic',   theme: 'hawaii',    layers: ['beef', 'cheese', 'pineapple', 'bun'] },
    { id: 'aloha',       name: 'Aloha Chicken',    theme: 'hawaii',    layers: ['chicken', 'ham', 'pineapple', 'bun'] },
    { id: 'cowboy',      name: 'Cowboy',           theme: 'western',   layers: ['beef', 'bacon', 'bbq', 'bun'] },
    { id: 'rodeo',       name: 'Rodeo',            theme: 'western',   layers: ['beef', 'cheese', 'onionrings', 'bbq', 'bun'] },
    { id: 'pumpkin',     name: 'Kürbis-Kracher',   theme: 'halloween', layers: ['chicken', 'pumpkin', 'salad', 'bun'] },
    { id: 'monster',     name: 'Monster-Burger',   theme: 'halloween', layers: ['beef', 'monstersauce', 'cheese', 'bun'] },
    { id: 'huette',      name: 'Hüttenzauber',     theme: 'winter',    layers: ['chicken', 'camembert', 'cranberry', 'bun'] },
    { id: 'holzfaeller', name: 'Holzfäller',       theme: 'winter',    layers: ['beef', 'roestzwiebeln', 'camembert', 'bun'] },
  ];

  // extra: additional base cards so the specials stay buildable (e.g. only 2 chicken patties in the base game).
  const THEMES = {
    mexico:    { name: 'Fiesta Mexicana', icon: '🌮', extra: { chicken: 2 } },
    hawaii:    { name: 'Aloha Hawaii',    icon: '🌺', extra: { chicken: 2 } },
    western:   { name: 'Wilder Westen',   icon: '🤠', extra: { beef: 2 } },
    halloween: { name: 'Gruselküche',     icon: '🎃', extra: { chicken: 2 } },
    winter:    { name: 'Winterzauber',    icon: '❄️', extra: { chicken: 2 } },
  };

  const themeRecipes = theme => RECIPES.map((r, i) => (r.theme === theme ? i : -1)).filter(i => i >= 0);

  // Classic tables always play the same menu. Themed tables: both specials plus randomly drawn classics,
  // so every round has a different menu.
  function pickRecipes(n, theme, rng) {
    const size = n <= 3 ? 4 : 3;
    if (!theme || !THEMES[theme]) return n <= 3 ? [0, 1, 2, 3] : [0, 1, 2];
    const classics = shuffle([0, 1, 2, 3], rng).slice(0, size - 2).sort((a, b) => a - b);
    return classics.concat(themeRecipes(theme));
  }

  // ---------- Burger-Regeln ----------

  function layersOf(cards) {
    const out = [];
    for (const c of cards) out.push(...TYPES[c.t].layers);
    return out;
  }

  function isPrefix(a, r) {
    if (a.length > r.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== r[i]) return false;
    return true;
  }

  function candidates(stack, recipes) {
    const l = layersOf(stack);
    return recipes.filter(i => isPrefix(l, RECIPES[i].layers));
  }

  function completeRecipe(stack, recipes) {
    const l = layersOf(stack);
    for (const i of recipes) {
      const r = RECIPES[i].layers;
      if (l.length === r.length && isPrefix(l, r)) return i;
    }
    return -1;
  }

  // Every stack must be the start of a menu burger, and no burger may appear twice:
  // there has to be a one-to-one assignment of stacks to recipes.
  function trayValid(tray, recipes) {
    if (tray.length > recipes.length) return false;
    const cands = tray.map(s => candidates(s, recipes));
    if (cands.some(c => !c.length)) return false;
    const order = cands.map((_, i) => i).sort((a, b) => cands[a].length - cands[b].length);
    const used = new Set();
    function bt(k) {
      if (k === order.length) return true;
      for (const r of cands[order[k]]) {
        if (used.has(r)) continue;
        used.add(r);
        if (bt(k + 1)) return true;
        used.delete(r);
      }
      return false;
    }
    return bt(0);
  }

  // Which recipe each stack is working towards (-1 if none); used to tick off the menu.
  function assignRecipes(tray, recipes) {
    const cands = tray.map(s => candidates(s, recipes));
    const res = tray.map(() => -1);
    const used = new Set();
    function bt(k) {
      if (k === tray.length) return true;
      for (const r of cands[k]) {
        if (used.has(r)) continue;
        used.add(r);
        res[k] = r;
        if (bt(k + 1)) return true;
        used.delete(r);
      }
      res[k] = -1;
      return false;
    }
    bt(0);
    return res;
  }

  function withAdded(tray, cards, target) {
    const t = tray.map(s => s.slice());
    if (target === 'new') t.push(cards.slice());
    else t[target].push(...cards);
    return t;
  }

  function placeTargets(tray, cards, recipes) {
    const out = [];
    for (let i = 0; i < tray.length; i++) if (trayValid(withAdded(tray, cards, i), recipes)) out.push(i);
    if (trayValid(withAdded(tray, cards, 'new'), recipes)) out.push('new');
    return out;
  }

  function completedCount(tray, recipes) {
    return tray.filter(s => completeRecipe(s, recipes) >= 0).length;
  }

  function trayDone(tray, recipes) {
    return recipes.every(r => tray.some(s => completeRecipe(s, [r]) === r));
  }

  // ---------- Spielablauf ----------

  function makeDeck(theme) {
    const d = [];
    let id = 1;
    const extra = (THEMES[theme] && THEMES[theme].extra) || {};
    for (const [t, def] of Object.entries(TYPES)) {
      if (def.theme && def.theme !== theme) continue;
      for (let i = 0; i < def.count + (extra[t] || 0); i++) d.push({ id: id++, t });
    }
    return d;
  }

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- Level ----------

  const TITLES = [
    [1, 'Tellerwäscher:in'], [3, 'Küchenhilfe'], [6, 'Burgerbrater:in'], [10, 'Grillmeister:in'],
    [15, 'Küchenchef:in'], [22, 'Sterneköch:in'], [30, 'Burger-Legende'],
  ];

  function xpToNext(level) {
    return 100 + (level - 1) * 25;
  }

  function levelInfo(xp) {
    let level = 1, rest = xp || 0;
    while (rest >= xpToNext(level)) { rest -= xpToNext(level); level++; }
    let title = TITLES[0][1];
    for (const [l, t] of TITLES) if (level >= l) title = t;
    return { level, into: rest, need: xpToNext(level), title };
  }

  // XP for one finished game: everybody gets something, finished burgers and the win count extra.
  function gameXp(won, burgers, players) {
    return 20 + burgers * 15 + (won ? 40 + 10 * (players - 2) : 0);
  }

  // opts.rig: { playerIdx: [card types to deal/draw first] } (tutorial), opts.gentle: bot indices that never attack.
  function newGame(names, startIdx, rng, opts) {
    rng = rng || Math.random;
    opts = opts || {};
    const n = names.length;
    const theme = THEMES[opts.theme] ? opts.theme : null;
    const s = {
      theme,
      recipes: pickRecipes(n, theme, rng),
      players: names.map(name => ({ name, hand: [], tray: [] })),
      deck: shuffle(makeDeck(theme), rng),
      trash: [],
      current: startIdx == null ? Math.floor(rng() * n) : startIdx,
      played: 0,
      pending: null,
      winner: null,
      turn: 1,
      log: [],
      logSeq: 0,
      rig: opts.rig || null,
      gentle: opts.gentle || [],
      skill: opts.skill || null,
      // { seat: fromTurn } – from that turn on the bot plays only one card per turn (tutorial: Kalle lets you win).
      slow: opts.slow || null,
      // Seats that never use the Mülltaucher (tutorial: the bun in the trash is meant for you).
      noDig: opts.noDig || [],
    };
    for (let k = 0; k < HAND_SIZE; k++) s.players.forEach((p, i) => p.hand.push(drawFor(s, i)));
    log(s, `${s.players[s.current].name} beginnt. Guten Appetit!`);
    return s;
  }

  // fx describes attacks precisely (who, from where, to where) so clients can animate them.
  function log(s, text, fx) {
    s.log.push(fx ? { n: ++s.logSeq, text, fx } : { n: ++s.logSeq, text });
    if (s.log.length > 80) s.log.shift();
  }

  function draw(s) {
    if (!s.deck.length) {
      if (!s.trash.length) return null;
      // Flip the trash pile without shuffling: the oldest discard ends up on top.
      s.deck = s.trash.reverse();
      s.trash = [];
      log(s, 'Nachziehstapel leer – der Müll wird umgedreht und ist wie neu!');
    }
    return s.deck.pop();
  }

  // Rigged draws (tutorial) pull a card of the wanted type out of the deck, otherwise a normal draw.
  function drawFor(s, p) {
    const want = s.rig && s.rig[p];
    while (want && want.length) {
      const t = want.shift();
      const i = s.deck.findIndex(c => c.t === t);
      if (i >= 0) return s.deck.splice(i, 1)[0];
    }
    return draw(s);
  }

  function endTurn(s) {
    const me = s.players[s.current];
    while (me.hand.length < HAND_SIZE) {
      const c = drawFor(s, s.current);
      if (!c) break;
      me.hand.push(c);
    }
    s.current = (s.current + 1) % s.players.length;
    s.played = 0;
    s.turn++;
  }

  function checkWin(s) {
    const n = s.players.length;
    for (let k = 0; k < n; k++) {
      const i = (s.current + k) % n;
      if (trayDone(s.players[i].tray, s.recipes)) {
        s.winner = i;
        log(s, `🍔 ${s.players[i].name} hat alle Burger fertig und gewinnt!`);
        return true;
      }
    }
    return false;
  }

  function afterPlay(s) {
    if (checkWin(s)) return;
    const me = s.players[s.current];
    if (!s.pending && (s.played >= MAX_PLAYS || !me.hand.length)) endTurn(s);
  }

  function digOptions(s, p) {
    const tray = s.players[p].tray;
    return s.trash.filter(c => TYPES[c.t].kind === 'ing' && placeTargets(tray, [c], s.recipes).length);
  }

  function stackLabel(stack, recipes) {
    const r = completeRecipe(stack, recipes);
    if (r >= 0) return `den fertigen ${RECIPES[r].name}`;
    return stack.length === 1 ? `${TYPES[stack[0].t].name}` : `einen halben Burger (${stack.length} Karten)`;
  }

  function normTarget(t, tray) {
    if (t === 'new') return 'new';
    const i = Number(t);
    return Number.isInteger(i) && i >= 0 && i < tray.length ? i : null;
  }

  const ok = () => ({ ok: true });
  const fail = error => ({ ok: false, error });

  function act(s, p, a, rng) {
    rng = rng || Math.random;
    if (!a || typeof a !== 'object') return fail('Ungültige Aktion.');
    if (s.winner != null) return fail('Das Spiel ist vorbei.');
    if (p !== s.current) return fail('Du bist nicht am Zug.');
    const me = s.players[p];
    const R = s.recipes;

    if (s.pending) {
      if (s.pending.type !== 'dig' || a.type !== 'digPick') return fail('Verwende zuerst die Karte aus dem Müll.');
      const ti = s.trash.findIndex(c => c.id === a.cardId);
      if (ti < 0 || TYPES[s.trash[ti].t].kind !== 'ing') return fail('Diese Zutat liegt nicht im Müll.');
      const card = s.trash[ti];
      const tg = normTarget(a.stack, me.tray);
      if (tg == null || !placeTargets(me.tray, [card], R).includes(tg)) return fail('Da passt die Zutat nicht hin.');
      s.trash.splice(ti, 1);
      me.tray = withAdded(me.tray, [card], tg);
      s.pending = null;
      log(s, `🗑️ ${me.name} fischt ${TYPES[card.t].name} aus dem Müll und legt es aufs Tablett.`,
        { k: 'dig', by: p, cards: [card.t], to: { player: p, stack: tg === 'new' ? me.tray.length - 1 : tg } });
      afterPlay(s);
      return ok();
    }

    if (a.type === 'end') {
      if (s.played === 0 && me.hand.length) return fail('Aussetzen gilt nicht – spiel mindestens 1 Karte.');
      endTurn(s);
      return ok();
    }

    if (a.type === 'pair') {
      if (s.played + 2 > MAX_PLAYS) return fail('Für ein Paar brauchst du noch 2 freie Spielzüge.');
      const ids = Array.isArray(a.cardIds) ? a.cardIds : [];
      const cards = ids.map(id => me.hand.find(c => c.id === id));
      if (cards.length !== 2 || !cards[0] || !cards[1] || ids[0] === ids[1] || cards[0].t !== cards[1].t) {
        return fail('Dafür brauchst du zwei identische Karten.');
      }
      const victim = s.players[a.target];
      if (!victim || a.target === p) return fail('Wähle eine andere Person.');
      if (!victim.hand.length) return fail(`${victim.name} hat keine Karten.`);
      me.hand = me.hand.filter(c => !ids.includes(c.id));
      s.trash.push(...cards);
      const stolen = victim.hand.splice(Math.floor(rng() * victim.hand.length), 1)[0];
      me.hand.push(stolen);
      s.played += 2;
      log(s, `🃏 ${me.name} wirft zwei Mal ${TYPES[cards[0].t].name} ab und zieht blind eine Karte von ${victim.name}.`,
        { k: 'pair', by: p, victim: a.target, cards: [cards[0].t] });
      afterPlay(s);
      return ok();
    }

    if (s.played >= MAX_PLAYS) return fail('Du hast schon 3 Karten gespielt.');
    const hi = me.hand.findIndex(c => c.id === a.cardId);
    if (hi < 0) return fail('Die Karte ist nicht auf deiner Hand.');
    const card = me.hand[hi];
    const def = TYPES[card.t];

    switch (a.type) {
      case 'place': {
        if (def.kind !== 'ing') return fail('Das ist keine Zutat.');
        const tg = normTarget(a.stack, me.tray);
        if (tg == null || !placeTargets(me.tray, [card], R).includes(tg)) return fail('Da passt die Zutat nicht hin.');
        me.hand.splice(hi, 1);
        me.tray = withAdded(me.tray, [card], tg);
        const st = me.tray[tg === 'new' ? me.tray.length - 1 : tg];
        const done = completeRecipe(st, R);
        log(s, done >= 0
          ? `✅ ${me.name} stellt einen ${RECIPES[done].name} fertig!`
          : `${me.name} legt ${def.name}${tg === 'new' ? ' als neuen Burger' : ''}.`);
        break;
      }
      case 'discard': {
        me.hand.splice(hi, 1);
        s.trash.push(card);
        log(s, `${me.name} wirft ${def.name} in den Müll.`);
        break;
      }
      case 'burn': {
        if (card.t !== 'burn') return fail('Falsche Karte.');
        const tp = s.players[a.target && a.target.player];
        const si = tp ? normTarget(a.target.stack, tp.tray) : null;
        if (si == null || si === 'new') return fail('Diesen Burger gibt es nicht.');
        const st = tp.tray[si];
        const label = stackLabel(st, R);
        me.hand.splice(hi, 1);
        tp.tray.splice(si, 1);
        s.trash.push(...st, card);
        log(s, `🔥 ${me.name} verbrennt ${label} ${tp === me ? 'auf dem eigenen Tablett' : `von ${tp.name}`}.`,
          { k: 'burn', by: p, from: { player: a.target.player, stack: si }, cards: st.map(c => c.t), label });
        break;
      }
      case 'steal': {
        if (card.t !== 'steal') return fail('Falsche Karte.');
        const f = a.from || {}, t = a.to || {};
        const src = s.players[f.player];
        const si = src ? normTarget(f.stack, src.tray) : null;
        if (si == null || si === 'new') return fail('Diesen Burger gibt es nicht.');
        const dst = s.players[t.player];
        if (!dst || t.player === f.player) return fail('Die Beute muss auf ein anderes Tablett.');
        const st = src.tray[si];
        const whole = a.mode === 'whole';
        if (whole && completeRecipe(st, R) < 0) return fail('Ganz klauen geht nur bei fertigen Burgern.');
        const moving = whole ? st.slice() : [st[st.length - 1]];
        const tg = whole ? 'new' : normTarget(t.stack, dst.tray);
        if (tg == null) return fail('Ungültiges Ziel.');
        const newDst = withAdded(dst.tray, moving, tg);
        if (!trayValid(newDst, R)) return fail('Das passt auf dem Ziel-Tablett nicht.');
        const label = whole ? stackLabel(st, R) : TYPES[moving[0].t].name;
        me.hand.splice(hi, 1);
        if (whole) src.tray.splice(si, 1);
        else {
          st.pop();
          if (!st.length) src.tray.splice(si, 1);
        }
        dst.tray = newDst;
        s.trash.push(card);
        const where = dst === me ? 'aufs eigene Tablett' : `aufs Tablett von ${dst.name}`;
        log(s, `✋ ${me.name} klaut ${label} ${src === me ? 'vom eigenen Tablett' : `von ${src.name}`} und legt es ${where}.`, {
          k: 'steal', by: p, whole, label, cards: moving.map(c => c.t),
          from: { player: f.player, stack: si },
          to: { player: t.player, stack: tg === 'new' ? dst.tray.length - 1 : tg },
        });
        break;
      }
      case 'dig': {
        if (card.t !== 'dig') return fail('Falsche Karte.');
        me.hand.splice(hi, 1);
        s.trash.push(card);
        if (digOptions(s, p).length) {
          s.pending = { type: 'dig' };
          log(s, `🗑️ ${me.name} durchwühlt den Müll …`);
        } else {
          log(s, `🗑️ ${me.name} durchwühlt den Müll, findet aber nichts Brauchbares.`);
        }
        break;
      }
      case 'swap': {
        if (card.t !== 'swap') return fail('Falsche Karte.');
        if (a.dir !== 'next' && a.dir !== 'prev') return fail('Wähle eine Richtung.');
        const n = s.players.length;
        const trays = s.players.map(pl => pl.tray);
        s.players.forEach((pl, i) => {
          pl.tray = a.dir === 'next' ? trays[(i - 1 + n) % n] : trays[(i + 1) % n];
        });
        me.hand.splice(hi, 1);
        s.trash.push(card);
        log(s, `🔄 Ups, falscher Tisch! ${me.name} lässt alle Tabletts ${a.dir === 'next' ? 'an die nächste' : 'an die vorherige'} Person wandern.`,
          { k: 'swap', by: p, dir: a.dir });
        break;
      }
      default:
        return fail('Unbekannte Aktion.');
    }
    s.played++;
    afterPlay(s);
    return ok();
  }

  function viewFor(s, p) {
    return {
      theme: s.theme || null,
      recipes: s.recipes,
      players: s.players.map((pl, i) => ({
        name: pl.name,
        handCount: pl.hand.length,
        hand: i === p ? pl.hand : null,
        tray: pl.tray,
      })),
      deckCount: s.deck.length,
      trash: s.trash,
      current: s.current,
      played: s.played,
      pending: s.pending,
      winner: s.winner,
      turn: s.turn,
      log: s.log.slice(-40),
    };
  }

  // ---------- Bot ----------

  function progress(tray, recipes) {
    let v = 0;
    for (const st of tray) v += layersOf(st).length + (completeRecipe(st, recipes) >= 0 ? 6 : 0);
    return v;
  }

  function placeScore(tray, cards, tg, recipes) {
    const after = withAdded(tray, cards, tg);
    const st = after[tg === 'new' ? after.length - 1 : tg];
    if (completeRecipe(st, recipes) >= 0) return 100;
    return layersOf(cards).length * 10 + (tg === 'new' ? 0 : 5);
  }

  // A card is worth keeping if its layers fit contiguously into a burger we still need.
  function useful(card, tray, recipes) {
    const def = TYPES[card.t];
    if (def.kind === 'act') return true;
    const open = recipes.filter(r => !tray.some(st => completeRecipe(st, [r]) === r));
    const l = def.layers;
    return open.some(r => {
      const rl = RECIPES[r].layers;
      for (let i = 0; i + l.length <= rl.length; i++) if (isPrefix(l, rl.slice(i))) return true;
      return false;
    });
  }

  // Bot difficulty per seat (s.skill[p]): 'easy' never attacks and plays sloppily, 'hard' hunts the leader.
  function botStep(s, p, rng) {
    rng = rng || Math.random;
    const me = s.players[p];
    const R = s.recipes;
    const n = s.players.length;
    const skill = (s.skill && s.skill[p]) || 'normal';
    const hard = skill === 'hard';
    // How many burgers the strongest opponent has finished – hard bots aim their attacks at them.
    const lead = q => (hard ? completedCount(s.players[q].tray, R) * 12 : 0);

    if (s.pending && s.pending.type === 'dig') {
      let best = null;
      for (const c of digOptions(s, p)) {
        for (const tg of placeTargets(me.tray, [c], R)) {
          const sc = placeScore(me.tray, [c], tg, R);
          if (!best || sc > best.sc) best = { sc, a: { type: 'digPick', cardId: c.id, stack: tg } };
        }
      }
      return best.a;
    }
    if (s.played >= MAX_PLAYS || !me.hand.length) return { type: 'end' };
    // Easy bots often stop after one card.
    if (skill === 'easy' && s.played >= 1 && rng() < 0.5) return { type: 'end' };
    if (s.slow && s.slow[p] && s.turn >= s.slow[p] && s.played >= 1) return { type: 'end' };
    const noDig = s.noDig && s.noDig.includes(p);

    let best = null;
    const options = [];
    const consider = (sc, a) => {
      options.push({ sc, a });
      if (!best || sc > best.sc) best = { sc, a };
    };

    const gentle = (s.gentle && s.gentle.includes(p)) || skill === 'easy';
    for (const c of me.hand) {
      const def = TYPES[c.t];
      if (def.kind === 'ing') {
        for (const tg of placeTargets(me.tray, [c], R)) consider(placeScore(me.tray, [c], tg, R), { type: 'place', cardId: c.id, stack: tg });
      } else if ((gentle && c.t !== 'dig') || (noDig && c.t === 'dig')) {
        continue;
      } else if (c.t === 'burn') {
        s.players.forEach((o, q) => {
          if (q === p) return;
          const threat = completedCount(o.tray, R) >= R.length - 1 ? 30 : 0;
          o.tray.forEach((st, i) => {
            const sc = hard
              ? layersOf(st).length * 6 + (completeRecipe(st, R) >= 0 ? 30 : 0) + threat - 6 + lead(q)
              : layersOf(st).length * 4 + (completeRecipe(st, R) >= 0 ? 25 : 0) + threat - 10;
            consider(sc, { type: 'burn', cardId: c.id, target: { player: q, stack: i } });
          });
        });
      } else if (c.t === 'steal') {
        s.players.forEach((o, q) => {
          if (q === p) return;
          o.tray.forEach((st, i) => {
            if (completeRecipe(st, R) >= 0 && trayValid(withAdded(me.tray, st, 'new'), R)) {
              consider(70 + lead(q), { type: 'steal', cardId: c.id, mode: 'whole', from: { player: q, stack: i }, to: { player: p, stack: 'new' } });
            }
            const top = st[st.length - 1];
            for (const tg of placeTargets(me.tray, [top], R)) {
              consider(10 + placeScore(me.tray, [top], tg, R) / 2, { type: 'steal', cardId: c.id, mode: 'top', from: { player: q, stack: i }, to: { player: p, stack: tg } });
            }
          });
        });
      } else if (c.t === 'dig') {
        if (digOptions(s, p).length) consider(25, { type: 'dig', cardId: c.id });
      } else if (c.t === 'swap') {
        const mine = progress(me.tray, R);
        const leader = Math.max(...s.players.map((o, q) => (q === p ? 0 : completedCount(o.tray, R))));
        for (const dir of ['next', 'prev']) {
          const from = dir === 'next' ? (p - 1 + n) % n : (p + 1) % n;
          const gain = progress(s.players[from].tray, R) - mine;
          consider(gain * 5 - 5 + (leader >= R.length - 1 ? 10 : 0), { type: 'swap', cardId: c.id, dir });
        }
      }
    }
    if (skill === 'easy' && options.length && rng() < 0.35) {
      // Sloppy: some random sensible move instead of the best one.
      const ok = options.filter(o => o.sc > 8);
      if (ok.length) return ok[Math.floor(rng() * ok.length)].a;
    }
    if (best && best.sc > (hard ? 4 : 8)) return best.a;

    // A gentle (tutorial) bot throws its attack cards away instead of using them.
    const attack = (gentle || noDig) && me.hand.find(c => TYPES[c.t].kind === 'act' && (c.t !== 'dig' ? gentle : noDig));
    if (attack) return { type: 'discard', cardId: attack.id };
    const useless = me.hand.filter(c => !useful(c, me.tray, R));
    if (useless.length) return { type: 'discard', cardId: useless[0].id };
    if (hard) {
      // Hard bots cycle the deck faster: any ingredient that can't go anywhere right now is thrown away.
      const stuck = me.hand.filter(c => TYPES[c.t].kind === 'ing' && !placeTargets(me.tray, [c], R).length);
      if (stuck.length) return { type: 'discard', cardId: stuck[0].id };
    }
    if (s.played === 0) {
      const ings = me.hand.filter(c => TYPES[c.t].kind === 'ing');
      return { type: 'discard', cardId: (ings[0] || me.hand[0]).id };
    }
    return { type: 'end' };
  }

  return {
    MAX_PLAYS, HAND_SIZE, LAYERS, TYPES, RECIPES, THEMES, themeRecipes, pickRecipes,
    layersOf, candidates, completeRecipe, trayValid, assignRecipes, withAdded, placeTargets, trayDone, completedCount,
    makeDeck, newGame, act, viewFor, botStep, digOptions,
    TITLES, xpToNext, levelInfo, gameXp,
  };
});
