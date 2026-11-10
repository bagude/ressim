"""Every minigame played to the finish through HTTP on a live server with the real simulator.
Run from ressim/: python game/tests/smoke_all_minigames.py"""
import json, shutil, subprocess, sys, time, urllib.request, urllib.error
from pathlib import Path
GAME = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke_minigames_plays import PLAYS  # noqa: E402  scripted plays for the simulator-backed games

PORT = 8794
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

PREFERRED = ["start_frac", "frac_step", "commit", "advance", "plan_month", "next_month", "kill_mud", "kill_sheet", "pump", "bid", "answer", "finish"]

def default_args(action):
    out = {}
    for name, spec in action.get("args", {}).items():
        if "default" in spec:
            out[name] = spec["default"]
        elif spec["type"] == "enum":
            out[name] = spec["options"][0]
        elif spec["type"] in ("number", "int"):
            out[name] = spec.get("min", 0)
        elif spec["type"] == "list":
            out[name] = []
        elif spec["type"] == "bool":
            out[name] = False
    return out

def autoplay(kind, s):
    """Legal default actions until the game ends, with the few game-specific choices a player must make."""
    for _ in range(300):
        if s["status"] == "finished":
            return s
        acts = {a["name"]: a for a in s["actions"]}
        name = next((n for n in PREFERRED if n in acts), next(iter(acts)))
        v = s["view"]
        if kind == "well-control" and v["phase"] == "drilling":
            r = v.get("readings") or []
            name = "shut_in" if r and r[-1]["pit_gain_bbl"] > 3 else "drill"
        args = default_args(acts[name])
        if kind == "well-control" and name == "kill_mud":
            sh = v["shut_in"]
            args["kmw_ppg"] = round(v["well"]["mw_ppg"] + sh["sidpp_psi"] / (0.052 * sh["tvd_ft"]) + 0.05, 2)
        if kind == "well-control" and name == "kill_sheet":
            sh, w = v["shut_in"], v["well"]
            args.update(icp_psi=w["scr_psi"] + sh["sidpp_psi"], fcp_psi=round(w["scr_psi"] * v["answers"]["kmw_ppg"] / w["mw_ppg"]))
        if kind == "well-control" and name == "pump":
            sched, nxt = v.get("schedule") or [], v.get("next_strokes")
            args["dpp_psi"] = next((p["dpp_psi"] for p in sched if p["strokes"] == nxt), sched[-1]["dpp_psi"] if sched else 500)
        if kind == "hedging" and "swap" in acts and not v.get("book"):
            name, args = "swap", {"share_pct": 50, "quarters": 4}
        if kind == "rig-contracts" and "contract" in acts and len(v.get("fleet") or []) < 2:
            name, args = "contract", {"months": 12}                                        # two 12-month rigs, then spot as needed
        if kind == "pvt-lab":                                                             # sample, two lab tests, report what they say
            smp = v.get("samples") or []
            if not smp:
                name, args = "sample", {"method": "bottomhole_conditioned"}
            elif "cce" not in (smp[0].get("tests") or {}):
                name, args = "lab", {"sample": smp[0]["id"], "test": "cce"}
            elif "separator" not in (smp[0].get("tests") or {}):
                name, args = "lab", {"sample": smp[0]["id"], "test": "separator"}
            else:
                cce, sep = smp[0]["tests"]["cce"], smp[0]["tests"]["separator"]
                name, args = "report", {"bubble_point_psia": cce.get("bubble_point_psia") or 4000, "bo_rb_stb": sep.get("bo_rb_stb") or 1.6}
        if kind == "land-auction" and name == "bid":
            args = {k: 0.5 for k in acts["bid"]["args"]}                                  # $0.5 MM on every tract
        r = post(f"/api/mg/{kind}/act", {"id": s["id"], "action": name, **args})
        assert r["ok"], (kind, name, args, r)
        s = r["session"]
    raise AssertionError(f"{kind} did not finish")

made = []
try:
    for _ in range(120):
        try:
            if get("/api/status")["sim"] == "ready": break
        except OSError: pass
        time.sleep(1)
    hub = get("/api/mg")
    assert all(g["status"] == "live" for g in hub), hub
    print("hub: all", len(hub), "minigames live")
    for g in hub:
        kind = g["kind"]
        t0 = time.time()
        s = post(f"/api/mg/{kind}/new", {"params": {"seed": 7}}); assert s["ok"], (kind, s)
        s = s["session"]; made.append((kind, s["id"]))
        assert s["notes"], f"{kind} has no honesty notes"
        assert "truth" not in json.dumps(s["view"]), f"{kind} leaks truth"
        if kind in PLAYS:
            for action, args in PLAYS[kind]:
                r = post(f"/api/mg/{kind}/act", {"id": s["id"], "action": action, **args}); assert r["ok"], (kind, action, r)
                s = r["session"]
        else:
            s = autoplay(kind, s)
        res = s.get("result")
        assert s["status"] == "finished" and res, f"{kind} did not finish"
        print(f"  {kind:14s} {time.time() - t0:5.0f} s  stars {res['stars']}  {res['headline']}")
    print("all minigames OK")
finally:
    srv.terminate()
    for kind, sid in made:
        (GAME / "mg" / kind / f"{sid}.json").unlink(missing_ok=True)
        shutil.rmtree(GAME / "mg" / kind / sid, ignore_errors=True)
