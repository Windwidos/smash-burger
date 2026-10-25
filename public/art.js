/* Zutaten- und Aktions-Grafiken als SVG. */
window.Art = (function () {
  const OUT = '#3a2a20';

  const seeds = [[14, 13], [20, 11], [26, 13], [11, 19], [17, 18], [23, 18], [29, 19], [14, 24], [20, 24], [26, 24], [20, 29]]
    .map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="1.1" ry="1.7" fill="${OUT}"/>`).join('');

  // Diagonal grill stripes, clipped to the patty by computing each chord.
  const stripes = (color, w) => `<g transform="rotate(-40 20 20)">${[-10, -5, 0, 5, 10].map(o => {
    const half = Math.sqrt(13.5 * 13.5 - o * o).toFixed(1);
    return `<line x1="${20 - half}" y1="${20 + o}" x2="${20 + +half}" y2="${20 + o}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
  }).join('')}</g>`;

  const ICONS = {
    bun: `<circle cx="20" cy="20" r="16" fill="#F6A96B" stroke="${OUT}" stroke-width="2"/><circle cx="20" cy="20" r="11" fill="#F8B57D"/>${seeds}`,
    tomato: `<circle cx="20" cy="20" r="16" fill="#E8574A" stroke="${OUT}" stroke-width="2"/>
      <circle cx="20" cy="20" r="11" fill="#F07A68"/>
      <path d="M20 9v6M20 25v6M9 20h6M25 20h6M12.5 12.5l4 4M23.5 23.5l4 4M27.5 12.5l-4 4M16.5 23.5l-4 4" stroke="#C33B31" stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="20" cy="20" r="3" fill="#C33B31"/>`,
    salad: `<path d="M20 3c3 2 6 0 8 3s5 3 5 6 3 5 1 8 1 6-2 8-3 5-6 5-5 3-8 1-6 1-8-2-5-3-5-6-3-5-1-8-1-6 2-8 3-5 6-5 5-3 8-1z" fill="#5DAA5A" stroke="${OUT}" stroke-width="2"/>
      <path d="M12 28C17 22 22 17 29 11M18 22l-4-5M22 18l-1-6M24 22l5 1M19 26l5 2" stroke="#2F6B34" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
    cheese: `<path d="M5 9l30 -2 -1 26 -29 1z" fill="#F7C948" stroke="${OUT}" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="13" cy="15" r="3" fill="#FFF3C4" stroke="${OUT}" stroke-width="1.5"/>
      <circle cx="26" cy="13" r="2.2" fill="#FFF3C4" stroke="${OUT}" stroke-width="1.5"/>
      <circle cx="22" cy="23" r="3.5" fill="#FFF3C4" stroke="${OUT}" stroke-width="1.5"/>
      <circle cx="11" cy="27" r="2" fill="#FFF3C4" stroke="${OUT}" stroke-width="1.5"/>
      <circle cx="29" cy="28" r="1.8" fill="#FFF3C4" stroke="${OUT}" stroke-width="1.5"/>`,
    beef: `<circle cx="20" cy="20" r="16" fill="#2B2220" stroke="${OUT}" stroke-width="2"/>${stripes('#6A554D', 2.4)}`,
    chicken: `<circle cx="20" cy="20" r="16" fill="#F2B66D" stroke="${OUT}" stroke-width="2"/>${stripes('#3A2A20', 1.6)}`,
  };

  const ACTIONS = { burn: '🔥', steal: '✋', dig: '🗑️', swap: '🔄' };

  function icon(layer, size) {
    return `<svg class="ico" viewBox="0 0 40 40" width="${size}" height="${size}" aria-label="${SmashEngine.LAYERS[layer]}">${ICONS[layer]}</svg>`;
  }

  // Overlapping layer icons for a card (combo cards show several layers).
  function cardArt(t, size) {
    const def = SmashEngine.TYPES[t];
    if (def.kind === 'act') return `<span class="act-ico" style="font-size:${size * 0.7}px">${ACTIONS[t]}</span>`;
    const ls = def.layers;
    const step = ls.length > 3 ? size * 0.42 : size * 0.55;
    const w = size + step * (ls.length - 1);
    return `<span class="layers" style="width:${w}px;height:${size}px">${ls.map((l, i) =>
      `<span style="left:${i * step}px;z-index:${10 - i}">${icon(l, size)}</span>`).join('')}</span>`;
  }

  return { icon, cardArt, ACTIONS };
})();
