/**
 * LMU Stint-Sync v2 – Team-Sheet-Server
 *  - nimmt Daten von lmu-stint-sync.exe an (doPost), nur von freigegebenen Fahrern
 *  - trägt Ist-Zeiten automatisch in den Plan-Tab ein (Tracker-Spalten L–V)
 *  - Live-Dashboard: <Web-App-URL>?view=live
 *  - Admin-Oberfläche: Menü „LMU Sync“ → „Admin“ (nur für Bearbeiter des Sheets)
 *  - Einrichtung: Menü „LMU Sync“ → „Einrichten / Web-App bereitstellen“
 */

var SYNC_VERSION = '3.6';
var SYNC_TZ = 'Europe/Vienna';

var SYNC_SHEETS = {
  Stints: ['Stint-ID', 'Fahrer', 'Session', 'Strecke', 'Auto', 'Klasse', 'Start', 'Ende', 'Runden', 'Beste Runde',
    'Ø Runde (sauber)', 'Boxenstopps', 'Zwischenfälle', 'Sprit Start (l)', 'Sprit Ende (l)', 'Sprit verbraucht (l)',
    'VE Start %', 'VE Ende %', 'VE verbraucht %', 'Reifen Start % (VL/VR/HL/HR)', 'Reifen Ende % (VL/VR/HL/HR)',
    'Platz Start', 'Platz Ende', 'Klassenplatz Ende', 'Mischung', 'Ende-Grund',
    'Ø Sprit/Rd (l)', 'Ø VE/Rd %', 'Reifenabbau/Rd % (Ø)', 'Rundenzeit-Abfall s/Rd'],
  Runden: ['Zeit', 'Stint-ID', 'Fahrer', 'Session', 'Runde', 'Rundenzeit', 'Sekunden', 'S1', 'S2', 'S3', 'Box',
    'Sprit (l)', 'Sprit/Runde', 'VE %', 'VE/Runde %', 'Reifen VL %', 'Reifen VR %', 'Reifen HL %', 'Reifen HR %',
    'Platz', 'Klassenplatz', 'Strecke °C', 'Regen %',
    'Batterie %', 'Reifen VL i/m/a °C', 'Reifen VR i/m/a °C', 'Reifen HL i/m/a °C', 'Reifen HR i/m/a °C',
    'Druck kPa (VL/VR/HL/HR)', 'Bremse °C (VL/VR/HL/HR)', 'Wasser °C', 'Öl °C', 'Schaden (Stufe)',
    'Luft °C', 'Nässe %', 'Reifenalter Rd (VL/VR/HL/HR)', 'Mischung', 'Fahrverhalten (Daten)'],
  Boxenstopps: ['Zeit', 'Stint-ID', 'Fahrer', 'Runde', 'Boxengasse (s)', 'Stand (s)', 'Getankt (l)', 'VE geladen %',
    'Reifen gewechselt', 'Reparatur', 'Reifen danach %',
    'Sprit vorher → nachher (l)', 'VE vorher → nachher %', 'Welche Reifen', 'Schaden vorher → nachher', 'Fahrerwechsel'],
  Ereignisse: ['Zeit', 'Stint-ID', 'Fahrer', 'Runde', 'Art', 'Beschreibung', 'Sessionzeit (s)', 'X', 'Z'],
  Linien: ['Zeit', 'Stint-ID', 'Fahrer', 'Session', 'Strecke', 'Auto', 'Runde', 'Rundenzeit (s)', 'Sauber', 'Länge (m)', 'Spur (komprimiert)'],
  'Sync-Fahrer': ['Fahrer', 'Geräte-ID', 'Status', 'Angemeldet', 'Zuletzt gesehen', 'Version', 'Schlüssel (Hash)'],
  'Sync-Einstellungen': ['Einstellung', 'Wert', 'Hinweis']
};

var SYNC_SETTINGS = [
  ['Plan-Tab', '', 'Tab, in dessen Tracker-Spalten L–V die Ist-Zeiten eingetragen werden'],
  ['Automatisch eintragen', 'ja', 'ja/nein – nur Rennsessions werden eingetragen'],
  ['Neue Fahrer automatisch freigeben', 'nein', 'ja = jede exe wird sofort angenommen (nicht empfohlen)'],
  ['Stream-URL', '', 'YouTube- oder Twitch-Link für das Live-Dashboard'],
  ['Discord-Webhook', '', 'Discord-Kanal-Webhook für Meldungen (leer = aus)'],
  ['Discord-Live-Nachricht', 'ja', 'ja/nein – eine Nachricht mit Live-Status, die laufend aktualisiert wird'],
  ['Web-App-URL', '', 'wird bei der Einrichtung automatisch eingetragen'],
  ['Ampel Energie rot (Runden)', '3', 'Box-Ampel rot, wenn Sprit/VE für weniger Runden reicht'],
  ['Ampel Energie gelb (Runden)', '6', ''],
  ['Ampel Reifen rot (%)', '30', 'Box-Ampel rot, wenn ein Reifen darunter liegt'],
  ['Ampel Reifen gelb (%)', '50', ''],
  ['Ampel Bremse rot (°C)', '750', 'darüber zu heiß: Bremsleistung fällt ab, Verschleiß steigt'],
  ['Ampel Bremse gelb (°C)', '650', '650–750 °C noch okay, im Rennen zunehmend kritisch; 400–650 °C guter Bereich'],
  ['Bremse kalt unter (°C)', '350', 'darunter weniger Bremswirkung, ABS spricht früher an'],
  ['Reifen kalt unter (°C)', '70', 'Reifentemperatur: darunter wenig Grip (v. a. erste Runde nach Start/Box)'],
  ['Reifen ideal von (°C)', '80', 'Sweet Spot für viele GT3-/Prototyp-Slicks: 80–90 °C'],
  ['Reifen ideal bis (°C)', '90', ''],
  ['Reifen heiß über (°C)', '97', 'darüber überhitzt: Grip und Verschleiß leiden (ca. 95–100 °C)'],
  ['Ampel Wasser rot (°C)', '110', ''],
  ['Ampel Öl rot (°C)', '130', ''],
  ['Discord-Ampel', 'ja', 'ja/nein – Meldung in Discord, wenn eine Box-Ampel auf Rot springt'],
  ['Event automatisch anlegen', 'ja', 'ja/nein – startet ein Rennen ohne passendes Event, wird ein Event-Tab angelegt und aktiv gesetzt'],
  ['Live nur aktives Rennen', 'ja', 'ja/nein – Live-Dashboard zeigt nur Daten des laufenden Events (Training bis Rennende)']
];

/* ======================= Menü & Einrichtung ======================= */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('LMU Sync')
    .addItem('Admin', 'showAdmin')
    .addItem('Neues Event …', 'showEventDialog')
    .addItem('Einrichten / Web-App bereitstellen', 'setupAndDeploy')
    .addSeparator()
    .addItem('Plan-Zuordnung zurücksetzen', 'planResetUi')
    .addToUi();
}

function showAdmin() {
  adminGuard_();
  const html = lmuTpl_('Admin').evaluate().setTitle('LMU Stint-Sync – Admin');
  SpreadsheetApp.getUi().showSidebar(html);
}

function syncSetup() {
  if (syncSetupDone_()) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSpreadsheetTimeZone() !== SYNC_TZ) ss.setSpreadsheetTimeZone(SYNC_TZ);
  Object.keys(SYNC_SHEETS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const h = SYNC_SHEETS[name];
    sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#1f2630').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  });
  try { ss.getSheetByName('Linien').setColumnWidth(11, 120); } catch (e) { /* egal */ }
  ['Stints', 'Runden', 'Boxenstopps', 'Ereignisse', 'Linien'].forEach(n => ss.getSheetByName(n).getRange('A:A').setNumberFormat('dd.MM.yyyy HH:mm:ss'));
  ss.getSheetByName('Stints').getRange('G:H').setNumberFormat('dd.MM.yyyy HH:mm:ss');
  ss.getSheetByName('Sync-Fahrer').getRange('D:E').setNumberFormat('dd.MM.yyyy HH:mm');
  const cfg = ss.getSheetByName('Sync-Einstellungen');
  const have = cfg.getDataRange().getValues().map(r => r[0]);
  SYNC_SETTINGS.forEach(s => {
    if (have.indexOf(s[0]) === -1) {
      const row = s.slice();
      if (row[0] === 'Plan-Tab' && !row[1]) row[1] = guessPlanTab_();
      cfg.appendRow(row);
    }
  });
  // alte Standardwerte auf neue Empfehlungen setzen (nur wenn nie geändert)
  const MIGRATE = { 'Ampel Bremse rot (°C)': ['900', '750'], 'Ampel Bremse gelb (°C)': ['800', '650'] };
  cfg.getDataRange().getValues().forEach((r, i) => {
    const m = MIGRATE[r[0]];
    if (m && String(r[1]) === m[0]) {
      const def = SYNC_SETTINGS.find(x => x[0] === r[0]);
      cfg.getRange(i + 1, 2, 1, 2).setValues([[m[1], def ? def[2] : '']]);
    }
  });
  cfg.setColumnWidth(1, 230).setColumnWidth(2, 320).setColumnWidth(3, 460);
  ss.getSheetByName('Sync-Fahrer').hideColumns(7);
  CacheService.getScriptCache().put('setupOk', SYNC_VERSION, 21600);
}

function syncSetupDone_() {
  // volle Einrichtung nur, wenn ein Pflicht-Tab fehlt
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return Object.keys(SYNC_SHEETS).every(n => ss.getSheetByName(n)) && CacheService.getScriptCache().get('setupOk') === SYNC_VERSION;
}

function syncSetupForce_() { CacheService.getScriptCache().remove('setupOk'); syncSetup(); }

function guessPlanTab_() {
  if (typeof DEFAULT_TAB !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DEFAULT_TAB)) return DEFAULT_TAB;
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheets().find(s => {
    if (s.getLastRow() < 7 || s.getLastColumn() < 7) return false;
    return s.getRange(1, 7, 10, 1).getDisplayValues().some(r => String(r[0]).trim() === 'Fahrer');
  });
  return sh ? sh.getName() : '';
}

/** Menü: Einrichten – Tabs anlegen und Schritt-für-Schritt-Anleitung zur Web-App zeigen */
function setupAndDeploy() {
  adminGuard_();
  syncSetupForce_();
  const t = lmuTpl_('Setup');
  t.url = webAppUrl_();
  t.scriptUrl = 'https://script.google.com/d/' + ScriptApp.getScriptId() + '/edit';
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(560).setHeight(520), 'LMU Stint-Sync einrichten');
}

/** Web-App-Link aus den Einstellungen (wird im Einrichten-Dialog gespeichert) */
function webAppUrl_() {
  return syncSetting_('Web-App-URL');
}

function adminCheckUrl() { adminGuard_(); return webAppUrl_(); }

function adminSaveUrl(url) {
  adminGuard_();
  url = String(url || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) throw new Error('Das ist kein Web-App-Link (muss mit /exec enden).');
  syncSetSetting_('Web-App-URL', url);
  return url;
}

/* ======================= Einstellungen ======================= */

function syncSettings_() {
  const c = CacheService.getScriptCache();
  const hit = c.get('settings');
  if (hit) return JSON.parse(hit);
  const o = {};
  syncSheet_('Sync-Einstellungen').getDataRange().getValues().slice(1).forEach(r => { if (r[0]) o[r[0]] = String(r[1] || '').trim(); });
  c.put('settings', JSON.stringify(o), 60);
  return o;
}
function syncSetting_(key) { return syncSettings_()[key] || ''; }
function syncSetSetting_(key, value) {
  const sh = syncSheet_('Sync-Einstellungen');
  const rows = sh.getDataRange().getValues();
  const i = rows.findIndex(r => r[0] === key);
  if (i >= 0) sh.getRange(i + 1, 2).setValue(value); else sh.appendRow([key, value, '']);
  CacheService.getScriptCache().remove('settings');
}

function syncSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) { syncSetup(); sh = ss.getSheetByName(name); }
  return sh;
}

/* ======================= Fahrer / Freigabe ======================= */

function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}

function findDevice_(device) {
  const sh = syncSheet_('Sync-Fahrer');
  const f = sh.getRange('B:B').createTextFinder(String(device)).matchEntireCell(true).findNext();
  if (!f) return null;
  const r = f.getRow();
  const v = sh.getRange(r, 1, 1, 7).getValues()[0];
  return { row: r, driver: v[0], status: String(v[2]), hash: String(v[6]) };
}

/** prüft Gerät + Schlüssel; legt bei Bedarf eine Anmeldung an */
function authDevice_(body) {
  const device = String(body.device || '').slice(0, 64);
  const key = String(body.key || '');
  if (!device || key.length < 16) return { ok: false, status: 'unbekannt', error: 'Kein Geräteschlüssel – bitte exe aktualisieren' };
  const sh = syncSheet_('Sync-Fahrer');
  let d = findDevice_(device);
  const now = new Date();
  if (!d) {
    if (body.action !== 'register') return { ok: false, status: 'unbekannt', error: 'Gerät nicht angemeldet' };
    const auto = syncSetting_('Neue Fahrer automatisch freigeben').toLowerCase() === 'ja';
    sh.appendRow([String(body.driver || 'Unbekannt').slice(0, 40), device, auto ? 'freigegeben' : 'wartet', now, now, String(body.version || ''), hash_(key)]);
    d = findDevice_(device);
    discordSend_('🆕 **' + (body.driver || 'Unbekannt') + '** möchte Daten senden – ' + (auto ? 'automatisch freigegeben.' : 'bitte im Sheet unter LMU Sync → Admin freigeben.'));
  } else if (d.hash !== hash_(key)) {
    return { ok: false, status: 'abgelehnt', error: 'Schlüssel passt nicht zu diesem Gerät' };
  }
  // „zuletzt gesehen“ höchstens alle 5 Minuten schreiben
  const c = CacheService.getScriptCache();
  if (!c.get('seen' + device)) {
    sh.getRange(d.row, 5, 1, 2).setValues([[now, String(body.version || '')]]);
    if (body.driver && body.driver !== d.driver && (d.status !== 'freigegeben' || !d.driver || d.driver === 'Unbekannt')) sh.getRange(d.row, 1).setValue(String(body.driver).slice(0, 40));
    c.put('seen' + device, '1', 300);
  }
  if (d.status !== 'freigegeben') {
    return { ok: false, status: d.status, error: d.status === 'gesperrt' ? 'Gerät gesperrt' : 'Wartet auf Freigabe durch den Admin' };
  }
  return { ok: true, status: 'freigegeben', driver: d.driver };
}

/* ======================= Empfang ======================= */

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return syncJson_({ ok: false, error: 'kein JSON' }); }
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const auth = authDevice_(body);
    if (!auth.ok || body.action === 'register' || body.action === 'hello') {
      auth.server = SYNC_VERSION;
      auth.sheet = SpreadsheetApp.getActiveSpreadsheet().getName();
      return syncJson_(auth);
    }
    // Name aus der Fahrerliste (Admin kann umbenennen); solange dort nichts Sinnvolles steht: LMU-Spielername übernehmen
    const regName = auth.driver && auth.driver !== 'Unbekannt' ? String(auth.driver) : '';
    if (!regName) {
      const lmu = (body.events || []).map(ev => ev.driver).find(n => n && n !== 'Unbekannt');
      if (lmu) { const d = findDevice_(body.device); if (d) syncSheet_('Sync-Fahrer').getRange(d.row, 1).setValue(String(lmu).slice(0, 40)); }
    }
    (body.events || []).forEach(ev => {
      if (regName) ev.driver = regName;
      syncHandle_(ev);
      try { eventAutoCreate_(ev); } catch (err) { console.error('Auto-Event: ' + err); }
      try { planUpdate_(ev); } catch (err) { console.error('Plan-Update: ' + err); }
      try { discordEvent_(ev); } catch (err) { console.error('Discord: ' + err); }
      try { boxCheckLights_(ev); } catch (err) { console.error('Ampel: ' + err); }
    });
    return syncJson_({ ok: true, status: 'freigegeben' });
  } catch (err) {
    return syncJson_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function syncJson_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

var syncLap_ = s => {
  if (!s || s <= 0) return '';
  const m = Math.floor(s / 60);
  return m + ':' + ('0' + (s - m * 60).toFixed(3)).slice(-6);
};
var syncWear_ = w => (w || []).map(v => Math.round(v)).join(' / ');
var syncNum_ = v => (typeof v === 'number' && v > 0 ? v : '');

function syncSec_(s) {
  if (typeof s === 'number') return s;
  const m = String(s).match(/(\d+):(\d+(?:\.\d+)?)/);
  return m ? (+m[1]) * 60 + (+m[2]) : 0;
}

function syncFindStint_(id) {
  const f = syncSheet_('Stints').getRange('A:A').createTextFinder(id).matchEntireCell(true).findNext();
  return f ? f.getRow() : 0;
}

function syncSeen_(ev) {
  if (!ev.eid) return false;
  const cache = CacheService.getScriptCache();
  if (cache.get('e' + ev.eid)) return true;
  cache.put('e' + ev.eid, '1', 21600);
  return false;
}

function syncHandle_(ev) {
  if (ev.type !== 'live' && syncSeen_(ev)) { ev._dup = true; return; }
  const ts = ev.ts ? new Date(ev.ts) : new Date();
  if (ev.type === 'stint_start') {
    try { mdRegister_(ev, ts.getTime() - (Number(ev.sessionET) || 0) * 1000); } catch (err) { console.error('Lauf: ' + err); }
  }
  switch (ev.type) {
    case 'stint_start': {
      if (syncFindStint_(ev.stint)) return;
      boxMarkDriverChange_(ev, ts);
      syncSheet_('Stints').appendRow([ev.stint, ev.driver, ev.session, ev.track, ev.car, ev.class, ts, '', 0, '', '', 0, 0,
        ev.fuel, '', '', ev.ve, '', '', syncWear_(ev.wear), '', ev.place, '', '', ev.compound || '', '']);
      break;
    }
    case 'lap': {
      syncSheet_('Runden').appendRow([ts, ev.stint, ev.driver, ev.session, ev.lap, syncLap_(ev.time), syncNum_(ev.time),
        ev.s1 || '', ev.s2 || '', ev.s3 || '', ev.pit ? 'ja' : '', ev.fuel, ev.fuelUsed, ev.ve, ev.veUsed]
        .concat((ev.wear || []).concat(['', '', '', '']).slice(0, 4)).concat([ev.place, ev.classPlace, ev.trackTemp, ev.rain])
        .concat(boxLapCols_(ev)));
      const r = syncFindStint_(ev.stint);
      if (r) {
        const sh = syncSheet_('Stints');
        sh.getRange(r, 9).setValue((Number(sh.getRange(r, 9).getValue()) || 0) + 1);
        const best = sh.getRange(r, 10).getValue();
        if (ev.time > 0 && (!best || ev.time < syncSec_(best))) sh.getRange(r, 10).setValue(syncLap_(ev.time));
        sh.getRange(r, 15).setValue(ev.fuel);
        sh.getRange(r, 18).setValue(ev.ve);
        sh.getRange(r, 21).setValue(syncWear_(ev.wear));
        sh.getRange(r, 23, 1, 2).setValues([[ev.place, ev.classPlace]]);
      }
      break;
    }
    case 'pit': {
      syncSheet_('Boxenstopps').appendRow([ts, ev.stint, ev.driver, ev.lap, ev.lane, ev.stop, ev.refuel, ev.veAdded,
        ev.tyres ? ev.tyres + ' Reifen' : 'nein', ev.repair ? 'ja' : 'nein', syncWear_(ev.wear),
        ev.fuelBefore !== undefined ? ev.fuelBefore + ' → ' + ev.fuelAfter : '',
        ev.veBefore !== undefined ? ev.veBefore + ' → ' + ev.veAfter : '',
        ev.tyresWhich || '', ev.dentsBefore !== undefined ? ev.dentsBefore + ' → ' + ev.dentsAfter : '', 'nein']);
      const r = syncFindStint_(ev.stint);
      if (r) { const c = syncSheet_('Stints').getRange(r, 12); c.setValue((Number(c.getValue()) || 0) + 1); }
      break;
    }
    case 'event': {
      syncSheet_('Ereignisse').appendRow([ts, ev.stint, ev.driver, ev.lap, ev.kind, ev.text, ev.et != null ? ev.et : '', ev.x != null ? ev.x : '', ev.z != null ? ev.z : '']);
      const r = ev.stint && syncFindStint_(ev.stint);
      if (r && ev.kind === 'Schaden') { const c = syncSheet_('Stints').getRange(r, 13); c.setValue((Number(c.getValue()) || 0) + 1); }
      break;
    }
    case 'stint_end': {
      const r = syncFindStint_(ev.stint);
      if (!r) return;
      const sh = syncSheet_('Stints');
      const row = sh.getRange(r, 1, 1, 26).getValues()[0];
      row[7] = ts; row[8] = ev.laps;
      if (ev.best > 0) row[9] = syncLap_(ev.best);
      if (ev.avg > 0) row[10] = syncLap_(ev.avg);
      row[11] = ev.pits; row[12] = ev.incidents;
      if (ev.fuel !== undefined) row[14] = ev.fuel;
      if (ev.fuelUsed !== undefined) row[15] = ev.fuelUsed;
      if (ev.ve !== undefined) row[17] = ev.ve;
      if (ev.veUsed !== undefined) row[18] = ev.veUsed;
      if (ev.wear) row[20] = syncWear_(ev.wear);
      if (ev.place) row[22] = ev.place;
      if (ev.classPlace) row[23] = ev.classPlace;
      row[25] = ev.reason || '';
      sh.getRange(r, 1, 1, 26).setValues([row]);
      try { sh.getRange(r, 27, 1, 4).setValues([boxStintSummary_(ev.stint)]); } catch (err) { console.error('Stint-Auswertung: ' + err); }
      break;
    }
    case 'highlight': {
      // Szenen für Videos (Überholen, Zweikampf, Dreher, Bestzeit) – Zeitpunkt = Beginn der Szene
      const at = ev.at ? new Date(ev.at) : ts;
      syncSheet_('Ereignisse').appendRow([at, ev.stint, ev.driver, ev.lap, ev.kind, ev.text, ev.et != null ? ev.et : '', ev.x != null ? ev.x : '', ev.z != null ? ev.z : '']);
      break;
    }
    case 'trace': {
      if (!ev.data || String(ev.data).length > 45000) break;
      syncSheet_('Linien').appendRow([ts, ev.stint, ev.driver, ev.session, ev.track, ev.car, ev.lap, ev.time, ev.clean ? 'ja' : 'nein', ev.len, ev.data]);
      break;
    }
    case 'setup': {
      // In LMU eingestellte Werte (Garage-Setup + Box-Menü), aus der internen LMU-Schnittstelle (exe ab 2.6.3), je Fahrer
      if (ev.setup) PropertiesService.getScriptProperties().setProperty('lmuSetup_' + mdKey_(ev.driver), JSON.stringify(Object.assign({ ts: Date.parse(ev.ts) || Date.now(),
        driver: ev.driver, track: ev.track, car: ev.car || '', session: ev.session }, ev.setup)));
      break;
    }
    case 'live': {
      if (ev.lmuSetup) {
        try { PropertiesService.getScriptProperties().setProperty('lmuSetup_' + mdKey_(ev.driver), JSON.stringify(Object.assign({ ts: Date.parse(ev.ts) || Date.now(),
          driver: ev.driver, track: ev.track, car: ev.car || '', session: ev.session }, ev.lmuSetup))); } catch (err) { console.error('LMU-Setup: ' + err); }
        delete ev.lmuSetup;
      }
      if (ev.field) {
        // Klassement separat im Cache (zu groß für eine Script-Property)
        try { CacheService.getScriptCache().put('field_' + mdKey_(ev.driver), JSON.stringify({ ts: Date.parse(ev.ts) || Date.now(), session: ev.session, cls: ev.class, rows: ev.field }), 21600); }
        catch (err) { console.error('Klassement: ' + err); }
        delete ev.field;
      }
      mdLive_(ev);
      break;
    }
  }
}

/* ======================= Mehrere Fahrer gleichzeitig ======================= */
// Jeder Fahrer hat einen eigenen Live-Stand (live_<Name>). Stints im selben Auto in derselben Session
// (Fahrerwechsel: gleiches Auto, gleiche Strecke/Session, Session-Start ±3 min) bilden einen „Lauf“.
// Boards zeigen den neuesten Fahrer des gewählten Laufs, Plan-Einträge gehen ins Event dieses Laufs.

function mdKey_(drv) { return String(drv || 'Unbekannt').trim().slice(0, 60) || 'Unbekannt'; }
function mdRuns_() { return JSON.parse(PropertiesService.getScriptProperties().getProperty('runs') || '{}'); }
function mdIdx_() { return JSON.parse(PropertiesService.getScriptProperties().getProperty('liveIdx') || '{}'); }

/** Stint einem Lauf zuordnen (einmal je Stint) */
function mdRegister_(ev, startMs) {
  if (!ev.stint) return null;
  const props = PropertiesService.getScriptProperties();
  const runs = mdRuns_();
  if (runs[ev.stint]) return runs[ev.stint];
  const ts = Date.parse(ev.ts) || Date.now();
  if (!(startMs > 0)) startMs = ts;
  const car = String(ev.car || '');
  let rk = null, evName = null;
  Object.keys(runs).forEach(id => {
    const r = runs[id];
    if (r.track === ev.track && r.session === ev.session && r.car === car && Math.abs(r.start - startMs) < 180000) {
      rk = rk || r.rk;
      if (r.ev && r.rk === rk) evName = r.ev;
    }
  });
  if (!rk) rk = [ev.track, ev.session, car, Math.round(startMs / 60000)].join('|');
  const r = { rk: rk, drv: mdKey_(ev.driver), track: ev.track || '', session: ev.session || '', car: car, start: startMs, ts: ts };
  if (evName) r.ev = evName;
  runs[ev.stint] = r;
  Object.keys(runs).sort((a, b) => runs[b].ts - runs[a].ts).slice(120).forEach(id => { delete runs[id]; });
  props.setProperty('runs', JSON.stringify(runs));
  return r;
}

/** Event eines Laufs festlegen (gilt für alle Stints des Laufs, auch spätere) */
function mdSetEvent_(rk, name) {
  if (!rk) return;
  const runs = mdRuns_();
  let changed = false;
  Object.keys(runs).forEach(id => { if (runs[id].rk === rk && runs[id].ev !== name) { runs[id].ev = name; changed = true; } });
  if (changed) PropertiesService.getScriptProperties().setProperty('runs', JSON.stringify(runs));
}

function mdRunEvent_(rk) {
  if (!rk) return null;
  const runs = mdRuns_();
  const id = Object.keys(runs).find(i => runs[i].rk === rk && runs[i].ev);
  return id ? runs[id].ev : null;
}

/** Events, die gerade von einem ANDEREN Lauf benutzt werden (Fahrer dort in den letzten 30 min aktiv) */
function mdBusyEvents_(rk) {
  const idx = mdIdx_(), runs = mdRuns_(), now = Date.now(), out = [];
  Object.keys(idx).forEach(k => {
    const e = idx[k];
    if (now - e.ts > 30 * 60e3 || e.rk === rk) return;
    const id = Object.keys(runs).find(i => runs[i].rk === e.rk && runs[i].ev);
    if (id && out.indexOf(runs[id].ev) === -1) out.push(runs[id].ev);
  });
  return out;
}

/** Live-Paket speichern: je Fahrer + Index; „live“ bleibt der zuletzt gesendete Stand (Discord, ältere Ansichten) */
function mdLive_(ev) {
  const props = PropertiesService.getScriptProperties();
  const ts = Date.parse(ev.ts) || Date.now();
  let run = ev.stint ? mdRuns_()[ev.stint] : null;
  if (!run && ev.stint) run = mdRegister_(ev, ev.sessionET != null ? ts - Number(ev.sessionET) * 1000 : ts);
  const k = mdKey_(ev.driver), idx = mdIdx_();
  idx[k] = { ts: ts, stint: ev.stint || '', rk: run ? run.rk : 'drv:' + k, track: ev.track || '', session: ev.session || '', car: ev.car || '' };
  const gone = Object.keys(idx).filter(d => ts - idx[d].ts > 7 * 86400e3);
  gone.forEach(d => { delete idx[d]; });
  const w = { liveIdx: JSON.stringify(idx), live: JSON.stringify(ev) };
  w['live_' + k] = w.live;
  props.setProperties(w);
  gone.forEach(d => ['live_', 'lmuSetup_', 'boxState_'].forEach(p => props.deleteProperty(p + d)));
}

/** Gewählten Fahrer auflösen → neuester Fahrer im selben Lauf (Fahrerwechsel); ohne Wahl der neueste überhaupt */
function mdResolve_(sel) {
  const props = PropertiesService.getScriptProperties();
  const idx = mdIdx_(), ks = Object.keys(idx), now = Date.now();
  let pick = null;
  const sk = sel ? mdKey_(sel) : null;
  if (sk && idx[sk]) ks.forEach(k => { if (idx[k].rk === idx[sk].rk && (!pick || idx[k].ts > idx[pick].ts)) pick = k; });
  if (!pick) ks.forEach(k => { if (!pick || idx[k].ts > idx[pick].ts) pick = k; });
  const groups = {};
  ks.forEach(k => {
    const e = idx[k];
    if (now - e.ts > 180000 && k !== pick) return;
    if (!groups[e.rk] || e.ts > groups[e.rk].ts) groups[e.rk] = Object.assign({ drv: k }, e);
  });
  const cars = Object.keys(groups).map(g => groups[g]).sort((a, b) => a.drv.localeCompare(b.drv))
    .map(g => ({ drv: g.drv, track: g.track, session: g.session, car: g.car, ts: g.ts, active: now - g.ts < 180000 }));
  let live = pick ? JSON.parse(props.getProperty('live_' + pick) || 'null') : null;
  if (!live && !ks.length) live = JSON.parse(props.getProperty('live') || 'null');   // Stand von vor 3.4
  return { drv: pick, rk: pick ? idx[pick].rk : null, live: live, cars: cars };
}

/** Event-Zeitfenster für einen Lauf: sein Event, sonst das laufende */
function mdEventWindow_(rk, before, after) {
  const n = mdRunEvent_(rk);
  const w = n ? eventWindow_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(n)) : null;
  return w || eventNow_(Date.now(), before, after, mdBusyEvents_(rk));
}

/* ======================= Ist-Zeiten in den Plan-Tab ======================= */
// Ein Plan-Stint endet mit einem Boxenstopp oder einem Fahrerwechsel.
// L Stint Nr. · M Fahrer · N Startzeit · O Endzeit · P best Lap · Q Laps · R Reifenw. · S Rep · T Reifenzustand · V Notizen

var P_COL = { driver: 13, start: 14, end: 15, best: 16, laps: 17, tyres: 18, rep: 19, wear: 20, notes: 22 };

// Plan-Zuordnung je Event-Tab (mehrere Rennen gleichzeitig möglich)
function planState_(name) {
  const props = PropertiesService.getScriptProperties();
  name = name || syncSetting_('Plan-Tab');
  const v = props.getProperty('planState:' + name);
  if (v) return JSON.parse(v);
  if (name && name === syncSetting_('Plan-Tab')) return JSON.parse(props.getProperty('planState') || '{}');   // von vor 3.4
  return {};
}
function planSave_(s, name) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('planState:' + (name || syncSetting_('Plan-Tab')), JSON.stringify(s));
  props.deleteProperty('planState');
}
function planReset_(name) {
  const props = PropertiesService.getScriptProperties();
  if (name) { props.deleteProperty('planState:' + name); if (name === syncSetting_('Plan-Tab')) props.deleteProperty('planState'); return; }
  props.getKeys().forEach(k => { if (k === 'planState' || k.indexOf('planState:') === 0) props.deleteProperty(k); });
}
function planResetUi() {
  adminGuard_();
  planReset_();
  SpreadsheetApp.getUi().alert('Plan-Zuordnung zurückgesetzt. Der nächste Renn-Stint wird in die erste Zeile ohne Startzeit eingetragen.');
}

function planSheet_() {
  const name = syncSetting_('Plan-Tab') || guessPlanTab_();
  return name ? SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name) : null;
}

function planRange_(sh) {
  const top = sh.getRange(1, 1, Math.min(sh.getLastRow(), 120), 12).getDisplayValues();
  let header = 5;
  for (let r = 0; r < Math.min(12, top.length); r++) if (String(top[r][6]).trim() === 'Fahrer') { header = r; break; }
  let last = header + 1;
  for (let r = header + 1; r < top.length; r++) { if (isNaN(parseInt(top[r][0], 10))) break; last = r; }
  return { first: header + 2, last: last + 1 };
}

var planTime_ = d => Utilities.formatDate(d, SYNC_TZ, 'HH:mm:ss');

function planOpen_(sh, st, ts, ev) {
  const rg = planRange_(sh);
  const n = rg.last - rg.first + 1;
  const vals = sh.getRange(rg.first, P_COL.start, n, 1).getDisplayValues();
  let row = 0;
  for (let i = 0; i < n; i++) if (!String(vals[i][0]).trim()) { row = rg.first + i; break; }
  if (!row) return;
  sh.getRange(row, P_COL.start).setValue(planTime_(ts));
  const d = sh.getRange(row, P_COL.driver);
  if (!String(d.getDisplayValue()).trim() && ev.driver) d.setValue(ev.driver);
  st.row = row; st.openedAt = ts.getTime(); st.laps = 0; st.best = 0; st.wear = null;
}

function planClose_(sh, st, ts, wear) {
  if (!st.row) return;
  const r = st.row;
  sh.getRange(r, P_COL.end).setValue(planTime_(ts));
  sh.getRange(r, P_COL.laps).setValue(st.laps);
  if (st.best > 0) sh.getRange(r, P_COL.best).setValue(syncLap_(st.best));
  const w = wear || st.wear;
  if (w && w.length) {
    const avg = w.reduce((a, b) => a + b, 0) / w.length / 100;
    sh.getRange(r, P_COL.wear).setValue(avg).setNumberFormat('0.00%');
  }
  st.prevRow = r; st.row = 0;
}

function planNote_(sh, row, text) {
  if (!row) return;
  const c = sh.getRange(row, P_COL.notes);
  const old = String(c.getDisplayValue() || '').trim();
  c.setValue(old ? old + ' · ' + text : text);
}

function planMarkPit_(sh, row, ev) {
  if (!row) return;
  sh.getRange(row, P_COL.tyres).setValue(ev.tyres ? 'Ja' : 'Nein');
  sh.getRange(row, P_COL.rep).setValue(ev.repair ? 'Ja' : 'Nein');
  if (ev.refuel > 0 || ev.veAdded > 0) planNote_(sh, row, 'Stopp ' + ev.lane + 's (+' + ev.refuel + ' l, VE +' + ev.veAdded + ' %)');
}

function planUpdate_(ev) {
  if (ev._dup || ev.type === 'live') return;
  if (syncSetting_('Automatisch eintragen').toLowerCase() === 'nein') return;
  // Event des Laufs (Auto/Session) – sonst der aktive Plan-Tab, solange kein anderer Lauf ihn gerade benutzt
  const run = ev.stint ? mdRuns_()[ev.stint] : null;
  let sh = run && run.ev ? SpreadsheetApp.getActiveSpreadsheet().getSheetByName(run.ev) : null;
  if (!sh) {
    sh = planSheet_();
    if (sh && mdBusyEvents_(run ? run.rk : null).indexOf(sh.getName()) !== -1) return;
  }
  if (!sh) return;
  const ts = ev.ts ? new Date(ev.ts) : new Date();
  const st = planState_(sh.getName());
  const race = ev.session === 'Rennen';
  switch (ev.type) {
    case 'stint_start':
      if (!race) return;
      if (st.row) planClose_(sh, st, ts, null);
      planOpen_(sh, st, ts, ev);
      break;
    case 'lap':
      if (!race) return;
      if (!st.row) planOpen_(sh, st, ts, ev);
      if (!st.row) break;
      st.laps = (st.laps || 0) + 1;
      if (ev.time > 0 && (!st.best || ev.time < st.best)) st.best = ev.time;
      st.wear = ev.wear;
      sh.getRange(st.row, P_COL.laps).setValue(st.laps);
      if (st.best > 0) sh.getRange(st.row, P_COL.best).setValue(syncLap_(st.best));
      break;
    case 'pit': {
      if (!st.row && !st.prevRow) return;
      const entry = new Date(ts.getTime() - (ev.lane || 0) * 1000);
      const recentlyOpened = st.row && ts.getTime() - st.openedAt < 180000;
      if (st.row && !recentlyOpened) {
        planClose_(sh, st, entry, null);
        planMarkPit_(sh, st.prevRow, ev);
        planOpen_(sh, st, ts, ev);
      } else {
        planMarkPit_(sh, st.prevRow || st.row, ev);
      }
      break;
    }
    case 'stint_end':
      if (st.row) planClose_(sh, st, ts, ev.wear);
      break;
    case 'event':
      planNote_(sh, st.row || st.prevRow, ev.kind + ' Rd. ' + ev.lap + ': ' + ev.text);
      break;
  }
  planSave_(st, sh.getName());
}

/* ======================= Discord (serverseitig) ======================= */

function discordUrl_() {
  const u = syncSetting_('Discord-Webhook');
  return /^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\//.test(u) ? u : '';
}

function discordSend_(content, embeds, opts) {
  const url = discordUrl_();
  if (!url) return null;
  const o = opts || {};
  const r = UrlFetchApp.fetch(url + (o.messageId ? '/messages/' + o.messageId : '?wait=true'), {
    method: o.messageId ? 'patch' : 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ content: content || '', embeds: embeds || [] })
  });
  if (r.getResponseCode() >= 300) return null;
  try { return JSON.parse(r.getContentText()).id || o.messageId; } catch (e) { return o.messageId || null; }
}

var dLap_ = s => (s > 0 ? syncLap_(s) : '–');

function discordEvent_(ev) {
  if (ev._dup || !discordUrl_()) return;
  const props = PropertiesService.getScriptProperties();
  let text = '';
  switch (ev.type) {
    case 'stint_start':
      text = '▶️ **' + ev.driver + '** übernimmt – ' + ev.session + ', ' + ev.track + ' · P' + ev.place + ' (Klasse P' + ev.classPlace + ') · ' + ev.fuel + ' l · VE ' + Math.round(ev.ve) + ' %';
      break;
    case 'stint_end':
      text = '⏹️ **' + ev.driver + '** Stint beendet: ' + ev.laps + ' Runden' + (ev.best > 0 ? ' · Beste ' + dLap_(ev.best) : '') +
        (ev.avg > 0 ? ' · Ø ' + dLap_(ev.avg) : '') + ' · ' + ev.pits + ' Stopp(s)' + (ev.wear ? ' · Reifen ' + syncWear_(ev.wear) + ' %' : '');
      break;
    case 'pit':
      text = '🔧 Boxenstopp **' + ev.driver + '** (Rd. ' + ev.lap + '): ' + ev.lane + ' s Gasse, ' + ev.stop + ' s Stand' +
        (ev.refuel > 0 ? ', +' + ev.refuel + ' l' : '') + (ev.tyres ? ', ' + ev.tyres + ' Reifen neu' : '') + (ev.repair ? ', repariert' : '');
      break;
    case 'event':
      text = '⚠️ **' + ev.kind + '** – ' + ev.driver + ' (Rd. ' + ev.lap + '): ' + ev.text;
      break;
    case 'live': {
      if (syncSetting_('Discord-Live-Nachricht').toLowerCase() === 'nein') return;
      const last = Number(props.getProperty('dLiveAt') || 0);
      if (Date.now() - last < 30000) return;
      const w = ev.wear || [];
      const embed = {
        title: '🏁 Live: ' + ev.driver + ' – P' + ev.place + ' (Klasse P' + ev.classPlace + ')',
        description: ev.session + ' · ' + ev.track + (ev.remaining > 0 ? ' · Rest ' + Math.floor(ev.remaining / 3600) + ':' + ('0' + Math.floor(ev.remaining % 3600 / 60)).slice(-2) + ' h' : ''),
        color: 0xff5a1f,
        fields: [
          { name: 'Letzte / Beste', value: dLap_(ev.last) + ' / ' + dLap_(ev.best), inline: true },
          { name: 'Energie', value: (ev.ve > 0 ? 'VE ' + ev.ve + ' % · ' : '') + ev.fuel + ' l' + (ev.lapsLeft ? '\nreicht ~' + ev.lapsLeft + ' Rd.' : ''), inline: true },
          { name: 'Reifen %', value: w.length === 4 ? 'VL ' + Math.round(w[0]) + ' · VR ' + Math.round(w[1]) + '\nHL ' + Math.round(w[2]) + ' · HR ' + Math.round(w[3]) : '–', inline: true },
          { name: 'Abstände', value: 'vor ' + (ev.gapAhead || 0) + ' s · hinter ' + (ev.gapBehind || 0) + ' s', inline: true }
        ],
        footer: { text: 'aktualisiert alle 30 s' },
        timestamp: ev.ts
      };
      let id = props.getProperty('dLiveId');
      const got = discordSend_('', [embed], id ? { messageId: id } : null);
      if (!got && id) { props.deleteProperty('dLiveId'); return; }
      if (got) props.setProperty('dLiveId', got);
      props.setProperty('dLiveAt', String(Date.now()));
      return;
    }
    default:
      return;
  }
  if (text) {
    discordSend_(text);
    props.deleteProperty('dLiveId'); // Live-Nachricht danach neu unten anhängen
  }
}

/* ======================= Admin-Seitenleiste (google.script.run) ======================= */

/** Nur Bearbeiter, die das Sheet selbst geöffnet haben – nicht anonyme Web-App-Besucher. */
function adminGuard_() {
  const active = Session.getActiveUser().getEmail();
  const eff = Session.getEffectiveUser().getEmail();
  if (!active || active !== eff) throw new Error('Keine Berechtigung – bitte im Sheet über das Menü LMU Sync → Admin öffnen.');
}

function adminData() {
  adminGuard_();
  syncSetup();
  try { eventColorsOnce_(); } catch (e) { console.error(e); }
  const drivers = syncSheet_('Sync-Fahrer').getDataRange().getDisplayValues().slice(1)
    .map(r => ({ driver: r[0], device: r[1], status: r[2], since: r[3], seen: r[4], version: r[5] }));
  const s = syncSettings_();
  const tabs = SpreadsheetApp.getActiveSpreadsheet().getSheets().map(x => x.getName())
    .filter(n => Object.keys(SYNC_SHEETS).indexOf(n) === -1);
  return { drivers: drivers, settings: s, tabs: tabs, events: eventList_(), url: webAppUrl_(), plan: planState_(), version: SYNC_VERSION };
}

function adminSetStatus(device, status) {
  adminGuard_();
  if (['freigegeben', 'gesperrt', 'wartet', 'löschen'].indexOf(status) === -1) throw new Error('ungültiger Status');
  const d = findDevice_(device);
  if (!d) throw new Error('Gerät nicht gefunden');
  const sh = syncSheet_('Sync-Fahrer');
  if (status === 'löschen') sh.deleteRow(d.row); else sh.getRange(d.row, 3).setValue(status);
  eventRefreshDrivers_();
  return adminData();
}

function adminRename(device, name) {
  adminGuard_();
  const d = findDevice_(device);
  if (!d) throw new Error('Gerät nicht gefunden');
  syncSheet_('Sync-Fahrer').getRange(d.row, 1).setValue(String(name).slice(0, 40));
  eventRefreshDrivers_();
  return adminData();
}

function adminSaveSettings(values) {
  adminGuard_();
  ['Plan-Tab', 'Automatisch eintragen', 'Neue Fahrer automatisch freigeben', 'Stream-URL', 'Discord-Webhook', 'Discord-Live-Nachricht']
    .forEach(k => { if (k in values) syncSetSetting_(k, String(values[k]).trim()); });
  return adminData();
}

function adminTestDiscord() {
  adminGuard_();
  if (!discordUrl_()) throw new Error('Kein gültiger Discord-Webhook eingetragen');
  const id = discordSend_('✅ LMU Stint-Sync ist mit diesem Kanal verbunden.');
  if (!id) throw new Error('Discord hat die Nachricht abgelehnt – Webhook-Link prüfen');
  return 'Testnachricht gesendet';
}

function adminResetPlan() { adminGuard_(); planReset_(); return adminData(); }

/* ======================= Events (Rennplanung) ======================= */
// Jedes Event ist ein eigener Tab mit demselben Aufbau wie die bisherige Stint-Planung:
// A–J Plan (Formeln aus den Kopfwerten B1–B5), L–V Ist-Werte (vom Tracker befüllt).

var EV_FIRST = 7;
var EV_COLORS = ['#c9b3f5', '#a8d1ff', '#b7e1a1', '#ffc9a3', '#f7b3d2', '#fff2a8', '#a6e3e0', '#e0c8a8', '#d0d0d0', '#ffb3b3'];

function showEventDialog() {
  adminGuard_();
  const t = lmuTpl_(null, EVENT_HTML);
  t.data = JSON.stringify(eventDialogData_()).replace(/</g, '\\u003c');
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(580).setHeight(780), 'Neues Event planen');
}

function eventDialogData_() {
  const d = new Date(Date.now() + 7 * 864e5);
  return {
    drivers: approvedDrivers_(),
    start: Utilities.formatDate(d, SYNC_TZ, "yyyy-MM-dd'T'20:00")
  };
}
function adminEventDialogData() { adminGuard_(); return eventDialogData_(); }

function approvedDrivers_() {
  const seen = {};
  return syncSheet_('Sync-Fahrer').getDataRange().getDisplayValues().slice(1)
    .filter(r => r[2] === 'freigegeben' && r[0] && !seen[r[0]] && (seen[r[0]] = 1))
    .map(r => r[0]);
}

function isEventTab_(sh) {
  return sh.getDeveloperMetadata().some(m => m.getKey() === 'lmuEvent');
}

function eventList_() {
  const active = syncSetting_('Plan-Tab');
  const skip = Object.keys(SYNC_SHEETS);
  return SpreadsheetApp.getActiveSpreadsheet().getSheets().filter(sh => {
    if (skip.indexOf(sh.getName()) !== -1) return false;
    if (isEventTab_(sh)) return true;
    if (sh.getLastRow() < 7 || sh.getLastColumn() < 7) return false;
    return sh.getRange(1, 7, 10, 1).getDisplayValues().some(r => String(r[0]).trim() === 'Fahrer');
  }).map(sh => ({ name: sh.getName(), active: sh.getName() === active, start: sh.getRange('B1').getDisplayValue() }));
}

function adminActivateEvent(name) {
  adminGuard_();
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name)) throw new Error('Tab nicht gefunden');
  syncSetSetting_('Plan-Tab', name);
  planReset_(name);
  return adminData();
}

/** "1:23:45" / "4:07" / "90" (Minuten bei h:mm) → Sekunden */
function evSec_(s, unit) {
  s = String(s || '').trim().replace(',', '.');
  if (!s) return 0;
  const p = s.split(':').map(Number);
  if (p.some(isNaN)) throw new Error('Ungültige Zeitangabe: ' + s);
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return unit === 'h' ? p[0] * 3600 + p[1] * 60 : p[0] * 60 + p[1];
  return unit === 'h' ? p[0] * 3600 : unit === 'm' ? p[0] * 60 : p[0];
}

/** Formel-Trennzeichen der Tabelle (deutsche Sheets wollen ';') – Formeln hier immer mit ',' schreiben */
function evSep_(sh) {
  const c = sh.getRange('Z1');
  c.setFormula('=SUM(1,2)');
  SpreadsheetApp.flush();
  const ok = c.getDisplayValue() === '3';
  c.clearContent();
  return ok ? ',' : ';';
}
function evF_(f, sep) {
  if (sep === ',') return f;
  return f.split('"').map((part, i) => (i % 2 ? part : part.replace(/,/g, ';'))).join('"');
}

var evZone_ = z => ({ CEST: 'MESZ', CET: 'MEZ' }[z] || z);

/** findet eine Zeitumstellung im Rennzeitraum → {at: Sekunden Rennzeit, shift: Sekunden, before, after} */
function evDst_(startMs, durSec) {
  const off = ms => {
    const z = Utilities.formatDate(new Date(ms), SYNC_TZ, 'Z');
    return (z[0] === '-' ? -1 : 1) * (+z.slice(1, 3) * 3600 + +z.slice(3, 5) * 60);
  };
  const zone = ms => evZone_(Utilities.formatDate(new Date(ms), SYNC_TZ, 'z'));
  const endMs = startMs + durSec * 1000;
  const o0 = off(startMs), o1 = off(endMs);
  if (o0 === o1) return { at: 0, shift: 0, before: zone(startMs), after: zone(startMs) };
  let lo = startMs, hi = endMs;
  while (hi - lo > 60000) { const mid = Math.floor((lo + hi) / 2); if (off(mid) === o0) lo = mid; else hi = mid; }
  return { at: Math.round((hi - startMs) / 60000) * 60, shift: o1 - o0, before: zone(startMs), after: zone(endMs) };
}

/** legt einen neuen Event-Tab an (aus dem Dialog „Neues Event“) */
function adminCreateEvent(o) {
  adminGuard_();
  const r = eventCreate_(o);
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(r.name));
  r.data = adminData();
  return r;
}

/** Event-Tab anlegen (aus dem Dialog oder automatisch beim Rennstart) */
function eventCreate_(o) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const name = String(o.name || '').trim().replace(/[\[\]*?:\/\\]/g, '').slice(0, 60);
  if (!name) throw new Error('Bitte einen Namen angeben');
  if (ss.getSheetByName(name)) throw new Error('Es gibt schon einen Tab „' + name + '“');
  const m = String(o.start || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) throw new Error('Rennstart fehlt');
  let startMs = Utilities.parseDate(m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':00', SYNC_TZ, 'yyyy-MM-dd HH:mm:ss').getTime();
  const dur = evSec_(o.duration, 'h'), lap = evSec_(o.lap, 's'), pit = evSec_(o.pit, 's');
  // Ablauf vor dem Rennen: Event-Start = Beginn Training; Rennstart = + Training + Qualifying + Pause
  const mins = v => Math.max(0, Math.round(Number(String(v == null ? '' : v).replace(',', '.')) || 0));
  const pM = mins(o.practice), qM = mins(o.quali), gM = mins(o.gap), preM = pM + qM + gM;
  const eventStartMs = startMs;
  startMs += preM * 60000;
  const lapsPer = Math.max(1, Math.round(Number(o.lapsPerStint) || 1));
  if (dur < 600 || lap < 30) throw new Error('Renndauer bzw. Rundenzeit prüfen');
  const drivers = (o.drivers || []).map(s => String(s).trim().slice(0, 40)).filter(Boolean);
  const per = Math.max(1, Math.round(Number(o.stintsPerDriver) || 1));
  const stintSec = lapsPer * lap + pit;
  const planned = Math.ceil(dur / stintSec);
  const nStints = planned + 2;      // +2 Reserve, falls Runden/Zeiten geändert werden
  const last = EV_FIRST + nStints - 1;
  const dst = evDst_(startMs, dur);
  const day = 86400;

  if (ss.getSpreadsheetTimeZone() !== SYNC_TZ) ss.setSpreadsheetTimeZone(SYNC_TZ);
  const sh = ss.insertSheet(name, ss.getSheets().length);
  sh.addDeveloperMetadata('lmuEvent', '1');
  const sep = evSep_(sh), F = f => evF_(f, sep);
  sh.getRange('A1:V' + (last + 5)).setFontFamily('Arial').setFontSize(10).setVerticalAlignment('middle');

  // Kopf
  sh.getRange('A1:B5').setValues([
    ['Rennstart', new Date(startMs)],
    ['Rundenzeit', lap / day],
    ['Boxenstopp', pit / day],
    ['Zeitumstellung nach Rennzeit', dst.shift ? dst.at / day : ''],
    ['Renndauer', dur / day]
  ]);
  sh.getRange('B1').setNumberFormat('dd.MM.yyyy HH:mm');
  sh.getRange('B2:B3').setNumberFormat('[h]:mm:ss');
  sh.getRange('B4:B5').setNumberFormat('[h]:mm:ss');
  sh.getRange('C4').setValue(dst.shift / 3600).setNumberFormat('+0" h";-0" h";"–"').setFontColor('#5f6368');
  sh.getRange('A1:A5').setFontWeight('bold');
  sh.getRange('B1:B5').setBackground('#fff8e1').setFontWeight('bold');
  sh.getRange('D1').setValue('Rennende (Ortszeit)').setFontWeight('bold');
  sh.getRange('E1').setFormula(F('=$B$1+$B$5+IF($B$4<>"",$C$4/24,0)')).setNumberFormat('dd.MM.yyyy HH:mm');
  sh.getRange('D2').setValue('Runden pro Stint (Vorgabe)').setFontWeight('bold');
  sh.getRange('E2').setValue(lapsPer);
  // Verbrauch → empfohlene Menge je Stint (Spalte K)
  const isVE = o.consUnit !== 'l';
  const cons = Number(String(o.cons || '').replace(',', '.'));
  const reserve = Number(String(o.reserve === '' || o.reserve == null ? 1 : o.reserve).replace(',', '.')) || 0;
  sh.getRange('D4').setValue(isVE ? 'Verbrauch VE %/Runde' : 'Verbrauch l/Runde').setFontWeight('bold');
  sh.getRange('E4').setValue(cons > 0 ? cons : '').setNumberFormat('0.00').setBackground('#fff8e1');
  sh.getRange('D5').setValue('Reserve (Runden)').setFontWeight('bold');
  sh.getRange('E5').setValue(reserve).setNumberFormat('0.#').setBackground('#fff8e1');
  if (dst.shift) {
    sh.getRange('D3').setValue('Zeitumstellung').setFontWeight('bold');
    sh.getRange('E3').setValue(dst.before + ' → ' + dst.after + ' (Uhr ' + (dst.shift < 0 ? 'zurück' : 'vor') + ')').setBackground('#f6b26b');
  }
  if (preM > 0) {
    sh.getRange('L1:M4').setValues([['Event-Start (Training)', new Date(eventStartMs)], ['Training (min)', pM], ['Qualifying (min)', qM], ['Pause bis Rennstart (min)', gM]]);
    sh.getRange('L1:L4').setFontWeight('bold').setHorizontalAlignment('right');
    sh.getRange('M1').setNumberFormat('dd.MM.yyyy HH:mm');
    sh.getRange('M2:M4').setNumberFormat('0" min"');
    sh.getRange('M1:M4').setBackground('#fff8e1').setFontWeight('bold');
    sh.getRange('B1').setFormula(F('=M1+(M2+M3+M4)/1440')).setBackground('#e8f0fe');
    sh.getRange('C1').setFormula(F('=IF(M2>0,"Training "&TEXT(M1,"HH:mm")&" · ","")&IF(M3>0,"Quali "&TEXT(M1+M2/1440,"HH:mm")&" · ","")&"Rennen "&TEXT(B1,"HH:mm")')).setFontColor('#5f6368');
  }
  sh.getRange('G1').setValue('Event: ' + name).setFontWeight('bold').setFontSize(12);
  // Gesamtrunden: Fahrzeit (Renndauer − Boxenstopps) / Rundenzeit, angefangene Runde zählt (Zielrunde)
  const bRange = '$B$' + EV_FIRST + ':$B$' + last;
  sh.getRange('G4').setFormula(F('=IFERROR("Gesamt: ca. "&ROUNDUP(($B$5-(COUNT(' + bRange + ')-1)*$B$3)/$B$2,0)&" Runden in "&COUNT(' + bRange + ')&" Stints","")'))
    .setFontWeight('bold');
  sh.getRange('G2').setValue('Gelbe Felder ändern → alle Zeiten rechnen neu. Runden je Stint in Spalte F anpassbar. Spalte K = empfohlene Tankmenge je Stint (Runden + Reserve × Verbrauch).').setFontColor('#5f6368');
  if (/^https:\/\/racecontrol\.gg\//.test(String(o.rcUrl || ''))) {
    sh.getRange('G3').setValue('Race Control: ' + o.rcUrl).setFontColor('#1a73e8');
    sh.getRange('G3').setRichTextValue(SpreadsheetApp.newRichTextValue().setText('Race Control: ' + o.rcUrl).setLinkUrl(14, 14 + o.rcUrl.length, o.rcUrl).build());
  }
  sh.getRange('N5:O5').merge().setValue('Uhrzeit').setHorizontalAlignment('center').setFontWeight('bold');
  sh.getRange('L5').setValue('IST (automatisch aus LMU)').setFontWeight('bold').setFontColor('#137333');

  // Kopfzeile
  const head = ['Stint', 'Beginn (Rennzeit)', 'Ende (Rennzeit)', 'Beginn (Ortszeit)', 'Ende (Ortszeit)', 'Runden', 'Fahrer',
    'Pause seit letztem Stint', 'Hinweis', 'Zeitzone', '', 'Stint Nr.', 'Fahrer (Ist)', 'Startzeit', 'Endzeit', 'best Lap',
    'Runden', 'Reifenw. J/N', 'Rep J/N', 'Reifenzustand Ende d. Stints', 'Reifenzustand', 'Notizen, Zwischenfälle etc.'];
  sh.getRange(6, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#1f2630').setFontColor('#ffffff')
    .setWrap(true).setHorizontalAlignment('center');
  sh.getRange('K6').setValue(isVE ? 'Tanken VE %' : 'Tanken l');

  // Zeilen mit Formeln
  const rows = [];
  for (let i = 0; i < nStints; i++) {
    const r = EV_FIRST + i, p = r - 1;
    const drv = drivers.length && i < planned ? drivers[Math.floor(i / per) % drivers.length] : '';
    const isDst = c => 'IF(AND($B$4<>"",' + c + '>=$B$4),';
    rows.push([
      i === 0 ? 1 : '=IF(B' + r + '="","",A' + p + '+1)',
      i === 0 ? 0 : '=IF(C' + p + '="","",IF(C' + p + '>=$B$5,"",C' + p + '+$B$3))',
      '=IF(B' + r + '="","",MIN(B' + r + '+F' + r + '*$B$2,$B$5))',
      '=IF(B' + r + '="","",$B$1+B' + r + '+' + isDst('B' + r) + '$C$4/24,0))',
      '=IF(C' + r + '="","",$B$1+C' + r + '+' + isDst('C' + r) + '$C$4/24,0))',
      '=IF(B' + r + '="","",$E$2)',
      drv,
      i === 0 ? '' : '=IFERROR(IF(OR(B' + r + '="",G' + r + '=""),"",B' + r + '-INDEX(FILTER($C$' + EV_FIRST + ':C' + p + ',$G$' + EV_FIRST + ':G' + p + '=G' + r + '),COUNTIF($G$' + EV_FIRST + ':G' + p + ',G' + r + '))),"")',
      '',
      '=IF(B' + r + '="","",' + isDst('B' + r) + '"' + dst.after + '","' + dst.before + '"))',
      '=IF(OR(F' + r + '="",$E$4=""),"",' + (isVE ? 'MIN(100,' : '(') + '(F' + r + '+$E$5)*$E$4))',
      '=IF(A' + r + '="","",A' + r + ')'
    ]);
  }
  sh.getRange(EV_FIRST, 1, nStints, 12).setValues(rows.map(r => r.map(v => (typeof v === 'string' && v[0] === '=' ? F(v) : v))));
  sh.getRange(EV_FIRST, 2, nStints, 2).setNumberFormat('[h]:mm:ss');
  sh.getRange(EV_FIRST, 4, nStints, 2).setNumberFormat('dd.MM.yyyy HH:mm:ss');
  sh.getRange(EV_FIRST, 6, nStints, 1).setNumberFormat('0');
  sh.getRange(EV_FIRST, 11, nStints, 1).setNumberFormat(isVE ? '0" %"' : '0.0" l"').setBackground('#e8f5e9').setFontWeight('bold');
  sh.getRange(EV_FIRST, 8, nStints, 1).setNumberFormat('[h]:mm');
  sh.getRange(EV_FIRST, 20, nStints, 1).setNumberFormat('0.00%');
  sh.getRange(EV_FIRST, 1, nStints, 22).setHorizontalAlignment('center');
  sh.getRange(EV_FIRST, 22, nStints, 1).setHorizontalAlignment('left');
  sh.getRange(EV_FIRST, 1, nStints, 10).setBorder(true, true, true, true, true, true, '#d0d0d0', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(EV_FIRST, 12, nStints, 11).setBorder(true, true, true, true, true, true, '#d0d0d0', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(EV_FIRST, 6, nStints, 1).setBackground('#fff8e1');

  const jn = SpreadsheetApp.newDataValidation().requireValueInList(['Ja', 'Nein'], true).setAllowInvalid(true).build();
  sh.getRange(EV_FIRST, 18, nStints, 2).setDataValidation(jn);

  // Hervorhebungen: kurze Pause (< 1 h, aber kein Doppelstint) rot
  const rules = sh.getConditionalFormatRules();
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(F('=AND(ISNUMBER(H' + EV_FIRST + '),H' + EV_FIRST + '>$B$3*3/2,H' + EV_FIRST + '<1/24)'))
    .setBackground('#f4c7c3').setRanges([sh.getRange(EV_FIRST, 8, nStints, 1)]).build());
  sh.setConditionalFormatRules(rules);

  sh.setFrozenRows(6);
  sh.setColumnWidth(1, 150).setColumnWidths(2, 2, 115).setColumnWidths(4, 2, 140).setColumnWidth(6, 60).setColumnWidth(7, 120)
    .setColumnWidth(8, 90).setColumnWidth(9, 90).setColumnWidth(10, 70).setColumnWidth(11, 85).setColumnWidth(12, 60)
    .setColumnWidth(13, 120).setColumnWidths(14, 4, 80).setColumnWidths(18, 2, 80).setColumnWidths(20, 2, 110).setColumnWidth(22, 260);
  sh.setRowHeight(6, 42);

  eventStyleDrivers_(sh, drivers);
  eventTimeColors_(sh);
  if (o.activate !== false) { syncSetSetting_('Plan-Tab', name); planReset_(name); }
  if (o.auto) sh.getRange('G2').setValue('Automatisch angelegt beim Rennstart (' + o.auto + '). Rundenzeit, Runden je Stint und Fahrer bei Bedarf anpassen – gelbe Felder.');
  return { name: name, stints: planned };
}

/* ---------- Aktives Rennen / automatisches Event ---------- */

/** Zeitfenster eines Event-Tabs: Event-Start (inkl. Training) … Rennende */
function eventWindow_(sh) {
  if (!sh) return null;
  const b1 = sh.getRange('B1').getValue();
  const dur = toSec_(sh.getRange('B5').getDisplayValue()) || 0;
  if (!(b1 instanceof Date) || !dur) return null;
  const race = b1.getTime();
  let start = race;
  const l1 = String(sh.getRange('L1').getValue());
  const m1 = sh.getRange('M1').getValue();
  if (/^Event-Start/.test(l1) && m1 instanceof Date) start = m1.getTime();
  return { name: sh.getName(), start: start, race: race, end: race + dur * 1000 };
}

/** Event, das jetzt läuft (oder gleich beginnt): zuerst das aktive, sonst eins, dessen Zeitfenster passt */
function eventNow_(now, beforeMs, afterMs, exclude) {
  now = now || Date.now();
  const ok = w => w && (exclude || []).indexOf(w.name) === -1 && now >= w.start - beforeMs && now <= w.end + afterMs;
  const act = eventWindow_(planSheet_());
  if (ok(act)) return act;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  for (const e of eventList_()) {
    const w = eventWindow_(ss.getSheetByName(e.name));
    if (ok(w)) return w;
  }
  return null;
}

/** Rennstart ohne passendes Event → Event automatisch anlegen und aktiv setzen */
function eventAutoCreate_(ev) {
  if (ev._dup || ev.type !== 'stint_start' || ev.session !== 'Rennen') return;
  const run = mdRuns_()[ev.stint] || null, rk = run ? run.rk : null;
  const ss0 = SpreadsheetApp.getActiveSpreadsheet();
  const busy = mdBusyEvents_(rk);
  // Aktiv setzen, solange der aktive Plan-Tab nicht gerade von einem anderen Lauf (anderes Auto/Rennen) benutzt wird
  const activate = name => {
    const cur = syncSetting_('Plan-Tab');
    if (cur !== name && busy.indexOf(cur) === -1) syncSetSetting_('Plan-Tab', name);
  };
  // Fahrerwechsel im selben Auto: Event des Laufs weiterverwenden
  if (run && run.ev && ss0.getSheetByName(run.ev)) { activate(run.ev); return; }
  if (/simulation/i.test(ev.track || '')) return;
  const ts = ev.ts ? new Date(ev.ts).getTime() : Date.now();
  const hit = eventNow_(ts, 2 * 3600e3, 30 * 60e3, busy);
  if (hit) {
    mdSetEvent_(rk, hit.name);
    if (rk) planReset_(hit.name);
    activate(hit.name);
    return;
  }
  if (syncSetting_('Event automatisch anlegen').toLowerCase() === 'nein') return;
  // Rennstart und -dauer aus LMU (Sessionzeit, ab exe 2.6), sonst ab jetzt 1 h
  const et = Number(ev.sessionET) || 0, rem = Number(ev.sessionRemaining) || 0;
  let startMs = ts - et * 1000, durSec = et + rem;
  if (!(durSec > 300 && durSec < 30 * 3600)) { startMs = ts; durSec = 3600; }
  startMs = Math.round(startMs / 60000) * 60000;
  const own = (() => { try { return lrOwnPace_(ev.track, ''); } catch (e) { return null; } })();
  const lap = own && own.team > 30 ? own.team : (Number(ev.best) > 30 ? Number(ev.best) * 1.02 : 120);
  const per = Math.max(5, Math.round(2700 / lap));   // Plan-Stints à ca. 45 min
  const fmtD = Utilities.formatDate(new Date(startMs), SYNC_TZ, 'dd.MM. HH.mm');
  let name = (String(ev.track || 'Rennen').replace(/[\[\]*?:\/\\]/g, ' ').trim().slice(0, 40) + ' ' + fmtD).replace(/\s+/g, ' ');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  for (let i = 2; ss.getSheetByName(name); i++) name = name.replace(/ \(\d+\)$/, '') + ' (' + i + ')';
  const mmss = s => Math.floor(s / 60) + ':' + ('0' + (s % 60).toFixed(1)).slice(-4);
  const hmm = s => Math.floor(s / 3600) + ':' + ('0' + Math.floor(s % 3600 / 60)).slice(-2);
  const r = eventCreate_({
    name: name, start: Utilities.formatDate(new Date(startMs), SYNC_TZ, "yyyy-MM-dd'T'HH:mm"), duration: hmm(Math.round(durSec / 60) * 60),
    lap: mmss(lap), lapsPerStint: per, pit: '1:10', stintsPerDriver: 1, drivers: ev.driver ? [ev.driver] : [],
    cons: '', consUnit: 've', reserve: 1, auto: ev.driver || 'LMU', activate: false
  });
  mdSetEvent_(rk, r.name);
  activate(r.name);
  syncSheet_('Ereignisse').appendRow([new Date(ts), ev.stint, ev.driver, ev.lap || 0, 'Event',
    'Neues Event „' + r.name + '“ automatisch angelegt (kein Event für dieses Rennen hinterlegt)', '', '', '']);
  try { if (discordUrl_()) discordSend_('🏁 Neues Rennen erkannt – Event **' + r.name + '** wurde automatisch angelegt.'); } catch (e) { /* egal */ }
}

/** Fahrer-Dropdown + Farben für einen Event-Tab setzen (freigegebene Fahrer + bereits eingetragene Namen) */
function eventStyleDrivers_(sh, extra) {
  const n = Math.max(sh.getLastRow() - EV_FIRST + 1, 1);
  const used = sh.getRange(EV_FIRST, 7, n, 1).getDisplayValues().map(r => String(r[0]).trim());
  const names = [];
  approvedDrivers_().concat(extra || [], used).forEach(x => { if (x && names.indexOf(x) === -1) names.push(x); });
  const g = sh.getRange(EV_FIRST, 7, n, 1), mIst = sh.getRange(EV_FIRST, 13, n, 1);
  if (names.length) {
    g.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(names, true).setAllowInvalid(true).build());
  } else {
    g.clearDataValidations();
  }
  const keep = sh.getConditionalFormatRules().filter(r => {
    const c = r.getBooleanCondition();
    return !(c && c.getCriteriaType() === SpreadsheetApp.BooleanCriteria.TEXT_EQUAL_TO);
  });
  names.slice(0, 40).forEach((nm, i) => {
    keep.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(nm).setBackground(EV_COLORS[i % EV_COLORS.length])
      .setRanges([g, mIst]).build());
  });
  sh.setConditionalFormatRules(keep);
}

/** Ist-Zeiten (N/O) einfärben: grün = wie geplant (±1 min), gelb = später, blau = früher als Plan (D/E) */
function eventTimeColors_(sh) {
  const sep = evSep_(sh), F = f => evF_(f, sep);
  const n = Math.max(sh.getLastRow() - EV_FIRST + 1, 1);
  const r = EV_FIRST;
  const keep = sh.getConditionalFormatRules().filter(x => {
    const c = x.getBooleanCondition();
    const v = c && c.getCriteriaValues && c.getCriteriaValues()[0];
    return !(typeof v === 'string' && v.indexOf('MOD(N') !== -1 || typeof v === 'string' && v.indexOf('MOD(O') !== -1);
  });
  [['N', 'D'], ['O', 'E']].forEach(([a, p]) => {
    const d = 'MOD(' + a + r + '-MOD($' + p + r + ',1)+1/2,1)-1/2'; // keine Dezimalpunkte (deutsches Sheet!)
    const rng = [sh.getRange(a + r + ':' + a + (r + n - 1))];
    const has = 'ISNUMBER(' + a + r + '),ISNUMBER($' + p + r + ')';
    keep.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(F('=AND(' + has + ',ABS(' + d + ')<=1/1440)'))
      .setBackground('#d9f2d0').setFontColor('#137333').setRanges(rng).build());
    keep.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(F('=AND(' + has + ',' + d + '>1/1440)'))
      .setBackground('#fff2b3').setFontColor('#8a6d00').setRanges(rng).build());
    keep.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(F('=AND(' + has + ',' + d + '<-1/1440)'))
      .setBackground('#d2e9fb').setFontColor('#0b57d0').setRanges(rng).build());
  });
  sh.setConditionalFormatRules(keep);
}

/** einmalig je Version: Farben in allen Event-Tabs nachrüsten */
function eventColorsOnce_() {
  const pr = PropertiesService.getScriptProperties();
  if (pr.getProperty('evColors') === '2') return;
  SpreadsheetApp.getActiveSpreadsheet().getSheets().filter(isEventTab_).forEach(sh => { try { eventTimeColors_(sh); } catch (e) { console.error(e); } });
  pr.setProperty('evColors', '2');
}

/** nach Freigabe/Umbenennen: Dropdowns aller Event-Tabs aktualisieren */
function eventRefreshDrivers_() {
  try {
    SpreadsheetApp.getActiveSpreadsheet().getSheets().filter(isEventTab_).forEach(sh => eventStyleDrivers_(sh, []));
  } catch (e) { console.error('Fahrerliste: ' + e); }
}

/* ======================= Race Control (racecontrol.gg) ======================= */
// Liest geplante Rennen von racecontrol.gg (offizielle LMU-Plattform, öffentliche Seiten, kein Login).
//  - Daily Races: Stufe beginner / intermediate / advanced, Dauer, Strecke, Startzeiten (UTC)
//  - Community-Events: Startzeit, Solo/Team, Mindest-Rating Bronze/Silver/Gold/Platinum (aus der Event-Seite)

var RC_BASE = 'https://racecontrol.gg';
var RC_LEVELS = ['beginner', 'intermediate', 'advanced', 'offen', 'bronze', 'silver', 'gold', 'platinum'];

function rcGet_(path, xhr) {
  const r = UrlFetchApp.fetch(RC_BASE + path, {
    muteHttpExceptions: true, followRedirects: true,
    headers: xhr ? { 'Accept': 'text/javascript', 'X-Requested-With': 'XMLHttpRequest' } : { 'Accept': 'text/html' }
  });
  if (r.getResponseCode() !== 200) throw new Error('Race Control nicht erreichbar (' + r.getResponseCode() + ')');
  let t = r.getContentText();
  if (xhr) t = t.replace(/\\\//g, '/').replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\'/g, "'");
  return t;
}

var rcTxt_ = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&middot;/g, '·').replace(/\s+/g, ' ').trim();

/** "25 Oct at 10:00am" (UTC) → ms */
function rcParseShort_(s) {
  const m = String(s).match(/(\d{1,2})\s+([A-Za-z]{3})\w*\s+at\s+(\d{1,2}):(\d{2})\s*([ap]m)/i);
  if (!m) return 0;
  const mon = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase());
  let h = +m[3] % 12; if (m[5].toLowerCase() === 'pm') h += 12;
  const now = new Date();
  let t = Date.UTC(now.getUTCFullYear(), mon, +m[1], h, +m[4]);
  if (t < now.getTime() - 60 * 864e5) t = Date.UTC(now.getUTCFullYear() + 1, mon, +m[1], h, +m[4]);
  return t;
}

/** "44 minutes" / "2 hours 30 minutes" / "6 hours" → Sekunden */
function rcDur_(s) {
  s = String(s || '').toLowerCase();
  const h = s.match(/(\d+)\s*h/), m = s.match(/(\d+)\s*m/);
  return (h ? +h[1] * 3600 : 0) + (m ? +m[1] * 60 : 0);
}

function rcDaily_() {
  const html = rcGet_('/');
  const out = [], now = Date.now();
  html.split('scheduled-race-card').slice(1).forEach(ch => {
    const tier = (ch.match(/tier-badge[^>]*>[\s\S]*?<\/i>\s*([^<]+?)\s*</) || [])[1];
    const name = rcTxt_((ch.match(/<h4[^>]*>([\s\S]*?)<\/h4>/) || [])[1]);
    const dur = rcTxt_((ch.match(/Duration\s*<\/span>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/) || [])[1]);
    const track = rcTxt_((ch.match(/Track\s*<\/span>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/) || [])[1]);
    if (!name) return;
    const times = [];
    ch.replace(/<span class="badge text-yellow[^"]*">([^<]+)<\/span>/g, (_, t) => { const ms = rcParseShort_(t); if (ms) times.push(ms); });
    times.sort((a, b) => a - b);
    // Takt der Serie (z. B. alle 90 min) – Race Control zeigt nur die Termine von heute,
    // weitere Tage werden daraus hochgerechnet (im Dialog als „voraussichtlich“ markiert)
    let interval = 0;
    if (times.length >= 2) {
      const d = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
      interval = d[Math.floor(d.length / 2)];
    }
    let next = times.find(t => t > now - 30 * 60000) || 0;
    if (!next && interval > 0 && times.length) { next = times[times.length - 1]; while (next < now) next += interval; }
    if (!next) return;
    out.push({ kind: 'daily', level: String(tier || '').trim().toLowerCase(), name: name, track: track,
      durSec: rcDur_(dur), start: next, times: times.slice(0, 40), interval: interval, team: false, url: RC_BASE + '/' });
  });
  return out;
}

/** mehrere Listen-Seiten (Seite 1 normal, ab Seite 2 per XHR wie „Load more“) parallel holen */
function rcPages_(path, maxPages) {
  const reqs = [];
  for (let p = 1; p <= maxPages; p++) {
    reqs.push({ url: RC_BASE + path + (p > 1 ? (path.indexOf('?') === -1 ? '?' : '&') + 'page=' + p : ''), muteHttpExceptions: true,
      headers: p > 1 ? { 'Accept': 'text/javascript', 'X-Requested-With': 'XMLHttpRequest' } : { 'Accept': 'text/html' } });
  }
  return UrlFetchApp.fetchAll(reqs).map((r, i) => {
    if (r.getResponseCode() !== 200) return '';
    let t = r.getContentText();
    if (i > 0) t = t.replace(/\\\//g, '/').replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\'/g, "'");
    return t;
  });
}

function rcCommunityList_() {
  // kommende UND laufende Meisterschaften (bei laufenden liegt die 1. Runde schon in der Vergangenheit)
  const pages = rcPages_('/events?status=upcoming', 6).concat(rcPages_('/events?status=active', 10));
  const seen = {}, all = [];
  pages.join('\n').split('community-event-card').slice(1).forEach(ch => {
    const id = (ch.match(/href="\/events\/(\d+)"/) || [])[1];
    if (!id || seen[id]) return;
    seen[id] = 1;
    const name = rcTxt_((ch.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1]);
    const host = rcTxt_((ch.match(/\/hosts\/[^"]*"[^>]*>([\s\S]*?)<\/a>/) || [])[1]);
    const dt = (ch.match(/datetime="([^"]+)"/) || [])[1];
    const drivers = rcTxt_((ch.match(/Drivers\s*<\/span>[\s\S]*?<dd[^>]*>([\s\S]*?)<\/dd>/) || [])[1]);
    const rounds = rcTxt_((ch.match(/Rounds\s*<\/span>[\s\S]*?<dd[^>]*>([\s\S]*?)<\/dd>/) || [])[1]);
    all.push({ kind: 'event', id: id, name: name, host: host, start: dt ? Date.parse(dt) : 0, team: /team/i.test(drivers),
      roundsTxt: rounds, url: RC_BASE + '/events/' + id });
  });
  // 1) Runden aller Events holen, nur Events mit kommender Runde behalten
  const now = Date.now(), fetchAllBatched = urls => {
    let res = [];
    for (let i = 0; i < urls.length; i += 50) {
      res = res.concat(UrlFetchApp.fetchAll(urls.slice(i, i + 50).map(u => ({ url: u, muteHttpExceptions: true })))
        .map(r => (r.getResponseCode() === 200 ? r.getContentText() : '')));
    }
    return res;
  };
  const racesHtml = fetchAllBatched(all.map(e => e.url + '/races'));
  all.forEach((e, i) => { e.rounds = rcRounds_(racesHtml[i]); });
  const out = all.filter(e => e.start > now - 30 * 60000 || e.rounds.some(r => r.start > now - 30 * 60000));
  // 2) Mindest-Rating und DLC nur für die verbleibenden
  const more = fetchAllBatched([].concat.apply([], out.map(e => [e.url, e.url + '/modded_content'])));
  out.forEach((e, i) => {
    const info = more[i * 2], mods = more[i * 2 + 1];
    e.level = rcLevel_(info);
    e.classes = (info.match(/<span class="fw-bold fs-sm">([^<]+)<\/span>/g) || []).map(rcTxt_).slice(0, 6).join(', ');
    const m = rcModded_(mods);
    e.trackDlc = m.tracks; e.carPacks = m.carPacks;
    e.rounds = e.rounds.filter(r => r.start > now - 30 * 60000);
  });
  return out;
}

/** Hosted Races (privat organisierte Rennen) mit Sessions Training/Quali/Rennen */
function rcHosted_() {
  const seen = {}, out = [];
  const mins = (s, k) => { const m = String(s).match(new RegExp('\\b' + k + '\\s+((?:\\d+\\s*h)?\\s*(?:\\d+\\s*m)?)', 'i')); return m ? Math.round(rcDur_(m[1]) / 60) : 0; };
  rcPages_('/hosted_races', 5).join('\n').split('community-event-card').slice(1).forEach(ch => {
    const id = (ch.match(/href="\/hosted_races\/(\d+)/) || [])[1];
    if (!id || seen[id]) return;
    seen[id] = 1;
    const dd = label => rcTxt_((ch.match(new RegExp(label + '\\s*<\\/span>\\s*<\\/dt>\\s*<dd[^>]*>([\\s\\S]*?)<\\/dd>')) || [])[1]);
    const dt = (ch.match(/datetime="([^"]+)"/) || [])[1];
    const sess = dd('Sessions');
    const p = mins(sess, 'P'), q = mins(sess, 'Q'), r = mins(sess, 'R');
    out.push({ kind: 'hosted', id: id, level: 'offen', name: rcTxt_((ch.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1]),
      track: dd('Track'), classes: dd('Classes'), team: /team/i.test(dd('Drivers')), sessions: sess,
      practice: p, quali: q, durSec: r * 60, start: dt ? Date.parse(dt) : 0, url: RC_BASE + '/hosted_races/' + id });
  });
  return out;
}

function rcLevel_(page) {
  const lv = {};
  String(page || '').split('Entry Requirements').slice(1).forEach(seg => {
    (seg.slice(0, 1500).match(/title="(Bronze|Silver|Gold|Platinum)"/g) || []).forEach(x => { lv[x.slice(7, -1).toLowerCase()] = 1; });
  });
  return ['bronze', 'silver', 'gold', 'platinum'].find(x => lv[x]) || 'offen';
}

function rcRounds_(html) {
  const rounds = [];
  String(html || '').split(/id="information-round\d+"/).slice(1).forEach(ch => {
    const name = rcTxt_((ch.match(/<h4[^>]*>([\s\S]*?)<\/h4>/) || [])[1]);
    const track = rcTxt_((ch.match(/Track\s*<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/) || [])[1]);
    const dt = (ch.match(/datetime="([^"]+)"/) || [])[1];
    if (dt) rounds.push({ name: name, track: track, start: Date.parse(dt) });
  });
  return rounds;
}

/** DLC-Seite eines Events → Strecken-DLCs [{pack, item}] und Auto-Packs [Name] */
function rcModded_(html) {
  const tracks = [], cars = {};
  String(html || '').split(/<h4 class="mb-3">/).slice(1).forEach(sec => {
    const kind = rcTxt_(sec.slice(0, sec.indexOf('<')));
    sec.split(/<h5[^>]*>/).slice(1).forEach(card => {
      const pack = rcTxt_(card.slice(0, card.indexOf('</h5>')));
      const item = rcTxt_((card.match(/(?:Track|Car)\s*<\/span>\s*<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/) || [])[1]);
      const type = rcTxt_((card.match(/Mod Type\s*<\/span>\s*<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/) || [])[1]);
      if (!pack || (type && !/dlc/i.test(type))) return;
      if (/track/i.test(kind)) tracks.push({ pack: pack, item: item || pack });
      else cars[pack] = 1;
    });
  });
  return { tracks: tracks, carPacks: Object.keys(cars) };
}

// bekannte Strecken-DLCs (aus Race-Control-Daten); wird durch die geladenen Events ergänzt
var RC_TRACK_DLC = [
  ['barcelona', 'ELMS Pack 3'], ['americas', 'DLC Pack 2'],
  ['daytona', 'US Track Pack 1'], ['laguna', 'US Track Pack 1'], ['longbeach', 'US Track Pack 2'],
  ['atlanta', 'US Track Pack 2'], ['ricard', 'ELMS Pack 2'], ['silverstone', 'ELMS Pack 1']
];
var RC_STOP = ['circuit', 'international', 'speedway', 'raceway', 'course', 'road', 'track', 'endurance', 'grand', 'prix', 'motor',
  'weathertech', 'catalunya', 'autodromo', 'park', 'wec', 'elms'];

function rcTrackKeys_(name) {
  const s = String(name || '').toLowerCase().replace(/_?20\d\d/g, ' ').replace(/[^a-z ]/g, ' ');
  return s.split(/\s+/).filter(w => w.length >= 4 && RC_STOP.indexOf(w) === -1);
}
function rcTrackJoined_(name) {
  const s = String(name || '').toLowerCase().replace(/[^a-z ]/g, ' ');
  return s.replace(/\s+/g, '') + (/\bcota\b|\bcot a\b/.test(s) ? 'americas' : '');
}

/** Zuordnung Strecke → DLC-Paket; ein Eintrag passt, wenn ALLE seine Stichwörter im Streckennamen vorkommen */
function rcDlcMap_(events) {
  const map = RC_TRACK_DLC.map(x => ({ keys: [x[0]], joined: x[0], pack: x[1] }));
  (events || []).forEach(e => (e.trackDlc || []).forEach(t => {
    const keys = rcTrackKeys_(t.item);
    if (keys.length && !map.some(m => m.keys.join() === keys.join())) map.push({ keys: keys, joined: rcTrackJoined_(t.item), pack: t.pack });
  }));
  return map;
}

function rcPackFor_(map, track) {
  const j = rcTrackJoined_(track), tk = rcTrackKeys_(track);
  const hit = map.find(m => m.keys && m.keys.length && (m.keys.every(k => j.indexOf(k) !== -1) ||
    (tk.length && m.joined && tk.every(k => m.joined.indexOf(k) !== -1))));
  return hit ? hit.pack : '';
}

/** große Objekte im Script-Cache in Stücken ablegen (ein Eintrag darf max. 100 KB haben) */
function rcCachePut_(key, obj, ttl) {
  try {
    const s = JSON.stringify(obj), parts = {}, n = Math.ceil(s.length / 40000);
    for (let i = 0; i < n; i++) parts[key + '_' + i] = s.slice(i * 40000, (i + 1) * 40000);
    parts[key] = String(n);
    CacheService.getScriptCache().putAll(parts, ttl);
  } catch (e) { console.error('Cache: ' + e); }
}
function rcCacheGet_(key) {
  try {
    const c = CacheService.getScriptCache(), n = parseInt(c.get(key), 10);
    if (!(n > 0)) return null;
    const keys = []; for (let i = 0; i < n; i++) keys.push(key + '_' + i);
    const got = c.getAll(keys);
    if (keys.some(k => got[k] == null)) return null;
    return JSON.parse(keys.map(k => got[k]).join(''));
  } catch (e) { return null; }
}

/** Liste für den Dialog „Neues Event“ (30 min zwischengespeichert) */
function adminRcList(force) {
  adminGuard_();
  const cache = CacheService.getScriptCache();
  const hit = !force && rcCacheGet_('rcList4');
  let list, packs;
  if (hit) { list = hit.list; packs = hit.packs; }
  else {
    let daily = [], ev = [], hosted = [], errs = [];
    try { daily = rcDaily_(); } catch (e) { errs.push('Daily: ' + e.message); }
    try { ev = rcCommunityList_(); } catch (e) { errs.push('Events: ' + e.message); }
    try { hosted = rcHosted_(); } catch (e) { errs.push('Hosted: ' + e.message); }
    if (!daily.length && !ev.length && !hosted.length) throw new Error('Keine Rennen geladen. ' + errs.join(' · '));
    const map = rcDlcMap_(ev);
    daily.concat(hosted).forEach(x => { x.dlc = rcPackFor_(map, x.track); });
    ev.forEach(x => {
      x.rounds.forEach(r => { r.dlc = rcPackFor_(map, r.track); });
      const u = {}; x.rounds.forEach(r => { if (r.dlc) u[r.dlc] = 1; });
      x.dlcs = Object.keys(u);
      delete x.trackDlc;
    });
    const p = {}; map.forEach(m => { p[m.pack] = 1; });
    packs = Object.keys(p).sort();
    list = daily.concat(ev, hosted);
    rcCachePut_('rcList4', { list: list, packs: packs }, 1800);
    try { cache.put('rcDlcMap2', JSON.stringify(map), 21600); } catch (e) { /* egal */ }
  }
  const now = Date.now();
  const fmt = ms => ({ local: Utilities.formatDate(new Date(ms), SYNC_TZ, "yyyy-MM-dd'T'HH:mm"), label: Utilities.formatDate(new Date(ms), SYNC_TZ, 'EEE dd.MM. HH:mm') });
  list = list.filter(x => x.start > now - 30 * 60000 || (x.rounds || []).some(r => r.start > now)).sort((a, b) => a.start - b.start);
  list.forEach(x => {
    Object.assign(x, fmt(x.start));
    (x.rounds || []).forEach(r => Object.assign(r, fmt(r.start)));
  });
  return { list: list, packs: packs, filter: JSON.parse(PropertiesService.getUserProperties().getProperty('rcFilter') || 'null') };
}

function adminRcSaveFilter(f) {
  adminGuard_();
  PropertiesService.getUserProperties().setProperty('rcFilter', JSON.stringify(f || {}));
  return true;
}

/** Runden eines Community-Events (Name, Strecke, Start, DLC) – auch für eingefügte Links */
function adminRcEvent(idOrUrl) {
  adminGuard_();
  const id = (String(idOrUrl).match(/events\/(\d+)/) || String(idOrUrl).match(/^(\d+)$/) || [])[1];
  if (!id) throw new Error('Kein Race-Control-Event-Link (…racecontrol.gg/events/12345)');
  const page = rcGet_('/events/' + id);
  const title = rcTxt_((page.match(/<title>([\s\S]*?)<\/title>/) || [])[1]).replace(/\s*[|–-]\s*RaceControl.*$/i, '');
  const h1 = rcTxt_((page.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1]);
  let mods = { tracks: [], carPacks: [] };
  try { mods = rcModded_(rcGet_('/events/' + id + '/modded_content')); } catch (e) { /* ohne DLC-Info */ }
  const cached = CacheService.getScriptCache().get('rcDlcMap2');
  const map = rcDlcMap_([{ trackDlc: mods.tracks }]).concat(cached ? JSON.parse(cached) : []);
  const rounds = rcRounds_(rcGet_('/events/' + id + '/races')).map(r => Object.assign(r, {
    dlc: rcPackFor_(map, r.track),
    local: Utilities.formatDate(new Date(r.start), SYNC_TZ, "yyyy-MM-dd'T'HH:mm"),
    label: Utilities.formatDate(new Date(r.start), SYNC_TZ, 'EEE dd.MM. HH:mm')
  }));
  return { id: id, name: h1 || title, url: RC_BASE + '/events/' + id, rounds: rounds, level: rcLevel_(page), carPacks: mods.carPacks };
}

/* ======================= Live-Dashboard ======================= */

function syncDoGet_(e) {
  const p = (e && e.parameter) || {};
  if (p.api === 'release') return lmuReleaseServe_(p);
  if (p.api === 'maplist' || p.api === 'maptrace') {
    const cb0 = /^[\w.$]+$/.test(p.callback || '') ? p.callback : 'callback';
    const d0 = p.api === 'maplist' ? mapList_() : mapTraces_(p.rows);
    return ContentService.createTextOutput(cb0 + '(' + JSON.stringify(d0) + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  if (p.api) {
    const cb = /^[\w.$]+$/.test(p.callback || '') ? p.callback : 'callback';
    const data = p.api === 'box' ? boxData_(p.drv) : syncGetData_(p.all === '1', p.drv);
    return ContentService.createTextOutput(cb + '(' + JSON.stringify(data) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  if (p.view === 'map') {
    const m = lmuTpl_('Map');
    m.apiUrl = ScriptApp.getService().getUrl();
    return m.evaluate().setTitle('LMU Strecken-Analyse')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
  }
  if (p.view === 'box') {
    const b = lmuTpl_('Box');
    b.apiUrl = ScriptApp.getService().getUrl();
    return b.evaluate().setTitle('LMU Box')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
  }
  const t = lmuTpl_('Live');
  t.apiUrl = ScriptApp.getService().getUrl();
  return t.evaluate().setTitle('LMU Live')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function syncTail_(name, n) {
  const sh = syncSheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const start = Math.max(2, last - n + 1);
  return sh.getRange(start, 1, last - start + 1, sh.getLastColumn()).getDisplayValues();
}

function syncField_(drv) {
  try { return JSON.parse(CacheService.getScriptCache().get('field_' + mdKey_(drv)) || CacheService.getScriptCache().get('field') || 'null'); } catch (e) { return null; }
}

function syncGetData_(all, sel) {
  const R = mdResolve_(sel);
  let live = R.live;
  let stints = syncTail_('Stints', 40).reverse();
  let pits = syncTail_('Boxenstopps', 30).reverse(), events = syncTail_('Ereignisse', 40).reverse();
  // nur das laufende Event (Event-Start inkl. Training … Rennende), wenn so eingestellt
  const filtered = !all && syncSetting_('Live nur aktives Rennen').toLowerCase() !== 'nein';
  let ev = null, next = null;
  if (filtered) {
    ev = mdEventWindow_(R.rk, 30 * 60e3, 30 * 60e3);
    const from = ev ? ev.start - 30 * 60e3 : Infinity, to = ev ? ev.end + 2 * 3600e3 : -Infinity;
    const inWin = d => { const t = d instanceof Date ? d.getTime() : Date.parse(d); return t >= from && t <= to; };
    // andere Fahrer, die gerade woanders fahren (andere Strecke), ausblenden
    const runs = mdRuns_(), trk = live && live.track;
    const mine = id => !trk || !runs[id] || runs[id].track === trk;
    stints = stints.filter(r => inWin(r[6]) && mine(r[0]));
    pits = pits.filter(r => inWin(r[0]) && mine(r[1]));
    events = events.filter(r => inWin(r[0]) && mine(r[1]));
    if (live && !inWin(live.ts)) live = null;
    if (!ev) {
      const ss = SpreadsheetApp.getActiveSpreadsheet(), now = Date.now();
      eventList_().forEach(e => { const w = eventWindow_(ss.getSheetByName(e.name)); if (w && w.start > now && (!next || w.start < next.start)) next = w; });
    }
  }
  const curId = live ? live.stint : (stints[0] ? stints[0][0] : '');
  const laps = curId ? syncTail_('Runden', 300).filter(r => r[1] === curId).slice(-40).reverse() : [];
  return {
    now: Date.now(),
    stream: syncSetting_('Stream-URL'),
    filtered: filtered,
    event: ev ? { name: ev.name, start: ev.start, race: ev.race, end: ev.end } : null,
    next: next ? { name: next.name, start: next.start, race: next.race } : null,
    sel: R.drv, cars: R.cars,
    live: live, stints: stints, laps: laps, field: live ? syncField_(live.driver) : null,
    pits: pits.slice(0, 10),
    events: events.slice(0, 10)
  };
}

/* ======================= Mechaniker-Board (Box) ======================= */
// Ansicht: <Web-App-URL>?view=box · Daten: ?api=box (JSONP)
// Ampeln: Energie (Runden bis leer), Reifen (%), Bremsen (°C), Motor (Wasser/Öl), Schaden (neu), Reifenschaden.

var boxFmt_ = a => (a || []).map(v => (v === '' || v == null ? '–' : Math.round(Number(v)))).join(' / ');

function boxLapCols_(ev) {
  const imo = ev.tyreIMO || [];
  const t = i => (imo[i] ? imo[i].map(v => Math.round(v)).join('/') : '');
  return [ev.battery !== undefined ? ev.battery : '', t(0), t(1), t(2), t(3),
    ev.press ? boxFmt_(ev.press) : '', ev.brake ? boxFmt_(ev.brake) : '',
    ev.water !== undefined ? ev.water : '', ev.oil !== undefined ? ev.oil : '',
    ev.dents !== undefined ? ev.dents + (ev.detached ? ' + Teile ab' : '') + (ev.flat ? ' + Platten' : '') : '',
    ev.air !== undefined ? ev.air : '', ev.wet !== undefined ? ev.wet : '',
    ev.tyreLaps ? ev.tyreLaps.join(' / ') : '', ev.compound || '', ev.hdl ? JSON.stringify(ev.hdl) : ''];
}

/** Fahrerwechsel: neuer Stint mit anderem Fahrer kurz nach einem Boxenstopp → beim Stopp vermerken */
function boxMarkDriverChange_(ev, ts) {
  const sh = syncSheet_('Boxenstopps');
  const last = sh.getLastRow();
  if (last < 2) return;
  const v = sh.getRange(last, 1, 1, 3).getValues()[0];
  const t = v[0] instanceof Date ? v[0].getTime() : 0;
  if (!t || ts.getTime() - t > 15 * 60000 || ts.getTime() < t - 60000) return;
  if (String(v[2]) && String(v[2]) !== String(ev.driver)) sh.getRange(last, 16).setValue('ja → ' + ev.driver);
}

/** Runden eines Stints (Objekte) aus dem Tab „Runden“ */
function boxStintLaps_(stintId, maxRows) {
  const rows = syncTail_('Runden', maxRows || 400);
  const out = [];
  rows.forEach(r => {
    if (r[1] !== stintId) return;
    const num = x => { const n = Number(String(x).replace(',', '.')); return isNaN(n) ? null : n; };
    out.push({ lap: num(r[4]), sec: num(r[6]), box: r[10] === 'ja', fuel: num(r[11]), fuelUsed: num(r[12]),
      ve: num(r[13]), veUsed: num(r[14]), wear: [num(r[15]), num(r[16]), num(r[17]), num(r[18])],
      hdl: (() => { try { return r[37] ? JSON.parse(r[37]) : null; } catch (e) { return null; } })() });
  });
  return out;
}

function boxAvg_(arr) { const a = arr.filter(x => x != null && x > 0); return a.length ? a.reduce((p, c) => p + c, 0) / a.length : null; }

/** Steigung (pro Runde) einer Reihe */
function boxSlope_(ys) {
  const pts = ys.map((y, i) => [i, y]).filter(p => p[1] != null);
  const n = pts.length;
  if (n < 3) return null;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  let num = 0, den = 0;
  pts.forEach(p => { num += (p[0] - mx) * (p[1] - my); den += (p[0] - mx) * (p[0] - mx); });
  return den ? num / den : null;
}

/** Stint-Zusammenfassung: Ø Sprit/Rd, Ø VE/Rd, Reifenabbau/Rd, Rundenzeit-Abfall s/Rd */
function boxStintSummary_(stintId) {
  const laps = boxStintLaps_(stintId, 600);
  const clean = laps.filter(l => !l.box && l.sec > 0);
  const fuel = boxAvg_(clean.map(l => l.fuelUsed));
  const ve = boxAvg_(clean.map(l => l.veUsed));
  let wear = '';
  if (laps.length >= 2) {
    const avgW = l => { const w = l.wear.filter(x => x != null); return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null; };
    const a = avgW(laps[0]), b = avgW(laps[laps.length - 1]);
    if (a != null && b != null && b <= a) wear = Math.round((a - b) / (laps.length - 1) * 100) / 100;
  }
  const slope = boxSlope_(clean.map(l => l.sec));
  return [fuel != null ? Math.round(fuel * 100) / 100 : '', ve != null ? Math.round(ve * 100) / 100 : '', wear,
    slope != null ? Math.round(slope * 1000) / 1000 : ''];
}

function boxLimits_() {
  const n = (k, d) => { const v = Number(String(syncSetting_(k)).replace(',', '.')); return isNaN(v) || !syncSetting_(k) ? d : v; };
  return {
    eRed: n('Ampel Energie rot (Runden)', 3), eYel: n('Ampel Energie gelb (Runden)', 6),
    tRed: n('Ampel Reifen rot (%)', 30), tYel: n('Ampel Reifen gelb (%)', 50),
    bRed: n('Ampel Bremse rot (°C)', 750), bYel: n('Ampel Bremse gelb (°C)', 650), bCold: n('Bremse kalt unter (°C)', 350),
    tCold: n('Reifen kalt unter (°C)', 70), tIdealLo: n('Reifen ideal von (°C)', 80), tIdealHi: n('Reifen ideal bis (°C)', 90),
    tHot: n('Reifen heiß über (°C)', 97),
    wRed: n('Ampel Wasser rot (°C)', 110), oRed: n('Ampel Öl rot (°C)', 130)
  };
}

/** Kennzahlen aus Live-Daten + letzten Runden des Stints */
function boxCalc_(live, laps) {
  const c = {};
  if (!live) return c;
  const clean = laps.filter(l => !l.box && l.sec > 0).slice(-5);
  c.fuelAvg = boxAvg_(clean.map(l => l.fuelUsed));
  c.veAvg = boxAvg_(clean.map(l => l.veUsed));
  c.lapAvg = boxAvg_(clean.map(l => l.sec));
  let left = Infinity;
  if (c.fuelAvg > 0.05 && live.fuel != null) left = live.fuel / c.fuelAvg;
  if (c.veAvg > 0.05 && live.ve > 0) left = Math.min(left, live.ve / c.veAvg);
  if (left === Infinity && live.lapsLeft != null) left = live.lapsLeft;
  c.lapsLeft = left === Infinity ? null : Math.round(left * 10) / 10;
  c.limitBy = c.veAvg > 0.05 && live.ve > 0 && c.fuelAvg > 0.05 && live.ve / c.veAvg < live.fuel / c.fuelAvg ? 'VE' : 'Sprit';
  // live.lap = abgeschlossene Runden. Mit der Restenergie schafft man mind. floor(lapsLeft) weitere volle Runden.
  c.boxLast = c.lapsLeft != null && live.lap != null ? live.lap + Math.max(0, Math.floor(c.lapsLeft)) : null;
  c.boxLap = c.boxLast != null ? Math.max(live.lap, c.boxLast - 1) : null;   // empfohlen: 1 Runde Reserve
  // Nachfüllen: bis voll, und was bis Rennende nötig wäre
  c.fillFull = live.fuelCap ? Math.max(0, Math.round((live.fuelCap - live.fuel) * 10) / 10) : null;
  c.veFull = live.ve != null ? Math.max(0, Math.round((100 - live.ve) * 10) / 10) : null;
  if (live.remaining > 0 && c.lapAvg > 0) {
    // Zeitrennen: nach Ablauf der Zeit wird die angefangene Runde noch zu Ende gefahren → +1
    const lapsToEnd = live.remaining / c.lapAvg + 1;
    c.lapsToEnd = Math.round(lapsToEnd * 10) / 10;
    if (c.fuelAvg) c.fuelToEnd = Math.max(0, Math.round((lapsToEnd * c.fuelAvg - live.fuel) * 10) / 10);
    if (c.veAvg) c.veToEnd = Math.max(0, Math.round((lapsToEnd * c.veAvg - (live.ve || 0)) * 10) / 10);
    c.toFinish = c.lapsLeft != null && c.lapsLeft >= lapsToEnd;   // reicht bis zur Zielflagge
  }
  // Reifentrend je Rad (% pro Runde, letzte bis zu 5 Runden)
  const w = laps.slice(-6);
  c.wearTrend = [0, 1, 2, 3].map(i => {
    const ys = w.map(l => l.wear[i]);
    const sl = boxSlope_(ys);
    return sl != null ? Math.round(-sl * 100) / 100 : null;
  });
  return c;
}

function boxLights_(live, calc, lim, dentsNew) {
  const L = [];
  const add = (key, label, state, text) => L.push({ key: key, label: label, state: state, text: text });
  if (!live) return L;
  const ll = calc.lapsLeft;
  add('energy', 'Energie', ll == null ? 'grey' : calc.toFinish ? 'green' : ll < lim.eRed ? 'red' : ll < lim.eYel ? 'yellow' : 'green',
    ll == null ? 'noch kein Verbrauch' : ll + ' Rd (' + (calc.limitBy || '') + ')' + (calc.toFinish ? ' · reicht bis Ziel' : ''));
  const wear = (live.wear || []).filter(v => v != null);
  const minW = wear.length ? Math.min.apply(null, wear) : null;
  add('tyres', 'Reifen', minW == null ? 'grey' : live.flat ? 'red' : minW < lim.tRed ? 'red' : minW < lim.tYel ? 'yellow' : 'green',
    live.flat ? 'Reifenschaden!' : minW == null ? '–' : 'min. ' + Math.round(minW) + ' %');
  const br = (live.brake || []).filter(v => v != null);
  const maxB = br.length ? Math.max.apply(null, br) : null;
  add('brakes', 'Bremsen', maxB == null || maxB <= 0 ? 'grey' : maxB > lim.bRed ? 'red' : maxB > lim.bYel ? 'yellow' : 'green',
    maxB == null || maxB <= 0 ? '–' : 'max. ' + Math.round(maxB) + ' °C');
  const hot = live.overheat || (live.water > lim.wRed) || (live.oil > lim.oRed);
  const warm = (live.water > lim.wRed - 5) || (live.oil > lim.oRed - 8);
  add('engine', 'Motor', live.water == null ? 'grey' : hot ? 'red' : warm ? 'yellow' : 'green',
    live.water == null ? '–' : 'Wasser ' + Math.round(live.water) + ' °C · Öl ' + Math.round(live.oil) + ' °C');
  add('damage', 'Schaden', live.dents == null ? 'grey' : (dentsNew || live.detached) ? 'red' : live.dents > 0 ? 'yellow' : 'green',
    live.dents == null ? '–' : (live.dents ? 'Stufe ' + live.dents : 'keiner') + (dentsNew ? ' – NEU' : '') + (live.detached ? ' · Teile ab' : ''));
  return L;
}

/** nach jedem Ereignis: Ampeln prüfen, bei neuem Rot Discord-Meldung */
function boxCheckLights_(ev) {
  if (ev._dup || (ev.type !== 'lap' && ev.type !== 'live')) return;
  const props = PropertiesService.getScriptProperties();
  const bk = 'boxState_' + mdKey_(ev.driver);
  const st = JSON.parse(props.getProperty(bk) || '{}');
  if (st.stint !== ev.stint) { st.stint = ev.stint; st.dents = ev.dents || 0; st.red = {}; }
  const dentsNew = ev.dents != null && ev.dents > (st.dents || 0);
  if (ev.dents != null) st.dents = ev.dents;
  if (dentsNew) st.dentsNewAt = Date.now();
  const recentDmg = st.dentsNewAt && Date.now() - st.dentsNewAt < 5 * 60000;
  // Live-Werte aus dem letzten Live-Paket ergänzen (Runden-Paket hat dieselben Felder)
  const live = ev.type === 'live' ? ev : Object.assign({}, JSON.parse(props.getProperty('live_' + mdKey_(ev.driver)) || props.getProperty('live') || '{}'), ev);
  const laps = ev.type === 'lap' ? boxStintLaps_(ev.stint, 200) : (st.laps || []);
  if (ev.type === 'lap') st.laps = laps.slice(-6);
  const lights = boxLights_(live, boxCalc_(live, laps), boxLimits_(), recentDmg);
  const newRed = lights.filter(l => l.state === 'red' && !(st.red || {})[l.key]);
  st.red = {}; lights.forEach(l => { if (l.state === 'red') st.red[l.key] = 1; });
  props.setProperty(bk, JSON.stringify(st));
  if (newRed.length && syncSetting_('Discord-Ampel').toLowerCase() !== 'nein' && discordUrl_()) {
    discordSend_('🚨 **Box-Ampel rot** – ' + (ev.driver || '') + ' (Rd. ' + (ev.lap || '?') + '): ' +
      newRed.map(l => l.label + ': ' + l.text).join(' · '));
  }
}

/** Sprit fürs Rennen: Ø-Verbrauch aus Training/Qualifying (gleiche Strecke + Auto) × Rennlänge aus dem aktiven Event */
function boxRaceFuel_(live, evName) {
  const num = x => { const v = Number(String(x == null ? '' : x).replace(',', '.')); return isNaN(v) ? null : v; };
  const median = a => { const b = a.slice().sort((x, y) => x - y); const m = Math.floor(b.length / 2); return b.length ? (b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2) : null; };
  const r1 = (v, d) => (v == null ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d));
  const out = { src: null, perLap: null, event: null, total: null, start: null };

  // 1) Verbrauch aus Training/Qualifying/Warmup
  if (live && live.track) {
    const stints = syncTail_('Stints', 3000);
    const pick = sameCar => {
      const ids = {};
      stints.forEach(r => {
        if (r[3] === live.track && (!sameCar || r[4] === live.car) && /training|quali|warm/i.test(r[2])) ids[r[0]] = r[2];
      });
      return ids;
    };
    let ids = pick(true), sameCar = true;
    if (!Object.keys(ids).length) { ids = pick(false); sameCar = false; }
    if (Object.keys(ids).length) {
      const laps = syncTail_('Runden', 20000).filter(r => ids[r[1]] && r[10] !== 'ja' && num(r[6]) > 30 && (num(r[12]) > 0.05 || num(r[14]) > 0.05)).slice(-40);
      if (laps.length >= 2) {
        const sess = {};
        laps.forEach(r => { sess[ids[r[1]]] = 1; });
        out.src = { laps: laps.length, sessions: Object.keys(sess).join(', '), sameCar: sameCar, track: live.track, car: live.car || '',
          lapSec: r1(median(laps.map(r => num(r[6]))), 3) };
        const f = laps.map(r => num(r[12])).filter(v => v > 0.05), v = laps.map(r => num(r[14])).filter(x => x > 0.05);
        out.perLap = { fuel: f.length ? r1(median(f), 2) : null, ve: v.length ? r1(median(v), 2) : null, from: 'Training/Qualifying' };
        // Liter Sprit je 1 % VE (in LMU „Kraftstoffkapazität“), aus Runden mit beiden Werten
        const ratios = laps.map(r => (num(r[12]) > 0.05 && num(r[14]) > 0.05 ? num(r[12]) / num(r[14]) : null)).filter(x => x > 0.1 && x < 5);
        if (ratios.length >= 2) out.perLap.ratio = r1(median(ratios), 3);
      }
    }
  }

  // 2) Rennlänge aus dem aktiven Event-Tab
  const tab = evName || syncSetting_('Plan-Tab');
  const sh = tab && SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tab);
  if (sh) {
    const d = sh.getRange('A1:E5').getDisplayValues();
    const dur = toSec_(d[4][1]), lap = toSec_(d[1][1]), pit = toSec_(d[2][1]) || 0;
    const per = /Runden pro Stint/.test(d[1][3]) ? num(d[1][4]) : null;
    const reserve = /Reserve/.test(d[4][3]) ? (num(d[4][4]) || 0) : 1;
    const planCons = /Verbrauch/.test(d[3][3]) ? num(d[3][4]) : null;
    if (dur > 0 && lap > 0) {
      const stints = per > 0 ? Math.ceil(dur / (per * lap + pit)) : 1;
      const laps = Math.ceil(Math.max(0, dur - (stints - 1) * pit) / lap);
      out.event = { name: tab, durSec: dur, lapSec: lap, laps: laps, lapsPerStint: per, reserve: reserve, stints: stints };
      if (!out.perLap && planCons > 0) out.perLap = /VE/.test(d[3][3]) ? { fuel: null, ve: planCons, from: 'Plan (E4)' } : { fuel: planCons, ve: null, from: 'Plan (E4)' };
    }
  }

  // 3) Menge
  if (out.perLap && out.event) {
    const L = out.event.laps + out.event.reserve, cap = live && live.fuelCap > 0 ? live.fuelCap : null;
    const tf = out.perLap.fuel ? out.perLap.fuel * L : null, tv = out.perLap.ve ? out.perLap.ve * L : null;
    out.total = { fuel: r1(tf, 1), ve: r1(tv, 1), laps: L };
    const fits = (tf == null || cap == null || tf <= cap) && (tv == null || tv <= 100);
    if (fits) out.start = { fuel: r1(tf, 1), ve: tv != null ? Math.ceil(tv) : null, laps: L, noStop: true, stops: 0 };
    else {
      const sl = (out.event.lapsPerStint || 0) + out.event.reserve;
      let sf = !out.perLap.fuel ? null : sl > out.event.reserve ? out.perLap.fuel * sl : cap;
      let sv = out.perLap.ve && sl > out.event.reserve ? out.perLap.ve * sl : (out.perLap.ve ? 100 : null);
      if (cap && sf > cap) sf = cap;
      if (sv > 100) sv = 100;
      const stopsF = tf != null && cap ? Math.ceil(tf / cap) - 1 : 0, stopsV = tv != null ? Math.ceil(tv / 100) - 1 : 0;
      out.start = { fuel: r1(sf, 1), ve: sv != null ? Math.ceil(sv) : null, laps: out.event.lapsPerStint, noStop: false,
        full: (cap && sf != null && sf >= cap) || sv >= 100, stops: Math.max(stopsF, stopsV, out.event.stints - 1) };
    }
  }
  // Werte für LMU: Auto-Setup → Antriebsstrang → Motor („Virtuelle Energie“ %, „Kraftstoffkapazität“ = Liter je 1 % VE)
  if (out.start && out.perLap) {
    const cap = live && live.fuelCap > 0 ? live.fuelCap : null;
    if (out.start.ve != null) {
      const veSet = Math.min(100, Math.max(1, out.start.ve));
      let ratio = out.perLap.ratio || (out.perLap.fuel && out.perLap.ve ? out.perLap.fuel / out.perLap.ve : null);
      if (ratio) {
        ratio = Math.ceil(ratio * 1.03 * 100) / 100;          // 3 % mehr Sprit als nötig: Sprit geht nie vor der VE aus
        if (cap && ratio * veSet > cap) ratio = Math.floor(cap / veSet * 100) / 100;
      }
      out.setup = { ve: veSet, ratio: ratio ? r1(ratio, 2) : null, litres: ratio ? r1(ratio * veSet, 1) : null, kind: 've' };
    } else if (out.start.fuel != null) {
      out.setup = { fuel: Math.ceil(out.start.fuel), kind: 'fuel' };
    }
  }
  return out;
}

/** Daten fürs Mechaniker-Board */
function boxData_(sel) {
  const props = PropertiesService.getScriptProperties();
  const R = mdResolve_(sel);
  const live = R.live;
  const st = JSON.parse(props.getProperty('boxState_' + mdKey_(live && live.driver)) || props.getProperty('boxState') || '{}');
  const laps = live ? boxStintLaps_(live.stint, 300) : [];
  const calc = boxCalc_(live, laps);
  const recentDmg = st.dentsNewAt && Date.now() - st.dentsNewAt < 5 * 60000;
  const pits = syncTail_('Boxenstopps', 8).reverse().map(r => ({ time: r[0], driver: r[2], lap: r[3], lane: r[4], stop: r[5],
    fuel: r[6], ve: r[7], tyres: r[8], which: r[13] || '', repair: r[9], dmg: r[14] || '', change: r[15] || '' }));
  const stints = syncTail_('Stints', 6).reverse().map(r => ({ driver: r[1], start: r[6], laps: r[8], best: r[9], avg: r[10],
    fuel: r[26] || '', ve: r[27] || '', wear: r[28] || '', drop: r[29] || '' }));
  const tp = boxTips_(laps, live, boxLimits_());
  let lmu = JSON.parse(props.getProperty('lmuSetup_' + mdKey_(live ? live.driver : R.drv)) || (R.cars.length ? 'null' : props.getProperty('lmuSetup')) || 'null');
  if (lmu && Date.now() - lmu.ts > 6 * 3600000) lmu = null;          // älter als 6 h: nicht mehr aussagekräftig
  // VE-Ziel für den nächsten Stopp: was nach dem Stopp bis zur Zielflagge (+1 Rd Reserve) noch gebraucht wird
  if (lmu && calc && calc.veAvg > 0 && calc.lapsToEnd != null && calc.lapsLeft != null && !calc.toFinish) {
    const after = Math.max(0, calc.lapsToEnd - Math.floor(calc.lapsLeft));
    const need = Math.ceil(calc.veAvg * (after + 1));
    lmu.next = { laps: Math.round(after * 10) / 10, ve: Math.min(100, need), more: need > 100 };
  }
  const evName = R.rk ? mdRunEvent_(R.rk) : null;
  return { sel: R.drv, cars: R.cars, lmu: lmu, now: Date.now(), live: live, calc: calc, lights: boxLights_(live, calc, boxLimits_(), recentDmg),
    laps: laps.slice(-8).reverse().map(l => { const c = Object.assign({}, l); delete c.hdl; return c; }),
    pits: pits, stints: stints, limits: boxLimits_(), tips: tp.tips, hdl: tp.agg, field: syncField_(live && live.driver), race: (() => { try { return boxRaceFuel_(live, evName); } catch (e) { return { err: String(e.message || e) }; } })() };
}

/* ======================= Setup-Tipps (Fahrverhalten) ======================= */
// Grundlage: Kennzahlen „hdl“ pro Runde aus der exe (ab 2.3) + Reifen-/Bremsen-/Motorwerte.
// Faustregeln – Richtung, keine absoluten Setup-Werte. Erst ab mehreren Runden mit demselben Muster.

function boxHdlAgg_(laps) {
  const L = laps.filter(l => l.hdl).slice(-5);
  if (!L.length) return null;
  const a = { laps: L.length, set: L[L.length - 1].hdl.set || null };
  ['entry', 'mid', 'exit'].forEach(ph => {
    let n = 0, us = 0, os = 0, cntUs = 0, cntOs = 0;
    L.forEach(l => {
      const p = l.hdl[ph] || {}, k = p.n || 0;
      n += k; us += (p.us || 0) * k; os += (p.os || 0) * k;
      if (k >= 10 && p.us >= 20) cntUs++;
      if (k >= 10 && p.os >= 12) cntOs++;
    });
    a[ph] = { n: n, us: n ? Math.round(us / n) : 0, os: n ? Math.round(os / n) : 0, lapsUs: cntUs, lapsOs: cntOs };
  });
  const w = (key, nKey) => {
    let n = 0, v = 0, cnt = 0;
    L.forEach(l => { const k = l.hdl[nKey] || 0; n += k; v += (l.hdl[key] || 0) * k; if (k >= 10 && (l.hdl[key] || 0) > 0) cnt++; });
    return { v: n ? Math.round(v / n * 10) / 10 : 0, n: n, laps: cnt };
  };
  a.lockF = w('lockF', 'brakeN'); a.lockR = w('lockR', 'brakeN'); a.abs = w('abs', 'brakeN');
  a.spin = w('spin', 'exitN'); a.tc = w('tc', 'exitN');
  a.bottom = { v: Math.round(L.reduce((s, l) => s + (l.hdl.bottom || 0), 0) / L.length * 10) / 10 };
  return a;
}

function boxTips_(laps, live, lim) {
  const tips = [];
  const a = boxHdlAgg_(laps);
  const S = (a && a.set) || {};
  const has = k => S[k + 'Max'] > 0;
  const step = (k, d, label, note) => {
    if (!has(k)) return null;
    const to = Math.max(0, Math.min(S[k + 'Max'], S[k] + d));
    return to === S[k] ? label + ' steht schon am Anschlag (' + S[k] + ')' : label + ' ' + S[k] + ' → ' + to + (note || '');
  };
  const de = x => x.toFixed(1).replace('.', ',');
  const bias = d => (S.bias ? 'Bremsbalance ' + de(S.bias) + ' % → ' + de(S.bias + d) + ' % vorne' : 'Bremsbalance ' + (d < 0 ? 'nach hinten' : 'nach vorne') + ' (0,5 %)');
  const tip = (area, lvl, title, why, car, garage) =>
    tips.push({ area: area, level: lvl, title: title, why: why, car: car.filter(Boolean), garage: garage || '' });
  const basis = (p, k) => 'Ø letzte ' + a.laps + ' Rd: ' + p[k] + ' % der Kurvenphase' + (a.laps > 1 ? ' (in ' + p[k === 'us' ? 'lapsUs' : 'lapsOs'] + ' von ' + a.laps + ' Rd)' : '');
  const solid = (p, k) => p.n >= 20 && (a.laps === 1 || p[k === 'us' ? 'lapsUs' : 'lapsOs'] >= 2);

  if (a) {
    const E = a.entry, M = a.mid, X = a.exit;
    if (E.us >= 20 && solid(E, 'us')) tip('Balance', 'warn', 'Untersteuern beim Einlenken', basis(E, 'us'),
      [bias(-0.5), step('arbF', -1, 'Stabi vorne', ' (weicher)')], 'Garage: Frontflügel +1 oder Druckstufe vorne weicher');
    if (M.us >= 20 && solid(M, 'us')) tip('Balance', 'warn', 'Untersteuern in der Kurvenmitte', basis(M, 'us'),
      [step('arbF', -1, 'Stabi vorne', ' (weicher)'), step('arbR', +1, 'Stabi hinten', ' (härter)')], 'Garage: Frontflügel +1, Fahrhöhe hinten +1');
    if (X.us >= 20 && solid(X, 'us')) tip('Balance', 'info', 'Untersteuern am Kurvenausgang', basis(X, 'us'),
      [step('arbR', +1, 'Stabi hinten', ' (härter)'), 'Fahrer: Lenkung früher öffnen, Gas progressiver'], 'Garage: Differenzial (Zug) etwas weniger Sperre');
    if (E.os >= 12 && solid(E, 'os')) tip('Balance', 'warn', 'Unruhiges Heck beim Einlenken / Bremsen', basis(E, 'os'),
      [bias(+0.5), step('mig', -1, 'Bremsmigration'), step('arbR', -1, 'Stabi hinten', ' (weicher)')], 'Garage: Differenzial (Schub) mehr Sperre, Motorbremse erhöhen');
    if (M.os >= 12 && solid(M, 'os')) tip('Balance', 'warn', 'Übersteuern in der Kurvenmitte', basis(M, 'os'),
      [step('arbR', -1, 'Stabi hinten', ' (weicher)'), step('arbF', +1, 'Stabi vorne', ' (härter)')], 'Garage: Heckflügel +1');
    if ((X.os >= 15 && solid(X, 'os')) || (a.spin.v >= 12 && a.spin.n >= 30)) tip('Traktion', 'warn', 'Übersteuern / Durchdrehen am Ausgang',
      'Heck rutscht in ' + X.os + ' % der Ausgänge, Hinterräder drehen in ' + a.spin.v + ' % durch',
      [step('tc', +1, 'TC', ' (mehr Eingriff – bei manchen Autos ist die Skala umgekehrt)'), step('tcSlip', -1, 'TC-Slip'), has('map') ? 'Motor-Map auf eine Stufe mit weniger Leistung (aktuell ' + S.map + ' von ' + S.mapMax + ')' : null],
      'Garage: Differenzial (Zug) weniger Sperre, Stabi/Feder hinten weicher');
    if (a.tc.v >= 50 && a.spin.v < 5 && a.tc.n >= 30) tip('Traktion', 'info', 'TC greift sehr oft ein', 'TC aktiv in ' + a.tc.v + ' % der Ausgänge, kaum Durchdrehen',
      [step('tc', -1, 'TC', ' (weniger Eingriff → mehr Vortrieb)')], '');
    if (a.lockF.v >= 8 && a.lockF.n >= 30) tip('Bremsen', 'warn', 'Vorderräder blockieren', 'in ' + a.lockF.v + ' % der Bremsphasen',
      [bias(-0.5), step('abs', +1, 'ABS', ' (mehr Eingriff)')], '');
    if (a.lockR.v >= 6 && a.lockR.n >= 30) tip('Bremsen', 'warn', 'Hinterräder blockieren', 'in ' + a.lockR.v + ' % der Bremsphasen',
      [bias(+0.5), step('mig', +1, 'Bremsmigration')], 'Garage: Motorbremse verringern');
    if (a.abs.v >= 50 && a.lockF.v < 3 && a.lockR.v < 3 && a.abs.n >= 30) tip('Bremsen', 'info', 'ABS regelt sehr oft', 'ABS aktiv in ' + a.abs.v + ' % der Bremsphasen',
      [step('abs', -1, 'ABS', ' (weniger Eingriff → kürzerer Bremsweg)')], '');
    if (a.bottom.v >= 2) tip('Fahrwerk', 'warn', 'Auto setzt auf', 'Bodenkontakt in ' + a.bottom.v + ' % der schnellen Passagen',
      [], 'Garage: Fahrhöhe +1 oder Federn/Packer härter (an der Achse, die aufsetzt)');
  }

  // Reifen: Temperaturverteilung innen/mitte/außen (Achse gemittelt)
  if (live && live.tyreIMO && live.tyreIMO.length === 4 && !live.inPits) {
    [['vorne', 0, 1], ['hinten', 2, 3]].forEach(([ax, i, j]) => {
      const t = live.tyreIMO;
      if (!t[i] || !t[j]) return;
      const I = (t[i][0] + t[j][0]) / 2, Mi = (t[i][1] + t[j][1]) / 2, O = (t[i][2] + t[j][2]) / 2;
      if (!(I > 30)) return;
      if (I - O > 12) tip('Reifen', 'info', 'Reifen ' + ax + ' innen viel heißer', 'innen ' + Math.round(I) + ' °C, außen ' + Math.round(O) + ' °C', [], 'Garage: Sturz ' + ax + ' weniger negativ (−0,2 bis −0,3°)');
      else if (O - I > 3) tip('Reifen', 'info', 'Reifen ' + ax + ' außen heißer als innen', 'innen ' + Math.round(I) + ' °C, außen ' + Math.round(O) + ' °C', [], 'Garage: Sturz ' + ax + ' negativer (+0,2°)');
      const edge = (I + O) / 2;
      if (Mi - edge > 5) tip('Reifen', 'info', 'Reifenmitte ' + ax + ' zu heiß', 'Mitte ' + Math.round(Mi) + ' °C, Ränder Ø ' + Math.round(edge) + ' °C', [], 'Garage: Luftdruck ' + ax + ' senken (−1 bis −2 kPa)');
      else if (edge - Mi > 5) tip('Reifen', 'info', 'Reifenmitte ' + ax + ' zu kalt', 'Mitte ' + Math.round(Mi) + ' °C, Ränder Ø ' + Math.round(edge) + ' °C', [], 'Garage: Luftdruck ' + ax + ' erhöhen (+1 bis +2 kPa)');
    });
  }
  if (live && lim && live.tyreIMO && live.tyreIMO.length === 4 && !live.inPits) {
    const names = ['VL', 'VR', 'HL', 'HR'];
    const avgT = live.tyreIMO.map(t => (t && t.length ? t.reduce((x, y) => x + y, 0) / t.length : null));
    const hot = names.filter((n, i) => avgT[i] > lim.tHot), cold = names.filter((n, i) => avgT[i] != null && avgT[i] > 5 && avgT[i] < lim.tCold);
    const fmt = list => list.map(n => n + ' ' + Math.round(avgT[names.indexOf(n)]) + ' °C').join(', ');
    if (hot.length) tip('Reifen', 'warn', 'Reifen überhitzen', fmt(hot) + ' (über ' + lim.tHot + ' °C: Grip und Verschleiß leiden)',
      ['Fahrer: Rutschen vermeiden, sanfter auf Gas und Lenkung'], 'Garage: Luftdruck senken (−1 bis −2 kPa), ggf. härtere Mischung');
    else if (cold.length && (live.stintLaps == null || live.stintLaps >= 2)) tip('Reifen', 'info', 'Reifen zu kalt', fmt(cold) + ' (unter ' + lim.tCold + ' °C: wenig Grip)',
      ['Fahrer: Reifen aufwärmen (härter anbremsen, nicht schlängeln)'], 'Garage: Luftdruck etwas erhöhen (+1 kPa), ggf. weichere Mischung');
  }
  if (live && lim) {
    const br = (live.brake || []).filter(v => v > 0);
    if (br.length === 4 && !live.inPits && Math.max.apply(null, br) < lim.bCold && (live.stintLaps == null || live.stintLaps >= 2))
      tip('Kühlung', 'info', 'Bremsen zu kalt', 'max. ' + Math.round(Math.max.apply(null, br)) + ' °C (unter ' + lim.bCold + ' °C: weniger Bremswirkung, ABS früher)',
        [], 'Garage/Box: Bremskühlung schließen (kleinere Öffnung)');
    if (br.length && Math.max.apply(null, br) > lim.bYel) tip('Kühlung', 'warn', 'Bremsen sehr heiß', 'max. ' + Math.round(Math.max.apply(null, br)) + ' °C',
      ['Fahrer: Bremsbalance prüfen, früher vom Gas (Lift & Coast)'], 'Garage/Box: Bremskühlung weiter öffnen');
    if (live.water > lim.wRed - 5 || live.overheat) tip('Kühlung', 'warn', 'Motor wird heiß', 'Wasser ' + Math.round(live.water) + ' °C, Öl ' + Math.round(live.oil) + ' °C',
      ['Fahrer: Windschatten meiden, Abstand zum Vordermann'], 'Box: Kühleröffnung vergrößern (kostet etwas Topspeed)');
    if (live.wet > 20 && !/wet|rain|regen|inter/i.test(live.compound || '')) tip('Reifen', 'warn', 'Strecke nass', 'Nässe ' + Math.round(live.wet) + ' %',
      ['Box: Regen-/Intermediate-Reifen erwägen'], '');
  }
  const order = { warn: 0, info: 1 };
  tips.sort((x, y) => order[x.level] - order[y.level]);
  return { tips: tips, agg: a };
}

/* ======================= Rundenzeit-Vorschlag (eigene Daten + BoP Tourism) ======================= */
// Referenz: bop-tourism.com/laptimes/<strecke> – Verteilung der echten Pace aus offiziellen LMU-Rennen
// (Median je Driver-Rating und Perzentil-Stufen), getrennt nach Klasse, Setup (offen/fix) und Renndauer.

var BOP_BASE = 'https://bop-tourism.com';
var LR_CLASSES = { gt3: 'GT3', hypercar: 'Hypercar', lmp2: 'LMP2', lmp3: 'LMP3' };

function lrTxt_(s) {
  return String(s || '').replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&le;|&#8804;/g, '≤').replace(/&amp;/g, '&').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
}

/** Streckenliste von BoP Tourism (24 h zwischengespeichert) */
function lrTracks_() {
  const c = CacheService.getScriptCache();
  const hit = c.get('bopTracks');
  if (hit) return JSON.parse(hit);
  const r = UrlFetchApp.fetch(BOP_BASE + '/laptimes', { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('BoP Tourism nicht erreichbar (' + r.getResponseCode() + ')');
  const out = [], seen = {};
  r.getContentText().replace(/href="\/laptimes\/([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, slug, inner) => {
    if (seen[slug]) return;
    seen[slug] = 1;
    out.push({ slug: slug, name: lrTxt_(inner).replace(/[›>]/g, '').trim() });
  });
  c.put('bopTracks', JSON.stringify(out), 21600);
  return out;
}

/** passende BoP-Strecke zu einem Streckennamen (LMU, Race Control oder Freitext) */
function lrMatchTrack_(tracks, name) {
  const norm = s => String(s || '').toLowerCase().replace(/_?20\d\d/g, ' ').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const n = norm(name), nj = n.replace(/ /g, '');
  if (!n) return null;
  const alias = [[/cota|americas|cot a/, 'cota'], [/sarthe|le mans|lemans/, 'circuit-de-la-sarthe'], [/spa/, 'spa-francorchamps'],
    [/barcelona|catalunya/, 'barcelona'], [/lusail|qatar/, 'qatar'], [/portim|algarve/, 'portimao'], [/interlagos|carlos pace/, 'interlagos'],
    [/road atlanta|michelin raceway/, 'road-atlanta'], [/long beach/, 'long-beach'], [/laguna/, 'laguna-seca'], [/daytona/, 'daytona']];
  // exakter/teilweiser Namensvergleich zuerst (wegen Varianten wie „Outer“, „Classic“, „Curva Grande“)
  let best = null, bestScore = 0;
  tracks.forEach(t => {
    const tn = norm(t.name), tj = tn.replace(/ /g, '');
    let score = 0;
    if (tj === nj) score = 100;
    else {
      const words = tn.split(' ').filter(w => w.length >= 4 && ['circuit', 'international', 'speedway', 'raceway'].indexOf(w) === -1);
      const hits = words.filter(w => nj.indexOf(w) !== -1).length;
      if (hits) score = hits * 10 - (words.length - hits) * 3;
    }
    if (score > bestScore) { bestScore = score; best = t; }
  });
  if (best && bestScore >= 7) return best;
  const a = alias.find(x => x[0].test(n));
  return a ? tracks.find(t => t.slug === a[1]) || null : null;
}

/** Werte einer BoP-Streckenseite: {klasse: [{setup, kind, n, drivers, med:{…}, tiers:{…}}]} */
function lrBopPage_(slug) {
  const c = CacheService.getScriptCache();
  const hit = c.get('bop_' + slug);
  if (hit) return JSON.parse(hit);
  const r = UrlFetchApp.fetch(BOP_BASE + '/laptimes/' + slug, { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('BoP-Seite nicht gefunden (' + r.getResponseCode() + ')');
  const parts = r.getContentText().split(/id="mark-([a-z0-9]+)-(open|fixed)-(quali|race)-([a-z0-9]+)"/);
  const out = {};
  for (let i = 1; i + 4 < parts.length; i += 5) {
    const cls = parts[i], body = lrTxt_(parts[i + 4]).slice(0, 5000);
    const med = {}, tiers = {};
    const mm = body.match(/MEDIAN BY DRIVER RATING(.*?)(ALIEN|Each driver|$)/i);
    if (mm) mm[1].replace(/(Bronze 1-2|Bronze 3|Silver 1|Silver 2\+)\s+(\d+:\d+\.\d+)/gi, (_, k, v) => { med[k] = v; });
    body.replace(/(ALIEN|GOLD|SILVER|BRONZE|ROOKIE)\s+top\s+[\d.]+%\D{0,8}(\d+:\d+\.\d+)/gi, (_, k, v) => { k = k.toUpperCase(); if (!tiers[k]) tiers[k] = v; });
    const sm = body.match(/([\d,.]+) drivers · p10/);
    (out[cls] = out[cls] || []).push({ setup: parts[i + 1], kind: parts[i + 2], n: parts[i + 3],
      drivers: sm ? Number(sm[1].replace(/[,.]/g, '')) : 0, med: med, tiers: tiers });
  }
  try { c.put('bop_' + slug, JSON.stringify(out), 21600); } catch (e) { /* zu groß */ }
  return out;
}

var lrLenLabel_ = { '1': 'Rennen', '2': 'Rennen 20–40 min', '3': 'Rennen 40–60 min', '4': 'Rennen ab 60 min', q: 'Qualifying' };

/** eigene Pace aus den Tabs Stints + Runden (gleiche Strecke, gleiche Klasse) */
function lrOwnPace_(trackName, cls) {
  const stints = syncTail_('Stints', 2000);
  const tracks = lrTracks_();
  const target = lrMatchTrack_(tracks, trackName);
  const clsRe = { gt3: /gt3/i, hypercar: /hyper/i, lmp2: /lmp2/i, lmp3: /lmp3/i }[cls] || /./;
  const ids = {};
  stints.forEach(r => {
    const t = lrMatchTrack_(tracks, r[3]);
    if (t && target && t.slug === target.slug && clsRe.test(r[5] + ' ' + r[4])) ids[r[0]] = { driver: r[1], car: r[4] };
  });
  if (!Object.keys(ids).length) return null;
  const by = {}, fuel = [], ve = [];
  const num = x => Number(String(x).replace(',', '.'));
  syncTail_('Runden', 20000).forEach(r => {
    const s = ids[r[1]];
    if (!s || r[10] === 'ja') return;
    const sec = num(r[6]);
    if (!(sec > 30)) return;
    (by[s.driver] = by[s.driver] || []).push(sec);
    if (num(r[12]) > 0.05) fuel.push(num(r[12]));
    if (num(r[14]) > 0.05) ve.push(num(r[14]));
  });
  const median = a => { const b = a.slice().sort((x, y) => x - y); const m = Math.floor(b.length / 2); return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  const drivers = Object.keys(by).filter(d => by[d].length >= 3).map(d => {
    const laps = by[d].slice().sort((x, y) => x - y);
    const cut = laps.slice(0, Math.max(3, Math.ceil(laps.length * 0.9))); // langsamste 10 % (Verkehr, Fehler) weglassen
    return { driver: d, laps: laps.length, median: Math.round(median(cut) * 1000) / 1000, best: laps[0] };
  });
  if (!drivers.length) return null;
  const all = [].concat.apply([], drivers.map(d => by[d.driver]));
  return { drivers: drivers, team: Math.round(median(all) * 1000) / 1000, laps: all.length,
    fuelPerLap: fuel.length >= 3 ? Math.round(median(fuel) * 100) / 100 : null,
    vePerLap: ve.length >= 3 ? Math.round(median(ve) * 100) / 100 : null };
}

/** für den Dialog „Neues Event“: Vorschläge für die Rundenzeit */
function adminLapSuggest(o) {
  adminGuard_();
  const cls = LR_CLASSES[o.cls] ? o.cls : 'gt3';
  const durMin = Number(o.durMin) || 60;
  const res = { cls: LR_CLASSES[cls], track: '', own: null, bop: null, bopUrl: '', err: '' };
  let tracks = [];
  try { tracks = lrTracks_(); } catch (e) { res.err = e.message; }
  const t = tracks.length ? lrMatchTrack_(tracks, o.track) : null;
  res.track = t ? t.name : String(o.track || '');
  try { res.own = lrOwnPace_(o.track, cls); } catch (e) { res.ownErr = String(e.message || e); }
  if (t) {
    res.bopUrl = BOP_BASE + '/laptimes/' + t.slug + '#' + cls;
    try {
      const page = lrBopPage_(t.slug)[cls] || [];
      const setup = o.setup === 'fixed' ? 'fixed' : 'open';
      const want = durMin >= 60 ? '4' : durMin >= 40 ? '3' : durMin >= 20 ? '2' : '1';
      const races = page.filter(x => x.kind === 'race');
      const pick = races.find(x => x.setup === setup && x.n === want) ||
        races.filter(x => x.setup === setup).sort((a, b) => b.drivers - a.drivers)[0] ||
        races.sort((a, b) => b.drivers - a.drivers)[0] ||
        page.find(x => x.kind === 'quali');
      if (pick) res.bop = { setup: pick.setup === 'fixed' ? 'festes Setup' : 'offenes Setup', label: lrLenLabel_[pick.n] || pick.n,
        drivers: pick.drivers, med: pick.med, tiers: pick.tiers, quali: pick.kind === 'quali' };
      else res.err = 'Für ' + LR_CLASSES[cls] + ' gibt es auf dieser Strecke noch keine Daten.';
    } catch (e) { res.err = String(e.message || e); }
  } else if (!res.err) res.err = 'Strecke bei BoP Tourism nicht gefunden.';
  return res;
}

function adminLapTracks() {
  adminGuard_();
  let t = [];
  try { t = lrTracks_().map(x => x.name); } catch (e) { /* offline */ }
  return t;
}

/* ======================= Event-Dialog (generiert aus Event.html) ======================= */
var EVENT_HTML = "<!DOCTYPE html>\n<html>\n<head>\n<base target=\"_blank\">\n<meta charset=\"utf-8\">\n<style>\n  body{font:13px/1.45 Roboto,Arial,sans-serif;color:#202124;margin:0;padding:2px 6px}\n  label{display:block;font-size:12px;color:#5f6368;margin:9px 0 2px}\n  input,select{width:100%;box-sizing:border-box;font:inherit;padding:5px 6px;border:1px solid #dadce0;border-radius:4px}\n  .row{display:flex;gap:8px}\n  .row>*{flex:1}\n  .muted{color:#5f6368;font-size:12px}\n  .drv{display:flex;align-items:center;gap:6px;padding:4px 6px;border:1px solid #e0e0e0;border-radius:6px;margin:4px 0;background:#fff}\n  .drv input[type=checkbox]{width:auto}\n  .drv span{flex:1}\n  .drv button{padding:0 7px;font-size:13px}\n  button{font:inherit;border:1px solid #dadce0;background:#fff;border-radius:4px;padding:5px 12px;cursor:pointer}\n  button.primary{background:#1a73e8;border-color:#1a73e8;color:#fff}\n  button:disabled{opacity:.5;cursor:default}\n  .box{background:#f1f3f4;border-radius:6px;padding:8px 10px;margin-top:10px}\n  .err{color:#c5221f}\n  #preview{white-space:pre-line}\n  .rc{border:1px solid #dadce0;border-radius:8px;padding:8px 10px;margin-bottom:6px;background:#fafafa}\n  .rc summary{cursor:pointer;font-weight:600}\n  .chips{display:flex;flex-wrap:wrap;gap:4px 10px;margin:6px 0 2px}\n  .chips label{display:flex;align-items:center;gap:4px;margin:0;color:#202124;font-size:12px}\n  .chips input{width:auto;margin:0}\n  .grp{font-size:11px;color:#5f6368;font-weight:600;text-transform:uppercase;margin-top:6px}\n  #rcList{max-height:190px;overflow:auto;margin-top:6px;border-top:1px solid #e0e0e0}\n  .it{padding:5px 4px;border-bottom:1px solid #eee;cursor:pointer}\n  .it:hover{background:#e8f0fe}\n  .it b{font-weight:600}\n  .lv{display:inline-block;font-size:10px;font-weight:700;padding:0 6px;border-radius:99px;margin-left:4px;text-transform:uppercase;vertical-align:1px}\n  .lv.beginner{background:#e6f4ea;color:#137333}.lv.intermediate{background:#fef7e0;color:#b06000}.lv.advanced{background:#fce8e6;color:#c5221f}\n  .lv.offen{background:#e8eaed;color:#3c4043}.lv.bronze{background:#f3e0cf;color:#8a4b14}.lv.silver{background:#e8eaed;color:#5f6368}\n  .lv.gold{background:#fdf0b8;color:#8a6d00}.lv.platinum{background:#e0f2f1;color:#00695c}\n  .team{font-size:10px;color:#1a73e8;font-weight:700;margin-left:4px}\n  .dlc{display:inline-block;font-size:10px;font-weight:600;padding:0 5px;border-radius:4px;background:#ede7f6;color:#5e35b1;margin-left:4px}\n  .dlc.miss{background:#fce8e6;color:#c5221f}\n  .it.off{opacity:.5}\n  .sg{border:1px solid #dadce0;border-radius:8px;padding:6px 8px;margin-top:6px;background:#fafafa;font-size:12px}\n  .sg .h{font-weight:600;margin:4px 0 2px}\n  .chip{display:inline-block;border:1px solid #c6dafc;background:#e8f0fe;color:#174ea6;border-radius:99px;padding:1px 8px;margin:2px 3px 2px 0;cursor:pointer;font-size:12px}\n  .chip:hover{background:#d2e3fc}\n</style>\n</head>\n<body>\n<details class=\"rc\" id=\"rcBox\" open>\n  <summary>Rennen aus Race Control übernehmen</summary>\n  <div class=\"grp\">Daily Races (Stufe)</div>\n  <div class=\"chips\" id=\"fDaily\">\n    <label><input type=\"checkbox\" value=\"beginner\" checked>Beginner</label>\n    <label><input type=\"checkbox\" value=\"intermediate\" checked>Intermediate</label>\n    <label><input type=\"checkbox\" value=\"advanced\" checked>Advanced</label>\n  </div>\n  <div class=\"grp\">Community-Events (Mindest-Rating)</div>\n  <div class=\"chips\" id=\"fEvent\">\n    <label><input type=\"checkbox\" value=\"offen\" checked>ohne Vorgabe</label>\n    <label><input type=\"checkbox\" value=\"bronze\" checked>Bronze</label>\n    <label><input type=\"checkbox\" value=\"silver\" checked>Silber</label>\n    <label><input type=\"checkbox\" value=\"gold\" checked>Gold</label>\n    <label><input type=\"checkbox\" value=\"platinum\" checked>Platin</label>\n  </div>\n  <div class=\"grp\">DLC – Strecken-Pakete, die ich habe</div>\n  <div class=\"chips\" id=\"fDlc\"><span class=\"muted\">erscheinen nach dem Laden</span></div>\n  <div class=\"chips\">\n    <label><input type=\"checkbox\" id=\"fDlcOnly\">nur Rennen ohne fehlende DLC</label>\n  </div>\n  <div class=\"chips\">\n    <label><input type=\"checkbox\" id=\"fTeam\">nur Team-Events</label>\n    <label><input type=\"checkbox\" id=\"fLong\">nur ab 1 h</label>\n    <label><input type=\"checkbox\" id=\"fHosted\" checked>Hosted Races</label>\n  </div>\n  <div class=\"row\" style=\"margin-top:4px\">\n    <div><input id=\"rcSearch\" placeholder=\"Suche: Name, Strecke, Veranstalter\"></div>\n    <div style=\"flex:0 0 auto\"><button id=\"rcLoad\">Laden</button></div>\n  </div>\n  <div id=\"rcList\" class=\"muted\">Klick auf „Laden“ holt die geplanten Rennen von racecontrol.gg.</div>\n  <div class=\"row\" style=\"margin-top:6px\">\n    <div><input id=\"rcLink\" placeholder=\"oder Event-Link einfügen: racecontrol.gg/events/…\"></div>\n    <div style=\"flex:0 0 auto\"><button id=\"rcLinkBtn\">Übernehmen</button></div>\n  </div>\n</details>\n\n<label>Name des Events (wird der Tab-Name)</label>\n<input id=\"name\" placeholder=\"z. B. 24h Spa 2026\">\n<div class=\"row\">\n  <div><label>Event-Start (Wiener Zeit) <span class=\"muted\">– Beginn Training</span></label><input id=\"start\" type=\"datetime-local\"></div>\n  <div><label>Renndauer (h:mm)</label><input id=\"duration\" value=\"24:00\"></div>\n</div>\n<div class=\"row\">\n  <div><label>Training (min)</label><input id=\"practice\" type=\"number\" min=\"0\" value=\"0\"></div>\n  <div><label>Qualifying (min)</label><input id=\"quali\" type=\"number\" min=\"0\" value=\"0\"></div>\n  <div><label>Pause bis Rennstart (min)</label><input id=\"gap\" type=\"number\" min=\"0\" value=\"0\"></div>\n</div>\n<div class=\"muted\">Alles 0 = Event-Start ist der Rennstart.</div>\n<div class=\"row\">\n  <div><label>Strecke</label><input id=\"track\" list=\"trackList\" placeholder=\"z. B. Spa\"><datalist id=\"trackList\"></datalist></div>\n  <div style=\"flex:0 0 110px\"><label>Klasse</label><select id=\"cls\"><option value=\"gt3\">GT3</option><option value=\"hypercar\">Hypercar</option><option value=\"lmp2\">LMP2</option><option value=\"lmp3\">LMP3</option></select></div>\n  <div style=\"flex:0 0 110px\"><label>Setup</label><select id=\"setup\"><option value=\"open\">offen</option><option value=\"fixed\">fest (Fixed)</option></select></div>\n</div>\n<div class=\"row\" style=\"margin-top:6px\">\n  <div><button id=\"sugBtn\" style=\"width:100%\">Rundenzeit &amp; Verbrauch vorschlagen</button></div>\n</div>\n<div id=\"sugg\"></div>\n<div class=\"row\">\n  <div><label>Rundenzeit (m:ss)</label><input id=\"lap\" value=\"3:45\"></div>\n  <div><label>Runden pro Stint</label><input id=\"lapsPerStint\" type=\"number\" min=\"1\" value=\"10\"></div>\n  <div><label>Boxenstopp (m:ss)</label><input id=\"pit\" value=\"1:30\"></div>\n</div>\n\n<div class=\"row\">\n  <div><label>Verbrauch pro Runde</label><input id=\"cons\" placeholder=\"leer = keine Tankempfehlung\"></div>\n  <div style=\"flex:0 0 120px\"><label>Einheit</label><select id=\"consUnit\"><option value=\"ve\">VE %</option><option value=\"l\">Liter</option></select></div>\n  <div style=\"flex:0 0 110px\"><label>Reserve (Runden)</label><input id=\"reserve\" type=\"number\" min=\"0\" step=\"0.5\" value=\"1\"></div>\n</div>\n\n<label>Fahrer-Reihenfolge <span class=\"muted\">(Häkchen = fährt mit, Pfeile = Reihenfolge)</span></label>\n<div id=\"drivers\"></div>\n<div class=\"row\" style=\"margin-top:4px\">\n  <div><input id=\"extra\" placeholder=\"weiteren Namen hinzufügen (z. B. noch nicht angemeldet)\"></div>\n  <div style=\"flex:0 0 auto\"><button id=\"add\">+</button></div>\n</div>\n<div class=\"row\">\n  <div><label>Stints am Stück pro Fahrer</label><input id=\"per\" type=\"number\" min=\"1\" value=\"2\"></div>\n  <div><label>Danach</label><select id=\"activate\"><option value=\"1\">als aktives Event setzen</option><option value=\"0\">nur anlegen</option></select></div>\n</div>\n\n<div class=\"box\"><div id=\"preview\" class=\"muted\"></div></div>\n<div style=\"margin-top:12px;display:flex;gap:6px\">\n  <button class=\"primary\" id=\"create\">Event anlegen</button>\n  <button onclick=\"google.script.host.close()\">Abbrechen</button>\n</div>\n<div id=\"msg\" style=\"margin-top:8px\"></div>\n\n<script>\nvar D = <?!= data ?>;\nvar list = D.drivers.map(function (n) { return { name: n, on: true }; });\nfunction $(i) { return document.getElementById(i); }\nfunction esc(s) { return String(s).replace(/[&<>\"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c]; }); }\nfunction sec(s, unit) {\n  var p = String(s || '').trim().replace(',', '.').split(':').map(Number);\n  if (p.some(isNaN) || !p.length) return 0;\n  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];\n  if (p.length === 2) return unit === 'h' ? p[0] * 3600 + p[1] * 60 : p[0] * 60 + p[1];\n  return unit === 'h' ? p[0] * 3600 : p[0];\n}\nfunction hm(s) { s = Math.round(s); return Math.floor(s / 3600) + ':' + ('0' + Math.floor(s % 3600 / 60)).slice(-2); }\n\nfunction renderDrivers() {\n  if (!list.length) {\n    $('drivers').innerHTML = '<div class=\"muted\">Noch keine freigegebenen Fahrer. Namen unten hinzufügen oder später im Tab per Dropdown eintragen.</div>';\n  } else {\n    $('drivers').innerHTML = list.map(function (d, i) {\n      return '<div class=\"drv\"><input type=\"checkbox\" data-i=\"' + i + '\"' + (d.on ? ' checked' : '') + '><span>' + esc(d.name) + '</span>' +\n        '<button data-up=\"' + i + '\">↑</button><button data-down=\"' + i + '\">↓</button></div>';\n    }).join('');\n  }\n  preview();\n}\n$('drivers').addEventListener('click', function (e) {\n  var t = e.target, i;\n  if (t.hasAttribute('data-i')) { list[+t.getAttribute('data-i')].on = t.checked; preview(); return; }\n  if (t.hasAttribute('data-up')) { i = +t.getAttribute('data-up'); if (i > 0) list.splice(i - 1, 0, list.splice(i, 1)[0]); renderDrivers(); }\n  if (t.hasAttribute('data-down')) { i = +t.getAttribute('data-down'); if (i < list.length - 1) list.splice(i + 1, 0, list.splice(i, 1)[0]); renderDrivers(); }\n});\n$('add').onclick = function () {\n  var n = $('extra').value.trim();\n  if (n && !list.some(function (d) { return d.name === n; })) list.push({ name: n, on: true });\n  $('extra').value = ''; renderDrivers();\n};\n$('extra').onkeydown = function (e) { if (e.key === 'Enter') $('add').click(); };\n\nfunction opts() {\n  return {\n    name: $('name').value, start: $('start').value, duration: $('duration').value, lap: $('lap').value,\n    lapsPerStint: $('lapsPerStint').value, pit: $('pit').value, stintsPerDriver: $('per').value,\n    drivers: list.filter(function (d) { return d.on; }).map(function (d) { return d.name; }),\n    activate: $('activate').value === '1', rcUrl: rcUrl,\n    cons: $('cons').value, consUnit: $('consUnit').value, reserve: $('reserve').value,\n    practice: $('practice').value, quali: $('quali').value, gap: $('gap').value\n  };\n}\nfunction preview() {\n  var o = opts(), dur = sec(o.duration, 'h'), lap = sec(o.lap, 's'), pit = sec(o.pit, 's'), n = +o.lapsPerStint || 1;\n  if (!dur || !lap) { $('preview').textContent = 'Renndauer und Rundenzeit angeben.'; return; }\n  var st = n * lap, stints = Math.ceil(dur / (st + pit));\n  var pM = Math.max(0, +o.practice || 0), qM = Math.max(0, +o.quali || 0), gM = Math.max(0, +o.gap || 0), sched = '';\n  var t0 = o.start ? new Date(o.start) : null;\n  function hhmm(m) { var d = new Date(t0.getTime() + m * 60000); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }\n  if (t0 && !isNaN(t0) && pM + qM + gM > 0) {\n    var parts = [];\n    if (pM) parts.push('Training ' + hhmm(0) + '–' + hhmm(pM));\n    if (qM) parts.push('Qualifying ' + hhmm(pM) + '–' + hhmm(pM + qM));\n    parts.push('Rennstart ' + hhmm(pM + qM + gM));\n    parts.push('Rennende ' + hhmm(pM + qM + gM + dur / 60));\n    sched = 'Ablauf: ' + parts.join(' · ') + '\\n';\n  }\n  var t = sched + stints + ' Stints à ' + n + ' Runden (' + hm(st) + ' h Fahrzeit + ' + Math.floor(pit / 60) + ':' + ('0' + pit % 60).slice(-2) + ' min Stopp)';\n  var drive = Math.max(0, dur - (stints - 1) * pit), total = Math.ceil(drive / lap), lastL = total - (stints - 1) * n;\n  t += '\\nGesamt: ca. ' + total + ' Runden in ' + hm(dur) + ' h (' + (stints - 1) + ' Boxenstopps, ' + hm(drive) + ' h Fahrzeit)' +\n    (lastL > 0 && lastL !== n ? ' · letzter Stint ca. ' + lastL + ' Runden' : '');\n  if (o.drivers.length) {\n    var per = Math.max(1, +o.stintsPerDriver || 1), cnt = {};\n    for (var i = 0; i < stints; i++) { var d = o.drivers[Math.floor(i / per) % o.drivers.length]; cnt[d] = (cnt[d] || 0) + 1; }\n    t += '\\n' + o.drivers.map(function (d) { return d + ': ' + (cnt[d] || 0) + ' Stints (~' + hm((cnt[d] || 0) * st) + ' h)'; }).join(' · ');\n  } else t += '\\nFahrer bleiben leer – später per Dropdown eintragen.';\n  var c = parseFloat(String($('cons').value).replace(',', '.')), rs = parseFloat(String($('reserve').value).replace(',', '.')) || 0;\n  if (c > 0) {\n    var amt = (n + rs) * c, ve = $('consUnit').value === 've';\n    t += '\\nTankempfehlung je Stint: ' + (ve ? Math.min(100, Math.round(amt)) + ' % VE' : amt.toFixed(1).replace('.', ',') + ' l') +\n      ' (' + n + ' + ' + rs + ' Rd Reserve)' + (ve && amt > 100 ? ' – mehr als ein voller Tank, Stint kürzen!' : '');\n  }\n  $('preview').textContent = t;\n}\n['duration', 'lap', 'pit', 'lapsPerStint', 'per', 'cons', 'reserve', 'practice', 'quali', 'gap', 'start'].forEach(function (i) { $(i).oninput = preview; });\n$('consUnit').onchange = preview;\n$('cls').onchange = function () { $('consUnit').value = /lmp2|lmp3/.test(this.value) ? 'l' : 've'; preview(); };\n\n/* ---------- Rundenzeit-Vorschlag ---------- */\nfunction mmss(sec) { var m = Math.floor(sec / 60), r = sec - m * 60; return m + ':' + ('0' + r.toFixed(1)).slice(-4); }\nfunction toSecLap(t) { var p = String(t).split(':'); return p.length === 2 ? (+p[0]) * 60 + parseFloat(p[1]) : parseFloat(t); }\nfunction guessClass(name) {\n  name = String(name || '');\n  if (/LMP3/i.test(name)) return 'lmp3';\n  if (/LMP2|ELMS/i.test(name)) return 'lmp2';\n  if (/GT3|GTE/i.test(name)) return 'gt3';\n  if (/Hyper|WEC|Prototype|LMH|LMDh/i.test(name)) return 'hypercar';\n  return '';\n}\ngoogle.script.run.withSuccessHandler(function (l) {\n  $('trackList').innerHTML = (l || []).map(function (n) { return '<option value=\"' + esc(n) + '\">'; }).join('');\n}).adminLapTracks();\n$('sugBtn').onclick = function () {\n  var b = this;\n  if (!$('track').value.trim()) { $('sugg').innerHTML = '<div class=\"sg err\">Bitte zuerst die Strecke angeben.</div>'; return; }\n  b.disabled = true; $('sugg').innerHTML = '<div class=\"sg muted\">suche Rundenzeiten …</div>';\n  google.script.run.withSuccessHandler(function (r) {\n    b.disabled = false;\n    var h = '<div class=\"sg\"><div class=\"muted\">' + esc(r.cls) + ' · ' + esc(r.track) + '</div>';\n    if (r.own) {\n      h += '<div class=\"h\">Eure eigene Pace (' + r.own.laps + ' saubere Runden)</div>';\n      h += '<span class=\"chip\" data-lap=\"' + r.own.team + '\">Team-Median ' + mmss(r.own.team) + '</span>';\n      r.own.drivers.forEach(function (d) { h += '<span class=\"chip\" data-lap=\"' + d.median + '\">' + esc(d.driver) + ' ' + mmss(d.median) + '</span>'; });\n      if (r.own.vePerLap || r.own.fuelPerLap) {\n        h += '<div class=\"h\">Euer Verbrauch pro Runde</div>';\n        if (r.own.vePerLap) h += '<span class=\"chip\" data-cons=\"' + r.own.vePerLap + '\" data-unit=\"ve\">' + String(r.own.vePerLap).replace('.', ',') + ' % VE</span>';\n        if (r.own.fuelPerLap) h += '<span class=\"chip\" data-cons=\"' + r.own.fuelPerLap + '\" data-unit=\"l\">' + String(r.own.fuelPerLap).replace('.', ',') + ' l</span>';\n      }\n    } else h += '<div class=\"h\">Eigene Pace</div><div class=\"muted\">Noch keine eigenen Runden auf dieser Strecke in dieser Klasse.</div>';\n    if (r.bop) {\n      h += '<div class=\"h\">Referenz BoP Tourism – ' + esc(r.bop.label) + ', ' + esc(r.bop.setup) + ' (' + r.bop.drivers + ' Fahrer)</div>';\n      var med = r.bop.med || {}, tiers = r.bop.tiers || {};\n      Object.keys(med).forEach(function (k) { h += '<span class=\"chip\" data-lap=\"' + toSecLap(med[k]) + '\">' + esc(k) + ' ' + esc(med[k]) + '</span>'; });\n      var tn = { ALIEN: 'Alien (Top 0,5 %)', GOLD: 'Gold (Top 10 %)', SILVER: 'Silber (Top 30 %)', BRONZE: 'Mittelfeld (Median)', ROOKIE: 'Rookie (Top 75 %)' };\n      if (Object.keys(tiers).length) h += '<br>';\n      ['GOLD', 'SILVER', 'BRONZE', 'ROOKIE'].forEach(function (k) { if (tiers[k]) h += '<span class=\"chip\" data-lap=\"' + toSecLap(tiers[k]) + '\">' + tn[k] + ' ' + esc(tiers[k]) + '</span>'; });\n      if (r.bop.quali) h += '<div class=\"muted\">Nur Qualifying-Daten vorhanden – im Rennen eher 1–2 % langsamer.</div>';\n      h += '<div class=\"muted\" style=\"margin-top:3px\">Median = Dauerpace (die Hälfte der Runden ist schneller). <a href=\"' + esc(r.bopUrl) + '\" target=\"_blank\">Details</a></div>';\n    } else if (r.err) h += '<div class=\"h\">Referenz BoP Tourism</div><div class=\"muted\">' + esc(r.err) + '</div>';\n    h += '<div class=\"muted\" style=\"margin-top:4px\">Klick übernimmt den Wert.</div></div>';\n    $('sugg').innerHTML = h;\n  }).withFailureHandler(function (e) { b.disabled = false; $('sugg').innerHTML = '<div class=\"sg err\">' + esc(e.message || e) + '</div>'; })\n    .adminLapSuggest({ track: $('track').value, cls: $('cls').value, setup: $('setup').value, durMin: Math.round(sec($('duration').value, 'h') / 60) });\n};\n$('sugg').addEventListener('click', function (e) {\n  var c = e.target.closest('.chip'); if (!c) return;\n  if (c.hasAttribute('data-lap')) { $('lap').value = mmss(parseFloat(c.getAttribute('data-lap'))); }\n  if (c.hasAttribute('data-cons')) { $('cons').value = String(c.getAttribute('data-cons')).replace('.', ','); $('consUnit').value = c.getAttribute('data-unit'); }\n  preview();\n});\n\n$('create').onclick = function () {\n  var b = this; b.disabled = true; $('msg').className = 'muted'; $('msg').textContent = 'lege an …';\n  google.script.run.withSuccessHandler(function (r) {\n    $('msg').className = ''; $('msg').textContent = '✓ „' + r.name + '“ angelegt (' + r.stints + ' Stints).';\n    setTimeout(function () { google.script.host.close(); }, 1500);\n  }).withFailureHandler(function (e) { b.disabled = false; $('msg').className = 'err'; $('msg').textContent = e.message || e; })\n    .adminCreateEvent(opts());\n};\n\n/* ---------- Race Control ---------- */\nvar RC = [], rcUrl = '', PACKS = [], OWNED = null;\nfunction chk(id) { return Array.prototype.filter.call($(id).querySelectorAll('input'), function (x) { return x.checked; }).map(function (x) { return x.value; }); }\nfunction filt() {\n  return { daily: chk('fDaily'), event: chk('fEvent'), team: $('fTeam').checked, long: $('fLong').checked, hosted: $('fHosted').checked,\n    dlcOnly: $('fDlcOnly').checked, owned: PACKS.length ? chk('fDlc') : (OWNED || []) };\n}\nfunction own(p) { return !p || (PACKS.length ? chk('fDlc') : (OWNED || [])).indexOf(p) !== -1; }\nfunction renderPacks() {\n  var o = OWNED || [];\n  $('fDlc').innerHTML = PACKS.length ? PACKS.map(function (p) {\n    return '<label><input type=\"checkbox\" value=\"' + esc(p) + '\"' + (o.indexOf(p) !== -1 ? ' checked' : '') + '>' + esc(p) + '</label>';\n  }).join('') : '<span class=\"muted\">keine DLC-Strecken gefunden</span>';\n}\nfunction applyFilter(f) {\n  if (!f) return;\n  ['fDaily', 'fEvent'].forEach(function (id) {\n    var want = f[id === 'fDaily' ? 'daily' : 'event'] || [];\n    Array.prototype.forEach.call($(id).querySelectorAll('input'), function (x) { x.checked = want.indexOf(x.value) !== -1; });\n  });\n  $('fTeam').checked = !!f.team; $('fLong').checked = !!f.long; $('fHosted').checked = f.hosted !== false;\n  $('fDlcOnly').checked = !!f.dlcOnly;\n  if (f.owned) OWNED = f.owned;\n}\nfunction lvName(l) { return { silver: 'Silber', platinum: 'Platin', offen: 'offen' }[l] || l; }\nfunction renderRc() {\n  if (!RC.length) return;\n  var f = filt(), q = $('rcSearch').value.trim().toLowerCase();\n  var rows = RC.filter(function (x) {\n    if (x.kind === 'hosted' ? !f.hosted : x.kind === 'daily' ? f.daily.indexOf(x.level) === -1 : f.event.indexOf(x.level) === -1) return false;\n    if (f.team && !x.team) return false;\n    if (f.long && x.kind !== 'event' && x.durSec < 3600) return false;\n    if (f.dlcOnly) {\n      if (x.kind !== 'event' ? !own(x.dlc) : !((x.rounds && x.rounds.length) ? x.rounds.some(function (r) { return own(r.dlc); }) : (x.dlcs || []).every(own))) return false;\n    }\n    var hay = x.name + ' ' + (x.track || '') + ' ' + (x.host || '') + ' ' + (x.rounds || []).map(function (r) { return r.track + ' ' + r.label; }).join(' ') + ' ' + (x.label || '');\n    if (q && hay.toLowerCase().indexOf(q) === -1) return false;\n    return true;\n  });\n  var nowMs = Date.now();\n  var nextOf = function (x) {\n    if (x.kind !== 'event') return x.start;\n    var r = (x.rounds || []).filter(function (r) { return r.start > nowMs - 30 * 60000; })[0];\n    return r ? r.start : x.start;\n  };\n  rows.sort(function (a, b) { return nextOf(a) - nextOf(b); });\n  var seen = {}, out = [];\n  rows.forEach(function (x, i) {\n    var k = x.kind + x.name + (x.kind === 'daily' ? x.track : x.label);\n    if (seen[k]) return; seen[k] = 1;\n    var nextR = x.kind === 'event' ? (x.rounds || []).filter(function (r) { return r.start > Date.now() - 30 * 60000; })[0] : null;\n    out.push('<div class=\"it\" data-i=\"' + RC.indexOf(x) + '\"><b>' + esc(x.kind === 'daily' ? 'ab ' + x.label : nextR ? nextR.label : x.label) + '</b> · ' + esc(x.name) +\n      (x.kind === 'hosted' ? '<span class=\"lv offen\">Hosted</span>' : '<span class=\"lv ' + esc(x.level) + '\">' + esc(lvName(x.level)) + '</span>') + (x.team ? '<span class=\"team\">TEAM</span>' : '') +\n      (x.kind !== 'event' ? (x.dlc ? '<span class=\"dlc' + (own(x.dlc) ? '' : ' miss') + '\">' + esc(x.dlc) + '</span>' : '')\n        : (x.dlcs || []).map(function (p) { return '<span class=\"dlc' + (own(p) ? '' : ' miss') + '\">' + esc(p) + '</span>'; }).join('')) +\n      '<div class=\"muted\">' + (x.kind === 'daily' ? 'Daily Race · ' + esc(x.track) + ' · ' + Math.round(x.durSec / 60) + ' min' +\n          (x.interval ? ' · alle ' + Math.round(x.interval / 60000) + ' min – Klick zeigt die Termine der nächsten Tage' : '')\n        : x.kind === 'hosted' ? 'Hosted Race · ' + esc(x.track) + (x.classes ? ' · ' + esc(x.classes) : '') + (x.sessions ? ' · ' + esc(x.sessions) : '')\n        : esc(x.host || 'Community') + (x.roundsTxt ? ' · ' + esc(x.roundsTxt) : '') + (nextR ? ' · nächste Runde: ' + esc(nextR.track) : '') + (x.classes ? ' · ' + esc(x.classes) : '') +\n          (x.carPacks && x.carPacks.length ? '<br>Autos u. a. aus: ' + esc(x.carPacks.join(', ')) : '')) + '</div></div>');\n  });\n  $('rcList').innerHTML = out.length ? out.slice(0, 150).join('') : '<div class=\"muted\" style=\"padding:6px 0\">Nichts gefunden – Filter lockern.</div>';\n}\nfunction saveFilter() { google.script.run.adminRcSaveFilter(filt()); }\n['fDaily', 'fEvent', 'fDlc'].forEach(function (id) { $(id).addEventListener('change', function () { renderRc(); saveFilter(); }); });\n$('fTeam').onchange = $('fLong').onchange = $('fDlcOnly').onchange = $('fHosted').onchange = function () { renderRc(); saveFilter(); };\n$('rcSearch').oninput = renderRc;\n$('rcLoad').onclick = function () {\n  var b = this; b.disabled = true; $('rcList').innerHTML = '<div class=\"muted\" style=\"padding:6px 0\">lade von racecontrol.gg … (Daily Races, Meisterschaften, Hosted Races – kann ~30 s dauern)</div>';\n  google.script.run.withSuccessHandler(function (r) {\n    b.disabled = false; RC = r.list; PACKS = r.packs || []; if (r.filter) applyFilter(r.filter); renderPacks(); renderRc();\n  }).withFailureHandler(function (e) { b.disabled = false; $('rcList').innerHTML = '<div class=\"err\">' + esc(e.message || e) + '</div>'; })\n    .adminRcList(false);\n};\nfunction pickTime(name, local, durSec, url, track, pMin, qMin) {\n  $('practice').value = pMin || 0; $('quali').value = qMin || 0; $('gap').value = 0;\n  if (track) $('track').value = track;\n  var gc = guessClass(name); if (gc) { $('cls').value = gc; $('cls').onchange(); }\n  if (/fixed/i.test(name)) $('setup').value = 'fixed';\n  $('name').value = name.replace(/[\\[\\]*?:\\/\\\\]/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 60);\n  $('start').value = local;\n  if (durSec) $('duration').value = Math.floor(durSec / 3600) + ':' + ('0' + Math.floor(durSec % 3600 / 60)).slice(-2);\n  rcUrl = url || '';\n  $('rcBox').open = false;\n  $('msg').className = 'muted';\n  $('msg').textContent = 'Übernommen: ' + name + (durSec ? '' : ' – Renndauer bitte prüfen (steht bei Community-Events nicht in Race Control).') +\n    (pMin || qMin ? ' Training/Qualifying aus Race Control übernommen.' : ' Training/Qualifying (min) bitte selbst eintragen, falls vor dem Rennen.');\n  preview();\n}\nfunction showRounds(ev) {\n  if (!ev.rounds.length) { $('rcList').innerHTML = '<div class=\"err\">Keine Runden mit Startzeit gefunden.</div>'; return; }\n  if (ev.rounds.length === 1) { var r0 = ev.rounds[0]; pickTime(ev.name + ' ' + (r0.track || ''), r0.local, 0, ev.url, r0.track); return; }\n  $('rcList').innerHTML = '<div class=\"muted\" style=\"padding:4px 0\">' + esc(ev.name) + ' – Runde wählen:</div>' + ev.rounds.map(function (r, i) {\n    var miss = r.dlc && !own(r.dlc);\n    return '<div class=\"it' + (miss ? ' off' : '') + '\" data-r=\"' + i + '\"><b>' + esc(r.label) + '</b> · ' + esc(r.name || ('Runde ' + (i + 1))) +\n      (r.dlc ? '<span class=\"dlc' + (miss ? ' miss' : '') + '\">' + esc(r.dlc) + (miss ? ' fehlt' : '') + '</span>' : '') +\n      '<div class=\"muted\">' + esc(r.track) + '</div></div>';\n  }).join('') + '<div class=\"it\" data-back=\"1\">← zurück zur Liste</div>';\n  $('rcList').onclickRounds = ev;\n}\n/* Daily Races: Termine der nächsten 7 Tage (heute laut Race Control, danach im selben Takt hochgerechnet) */\nfunction vLocal(ms) {\n  var p = {};\n  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })\n    .formatToParts(new Date(ms)).forEach(function (q) { p[q.type] = q.value; });\n  return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute;\n}\nfunction vDay(ms) { return new Date(ms).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', weekday: 'long', day: '2-digit', month: '2-digit' }); }\nfunction vTime(ms) { return new Date(ms).toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' }); }\nfunction showSlots(x) {\n  var now = Date.now(), slots = (x.times || []).filter(function (t) { return t > now - 30 * 60000; }).map(function (t) { return { t: t, est: false }; });\n  var last = (x.times || []).length ? x.times[x.times.length - 1] : 0;\n  if (x.interval >= 10 * 60000 && last) for (var t = last + x.interval; t < now + 7 * 864e5 && slots.length < 300; t += x.interval) if (t > now) slots.push({ t: t, est: true });\n  var h = '<div class=\"muted\" style=\"padding:4px 0\">' + esc(x.name) + ' · ' + esc(x.track) + ' – Termin wählen (Wiener Zeit):</div>', day = '';\n  slots.forEach(function (s, i) {\n    var d = vDay(s.t);\n    if (d !== day) { day = d; h += '<div class=\"grp\" style=\"margin-top:8px\">' + esc(d) + (s.est ? ' <span style=\"font-weight:400;text-transform:none\">– voraussichtlich</span>' : '') + '</div>'; }\n    h += '<span class=\"chip\" data-s=\"' + i + '\">' + vTime(s.t) + '</span>';\n  });\n  h += '<div class=\"muted\" style=\"margin-top:6px\">Race Control veröffentlicht nur die Termine von heute. Spätere Tage sind im selben Takt hochgerechnet – der Daily-Race-Plan kann sich zum Wochenwechsel ändern.</div>';\n  h += '<div class=\"it\" data-back=\"1\">← zurück zur Liste</div>';\n  $('rcList').innerHTML = h;\n  $('rcList').onclickSlots = { x: x, slots: slots };\n}\nfunction loadEvent(id) {\n  $('rcList').innerHTML = '<div class=\"muted\" style=\"padding:6px 0\">lade Event …</div>';\n  google.script.run.withSuccessHandler(showRounds)\n    .withFailureHandler(function (e) { $('rcList').innerHTML = '<div class=\"err\">' + esc(e.message || e) + '</div>'; }).adminRcEvent(id);\n}\n$('rcList').addEventListener('click', function (e) {\n  var it = e.target.closest('.it');\n  var ch = e.target.closest('.chip');\n  if (ch && ch.hasAttribute('data-s')) {\n    var S = $('rcList').onclickSlots, sl = S.slots[+ch.getAttribute('data-s')];\n    pickTime(S.x.name + ' ' + S.x.track, vLocal(sl.t), S.x.durSec, '', S.x.track);\n    if (sl.est) $('msg').textContent += ' Achtung: Termin hochgerechnet, bitte am Renntag in Race Control prüfen.';\n    return;\n  }\n  if (!it) return;\n  if (it.hasAttribute('data-back')) { renderRc(); return; }\n  if (it.hasAttribute('data-r')) {\n    var ev = $('rcList').onclickRounds, r = ev.rounds[+it.getAttribute('data-r')];\n    pickTime(ev.name + ' ' + (r.track || r.name || ''), r.local, 0, ev.url, r.track); return;\n  }\n  var x = RC[+it.getAttribute('data-i')];\n  if (x.kind === 'daily') showSlots(x);\n  else if (x.kind === 'hosted') pickTime(x.name, x.local, x.durSec, x.url, x.track, x.practice, x.quali);\n  else loadEvent(x.id);\n});\n$('rcLinkBtn').onclick = function () { var v = $('rcLink').value.trim(); if (v) loadEvent(v); };\n\n$('start').value = D.start;\nrenderDrivers();\n</script>\n</body>\n</html>\n";

/* ======================= Strecken-Analyse (?view=map) ======================= */
// Tab „Linien“: pro Runde eine komprimierte Spur (exe ab 2.6). Die Karte wird aus der gefahrenen Linie gezeichnet.

/** Liste aller Runden mit Spur (ohne Daten) + Highlights */
function mapList_() {
  const sh = syncSheet_('Linien');
  const n = sh.getLastRow() - 1;
  const laps = [];
  if (n > 0) {
    const v = sh.getRange(2, 1, n, 10).getValues();
    v.forEach((r, i) => {
      if (!r[4]) return;
      laps.push({ row: i + 2, ts: r[0] instanceof Date ? r[0].getTime() : Date.parse(r[0]) || 0, stint: String(r[1]), driver: String(r[2]),
        session: String(r[3]), track: String(r[4]), car: String(r[5]), lap: Number(r[6]) || 0, time: Number(r[7]) || 0,
        clean: r[8] === 'ja', len: Number(r[9]) || 0 });
    });
  }
  const ev = syncSheet_('Ereignisse');
  const en = ev.getLastRow() - 1;
  const hl = [];
  if (en > 0) {
    const start = Math.max(2, ev.getLastRow() - 3000 + 1);
    ev.getRange(start, 1, ev.getLastRow() - start + 1, 9).getValues().forEach(r => {
      if (!r[4]) return;
      hl.push({ ts: r[0] instanceof Date ? r[0].getTime() : Date.parse(r[0]) || 0, stint: String(r[1]), driver: String(r[2]), lap: r[3],
        kind: String(r[4]), text: String(r[5]), et: r[6] === '' ? null : Number(r[6]), x: r[7] === '' ? null : Number(r[7]), z: r[8] === '' ? null : Number(r[8]) });
    });
  }
  const live = JSON.parse(PropertiesService.getScriptProperties().getProperty('live') || 'null');
  return { now: Date.now(), laps: laps, highlights: hl, liveTrack: live ? live.track : '', liveDriver: live ? live.driver : '' };
}

/** komprimierte Spuren für bis zu 16 Zeilen von „Linien“ */
function mapTraces_(rows) {
  const sh = syncSheet_('Linien');
  const out = {};
  String(rows || '').split(',').map(Number).filter(r => r >= 2 && r <= sh.getLastRow()).slice(0, 16)
    .forEach(r => { out[r] = String(sh.getRange(r, 11).getValue() || ''); });
  return out;
}

/* ======================= Updates (Admin → „Update übernehmen“) ======================= */
// Neue Versionen liegen auf GitHub (dist/sheet/release.json). Die alte Vorlage-Web-App (…/exec?api=release) wird nur noch
// von Sheets bis 3.4 gefragt, um einmalig auf eine Version mit GitHub-Updates zu kommen. Beim Klick auf „Update übernehmen“
// wird der Code im versteckten Tab „LMU-Update“ gespeichert; zz_Update.gs lädt ihn bei jedem Aufruf.
// Kein erneutes Bereitstellen nötig. „Zurück“ stellt die vorige Version wieder her.

var LMU_RELEASE_URL = 'https://script.google.com/macros/s/AKfycbwmBtO_AFLEAuq2Rb4VSzFQOjjtHnLwHa2GTQvcymBcOgzT4OP6O5957Gk0nmgfB33Ksg/exec';
var LMU_UPD_SHEET = 'LMU-Update';
var LMU_CHUNK = 40000;
var LMU_SHIM = '<script>(function(){var g=window.google&&google.script;if(!g||!g.run||g.run.__lmu)return;var r=g.run;' +
  'function mk(s,f,u){var t={__lmu:1};return new Proxy(t,{get:function(o,k){if(k in t)return t[k];' +
  'if(k==="withSuccessHandler")return function(h){return mk(h,f,u)};if(k==="withFailureHandler")return function(h){return mk(s,h,u)};' +
  'if(k==="withUserObject")return function(x){return mk(s,f,x)};if(k==="withLogger")return function(){return mk(s,f,u)};' +
  'return function(){var x=r;if(s)x=x.withSuccessHandler(s);if(f)x=x.withFailureHandler(f);if(u!==undefined)x=x.withUserObject(u);' +
  'x.lmuCall(String(k),Array.prototype.slice.call(arguments))}}})}' +
  'google.script={run:mk(),host:g.host,url:g.url,history:g.history}})()</script>';

/** HTML-Vorlage aus dem Update (falls aktiv) oder aus der Projektdatei; google.script.run läuft über lmuCall. */
function lmuTpl_(name, src) {
  let h = src;
  if (h == null) h = (typeof LMU_HTML !== 'undefined' && LMU_HTML[name] != null) ? LMU_HTML[name]
    : HtmlService.createTemplateFromFile(name).getRawContent();
  const i = h.search(/<head[^>]*>/i);
  h = i === -1 ? LMU_SHIM + h : h.replace(/<head[^>]*>/i, m => m + LMU_SHIM);
  return HtmlService.createTemplate(h);
}

/** Verteiler für google.script.run – damit auch Funktionen aus einem Update aufrufbar sind. */
function lmuCall(name, args) {
  name = String(name || '');
  const f = /^[A-Za-z]\w*$/.test(name) && !/_$/.test(name) && ['lmuCall', 'doGet', 'doPost'].indexOf(name) === -1 ? globalThis[name] : null;
  if (typeof f !== 'function' || /\[native code\]/.test(Function.prototype.toString.call(f))) throw new Error('Unbekannte Funktion: ' + name);
  return f.apply(null, args || []);
}

function lmuVerCmp_(a, b) {
  a = String(a || '0').split('.').map(Number); b = String(b || '0').split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}
function lmuBoot_() { return typeof LMU_BOOT !== 'undefined' ? LMU_BOOT : 0; }
function lmuBase_() { return typeof LMU_BASE !== 'undefined' ? LMU_BASE : SYNC_VERSION; }

/** Vorlage: ?api=release liefert die eingebaute Version (Release.html, gzip+base64) */
function lmuReleaseServe_(p) {
  let out;
  try {
    const b = lmuReleaseLocal_();
    out = p.meta ? { v: b.v, date: b.date, boot: b.boot, history: b.history } : b;
  } catch (e) { out = { err: 'Keine Release-Datei in dieser Vorlage' }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function lmuReleaseLocal_() {
  const raw = HtmlService.createTemplateFromFile('Release').getRawContent().replace(/[^A-Za-z0-9_=-]/g, '');
  const blob = Utilities.newBlob(Utilities.base64DecodeWebSafe(raw), 'application/x-gzip');
  return JSON.parse(Utilities.ungzip(blob).getDataAsString('UTF-8'));
}

// Updates kommen ausschließlich von GitHub (öffentliches Repo, Ordner dist/sheet).
var LMU_GITHUB_RAW = 'https://raw.githubusercontent.com/zoppmczopper-ship-it/LMU-Stint-Sync/main/dist/sheet/';

function lmuReleaseUrl_() {
  return PropertiesService.getScriptProperties().getProperty('lmuReleaseUrl') || LMU_RELEASE_URL;
}
function lmuFetchRelease_(meta) {
  const own = PropertiesService.getScriptProperties().getProperty('lmuReleaseUrl');
  const srcs = own ? [own] : [LMU_GITHUB_RAW];
  let lastErr = null;
  for (const src of srcs) {
    try {
      const url = /githubusercontent|github\.com/.test(src) ? src + (meta ? 'release-meta.json' : 'release.json') + '?t=' + Date.now()
        : src + '?api=release' + (meta ? '&meta=1' : '') + '&t=' + Date.now();
      const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
      if (r.getResponseCode() !== 200) throw new Error('Update-Server nicht erreichbar (HTTP ' + r.getResponseCode() + ')');
      let b;
      try { b = JSON.parse(r.getContentText('UTF-8')); } catch (e) { throw new Error('Antwort des Update-Servers ist ungültig'); }
      if (b.err) throw new Error(b.err);
      if (!b.v || (!meta && (!b.server || !b.html))) throw new Error('Update-Datei unvollständig');
      b.src = /github/.test(src) ? 'GitHub' : src;
      return b;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function lmuUpdSheet_(create) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(LMU_UPD_SHEET);
  if (!sh && create) {
    sh = ss.insertSheet(LMU_UPD_SHEET, ss.getSheets().length);
    sh.getRange('A1:C1').setValues([['aktiv: –', 'vorher: –', 'Nicht bearbeiten – Code-Updates von LMU Stint-Sync (Admin → Updates)']]);
    sh.hideSheet();
  }
  return sh;
}
function lmuUpdRead_(sh, col) {
  if (!sh || sh.getLastRow() < 2) return '';
  return sh.getRange(2, col, sh.getLastRow() - 1, 1).getValues().map(r => String(r[0] || '').slice(1)).join('');
}
function lmuUpdWrite_(sh, col, s, label) {
  if (sh.getLastRow() > 1) sh.getRange(2, col, sh.getLastRow() - 1, 1).clearContent();
  const parts = [];
  for (let i = 0; i < s.length; i += LMU_CHUNK) parts.push(['x' + s.slice(i, i + LMU_CHUNK)]);
  if (parts.length) sh.getRange(2, col, parts.length, 1).setValues(parts);
  sh.getRange(1, col).setValue((col === 1 ? 'aktiv: ' : 'vorher: ') + (label || '–'));
}
function lmuUpdLabel_(sh, col) { return sh ? String(sh.getRange(1, col).getValue()).replace(/^\w+: /, '').replace('–', '') : ''; }
function lmuUpdCacheClear_() { CacheService.getScriptCache().removeAll(['lmuB', 'lmuRel']); }

function lmuUpdState_() {
  const sh = lmuUpdSheet_(false);
  return { active: typeof LMU_ACTIVE !== 'undefined' ? LMU_ACTIVE : '', stored: lmuUpdLabel_(sh, 1), prev: lmuUpdLabel_(sh, 2),
    loadErr: typeof LMU_LOAD_ERR !== 'undefined' ? LMU_LOAD_ERR : '' };
}

/** Admin: Gibt es eine neuere Version? (Ergebnis 1 h zwischengespeichert, force = sofort fragen) */
function adminUpdateCheck(force) {
  adminGuard_();
  const c = CacheService.getScriptCache();
  let rel = !force && c.get('lmuRel') ? JSON.parse(c.get('lmuRel')) : null;
  if (!rel) {
    try {
      const b = lmuFetchRelease_(true);
      rel = { v: b.v, date: b.date || '', boot: b.boot || 1, history: b.history || [] };
    } catch (e) { rel = { err: e.message }; }
    c.put('lmuRel', JSON.stringify(rel), 3600);
  }
  const st = lmuUpdState_();
  const newer = rel.v && lmuVerCmp_(rel.v, SYNC_VERSION) > 0;
  return {
    current: SYNC_VERSION, base: lmuBase_(), active: st.active, prev: st.prev, loadErr: st.loadErr,
    latest: rel.v || '', date: rel.date || '', err: rel.err || '',
    available: !!(newer && lmuBoot_() && rel.boot <= lmuBoot_()),
    needsTemplate: !!(newer && (!lmuBoot_() || rel.boot > lmuBoot_())),
    notes: (rel.history || []).filter(h => lmuVerCmp_(h.v, SYNC_VERSION) > 0)
  };
}

/** Admin: neueste Version holen, prüfen und aktivieren */
function adminUpdateInstall() {
  adminGuard_();
  if (!lmuBoot_()) throw new Error('Diesem Sheet fehlt die Datei zz_Update.gs – bitte einmalig die Vorlage neu kopieren.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const b = lmuFetchRelease_(false);
    if (lmuVerCmp_(b.v, SYNC_VERSION) <= 0) throw new Error('Schon aktuell (' + SYNC_VERSION + ').');
    if ((b.boot || 1) > lmuBoot_()) throw new Error('Version ' + b.v + ' braucht eine neue Vorlage (geänderte Berechtigungen) – bitte Vorlage neu kopieren.');
    try { new Function(b.server); } catch (e) { throw new Error('Update ' + b.v + ' ist fehlerhaft (' + e.message + ') – nichts geändert.'); }
    const sh = lmuUpdSheet_(true);
    const cur = lmuUpdRead_(sh, 1), curLabel = lmuUpdLabel_(sh, 1);
    lmuUpdWrite_(sh, 2, cur, cur ? curLabel : '');
    lmuUpdWrite_(sh, 1, JSON.stringify(b), b.v);
    lmuUpdCacheClear_();
    return { v: b.v };
  } finally { lock.releaseLock(); }
}

/** Admin: auf die vorige Version zurück (oder ganz auf die eingebaute Grundversion) */
function adminUpdateRollback(toBase) {
  adminGuard_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = lmuUpdSheet_(false);
    if (!sh) throw new Error('Es ist kein Update aktiv.');
    const prev = toBase ? '' : lmuUpdRead_(sh, 2), prevLabel = toBase ? '' : lmuUpdLabel_(sh, 2);
    lmuUpdWrite_(sh, 1, prev, prev ? prevLabel : '');
    lmuUpdWrite_(sh, 2, '', '');
    lmuUpdCacheClear_();
    return { v: prev ? prevLabel : lmuBase_() };
  } finally { lock.releaseLock(); }
}
