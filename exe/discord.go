package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Discord posts important events to a channel webhook and keeps one
// "live" message up to date by editing it.
type Discord struct {
	url     string
	client  *http.Client
	mu      sync.Mutex
	queue   []map[string]any
	live    map[string]any
	liveID  string
	LastErr string
}

func NewDiscord(url string) *Discord {
	d := &Discord{url: strings.TrimSpace(url), client: &http.Client{Timeout: 20 * time.Second}}
	go d.loop()
	return d
}

func (d *Discord) Event(m Msg) {
	text := discordText(m)
	if text == "" {
		return
	}
	d.mu.Lock()
	d.queue = append(d.queue, map[string]any{"content": text})
	if len(d.queue) > 200 {
		d.queue = d.queue[len(d.queue)-200:]
	}
	d.mu.Unlock()
}

func (d *Discord) Live(m Msg) {
	d.mu.Lock()
	d.live = map[string]any{"content": "", "embeds": []any{liveEmbed(m)}}
	d.mu.Unlock()
}

func (d *Discord) loop() {
	lastLive := time.Time{}
	for {
		d.mu.Lock()
		var next map[string]any
		if len(d.queue) > 0 {
			next = d.queue[0]
		}
		live := d.live
		d.mu.Unlock()

		if next != nil {
			if wait, err := d.do("POST", d.url, next); err != nil {
				d.LastErr = err.Error()
				time.Sleep(wait)
				continue
			}
			d.mu.Lock()
			d.queue = d.queue[1:]
			d.mu.Unlock()
			d.LastErr = ""
			// a new event pushes the live message up – repost it below
			d.liveID = ""
			time.Sleep(time.Second)
			continue
		}
		if live != nil && time.Since(lastLive) >= 15*time.Second {
			var err error
			var wait time.Duration
			if d.liveID == "" {
				d.liveID, wait, err = d.post(live)
			} else {
				wait, err = d.do("PATCH", d.url+"/messages/"+d.liveID, live)
				if err != nil && strings.Contains(err.Error(), "404") {
					d.liveID = ""
				}
			}
			if err != nil {
				d.LastErr = err.Error()
				time.Sleep(wait)
				continue
			}
			lastLive = time.Now()
		}
		time.Sleep(time.Second)
	}
}

func (d *Discord) post(body map[string]any) (string, time.Duration, error) {
	data, _ := json.Marshal(body)
	sep := "?"
	if strings.Contains(d.url, "?") {
		sep = "&"
	}
	resp, err := d.client.Post(d.url+sep+"wait=true", "application/json", bytes.NewReader(data))
	if err != nil {
		return "", 5 * time.Second, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
	if resp.StatusCode == 429 {
		return "", retryAfter(raw), fmt.Errorf("Discord: zu viele Anfragen")
	}
	if resp.StatusCode >= 300 {
		return "", 10 * time.Second, fmt.Errorf("Discord HTTP %d", resp.StatusCode)
	}
	var r struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &r)
	return r.ID, 0, nil
}

func (d *Discord) do(method, url string, body map[string]any) (time.Duration, error) {
	data, _ := json.Marshal(body)
	req, _ := http.NewRequest(method, url, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	resp, err := d.client.Do(req)
	if err != nil {
		return 5 * time.Second, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
	if resp.StatusCode == 429 {
		return retryAfter(raw), fmt.Errorf("Discord: zu viele Anfragen")
	}
	if resp.StatusCode >= 300 {
		return 10 * time.Second, fmt.Errorf("Discord HTTP %d", resp.StatusCode)
	}
	return 0, nil
}

func retryAfter(raw []byte) time.Duration {
	var r struct {
		RetryAfter float64 `json:"retry_after"`
	}
	if json.Unmarshal(raw, &r) == nil && r.RetryAfter > 0 {
		return time.Duration(r.RetryAfter*1000)*time.Millisecond + 200*time.Millisecond
	}
	return 5 * time.Second
}

func num(m Msg, k string) float64 {
	switch v := m[k].(type) {
	case float64:
		return v
	case float32:
		return float64(v)
	case int:
		return float64(v)
	}
	return 0
}

func str(m Msg, k string) string { s, _ := m[k].(string); return s }

func discordText(m Msg) string {
	switch m["type"] {
	case "stint_start":
		return fmt.Sprintf("▶️ **%s** übernimmt – %s, %s · P%.0f (Klasse P%.0f) · %.1f l · VE %.0f %%",
			str(m, "driver"), str(m, "session"), str(m, "track"), num(m, "place"), num(m, "classPlace"), num(m, "fuel"), num(m, "ve"))
	case "stint_end":
		s := fmt.Sprintf("⏹️ **%s** Stint beendet: %.0f Runden", str(m, "driver"), num(m, "laps"))
		if b := num(m, "best"); b > 0 {
			s += " · Beste " + fmtLap(b)
		}
		if a := num(m, "avg"); a > 0 {
			s += " · Ø " + fmtLap(a)
		}
		s += fmt.Sprintf(" · %.0f Stopp(s)", num(m, "pits"))
		if i := num(m, "incidents"); i > 0 {
			s += fmt.Sprintf(" · %.0f Zwischenfall/-fälle", i)
		}
		if w, ok := m["wear"].([]float64); ok && len(w) == 4 {
			s += fmt.Sprintf(" · Reifen %.0f/%.0f/%.0f/%.0f %%", w[0], w[1], w[2], w[3])
		}
		return s
	case "pit":
		s := fmt.Sprintf("🔧 Boxenstopp **%s** (Rd. %.0f): %.1f s Gasse, %.1f s Stand", str(m, "driver"), num(m, "lap"), num(m, "lane"), num(m, "stop"))
		if r := num(m, "refuel"); r > 0 {
			s += fmt.Sprintf(", +%.1f l", r)
		}
		if t := num(m, "tyres"); t > 0 {
			s += fmt.Sprintf(", %.0f Reifen neu", t)
		}
		if rep, _ := m["repair"].(bool); rep {
			s += ", repariert"
		}
		return s
	case "event":
		return fmt.Sprintf("⚠️ **%s** – %s (Rd. %.0f): %s", str(m, "kind"), str(m, "driver"), num(m, "lap"), str(m, "text"))
	}
	return ""
}

func liveEmbed(m Msg) map[string]any {
	field := func(n, v string) map[string]any { return map[string]any{"name": n, "value": v, "inline": true} }
	energy := fmt.Sprintf("%.1f l", num(m, "fuel"))
	if ve := num(m, "ve"); ve > 0 {
		energy = fmt.Sprintf("VE %.1f %% · %s", ve, energy)
	}
	if l := num(m, "lapsLeft"); l > 0 {
		energy += fmt.Sprintf("\nreicht ~%.1f Rd.", l)
	}
	tyres := "–"
	if w, ok := m["wear"].([]float64); ok && len(w) == 4 {
		tyres = fmt.Sprintf("VL %.0f · VR %.0f\nHL %.0f · HR %.0f", w[0], w[1], w[2], w[3])
	}
	gaps := fmt.Sprintf("vor %.1f s · hinter %.1f s", num(m, "gapAhead"), num(m, "gapBehind"))
	rem := ""
	if r := num(m, "remaining"); r > 0 {
		rem = fmt.Sprintf(" · Rest %d:%02d h", int(r)/3600, int(r)%3600/60)
	}
	return map[string]any{
		"title":       fmt.Sprintf("🏁 Live: %s – P%.0f (Klasse P%.0f)", str(m, "driver"), num(m, "place"), num(m, "classPlace")),
		"description": fmt.Sprintf("%s · %s%s", str(m, "session"), str(m, "track"), rem),
		"color":       0xff5a1f,
		"fields": []any{
			field("Letzte / Beste", fmtLap(num(m, "last"))+" / "+fmtLap(num(m, "best"))),
			field("Energie", energy),
			field("Reifen %", tyres),
			field("Abstände", gaps),
			field("Stint", fmt.Sprintf("%.0f Runden", num(m, "stintLaps"))),
		},
		"footer":    map[string]any{"text": "aktualisiert alle 15 s"},
		"timestamp": str(m, "ts"),
	}
}
