package main

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"
)

// Tracker turns a stream of snapshots into stint / lap / pit / incident events.
type Tracker struct {
	out      *Sender
	override string // driver name override from config

	inCar      bool
	candidate  bool
	candSince  time.Time
	stint      *stint
	lastLaps   int
	pendingLap *pendingLap
	pit        *pitState
	lastImpact float64
	lastDents  int
	lastPen    int
	lastLive   time.Time
	lastSetup  time.Time
	setupJSON  string
	tyreLaps   [4]int // Runden je Reifen seit dem letzten Wechsel
	setStints  int    // Stints auf dem aktuellen Reifensatz
	setTrack   string
	hdl        Handling
	trace      Trace
	hl         Highlights
	Status     string
	clock      func() time.Time
}

type stint struct {
	ID, Driver, Session, Track, Car, Class string
	Start                                  time.Time
	StartLap                               int
	FuelStart, VEStart                     float64
	Laps                                   []lapRec
	Pits, Incidents                        int
	lapFuel, lapVE                         float64 // values at start of current lap
	lapPit                                 bool    // pit lane visited during current lap
	refuelled                              bool
}

type lapRec struct {
	Time             float64
	Clean            bool
	FuelUsed, VEUsed float64
}

type pendingLap struct {
	laps     int
	prevLast float64
	since    time.Time
}

type pitState struct {
	start     time.Time
	stopStart time.Time
	stopDur   float64
	fuel, ve  float64
	wear      [4]float64
	dents     int
}

func NewTracker(out *Sender, override string) *Tracker {
	t := &Tracker{out: out, override: override, Status: "Warte auf Le Mans Ultimate …", clock: time.Now}
	t.hl.clock = func() time.Time { return t.clock() }
	t.hl.emit = t.highlight
	return t
}

// highlight meldet eine Szene für Videos (Überholen, Zweikampf, Dreher, Bestzeit) – nicht nach Discord.
func (t *Tracker) highlight(kind, text string, at time.Time, et, x, z float64) {
	if t.out == nil {
		return
	}
	id, drv, lap := "", "", 0
	if st := t.stint; st != nil {
		id, drv, lap = st.ID, st.Driver, st.StartLap+len(st.Laps)
	}
	t.out.Send(Msg{"type": "highlight", "stint": id, "driver": drv, "kind": kind, "text": text, "lap": lap,
		"at": at.UTC().Format(time.RFC3339), "et": r1(et), "x": r1(x), "z": r1(z)})
	logf("★ %s: %s", kind, text)
}

func (t *Tracker) driver(s *Snap) string {
	if t.override != "" {
		return t.override
	}
	if s.PlayerName != "" {
		return s.PlayerName
	}
	if s.Player != nil {
		return s.Player.Driver
	}
	return "Unbekannt"
}

func r1(v float64) float64  { return math.Round(v*10) / 10 }
func r3(v float64) float64  { return math.Round(v*1000) / 1000 }
func pct(v float64) float64 { return math.Round(v*1000) / 10 }

func wearPct(w [4]float64) []float64 { return []float64{pct(w[0]), pct(w[1]), pct(w[2]), pct(w[3])} }

// Disconnected is called when LMU is not reachable.
func (t *Tracker) Disconnected() {
	if t.inCar {
		t.endStint(nil, "LMU beendet")
	}
	t.inCar, t.candidate = false, false
	t.Status = "Warte auf Le Mans Ultimate …"
}

func (t *Tracker) Update(s *Snap) {
	if s != nil && s.PlayerName != "" && t.out != nil {
		t.out.SetLMUName(s.PlayerName)
	}
	now := t.clock()
	p, tel := s.Player, s.Tel
	want := s.InRealtime && p != nil && p.Control == 0 && tel != nil

	// debounce: state must hold 3 s
	if want != t.candidate {
		t.candidate, t.candSince = want, now
	}
	if want != t.inCar && now.Sub(t.candSince) >= 3*time.Second {
		if want {
			t.startStint(s)
		} else {
			t.endStint(s, "Fahrer ausgestiegen")
		}
	}
	if s.InRealtime || p != nil {
		t.setupTick(s, now)
	}
	if !t.inCar || p == nil || tel == nil {
		if s.InRealtime {
			t.Status = "LMU verbunden – nicht im Auto"
		} else {
			t.Status = "LMU verbunden – im Menü"
		}
		return
	}
	st := t.stint

	// session change while driving → new stint
	if sessionName(s.Session) != st.Session || s.Track != st.Track {
		t.endStint(s, "Session gewechselt")
		t.startStint(s)
		st = t.stint
	}

	if p.InPits {
		st.lapPit = true
	}
	t.hdl.Sample(s)
	t.trace.Sample(tel, p.InPits)
	t.hl.Sample(s, sessionName(s.Session) == "Rennen")

	// lap completed → wait until the last lap time has been updated
	if p.Laps > t.lastLaps && t.pendingLap == nil {
		t.pendingLap = &pendingLap{laps: p.Laps, prevLast: -1, since: now}
	}
	if pl := t.pendingLap; pl != nil && (now.Sub(pl.since) > 1500*time.Millisecond) {
		t.lap(s)
		t.pendingLap = nil
	}
	t.lastLaps = p.Laps

	// pit stop
	if p.InPits && t.pit == nil {
		t.pit = &pitState{start: now, fuel: tel.Fuel, ve: tel.VE, wear: tel.Wear, dents: tel.Dents}
	}
	if t.pit != nil {
		if p.PitState == 3 && t.pit.stopStart.IsZero() {
			t.pit.stopStart = now
		}
		if p.PitState != 3 && !t.pit.stopStart.IsZero() && t.pit.stopDur == 0 {
			t.pit.stopDur = now.Sub(t.pit.stopStart).Seconds()
		}
		if !p.InPits {
			t.pitDone(s)
		}
	}

	// incidents: new impact with more damage, flat or detached parts
	if tel.LastImpactET != t.lastImpact && tel.LastImpactET > 0 {
		if tel.Dents > t.lastDents || tel.Flat || tel.Detached {
			st.Incidents++
			txt := fmt.Sprintf("Kontakt/Schaden (Stärke %.0f, Schadensstufe %d)", tel.LastImpactMag, tel.Dents)
			if tel.Flat {
				txt += ", Reifenschaden"
			}
			if tel.Detached {
				txt += ", Teile abgefallen"
			}
			t.event(s, "Schaden", txt)
		}
		t.lastImpact = tel.LastImpactET
	}
	t.lastDents = tel.Dents
	if p.Penalties > t.lastPen {
		t.event(s, "Strafe", fmt.Sprintf("Neue Strafe (offen: %d)", p.Penalties))
	}
	t.lastPen = p.Penalties

	if now.Sub(t.lastLive) >= 10*time.Second {
		t.live(s)
		t.lastLive = now
	}
	t.Status = fmt.Sprintf("Im Auto: %s · %s · Runde %d · P%d (Klasse P%d)", t.driver(s), sessionName(s.Session), p.Laps, p.Place, p.ClassPlace)
}

func (t *Tracker) startStint(s *Snap) {
	p, tel := s.Player, s.Tel
	d := t.driver(s)
	st := &stint{
		ID:     t.clock().Format("20060102-150405") + "-" + strings.ReplaceAll(d, " ", "_"),
		Driver: d, Session: sessionName(s.Session), Track: s.Track, Car: p.Vehicle, Class: p.Class,
		Start: t.clock(), StartLap: p.Laps, FuelStart: tel.Fuel, VEStart: tel.VE,
		lapFuel: tel.Fuel, lapVE: tel.VE, lapPit: p.InPits,
	}
	if t.setTrack != s.Track+"|"+st.Session {
		t.tyreLaps, t.setStints, t.setTrack = [4]int{}, 0, s.Track+"|"+st.Session
		t.hl.bestLap = 0
	}
	t.trace = Trace{}
	t.hl.Reset()
	if t.setStints == 0 {
		t.setStints = 1
	}
	t.stint, t.inCar, t.lastLaps, t.pendingLap = st, true, p.Laps, nil
	t.lastImpact, t.lastDents, t.lastPen = tel.LastImpactET, tel.Dents, p.Penalties
	t.out.Send(Msg{"type": "stint_start", "stint": st.ID, "driver": d, "session": st.Session, "track": s.Track,
		"car": p.Vehicle, "class": p.Class, "lap": p.Laps, "place": p.Place, "classPlace": p.ClassPlace,
		"fuel": r1(tel.Fuel), "ve": pct(tel.VE), "wear": wearPct(tel.Wear),
		"compound":  strings.Trim(tel.CompoundF+" / "+tel.CompoundR, " /"),
		"sessionET": math.Round(s.ET), "sessionRemaining": math.Round(s.TimeRemaining)})
	logf("▶ Stint gestartet: %s (%s, %s)", d, st.Session, s.Track)
}

func (t *Tracker) endStint(s *Snap, reason string) {
	st := t.stint
	if st == nil {
		t.inCar = false
		return
	}
	m := Msg{"type": "stint_end", "stint": st.ID, "driver": st.Driver, "reason": reason, "laps": len(st.Laps),
		"pits": st.Pits, "incidents": st.Incidents}
	var best, sum float64
	n := 0
	for _, l := range st.Laps {
		if l.Time > 0 && (best == 0 || l.Time < best) {
			best = l.Time
		}
		if l.Clean && l.Time > 0 {
			sum += l.Time
			n++
		}
	}
	m["best"] = r3(best)
	if n > 0 {
		m["avg"] = r3(sum / float64(n))
	}
	if s != nil && s.Tel != nil && s.Player != nil {
		m["fuel"] = r1(s.Tel.Fuel)
		m["ve"] = pct(s.Tel.VE)
		m["wear"] = wearPct(s.Tel.Wear)
		m["place"] = s.Player.Place
		m["classPlace"] = s.Player.ClassPlace
		if !st.refuelled {
			m["fuelUsed"] = r1(st.FuelStart - s.Tel.Fuel)
			m["veUsed"] = pct(st.VEStart - s.Tel.VE)
		}
	}
	t.out.Send(m)
	logf("■ Stint beendet: %s, %d Runden (%s)", st.Driver, len(st.Laps), reason)
	t.stint, t.inCar, t.pit = nil, false, nil
}

func (t *Tracker) lap(s *Snap) {
	p, tel, st := s.Player, s.Tel, t.stint
	last := p.Last
	if last < 0 {
		last = 0
	}
	s1 := p.LastS1
	s2 := p.LastS2 - p.LastS1
	s3 := p.Last - p.LastS2
	if p.LastS1 <= 0 || p.LastS2 <= 0 || p.Last <= 0 {
		s1, s2, s3 = 0, 0, 0
	}
	first := len(st.Laps) == 0 && st.StartLap == p.Laps-1 && st.lapPit
	clean := !st.lapPit && !first && p.Last > 0
	fuelUsed := st.lapFuel - tel.Fuel
	veUsed := st.lapVE - tel.VE
	if fuelUsed < 0 {
		fuelUsed = 0
	}
	if veUsed < 0 {
		veUsed = 0
	}
	st.Laps = append(st.Laps, lapRec{Time: last, Clean: clean, FuelUsed: fuelUsed, VEUsed: veUsed})
	for i := range t.tyreLaps {
		t.tyreLaps[i]++
	}
	m := Msg{"type": "lap", "stint": st.ID, "driver": st.Driver, "session": st.Session, "lap": p.Laps,
		"time": r3(last), "s1": r3(s1), "s2": r3(s2), "s3": r3(s3), "pit": st.lapPit,
		"fuel": r1(tel.Fuel), "fuelUsed": r3(fuelUsed), "ve": pct(tel.VE), "veUsed": r3(veUsed * 100),
		"wear": wearPct(tel.Wear), "place": p.Place, "classPlace": p.ClassPlace,
		"trackTemp": r1(s.TrackTemp), "rain": pct(s.Raining)}
	t.mech(s, m)
	m["hdl"] = t.hdl.Lap()
	t.out.Send(m)
	if tl := t.trace.Take(); tl != nil {
		t.out.Send(Msg{"type": "trace", "stint": st.ID, "driver": st.Driver, "session": st.Session, "track": st.Track,
			"car": st.Car, "lap": p.Laps, "time": r3(last), "clean": clean, "len": tl.Length, "n": tl.N, "data": tl.Data})
	}
	t.hl.Lap(s, last, clean)
	st.lapFuel, st.lapVE, st.lapPit = tel.Fuel, tel.VE, p.InPits
	logf("  Runde %d: %s", p.Laps, fmtLap(p.Last))
}

func (t *Tracker) pitDone(s *Snap) {
	tel, ps, st := s.Tel, t.pit, t.stint
	t.pit = nil
	lane := t.clock().Sub(ps.start).Seconds()
	if lane < 5 {
		return
	}
	refuel := tel.Fuel - ps.fuel
	veAdd := tel.VE - ps.ve
	tyres := 0
	for i := 0; i < 4; i++ {
		if tel.Wear[i]-ps.wear[i] > 0.03 {
			tyres++
		}
	}
	repaired := tel.Dents < ps.dents
	changed := []string{}
	for i, n := range []string{"VL", "VR", "HL", "HR"} {
		if tel.Wear[i]-ps.wear[i] > 0.03 {
			t.tyreLaps[i] = 0
			changed = append(changed, n)
		}
	}
	if tyres >= 2 {
		t.setStints = 1
	} else if tyres == 0 {
		t.setStints++
	}
	st.Pits++
	if refuel > 0.5 || veAdd > 0.01 {
		st.refuelled = true
	}
	t.out.Send(Msg{"type": "pit", "stint": st.ID, "driver": st.Driver, "lap": s.Player.Laps,
		"lane": r1(lane), "stop": r1(ps.stopDur), "refuel": r1(math.Max(refuel, 0)), "veAdded": pct(math.Max(veAdd, 0)),
		"tyres": tyres, "tyresWhich": strings.Join(changed, " "), "repair": repaired, "dentsBefore": ps.dents, "dentsAfter": tel.Dents,
		"fuelBefore": r1(ps.fuel), "fuelAfter": r1(tel.Fuel), "veBefore": pct(ps.ve), "veAfter": pct(tel.VE),
		"wear": wearPct(tel.Wear)})
	logf("⛽ Boxenstopp: %.1fs Boxengasse, Reifen gewechselt: %d", lane, tyres)
}

func (t *Tracker) event(s *Snap, kind, text string) {
	lap := 0
	if s.Player != nil {
		lap = s.Player.Laps
	}
	id := ""
	if t.stint != nil {
		id = t.stint.ID
	}
	m := Msg{"type": "event", "stint": id, "driver": t.driver(s), "kind": kind, "text": text, "lap": lap, "et": r1(s.ET)}
	if s.Tel != nil {
		m["x"], m["z"] = r1(s.Tel.PosX), r1(s.Tel.PosZ)
	}
	t.out.Send(m)
	logf("! %s: %s", kind, text)
}

func (t *Tracker) live(s *Snap) {
	p, tel, st := s.Player, s.Tel, t.stint
	var fuelPer, vePer float64
	n := 0
	for _, l := range st.Laps {
		if l.Clean {
			fuelPer += l.FuelUsed
			vePer += l.VEUsed
			n++
		}
	}
	m := Msg{"driver": st.Driver, "stint": st.ID, "session": st.Session, "track": s.Track, "car": p.Vehicle,
		"class": p.Class, "lap": p.Laps, "place": p.Place, "classPlace": p.ClassPlace,
		"last": r3(p.Last), "best": r3(p.Best), "fuel": r1(tel.Fuel), "fuelCap": r1(tel.FuelCap),
		"ve": pct(tel.VE), "wear": wearPct(tel.Wear), "tyreTemp": []float64{r1(tel.TempC[0]), r1(tel.TempC[1]), r1(tel.TempC[2]), r1(tel.TempC[3])},
		"gapAhead": r1(tel.GapAhead), "gapBehind": r1(tel.GapBehind), "inPits": p.InPits,
		"remaining": math.Round(s.TimeRemaining), "trackTemp": r1(s.TrackTemp), "air": r1(s.AmbientTemp),
		"rain": pct(s.Raining), "wet": pct(s.Wet), "yellow": s.Yellow, "penalties": p.Penalties,
		"stintLaps": len(st.Laps), "stintStart": st.Start.UTC().Format(time.RFC3339), "sessionET": math.Round(s.ET)}
	if n > 0 {
		fuelPer /= float64(n)
		vePer /= float64(n)
		m["fuelPerLap"] = r3(fuelPer)
		m["vePerLap"] = r3(vePer * 100)
		left := math.Inf(1)
		if fuelPer > 0.05 {
			left = tel.Fuel / fuelPer
		}
		if vePer > 0.001 && tel.VE > 0 {
			left = math.Min(left, tel.VE/vePer)
		}
		if !math.IsInf(left, 1) {
			m["lapsLeft"] = r1(left)
		}
	}
	// nearest class rivals
	for _, c := range s.Cars {
		if c.Class == p.Class && c.ClassPlace == p.ClassPlace-1 {
			m["ahead"] = c.Driver + " · " + c.Vehicle
		}
		if c.Class == p.Class && c.ClassPlace == p.ClassPlace+1 {
			m["behind"] = c.Driver + " · " + c.Vehicle
		}
	}
	if f := fieldTable(s); len(f) > 0 {
		enrichField(f, lmuOpponents())
		m["field"] = f
	}
	if su := lmuSetup(); su != nil {
		m["lmuSetup"] = su
	}
	t.mech(s, m)
	t.out.Live(m)
}

// mech ergänzt die Werte für das Mechaniker-Board (Reifen, Bremsen, Motor, Schaden, Umgebung).
func (t *Tracker) mech(s *Snap, m Msg) {
	tel := s.Tel
	imo := make([][]float64, 4)
	var brake, press, carcass []float64
	for w := 0; w < 4; w++ {
		imo[w] = []float64{r1(tel.TyreIMO[w][0]), r1(tel.TyreIMO[w][1]), r1(tel.TyreIMO[w][2])}
		brake = append(brake, math.Round(tel.BrakeC[w]))
		press = append(press, r1(tel.PressKPa[w]))
		carcass = append(carcass, r1(tel.CarcassC[w]))
	}
	m["tyreIMO"], m["brake"], m["press"], m["carcass"] = imo, brake, press, carcass
	m["water"], m["oil"], m["overheat"] = r1(tel.WaterC), r1(tel.OilC), tel.Overheating
	m["battery"] = pct(tel.Battery)
	m["fuelCap"] = r1(tel.FuelCap)
	m["dents"], m["detached"], m["flat"] = tel.Dents, tel.Detached, tel.Flat
	m["compound"] = strings.Trim(tel.CompoundF+" / "+tel.CompoundR, " /")
	m["tyreLaps"] = []int{t.tyreLaps[0], t.tyreLaps[1], t.tyreLaps[2], t.tyreLaps[3]}
	m["setStints"] = t.setStints
	m["air"], m["trackTemp"], m["rain"], m["wet"] = r1(s.AmbientTemp), r1(s.TrackTemp), pct(s.Raining), pct(s.Wet)
	if g := garageInfo(); len(g) > 0 {
		m["garage"] = g
	}
}

func fmtLap(s float64) string {
	if s <= 0 {
		return "–"
	}
	m := int(s) / 60
	return fmt.Sprintf("%d:%06.3f", m, s-float64(m*60))
}

// SetDriver changes the driver-name override (empty = LMU player name).
func (t *Tracker) SetDriver(d string) { t.override = d }

// setupTick schickt alle 10 s die in LMU eingestellten Werte (Garage-Setup, Box-Menü) – auch vor dem Losfahren.
func (t *Tracker) setupTick(s *Snap, now time.Time) {
	if t.out == nil || now.Sub(t.lastSetup) < 10*time.Second {
		return
	}
	t.lastSetup = now
	su := lmuSetup()
	if su == nil {
		return
	}
	if !t.inCar { // Box-Menü gehört dem Fahrer im Auto – Zuschauer schicken nur ihr Garagen-Setup
		cp := Msg{}
		for k, v := range su {
			if k != "pit" {
				cp[k] = v
			}
		}
		if len(cp) == 0 {
			return
		}
		su = cp
	}
	b, _ := json.Marshal(su)
	if string(b) == t.setupJSON {
		return
	}
	t.setupJSON = string(b)
	m := Msg{"driver": t.driver(s), "track": s.Track, "session": sessionName(s.Session), "setup": su}
	if s.Player != nil {
		m["car"] = s.Player.Vehicle
	}
	if s.Tel != nil {
		m["fuel"], m["fuelCap"], m["ve"] = r1(s.Tel.Fuel), r1(s.Tel.FuelCap), pct(s.Tel.VE)
	}
	t.out.Status("setup", m)
}
