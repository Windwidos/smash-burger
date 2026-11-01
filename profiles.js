// Spielerprofile (Name, XP, Statistik, Münzen, Shop). Speicher: Supabase, wenn SUPABASE_URL + SUPABASE_SERVICE_KEY
// gesetzt sind, sonst eine lokale JSON-Datei (nur für die Entwicklung – auf Render wäre sie nach jedem Neustart weg).
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
    coins: row.coins || 0, owned: row.owned || [], equipped: row.equipped || {},
    supporter: !!row.supporter, adDay: row.ad_day || null, adCount: row.ad_count || 0,
  };
}

function toRow(p) {
  return {
    id: p.id, name: p.name, xp: p.xp, games: p.games, wins: p.wins, tutorial_done: p.tutorialDone, token_hash: p.tokenHash,
    coins: p.coins, owned: p.owned, equipped: p.equipped, supporter: p.supporter, ad_day: p.adDay, ad_count: p.adCount,
  };
}

async function sb(method, table, query, body, prefer) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: SB_KEY,
      // Legacy service_role keys are JWTs and go in Authorization too; new sb_secret_ keys only in apikey.
      ...(SB_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${SB_KEY}` } : {}),
      'Content-Type': 'application/json',
      Prefer: prefer || 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const err = new Error(`Supabase ${r.status}: ${await r.text()}`);
    err.status = r.status;
    throw err;
  }
  return r.status === 204 ? null : r.json();
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

async function create(name) {
  const token = crypto.randomBytes(24).toString('hex');
  const p = clean({ id: crypto.randomUUID(), name, xp: 0, games: 0, wins: 0, tutorial_done: false, token_hash: hash(token) });
  if (SB_URL) await sb('POST', 'profiles', '', toRow(p));
  else { loadLocal()[p.id] = toRow(p); saveLocal(); }
  cache.set(p.id, p);
  return { profile: p, token };
}

async function get(id) {
  if (!id || typeof id !== 'string' || id.length > 64) return null;
  if (cache.has(id)) return cache.get(id);
  let row;
  if (SB_URL) row = (await sb('GET', 'profiles', `?id=eq.${encodeURIComponent(id)}&select=*`))[0];
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
  delete row.id;
  delete row.token_hash;
  if (SB_URL) await sb('PATCH', 'profiles', `?id=eq.${encodeURIComponent(p.id)}`, { ...row, updated_at: new Date().toISOString() });
  else { loadLocal()[p.id] = { ...loadLocal()[p.id], ...row }; saveLocal(); }
}

async function remove(p) {
  cache.delete(p.id);
  if (SB_URL) await sb('DELETE', 'profiles', `?id=eq.${encodeURIComponent(p.id)}`);
  else { delete loadLocal()[p.id]; saveLocal(); }
}

// Records a Google Play purchase token once. false = this token was already redeemed.
async function claimPurchase(token, profileId, product) {
  if (SB_URL) {
    try {
      await sb('POST', 'purchases', '', { token, profile_id: profileId, product }, 'return=minimal');
      return true;
    } catch (e) {
      if (e.status === 409) return false;
      throw e;
    }
  }
  const db = loadLocal();
  db._purchases = db._purchases || {};
  if (db._purchases[token]) return false;
  db._purchases[token] = { profileId, product };
  saveLocal();
  return true;
}

function publicView(p) {
  return {
    id: p.id, name: p.name, xp: p.xp, games: p.games, wins: p.wins, tutorialDone: p.tutorialDone,
    coins: p.coins, owned: p.owned, equipped: p.equipped, supporter: p.supporter,
    adsToday: p.adDay === today() ? p.adCount : 0,
  };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { create, get, auth, save, remove, claimPurchase, publicView, today, usingSupabase: !!SB_URL };
