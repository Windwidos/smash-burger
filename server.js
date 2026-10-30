// Smash Burger – Multiplayer-Server ohne Abhängigkeiten (HTTP + Server-Sent Events).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const E = require('./public/engine.js');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MAX_PLAYERS = 6;
const BOT_DELAY = 1100;
const AUTOPILOT_AFTER = 25000; // a disconnected player's turn is played by a bot after this
const ROOM_TTL = 6 * 60 * 60 * 1000;
const BOT_NAMES = ['Bot Bernd', 'Bot Paula', 'Bot Kalle', 'Bot Uschi', 'Bot Ronja', 'Bot Heinz', 'Bot Frieda'];

const rooms = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

function newCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do c = Array.from({ length: 4 }, () => abc[crypto.randomInt(abc.length)]).join('');
  while (rooms.has(c));
  return c;
}

function newPlayer(name, isBot) {
  return {
    pid: crypto.randomUUID(), token: crypto.randomBytes(16).toString('hex'),
    name, isBot, clients: new Set(), disconnectedAt: Date.now(),
  };
}

function cleanName(n) {
  return String(n || '').replace(/\s+/g, ' ').trim().slice(0, 18);
}

function roomView(room, idx) {
  const st = room.state;
  return {
    code: room.code,
    version: room.version || 0,
    phase: st ? 'game' : 'lobby',
    you: idx,
    host: room.players.findIndex(p => p.pid === room.hostPid),
    players: room.players.map(p => ({
      name: p.name, isBot: p.isBot, connected: p.isBot || p.clients.size > 0,
    })),
    game: st ? E.viewFor(st, idx) : null,
  };
}

function broadcast(room) {
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
  }, BOT_DELAY);
}

// Picks up turns of players who dropped their connection.
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
    case 'addBot': {
      if (!isHost) return 'Nur der Gastgeber kann Bots hinzufügen.';
      if (room.state) return 'Das Spiel läuft schon.';
      if (room.players.length >= MAX_PLAYERS) return 'Der Tisch ist voll (max. 6).';
      const used = new Set(room.players.map(p => p.name));
      room.players.push(newPlayer(BOT_NAMES.find(n => !used.has(n)) || 'Bot', true));
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
      room.state = E.newGame(room.players.map(p => p.name));
      return null;
    }
    case 'restart': {
      if (!isHost) return 'Nur der Gastgeber kann neu starten.';
      if (room.state && room.state.winner == null) return 'Das Spiel läuft noch.';
      room.state = null;
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
      } else {
        room.players.splice(idx, 1);
        if (room.state) room.state = null;
      }
      if (me.pid === room.hostPid) {
        const next = room.players.find(p => !p.isBot);
        if (!next) { clearTimeout(room.timer); rooms.delete(room.code); return null; }
        room.hostPid = next.pid;
      }
      return null;
    }
  }
  return undefined;
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

  if (url.pathname === '/api/create') {
    const name = cleanName(body.name);
    if (!name) return json(res, 400, { error: 'Bitte gib deinen Namen ein.' });
    const code = newCode();
    const p = newPlayer(name, false);
    rooms.set(code, { code, players: [p], hostPid: p.pid, state: null, timer: null, updated: Date.now() });
    return json(res, 200, { code, pid: p.pid, token: p.token });
  }

  if (url.pathname === '/api/join') {
    const name = cleanName(body.name);
    const room = rooms.get(String(body.code || '').toUpperCase().trim());
    if (!name) return json(res, 400, { error: 'Bitte gib deinen Namen ein.' });
    if (!room) return json(res, 404, { error: 'Diesen Tisch gibt es nicht.' });
    if (room.state) return json(res, 409, { error: 'An diesem Tisch läuft schon ein Spiel.' });
    if (room.players.length >= MAX_PLAYERS) return json(res, 409, { error: 'Der Tisch ist voll (max. 6).' });
    if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return json(res, 409, { error: 'Der Name ist schon vergeben.' });
    const p = newPlayer(name, false);
    room.players.push(p);
    broadcast(room);
    return json(res, 200, { code: room.code, pid: p.pid, token: p.token });
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
  if (url.pathname === '/' ) file = path.join(PUBLIC, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Nicht gefunden'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🍔 Smash Burger läuft auf http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal && !ni.address.startsWith('169.254')) {
        console.log(`   Im WLAN:  http://${ni.address}:${PORT}`);
      }
    }
  }
});
