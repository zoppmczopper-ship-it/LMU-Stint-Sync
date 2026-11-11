package main

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"math"
)

// Rundenspur für die Streckenkarte: etwa alle 10 m Position, Zeit, Tempo, Gas und Bremse.
// Die Strecke wird aus der gefahrenen Linie gezeichnet – kein Layout von außen nötig.

const traceStep = 10.0 // Meter zwischen zwei Messpunkten

type tracePt struct{ d, t, x, z, v, thr, brk float64 }

type Trace struct {
	lap        int // mLapNumber der laufenden Runde
	pts        []tracePt
	dist       float64
	lastX      float64
	lastZ      float64
	lastSample float64
	started    bool
	ok         bool // Runde vollständig an der Linie begonnen, kein Sprung
	Done       *TraceLap
}

// TraceLap ist eine fertige Runde.
type TraceLap struct {
	Lap    int
	Length float64
	Data   string // gzip + base64 (JSON mit Delta-Werten)
	N      int
}

// Sample wird 20× pro Sekunde aufgerufen (nur im Auto).
func (tr *Trace) Sample(tel *Tel, inPits bool) {
	if tel == nil {
		return
	}
	if !tr.started || tel.Lap != tr.lap {
		if tr.started && tr.ok && len(tr.pts) >= 30 {
			if tl := tr.finish(); tl != nil {
				tr.Done = tl
			}
		}
		tr.started, tr.lap = true, tel.Lap
		tr.pts, tr.dist, tr.lastSample = tr.pts[:0], 0, -traceStep
		tr.lastX, tr.lastZ = tel.PosX, tel.PosZ
		// nur Runden, die auf der Strecke an der Linie beginnen (keine Out-Laps aus der Box)
		tr.ok = !inPits && tel.ElapsedT-tel.LapStartT < 1.0
	}
	dx, dz := tel.PosX-tr.lastX, tel.PosZ-tr.lastZ
	step := math.Hypot(dx, dz)
	if step > 60 { // Sprung (Reset, Teleport in die Box) → Runde unbrauchbar
		tr.ok = false
	}
	tr.lastX, tr.lastZ = tel.PosX, tel.PosZ
	tr.dist += step
	if tr.dist-tr.lastSample >= traceStep {
		tr.lastSample = tr.dist
		tr.pts = append(tr.pts, tracePt{d: tr.dist, t: tel.ElapsedT - tel.LapStartT, x: tel.PosX, z: tel.PosZ,
			v: math.Hypot(tel.VelX, tel.VelZ) * 3.6, thr: tel.Throttle, brk: tel.Brake})
	}
}

// Take liefert die zuletzt fertige Runde (einmalig).
func (tr *Trace) Take() *TraceLap {
	d := tr.Done
	tr.Done = nil
	return d
}

func (tr *Trace) finish() *TraceLap {
	n := len(tr.pts)
	enc := map[string]any{"v": 1, "n": n}
	d, t, x, z, s, g, b := make([]int, n), make([]int, n), make([]int, n), make([]int, n), make([]int, n), make([]int, n), make([]int, n)
	var pd, pt, px, pz int
	for i, p := range tr.pts {
		cd, ct, cx, cz := int(math.Round(p.d)), int(math.Round(p.t*100)), int(math.Round(p.x*10)), int(math.Round(p.z*10))
		d[i], t[i], x[i], z[i] = cd-pd, ct-pt, cx-px, cz-pz
		pd, pt, px, pz = cd, ct, cx, cz
		s[i] = int(math.Round(p.v))
		g[i] = int(math.Round(clamp01(p.thr) * 20)) // 0..20 (5-%-Schritte)
		b[i] = int(math.Round(clamp01(p.brk) * 20))
	}
	enc["d"], enc["t"], enc["x"], enc["z"], enc["s"], enc["g"], enc["b"] = d, t, x, z, s, g, b
	raw, err := json.Marshal(enc)
	if err != nil {
		return nil
	}
	var buf bytes.Buffer
	w, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	w.Write(raw)
	w.Close()
	return &TraceLap{Lap: tr.lap, Length: math.Round(tr.dist), N: n, Data: base64.StdEncoding.EncodeToString(buf.Bytes())}
}

func clamp01(v float64) float64 { return math.Max(0, math.Min(1, v)) }

// decodeTrace ist nur für Tests (und zur Kontrolle der Kodierung).
func decodeTrace(s string) (map[string][]int, error) {
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil, err
	}
	r, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.NewDecoder(r).Decode(&m); err != nil {
		return nil, err
	}
	out := map[string][]int{}
	for _, k := range []string{"d", "t", "x", "z", "s", "g", "b"} {
		arr, _ := m[k].([]any)
		acc := 0
		for _, v := range arr {
			f, _ := v.(float64)
			if k == "s" || k == "g" || k == "b" {
				out[k] = append(out[k], int(f))
				continue
			}
			acc += int(f)
			out[k] = append(out[k], acc)
		}
	}
	return out, nil
}

// simTraceLap fährt eine synthetische Runde (für -simulate und Tests).
// skill verändert Kurvenspeed/Bremspunkte (1.0 = Referenz), lap ist die Rundennummer.
func simTraceLap(skill float64, lap int, seed float64) *TraceLap {
	const n = 4000
	pt := func(u float64) (float64, float64) {
		th := u * 2 * math.Pi
		r := 600 * (1 + 0.28*math.Sin(3*th+0.6) + 0.08*math.Sin(7*th))
		return r * math.Cos(th) * 1.4, r * math.Sin(th)
	}
	// Krümmung → Tempo
	xs, zs := make([]float64, n+1), make([]float64, n+1)
	for i := 0; i <= n; i++ {
		xs[i], zs[i] = pt(float64(i) / n)
	}
	sp := make([]float64, n+1)
	for i := 0; i <= n; i++ {
		a, b, c := (i-8+n)%n, i%n, (i+8)%n
		h1 := math.Atan2(zs[b]-zs[a], xs[b]-xs[a])
		h2 := math.Atan2(zs[c]-zs[b], xs[c]-xs[b])
		dh := math.Abs(math.Remainder(h2-h1, 2*math.Pi))
		v := 75 - 900*dh // m/s
		if dh > 0.03 {   // Kurven: Fahrer unterscheiden sich
			v *= skill + 0.01*math.Sin(seed+float64(lap)+float64(i)/300)
		}
		sp[i] = math.Max(18, math.Min(80, v))
	}
	for k := 0; k < 3; k++ { // Bremsen/Beschleunigen glätten
		for i := n - 1; i >= 0; i-- {
			sp[i] = math.Min(sp[i], sp[i+1]+1.2)
		}
		for i := 1; i <= n; i++ {
			sp[i] = math.Min(sp[i], sp[i-1]+0.6)
		}
	}
	tr := &Trace{}
	t := 0.0
	tel := &Tel{Lap: lap, PosX: xs[0], PosZ: zs[0], ElapsedT: 0, LapStartT: 0, VelX: sp[0], Throttle: 1}
	tr.Sample(tel, false)
	for i := 1; i <= n; i++ {
		ds := math.Hypot(xs[i]-xs[i-1], zs[i]-zs[i-1])
		t += ds / sp[i]
		brk, thr := 0.0, 1.0
		if sp[i] < sp[i-1]-0.01 {
			brk, thr = 0.8, 0
		} else if sp[i] < 70 {
			thr = 0.6
		}
		tel = &Tel{Lap: lap, PosX: xs[i], PosZ: zs[i], ElapsedT: t, LapStartT: 0, VelX: sp[i], Throttle: thr, Brake: brk}
		if i == n {
			tel.Lap = lap + 1
			tel.LapStartT = t
		}
		tr.Sample(tel, false)
	}
	return tr.Take()
}
