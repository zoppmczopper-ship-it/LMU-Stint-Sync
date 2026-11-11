/**
 * LMU Stint-Sync – Update-Lader. Bitte nicht ändern und nicht umbenennen:
 * Diese Datei muss die LETZTE Skriptdatei im Projekt bleiben.
 *
 * Wurde im Admin ein Update übernommen, liegt der neue Code im versteckten Tab „LMU-Update“.
 * Ist er neuer als der eingebaute Code, wird er hier geladen und ersetzt die Funktionen oben.
 * Admin → Updates → „Zurück“ schaltet wieder um.
 */
var LMU_BOOT = 1;
var LMU_BASE = SYNC_VERSION;
var LMU_HTML = {};
var LMU_ACTIVE = '';
var LMU_LOAD_ERR = '';

(function lmuLoad() {
  function cmp(a, b) {
    a = String(a || '0').split('.').map(Number); b = String(b || '0').split('.').map(Number);
    for (var i = 0; i < Math.max(a.length, b.length); i++) { var d = (a[i] || 0) - (b[i] || 0); if (d) return d > 0 ? 1 : -1; }
    return 0;
  }
  try {
    var c = CacheService.getScriptCache(), m = c.get('lmuB'), s = null, i;
    if (m === 'none') return;
    if (m) {
      var n = parseInt(m, 10), keys = [];
      for (i = 0; i < n; i++) keys.push('lmuB' + i);
      var got = c.getAll(keys);
      s = '';
      for (i = 0; i < n; i++) { if (got['lmuB' + i] == null) { s = null; break; } s += got['lmuB' + i]; }
    }
    if (s === null) {
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('LMU-Update');
      s = '';
      if (sh && sh.getLastRow() > 1) s = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0] || '').slice(1); }).join('');
      if (!s) c.put('lmuB', 'none', 21600);
      else {
        var parts = {}, k = 0;
        for (i = 0; i < s.length; i += 30000) parts['lmuB' + (k++)] = s.slice(i, i + 30000);
        c.putAll(parts, 21600);
        c.put('lmuB', String(k), 21600);
      }
    }
    if (!s) return;
    var b = JSON.parse(s);
    if (cmp(b.v, LMU_BASE) <= 0 || (b.boot || 1) > LMU_BOOT) return;
    (0, eval)(b.server);
    LMU_HTML = b.html || {};
    LMU_ACTIVE = b.v;
  } catch (e) {
    LMU_LOAD_ERR = String(e && e.message || e);
    console.error('LMU-Update konnte nicht geladen werden: ' + LMU_LOAD_ERR);
  }
})();
