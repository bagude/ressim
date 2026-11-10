"""Phase B minigames (well-test, gaslift, pvt-lab) without Julia: a stub worker returns exact or synthetic physics, so the
game logic (hidden truth, refusals, analysis, scoring order) is checked fast. Run: python -m unittest discover game/tests"""
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import mgapi  # noqa: E402
import minigames  # noqa: E402,F401
from minigames import base, gaslift, pvt_lab, well_test  # noqa: E402

HIDDEN = {"hidden", "truth", "perm_md", "model"}


class StubWorker:
    """Exact linear-flow buildups, a toy PVT table and smooth gas-lift responses."""

    def call(self, kind, data, outdir):
        return getattr(self, kind)(data)

    def buildup(self, d):
        s = d["spec"]
        q, tp, ts = d["oil_rate_stb_d"], d["flow_days"], d["shut_days"]
        m = well_test.linear_flow_slope(q, 4 * s["half_length_ft"][0] * s["thickness_ft"], s["perm_md"], s["porosity"])
        n = int(25 * math.log10(ts / 1e-4))
        hours = [24 * 1e-4 * (ts / 1e-4) ** (k / n) for k in range(n + 1)]
        p0 = 5000.0 - m * math.sqrt(tp)
        dp = [m * (math.sqrt(tp) + math.sqrt(h / 24) - math.sqrt(tp + h / 24)) for h in hours]
        der = [m * (math.sqrt(h / 24) / 2 - (h / 24) / (2 * math.sqrt(tp + h / 24))) for h in hours]
        der[0] = der[-1] = None
        return {"hours": hours, "pressure_psi": [p0 + x for x in dp], "flowing_pressure_psi": p0, "flow_days_axis": [tp], "flow_pressure_psi": [p0],
                "flow_rate_stb_d": [q], "rate_held": True, "dp_psi": dp, "derivative_psi": der, "cells": 1}

    def pvt(self, d):
        rs = d["rs"]
        pb, bo = 3000.0 * rs, 1.0 + 0.5 * rs
        return {"rs": rs, "bubble_point_psia": pb, "cce": {"bubble_point_psia": pb, "rows": []},
                "dl": {"bubble_point_psia": pb, "residual_oil_rb_stb": 1.06, "gas_gravity": 0.7, "rows": []},
                "separator": {"bubble_point_psia": pb, "gor_scf_stb": rs * 1000, "bo_rb_stb": bo, "oil_gravity_api": 33.0, "gas_gravity": 0.7}}

    @staticmethod
    def oil(i, g):              # well i: base rate, a gain that bends over, and a well that needs gas to flow at all
        base_ = [300.0, 150.0, 0.0, 200.0][i]
        if i == 2:
            return 0.0 if g < 100 else 120.0 + 8.0 * math.sqrt(g - 100)
        return base_ + [6.0, 10.0, 0.0, 2.0][i] * math.sqrt(g) - 0.01 * g

    def inflow(self, d):
        grid = d.get("gas_rates_mscf_d", [0.0])
        out = []
        for i, w in enumerate(d["wells"]):
            g = w.get("lift_gas_mscf_d", 0.0)
            o = self.oil(i, g)
            pt = None if o <= 0 else {"bhp_psi": 1000.0, "oil_stb_d": o, "gas_mscf_d": 5 * o, "water_stb_d": 0.0, "lift_gas_mscf_d": g, "at_curve_end": False}
            nat = self.oil(i, 0.0)
            out.append({"curve": w.get("curve") or {"bhp_psi": [500.0, 1500.0], "oil_stb_d": [400.0, 0.0], "gas_mscf_d": [2000.0, 0.0], "water_stb_d": [0.0, 0.0]},
                        "vlp_bhp_psi": [1000.0, 3300.0], "point": pt, "natural": None if nat <= 0 else dict(pt or {}, oil_stb_d=nat),
                        "gaslift": {"gas_mscf_d": grid, "oil_stb_d": [self.oil(i, x) for x in grid]}})
        res = {"wells": out, "node_psi": d.get("node_psi", 150.0)}
        if "total_mscf_d" in d:
            n = len(d["wells"])
            res["allocation"] = {"gas_mscf_d": [d["total_mscf_d"] / n] * n, "oil_stb_d": [], "total_oil_stb_d": 0.0, "unused_mscf_d": 0.0}
        return res


W = StubWorker()


def keys(obj):
    if isinstance(obj, dict):
        return set(obj) | set().union(*(keys(v) for v in obj.values()))
    if isinstance(obj, list):
        return set().union(*(keys(v) for v in obj)) if obj else set()
    return set()


def new(kind, **params):
    code, out = mgapi.handle("POST", f"/api/mg/{kind}/new", {}, {"params": {"seed": 1, **params}}, W)
    assert code == 200, out
    return out["session"]


def act(kind, sid, action, **args):
    return mgapi.handle("POST", f"/api/mg/{kind}/act", {}, {"id": sid, "action": action, **args}, W)


def cleanup(kind, sid):
    (base.store_dir(kind) / f"{sid}.json").unlink(missing_ok=True)


class WellTestTests(unittest.TestCase):
    def test_analysis_recovers_k_on_exact_data(self):
        r = StubWorker().buildup({"spec": {"half_length_ft": [250.0], "thickness_ft": 100.0, "perm_md": 0.004, "porosity": 0.08},
                                  "oil_rate_stb_d": 10.0, "flow_days": 10.0, "shut_days": 5.0})
        lw = well_test.linear_window(r["hours"], well_test.slope_estimates(r["hours"], r["derivative_psi"], 10.0))
        self.assertTrue(lw["seen"])
        k = well_test.perm_from_slope(lw["m"], 10.0, 4 * 250.0 * 100.0, 0.08)
        self.assertAlmostEqual(k / 0.004, 1.0, places=3)

    def test_no_half_slope_in_flat_data(self):
        self.assertFalse(well_test.linear_window([1, 2, 4, 8, 16], [100, 130, 170, 220, 290])["seen"])

    def test_play_hidden_refusals_and_score(self):
        s = new("well-test")
        try:
            self.assertFalse(keys(s) & HIDDEN)
            self.assertEqual([a["name"] for a in s["actions"]], ["run_test"])
            code, out = act("well-test", s["id"], "interpret", k_md=0.003, linear_flow="yes")
            self.assertEqual(code, 400)
            code, out = act("well-test", s["id"], "run_test", rate_stb_d=1e6, flow_days=5, shut_days=3)
            self.assertEqual(code, 400)
            w = s["view"]["well"]
            code, out = act("well-test", s["id"], "run_test", rate_stb_d=w["current_rate_stb_d"], flow_days=10, shut_days=5)
            self.assertEqual(code, 200, out)
            self.assertFalse(keys(out["session"]) & HIDDEN)
            t = out["session"]["view"]["tests"][0]
            self.assertGreaterEqual(min(t["hours"]), well_test.FIRST_HOURS)
            self.assertGreater(t["cost_usd"], well_test.MOB_USD)
            lw = well_test.linear_window(t["hours"], well_test.slope_estimates(t["hours"], t["derivative_psi"], t["flow_days"]))
            k = well_test.perm_from_slope(lw["m"], t["rate_stb_d"], w["fracture_area_ft2"], w["phi"])
            code, out = act("well-test", s["id"], "interpret", k_md=k, linear_flow="yes")
            self.assertEqual(code, 200, out)
            r = out["session"]["result"]
            self.assertAlmostEqual(r["breakdown"]["points"]["permeability"], 50.0)
            self.assertEqual(r["breakdown"]["points"]["flow_regime"], 15.0)
            self.assertIn("perm_md", r["lookback"]["truth"])
        finally:
            cleanup("well-test", s["id"])

    def test_score_rules(self):
        good, _ = well_test.score(0.004, True, 0.004, True, False, 100_000)
        short, pts = well_test.score(0.004, True, 0.004, True, True, 100_000)
        self.assertEqual(pts["short_shut_in"], -15.0)
        self.assertLess(short, good)
        self.assertEqual(well_test.k_points(0.008, 0.004), 0.0)
        self.assertEqual(well_test.k_points(0.0045, 0.004), 50.0)

    def test_career_takes_rock_from_params(self):
        s = new("well-test", career=True, rock={"perm_md": 0.0031, "porosity": 0.08, "thickness_ft": 90.0, "net_ft": 70.0, "sw": 0.25},
                design={"half_length_ft": 200.0, "stage_spacing_ft": 250.0, "conductivity_mdft": 40.0}, wells_per_section=4)
        try:
            st = base.load("well-test", s["id"])
            self.assertEqual(st["hidden"]["perm_md"], 0.0031)
            self.assertEqual(st["well"]["net_pay_ft"], 70.0)
            self.assertAlmostEqual(st["well"]["phi"], 0.06)
        finally:
            cleanup("well-test", s["id"])


class GasLiftTests(unittest.TestCase):
    def test_play(self):
        s = new("gaslift")
        try:
            self.assertFalse(keys(s) & HIDDEN)
            v = s["view"]
            n, total = len(v["wells"]), v["total_lift_gas_mscf_d"]
            self.assertEqual(act("gaslift", s["id"], "allocate", gas_mscf_d=[total] * n)[0], 400)        # more than available
            self.assertEqual(act("gaslift", s["id"], "allocate", gas_mscf_d=[0.0] * (n + 1))[0], 400)    # wrong length
            best = gaslift.grid_best([w["gaslift"] for w in v["wells"]], total)
            self.assertLessEqual(sum(best), total + 1e-9)
            code, out = act("gaslift", s["id"], "allocate", gas_mscf_d=best)
            self.assertEqual(code, 200, out)
            r = out["session"]["result"]
            self.assertAlmostEqual(r["breakdown"]["ratio_to_best"], 1.0, places=6)
            self.assertGreaterEqual(r["breakdown"]["ratio_to_equal"], 1.0)
            self.assertEqual(r["stars"], 3)
            self.assertIn("better", r["headline"])
        finally:
            cleanup("gaslift", s["id"])

    def test_bad_split_scores_lower(self):
        s = new("gaslift", seed=2)
        try:
            v = s["view"]
            n, total = len(v["wells"]), v["total_lift_gas_mscf_d"]
            code, out = act("gaslift", s["id"], "allocate", gas_mscf_d=[0.0] * (n - 1) + [total])
            r = out["session"]["result"]
            self.assertLess(r["breakdown"]["ratio_to_best"], 1.0)
            self.assertLess(r["stars"], 3)
        finally:
            cleanup("gaslift", s["id"])

    def test_career_wells_from_params(self):
        s = new("gaslift", career=True, month=12, wells=[{"perm_md": 0.002, "thickness_ft": 80.0, "half_length_ft": 200.0},
                                                         {"perm_md": 0.003, "thickness_ft": 90.0, "half_length_ft": 150.0}])
        try:
            st = base.load("gaslift", s["id"])
            self.assertEqual(st["month"], 12)
            self.assertEqual([w["perm_md"] for w in st["hidden"]["wells"]], [0.002, 0.003])
            self.assertEqual(len(s["view"]["wells"]), 2)
        finally:
            cleanup("gaslift", s["id"])

    def test_grid_best_handles_minimum_gas_well(self):
        curves = [{"gas_mscf_d": [0, 100, 200, 300], "oil_stb_d": [100, 110, 115, 118]},
                  {"gas_mscf_d": [0, 100, 200, 300], "oil_stb_d": [0, 0, 150, 152]}]
        self.assertEqual(gaslift.grid_best(curves, 300.0), [100.0, 200.0])


class PvtLabTests(unittest.TestCase):
    def play(self, seed, method, tests):
        s = new("pvt-lab", seed=seed)
        self.assertFalse(keys(s) & HIDDEN)
        self.assertEqual([a["name"] for a in s["actions"]], ["sample"])
        code, out = act("pvt-lab", s["id"], "sample", method=method)
        self.assertEqual(code, 200, out)
        self.assertFalse(keys(out["session"]) & {"hidden", "quality", "rs"})
        for t in tests:
            code, out = act("pvt-lab", s["id"], "lab", sample=1, test=t)
            self.assertEqual(code, 200, out)
        self.assertEqual(act("pvt-lab", s["id"], "lab", sample=1, test=tests[0])[0], 400)          # bought twice
        sep = out["session"]["view"]["samples"][0]["tests"]["separator"]
        code, out = act("pvt-lab", s["id"], "report", bubble_point_psia=sep["bubble_point_psia"], bo_rb_stb=sep["bo_rb_stb"])
        cleanup("pvt-lab", s["id"])
        return out["session"]["result"]

    def test_good_sample_beats_bad(self):
        good = self.play(3, "bottomhole_conditioned", ["separator"])
        bad = self.play(3, "bottomhole_flowing", ["separator"])
        self.assertEqual(good["breakdown"]["points"]["bubble_point"], 50.0)
        self.assertGreater(good["score"], bad["score"])
        self.assertIn("gas-rich", bad["lookback"]["samples"][0]["quality"])
        self.assertEqual(good["stars"], 3)                     # the sound route (conditioned sample + separator, read exactly) earns 3
        self.assertAlmostEqual(good["breakdown"]["spent_usd"], pvt_lab.METHODS["bottomhole_conditioned"]["usd"] + pvt_lab.TESTS["separator"])

    def test_notes_state_scope(self):
        s = new("pvt-lab")
        cleanup("pvt-lab", s["id"])
        self.assertTrue(any("miscibility" in n and "compositional" in n for n in s["notes"]))

    def test_career_rs(self):
        s = new("pvt-lab", career=True, rs=1.1)
        st = base.load("pvt-lab", s["id"])
        cleanup("pvt-lab", s["id"])
        self.assertEqual(st["hidden"]["rs"], 1.1)


if __name__ == "__main__":
    unittest.main()
