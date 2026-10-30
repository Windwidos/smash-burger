// Schneidet ein KI-Sprite-Sheet (magenta Hintergrund) in einzelne transparente PNGs.
// Aufruf: node tools/cut-sheet.js <sheet.png> <spalten> <zeilen> <name1,name2,...> [größe] [keep]
// "keep" behält das Seitenverhältnis (größe = Höhe) statt quadratisch aufzufüllen.
const path = require('path');
const sharp = require(path.join(__dirname, '..', 'app', 'node_modules', 'sharp'));

const [, , file, cols, rows, namesArg, sizeArg, mode] = process.argv;
const KEEP = mode === 'keep';
const names = namesArg.split(',');
const SIZE = Number(sizeArg) || 256;
const OUT = path.join(__dirname, '..', 'public', 'img');

(async () => {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;

  // Key out magenta, un-mixing the background colour from soft edges.
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const m = Math.min(r, b) - g; // how "magenta" the pixel is
    let a = 1;
    if (m > 150) a = 0;
    else if (m > 60) a = 1 - (m - 60) / 90;
    if (a < 1) {
      if (a <= 0.02) { data[o + 3] = 0; continue; }
      data[o] = Math.max(0, Math.min(255, (r - (1 - a) * 255) / a));
      data[o + 2] = Math.max(0, Math.min(255, (b - (1 - a) * 255) / a));
      data[o + 3] = Math.round(a * 255);
    }
  }

  const cw = W / cols, ch = H / rows;
  for (let k = 0; k < names.length; k++) {
    const cx = Math.floor((k % cols) * cw), cy = Math.floor(Math.floor(k / cols) * ch);
    // Bounding box of the shapes in this cell, ignoring small bits that belong to a neighbour
    // (anything much smaller than the biggest connected shape is dropped).
    const cx1 = Math.min(W, Math.floor(cx + cw)), cy1 = Math.min(H, Math.floor(cy + ch));
    const seen = new Uint8Array(W * H);
    const comps = [];
    for (let y = cy; y < cy1; y++) {
      for (let x = cx; x < cx1; x++) {
        const i0 = y * W + x;
        if (seen[i0] || data[i0 * 4 + 3] <= 40) continue;
        const c = { n: 0, x0: x, y0: y, x1: x, y1: y, px: [] };
        const stack = [i0];
        seen[i0] = 1;
        while (stack.length) {
          const i = stack.pop();
          const px = i % W, py = (i - px) / W;
          c.n++; c.px.push(i);
          if (px < c.x0) c.x0 = px; if (px > c.x1) c.x1 = px;
          if (py < c.y0) c.y0 = py; if (py > c.y1) c.y1 = py;
          for (const j of [i - 1, i + 1, i - W, i + W]) {
            const jx = j % W, jy = (j - jx) / W;
            if (jx < cx || jx >= cx1 || jy < cy || jy >= cy1 || seen[j] || data[j * 4 + 3] <= 40) continue;
            seen[j] = 1;
            stack.push(j);
          }
        }
        comps.push(c);
      }
    }
    const biggest = Math.max(...comps.map(c => c.n));
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (const c of comps) {
      if (c.n < biggest * 0.02) { for (const i of c.px) data[i * 4 + 3] = 0; continue; }
      if (c.x0 < x0) x0 = c.x0; if (c.x1 > x1) x1 = c.x1;
      if (c.y0 < y0) y0 = c.y0; if (c.y1 > y1) y1 = c.y1;
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const side = Math.max(w, h) + 8;
    const out = path.join(OUT, names[k] + '.png');
    if (KEEP) {
      await sharp(data, { raw: { width: W, height: H, channels: 4 } })
        .extract({ left: x0, top: y0, width: w, height: h })
        .resize({ height: SIZE })
        .png({ compressionLevel: 9, palette: true, quality: 90 })
        .toFile(out);
      console.log(`${names[k]}: ${w}x${h} -> ${out}`);
      continue;
    }
    await sharp(data, { raw: { width: W, height: H, channels: 4 } })
      .extract({ left: x0, top: y0, width: w, height: h })
      .extend({
        top: Math.floor((side - h) / 2), bottom: Math.ceil((side - h) / 2),
        left: Math.floor((side - w) / 2), right: Math.ceil((side - w) / 2),
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .resize(SIZE, SIZE)
      .png({ compressionLevel: 9, palette: true, quality: 90 })
      .toFile(out);
    console.log(`${names[k]}: ${w}x${h} -> ${out}`);
  }
})();
