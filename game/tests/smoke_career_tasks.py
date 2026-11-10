"""End-to-end: minigames inside a career, real simulator, through HTTP. Run from ressim/: python game/tests/smoke_career_tasks.py"""
import json, shutil, subprocess, sys, time, urllib.request, urllib.error
from pathlib import Path
GAME = Path(__file__).resolve().parents[1]
PORT = 8795
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
cid, sessions = None, []
try:
    for _ in range(120):
        try:
            if get("/api/status")["sim"] == "ready": break
        except OSError: pass
        time.sleep(1)
    cid = post("/api/career/new", {"name": "Task Smoke"})["career"]["id"]
    while get(f"/api/career?id={cid}")["career"]["status"] == "generating":
        time.sleep(2)
    an = get(f"/api/career/analogs?id={cid}")["analogs"]
    assert post("/api/career/typecurve", {"id": cid, "analogs": [a["id"] for a in an if a["history_months"] >= 6], "save": "tc"})["ok"]
    v = get(f"/api/career?id={cid}")["career"]
    sec = [s["section"] for s in v["sections"] if not s["developed"]][:2]
    plan = {"design": {"stage_spacing_ft": 250, "half_length_ft": 300, "conductivity_mdft": 50, "bhp_psi": 1500}, "typecurve": "tc",
            "percentile": "p50", "rigs": 1, "crews": 1, "budget_request": {},
            "pads": [{"section": sec[0], "wells": 3, "completion": "manual", "flowback": "manual"}, {"section": sec[1], "wells": 3}]}
    ev = post("/api/career/plan", {"id": cid, "plan": plan}); assert ev["ok"], ev
    plan["budget_request"] = {"0": ev["board_check"]["board_limit_usd"]}
    d = post("/api/career/budget", {"id": cid, "plan": plan}); assert d["decision"]["approved"], d
    v = d["career"]
    print("optional yearly tasks:", [t["kind"] for t in v["tasks"]])
    r = post("/api/career/advance", {"id": cid, "months": 6})
    print("advance:", "ok" if r["ok"] else r["errors"][0][:160])
    v = get(f"/api/career?id={cid}")["career"]
    blocking = [t for t in v["tasks"] if t["blocking"] and t["status"] == "open"]
    print("blocking tasks:", [(t["kind"], t["due_month"]) for t in blocking])
    for t in blocking:
        kind, sid = t["kind"], t["session"]
        sessions.append((kind, sid))
        s = get(f"/api/mg/{kind}?id={sid}")["session"]
        assert s["link"]["career"] == cid
        t0 = time.time()
        if kind == "pump-job":
            r = post(f"/api/mg/{kind}/act", {"id": sid, "action": "pump", "fluid": "slickwater", "rate_bpm": 18, "minutes": 60,
                                             "sand": "100_mesh", "schedule": [[0.25, 0.5], [0.5, 1.0], [0.75, 1.5]]})
        elif kind == "flowback":
            for bhp in (3800, 3000, 2200):
                r = post(f"/api/mg/{kind}/act", {"id": sid, "action": "set_month", "bhp_psi": bhp}); assert r["ok"], r
            r = post(f"/api/mg/{kind}/act", {"id": sid, "action": "finish"})
        else:
            r = post("/api/career/task/delegate", {"id": cid, "task": t["id"]})
        assert r["ok"], r
        print(f"  {kind}: {time.time() - t0:.0f} s; {r.get('events') or r.get('outcome')}")
    v = get(f"/api/career?id={cid}")["career"]
    print("task status:", [(t["kind"], t["status"]) for t in v["tasks"]])
    t0 = time.time()
    r = post("/api/career/advance", {"id": cid, "months": 6}); assert r["ok"], r
    v = r["career"]
    print(f"advanced to month {v['month']} in {time.time() - t0:.0f} s; WTI path {[round(x) for x in v['history']['wti_usd_bbl']]}")
    print("career task smoke OK")
finally:
    srv.terminate()
    if cid:
        shutil.rmtree(GAME / "careers" / cid, ignore_errors=True)
        for f in list((GAME / "steer").glob("*.json")) + list((GAME / "mg").rglob("*.json")):
            try:
                if f'"career": "{cid}"' in f.read_text():
                    f.unlink()
            except OSError:
                pass
