package main

import (
	"encoding/json"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// LMU stellt intern eine REST-Schnittstelle auf Port 6397 bereit (wird von der LMU-Oberfläche genutzt).
// Wir lesen daraus – nur lesend und ohne Gewähr – Schadens-/Verschleiß-/Reparaturwerte, die das
// Shared Memory nicht liefert (z. B. Bremsen-, Aero-, Aufhängungsverschleiß, Reparaturzeit).
var (
	garageMu   sync.Mutex
	garageAt   time.Time
	garageData map[string]float64
	garageKey  = regexp.MustCompile(`(?i)damage|wear|repair|aero|brake|susp|body|engine|gearbox|time`)
	restClient = &http.Client{Timeout: 1500 * time.Millisecond}
)

func garageInfo() map[string]float64 {
	garageMu.Lock()
	defer garageMu.Unlock()
	if time.Since(garageAt) < 20*time.Second {
		return garageData
	}
	garageAt = time.Now()
	garageData = nil
	resp, err := restClient.Get("http://127.0.0.1:6397/rest/garage/UIScreen/RepairAndRefuel")
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil
	}
	var v any
	if json.NewDecoder(resp.Body).Decode(&v) != nil {
		return nil
	}
	out := map[string]float64{}
	flatten("", v, out)
	keys := make([]string, 0, len(out))
	for k := range out {
		if garageKey.MatchString(k) {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	res := map[string]float64{}
	for i, k := range keys {
		if i >= 24 {
			break
		}
		res[k] = r3(out[k])
	}
	if len(res) > 0 {
		garageData = res
	}
	return garageData
}

func flatten(prefix string, v any, out map[string]float64) {
	if len(out) > 400 {
		return
	}
	switch x := v.(type) {
	case map[string]any:
		for k, vv := range x {
			flatten(join(prefix, k), vv, out)
		}
	case []any:
		for i, vv := range x {
			if i > 8 {
				break
			}
			flatten(join(prefix, itoa(i)), vv, out)
		}
	case float64:
		out[prefix] = x
	case bool:
		if x {
			out[prefix] = 1
		} else {
			out[prefix] = 0
		}
	}
}

func join(a, b string) string {
	if a == "" {
		return b
	}
	return a + "." + strings.TrimSpace(b)
}

func itoa(i int) string { return string(rune('0' + i)) }
