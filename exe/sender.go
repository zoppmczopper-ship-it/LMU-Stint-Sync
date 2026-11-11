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

type Msg map[string]any

// Sender delivers events to the team sheet (Apps Script web app).
// A device must be approved by the sheet admin before events are accepted;
// until then events are kept in the queue.
type Sender struct {
	mu                       sync.Mutex
	url, token, device, key  string
	driver, lmuName          string
	queue                    []Msg
	live                     Msg
	status                   map[string]Msg // neuester Stand je Art (z. B. "setup"), nur der letzte zählt
	client                   *http.Client
	LastOK                   time.Time
	LastErr, Warn            string
	Sent                     int
	Auth, AuthMsg, SheetName string
	lastHello                time.Time
	Discord                  *Discord
	run                      string
	seq                      int
	wake                     chan struct{}
}

type SenderState struct {
	URL, Auth, AuthMsg, Sheet, LastErr, Warn string
	LastOK                                   string
	Sent, Pending                            int
	PendingByURL                             map[string]int // Warteschlange je Team-Sheet
}

func NewSender(cfg Config) *Sender {
	s := &Sender{url: cfg.URL, token: cfg.Token, device: cfg.Device, key: cfg.Key, driver: cfg.Driver,
		client: &http.Client{Timeout: 30 * time.Second}, run: fmt.Sprintf("%x", time.Now().UnixNano()),
		wake: make(chan struct{}, 1)}
	go s.loop()
	return s
}

// SetTarget changes sheet URL / driver name and triggers a new check-in.
func (s *Sender) SetTarget(url, driver string) {
	s.mu.Lock()
	if url != s.url {
		s.Auth, s.AuthMsg, s.SheetName, s.LastErr, s.Warn = "", "", "", "", ""
		s.live = nil // Live-Status gehört zum bisherigen Team
	}
	s.url, s.driver = url, driver
	s.lastHello = time.Time{}
	s.mu.Unlock()
	s.Recheck()
}

// SetLMUName remembers the LMU player name; it is sent when no driver name is configured.
func (s *Sender) SetLMUName(n string) {
	s.mu.Lock()
	changed := n != "" && n != s.lmuName
	if changed {
		s.lmuName = n
	}
	pending := s.Auth != "freigegeben" && s.Auth != "legacy"
	s.mu.Unlock()
	if changed && s.driver == "" && pending {
		s.Recheck()
	}
}

// Recheck asks the sheet for the approval status right away.
func (s *Sender) Recheck() {
	s.mu.Lock()
	s.lastHello = time.Time{}
	if s.Auth != "freigegeben" && s.Auth != "legacy" {
		s.Auth = ""
	}
	s.mu.Unlock()
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

func (s *Sender) State() SenderState {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := SenderState{URL: s.url, Auth: s.Auth, AuthMsg: s.AuthMsg, Sheet: s.SheetName, LastErr: s.LastErr,
		Warn: s.Warn, Sent: s.Sent, PendingByURL: map[string]int{}}
	for _, m := range s.queue {
		u, _ := m["_u"].(string)
		st.PendingByURL[u]++
		if u == s.url || u == "" {
			st.Pending++
		}
	}
	if !s.LastOK.IsZero() {
		st.LastOK = s.LastOK.Format("15:04:05")
	}
	return st
}

// Send queues an event (kept until delivered).
func (s *Sender) Send(m Msg) {
	m["ts"] = time.Now().UTC().Format(time.RFC3339)
	s.mu.Lock()
	s.seq++
	m["eid"] = fmt.Sprintf("%s-%d", s.run, s.seq)
	m["_u"] = s.url // gehört zu dem Team, für das gerade gefahren wird
	s.queue = append(s.queue, m)
	if len(s.queue) > 5000 {
		s.queue = s.queue[len(s.queue)-5000:]
	}
	d := s.Discord
	s.mu.Unlock()
	if d != nil {
		d.Event(m)
	}
}

// Live replaces the pending live status (only the newest one matters).
func (s *Sender) Live(m Msg) {
	m["ts"] = time.Now().UTC().Format(time.RFC3339)
	m["type"] = "live"
	s.mu.Lock()
	s.live = m
	d := s.Discord
	s.mu.Unlock()
	if d != nil {
		d.Live(m)
	}
}

// Status ersetzt den wartenden Stand einer Art (z. B. die LMU-Einstellungen).
func (s *Sender) Status(kind string, m Msg) {
	m["ts"] = time.Now().UTC().Format(time.RFC3339)
	m["type"] = kind
	s.mu.Lock()
	if s.status == nil {
		s.status = map[string]Msg{}
	}
	s.status[kind] = m
	s.mu.Unlock()
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

func (s *Sender) Pending() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.queue)
}

func (s *Sender) sleep(d time.Duration) {
	select {
	case <-time.After(d):
	case <-s.wake:
	}
}

func allowed(auth string) bool { return auth == "freigegeben" || auth == "legacy" || auth == "?" }

func (s *Sender) loop() {
	for {
		s.mu.Lock()
		url, auth, lastHello := s.url, s.Auth, s.lastHello
		s.mu.Unlock()
		if url == "" {
			s.sleep(2 * time.Second)
			continue
		}
		if !allowed(auth) {
			if time.Since(lastHello) > 20*time.Second {
				s.hello()
			} else {
				s.sleep(2 * time.Second)
			}
			continue
		}

		s.mu.Lock()
		// nur Einträge für das aktive Team; die anderer Teams warten, bis wieder für sie gefahren wird
		var batch []Msg
		sent := map[any]bool{}
		for _, q := range s.queue {
			if u, _ := q["_u"].(string); u != "" && u != url {
				continue
			}
			c := Msg{}
			for k, v := range q {
				if k != "_u" {
					c[k] = v
				}
			}
			batch = append(batch, c)
			sent[q["eid"]] = true
			if len(batch) >= 50 {
				break
			}
		}
		live := s.live
		stat := s.status
		s.status = nil
		s.mu.Unlock()
		if live != nil {
			batch = append(batch, live)
		}
		for _, m := range stat {
			batch = append(batch, m)
		}
		if len(batch) == 0 {
			s.sleep(time.Second)
			continue
		}
		rep, err := s.post(url, Msg{"events": batch})
		if err != nil || !rep.OK {
			s.mu.Lock() // Status-Stände nicht verlieren
			for k, m := range stat {
				if s.status == nil {
					s.status = map[string]Msg{}
				}
				if _, newer := s.status[k]; !newer {
					s.status[k] = m
				}
			}
			s.mu.Unlock()
		}
		if err != nil {
			s.mu.Lock()
			s.LastErr = err.Error()
			s.mu.Unlock()
			s.sleep(5 * time.Second)
			continue
		}
		if !rep.OK {
			s.mu.Lock()
			if rep.Status != "" { // not (or no longer) approved – keep the queue
				s.Auth, s.AuthMsg = rep.Status, rep.Error
			} else {
				s.LastErr = "Sheet meldet: " + rep.Error
			}
			s.mu.Unlock()
			s.sleep(5 * time.Second)
			continue
		}
		s.mu.Lock()
		if live != nil && s.live != nil && s.live["ts"] == live["ts"] {
			s.live = nil
		}
		keep := s.queue[:0]
		n := 0
		for _, q := range s.queue {
			if sent[q["eid"]] {
				n++
				continue
			}
			keep = append(keep, q)
		}
		s.queue = keep
		s.Sent += n
		s.LastOK, s.LastErr = time.Now(), ""
		s.mu.Unlock()
	}
}

// hello checks in with the sheet and registers the device if it is unknown.
func (s *Sender) hello() {
	s.mu.Lock()
	url := s.url
	s.lastHello = time.Now()
	s.mu.Unlock()
	rep, err := s.post(url, Msg{"action": "hello"})
	if err == nil && rep.Status == "unbekannt" {
		rep, err = s.post(url, Msg{"action": "register"})
		if err == nil {
			logf("Beim Team-Sheet angemeldet – warte auf Freigabe durch den Admin")
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil {
		s.Auth, s.AuthMsg = "fehler", err.Error()
		return
	}
	if rep.Sheet != "" {
		s.SheetName = rep.Sheet
	}
	prev := s.Auth
	switch {
	case rep.unreadable:
		s.Auth, s.AuthMsg = "?", "Antwort des Sheets nicht lesbar (DNS-Blocker? script.googleusercontent.com freigeben)"
	case rep.OK && rep.Status == "":
		s.Auth, s.AuthMsg = "legacy", "" // älteres Sheet ohne Freigabe-Funktion
	case rep.Status != "":
		s.Auth, s.AuthMsg = rep.Status, rep.Error
	default:
		s.Auth, s.AuthMsg = "abgelehnt", rep.Error
	}
	if s.Auth != prev && s.Auth == "freigegeben" {
		go logf("✔ Vom Admin freigegeben – Daten werden übertragen")
	}
}

type reply struct {
	OK         bool   `json:"ok"`
	Status     string `json:"status"`
	Error      string `json:"error"`
	Sheet      string `json:"sheet"`
	unreadable bool
}

func (s *Sender) post(url string, payload Msg) (*reply, error) {
	s.mu.Lock()
	name := s.driver
	if name == "" {
		name = s.lmuName
	}
	payload["device"], payload["key"], payload["driver"], payload["version"] = s.device, s.key, name, Version
	if s.token != "" {
		payload["token"] = s.token
	}
	s.mu.Unlock()
	body, _ := json.Marshal(payload)
	// Apps Script runs doPost on this request and answers with a 302 to
	// script.googleusercontent.com, where the JSON result can be fetched.
	noFollow := *s.client
	noFollow.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := noFollow.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("keine Verbindung zum Sheet: %v", shortErr(err))
	}
	if resp.StatusCode == http.StatusFound || resp.StatusCode == http.StatusSeeOther || resp.StatusCode == http.StatusMovedPermanently {
		loc := resp.Header.Get("Location")
		resp.Body.Close()
		if loc == "" {
			return &reply{OK: true, unreadable: true}, nil
		}
		r2, err := s.client.Get(loc)
		if err != nil {
			s.mu.Lock()
			s.Warn = "Antwort des Sheets nicht abrufbar (DNS-Blocker? script.googleusercontent.com freigeben) – Daten kommen trotzdem an"
			s.mu.Unlock()
			return &reply{OK: true, unreadable: true}, nil
		}
		resp = r2
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
	var r reply
	if json.Unmarshal(data, &r) != nil {
		if strings.Contains(string(data), "accounts.google.com") || strings.Contains(string(data), "ServiceLogin") {
			return nil, fmt.Errorf("Web-App verlangt eine Anmeldung – beim Bereitstellen „Zugriff: Jeder“ wählen")
		}
		return nil, fmt.Errorf("unerwartete Antwort (HTTP %d) – stimmt der Link?", resp.StatusCode)
	}
	return &r, nil
}

func shortErr(err error) string {
	s := err.Error()
	if i := strings.LastIndex(s, ": "); i > 0 && len(s) > 120 {
		return s[i+2:]
	}
	return s
}
