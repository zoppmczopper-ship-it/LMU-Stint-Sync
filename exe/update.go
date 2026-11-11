package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Neue exe-Version auf GitHub? Wird beim Start und dann alle 6 h geprüft und im Fenster angezeigt.
const GitHubRepo = "zoppmczopper-ship-it/LMU-Stint-Sync"

var (
	updMu     sync.Mutex
	updLatest string // z. B. "2.6.5"
	updURL    string
)

func startUpdateCheck() {
	if Version == "dev" {
		return
	}
	go func() {
		for {
			checkUpdate()
			time.Sleep(6 * time.Hour)
		}
	}()
}

func checkUpdate() {
	c := &http.Client{Timeout: 10 * time.Second}
	req, _ := http.NewRequest("GET", "https://api.github.com/repos/"+GitHubRepo+"/releases?per_page=20", nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := c.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
	var rels []struct {
		Tag        string `json:"tag_name"`
		URL        string `json:"html_url"`
		Draft      bool   `json:"draft"`
		Prerelease bool   `json:"prerelease"`
	}
	if resp.StatusCode != 200 || json.NewDecoder(resp.Body).Decode(&rels) != nil {
		return
	}
	// exe-Releases heißen „exe-v2.6.5“ (Sheet-Releases „sheet-v3.5“)
	best, url := "", ""
	for _, r := range rels {
		if r.Draft || r.Prerelease || !strings.HasPrefix(r.Tag, "exe-v") {
			continue
		}
		v := strings.TrimPrefix(r.Tag, "exe-v")
		if best == "" || verCmp(v, best) > 0 {
			best, url = v, r.URL
		}
	}
	if best != "" && verCmp(best, Version) > 0 {
		updMu.Lock()
		updLatest, updURL = best, url
		updMu.Unlock()
		logf("Neue Version %s verfügbar: %s", best, url)
	}
}

func updateInfo() map[string]string {
	updMu.Lock()
	defer updMu.Unlock()
	if updLatest == "" {
		return nil
	}
	return map[string]string{"v": updLatest, "url": updURL}
}

func verCmp(a, b string) int {
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < len(pa) || i < len(pb); i++ {
		var x, y int
		if i < len(pa) {
			x, _ = strconv.Atoi(pa[i])
		}
		if i < len(pb) {
			y, _ = strconv.Atoi(pb[i])
		}
		if x != y {
			if x > y {
				return 1
			}
			return -1
		}
	}
	return 0
}
