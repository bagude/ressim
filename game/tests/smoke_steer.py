"""End-to-end geosteering level through HTTP with the real simulator. Run from ressim/: python game/tests/smoke_steer.py"""
import json, subprocess, sys, time, urllib.request, urllib.error
from pathlib import Path
GAME = Path(__file__).resolve().parents[1]
PORT = 8797
srv = subprocess.Popen([sys.executable, str(GAME / "server.py"), "--port", str(PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
base = f"http://127.0.0.1:{PORT}"
def get(p):
    try:
        return json.load(urllib.request.urlopen(base + p, timeout=600))
    except urllib.error.HTTPError as e:
        return json.load(e)
def post(p, body):
    req = urllib.request.Request(base + p, json.dumps(body).encode(), {"Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=900))
    except urllib.error.HTTPError as e:
        return json.load(e)
ids = []
try:
    for _ in range(120):
        try:
            if get("/api/status")["sim"] == "ready": break
        except OSError: pass
        time.sleep(1)
    results = {}
    for label, how in (("hold inclination", "hold"), ("staff auto-steer", "auto")):
        s = post("/api/steer/new", {"seed": 42})["session"]; ids.append(s["id"])
        assert "lookback" not in s and "segments" not in json.dumps(s), "truth leaked before finish"
        if how == "auto":
            s = post("/api/steer/autosteer", {"id": s["id"]})["session"]
        else:
            inc = s["bit"]["inc"]
            while not s["at_td"]:
                r = post("/api/steer/drill", {"id": s["id"], "target_inclination_deg": inc}); assert r["ok"], r; s = r["session"]
        t0 = time.time()
        f = post("/api/steer/finish", {"id": s["id"]}); assert f["ok"], f
        res = f["session"]["result"]
        results[label] = res
        print(f"{label:18s} in zone {res['in_zone_pct']:5.1f} %  buckets {res['bucket_counts']}  NPV10 ${res['measures']['npv10_usd'] / 1e6:6.2f} MM "
              f"vs expert ${res['expert_npv10_usd'] / 1e6:6.2f} MM  ({100 * res['value_ratio']:.0f} %, {res['stars']} stars)  finish {time.time() - t0:.0f} s")
        assert "lookback" in f["session"]
    assert results["staff auto-steer"]["value_ratio"] >= results["hold inclination"]["value_ratio"] - 1e-9
    print("steer smoke OK")
finally:
    srv.terminate()
    for i in ids:
        (GAME / "steer" / f"{i}.json").unlink(missing_ok=True)
