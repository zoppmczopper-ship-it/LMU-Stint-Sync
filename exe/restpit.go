package main

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Werte aus der internen LMU-Schnittstelle (nur lesend):
//  - Garage-Setup: „Virtuelle Energie“ (VM_VIRTUAL_ENERGY) und „Kraftstoffkapazität“ (VM_FUEL_LEVEL = Liter je 1 % VE)
//  - Box-Menü für den nächsten Stopp (VE, Fuel Ratio, Reifen, Drücke, Flügel, Bremsen …)
//  - Gegner: aktueller Tankfüllstand (watch/standings) und Start-VE des laufenden Stints (strategy/overall)

var (
	restBase   = "http://127.0.0.1:6397"
	restMu     sync.Mutex
	setupAt    time.Time
	setupCache Msg
	oppAt      time.Time
	oppCache   map[string]oppInfo
	reNum      = regexp.MustCompile(`-?\d+(?:[.,]\d+)?`)
)

type oppInfo struct {
	Fuel    float64 // Tankfüllstand 0..100 %
	VE      float64 // Start-VE des laufenden Stints 0..100 %
	Lap     int     // Runde, in der der Stint begann
	HasVE   bool
	HasFuel bool
}

func restGet(path string, v any) bool {
	resp, err := restClient.Get(restBase + path)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return false
	}
	return json.NewDecoder(resp.Body).Decode(v) == nil
}

func firstNum(s string) (float64, bool) {
	m := reNum.FindString(s)
	if m == "" {
		return 0, false
	}
	f, err := strconv.ParseFloat(strings.Replace(m, ",", ".", 1), 64)
	return f, err == nil
}

// lmuSetup liefert Garage-Setup und Box-Menü (alle 5 s neu gelesen), nil wenn LMU nichts liefert.
// Die Abfragen laufen im Hintergrund, damit der Tracker nie auf LMU warten muss.
var restOnce sync.Once

func restPoller() {
	restOnce.Do(func() {
		go func() {
			for {
				readSetup()
				readOpponents()
				time.Sleep(5 * time.Second)
			}
		}()
	})
}

func lmuSetup() Msg {
	restPoller()
	restMu.Lock()
	defer restMu.Unlock()
	if time.Since(setupAt) > 30*time.Second {
		return nil
	}
	return setupCache
}

func lmuOpponents() map[string]oppInfo {
	restPoller()
	restMu.Lock()
	defer restMu.Unlock()
	if time.Since(oppAt) > 30*time.Second {
		return nil
	}
	return oppCache
}

func readSetup() {
	out := Msg{}

	// Garage-Setup
	type gv struct {
		StringValue string `json:"stringValue"`
		LastSaved   string `json:"lastSavedStringValue"`
	}
	var rawGarage map[string]json.RawMessage
	if restGet("/rest/garage/getPlayerGarageData", &rawGarage) {
		garage := map[string]gv{}
		for _, k := range []string{"VM_VIRTUAL_ENERGY", "VM_FUEL_LEVEL", "VM_FUEL_CAPACITY"} {
			var v gv
			if b, ok := rawGarage[k]; ok && json.Unmarshal(b, &v) == nil {
				garage[k] = v
			}
		}
		g := Msg{}
		if v, ok := garage["VM_VIRTUAL_ENERGY"]; ok {
			if p, ok := firstNum(v.StringValue); ok {
				g["ve"] = p
			}
			if m := regexp.MustCompile(`\(([\d.,]+) Runde`).FindStringSubmatch(v.LastSaved); m != nil {
				if f, ok := firstNum(m[1]); ok {
					g["veLaps"] = f
				}
			}
		}
		if v, ok := garage["VM_FUEL_LEVEL"]; ok {
			if r, ok := firstNum(v.StringValue); ok {
				g["ratio"] = r
			}
		}
		if v, ok := garage["VM_FUEL_CAPACITY"]; ok {
			if l, ok := firstNum(v.StringValue); ok {
				g["litres"] = l
			}
		}
		if len(g) > 0 {
			out["garage"] = g
		}
	}

	// Box-Menü (gilt für den nächsten Stopp)
	var menu []struct {
		Name     string `json:"name"`
		Current  int    `json:"currentSetting"`
		Settings []struct {
			Text string `json:"text"`
		} `json:"settings"`
	}
	if restGet("/rest/garage/PitMenu/receivePitMenu", &menu) {
		pm := Msg{}
		press := []string{}
		for _, it := range menu {
			txt := ""
			if it.Current >= 0 && it.Current < len(it.Settings) {
				txt = strings.TrimSpace(it.Settings[it.Current].Text)
			}
			switch strings.TrimSuffix(strings.TrimSpace(it.Name), ":") {
			case "VIRTUAL ENERGY":
				if p, ok := firstNum(txt); ok {
					pm["ve"] = p
				}
				if m := regexp.MustCompile(`(\d+)\s*Runde`).FindStringSubmatch(txt); m != nil {
					if f, ok := firstNum(m[1]); ok {
						pm["veLaps"] = f
					}
				}
			case "FUEL RATIO":
				if r, ok := firstNum(txt); ok {
					pm["ratio"] = r
				}
			case "FUEL":
				if l, ok := firstNum(txt); ok {
					pm["fuel"] = l
				}
			case "TIRES":
				pm["tyres"] = txt
			case "FL PRESS", "FR PRESS", "RL PRESS", "RR PRESS":
				press = append(press, strings.Fields(txt + " ")[0])
			case "R WING":
				pm["wing"] = txt
			case "REPLACE BRAKES":
				pm["brakes"] = txt
			case "DRIVER":
				pm["driver"] = txt
			case "DAMAGE":
				pm["damage"] = txt
			}
		}
		if len(press) == 4 {
			pm["press"] = strings.Join(press, " / ")
		}
		if len(pm) > 0 {
			out["pit"] = pm
		}
	}
	if len(out) == 0 {
		return
	}
	restMu.Lock()
	setupCache, setupAt = out, time.Now()
	restMu.Unlock()
}

// lmuOpponents: Fahrername → Tankfüllstand / Start-VE des laufenden Stints (alle 10 s neu gelesen).
func readOpponents() {
	res := map[string]oppInfo{}
	var st []struct {
		Driver string  `json:"driverName"`
		Fuel   float64 `json:"fuelFraction"`
	}
	if restGet("/rest/watch/standings", &st) {
		for _, c := range st {
			o := res[c.Driver]
			o.Fuel, o.HasFuel = r1(c.Fuel*100), true
			res[c.Driver] = o
		}
	}
	var strat [][]json.RawMessage
	if restGet("/rest/strategy/overall", &strat) {
		for _, team := range strat {
			if len(team) < 2 {
				continue
			}
			var stints []struct {
				Driver string  `json:"driver"`
				Lap    int     `json:"lap"`
				VE     float64 `json:"ve"`
			}
			if json.Unmarshal(team[1], &stints) != nil || len(stints) == 0 {
				continue
			}
			last := stints[len(stints)-1]
			o := res[last.Driver]
			o.VE, o.Lap, o.HasVE = r1(last.VE*100), last.Lap, true
			res[last.Driver] = o
		}
	}
	if len(res) == 0 {
		return
	}
	restMu.Lock()
	oppCache, oppAt = res, time.Now()
	restMu.Unlock()
}

// enrichField ergänzt das Klassement um Tankfüllstand und Start-VE der Gegner.
func enrichField(rows []Msg, opp map[string]oppInfo) {
	if len(opp) == 0 {
		return
	}
	for _, r := range rows {
		n, _ := r["n"].(string)
		o, ok := opp[n]
		if !ok {
			continue
		}
		if o.HasFuel {
			r["ff"] = o.Fuel
		}
		if o.HasVE {
			r["sv"], r["sl"] = o.VE, o.Lap
		}
	}
}
