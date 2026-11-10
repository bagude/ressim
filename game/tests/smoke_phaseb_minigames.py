"""Phase B minigames on the real simulator: well-test (Pressure Buildup), gaslift (Nodal and Gas-Lift Allocation), pvt-lab.
Each is played to the finish through minigames.base with a real sim.Worker().
Run from ressim/: python game/tests/smoke_phaseb_minigames.py"""
import sys
import time
from pathlib import Path

GAME = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(GAME))
import field  # noqa: E402
import sim  # noqa: E402
import minigames  # noqa: E402,F401
from minigames import base, gaslift, well_test  # noqa: E402

HIDDEN = {"hidden", "truth", "perm_md", "model"}


def keys(obj):
    if isinstance(obj, dict):
        return set(obj) | set().union(*(keys(v) for v in obj.values()))
    if isinstance(obj, list):
        return set().union(*(keys(v) for v in obj)) if obj else set()
    return set()


def session(kind, seed, w, params=None):
    st = base.new_state(kind, {"seed": seed})
    g = base.REGISTRY[kind]
    ctx = base.Ctx(w, field.TruthSim(w), base.store_dir(kind) / st["id"])
    t0 = time.time()
    g.new(st, params or {}, ctx)
    print(f"[{kind} seed {seed}] new: {time.time() - t0:.1f} s")
    return st, g, ctx


def play(st, g, ctx, action, args):
    t0 = time.time()
    assert action in {a["name"] for a in g.view(st)["actions"]}, (action, g.view(st)["actions"])
    ev = g.act(st, action, args, ctx)
    st["turn"] += 1
    print(f"   {action} ({time.time() - t0:.1f} s): {' | '.join(ev)}")
    if st["status"] == "active":
        leak = keys(base.session_view(st)) & HIDDEN
        assert not leak, leak
    return ev


def finish(st):
    r = st["result"]
    print(f"   -> stars {r['stars']}, score {r['score']}: {r['headline']}")
    (base.store_dir(st["kind"]) / f"{st['id']}.json").unlink(missing_ok=True)
    return r


def smoke_well_test(w):
    for seed, flow, shut in ((3, 10.0, 5.0), (8, 2.0, 0.25)):
        st, g, ctx = session("well-test", seed, w)
        well = g.view(st)["view"]["well"]
        print(f"   well: {well['stages']} fractures, xf {well['half_length_ft']} ft, h {well['net_pay_ft']} ft, phi {well['porosity']}, "
              f"rate before test {well['current_rate_stb_d']} stb/d")
        play(st, g, ctx, "run_test", {"rate_stb_d": well["current_rate_stb_d"], "flow_days": flow, "shut_days": shut})
        t = g.view(st)["view"]["tests"][-1]
        # an analyst working only from the view
        lw = well_test.linear_window(t["hours"], well_test.slope_estimates(t["hours"], t["derivative_psi"], t["flow_days"]))
        if lw["seen"]:
            k_est = well_test.perm_from_slope(lw["m"], t["rate_stb_d"], well["fracture_area_ft2"], well["porosity"])
            print(f"   view-only analyst: half slope {lw['from_hours']:.2g}-{lw['to_hours']:.3g} h, m {lw['m']:.1f} psi/sqrt(d), k {k_est:.5f} md "
                  f"(true {st['hidden']['perm_md']:.5f}, ratio {k_est / st['hidden']['perm_md']:.3f}); rate held {t['rate_held']}")
        else:
            k_est = 0.005
            print(f"   view-only analyst: no half slope in {t['shut_days'] * 24:g} h of shut-in; guessing {k_est} md (true {st['hidden']['perm_md']:.5f})")
        play(st, g, ctx, "interpret", {"k_md": k_est, "linear_flow": "yes" if lw["seen"] else "no"})
        r = finish(st)
        print(f"   points {({k: round(v, 1) for k, v in r['breakdown']['points'].items()})}, cost ${r['breakdown']['cost_usd']:,.0f}")


def smoke_gaslift(w):
    st, g, ctx = session("gaslift", 5, w)
    v = g.view(st)["view"]
    print(f"   month {v['month']}, {len(v['wells'])} wells, {v['total_lift_gas_mscf_d']:.0f} Mscf/d of lift gas")
    for x in v["wells"]:
        nat = x["natural"]
        print(f"   {x['id']}: xf {x['half_length_ft']} ft, tubing {x['tubing_id_in']} in, natural "
              f"{'cannot flow' if nat is None else f'{nat['oil_stb_d']:.0f} stb/d at {nat['bhp_psi']:.0f} psi'}; gas-lift curve "
              + ", ".join(f"{gg:.0f}:{o:.0f}" for gg, o in list(zip(x["gaslift"]["gas_mscf_d"], x["gaslift"]["oil_stb_d"]))[::4]))
    n = len(v["wells"])
    plays = [("equal split", [v["total_lift_gas_mscf_d"] / n] * n),
             ("all gas to W1", [v["total_lift_gas_mscf_d"]] + [0.0] * (n - 1)),
             ("read off the curves", gaslift.grid_best([x["gaslift"] for x in v["wells"]], v["total_lift_gas_mscf_d"]))]
    for label, split in plays:
        s2 = st if label == plays[-1][0] else {**st, "status": "active", "result": None}     # earlier plays on a copy of the session
        print(f"   play: {label} {split}")
        play(s2, g, ctx, "allocate", {"gas_mscf_d": split})
        r = s2["result"]
        refs = r["breakdown"]["references"]
        print(f"   -> stars {r['stars']}, score {r['score']}: {r['headline']}")
        print(f"      allocator {refs['allocator']['gas_mscf_d']} -> {refs['allocator']['total_oil_stb_d']:.1f} stb/d; grid {refs['grid_search']['gas_mscf_d']} -> "
              f"{refs['grid_search']['total_oil_stb_d']:.1f}; equal {refs['equal_split']['total_oil_stb_d']:.1f}; none {refs['no_lift_gas']['total_oil_stb_d']:.1f}")
    finish(st)


def smoke_pvt(w):
    for seed, method, tests in ((4, "bottomhole_conditioned", ["cce", "separator"]), (4, "bottomhole_flowing", ["separator"]),
                                (6, "surface_recombination", ["cce", "dl", "separator"])):
        st, g, ctx = session("pvt-lab", seed, w)
        play(st, g, ctx, "sample", {"method": method})
        for t in tests:
            play(st, g, ctx, "lab", {"sample": 1, "test": t})
        s = g.view(st)["view"]["samples"][0]
        sep = s["tests"]["separator"]
        print(f"   separator report: pb {sep['bubble_point_psia']:.0f} psia, Bo {sep['bo_rb_stb']:.4f}, GOR {sep['gor_scf_stb']:.0f}; "
              f"sampling {s.get('sampling_pressure_psia', '-')} psia")
        play(st, g, ctx, "report", {"bubble_point_psia": sep["bubble_point_psia"], "bo_rb_stb": sep["bo_rb_stb"]})
        r = finish(st)
        print(f"   lookback: truth pb {r['lookback']['bubble_point_psia']:.0f}, Bo {r['lookback']['bo_rb_stb']:.4f}; sample quality: {r['lookback']['samples'][0]['quality']}")


w = sim.Worker()
w.start()
try:
    t0 = time.time()
    smoke_pvt(w)
    smoke_well_test(w)
    smoke_gaslift(w)
    print(f"phase B minigames smoke OK ({time.time() - t0:.0f} s after the worker was ready)")
finally:
    w.stop()
