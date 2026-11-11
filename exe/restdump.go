package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

// restDump liest (nur lesend) einige Seiten der internen LMU-Schnittstelle und speichert sie in
// lmu-rest-dump.txt neben der exe – um Setup-/Box-Werte (Virtuelle Energie, Kraftstoffkapazität …) zu finden.
func restDump() {
	paths := []string{
		"/rest/garage/UIScreen/RepairAndRefuel",
		"/rest/garage/PitMenu/receivePitMenu",
		"/rest/garage/getPlayerGarageData",
		"/rest/garage/UIScreen/CarSetupOverview",
		"/rest/garage/UIScreen/DriverHandOffStintEnd",
		"/rest/garage/fuel",
		"/rest/strategy/overall",
		"/rest/sessions/getSessionsInfoForEvent",
		"/rest/sessions/setting/SESSSET_race_timescale",
		"/rest/race/car",
		"/rest/watch/standings",
	}
	exe, _ := os.Executable()
	file := filepath.Join(filepath.Dir(exe), "lmu-rest-dump.txt")
	var out bytes.Buffer
	fmt.Fprintf(&out, "LMU REST-Dump %s (exe %s)\n\n", time.Now().Format("2006-01-02 15:04:05"), Version)
	cl := restClient
	cl.Timeout = 4 * time.Second
	for _, p := range paths {
		resp, err := cl.Get("http://127.0.0.1:6397" + p)
		if err != nil {
			fmt.Fprintf(&out, "=== %s\nFEHLER: %v\n\n", p, err)
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 400000))
		resp.Body.Close()
		var pretty bytes.Buffer
		if json.Indent(&pretty, body, "", "  ") == nil {
			body = pretty.Bytes()
		}
		fmt.Fprintf(&out, "=== %s  (HTTP %d, %d Bytes)\n%s\n\n", p, resp.StatusCode, len(body), body)
	}
	if err := os.WriteFile(file, out.Bytes(), 0o644); err != nil {
		fmt.Println("Konnte Datei nicht schreiben:", err)
		os.Stdout.Write(out.Bytes())
		return
	}
	fmt.Println("Gespeichert:", file)
	fmt.Println("Bitte diese Datei schicken (am besten mit LMU in der Garage bzw. im Auto vor dem Rennstart).")
}
