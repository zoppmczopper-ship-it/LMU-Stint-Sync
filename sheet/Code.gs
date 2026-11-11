/**
 * 24h-Rennen – Live-Dashboard (Google Apps Script Web-App)
 * Liest die Stint-Planung live aus diesem Spreadsheet.
 */

// Welches Tabellenblatt standardmäßig angezeigt wird (im Dashboard umschaltbar):
var DEFAULT_TAB = ''; // aktives Event kommt aus Sync-Einstellungen (Plan-Tab)

function doGet(e) {
  if (e && e.parameter && (e.parameter.view === 'live' || e.parameter.view === 'box' || e.parameter.view === 'map' || e.parameter.api)) return syncDoGet_(e);
  const t = lmuTpl_('Index');
  t.initialTab = (e && e.parameter && e.parameter.tab) || syncSetting_('Plan-Tab') || DEFAULT_TAB;
  return t.evaluate()
    .setTitle('24h Rennen – Live')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** "hh:mm:ss" / "hh:mm" → Sekunden */
function toSec_(s) {
  s = String(s || '').trim();
  const m = s.match(/(-?\d+):(\d{1,2})(?::(\d{1,2}))?/);
  if (!m) return null;
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+(m[3] || 0));
}

/** Liste der Tabs, die wie eine Stint-Planung aussehen */
function planTabs_(ss) {
  return ss.getSheets().filter(sh => {
    if (sh.getLastRow() < 7 || sh.getLastColumn() < 7) return false;
    const v = sh.getRange(1, 7, 10, 1).getDisplayValues().map(r => String(r[0]).trim());
    return v.indexOf('Fahrer') !== -1;
  }).map(sh => sh.getName());
}

function getData(tabName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabs = planTabs_(ss);
  let sh = ss.getSheetByName(tabName);
  if (!sh || tabs.indexOf(tabName) === -1) sh = ss.getSheetByName(tabs[0]);
  if (!sh) throw new Error('Noch kein Event angelegt – im Sheet: LMU Sync → Neues Event');

  const lastRow = sh.getLastRow();
  const lastCol = Math.max(sh.getLastColumn(), 22);
  const disp = sh.getRange(1, 1, lastRow, lastCol).getDisplayValues();

  // Rennstart (B1)
  // Immer als Wiener Zeit interpretieren – unabhängig von der Zeitzone der Tabelle
  const tz = 'Europe/Vienna';
  let startMs = null;
  const s1 = String(disp[0][1]).trim();
  const m1 = s1.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m1) {
    const iso = m1[3] + '-' + ('0' + m1[2]).slice(-2) + '-' + ('0' + m1[1]).slice(-2) + ' ' +
      ('0' + m1[4]).slice(-2) + ':' + m1[5] + ':' + (m1[6] || '00');
    startMs = Utilities.parseDate(iso, tz, 'yyyy-MM-dd HH:mm:ss').getTime();
  } else {
    const b1 = sh.getRange('B1').getValue();
    if (b1 instanceof Date) {
      // Wanduhrzeit der Tabelle als Wiener Zeit neu interpretieren
      const wall = Utilities.formatDate(b1, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm:ss');
      startMs = Utilities.parseDate(wall, tz, 'yyyy-MM-dd HH:mm:ss').getTime();
    }
  }
  if (startMs === null) throw new Error('Rennstart in B1 nicht lesbar: ' + s1);
  const durationSec = toSec_(disp[4][1]) || 24 * 3600;

  // Kopfzeile finden (Spalte G == "Fahrer")
  let header = 5;
  for (let r = 0; r < Math.min(12, disp.length); r++) {
    if (String(disp[r][6]).trim() === 'Fahrer') { header = r; break; }
  }

  const stints = [];
  for (let r = header + 1; r < disp.length; r++) {
    const row = disp[r];
    const nr = parseInt(row[0], 10);
    if (isNaN(nr)) { if (stints.length) break; else continue; }
    let begin = toSec_(row[1]), end = toSec_(row[2]);
    if (begin === null || end === null) continue;
    // Rennzeit über 24:00 wird im Sheet als 00:00 angezeigt → korrigieren
    const prev = stints[stints.length - 1];
    while (prev && begin < prev.begin) begin += 86400;
    while (end < begin) end += 86400;
    stints.push({
      nr: nr,
      begin: begin,                       // Rennzeit Sekunden
      end: end,
      beginLocal: String(row[3]).replace(/^\d{2}\.\d{2}\.\d{4}\s*/, '').slice(0, 5),
      endLocal: String(row[4]).replace(/^\d{2}\.\d{2}\.\d{4}\s*/, '').slice(0, 5),
      laps: String(row[5]).trim(),
      driver: String(row[6]).trim(),
      hint: String(row[8]).trim(),
      tz: String(row[9]).trim(),
      beginLocalSec: toSec_(String(row[3]).replace(/^\d{2}\.\d{2}\.\d{4}\s*/, '')),
      endLocalSec: toSec_(String(row[4]).replace(/^\d{2}\.\d{2}\.\d{4}\s*/, '')),
      actStart: toSec_(row[13]),           // Ist-Startzeit (Spalte N)
      actEnd: toSec_(row[14]),             // Ist-Endzeit (Spalte O)
      // Tracker (L–V)
      bestLap: String(row[15] || '').trim(),
      lapsDone: String(row[16] || '').trim(),
      tyreChange: String(row[17] || '').trim(),
      repair: String(row[18] || '').trim(),
      tyrePct: String(row[19] || '').trim(),
      tyreText: String(row[20] || '').trim(),
      notes: String(row[21] || '').trim()
    });
  }

  // Ablauf vor dem Rennen (Event-Tab L1:M4): Training / Qualifying / Pause
  const sessions = [];
  const L = sh.getRange('L1:M4').getDisplayValues();
  if (/^Event-Start/.test(String(L[0][0]))) {
    const m2 = String(L[0][1]).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})/);
    if (m2) {
      let t = Utilities.parseDate(m2[3] + '-' + m2[2] + '-' + m2[1] + ' ' + m2[4] + ':' + m2[5] + ':00', tz, 'yyyy-MM-dd HH:mm:ss').getTime();
      [['Training', 1], ['Qualifying', 2], ['Pause', 3]].forEach(([name, i]) => {
        const min = parseFloat(String(L[i][1]).replace(',', '.')) || 0;
        if (min > 0) { sessions.push({ name: name, start: t, end: t + min * 60000 }); t += min * 60000; }
      });
    }
  }

  return {
    sessions: sessions,
    tab: sh.getName(),
    tabs: tabs,
    startMs: startMs,
    durationSec: durationSec,
    serverNow: Date.now(),
    stints: stints
  };
}
