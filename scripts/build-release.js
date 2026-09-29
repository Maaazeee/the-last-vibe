'use strict';
/* =====================================================================
   Build de l'APK release (signé, connecté à la prod).
   Usage : npm run release:apk
   ---------------------------------------------------------------------
   • charge capacitor.release.json (assets locaux, pas de server.url)
   • gradlew assembleRelease (signature via android/keystore.properties)
   • copie l'APK vers dist/the-last-vibe-v<version>.apk
===================================================================== */
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;

// Outils locaux Windows (ignorés si les vars d'env existent déjà).
if (!process.env.JAVA_HOME) {
  const jdk = 'C:\\Users\\debor\\AppData\\Local\\TLVDev\\jdk-17.0.20.1+1';
  if (fs.existsSync(jdk)) process.env.JAVA_HOME = jdk;
}
if (!process.env.ANDROID_HOME) {
  const sdk = 'C:\\Users\\debor\\AppData\\Local\\TLVDev\\android-sdk';
  if (fs.existsSync(sdk)) process.env.ANDROID_HOME = sdk;
}
if (!process.env.GRADLE_OPTS) process.env.GRADLE_OPTS = '-Djava.net.preferIPv4Stack=true';

console.log('1/3 — cap sync (config release : assets locaux)…');
// Capacitor 6 n'accepte pas --config : on swappe le fichier pendant le sync.
const devCfg = path.join(root, 'capacitor.config.json');
const relCfg = path.join(root, 'capacitor.release.json');
const devBak = path.join(os.tmpdir(), 'tlv-cap-config-dev.bak.json');
fs.copyFileSync(devCfg, devBak);
try {
  fs.copyFileSync(relCfg, devCfg);
  execSync('npx cap sync android', { cwd: root, stdio: 'inherit' });
} finally {
  fs.copyFileSync(devBak, devCfg);
  fs.rmSync(devBak, { force: true });
}

const synced = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'capacitor.config.json');
const syncedCfg = JSON.parse(fs.readFileSync(synced, 'utf8'));
if (syncedCfg.server && syncedCfg.server.url) {
  console.error('ERREUR : la config synchronisée contient encore server.url — mauvais fichier de config.');
  process.exit(1);
}

console.log('2/3 — gradlew assembleRelease…');
execSync('gradlew.bat assembleRelease --no-daemon', {
  cwd: path.join(root, 'android'),
  stdio: 'inherit',
  env: process.env,
});

const apk = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (!fs.existsSync(apk)) {
  console.error('ERREUR : APK introuvable à ' + apk);
  process.exit(1);
}
const outDir = path.join(root, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `the-last-vibe-v${version}.apk`);
fs.copyFileSync(apk, out);

console.log(`3/3 — APK prêt : ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} Mo)`);
console.log('Pour publier :  gh release create v' + version + ' dist/the-last-vibe-v' + version + '.apk --title "The Last Vibe ' + version + '"');
