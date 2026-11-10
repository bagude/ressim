"""One play: validate a design, simulate it (or reuse an identical earlier run), price it, score it."""
import hashlib
import json
import threading
import time
from pathlib import Path

import economics as eco
import levels as lv
import sim

GAME = Path(__file__).resolve().parent
RUNS = GAME / "runs"
SCORES = GAME / "scores.json"
FIELD_FILE = "field.json"   # per-cell pressure by month, once run_fracwell can write it (served by GET /api/field)
_scores_lock = threading.Lock()


def design_key(level, design):
    blob = json.dumps({"level": level["id"], "perm": level["perm_md"], "width": level["lease_width_ft"], "lateral": level["lateral_ft"],
                       "months": level["months"], "cap": level["facility_cap_stb_d"], "design": design}, sort_keys=True)
    return hashlib.sha1(blob.encode()).hexdigest()[:16]


def simulate(worker, level, design):
    """Run (or reuse) the simulation for a validated design. Returns (outdir, sim_seconds, cached)."""
    key = design_key(level, design)
    out = RUNS / key
    if (out / "done").exists() and ((out / FIELD_FILE).exists() or (out / "field.skipped").exists()):
        return out, 0.0, True
    out.mkdir(parents=True, exist_ok=True)
    spec_path = out / "spec.toml"
    sim.write_spec(spec_path, lv.to_spec(level, design, name=f"fc_{key}"))
    secs, _ = worker.run(str(spec_path), str(out), lv.per_stage_rate_target(level, design))
    (out / "done").write_text("ok")
    return out, secs, False


def evaluate(level, design, outdir):
    """Price a finished run. Pure apart from reading the run's CSV files."""
    st = load_stars().get(level["id"], lv.PLACEHOLDER_STARS)
    costs, prices = eco.DEFAULT_COSTS, eco.DEFAULT_PRICES
    cap = eco.capex(design, level["lateral_ft"], costs)
    t, o, g, w = sim.read_summary(outdir)
    vol = eco.monthly_volumes(t, o, g, w, level["months"])
    cf = eco.cashflow(vol, cap["total_usd"], prices, costs)
    stages = [{"stage": int(s["stage"]), "position_ft": s["position_ft"], "half_length_ft": design["half_length_ft"][i],
               "half_length_effective_ft": s["half_length_on_mesh_ft"], "conductivity_mdft": s["conductivity_mdft"],
               "oil_stb": s["cum_oil_stb"], "gas_mscf": s["cum_gas_mscf"], "water_stb": s["cum_water_stb"]}
              for i, s in enumerate(sim.read_stages(outdir))]
    budget = level["budget_usd"]
    over = budget is not None and cap["total_usd"] > budget + 1e-6
    npv = cf["npv_usd"]
    return {
        "ok": True, "errors": [], "level": level["id"], "design": design,
        "cost": cap, "revenue": cf["revenue"], "npv_usd": npv,
        "stars": 0 if over else eco.stars(npv, st), "star_thresholds_usd": st, "over_budget": over,
        "totals": {"oil_stb": sum(vol["oil_stb"]), "gas_mscf": sum(vol["gas_mscf"]), "water_stb": sum(vol["water_stb"])},
        "stages": stages,
        "monthly": {"month": list(range(1, level["months"] + 1)), "oil_stb": vol["oil_stb"], "gas_mscf": vol["gas_mscf"],
                    "water_stb": vol["water_stb"], "cum_oil_stb": cf["cum_oil_stb"], "cash_usd": cf["cash_usd"],
                    "cum_disc_cash_usd": cf["cum_disc_cash_usd"]},
    }


def load_stars():
    return lv.load_stars()


def play(worker, level_id, design, player="anonymous", record=True):
    level = lv.get_level(level_id)
    if level is None:
        return {"ok": False, "errors": [f"unknown level '{level_id}'"]}
    d, errors = lv.normalise(level, design)
    if errors:
        return {"ok": False, "errors": errors}
    # budget is checked before simulating so an unaffordable design costs the player no waiting
    cap = eco.capex(d, level["lateral_ft"], eco.DEFAULT_COSTS)
    if level["budget_usd"] is not None and cap["total_usd"] > level["budget_usd"] + 1e-6:
        return {"ok": False, "errors": [f"over budget: ${cap['total_usd']:,.0f} against ${level['budget_usd']:,.0f}"], "cost": cap, "over_budget": True}
    try:
        out, secs, cached = simulate(worker, level, d)
    except RuntimeError as e:
        return {"ok": False, "errors": [f"simulator: {e}"]}
    res = evaluate(level, d, out)
    res["sim_seconds"] = secs
    res["cached"] = cached
    res["run_id"] = out.name
    res["has_field"] = (out / FIELD_FILE).exists()
    res["best"] = record_score(level_id, str(player)[:32] or "anonymous", res) if record else None
    return res


def record_score(level_id, player, res):
    """Keep each player's best NPV per level. Returns that player's best entry."""
    with _scores_lock:
        data = json.loads(SCORES.read_text()) if SCORES.exists() else {}
        board = data.setdefault(level_id, {})
        prev = board.get(player)
        entry = {"player": player, "npv_usd": res["npv_usd"], "stars": res["stars"], "when": time.strftime("%Y-%m-%d %H:%M"),
                 "design": res["design"]}
        if prev is None or res["npv_usd"] > prev["npv_usd"]:
            board[player] = entry
            SCORES.write_text(json.dumps(data, indent=1))
            entry["new_best"] = True
            return entry
        return dict(prev, new_best=False)


def leaderboard(level_id, n=10):
    data = json.loads(SCORES.read_text()) if SCORES.exists() else {}
    return sorted(data.get(level_id, {}).values(), key=lambda e: -e["npv_usd"])[:n]


def field_payload(run_id):
    """Raw bytes of a run's field file, or None. run_id is the 16-hex design key returned by play()."""
    if not (isinstance(run_id, str) and len(run_id) == 16 and all(ch in "0123456789abcdef" for ch in run_id)):
        return None
    f = RUNS / run_id / FIELD_FILE
    return f.read_bytes() if f.exists() else None
