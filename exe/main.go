package main

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"math"
	mrand "math/rand"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// Set at build time via -ldflags.
var (
	DefaultURL   = ""
	DefaultToken = ""
	TemplateURL  = "https://docs.google.com/spreadsheets/d/1K0Y-eFd_hiEn9-u10auDT-HEaRxVmK2_muiGMa3ke3Y/edit"
	Version      = "dev"
)

type Config struct {
	URL       string `json:"url"`
	Token     string `json:"token,omitempty"`
	Driver    string `json:"driver,omitempty"`
	Device    string `json:"device"`
	Key       string `json:"key"`
	NoBrowser bool   `json:"no_browser,omitempty"`
	Port      int    `json:"port,omitempty"`
	Discord   string `json:"discord_webhook,omitempty"`
	Teams     []Team `json:"teams,omitempty"` // mehrere Team-Sheets; URL = gerade aktives
}

// Team ist ein Team-Sheet, für das man fahren kann.
type Team struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// activeTeam liefert den Index des Teams, dessen Link gerade aktiv ist (-1 = keins).
func (c Config) activeTeam() int {
	for i, t := range c.Teams {
		if t.URL == c.URL && c.URL != "" {
			return i
		}
	}
	return -1
}

func configPath() string {
	exe, err := os.Executable()
	if err != nil {
		return "lmu-stint-sync.json"
	}
	return filepath.Join(filepath.Dir(exe), "lmu-stint-sync.json")
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func loadConfig() Config {
	c := Config{URL: DefaultURL, Token: DefaultToken}
	if data, err := os.ReadFile(configPath()); err == nil {
		var f Config
		if json.Unmarshal(data, &f) == nil {
			if f.URL != "" {
				c.URL = f.URL
			}
			if f.Token != "" {
				c.Token = f.Token
			}
			c.Driver, c.Device, c.Key, c.NoBrowser, c.Port, c.Discord = f.Driver, f.Device, f.Key, f.NoBrowser, f.Port, f.Discord
			c.Teams = f.Teams
		}
	}
	changed := false
	// bisherige Einstellung (ein Sheet) → erstes Team
	if c.URL != "" && c.activeTeam() < 0 {
		c.Teams = append(c.Teams, Team{URL: c.URL})
		changed = true
	}
	if c.Device == "" || len(c.Key) < 32 {
		c.Device, c.Key, changed = randHex(8), randHex(32), true
	}
	if c.Port == 0 {
		c.Port = 8765
	}
	if changed {
		saveConfig(c)
	}
	return c
}

func saveConfig(c Config) {
	data, _ := json.MarshalIndent(c, "", "  ")
	if err := os.WriteFile(configPath(), data, 0o600); err != nil {
		logf("Einstellungen konnten nicht gespeichert werden: %v", err)
	}
}

/* ---------------- Protokoll ---------------- */

var (
	logMu    sync.Mutex
	logLines []string
)

func logf(format string, a ...any) {
	line := time.Now().Format("15:04:05") + "  " + fmt.Sprintf(format, a...)
	fmt.Println(line)
	logMu.Lock()
	logLines = append(logLines, line)
	if len(logLines) > 200 {
		logLines = logLines[len(logLines)-200:]
	}
	logMu.Unlock()
}

func recentLog(n int) []string {
	logMu.Lock()
	defer logMu.Unlock()
	if len(logLines) < n {
		n = len(logLines)
	}
	return append([]string{}, logLines[len(logLines)-n:]...)
}

/* ---------------- App ---------------- */

type App struct {
	mu      sync.Mutex
	cfg     Config
	out     *Sender
	tr      *Tracker
	snap    *Snap
	lmu     bool
	simBusy bool
}

func (a *App) setSnap(s *Snap, connected bool) {
	a.mu.Lock()
	a.snap, a.lmu = s, connected
	a.mu.Unlock()
}

func main() {
	sim := flag.Bool("simulate", false, "Testdaten ohne LMU an das Sheet schicken")
	dump := flag.Bool("dump", false, "Rohdaten aus LMU anzeigen (zur Kontrolle)")
	rest := flag.Bool("rest", false, "interne LMU-Schnittstelle auslesen und in lmu-rest-dump.txt speichern")
	driver := flag.String("driver", "", "Fahrername überschreiben")
	noUI := flag.Bool("noui", false, "Einstellungsfenster nicht öffnen")
	flag.Parse()

	fmt.Printf("LMU Stint-Sync %s\n", Version)
	fmt.Println("Liest Le Mans Ultimate und schreibt Stints, Runden und Boxenstopps ins Team-Sheet.")
	fmt.Println("Dieses Fenster offen lassen, solange du fährst. Beenden mit Strg+C oder Fenster schließen.")
	fmt.Println(strings.Repeat("─", 70))

	if *rest {
		restDump()
		return
	}
	if *dump {
		runDump()
		return
	}
	cfg := loadConfig()
	if *driver != "" {
		cfg.Driver = *driver
	}
	app := &App{cfg: cfg}
	app.out = NewSender(cfg)
	if cfg.Discord != "" {
		app.out.Discord = NewDiscord(cfg.Discord)
	}
	app.tr = NewTracker(app.out, cfg.Driver)

	if *sim {
		runSim(app.out, cfg.Driver, true)
		return
	}
	startUpdateCheck()
	addr, err := startUI(app)
	if err != nil {
		logf("Einstellungsfenster konnte nicht gestartet werden: %v", err)
	} else {
		logf("Einstellungen & Status: %s", addr)
		if !cfg.NoBrowser && !*noUI {
			openBrowser(addr)
		}
	}
	if cfg.URL == "" {
		logf("Noch kein Team-Sheet eingetragen – bitte im Einstellungsfenster verbinden.")
	}
	run(app)
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}

func run(app *App) {
	tr, out := app.tr, app.out
	buf := make([]byte, MappingSize)
	var mem *shm
	var lastET float64
	lastChange := time.Now()
	lastPrint := time.Time{}
	hinted := false
	for {
		if mem == nil {
			m, err := openSHM()
			if err != nil {
				tr.Disconnected()
				app.setSnap(nil, false)
				if !hinted {
					logf("Warte auf Le Mans Ultimate … (Einstellungen → Gameplay → „Enable Plugins“ muss AN sein, danach LMU neu starten)")
					hinted = true
				}
				printStatus(tr, out, &lastPrint)
				time.Sleep(2 * time.Second)
				continue
			}
			mem, lastChange = m, time.Now()
			logf("✔ Verbindung zu Le Mans Ultimate hergestellt")
		}
		if err := mem.read(buf); err != nil {
			time.Sleep(100 * time.Millisecond)
			continue
		}
		s := parse(buf)
		if s.ET != lastET {
			lastET, lastChange = s.ET, time.Now()
		}
		if time.Since(lastChange) > 30*time.Second && !s.InRealtime {
			mem.close()
			mem = nil
			hinted = false
			continue
		}
		tr.Update(s)
		app.setSnap(s, true)
		printStatus(tr, out, &lastPrint)
		time.Sleep(50 * time.Millisecond) // 20 Hz – nötig für die Fahrverhalten-Auswertung
	}
}

func authText(st SenderState) string {
	switch {
	case st.URL == "":
		return "kein Team-Sheet verbunden"
	case st.Auth == "freigegeben":
		if st.LastErr != "" {
			return "Sheet-FEHLER: " + st.LastErr
		}
		return "Sheet OK"
	case st.Auth == "legacy":
		return "Sheet OK (ältere Version)"
	case st.Auth == "wartet":
		return "wartet auf Freigabe durch den Admin"
	case st.Auth == "gesperrt":
		return "vom Admin gesperrt"
	case st.Auth == "?":
		return "Sheet: " + st.AuthMsg
	case st.Auth == "":
		return "verbinde mit Sheet …"
	}
	return "Sheet: " + st.Auth + " " + st.AuthMsg
}

func printStatus(tr *Tracker, out *Sender, last *time.Time) {
	if time.Since(*last) < 60*time.Second {
		return
	}
	*last = time.Now()
	st := out.State()
	fmt.Printf("%s  %s | gesendet: %d, wartend: %d | %s\n", time.Now().Format("15:04:05"), tr.Status, st.Sent, st.Pending, authText(st))
}

func runDump() {
	buf := make([]byte, MappingSize)
	for {
		mem, err := openSHM()
		if err != nil {
			fmt.Println("LMU_Data nicht gefunden – läuft LMU und ist „Enable Plugins“ an?", err)
			time.Sleep(2 * time.Second)
			continue
		}
		for {
			if mem.read(buf) != nil {
				continue
			}
			printSnap(parse(buf))
			time.Sleep(2 * time.Second)
		}
	}
}

func printSnap(s *Snap) {
	fmt.Printf("\n[%s] LMU-Build %d | Strecke %q | Session %s (%d) | Zeit %.1f s | Rest %.0f s | Realtime %v | Spieler %q | Autos %d\n",
		time.Now().Format("15:04:05"), s.GameVersion, s.Track, sessionName(s.Session), s.Session, s.ET, s.TimeRemaining, s.InRealtime, s.PlayerName, len(s.Cars))
	fmt.Printf("  Wetter: Luft %.1f °C, Strecke %.1f °C, Regen %.0f %%, Nässe %.0f %%\n", s.AmbientTemp, s.TrackTemp, s.Raining*100, s.Wet*100)
	if p := s.Player; p != nil {
		fmt.Printf("  Auto: %q (%s) Fahrer %q | Control %d | Runden %d | P%d / Klasse P%d | Letzte %s Beste %s | Box %v PitState %d | Stopps %d\n",
			p.Vehicle, p.Class, p.Driver, p.Control, p.Laps, p.Place, p.ClassPlace, fmtLap(p.Last), fmtLap(p.Best), p.InPits, p.PitState, p.Pitstops)
	}
	if t := s.Tel; t != nil {
		fmt.Printf("  Telemetrie: Sprit %.1f/%.0f l | VE %.1f %% | Reifen VL %.0f%% VR %.0f%% HL %.0f%% HR %.0f%% | Temp %.0f/%.0f/%.0f/%.0f °C | Schaden %d | Mischung %s/%s\n",
			t.Fuel, t.FuelCap, t.VE*100, t.Wear[0]*100, t.Wear[1]*100, t.Wear[2]*100, t.Wear[3]*100,
			t.TempC[0], t.TempC[1], t.TempC[2], t.TempC[3], t.Dents, t.CompoundF, t.CompoundR)
	} else {
		fmt.Println("  (keine Telemetrie – nicht im Auto)")
	}
}

// runSim sends a short fake session ("Training") so sheet and dashboard can be tested without LMU.
func runSim(out *Sender, driver string, interactive bool) {
	if driver == "" {
		driver = "Testfahrer"
	}
	logf("Simulation: schicke 2 kurze Test-Stints (Session „Training“) ins Sheet …")
	for si, d := range []string{driver, driver + " 2"} {
		id := time.Now().Format("20060102-150405") + "-SIM" + fmt.Sprint(si+1)
		fuel, ve := 90.0, 1.0
		wear := [4]float64{1, 1, 1, 1}
		out.Send(Msg{"type": "stint_start", "stint": id, "driver": d, "session": "Training", "track": "Simulation",
			"car": "Testauto #99", "class": "Hypercar", "lap": si * 5, "place": 5, "classPlace": 3,
			"fuel": fuel, "ve": 100.0, "wear": wearPct(wear), "compound": "Medium"})
		best, sum := 0.0, 0.0
		for l := 1; l <= 5; l++ {
			lt := 207 + mrand.Float64()*3
			fuel -= 3.1
			ve -= 0.042
			for i := range wear {
				wear[i] -= 0.035 + mrand.Float64()*0.01
			}
			if best == 0 || lt < best {
				best = lt
			}
			sum += lt
			lm := Msg{"type": "lap", "stint": id, "driver": d, "session": "Training", "lap": si*5 + l,
				"time": r3(lt), "s1": r3(lt * 0.31), "s2": r3(lt * 0.37), "s3": r3(lt * 0.32), "pit": l == 5,
				"fuel": r1(fuel), "fuelUsed": 3.1, "ve": pct(ve), "veUsed": 4.2, "wear": wearPct(wear),
				"place": 5, "classPlace": 3, "trackTemp": 24.5, "rain": 0.0}
			simMech(lm, l, si)
			lm["hdl"] = Msg{"entry": Msg{"n": 120, "us": 34.0, "os": 4.0}, "mid": Msg{"n": 200, "us": 12.0, "os": 6.0},
				"exit": Msg{"n": 150, "us": 5.0, "os": 22.0}, "lockF": 11.0, "lockR": 1.0, "abs": 18.0, "brakeN": 90,
				"exitN": 150, "spin": 19.0, "tc": 35.0, "bottom": 0.5,
				"set": Msg{"tc": 3, "tcMax": 11, "tcSlip": 4, "tcSlipMax": 11, "tcCut": 3, "tcCutMax": 11, "abs": 4, "absMax": 11,
					"map": 1, "mapMax": 5, "mig": 2, "migMax": 5, "arbF": 4, "arbFMax": 7, "arbR": 3, "arbRMax": 7, "bias": 54.5}}
			out.Send(lm)
			if tl := simTraceLap(1.0-0.025*float64(si)+0.004*float64(l), si*5+l, float64(si)); tl != nil {
				out.Send(Msg{"type": "trace", "stint": id, "driver": d, "session": "Training", "track": "Simulation",
					"car": "Testauto #99", "lap": si*5 + l, "time": r3(lt), "clean": true, "len": tl.Length, "n": tl.N, "data": tl.Data})
			}
			if l == 2 {
				now := time.Now().UTC()
				hl := []Msg{{"kind": "Überholt", "text": "Gegner A überholt (Auto #7) – Klasse P4 → P3 (Simulation)", "x": 700.0, "z": 120.0},
					{"kind": "Zweikampf", "text": "mit Gegner B (Auto #12) – 2:10 min, ab Runde 2 (Simulation)", "x": -500.0, "z": 300.0}}
				for k, h := range hl {
					h["type"], h["stint"], h["driver"], h["lap"] = "highlight", id, d, si*5+l
					h["at"], h["et"] = now.Add(-time.Duration(k*40)*time.Second).Format(time.RFC3339), 600.0+float64(si*300+l*60-k*40)
					out.Send(h)
				}
			}
			lv := Msg{"driver": d, "stint": id, "session": "Training", "track": "Simulation", "car": "Testauto #99",
				"class": "Hypercar", "lap": si*5 + l, "place": 5, "classPlace": 3, "last": r3(lt), "best": r3(best),
				"fuel": r1(fuel), "fuelCap": 90.0, "ve": pct(ve), "wear": wearPct(wear), "tyreTemp": []float64{85, 86, 88, 87},
				"gapAhead": 4.2, "gapBehind": 1.8, "inPits": false, "remaining": 80000.0, "trackTemp": 24.5, "air": 18.0,
				"rain": 0.0, "wet": 0.0, "yellow": 0, "penalties": 0, "stintLaps": l, "fuelPerLap": 3.1, "vePerLap": 4.2,
				"lapsLeft": r1(math.Min(fuel/3.1, ve/0.042)), "ahead": "Gegner A · Auto #7", "behind": "Gegner B · Auto #12",
				"stintStart": time.Now().UTC().Format(time.RFC3339)}
			simMech(lv, l, si)
			lv["field"] = simField(si*5 + l)
			out.Live(lv)
			time.Sleep(time.Second)
		}
		if si == 0 {
			out.Send(Msg{"type": "event", "stint": id, "driver": d, "kind": "Schaden", "text": "Kontakt/Schaden (Simulation)", "lap": 3})
		}
		out.Send(Msg{"type": "pit", "stint": id, "driver": d, "lap": si*5 + 5, "lane": 58.3, "stop": 31.2,
			"refuel": 15.5, "veAdded": 21.0, "tyres": 4, "repair": false, "wear": []float64{100, 100, 100, 100}})
		out.Send(Msg{"type": "stint_end", "stint": id, "driver": d, "reason": "Simulation", "laps": 5, "pits": 1,
			"incidents": 1 - si, "best": r3(best), "avg": r3(sum / 5), "fuel": r1(fuel), "ve": pct(ve),
			"wear": wearPct(wear), "place": 5, "classPlace": 3, "fuelUsed": 15.5, "veUsed": 21.0})
	}
	logf("Simulation in der Warteschlange – wird gesendet, sobald das Gerät freigegeben ist.")
	if interactive {
		for i := 0; i < 90 && out.Pending() > 0; i++ {
			time.Sleep(time.Second)
		}
		st := out.State()
		if st.Pending == 0 {
			fmt.Println("✔ Simulation vollständig ans Sheet übertragen.")
		} else {
			fmt.Println("✘ Noch nicht übertragen:", authText(st))
		}
		fmt.Println("Enter drücken zum Beenden …")
		bufio.NewReader(os.Stdin).ReadString('\n')
	}
}

// simMech liefert plausible Werte für das Mechaniker-Board im Testmodus.
func simMech(m Msg, l, si int) {
	f := float64(l)
	m["tyreIMO"] = [][]float64{{92 + f, 88 + f, 84 + f}, {95 + f, 89 + f, 83 + f}, {88 + f, 86 + f, 83 + f}, {89 + f, 86 + f, 84 + f}}
	m["brake"] = []float64{620 + 20*f, 640 + 20*f, 480, 470}
	m["press"] = []float64{178.5, 179.1, 176.2, 176.8}
	m["carcass"] = []float64{88, 89, 85, 85}
	m["water"], m["oil"], m["overheat"] = 92+f, 108+f, false
	m["battery"] = 55.0 - 3*f
	m["fuelCap"] = 90.0
	m["dents"], m["detached"], m["flat"] = map[bool]int{true: 2, false: 0}[si == 0 && l >= 3], false, false
	m["compound"] = "Medium"
	m["tyreLaps"] = []int{l + si*5, l + si*5, l, l}
	m["setStints"] = si + 1
	m["air"], m["trackTemp"], m["rain"], m["wet"] = 18.0, 24.5, 0.0, 0.0
}
