package main

import "math"

// Handling sammelt pro Runde Kennzahlen zum Fahrverhalten (für Setup-Tipps im Mechaniker-Board).
// Untersteuern/Übersteuern wird über den Schräglaufwinkel vorne gegen hinten bestimmt:
// vorne deutlich größer → Untersteuern, hinten deutlich größer (oder Gegenlenken) → Übersteuern.
type Handling struct {
	phase                [3]phaseCnt // 0 Einlenken/Bremsen, 1 Kurvenmitte, 2 Ausgang/Gas
	brakeN, lockF, lockR int
	absN                 int
	exitN, spin, tcN     int
	fastN, bottom        int
	set                  CarSet
	hasSet               bool
}

type phaseCnt struct{ n, us, os int }

func slipDeg(lat, gnd float64) float64 {
	g := math.Abs(gnd)
	if g < 5 {
		return 0
	}
	return math.Atan2(math.Abs(lat), g) * 180 / math.Pi
}

// Sample wertet einen Snapshot aus (≈20× pro Sekunde während der Fahrt).
func (h *Handling) Sample(s *Snap) {
	t := s.Tel
	if t == nil || s.Player == nil || s.Player.InPits {
		return
	}
	h.set, h.hasSet = t.Set, true
	v := math.Hypot(t.VelX, t.VelZ)
	if v < 15 { // unter ~55 km/h nicht auswerten
		return
	}
	if v > 45 {
		h.fastN++
		for w := 0; w < 4; w++ {
			if t.RideH[w] > 0 && t.RideH[w] < 0.004 {
				h.bottom++
				break
			}
		}
	}
	// Bremsen: Blockieren vorne/hinten, ABS-Eingriffe
	if t.Brake > 0.3 {
		h.brakeN++
		lock := func(w int) bool { g := math.Abs(t.GndVel[w]); return g > 5 && math.Abs(t.LongPatch[w])/g > 0.2 }
		if lock(0) || lock(1) {
			h.lockF++
		}
		if lock(2) || lock(3) {
			h.lockR++
		}
		if t.ABSActive {
			h.absN++
		}
	}
	// Ausgang: Durchdrehen hinten, TC-Eingriffe
	if t.Throttle > 0.6 && math.Abs(t.Steer) > 0.05 {
		h.exitN++
		spin := func(w int) bool { g := math.Abs(t.GndVel[w]); return g > 5 && math.Abs(t.LongPatch[w])/g > 0.12 }
		if spin(2) || spin(3) {
			h.spin++
		}
		if t.TCActive {
			h.tcN++
		}
	}
	// Kurvenfahrt: Balance über Schräglaufwinkel
	if math.Abs(t.AccX) < 4 {
		return
	}
	af := (slipDeg(t.LatPatch[0], t.GndVel[0]) + slipDeg(t.LatPatch[1], t.GndVel[1])) / 2
	ar := (slipDeg(t.LatPatch[2], t.GndVel[2]) + slipDeg(t.LatPatch[3], t.GndVel[3])) / 2
	if af < 0.5 && ar < 0.5 {
		return
	}
	ph := 1
	switch {
	case t.Brake > 0.1:
		ph = 0
	case t.Throttle > 0.5:
		ph = 2
	}
	p := &h.phase[ph]
	p.n++
	counter := t.Steer*t.YawRate < 0 && math.Abs(t.YawRate) > 0.15 && math.Abs(t.Steer) > 0.03
	switch {
	case counter || ar > af*1.35+0.3:
		p.os++
	case af > ar*1.35+0.3:
		p.us++
	}
}

func pctOf(a, n int) float64 {
	if n == 0 {
		return 0
	}
	return math.Round(float64(a)*1000/float64(n)) / 10
}

// Lap liefert die Kennzahlen der abgelaufenen Runde und setzt den Zähler zurück.
func (h *Handling) Lap() Msg {
	ph := []string{"entry", "mid", "exit"}
	m := Msg{}
	for i, name := range ph {
		p := h.phase[i]
		m[name] = Msg{"n": p.n, "us": pctOf(p.us, p.n), "os": pctOf(p.os, p.n)}
	}
	m["lockF"], m["lockR"], m["abs"] = pctOf(h.lockF, h.brakeN), pctOf(h.lockR, h.brakeN), pctOf(h.absN, h.brakeN)
	m["brakeN"], m["exitN"] = h.brakeN, h.exitN
	m["spin"], m["tc"] = pctOf(h.spin, h.exitN), pctOf(h.tcN, h.exitN)
	m["bottom"] = pctOf(h.bottom, h.fastN)
	if h.hasSet {
		c := h.set
		m["set"] = Msg{"tc": c.TC, "tcMax": c.TCMax, "tcSlip": c.TCSlip, "tcSlipMax": c.TCSlipMax, "tcCut": c.TCCut, "tcCutMax": c.TCCutMax,
			"abs": c.ABS, "absMax": c.ABSMax, "map": c.Map, "mapMax": c.MapMax, "mig": c.Mig, "migMax": c.MigMax,
			"arbF": c.ArbF, "arbFMax": c.ArbFMax, "arbR": c.ArbR, "arbRMax": c.ArbRMax, "bias": r1(c.BiasFront)}
	}
	set, has := h.set, h.hasSet
	*h = Handling{set: set, hasSet: has}
	return m
}
