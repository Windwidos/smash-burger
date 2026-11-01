// Plays the scripted tutorial exactly as Koch Kalle explains it and checks every step is possible.
const assert = require('assert');
const E = require('../public/engine');

const RIG = ['beef', 'cheese', 'salad', 'bun', 'tomato', 'steal', 'bun', 'burn', 'chicken'];
const BOT_RIG = ['beef', 'salad', 'tomato', 'chicken', 'bun', 'bun'];

for (let run = 0; run < 200; run++) {
  const s = E.newGame(['Du', 'Koch Kalle'], 0, Math.random, { rig: { 0: RIG.slice(), 1: BOT_RIG.slice() }, gentle: [1] });
  const me = s.players[0], kalle = s.players[1];
  const card = t => { const c = me.hand.find(x => x.t === t); assert(c, `Karte ${t} fehlt, Hand: ${me.hand.map(x => x.t)}`); return c.id; };
  const ok = a => { const r = E.act(s, 0, a); assert(r.ok, `${JSON.stringify(a)}: ${r.error}`); };
  const kalleTurn = () => { let g = 0; while (s.current === 1 && g++ < 10) assert(E.act(s, 1, E.botStep(s, 1)).ok); };
  const layers = st => E.layersOf(st).join(',');

  // Zug 1: Cheeseburger anfangen, Salat als neuer Burger.
  ok({ type: 'place', cardId: card('beef'), stack: 'new' });
  ok({ type: 'place', cardId: card('cheese'), stack: 0 });
  ok({ type: 'place', cardId: card('salad'), stack: 'new' });
  assert.strictEqual(s.current, 1);
  kalleTurn();
  assert.deepStrictEqual(kalle.tray.map(layers), ['beef', 'salad,tomato']);

  // Zug 2: Cheeseburger fertig, Tomate auf Salat, Kalles Patty klauen.
  ok({ type: 'place', cardId: card('bun'), stack: 0 });
  assert.strictEqual(E.completedCount(me.tray, s.recipes), 1);
  ok({ type: 'place', cardId: card('tomato'), stack: 1 });
  ok({ type: 'steal', cardId: card('steal'), mode: 'top', from: { player: 1, stack: 0 }, to: { player: 0, stack: 1 } });
  assert.strictEqual(layers(me.tray[1]), 'salad,tomato,beef');
  kalleTurn();
  assert.strictEqual(layers(kalle.tray[0]), 'salad,tomato,chicken,bun', 'Kalle soll einen Chicken Burger fertig haben');

  // Zug 3: Classic fertig, Kalles Chicken Burger verbrennen, Chicken-Patty behalten.
  ok({ type: 'place', cardId: card('bun'), stack: 1 });
  assert.strictEqual(E.completedCount(me.tray, s.recipes), 2);
  ok({ type: 'burn', cardId: card('burn'), target: { player: 1, stack: 0 } });
  assert(me.hand.some(c => c.t === 'chicken'));
  ok({ type: 'end' });
}
console.log('Tutorial-Ablauf ok');
