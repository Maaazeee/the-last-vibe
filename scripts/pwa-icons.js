'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const ICON_SVG = path.join(ROOT, 'public', 'icon.svg');
const OUT = path.join(ROOT, 'public', 'icons');

const MASKABLE_BG = '#070312';

async function generate() {
  if (!fs.existsSync(ICON_SVG)) {
    console.warn('[pwa-icons] icon.svg introuvable, génération ignorée.');
    return [];
  }
  fs.mkdirSync(OUT, { recursive: true });

  const jobs = [
    ['icon-192.png', 192, 'any'],
    ['icon-512.png', 512, 'any'],
    ['icon-maskable-512.png', 512, 'maskable'],
    ['apple-touch-icon.png', 180, 'apple']
  ];

  const done = [];
  for (const [name, size, kind] of jobs) {
    const dest = path.join(OUT, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      done.push(name + ' (déjà présent)');
      continue;
    }
    let img = sharp(ICON_SVG).resize(size, size, { fit: 'contain' });
    if (kind === 'maskable') {
      const pad = Math.round(size * 0.18);
      img = img.extend({
        top: pad,
        bottom: pad,
        left: pad,
        right: pad,
        background: MASKABLE_BG
      }).resize(size, size, { fit: 'cover' });
    }
    await img.png().toFile(dest);
    done.push(name + ' généré');
  }
  return done;
}

if (require.main === module) {
  generate()
    .then((r) => {
      r.forEach((line) => console.log('[pwa-icons] ' + line));
    })
    .catch((e) => {
      console.error('[pwa-icons] ' + (e && e.message));
      process.exit(1);
    });
}

module.exports = generate;