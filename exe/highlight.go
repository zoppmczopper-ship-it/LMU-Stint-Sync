package main

import (
	"fmt"
	"math"
	"time"
)

// Highlights erkennt interessante Szenen für Videos: Überholmanöver, längere Zweikämpfe, Dreher.
// (Kontakte/Schäden und Strafen meldet der Tracker bereits als Ereignis.)
type Highlights struct {
	lastCheck time.Time
	prevPos   int         // eigener Klassenplatz
	prevOrder map[int]int // Fahrzeug-ID → Klassenplatz
	pending   *posChange
	battles   map[int]*battle
	lastSpin  time.Time
	bestLap   float64
	emit      func(kind, text string, at time.Time, et float64, x, z float64)
	clock     func() time.Time
}

type posChange struct {
	from, to int
	other    Car
	since    time.Time
	at       time.Time
	et, x, z float64
}

type battle struct {
	car       Car
	start     time.Time
	startET   float64
	startLap  int
	x, z      float64
	lastClose time.Time
}

const (
	battleGap  = 1.0              // s – so nah gilt als Zweikampf
	battleMin  = 90 * time.Second // ab so lange wird er gemeldet
	battleLoss = 25 * time.Second // so lange > 2 s weg → Zweikampf vorbei
)

func (h *Highlights) Reset() {
	h.prevPos, h.prevOrder, h.pending, h.battles = 0, nil, nil, map[int]*battle{}
}

func (h *Highlights) Sample(s *Snap, race bool) {
	if h.emit == nil || s == nil || s.Player == nil || s.Tel == nil {
		return
	}
	now := h.clock()
	p, tel := s.Player, s.Tel

	// Dreher: hohe Gierrate bei Tempo (jede Session)
	speed := math.Hypot(tel.VelX, tel.VelZ)
	if math.Abs(tel.YawRate) > 2.2 && speed > 15 && now.Sub(h.lastSpin) > 15*time.Second && !p.InPits {
		h.lastSpin = now
		h.emit("Dreher", fmt.Sprintf("Dreher/Abflug bei %.0f km/h", speed*3.6), now, s.ET, tel.PosX, tel.PosZ)
	}

	if now.Sub(h.lastCheck) < 500*time.Millisecond {
		return
	}
	h.lastCheck = now
	if !race {
		h.prevPos, h.prevOrder = 0, nil
		return
	}
	if h.battles == nil {
		h.battles = map[int]*battle{}
	}
	order := map[int]int{}
	byPos := map[int]Car{}
	for _, c := range s.Cars {
		if c.Class == p.Class {
			order[c.ID] = c.ClassPlace
			byPos[c.ClassPlace] = c
		}
	}

	// Überholmanöver: Klassenplatz ändert sich und bleibt 3 s so
	if h.prevPos > 0 && p.ClassPlace != h.prevPos && !p.InPits {
		var other Car
		var found bool
		if p.ClassPlace < h.prevPos { // ich habe überholt: Auto jetzt direkt hinter mir war vorher vor mir
			if c, ok := byPos[p.ClassPlace+1]; ok && h.prevOrder[c.ID] > 0 && h.prevOrder[c.ID] < h.prevPos && !c.InPits {
				other, found = c, true
			}
		} else { // ich wurde überholt
			if c, ok := byPos[p.ClassPlace-1]; ok && h.prevOrder[c.ID] > h.prevPos && !c.InPits {
				other, found = c, true
			}
		}
		if found {
			h.pending = &posChange{from: h.prevPos, to: p.ClassPlace, other: other, since: now, at: now, et: s.ET, x: tel.PosX, z: tel.PosZ}
		}
	}
	if pc := h.pending; pc != nil && now.Sub(pc.since) >= 3*time.Second {
		h.pending = nil
		if p.ClassPlace == pc.to {
			if pc.to < pc.from {
				h.emit("Überholt", fmt.Sprintf("%s überholt (%s) – Klasse P%d → P%d", pc.other.Driver, pc.other.Vehicle, pc.from, pc.to), pc.at, pc.et, pc.x, pc.z)
			} else {
				h.emit("Überholt worden", fmt.Sprintf("von %s (%s) – Klasse P%d → P%d", pc.other.Driver, pc.other.Vehicle, pc.from, pc.to), pc.at, pc.et, pc.x, pc.z)
			}
		}
	}
	h.prevPos, h.prevOrder = p.ClassPlace, order

	// Zweikämpfe mit dem Auto direkt vor/hinter mir in der Klasse
	for _, nb := range []int{p.ClassPlace - 1, p.ClassPlace + 1} {
		c, ok := byPos[nb]
		if !ok || c.InPits || p.InPits || c.LapsBehindLeader != p.LapsBehindLeader {
			continue
		}
		if math.Abs(c.GapLeader-p.GapLeader) <= battleGap {
			b := h.battles[c.ID]
			if b == nil {
				b = &battle{car: c, start: now, startET: s.ET, startLap: p.Laps, x: tel.PosX, z: tel.PosZ}
				h.battles[c.ID] = b
			}
			b.lastClose = now
		}
	}
	for id, b := range h.battles {
		if now.Sub(b.lastClose) > battleLoss {
			dur := b.lastClose.Sub(b.start)
			if dur >= battleMin {
				h.emit("Zweikampf", fmt.Sprintf("mit %s (%s) – %d:%02d min, ab Runde %d", b.car.Driver, b.car.Vehicle,
					int(dur.Minutes()), int(dur.Seconds())%60, b.startLap+1), b.start, b.startET, b.x, b.z)
			}
			delete(h.battles, id)
		}
	}
}

// Lap meldet eine neue persönliche Bestzeit (nur saubere Runden).
func (h *Highlights) Lap(s *Snap, lapTime float64, clean bool) {
	if h.emit == nil || !clean || lapTime <= 0 || s.Tel == nil {
		return
	}
	if h.bestLap == 0 || lapTime < h.bestLap-0.001 {
		first := h.bestLap == 0
		h.bestLap = lapTime
		if !first {
			h.emit("Bestzeit", "Persönliche Bestzeit "+fmtLap(lapTime), h.clock(), s.ET, s.Tel.PosX, s.Tel.PosZ)
		}
	}
}
