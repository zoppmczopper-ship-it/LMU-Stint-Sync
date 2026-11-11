package main

import "sort"

// fieldTable liefert das Klassement aller Autos (nach Klasse, dann Klassenplatz)
// mit Abständen zum Klassenführenden, zum Vordermann in der Klasse und zum eigenen Auto.
// Abstände in Sekunden; *l-Felder = Runden Rückstand (dann gilt die Rundenanzeige).
func fieldTable(s *Snap) []Msg {
	if s == nil || len(s.Cars) == 0 {
		return nil
	}
	cars := append([]Car{}, s.Cars...)
	// Klassen in der Reihenfolge ihres besten Gesamtplatzes (schnellste Klasse zuerst)
	top := map[string]int{}
	for _, c := range cars {
		if v, ok := top[c.Class]; !ok || (c.Place > 0 && c.Place < v) {
			top[c.Class] = c.Place
		}
	}
	sort.SliceStable(cars, func(a, b int) bool {
		if cars[a].Class != cars[b].Class {
			if top[cars[a].Class] != top[cars[b].Class] {
				return top[cars[a].Class] < top[cars[b].Class]
			}
			return cars[a].Class < cars[b].Class
		}
		return cars[a].ClassPlace < cars[b].ClassPlace
	})
	p := s.Player
	var leader, prev *Car
	out := make([]Msg, 0, len(cars))
	for i := range cars {
		c := &cars[i]
		if leader == nil || c.Class != leader.Class {
			leader, prev = c, nil
		}
		row := Msg{"c": c.Class, "p": c.ClassPlace, "o": c.Place, "n": c.Driver, "v": c.Vehicle, "l": c.Laps,
			"best": r3(c.Best), "last": r3(c.Last), "pits": c.Pitstops, "box": c.InPits, "pen": c.Penalties}
		if c.Finish == 1 {
			row["fin"] = true
		}
		if c.IsPlayer {
			row["me"] = true
		}
		if c != leader {
			row["gl"], row["gll"] = r1(c.GapLeader-leader.GapLeader), c.LapsBehindLeader-leader.LapsBehindLeader
		}
		if prev != nil {
			row["gi"], row["gil"] = r1(c.GapLeader-prev.GapLeader), c.LapsBehindLeader-prev.LapsBehindLeader
		}
		if p != nil && !c.IsPlayer && c.Class == p.Class {
			row["gp"], row["gpl"] = r1(c.GapLeader-p.GapLeader), c.LapsBehindLeader-p.LapsBehindLeader
		}
		prev = c
		out = append(out, row)
		if len(out) >= 80 {
			break
		}
	}
	return out
}

// simField baut ein Test-Klassement für -simulate / „Testdaten senden“.
func simField(lap int) []Msg {
	type sc struct {
		cls, drv, car string
		place, lb     int
		gap, best     float64
		pits          int
		box, me       bool
	}
	list := []sc{
		{"Hypercar", "Gegner X", "Ferrari 499P #50", 1, 0, 0, 205.1, 1, false, false},
		{"Hypercar", "Gegner A", "Toyota GR010 #7", 2, 0, 11.4, 205.9, 1, false, false},
		{"Hypercar", "Testfahrer", "Testauto #99", 4, 0, 15.6, 206.3, 1, false, true},
		{"Hypercar", "Gegner B", "Porsche 963 #12", 5, 0, 17.4, 206.8, 2, true, false},
		{"Hypercar", "Gegner C", "Cadillac V-Series.R #2", 7, 1, 3.2, 207.5, 1, false, false},
		{"LMP2", "Gegner L", "Oreca 07 #22", 3, 1, 1.0, 212.2, 1, false, false},
		{"LMP2", "Gegner M", "Oreca 07 #28", 6, 1, 9.8, 212.9, 1, false, false},
		{"GT3", "Gegner G", "Porsche 911 GT3 R #92", 8, 3, 4.0, 226.4, 1, false, false},
	}
	s := &Snap{}
	for i, x := range list {
		s.Cars = append(s.Cars, Car{ID: i, Class: x.cls, Driver: x.drv, Vehicle: x.car, Place: x.place, Laps: lap - x.lb,
			LapsBehindLeader: x.lb, GapLeader: x.gap, Best: x.best, Last: x.best + 1.3, Pitstops: x.pits, InPits: x.box, IsPlayer: x.me})
	}
	byClass := map[string]int{}
	for i := range s.Cars {
		byClass[s.Cars[i].Class]++
		s.Cars[i].ClassPlace = byClass[s.Cars[i].Class]
		if s.Cars[i].IsPlayer {
			s.Player = &s.Cars[i]
		}
	}
	return fieldTable(s)
}
