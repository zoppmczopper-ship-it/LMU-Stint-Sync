package main

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
)

// startUI serves the local settings & status page on 127.0.0.1.
func startUI(app *App) (string, error) {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte(uiHTML))
	})
	mux.HandleFunc("/api/state", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, app.state())
	})
	mux.HandleFunc("/api/config", func(w http.ResponseWriter, r *http.Request) {
		if !postOK(w, r) {
			return
		}
		var in struct {
			URL       *string `json:"url"`
			Driver    *string `json:"driver"`
			NoBrowser *bool   `json:"noBrowser"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "bad request", 400)
			return
		}
		app.mu.Lock()
		if in.URL != nil {
			u := strings.TrimSpace(*in.URL)
			if u != "" && !strings.HasPrefix(u, "https://script.google.com/") {
				app.mu.Unlock()
				writeJSON(w, map[string]any{"ok": false, "error": "Bitte den Web-App-Link aus dem Sheet einfügen (beginnt mit https://script.google.com/…)"})
				return
			}
			app.cfg.URL = u
			app.cfg.Token = "" // altes Team-Token nur für die bisherige URL
			if u != "" && app.cfg.activeTeam() < 0 {
				app.cfg.Teams = append(app.cfg.Teams, Team{URL: u})
			}
		}
		if in.Driver != nil {
			app.cfg.Driver = strings.TrimSpace(*in.Driver)
		}
		if in.NoBrowser != nil {
			app.cfg.NoBrowser = *in.NoBrowser
		}
		cfg := app.cfg
		app.mu.Unlock()
		saveConfig(cfg)
		app.out.mu.Lock()
		app.out.token = cfg.Token
		app.out.mu.Unlock()
		app.out.SetTarget(cfg.URL, cfg.Driver)
		app.tr.SetDriver(cfg.Driver)
		logf("Einstellungen gespeichert")
		writeJSON(w, map[string]any{"ok": true})
	})
	// Teams: hinzufügen, umbenennen, entfernen, aktiv setzen („ich fahre gerade für …“)
	mux.HandleFunc("/api/teams", func(w http.ResponseWriter, r *http.Request) {
		if !postOK(w, r) {
			return
		}
		var in struct {
			Action string `json:"action"`
			Index  int    `json:"index"`
			Name   string `json:"name"`
			URL    string `json:"url"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "bad request", 400)
			return
		}
		fail := func(msg string) { writeJSON(w, map[string]any{"ok": false, "error": msg}) }
		app.mu.Lock()
		c := &app.cfg
		valid := in.Index >= 0 && in.Index < len(c.Teams)
		switch in.Action {
		case "add":
			u := strings.TrimSpace(in.URL)
			if !strings.HasPrefix(u, "https://script.google.com/") {
				app.mu.Unlock()
				fail("Bitte den Web-App-Link aus dem Sheet einfügen (beginnt mit https://script.google.com/…)")
				return
			}
			for _, t := range c.Teams {
				if t.URL == u {
					app.mu.Unlock()
					fail("Dieses Team-Sheet ist schon in der Liste.")
					return
				}
			}
			c.Teams = append(c.Teams, Team{Name: strings.TrimSpace(in.Name), URL: u})
			if c.URL == "" {
				c.URL, c.Token = u, ""
			}
		case "rename":
			if valid {
				c.Teams[in.Index].Name = strings.TrimSpace(in.Name)
			}
		case "remove":
			if valid {
				was := c.Teams[in.Index].URL == c.URL
				c.Teams = append(c.Teams[:in.Index], c.Teams[in.Index+1:]...)
				if was {
					c.URL, c.Token = "", ""
					if len(c.Teams) > 0 {
						c.URL = c.Teams[0].URL
					}
				}
			}
		case "activate":
			if valid {
				if c.URL != c.Teams[in.Index].URL {
					c.Token = ""
				}
				c.URL = c.Teams[in.Index].URL
				logf("Aktives Team: %s", teamLabel(c.Teams[in.Index], in.Index))
			}
		default:
			app.mu.Unlock()
			fail("unbekannte Aktion")
			return
		}
		cfg := app.cfg
		app.mu.Unlock()
		saveConfig(cfg)
		app.out.mu.Lock()
		app.out.token = cfg.Token
		app.out.mu.Unlock()
		app.out.SetTarget(cfg.URL, cfg.Driver)
		writeJSON(w, map[string]any{"ok": true})
	})
	mux.HandleFunc("/api/recheck", func(w http.ResponseWriter, r *http.Request) {
		if !postOK(w, r) {
			return
		}
		app.out.Recheck()
		writeJSON(w, map[string]any{"ok": true})
	})
	mux.HandleFunc("/api/simulate", func(w http.ResponseWriter, r *http.Request) {
		if !postOK(w, r) {
			return
		}
		app.mu.Lock()
		busy := app.simBusy
		app.simBusy = true
		drv := app.cfg.Driver
		app.mu.Unlock()
		if !busy {
			go func() {
				runSim(app.out, strings.TrimSpace(drv+" (Test)"), false)
				app.mu.Lock()
				app.simBusy = false
				app.mu.Unlock()
			}()
		}
		writeJSON(w, map[string]any{"ok": true})
	})

	var ln net.Listener
	var err error
	port := app.cfg.Port
	for i := 0; i < 10; i++ {
		ln, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port+i))
		if err == nil {
			break
		}
	}
	if err != nil {
		return "", err
	}
	go func() { _ = http.Serve(ln, hostCheck(mux)) }()
	return "http://" + ln.Addr().String() + "/", nil
}

// hostCheck rejects requests whose Host is not localhost (DNS-rebinding protection).
func hostCheck(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if i := strings.LastIndex(host, ":"); i > 0 {
			host = host[:i]
		}
		if host != "127.0.0.1" && host != "localhost" {
			http.Error(w, "forbidden", 403)
			return
		}
		h.ServeHTTP(w, r)
	})
}

// postOK enforces POST + a custom header, which browsers only send same-origin (CSRF protection).
func postOK(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodPost || r.Header.Get("X-LMU") != "1" {
		http.Error(w, "forbidden", 403)
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(v)
}

func (a *App) state() map[string]any {
	a.mu.Lock()
	s, connected, cfg, sim := a.snap, a.lmu, a.cfg, a.simBusy
	a.mu.Unlock()
	lmu := map[string]any{"connected": connected, "status": a.tr.Status}
	if s != nil {
		lmu["session"] = sessionName(s.Session)
		lmu["track"] = s.Track
		lmu["player"] = s.PlayerName
		lmu["remaining"] = s.TimeRemaining
		lmu["realtime"] = s.InRealtime
		if p := s.Player; p != nil {
			lmu["car"], lmu["class"], lmu["lap"] = p.Vehicle, p.Class, p.Laps
			lmu["place"], lmu["classPlace"] = p.Place, p.ClassPlace
			lmu["last"], lmu["best"] = fmtLap(p.Last), fmtLap(p.Best)
			lmu["inCar"] = p.Control == 0 && s.InRealtime
		}
		if t := s.Tel; t != nil {
			lmu["fuel"], lmu["fuelCap"], lmu["ve"] = r1(t.Fuel), r1(t.FuelCap), pct(t.VE)
			lmu["wear"] = wearPct(t.Wear)
			lmu["temp"] = []float64{r1(t.TempC[0]), r1(t.TempC[1]), r1(t.TempC[2]), r1(t.TempC[3])}
		}
	}
	st := a.out.State()
	// Teamname automatisch aus dem Sheet-Namen, solange keiner vergeben ist
	if i := cfg.activeTeam(); i >= 0 && cfg.Teams[i].Name == "" && st.Sheet != "" {
		a.mu.Lock()
		if j := a.cfg.activeTeam(); j >= 0 && a.cfg.Teams[j].Name == "" {
			a.cfg.Teams[j].Name = st.Sheet
			cfg = a.cfg
			go saveConfig(cfg)
		}
		a.mu.Unlock()
	}
	teams := []map[string]any{}
	for i, t := range cfg.Teams {
		teams = append(teams, map[string]any{"name": teamLabel(t, i), "url": t.URL, "active": t.URL == cfg.URL, "pending": st.PendingByURL[t.URL]})
	}
	return map[string]any{
		"teams":    teams,
		"version":  Version,
		"update":   updateInfo(),
		"lmu":      lmu,
		"sheet":    st,
		"sheetMsg": authText(st),
		"config":   map[string]any{"url": cfg.URL, "driver": cfg.Driver, "noBrowser": cfg.NoBrowser, "device": cfg.Device},
		"template": TemplateURL,
		"log":      recentLog(40),
		"simBusy":  sim,
	}
}

func teamLabel(t Team, i int) string {
	if t.Name != "" {
		return t.Name
	}
	return fmt.Sprintf("Team %d", i+1)
}

const uiHTML = `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LMU Stint-Sync</title>
<style>
:root{--bg:#0e1116;--card:#171b22;--line:#262c36;--text:#e8ecf2;--mute:#8b95a5;--accent:#ff5a1f;--ok:#2fbf71;--warn:#f2b632;--bad:#e5484d}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 -apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:18px 16px 40px}
header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px;flex-wrap:wrap}
h1{font-size:19px;margin:0}
h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--mute);margin:0 0 10px}
.pills{display:flex;gap:6px;flex-wrap:wrap}
.pill{font-size:12px;font-weight:600;padding:3px 10px;border-radius:99px;background:var(--line);color:var(--mute)}
.pill.ok{background:rgba(47,191,113,.16);color:var(--ok)}
.pill.warn{background:rgba(242,182,50,.16);color:var(--warn)}
.pill.bad{background:rgba(229,72,77,.16);color:var(--bad)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:720px){.grid{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:14px}
.grid .card{margin:0}
label{display:block;font-size:12px;color:var(--mute);margin:10px 0 4px}
input[type=text]{width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:#0b0e13;color:var(--text);font:inherit}
button{font:inherit;font-weight:600;border:1px solid var(--line);background:#222833;color:var(--text);border-radius:8px;padding:7px 14px;cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
button:disabled{opacity:.5}
.btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.mute{color:var(--mute)}
.big{font-size:22px;font-weight:700}
.kv{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-variant-numeric:tabular-nums}
.kv span:nth-child(odd){color:var(--mute)}
.tyres{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}
.tyre{border:1px solid var(--line);border-radius:8px;padding:6px;text-align:center;font-variant-numeric:tabular-nums}
.tyre b{font-size:17px;display:block}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}
.status{padding:10px 12px;border-radius:10px;margin-top:4px;font-weight:600}
.status.ok{background:rgba(47,191,113,.12)}.status.warn{background:rgba(242,182,50,.12)}.status.bad{background:rgba(229,72,77,.12)}
ol{margin:8px 0 0;padding-left:20px}ol li{margin:4px 0}
.team{display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin:6px 0;cursor:pointer}
.team.on{border-color:var(--accent);background:rgba(255,90,31,.08)}
.team .rad{width:16px;height:16px;border-radius:50%;border:2px solid var(--mute);flex:none}
.team.on .rad{border-color:var(--accent);background:radial-gradient(var(--accent) 45%,transparent 50%)}
.team .nm{font-weight:600;flex:1;min-width:0}
.team .nm small{display:block;font-weight:400;color:var(--mute);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.team button{padding:3px 9px;font-size:12px;font-weight:500}
pre{background:#0b0e13;border:1px solid var(--line);border-radius:10px;padding:10px;font-size:12px;max-height:260px;overflow:auto;white-space:pre-wrap;margin:0}
a{color:#7fb4ff}
a.lnk{display:inline-block;text-decoration:none;font-weight:600;border:1px solid var(--line);background:#222833;color:var(--text);border-radius:8px;padding:7px 14px}
a.lnk:hover{border-color:var(--accent)}
#toast{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#222833;border:1px solid var(--line);padding:8px 14px;border-radius:8px;display:none}
</style></head><body><div class="wrap">
<header><h1>🏁 LMU Stint-Sync <span class="mute" id="ver" style="font-size:13px;font-weight:400"></span></h1>
<div class="pills"><span class="pill" id="pLmu">LMU</span><span class="pill" id="pSheet">Sheet</span></div></header>

<div class="card" id="updCard" style="display:none;border-color:#f2b632"><b>Neue Version <span id="updV"></span> verfügbar</b> – <a id="updLink" target="_blank">auf GitHub herunterladen</a>, alte exe schließen und die neue starten (Einstellungen bleiben).</div>

<div class="card" id="setupCard">
  <h2>Team – ich fahre gerade für</h2>
  <div id="teams"></div>
  <div class="mute" style="font-size:12px;margin-top:6px">Team nur zwischen Sessions wechseln. Noch nicht gesendete Daten bleiben beim jeweiligen Team und werden geschickt, sobald du wieder für dieses Team fährst.</div>
  <div id="sheetState" style="margin-top:10px"></div>
  <div class="btns"><button id="recheck">Status prüfen</button></div>
  <details id="addTeam" style="margin-top:12px"><summary style="cursor:pointer">Team hinzufügen</summary>
    <div id="inviteNote" style="display:none;margin:8px 0;padding:8px 10px;border:1px solid #2fbf71;border-radius:8px">Einladung erkannt – der Link ist schon eingetragen. Jetzt auf <b>Hinzufügen</b> klicken.</div>
    <label for="tName">Name (leer = Name des Sheets)</label>
    <input type="text" id="tName" placeholder="z. B. Endurance-Team">
    <label for="url">Web-App-Link des Team-Sheets</label>
    <input type="text" id="url" placeholder="https://script.google.com/macros/s/…/exec">
    <div class="btns"><button class="primary" id="saveUrl">Hinzufügen</button></div>
  </details>
  <div id="boards" style="display:none;margin-top:14px">
    <div class="mute" style="font-size:12px;margin-bottom:6px">Dashboards dieses Team-Sheets (öffnen im Browser, auch am Handy):</div>
    <div class="btns" style="margin-top:0">
      <a class="lnk" id="lPlan" target="_blank">📋 Stintplan</a>
      <a class="lnk" id="lLive" target="_blank">🏁 Live</a>
      <a class="lnk" id="lBox" target="_blank">🔧 Mechaniker-Board</a>
      <a class="lnk" id="lMap" target="_blank">🗺 Strecken-Analyse</a>
    </div>
  </div>
  <details id="newSheet" style="margin-top:14px"><summary style="cursor:pointer">Noch kein Team-Sheet? Neues erstellen</summary>
    <ol>
      <li><a href="#" id="tplLink" target="_blank">Vorlage kopieren</a> – die Kopie landet in deinem Google Drive, inklusive des ganzen Codes.</li>
      <li>In der Kopie: Menü <b>LMU Sync → Einrichten / Web-App bereitstellen</b>, Zugriff einmal erlauben („Erweitert → … wechseln“).</li>
      <li>Falls verlangt: einmalig die <a href="https://script.google.com/home/usersettings" target="_blank">Google Apps Script API</a> einschalten und Schritt 2 wiederholen.</li>
      <li>Den angezeigten Link oben einfügen und <b>Verbinden</b> klicken.</li>
      <li>Im Sheet unter <b>LMU Sync → Admin</b> dieses Gerät freigeben.</li>
    </ol>
    <div class="mute" id="tplHint" style="margin-top:6px"></div>
  </details>
</div>

<div class="grid">
  <div class="card">
    <h2>Fahrer</h2>
    <label for="driver">Name im Sheet (leer = LMU-Spielername)</label>
    <input type="text" id="driver" placeholder="">
    <div class="btns"><button id="saveDriver">Speichern</button></div>
    <label style="display:flex;gap:8px;align-items:center;margin-top:14px;color:var(--text)"><input type="checkbox" id="noBrowser"> Dieses Fenster beim Start nicht automatisch öffnen</label>
    <div class="mute" style="margin-top:10px;font-size:12px">Geräte-ID: <span id="device"></span></div>
  </div>
  <div class="card">
    <h2>Le Mans Ultimate</h2>
    <div id="lmu" class="mute">–</div>
  </div>
</div>

<div class="card" style="margin-top:14px">
  <h2>Übertragung</h2>
  <div class="kv" id="tx"></div>
  <div class="btns"><button id="sim">Testdaten senden</button></div>
  <div class="mute" style="font-size:12px;margin-top:6px">Testdaten erscheinen als Session „Training“ und verändern den Stintplan nicht.</div>
</div>

<div class="card"><h2>Protokoll</h2><pre id="log"></pre></div>
<div id="toast"></div>
</div>
<script>
var S = null, editing = {};
function $(id){return document.getElementById(id);}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function toast(t){var e=$('toast');e.textContent=t;e.style.display='block';clearTimeout(e._t);e._t=setTimeout(function(){e.style.display='none';},3500);}
function post(path,body){return fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-LMU':'1'},body:JSON.stringify(body||{})}).then(function(r){return r.json();});}
function wcls(v){return v>=60?'ok':v>=30?'warn':'bad';}
['url','driver','tName'].forEach(function(id){$(id).addEventListener('input',function(){editing[id]=true;});});

function render(s){
  S=s;
  $('ver').textContent='v'+s.version;
  if(s.update){$('updCard').style.display='';$('updV').textContent=s.update.v;$('updLink').href=s.update.url;}else{$('updCard').style.display='none';}
  var L=s.lmu, sh=s.sheet;
  var pl=$('pLmu'); pl.textContent=L.connected?(L.inCar?'LMU · im Auto':'LMU verbunden'):'LMU nicht gestartet'; pl.className='pill '+(L.connected?(L.inCar?'ok':'warn'):'bad');
  var cls = sh.Auth==='freigegeben'||sh.Auth==='legacy' ? (sh.LastErr?'bad':'ok') : (sh.Auth==='wartet'||sh.Auth===''||sh.Auth==='?'?'warn':'bad');
  if(!sh.URL) cls='bad';
  var ps=$('pSheet'); ps.textContent=sh.URL?(sh.Auth==='freigegeben'?'Sheet freigegeben':sh.Auth==='wartet'?'Freigabe ausstehend':'Sheet'):'kein Sheet'; ps.className='pill '+cls;
  var stTxt = s.sheetMsg + (sh.Sheet?' – „'+sh.Sheet+'“':'');
  if(sh.Auth==='wartet') stTxt += '<div class="mute" style="font-weight:400;margin-top:4px">Der Admin des Sheets muss dieses Gerät unter <b>LMU Sync → Admin</b> freigeben. Daten werden bis dahin gesammelt.</div>';
  if(sh.Auth==='gesperrt') stTxt += '<div class="mute" style="font-weight:400;margin-top:4px">Bitte beim Admin des Sheets melden.</div>';
  $('sheetState').innerHTML = '<div class="status '+cls+'">'+(sh.URL?stTxt:'Noch kein Team-Sheet verbunden.')+'</div>';
  var T=s.teams||[];
  $('teams').innerHTML = T.length ? T.map(function(t,i){
    return '<div class="team'+(t.active?' on':'')+'" data-i="'+i+'"><span class="rad"></span><span class="nm">'+esc(t.name)+
      '<small>'+esc(t.url.replace(/^https:\/\/script\.google\.com\/macros\/s\//,'…/').slice(0,60))+(t.pending&&!t.active?' · '+t.pending+' Einträge warten':'')+'</small></span>'+
      '<button data-ren="'+i+'">Umbenennen</button><button data-del="'+i+'">Entfernen</button></div>';
  }).join('') : '<div class="mute">Noch kein Team. Unten „Team hinzufügen“.</div>';
  if(!T.length) $('addTeam').open=true;
  var u=s.config.url||'', okUrl=/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u);
  $('boards').style.display=okUrl?'':'none';
  if(okUrl){$('lPlan').href=u;$('lLive').href=u+'?view=live';$('lBox').href=u+'?view=box';$('lMap').href=u+'?view=map';}
  if(!editing.driver) $('driver').value=s.config.driver||'';
  $('driver').placeholder = L.player||'LMU-Spielername';
  $('noBrowser').checked=!!s.config.noBrowser;
  $('device').textContent=s.config.device;
  $('newSheet').open = !s.config.url && !$('newSheet')._touched ? true : $('newSheet').open;
  if(s.template){$('tplLink').href=s.template.replace(/\/edit.*$/,'')+'/copy';$('tplHint').textContent='';}
  else{$('tplLink').removeAttribute('href');$('tplHint').textContent='Für diese Version ist keine Vorlage hinterlegt – frag den Team-Admin nach dem Link.';}

  var h='';
  if(!L.connected){h='<div>'+esc(L.status)+'</div><div class="mute" style="margin-top:6px">In LMU muss unter Einstellungen → Gameplay „Enable Plugins“ an sein.</div>';}
  else{
    h='<div class="big">'+esc(L.player||'–')+'</div><div class="mute">'+esc((L.session||'')+' · '+(L.track||''))+'</div>';
    h+='<div class="kv" style="margin-top:10px">';
    if(L.car) h+='<span>Auto</span><span>'+esc(L.car)+' ('+esc(L.class)+')</span>';
    if(L.place) h+='<span>Position</span><span>P'+L.place+' · Klasse P'+L.classPlace+'</span>';
    if(L.lap!=null) h+='<span>Runde</span><span>'+L.lap+' · letzte '+esc(L.last)+' · beste '+esc(L.best)+'</span>';
    if(L.fuel!=null) h+='<span>Energie</span><span>'+L.fuel+' l'+(L.ve>0?' · VE '+L.ve+' %':'')+'</span>';
    h+='<span>Status</span><span>'+esc(L.status)+'</span></div>';
    if(L.wear){var n=['VL','VR','HL','HR'];h+='<div class="tyres">'+L.wear.map(function(w,i){return '<div class="tyre"><span class="mute">'+n[i]+'</span><b class="'+wcls(w)+'">'+Math.round(w)+'%</b><span class="mute">'+(L.temp?Math.round(L.temp[i])+' °C':'')+'</span></div>';}).join('')+'</div>';}
  }
  $('lmu').innerHTML=h;
  var tx='<span>Gesendet</span><span>'+sh.Sent+' Einträge'+(sh.LastOK?' · zuletzt '+sh.LastOK:'')+'</span>';
  tx+='<span>Warteschlange</span><span>'+sh.Pending+'</span>';
  if(sh.LastErr) tx+='<span>Fehler</span><span class="bad">'+esc(sh.LastErr)+'</span>';
  if(sh.Warn) tx+='<span>Hinweis</span><span class="warn">'+esc(sh.Warn)+'</span>';
  $('tx').innerHTML=tx;
  $('sim').disabled=!!s.simBusy;
  var lg=$('log'), atBottom=lg.scrollTop+lg.clientHeight>=lg.scrollHeight-20;
  lg.textContent=s.log.join('\n'); if(atBottom) lg.scrollTop=lg.scrollHeight;
}
function poll(){fetch('/api/state').then(function(r){return r.json();}).then(render).catch(function(){$('pLmu').textContent='Programm beendet';$('pLmu').className='pill bad';});}
$('newSheet').addEventListener('toggle',function(){this._touched=true;});
$('saveUrl').onclick=function(){post('/api/teams',{action:'add',url:$('url').value,name:$('tName').value}).then(function(r){if(r.ok){editing.url=false;editing.tName=false;$('url').value='';$('tName').value='';$('addTeam').open=false;toast('Team hinzugefügt');poll();}else toast(r.error);});};
$('teams').onclick=function(e){
  var b=e.target.closest('button'), row=e.target.closest('.team'); if(!row) return;
  var i=+row.getAttribute('data-i');
  if(b&&b.hasAttribute('data-ren')){var n=prompt('Name des Teams:', S.teams[i].name); if(n!=null) post('/api/teams',{action:'rename',index:i,name:n}).then(poll); return;}
  if(b&&b.hasAttribute('data-del')){if(confirm('Team „'+S.teams[i].name+'“ aus der Liste entfernen? (Im Sheet ändert sich nichts.)')) post('/api/teams',{action:'remove',index:i}).then(poll); return;}
  if(!S.teams[i].active) post('/api/teams',{action:'activate',index:i}).then(function(){toast('Du fährst jetzt für „'+S.teams[i].name+'“');poll();});
};
$('recheck').onclick=function(){post('/api/recheck').then(function(){toast('Status wird geprüft …');});};
$('saveDriver').onclick=function(){post('/api/config',{driver:$('driver').value}).then(function(){editing.driver=false;toast('Name gespeichert');});};
$('noBrowser').onchange=function(){post('/api/config',{noBrowser:this.checked});};
$('sim').onclick=function(){if(confirm('Zwei kurze Test-Stints (Session „Training“) ins Sheet schicken?'))post('/api/simulate').then(function(){toast('Testdaten werden gesendet');});};
(function(){try{var q=new URLSearchParams(location.search),u=q.get('sheet');
  if(!u||!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u))return;
  $('url').value=u;$('tName').value=(q.get('team')||'').slice(0,60);editing.url=true;editing.tName=true;
  $('addTeam').open=true;$('inviteNote').style.display='';history.replaceState(null,'',location.pathname);}catch(e){}})();
poll(); setInterval(poll,1500);
</script></body></html>`
