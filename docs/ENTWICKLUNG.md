# Entwicklung & Veröffentlichen

## exe (Go)

```
cd exe
go test ./...
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w -X main.Version=$(cat VERSION)" -o lmu-stint-sync.exe .
```

**Neue exe-Version veröffentlichen:** Nummer in `exe/VERSION` erhöhen und auf `main` pushen.
Die GitHub-Action *exe-Release* baut die exe und legt das Release `exe-vX.Y.Z` mit
`lmu-stint-sync.exe` an (nur wenn es das Release noch nicht gibt). Laufende exes melden die
neue Version dann im Einstellungsfenster.

## Sheet (Apps Script)

1. Code in `sheet/` ändern, `SYNC_VERSION` in `sheet/Sync.gs` erhöhen.
2. Oben in `release-notes.json` einen Eintrag mit derselben Version anlegen.
3. `node build-release.js` → erzeugt `dist/sheet/release.json`, `release-meta.json` und `sheet/Release.html`.
4. Auf `main` pushen. Alle Sheets ab 3.5 sehen das Update dann im Admin (Cache bis 1 h; „Prüfen“ fragt sofort).

Regeln, die der Update-Lader braucht:
- In `Code.gs` und `Sync.gs` oben nur `var`, kein `const`/`let` (prüft build-release.js).
- `zz_Update.gs` muss die letzte Skriptdatei bleiben.
- In HTML-Dateien keine `//`-Kommentare (HtmlService).
- Ändern sich die Berechtigungen (`appsscript.json`), reicht ein Update nicht – dann `boot` erhöhen und die Vorlage neu kopieren lassen.

**Vorlage:** Die Vorlage (Google Sheet) bleibt die Kopiervorlage für neue Teams und Ersatzquelle für Updates.
Nach einem Release dort `sheet/*` einspielen und eine neue Version bereitstellen, damit neue Kopien gleich aktuell sind.
