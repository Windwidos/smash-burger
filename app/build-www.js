// Kopiert die Weboberfläche nach www/ und trägt die Server-Adresse für die App ein.
const fs = require('fs');
const path = require('path');

const SERVER = process.env.SMASH_SERVER || 'https://smash-burger.onrender.com';
const src = path.join(__dirname, '..', 'public');
const dst = path.join(__dirname, 'www');

fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true, filter: f => !/(datenschutz|impressum)\.html$/.test(f) });
fs.writeFileSync(path.join(dst, 'config.js'),
  `window.SMASH_CONFIG = { server: ${JSON.stringify(SERVER)}, publicUrl: ${JSON.stringify(SERVER)} };\n`);
console.log(`www/ gebaut, Server: ${SERVER}`);
