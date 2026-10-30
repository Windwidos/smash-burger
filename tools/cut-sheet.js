// Schneidet ein KI-Sprite-Sheet (magenta Hintergrund) in einzelne transparente PNGs.
// Aufruf: node tools/cut-sheet.js <sheet.png> <spalten> <zeilen> <name1,name2,...> [größe]
const path = require('path');
const sharp = require(path.join(__dirname, '..', 'app', 'node_modules', 'sharp'));

const [, , file, cols, rows, namesArg, sizeArg] = process.argv;
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
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = cy; y < Math.min(H, cy + ch); y++) {
      for (let x = cx; x < Math.min(W, cx + cw); x++) {
        if (data[(y * W + x) * 4 + 3] > 40) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const side = Math.max(w, h) + 8;
    const out = path.join(OUT, names[k] + '.png');
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
