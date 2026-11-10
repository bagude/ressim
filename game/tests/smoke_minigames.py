"""End-to-end check of the simulator-backed minigames through HTTP. Run from ressim/: python game/tests/smoke_minigames.py [kind ...]"""
import json, shutil, subprocess, sys, time, urllib.request, urllib.error
from pathlib import Path
GAME = Path(__file__).resolve().parents[1]
PORT = 8796
srv = subprocess.Popen([sys.executable, str(GAME / "server.py"), "--port", str(PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
base = f"http://127.0.0.1:{PORT}"
def get(p):
    try:
        return json.load(urllib.request.urlopen(base + p, timeout=900))
    except urllib.error.HTTPError as e:
        return json.load(e)
def post(p, body):
    req = urllib.request.Request(base + p, json.dumps(body).encode(), {"Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=1800))
    except urllib.error.HTTPError as e:
        return json.load(e)

PLAYS = {
    "flowback": [("set_month", {"bhp_psi": 4300}), ("set_month", {"bhp_psi": 3500}), ("set_month", {"bhp_psi": 2500}), ("finish", {})],
    "facility": [("study", {"separator_psi": 100, "oil_cap_bbl_d": 1200, "allocation": "pro_rata", "priority": [1, 2, 3]}),
                 ("build", {"separator_psi": 80, "oil_cap_bbl_d": 2000, "allocation": "common_choke", "priority": [1, 2, 3]})],
    "lift": [("study", {"method": "none"}), ("study", {"method": "gas_lift", "switch_month": 3, "injection_mcf_d": 600}),
             ("install", {"method": "pump", "switch_month": 6, "intake_psi": 250})],
    "diagnostics": [("answer", {"downtime": [5, 9], "frac_hit": 0, "regime": "linear flow (half slope)", "eur10": 300000})],
    "pump-job": [("minifrac", {}),
                 ("pump", {"fluid": "slickwater", "rate_bpm": 20, "minutes": 70, "sand": "100_mesh",
                           "schedule": [[0.2, 0.5], [0.45, 1.0], [0.7, 1.75]]})],
}
made = []
try:
    for _ in range(120):
        try:
            if get("/api/status")["sim"] == "ready": break
        except OSError: pass
        time.sleep(1)
    hub = get("/api/mg")
    print("hub:", [(g["kind"], g["status"]) for g in hub])
    for kind in (sys.argv[1:] or list(PLAYS)):
        s = post(f"/api/mg/{kind}/new", {"params": {"seed": 3}}); assert s["ok"], s
        sid = s["session"]["id"]; made.append((kind, sid))
        assert "truth" not in json.dumps(s["session"]), "truth leaked"
        for action, args in PLAYS[kind]:
            t0 = time.time()
            r = post(f"/api/mg/{kind}/act", {"id": sid, "action": action, **args}); assert r["ok"], r
            print(f"  {kind} {action}: {time.time() - t0:.0f} s; events: {r['events']}")
        res = r["session"].get("result")
        assert res, "game did not finish"
        print(f"  {kind} result: {res['headline']} | stars {res['stars']}")
    print("minigame smoke OK")
finally:
    srv.terminate()
    for kind, sid in made:
        (GAME / "mg" / kind / f"{sid}.json").unlink(missing_ok=True)
        shutil.rmtree(GAME / "mg" / kind / sid, ignore_errors=True)
