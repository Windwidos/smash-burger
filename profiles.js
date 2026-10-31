// Spielerprofile (Name, XP, Statistik). Speicher: Supabase, wenn SUPABASE_URL + SUPABASE_SERVICE_KEY gesetzt sind,
// sonst eine lokale JSON-Datei (nur für die Entwicklung – auf Render wäre sie nach jedem Neustart weg).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const LOCAL_FILE = path.join(__dirname, 'data', 'profiles.json');

const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const cache = new Map();

function clean(row) {
  return {
    id: row.id, name: row.name, xp: row.xp, games: row.games, wins: row.wins,
    tutorialDone: row.tutorial_done, tokenHash: row.token_hash,
  };
}

async function sb(method, query, body) {
  const r = await fetch(`${SB_URL}/rest/v1/profiles${query}`, {
    method,
    headers: {
      apikey: SB_KEY,
      // Legacy service_role keys are JWTs and go in Authorization too; new sb_secret_ keys only in apikey.
      ...(SB_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${SB_KEY}` } : {}),
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r.json();
}

let local = null;
function loadLocal() {
  if (local) return local;
  try { local = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8')); } catch { local = {}; }
  return local;
}
function saveLocal() {
  fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true });
  fs.writeFileSync(LOCAL_FILE, JSON.stringify(local));
}

function toRow(p) {
  return { id: p.id, name: p.name, xp: p.xp, games: p.games, wins: p.wins, tutorial_done: p.tutorialDone, token_hash: p.tokenHash };
}

async function create(name) {
  const token = crypto.randomBytes(24).toString('hex');
  const p = { id: crypto.randomUUID(), name, xp: 0, games: 0, wins: 0, tutorialDone: false, tokenHash: hash(token) };
  if (SB_URL) await sb('POST', '', toRow(p));
  else { loadLocal()[p.id] = toRow(p); saveLocal(); }
  cache.set(p.id, p);
  return { profile: p, token };
}

async function get(id) {
  if (!id || typeof id !== 'string' || id.length > 64) return null;
  if (cache.has(id)) return cache.get(id);
  let row;
  if (SB_URL) row = (await sb('GET', `?id=eq.${encodeURIComponent(id)}&select=*`))[0];
  else row = loadLocal()[id];
  if (!row) return null;
  const p = clean(row);
  cache.set(id, p);
  return p;
}

// Returns the profile only if the token matches.
async function auth(id, token) {
  const p = await get(id);
  return p && p.tokenHash === hash(token) ? p : null;
}

async function save(p) {
  cache.set(p.id, p);
  const row = toRow(p);
  if (SB_URL) await sb('PATCH', `?id=eq.${encodeURIComponent(p.id)}`, { name: row.name, xp: row.xp, games: row.games, wins: row.wins, tutorial_done: row.tutorial_done, updated_at: new Date().toISOString() });
  else { loadLocal()[p.id] = row; saveLocal(); }
}

function publicView(p) {
  return { id: p.id, name: p.name, xp: p.xp, games: p.games, wins: p.wins, tutorialDone: p.tutorialDone };
}

module.exports = { create, get, auth, save, publicView, usingSupabase: !!SB_URL };
