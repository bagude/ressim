"""End-to-end smoke test through HTTP with the real simulator (about 30 s). Run from ressim/: python game/tests/smoke_api.py"""
import json, subprocess, sys, time, urllib.request, urllib.error
from pathlib import Path
GAME = Path(__file__).resolve().parents[1]
PORT = 8799
srv = subprocess.Popen([sys.executable, str(GAME / "server.py"), "--port", str(PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
base = f"http://127.0.0.1:{PORT}"
def get(p):
    return json.load(urllib.request.urlopen(base + p))
def post(p, body):
    req = urllib.request.Request(base + p, json.dumps(body).encode(), {"Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=300))
    except urllib.error.HTTPError as e:
        return json.load(e)
try:
    for _ in range(100):
        try:
            if get("/api/status")["sim"] == "ready": break
        except OSError: pass
        time.sleep(1)
    assert get("/api/status")["sim"] == "ready", "simulator did not become ready"
    lv = get("/api/levels"); assert len(lv) == 7 and all(len(l["stars"]) == 3 for l in lv)
    bad = post("/api/run", {"level": "first-light", "design": {"stages": 99, "half_length_ft": 200}})
    assert bad["ok"] is False and bad["errors"], bad
    d = {"level": "narrow-lease", "player": "smoke-test", "design": {"stages": 4, "half_length_ft": 400, "conductivity_mdft": 30, "bhp_psi": 2000}}
    t0 = time.time(); r = post("/api/run", d); t1 = time.time() - t0
    assert r["ok"], r
    assert r["totals"]["oil_stb"] > 0 and len(r["monthly"]["month"]) == 24 and len(r["stages"]) == 4
    assert all(s["half_length_effective_ft"] <= 250.0 + 1e-6 for s in r["stages"]), "narrow lease should clip fractures at 250 ft"
    assert abs(sum(s["oil_stb"] for s in r["stages"]) - r["totals"]["oil_stb"]) < 0.01 * r["totals"]["oil_stb"], "stage and field oil disagree"
    assert r["has_field"], "field.json missing"
    fld = get("/api/field?run=" + r["run_id"]); nc = fld["nx"] * fld["ny"]
    assert len(fld["x_edges_ft"]) == fld["nx"] + 1 and len(fld["y_edges_ft"]) == fld["ny"] + 1 and len(fld["frac_mask"]) == nc
    assert abs(fld["x_edges_ft"][-1] - 1500) < 0.1 and abs(fld["y_edges_ft"][0] + 250) < 0.1 and abs(fld["y_edges_ft"][-1] - 250) < 0.1
    assert fld["months"] == list(range(25)) and len(fld["pressure_psi"]) == 25 and all(len(p) == nc for p in fld["pressure_psi"])
    assert set(fld["frac_mask"]) == {0, 1, 2, 3, 4}
    pf = fld["pressure_psi"][-1]; fc = [pf[k] for k in range(nc) if fld["frac_mask"][k]]
    assert 1990 < min(pf) and max(fc) < 2600 and max(pf) <= 5000.1, (min(pf), max(fc), max(pf))   # fractures sit near BHP, rock between bhp and initial
    assert len(fld.get("sg", [])) == 25
    lt = post("/api/run", {"level": "tight-rock", "record": False, "design": {"stages": 8, "half_length_ft": 250, "conductivity_mdft": 20, "bhp_psi": 1500}})
    assert lt["ok"], lt
    ft = get("/api/field?run=" + lt["run_id"])
    assert len(ft["months"]) == len(ft["pressure_psi"]) == len(ft["sg"]) and ft["months"][-1] == 120, (len(ft["months"]), len(ft["pressure_psi"]))
    print(f"tight-rock 120 months: {lt['sim_seconds']:.1f} s, NPV ${lt['npv_usd']/1e6:.2f} MM, {len(ft['months'])} field snapshots")
    r2 = post("/api/run", d); assert r2["cached"] and abs(r2["npv_usd"] - r["npv_usd"]) < 1e-6
    assert any(e["player"] == "smoke-test" for e in get("/api/scores?level=narrow-lease"))
    print(f"smoke OK: run {t1:.1f} s, NPV ${r['npv_usd']/1e6:.2f} MM, oil {r['totals']['oil_stb']:.0f} stb, stars {r['stars']}")
finally:
    srv.terminate()
    sp = GAME / "scores.json"   # leave the real leaderboard as it was
    if sp.exists():
        data = json.loads(sp.read_text())
        for board in data.values():
            board.pop("smoke-test", None)
        sp.write_text(json.dumps(data, indent=1))
