# LMU Stint-Sync

Telemetrie aus **Le Mans Ultimate** fürs ganze Team – live in einem Google Sheet, auf dem Handy und auf Discord.

Eine kleine Windows-exe liest die Daten aus LMU (Shared Memory + interne LMU-Schnittstelle) und schickt sie an euer Team-Sheet. Das Sheet trägt Stints, Runden und Boxenstopps automatisch in den Rennplan ein und liefert mehrere Web-Ansichten:

| Ansicht | Wofür |
|---|---|
| **Live-Dashboard** (`…/exec?view=live`) | Stand des laufenden Rennens, Klassement mit Abständen, Livestream |
| **Mechaniker-Board** (`…/exec?view=box`) | Sprit/VE, Reifen, Bremsen, Box-Ampel, Start-Tankmenge, Box-Menü aus LMU, Setup-Tipps |
| **Strecken-Analyse** (`…/exec?view=map`) | Streckenkarte, wo Zeit verloren geht, Vergleich mit Team-Bestzeit, Highlights für Videos |
| **Event-Planer** (Menü „LMU Sync“) | Rennen aus Race Control übernehmen, Fahrer-Rotation, Training/Quali/Rennen |

Mehrere Fahrer und mehrere Autos gleichzeitig werden getrennt; Fahrerwechsel im selben Auto werden erkannt.

## Schnellstart

**Team-Chef (einmal pro Team)**
1. [Vorlage kopieren](https://docs.google.com/spreadsheets/d/1K0Y-eFd_hiEn9-u10auDT-HEaRxVmK2_muiGMa3ke3Y/copy) – der ganze Code kommt mit.
2. In der Kopie: Menü **LMU Sync → Einrichten / Web-App bereitstellen** und den Schritten folgen.
3. Den Web-App-Link an die Fahrer schicken und sie im Admin freigeben.

**Fahrer**
1. Neueste `lmu-stint-sync.exe` unter [Releases](https://github.com/zoppmczopper-ship-it/LMU-Stint-Sync/releases/latest) herunterladen.
2. In LMU einmalig *Einstellungen → Gameplay → Enable Plugins* einschalten.
3. exe starten, im Fenster den Web-App-Link einfügen → Verbinden. Fertig – Stints erkennt das Tool selbst.

Die ausführliche Anleitung steht in **[docs/ANLEITUNG.md](docs/ANLEITUNG.md)**.

## Updates

- **exe:** zeigt selbst an, wenn auf GitHub eine neue Version liegt.
- **Sheet:** Admin → *Updates* → „Update übernehmen“ – holt die neue Version aus [`dist/sheet`](dist/sheet), ohne neu bereitzustellen.

Änderungen: [release-notes.json](release-notes.json) (Sheet) und die [Releases](https://github.com/zoppmczopper-ship-it/LMU-Stint-Sync/releases) (exe).

## Aufbau des Repositorys

```
exe/          Go-Quellcode der Windows-exe (VERSION = aktuelle exe-Version)
sheet/        Apps-Script-Code des Team-Sheets (Code.gs, Sync.gs, zz_Update.gs, HTML-Ansichten)
dist/sheet/   fertige Sheet-Updates (release.json), von build-release.js erzeugt
docs/         Anleitung und Entwickler-Hinweise
```

Hinweise zum Bauen und Veröffentlichen: [docs/ENTWICKLUNG.md](docs/ENTWICKLUNG.md).

## Hinweis

Inoffizielles Fan-Projekt, nicht mit Studio 397 / Motorsport Games verbunden. Die exe liest nur – sie schreibt nichts in LMU.
