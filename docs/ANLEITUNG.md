# LMU Stint-Sync – Anleitung

## Was es macht
Liest Le Mans Ultimate (eingebautes Shared Memory "LMU_Data") und schreibt automatisch
ins Team-Sheet:
- Stints, jede Runde, Boxenstopps, Ereignisse (Schaden, Strafen)
- Ist-Zeiten direkt in den Rennplan (Spalten L–V: Start, Ende, best Lap, Runden, Reifen …)
- Live-Status fürs Handy-Dashboard (…/exec?view=live), optional mit Livestream
- optional Discord-Meldungen (wird im Sheet eingestellt, nicht in der exe)

Neu in 2.0: Nur freigegebene Fahrer können ins Sheet schreiben.
Jede exe meldet sich beim Sheet an, der Sheet-Besitzer gibt sie frei.

## Einmalig in LMU
Einstellungen → Gameplay → "Enable Plugins" = AN, danach LMU komplett neu starten.

## FAHRER: exe benutzen
1. lmu-stint-sync.exe von [GitHub → Releases](https://github.com/zoppmczopper-ship-it/LMU-Stint-Sync/releases/latest) herunterladen, in einen eigenen Ordner legen und doppelklicken. Windows-Warnung "Der Computer wurde durch Windows geschützt": "Weitere Informationen" → "Trotzdem ausführen" (Tool ist nicht signiert).
2. Im Browser öffnet sich das Einstellungsfenster (http://127.0.0.1:8765).
   - "Team-Sheet": Web-App-Link einfügen, den du vom Team-Chef bekommst → Verbinden
   - "Fahrer": Name optional (sonst LMU-Spielername) → Speichern
3. Status zeigt "wartet auf Freigabe", bis der Team-Chef dich freigibt ("Status prüfen" fragt sofort nach). Alles, was du bis dahin fährst, wird zwischengespeichert und nach der Freigabe nachgeschickt.
4. exe offen lassen, solange du fährst. Stint-Start und -Ende erkennt das Tool selbst. "Testdaten senden" prüft die Verbindung ohne LMU (Session "Training").

## TEAM-CHEF: Team-Sheet anlegen und verwalten
Neues Sheet (im Einstellungsfenster unter "Team-Sheet" → "Neues Team-Sheet erstellen"):
1. [Vorlage kopieren](https://docs.google.com/spreadsheets/d/1K0Y-eFd_hiEn9-u10auDT-HEaRxVmK2_muiGMa3ke3Y/copy) ("Kopie erstellen") – der ganze Code wird mitkopiert.
2. In der Kopie: Menü "LMU Sync" → "Einrichten / Web-App bereitstellen", Zugriff erlauben und den Schritten folgen (Bereitstellen → Web-App, Ausführen als: Ich, Zugriff: Jeder). Den Web-App-Link einfügen und speichern.
3. Diesen Link an die Fahrer schicken.

Neues Event planen: Menü "LMU Sync" → "Neues Event …" (oder im Admin)
- Name, Rennstart, Renndauer, Rundenzeit, Runden pro Stint, Boxenstopp-Zeit
- Fahrer auswählen (alle freigegebenen + frei eingetragene Namen), Reihenfolge per Pfeil, "Stints am Stück pro Fahrer" → die Rotation wird automatisch vorbefüllt
- Ergebnis: neuer Tab mit allen Stints, Plan- und Ortszeiten inkl. Zeitumstellung, Pause seit dem letzten Stint je Fahrer, Fahrer-Dropdown mit Farben. Gelbe Felder (Rennstart, Rundenzeit, Boxenstopp, Runden je Stint) ändern → alles rechnet neu.
- Oben "Rennen aus Race Control übernehmen" → "Laden" holt geplante Rennen von racecontrol.gg: Daily Races (Stufe Beginner / Intermediate / Advanced, mit Dauer) und Community-Events (Mindest-Rating ohne Vorgabe / Bronze / Silber / Gold / Platin), DLC-Filter: Strecken-Pakete ankreuzen, die man besitzt, + "nur Rennen ohne fehlende DLC" (fehlende Pakete werden rot markiert), Filter "nur Team-Events", "nur ab 1 h" und Suche. Klick übernimmt Name und Startzeit (bei Daily Races auch die Dauer). Event-Link einfügen geht auch. Der Filter wird gemerkt.
- Alte Events bleiben als Tabs erhalten; im Admin "Als aktives Event setzen" wählt, wohin die Ist-Zeiten aus LMU geschrieben werden.

Verwalten: Menü "LMU Sync" → "Admin" (Seitenleiste, nur für den Besitzer):
- Fahrer freigeben / sperren / umbenennen / löschen (der Name hier wird im Sheet verwendet)
- Events anlegen / aktiv setzen, automatisches Eintragen an/aus, neue Fahrer automatisch freigeben
- Livestream-Link (YouTube/Twitch), Discord-Webhook, Discord-Live-Nachricht
- Plan-Zuordnung zurücksetzen (nächster Renn-Stint → erste Zeile ohne Startzeit)
Nur Sessions vom Typ "Rennen" werden in den Plan eingetragen; Training landet nur in den Stint-Tabs.

## Zusatzfunktionen (Eingabeaufforderung im Ordner der exe)
```
lmu-stint-sync.exe -dump        zeigt die Rohdaten aus LMU
lmu-stint-sync.exe -simulate    schickt Testdaten (Session "Training") ins Sheet
lmu-stint-sync.exe -driver Name Fahrername festlegen
lmu-stint-sync.exe -noui        ohne Browser-Fenster starten
lmu-stint-sync.exe -rest        Werte der internen LMU-Schnittstelle in lmu-rest-dump.txt schreiben
```

Einstellungen liegen in lmu-stint-sync.json neben der exe. Geräte-ID und Schlüssel
werden automatisch erzeugt – die Datei nicht weitergeben, jeder Fahrer braucht seine eigene.
Alte Sheets (Version 1 mit "token") funktionieren weiter.

## Pi-hole / DNS-Blocker
Für Dashboard und Rückmeldung des Sheets muss erlaubt sein:
`(^|\.|-)script\.googleusercontent\.com$` (Regex-Allow)

## MECHANIKER-BOARD (ab 2.2)
Aufruf: Web-App-Link + ?view=box   (Link auch im Admin unter "Web-App")
- Ampeln: Energie (Runden bis leer), Reifen (%), Bremsen (°C), Motor (Wasser/Öl), Schaden (neu)
- Energie: Sprit, VE, Batterie, Ø-Verbrauch der letzten 5 sauberen Runden, Runden bis leer, späteste Boxenrunde, Nachfüllmenge bis voll und bis Rennende
- Reifen je Rad: Verschleiß + Trend/Rd, Temperatur innen/mitte/außen, Druck, Alter in Runden, Mischung, Doppelstint-Anzeige; Bremsentemperaturen
- Schaden, Wasser/Öl, Überhitzung, Strecke/Luft, Regen/Nässe
- Werkstatt-Daten aus LMU (Verschleiß/Reparatur), falls LMU sie über seine interne Schnittstelle liefert (nur lesend)
- Boxenstopp-Protokoll (getankt, welche Reifen, Reparatur, Schaden vorher/nachher, Fahrerwechsel)
- Stint-Zusammenfassung (Ø Sprit/VE pro Runde, Reifenabbau/Rd, Rundenzeit-Abfall)
Grenzwerte der Ampeln: Tab "Sync-Einstellungen" (Ampel ...). "Discord-Ampel" = Meldung bei Rot.
Die neuen Werte liefert erst die exe ab Version 2.2.

## SETUP-TIPPS (ab 2.3)
Die exe wertet das Fahrverhalten 20× pro Sekunde aus (Untersteuern/Übersteuern je Kurvenphase,
Blockieren, Durchdrehen, TC/ABS-Eingriffe, Aufsetzen) und schickt pro Runde Kennzahlen.
Das Mechaniker-Board zeigt daraus Tipps mit den aktuellen Werten im Auto
(TC, TC-Slip, ABS, Motor-Map, Bremsbalance, Migration, Stabis), z. B. "TC 3 → 4",
plus Garage-Hinweise (Flügel, Sturz, Luftdruck, Kühlung). Faustregeln – immer nur eine
Änderung auf einmal und 2–3 Runden beobachten.

## DASHBOARD-LINKS IN DER EXE (ab 2.4)
Im Einstellungsfenster (http://127.0.0.1:8765) stehen unter dem Sheet-Link die Buttons
Stintplan, Live und Mechaniker-Board – so kommen auch Fahrer ohne Admin-Rechte hin.

## RUNDENZEIT- UND TANK-VORSCHLAG (Sheet 2.8)
Im Dialog "Neues Event": Strecke, Klasse und Setup (offen/fest) wählen (bei Race-Control-
Übernahme automatisch) → "Rundenzeit & Verbrauch vorschlagen":
- eigene Pace aus den Tabs Stints/Runden (Team-Median und je Fahrer) + euer Verbrauch/Runde
- Referenz von bop-tourism.com: Median je Driver-Rating (Bronze/Silber) und Stufen (Gold, Silber, Mittelfeld, Rookie), passend zur Renndauer
Klick übernimmt den Wert. Mit "Verbrauch pro Runde" (VE % oder Liter) und "Reserve"
zeigt der Event-Tab in Spalte K die empfohlene Tankmenge je Stint
((Runden + Reserve) × Verbrauch). Werte oben in E4/E5 änderbar.

## UPDATES PER KLICK (Sheet ab 2.9)
Im Admin (Menü „LMU Sync“ → „Admin“) erscheint oben „Update verfügbar: 2.9 → x.y“ mit den
Änderungen, sobald die Vorlage eine neuere Version hat. „Update übernehmen“ holt den neuen Code
und aktiviert ihn sofort – kein neues Bereitstellen, der Web-App-Link der Fahrer bleibt gleich.
Unten unter „Updates“: „Nach Updates suchen“ und „Zurück auf …“ (vorige Version wiederherstellen).

So funktioniert es:
- Die Vorlage liefert ihre Version über ihre Web-App (…/exec?api=release).
- Ein übernommenes Update liegt im versteckten Tab „LMU-Update“; die Datei zz_Update.gs lädt es bei jedem Aufruf. Ist das Update älter als der eingebaute Code (z. B. frische Kopie der Vorlage), wird es ignoriert. Ein fehlerhaftes Update wird nicht übernommen.
- zz_Update.gs muss die letzte Skriptdatei im Projekt bleiben (Dateien nicht „A–Z sortieren“ und nicht umbenennen).
- Sheets mit Version 2.8 oder älter: einmalig die Vorlage neu kopieren (oder die Dateien Code.gs, Sync.gs, Admin.html, zz_Update.gs, Release.html übernehmen), danach geht alles per Klick.
- Braucht eine neue Version zusätzliche Google-Berechtigungen, zeigt der Admin das an – dann muss die Vorlage neu kopiert werden.

Neue Version veröffentlichen (nur Vorlage, für den Betreuer):
  1. SYNC_VERSION in Sync.gs erhöhen, release-notes.json oben ergänzen.
  2. node build-release.js  → erzeugt apps-script-v2/Release.html
  3. Geänderte Dateien + Release.html in die Vorlage kopieren, speichern.
  4. Bereitstellen → Bereitstellungen verwalten → Bearbeiten → Neue Version → Bereitstellen.
  Ab dann sehen alle Team-Sheets das Update im Admin (Prüfung max. 1× pro Stunde, sofort mit
  „Nach Updates suchen“).

## NEU IN SHEET 2.9.1 / 2.9.2
Ablauf Training → Qualifying → Rennen (Dialog „Neues Event“):
- „Event-Start“ = Beginn Training. Training (min), Qualifying (min), Pause bis Rennstart (min) eintragen – der Rennstart wird daraus berechnet (alles 0 = Event-Start ist der Rennstart).
- Im Event-Tab: L1–M4 (gelb, änderbar), B1 = berechneter Rennstart, C1 zeigt den Ablauf.
- Plan-Dashboard zeigt vorher „Training läuft · Rennstart in …“ bzw. „Qualifying läuft“.
- In den Plan (Ist-Zeiten) werden weiterhin nur Rennsessions eingetragen; Training und Qualifying landen in den Tabs Stints/Runden und liefern den Verbrauch fürs Rennen.
Gesamtrunden: Vorschau im Dialog und im Event-Tab (G4).
Mechaniker-Board:
- „Sprit fürs Rennen“: Ø-Verbrauch pro Runde aus Training/Qualifying (gleiche Strecke und Auto, letzte 40 saubere Runden; sonst Wert aus E4) × Rennlänge des aktiven Events + Reserve. Zeigt die Start-Tankmenge (l und/oder % VE): ganzes Rennen ohne Stopp, sonst 1. Stint bzw. voll tanken, und die Mindestzahl der Boxenstopps.
- Reifentemperatur: kalt < 70 °C, okay 70–80, ideal 80–90, warm 90–97, heiß > 97 °C.
- Bremsen: kalt < 350 °C, gut bis 650, kritisch bis 750, darüber zu heiß. (Grenzwerte im Tab „Sync-Einstellungen“ änderbar.)
- Abstand zum Auto vor/hinter einem.

## KLASSEMENT (exe 2.5 + Sheet 2.9.3)
Live-Dashboard und Mechaniker-Board zeigen alle Autos mit Abständen:
- Pos in der Klasse (darunter Gesamtplatz), Fahrer · Auto, Runden
- zum Führenden der Klasse, Intervall zum Vordermann, „zu mir“ (− = vor mir, + = hinter mir)
- letzte und beste Runde, Anzahl Boxenstopps, 🅿 = gerade in der Box, 🏁 = im Ziel
- Umschalter „Meine Klasse“ / „Alle“ (Klassen nach Gesamtplatz sortiert)
- Rennen: Abstände nach Rennzeit, bei Überrundung „+1 Rd“; Training/Qualifying: nach Bestzeit
Die Daten schickt die exe alle 10 s mit dem Live-Status – dafür braucht jeder Fahrer exe 2.5.

## RACE CONTROL – WAS GEFUNDEN WIRD (Sheet 2.9.5)
- Daily Races: Race Control veröffentlicht nur die Termine von HEUTE. Klick auf ein Daily Race zeigt die Termine der nächsten 7 Tage – spätere Tage sind im selben Takt hochgerechnet („voraussichtlich“, der Plan kann sich zum Wochenwechsel ändern → am Renntag prüfen).
- Community-Events: kommende UND laufende Meisterschaften (alle Seiten). Angezeigt wird die nächste Runde; die Suche findet auch Strecken einzelner Runden.
- Hosted Races: privat organisierte Rennen; Training/Qualifying/Renndauer werden übernommen.
- Strecken-DLC: Barcelona = ELMS Pack 3. Ist „nur Rennen ohne fehlende DLC“ angehakt und das Paket nicht angekreuzt, werden diese Rennen ausgeblendet.
- Die Liste wird 30 min zwischengespeichert; Laden dauert beim ersten Mal bis ~40 s.

## MEHRERE TEAMS (exe 2.6)
Im Einstellungsfenster (http://127.0.0.1:8765) oben „Team – ich fahre gerade für“:
- „Team hinzufügen“: Name (leer = Name des Sheets) + Web-App-Link. Beliebig viele Teams.
- Klick auf ein Team = ab jetzt gehen alle Daten in dieses Sheet. Nur zwischen Sessions wechseln.
- Noch nicht gesendete Daten bleiben beim Team, für das sie gefahren wurden, und werden geschickt, sobald du wieder für dieses Team fährst („… Einträge warten“).
- Jedes Team-Sheet muss das Gerät einmal freigeben (Admin → Fahrer & Geräte).
- Die bisherige Einstellung wird automatisch zum ersten Team.

## STRECKEN-ANALYSE (exe 2.6 + Sheet 3.0)
Aufruf: Web-App-Link + ?view=map (Link auch im Admin und in der exe).
Die exe zeichnet jede Runde auf (etwa alle 10 m: Position, Zeit, Tempo, Gas, Bremse, ~4 KB pro
Runde, Tab „Linien“). Die Karte entsteht aus der gefahrenen Linie – kein Streckenlayout nötig,
jedes Layout wird automatisch getrennt (über die Rundenlänge).
- Referenz: beste Team-Runde auf dieser Strecke (auch aus früheren Rennen), beste Runde der Auswahl oder frei gewählt (☆).
- „Runden aus“: eine Session/einen Tag oder alle; Fahrer per Klick ein-/ausblenden, je Fahrer beste oder letzte Runde oder frei gewählte Runden (☑).
- Karte: Fokus-Runde grün = schneller, rot = Zeit verloren; Linien aller Fahrer in ihren Farben; Kurven K1, K2 … (automatisch aus den Tempo-Minima), Highlights als Symbole. Mausrad = Zoom, Ziehen = Verschieben, Doppelklick = zurück, „spiegeln“ falls seitenverkehrt.
- Grafiken: Zeitabstand über die Runde, Tempo, Gas/Bremse; Maus zeigt die Stelle auf der Karte.
- „Wo geht Zeit verloren?“: größte Verluste je Kurve mit Grund (früher gebremst, weniger Kurvenspeed, Kurvenausgang).
Highlights für Videos (im Rennen automatisch erkannt):
- Überholt / Überholt worden (Klassenplatz, 3 s bestätigt, nicht durch Boxenstopps)
- Zweikampf (länger als 1,5 min innerhalb 1 s; Zeitpunkt = Beginn)
- Dreher, Kontakt/Schaden, Strafe, persönliche Bestzeit
- „Aufnahme gestartet um“ eintragen → Spalte „Video“ zeigt die Stelle im Video; „Als YouTube-Kapitel kopieren“ erzeugt die Kapitelliste.
Nur Runden, die mit exe 2.6 gefahren wurden, haben eine Spur.

## AKTIVES RENNEN & AUTOMATISCHE EVENTS (Sheet 3.1, exe 2.6.1)
- Live-Dashboard zeigt nur Daten des laufenden Events: vom Event-Start (inkl. Training/Quali, falls eingetragen) bis kurz nach Rennende. Außerhalb: „Kein aktives Rennen“ + nächstes Event. Häkchen „alle Daten“ oben zeigt trotzdem alles. Abschalten: Sync-Einstellungen „Live nur aktives Rennen“ = nein.
- Startet ein Rennen (Session „Rennen“) und es gibt kein Event, das zeitlich passt, legt das Sheet automatisch einen Event-Tab an und setzt ihn aktiv: Name = Strecke + Datum/Uhrzeit, Rennstart und Renndauer aus LMU (Sessionzeit, ab exe 2.6.1), Rundenzeit = eure bisherige Pace auf der Strecke (sonst 2:00), Plan-Stints à ca. 45 min, Fahrer = der startende Fahrer. Eintrag unter „Ereignisse“ und Meldung in Discord. Passt ein vorhandenes Event (Start bis 2 h vorher … Ende + 30 min), wird keins angelegt, sondern dieses aktiv gesetzt. Abschalten: „Event automatisch anlegen“ = nein. Testdaten (Strecke „Simulation“) legen nie ein Event an.

## TANK-EINSTELLUNG FÜR LMU (Sheet 3.2)
Mechaniker-Board, Karte „Sprit fürs Rennen“, oranger Kasten = Werte für
LMU → Pit Garage → Auto-Setup → Antriebsstrang → Motor:
- „Virtuelle Energie“ in % (Rennlänge bzw. 1. Stint + Reserve, aus dem Verbrauch im Training)
- „Kraftstoffkapazität“ = Liter Sprit je 1 % VE. Gemessen im Training/Qualifying (Liter/Runde ÷ VE-%/Runde) plus 3 % Sicherheit, damit der Sprit nie vor der VE ausgeht. Beispiel: 97 % × 0,85 = ca. 82,5 l an Bord.
- Autos ohne VE (LMP2/LMP3/GTE): „Kraftstoff“ in Litern.
Hinweis aus LMU: 100 % VE = automatisch maximale Kraftstoffmenge.

## WAS IN LMU EINGESTELLT IST (exe 2.6.3 + Sheet 3.3)
Die exe liest (nur lesend) die interne LMU-Schnittstelle auf diesem PC aus – alle 5 s, auch
in der Garage vor dem Losfahren:
- Garage-Setup: Virtuelle Energie %, Kraftstoffkapazität, Liter an Bord, LMU-Rundenschätzung
- Box-Menü (gilt für den nächsten Stopp): VE auffüllen auf, Fuel Ratio, Reifen, Drücke, Heckflügel, Bremsen tauschen, Fahrer
- Gegner: Tankfüllstand und Start-VE des laufenden Stints
Mechaniker-Board:
- „Sprit fürs Rennen“: unter der Empfehlung der Kasten „In LMU eingestellt“ – grün = passt, gelb = weicht ab (VE mehr als 2 % daneben oder Kraftstoffkapazität ≥ 0,02 daneben)
- Neue Karte „Box-Menü in LMU“ mit „nötig bis Ziel“ = so viel VE braucht ihr beim nächsten Stopp bis zur Zielflagge (+1 Runde Reserve). Rot = zu wenig eingestellt, gelb = deutlich zu viel (kostet Standzeit). Ändern kann man das nur im Spiel.
- Klassement: „⛽ 60 %“ = Tankfüllstand, „Start-VE 79 %“ = mit so viel VE ist der Gegner in seinen aktuellen Stint gestartet – daraus lässt sich sein nächster Stopp abschätzen.

## MEHRERE FAHRER GLEICHZEITIG (exe 2.6.4 + Sheet 3.4)
Jeder Fahrer hat im Sheet seinen eigenen Live-Stand (Name aus der Fahrerliste) – fahren zwei
gleichzeitig, überschreibt sich nichts mehr.
- Mechaniker-Board / Live-Dashboard: oben erscheint eine Auswahl, sobald mehr als einer fährt: „🟢 Name · Strecke · Session · #Startnummer“ (🟢 = sendet gerade, ⚪ = vor über 3 min). Die Wahl merkt sich der Browser.
- Fahrerwechsel: gleiches Auto + gleiche Strecke/Session + gleicher Session-Start = ein „Lauf“. Steigt ein anderer Fahrer ins selbe Auto, springt die Ansicht automatisch auf ihn; Event, Plan und Box-Menü laufen weiter.
- Events: jedes Rennen (Auto + Session) bekommt sein eigenes Event. Ein Event, das gerade ein anderes Auto benutzt, wird nicht doppelt belegt – fährt ein zweites Team-Auto im selben Rennen, bekommt es einen eigenen Event-Tab. Plan-Einträge gehen in das Event des jeweiligen Laufs. Der aktive Plan-Tab im Admin wechselt nur, wenn er nicht gerade von einem anderen Rennen benutzt wird.
- Live-Dashboard: Stints/Stopps/Ereignisse anderer Fahrer auf einer anderen Strecke werden ausgeblendet („alle Daten“ zeigt alles).
- Box-Menü schickt nur noch, wer selbst im Auto sitzt; Zuschauer schicken nur ihr Garagen-Setup.


## UPDATES ÜBER GITHUB (exe 2.6.5 + Sheet 3.5)
- **exe:** Beim Start (und alle 6 h) schaut die exe auf GitHub nach einer neueren Version. Gibt es eine, erscheint oben im Einstellungsfenster „Neue Version … verfügbar“ mit Link zum Download. Alte exe schließen, neue starten – die Einstellungen (lmu-stint-sync.json) bleiben.
- **Sheet:** Admin → Updates holt neue Versionen jetzt von GitHub (Ordner `dist/sheet` im Repository). Ist GitHub nicht erreichbar, kommt das Update wie bisher von der Vorlage.
