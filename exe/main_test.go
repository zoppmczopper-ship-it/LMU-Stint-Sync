package main

import (
	"encoding/binary"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

type fakeMem struct{ b []byte }

func (m fakeMem) f64(o int, v float64) { binary.LittleEndian.PutUint64(m.b[o:], math.Float64bits(v)) }
func (m fakeMem) f32(o int, v float64) {
	binary.LittleEndian.PutUint32(m.b[o:], math.Float32bits(float32(v)))
}
func (m fakeMem) i32(o, v int) { binary.LittleEndian.PutUint32(m.b[o:], uint32(int32(v))) }
func (m fakeMem) i16(o, v int) { binary.LittleEndian.PutUint16(m.b[o:], uint16(int16(v))) }
func (m fakeMem) u8(o, v int)  { m.b[o] = byte(v) }
func (m fakeMem) str(o int, s string) {
	copy(m.b[o:], s)
}

type world struct {
	m                  fakeMem
	laps, pitState     int
	inPits             bool
	last, et, fuel, ve float64
	wear               float64
	control            int
	realtime           bool
}

func (w *world) build() []byte {
	m := w.m
	si := OffScoringInfo
	m.str(si+ScoringInfo.o("mTrackName"), "Le Mans")
	m.i32(si+ScoringInfo.o("mSession"), 10)
	m.f64(si+ScoringInfo.o("mCurrentET"), w.et)
	m.i32(si+ScoringInfo.o("mNumVehicles"), 2)
	rt := 0
	if w.realtime {
		rt = 1
	}
	m.u8(si+ScoringInfo.o("mInRealtime"), rt)
	m.str(si+ScoringInfo.o("mPlayerName"), "Michi")
	m.f32(si+ScoringInfo.o("mSessionTimeRemaining"), 80000)
	for i := 0; i < 2; i++ {
		o := OffVehScoring + i*VehScoring.size()
		v := func(n string) int { return o + VehScoring.o(n) }
		m.i32(v("mID"), i)
		m.str(v("mVehicleClass"), "Hypercar")
		if i == 0 {
			m.str(v("mDriverName"), "Gegner")
			m.u8(v("mPlace"), 1)
			continue
		}
		m.str(v("mDriverName"), "Michi")
		m.str(v("mVehicleName"), "Team #42")
		m.i16(v("mTotalLaps"), w.laps)
		m.f64(v("mLastLapTime"), w.last)
		m.f64(v("mLastSector1"), w.last*0.3)
		m.f64(v("mLastSector2"), w.last*0.65)
		m.f64(v("mBestLapTime"), 205)
		m.u8(v("mIsPlayer"), 1)
		m.b[v("mControl")] = byte(int8(w.control))
		ip := 0
		if w.inPits {
			ip = 1
		}
		m.u8(v("mInPits"), ip)
		m.u8(v("mPitState"), w.pitState)
		m.u8(v("mPlace"), 2)
	}
	m.u8(OffPlayerHasVehicle, 1)
	m.u8(OffPlayerIdx, 1)
	o := OffTelemInfo + 1*VehTelem.size()
	m.f64(o+VehTelem.o("mFuel"), w.fuel)
	m.f32(o+VehTelem.o("mVirtualEnergy"), w.ve)
	for k := 0; k < 4; k++ {
		m.f64(o+VehTelem.o("mWheels")+k*Wheel.size()+Wheel.o("mWear"), w.wear)
	}
	return m.b
}

func TestScenario(t *testing.T) {
	w := &world{m: fakeMem{make([]byte, MappingSize)}, fuel: 90, ve: 1, wear: 1, realtime: true, control: 0}
	out := &Sender{}
	tr := NewTracker(out, "")
	now := time.Date(2026, 10, 24, 15, 30, 0, 0, time.UTC)
	tr.clock = func() time.Time { return now }
	step := func(sec float64) {
		for i := 0; i < int(sec*5); i++ {
			now = now.Add(200 * time.Millisecond)
			w.et += 0.2
			tr.Update(parse(w.build()))
		}
	}
	step(5) // stint start after debounce
	for l := 1; l <= 3; l++ {
		w.laps, w.last = l, 205+float64(l)
		w.fuel -= 3
		w.ve -= 0.04
		w.wear -= 0.04
		step(10)
	}
	// pit stop with tyre change + refuel
	w.inPits = true
	step(10)
	w.pitState = 3
	step(30)
	w.fuel, w.ve, w.wear, w.pitState = 90, 1, 1, 4
	step(10)
	w.inPits, w.pitState = false, 0
	w.laps, w.last = 4, 260
	step(5)
	// driver leaves car
	w.control = 2
	step(5)

	kinds := map[string]int{}
	for _, m := range out.queue {
		kinds[m["type"].(string)]++
	}
	t.Logf("events: %v", kinds)
	if kinds["stint_start"] != 1 || kinds["lap"] != 4 || kinds["pit"] != 1 || kinds["stint_end"] != 1 {
		t.Fatalf("unexpected events %v", kinds)
	}
	for _, m := range out.queue {
		switch m["type"] {
		case "pit":
			if m["tyres"].(int) != 4 || m["refuel"].(float64) != 9 {
				t.Fatalf("pit wrong: %v", m)
			}
			t.Logf("pit: %v", m)
		case "stint_end":
			t.Logf("end: %v", m)
			if m["laps"].(int) != 4 || m["best"].(float64) != 206 {
				t.Fatalf("stint_end wrong: %v", m)
			}
		case "lap":
			if m["lap"].(int) == 2 {
				t.Logf("lap: %v", m)
				if m["fuelUsed"].(float64) != 3 {
					t.Fatalf("fuelUsed %v", m["fuelUsed"])
				}
			}
		}
	}
	if out.live == nil || out.live["driver"] != "Michi" {
		t.Fatalf("live missing: %v", out.live)
	}
	t.Logf("live: %v", out.live)
}

func TestDiscordText(t *testing.T) {
	for _, m := range []Msg{
		{"type": "stint_start", "driver": "Michi", "session": "Rennen", "track": "Le Mans", "place": 12, "classPlace": 4, "fuel": 90.0, "ve": 100.0},
		{"type": "stint_end", "driver": "Michi", "laps": 12, "best": 209.9, "avg": 211.2, "pits": 1, "incidents": 1, "wear": []float64{70, 68, 75, 74}},
		{"type": "pit", "driver": "Michi", "lap": 50, "lane": 58.3, "stop": 31.2, "refuel": 15.5, "tyres": 4, "repair": true},
		{"type": "event", "driver": "Michi", "kind": "Schaden", "lap": 33, "text": "Kontakt"},
	} {
		t.Log(discordText(m))
	}
	e := liveEmbed(Msg{"driver": "Michi", "place": 12, "classPlace": 4, "session": "Rennen", "track": "Le Mans", "remaining": 61234.0, "fuel": 41.2, "ve": 63.4, "lapsLeft": 13.2, "wear": []float64{78, 74, 82, 80}, "last": 212.3, "best": 209.8, "stintLaps": 8})
	t.Log(e["title"], e["fields"])
}

func TestHandlingUndersteer(t *testing.T) {
	var h Handling
	mk := func(latF, latR, brake, thr float64) *Snap {
		tel := &Tel{VelZ: -40, AccX: 12, YawRate: 0.3, Steer: 0.2, Brake: brake, Throttle: thr}
		for w := 0; w < 4; w++ {
			tel.GndVel[w] = -40
		}
		tel.LatPatch = [4]float64{latF, latF, latR, latR}
		return &Snap{Tel: tel, Player: &Car{}}
	}
	for i := 0; i < 10; i++ {
		h.Sample(mk(4, 1.5, 0.3, 0)) // Einlenken: vorne rutscht mehr → Untersteuern
		h.Sample(mk(1.5, 4, 0, 0.8)) // Ausgang: hinten rutscht mehr → Übersteuern
	}
	m := h.Lap()
	if m["entry"].(Msg)["us"].(float64) != 100 || m["exit"].(Msg)["os"].(float64) != 100 {
		t.Fatalf("unexpected %v", m)
	}
}

func TestFieldTable(t *testing.T) {
	f := simField(20)
	if len(f) != 8 {
		t.Fatalf("rows %d", len(f))
	}
	var me Msg
	for _, r := range f {
		if r["me"] == true {
			me = r
		}
	}
	if me == nil || me["p"] != 3 || me["gl"] != 15.6 || me["gi"] != 4.2 {
		t.Fatalf("me %v", me)
	}
	for _, r := range f {
		if r["n"] == "Gegner B" && (r["gp"] != 1.8 || r["gpl"] != 0) {
			t.Fatalf("B %v", r)
		}
		if r["n"] == "Gegner C" && r["gpl"] != 1 {
			t.Fatalf("C %v", r)
		}
		if r["n"] == "Gegner L" && (r["p"] != 1 || r["gl"] != nil) {
			t.Fatalf("L %v", r)
		}
	}
}

func TestTraceRoundtrip(t *testing.T) {
	a := simTraceLap(1.0, 3, 0)
	b := simTraceLap(0.96, 3, 1)
	if a == nil || b == nil {
		t.Fatal("keine Spur")
	}
	da, err := decodeTrace(a.Data)
	if err != nil {
		t.Fatal(err)
	}
	if len(da["t"]) != a.N || a.N < 300 || a.Length < 4000 {
		t.Fatalf("n=%d len=%v", a.N, a.Length)
	}
	db, _ := decodeTrace(b.Data)
	ta, tb := da["t"][len(da["t"])-1], db["t"][len(db["t"])-1]
	if tb <= ta {
		t.Fatalf("langsamer Fahrer nicht langsamer: %d vs %d", ta, tb)
	}
	if len(a.Data) > 12000 {
		t.Fatalf("zu groß: %d", len(a.Data))
	}
	t.Logf("Punkte %d, Länge %.0f m, Rundenzeit %.2f / %.2f s, Daten %d Zeichen", a.N, a.Length, float64(ta)/100, float64(tb)/100, len(a.Data))
}

func TestHighlightsOvertake(t *testing.T) {
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	var got []string
	h := Highlights{clock: func() time.Time { return now }, emit: func(k, txt string, at time.Time, et, x, z float64) { got = append(got, k+": "+txt) }}
	h.Reset()
	mk := func(myPos int, gap float64) *Snap {
		me := Car{ID: 1, Driver: "Ich", Class: "GT3", ClassPlace: myPos, IsPlayer: true, GapLeader: 10}
		o := Car{ID: 2, Driver: "Gegner", Vehicle: "BMW", Class: "GT3", ClassPlace: 3 - myPos + 2, GapLeader: 10 + gap}
		if myPos == 3 {
			o.ClassPlace = 2
		} else {
			o.ClassPlace = 3
		}
		s := &Snap{Cars: []Car{me, o}, Tel: &Tel{}}
		s.Player = &s.Cars[0]
		return s
	}
	h.Sample(mk(3, -0.4), true) // hinter Gegner, 0,4 s
	for i := 0; i < 240; i++ {  // 2 min Zweikampf
		now = now.Add(500 * time.Millisecond)
		h.Sample(mk(3, -0.4), true)
	}
	now = now.Add(500 * time.Millisecond)
	h.Sample(mk(2, 0.3), true) // überholt
	for i := 0; i < 10; i++ {
		now = now.Add(500 * time.Millisecond)
		h.Sample(mk(2, 3+float64(i)), true)
	}
	for i := 0; i < 70; i++ { // weg → Zweikampf endet
		now = now.Add(500 * time.Millisecond)
		h.Sample(mk(2, 5), true)
	}
	if len(got) != 2 || !strings.HasPrefix(got[0], "Überholt: Gegner") || !strings.HasPrefix(got[1], "Zweikampf: mit Gegner") {
		t.Fatalf("%v", got)
	}
}

func TestQueuePerTeam(t *testing.T) {
	s := &Sender{url: "https://a", run: "r", wake: make(chan struct{}, 1)}
	s.Send(Msg{"type": "lap"})
	s.Send(Msg{"type": "lap"})
	s.mu.Lock()
	s.url = "https://b"
	s.mu.Unlock()
	s.Send(Msg{"type": "lap"})
	st := s.State()
	if st.Pending != 1 || st.PendingByURL["https://a"] != 2 || st.PendingByURL["https://b"] != 1 {
		t.Fatalf("%+v", st)
	}
}

func TestRestSetup(t *testing.T) {
	raw, err := os.ReadFile("testdata/rest.json")
	if err != nil {
		t.Skip("keine Testdaten")
	}
	var bodies map[string]string
	json.Unmarshal(raw, &bodies)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, ok := bodies[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Write([]byte(b))
	}))
	defer srv.Close()
	restBase = srv.URL
	readSetup()
	readOpponents()
	su := lmuSetup()
	b, _ := json.Marshal(su)
	t.Log(string(b))
	g, _ := su["garage"].(Msg)
	if g["ve"] != 100.0 || g["ratio"] != 0.89 || g["litres"] != 89.0 {
		t.Fatalf("garage: %v", g)
	}
	p, _ := su["pit"].(Msg)
	if p["ve"] != 100.0 || p["ratio"] != 0.89 {
		t.Fatalf("pit: %v", p)
	}
	opp := lmuOpponents()
	n := 0
	for k, o := range opp {
		if o.HasVE {
			n++
			if n < 4 {
				t.Logf("%s %+v", k, o)
			}
		}
	}
	if n == 0 {
		t.Fatal("keine Start-VE")
	}
}

func TestVerCmp(t *testing.T) {
	if verCmp("2.6.10", "2.6.9") != 1 || verCmp("2.6", "2.6.0") != 0 || verCmp("2.5.9", "2.6") != -1 {
		t.Fatal("verCmp")
	}
}
