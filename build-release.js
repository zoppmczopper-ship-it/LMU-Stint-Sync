// node build-release.js
//  → sheet/Release.html          (Release für die Vorlage, gzip+base64)
//  → dist/sheet/release.json     (Update-Datei, die die Sheets von GitHub holen)
//  → dist/sheet/release-meta.json (nur Version + Änderungen, für „Update verfügbar“)
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const dir = path.join(__dirname, 'sheet'), dist = path.join(__dirname, 'dist', 'sheet');
const rd = f => fs.readFileSync(path.join(dir, f), 'utf8');
const sync = rd('Sync.gs');
const v = (sync.match(/^var SYNC_VERSION = '([\d.]+)'/m) || [])[1];
if (!v) throw new Error('SYNC_VERSION nicht gefunden');
if (/^(const|let) /m.test(sync + rd('Code.gs'))) throw new Error('top-level const/let gefunden – muss var sein');
const history = JSON.parse(fs.readFileSync(path.join(__dirname, 'release-notes.json'), 'utf8'));
if (history[0].v !== v) throw new Error('release-notes.json: oberster Eintrag ist ' + history[0].v + ', Code ist ' + v);
const html = {};
fs.readdirSync(dir).filter(f => f.endsWith('.html') && f !== 'Release.html').sort().forEach(f => { html[f.slice(0, -5)] = rd(f); });
const rel = { v, date: history[0].date, boot: 1, history, server: rd('Code.gs') + '\n' + sync, html };
new Function(rel.server); // Syntaxprüfung
const json = JSON.stringify(rel);
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'release.json'), json);
fs.writeFileSync(path.join(dist, 'release-meta.json'), JSON.stringify({ v, date: rel.date, boot: rel.boot, history }));
const b64 = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 9 }).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
fs.writeFileSync(path.join(dir, 'Release.html'), b64.match(/.{1,100}/g).join('\n') + '\n');
console.log('Sheet-Release', v, '· json', json.length, 'Bytes · html', Object.keys(html).join(','));
