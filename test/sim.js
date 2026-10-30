// Spielt viele Bot-Partien durch und prüft dabei Invarianten.
const E = require('../public/engine.js');

function rngFrom(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const TOTAL = E.makeDeck().length;
let games = 0, stuck = 0, steps = 0;
const wins = {};

function countCards(s) {
  let n = s.deck.length + s.trash.length;
  for (const p of s.players) {
    n += p.hand.length;
    for (const st of p.tray) n += st.length;
  }
  return n;
}

for (let seed = 1; seed <= 600; seed++) {
  const players = 2 + (seed % 5);
  const rng = rngFrom(seed);
  const s = E.newGame(Array.from({ length: players }, (_, i) => `Bot${i}`), 0, rng);
  let k = 0;
  while (s.winner == null && k < 5000) {
    const p = s.current;
    const a = E.botStep(s, p);
    const r = E.act(s, p, a, rng);
    if (!r.ok) throw new Error(`Seed ${seed}: Bot-Aktion abgelehnt: ${r.error} ${JSON.stringify(a)}`);
    if (countCards(s) !== TOTAL) throw new Error(`Seed ${seed}: Kartenzahl ${countCards(s)} != ${TOTAL}`);
    for (const pl of s.players) {
      if (!E.trayValid(pl.tray, s.recipes)) throw new Error(`Seed ${seed}: ungültiges Tablett`);
      if (pl.hand.length > E.HAND_SIZE + 1) throw new Error(`Seed ${seed}: zu viele Handkarten`);
    }
    k++;
  }
  steps += k;
  games++;
  if (s.winner == null) stuck++;
  else wins[players] = (wins[players] || 0) + 1;
}

// Gezielte Regeltests
const R4 = [0, 1, 2];
const C = (t, id) => ({ id, t });
const assert = (c, m) => { if (!c) throw new Error('Regeltest fehlgeschlagen: ' + m); };
assert(E.trayValid([[C('beef', 1), C('cheese', 2), C('bun', 3)]], R4), 'Beef+Käse+Brötchen gültig');
assert(!E.trayValid([[C('cheese', 1), C('beef', 2)]], R4), 'Käse zuerst ungültig');
const tray = [[C('beefCheese', 1)], [C('beef', 2)]];
assert(!E.placeTargets(tray, [C('fullCheese', 3)], R4).includes('new'), 'Dritter Fleisch-Burger verboten (4–6 Spieler)');
assert(E.placeTargets(tray, [C('saladTomato', 4)], R4).includes('new'), 'Salat+Tomate als neuer Burger erlaubt');
assert(E.trayDone([[C('fullCheese', 1)], [C('fullChicken', 2)], [C('fullDeluxe', 3)]], R4), 'Alle drei fertig = Sieg');

const asg = E.assignRecipes([[C('beefCheese', 1)], [C('saladTomato', 2)]], R4);
assert(asg[0] === 0 && asg[1] === 1, 'Speisekarte hakt Cheese-Patty beim Cheeseburger und Salat+Tomate beim Chicken ab');

console.log(`${games} Partien, ${steps} Spielschritte, ${stuck} ohne Sieger (Limit erreicht)`);
console.log('Siege nach Spielerzahl:', wins);
console.log('Regeltests ok');
