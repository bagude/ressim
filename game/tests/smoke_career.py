"""End-to-end career smoke test through HTTP with the real simulator (a few minutes). Run from ressim/: python game/tests/smoke_career.py"""
import json, shutil, subprocess, sys, time, urllib.request, urllib.error
from pathlib import Path
GAME = Path(__file__).resolve().parents[1]
PORT = 8798
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
cid = None
try:
    for _ in range(120):
        try:
            if get("/api/status")["sim"] == "ready": break
        except OSError: pass
        time.sleep(1)
    t0 = time.time()
    c = post("/api/career/new", {"name": "Smoke Oil"}); assert c["ok"], c; cid = c["career"]["id"]
    while True:
        v = get(f"/api/career?id={cid}")["career"]
        if v["status"] != "generating": break
        time.sleep(2)
    assert v["status"] == "active", v.get("error")
    blob = json.dumps(v)
    assert "perm_md" not in blob and "well_factor" not in blob and "seed" not in blob, "truth leaked"
    print(f"career ready in {time.time() - t0:.0f} s; sections {[s['section'] for s in v['sections'] if s['developed']]} developed")
    an = get(f"/api/career/analogs?id={cid}")["analogs"]
    ids = [a["id"] for a in an if a["history_months"] >= 6]
    tc = post("/api/career/typecurve", {"id": cid, "analogs": ids, "save": "field-wide"}); assert tc["ok"], tc
    print("type curve EUR per 1000 ft (bbl):", {k: round(v) for k, v in tc["eur_oil"].items() if v})
    open_secs = [s["section"] for s in v["sections"] if not s["developed"]]
    plan = {"design": {"stage_spacing_ft": 200, "half_length_ft": 300, "conductivity_mdft": 50, "bhp_psi": 1500},
            "typecurve": "field-wide", "percentile": "p50", "pads": [{"section": s, "wells": 5} for s in open_secs],
            "rigs": 1, "crews": 1, "budget_request": {}}
    ev = post("/api/career/plan", {"id": cid, "plan": plan}); assert ev["ok"], ev
    m = ev["measures"]
    print(f"plan: NPV10 ${m['npv10_usd']/1e6:.1f} MM, PV10/I {m['pvi']:.2f}, F&D ${m['fd_usd_boe']:.1f}/BOE, peak exposure ${m['peak_exposure_usd']/1e6:.1f} MM, "
          f"{len(ev['gantt']['bars'])} Gantt bars, {len(ev['delays'])} budget delays")
    row = ev["budget_by_year"][0]
    print("warnings:", ev["warnings"])
    plan["budget_request"] = {"0": min(row["planned_capex_usd"] * 1.1, row["board_limit_usd"])}
    d = post("/api/career/budget", {"id": cid, "plan": plan}); assert d["ok"], d
    print("board:", d["decision"])
    assert d["decision"]["approved"], d
    t1 = time.time()
    msgs, stops = [], []
    for _ in range(60):                     # Continue until the year needs a budget; staff take every blocking job
        a = post("/api/career/advance", {"id": cid, "until_event": True}); assert a["ok"], a
        msgs += a["new_messages"]; v = a["career"]; st = a["stop"] or {}
        stops.append(st.get("reason"))
        if st.get("reason") == "task_blocking":
            for tid in st["tasks"]:
                r = post("/api/career/task/delegate", {"id": cid, "task": tid}); assert r["ok"], r
        if st.get("reason") in ("budget_needed", "sacked", "finished"):
            break
        if v["month"] >= 3 and not v["board"].get("revisions"):     # mid-year: drop the unstarted pads, warn the board
            started = {p["pad"] for p in v["pads_started"]}
            rplan = dict(plan, pads=[p for p in plan["pads"] if p["section"] in started])
            pv = post("/api/career/plan", {"id": cid, "plan": rplan, "revise_guidance": True}); assert pv["ok"] and pv["revision"], pv
            rv = post("/api/career/revise", {"id": cid, "plan": rplan, "revise_guidance": True}); assert rv["ok"], rv
            r = rv["revision"]; v = rv["career"]
            print(f"revised at month {r['months_done']}: guidance {r['guidance_bbl']/1e3:.0f} -> {r['new_guidance_bbl']/1e3:.0f} kbbl, "
                  f"confidence {r['confidence_change']:+.1f}; projection pace {v['projection']['oil_pace_bbl']/1e3:.0f} kbbl")
    a = {"new_messages": msgs}
    print("stops:", stops)
    pr = [m["data"] for m in msgs if (m.get("data") or {}).get("kind") == "pad_report"]
    print("pad report cards:", [(d["pad"], d["ratio"], d["split"]) for d in pr])
    print("task staff baselines:", sorted({t["kind"]: t["staff_outcome"]["headline"][:40] for t in v["tasks"]}.items()))
    print(f"advanced 12 months in {time.time() - t1:.0f} s; cash ${v['cash_usd']/1e6:.1f} MM; confidence {v['board']['confidence']:.0f}; "
          f"pads started {[p['pad'] for p in v['pads_started']]}")
    print("year review:", {k: (round(x, 2) if isinstance(x, float) else x) for k, x in v["board"]["reviews"][-1].items() if k != "parts"})
    for msg in a["new_messages"]:
        if msg["kind"] != "report": print("  inbox:", msg["month"], msg["title"])
    assert v["month"] == 12 and v["budget_needed"]
    print("career smoke OK")
finally:
    srv.terminate()
    if cid:
        shutil.rmtree(GAME / "careers" / cid, ignore_errors=True)
        for f in (GAME / "steer").glob("*.json"):      # the career's geosteering sessions
            if f'"career": "{cid}"' in f.read_text():
                f.unlink()
