"""Career-mode tests without Julia: a fake truth simulator stands in for ressim. Run: python -m unittest discover game/tests"""
import math
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import career  # noqa: E402
import opecon  # noqa: E402
import schedule  # noqa: E402
import steer  # noqa: E402
import typecurve  # noqa: E402
import career_tasks  # noqa: E402
career_tasks.KICK_PROBABILITY = 0.0   # random kicks are tested in test_career_tasks.py
sys.path.insert(0, str(Path(__file__).resolve().parent))


class FakeSim:
    """Per-stage hyperbolic decline whose size grows with perm and well spacing (like the real runs)."""
    calls = 0

    def stage_curve(self, spec):
        FakeSim.calls += 1
        qi = 3000.0 * (spec["perm_md"] / 0.005) ** 0.5 * min(1.0, spec["width_ft"] / 1000.0) ** 0.5
        oil = [typecurve.arps_rate(k + 0.5, qi, 2.0, 1.1, 0.08) for k in range(240)]
        return {"oil": oil, "gas": [o * 1.3 for o in oil], "water": [o * 0.01 for o in oil]}


def plan_for(state, **kw):
    open_secs = [s["section"] for s in state["sections"] if not s["developed"]]
    p = {"design": {"stage_spacing_ft": 200.0, "half_length_ft": 300.0, "conductivity_mdft": 50.0, "bhp_psi": 1500.0},
         "typecurve": "base", "percentile": "p50", "pads": [{"section": s, "wells": 4} for s in open_secs[:3]],
         "rigs": 1, "crews": 1, "budget_request": {"0": 80e6, "1": 80e6, "2": 80e6, "3": 80e6, "4": 80e6}}
    p.update(kw)
    return career.check_plan(state, p)


class Opecon(unittest.TestCase):
    def test_irr_matches_npv_zero(self):
        net = [-1000.0] + [30.0] * 60
        r = opecon.irr(net)
        self.assertAlmostEqual(sum(v * (1 + r) ** (-(m + 0.5) / 12) for m, v in enumerate(net)), 0.0, places=3)

    def test_measures_payout_and_exposure(self):
        m = opecon.measures([0.0, 50.0, 50.0, 50.0], [100.0, 0.0, 0.0, 0.0])
        self.assertEqual(m["payout_month"], 3)
        self.assertAlmostEqual(m["peak_exposure_usd"], -100.0)

    def test_well_estimate_plausible(self):
        e = opecon.well_estimate({"stage_spacing_ft": 200.0, "half_length_ft": 300.0, "conductivity_mdft": 50.0, "bhp_psi": 1500.0})
        self.assertEqual(e["stages"], 23)            # 4,620 ft lateral / 200 ft
        self.assertTrue(5e6 < e["total_usd"] < 10e6, e["total_usd"])


class TypeCurve(unittest.TestCase):
    def test_fit_recovers_params(self):
        p = {"qi": 20000.0, "di": 1.5, "b": 0.9, "dmin": 0.08}
        f = typecurve.fit(typecurve.curve(p, 36))
        self.assertAlmostEqual(f["b"], 0.9, delta=0.11)
        self.assertLess(abs(sum(typecurve.curve(f)) / sum(typecurve.curve(p)) - 1), 0.05)

    def test_percentiles_ordered_and_normalised(self):
        al = [{"id": i, "lateral_ft": L, "oil": typecurve.curve({"qi": q * L / 5280, "di": 1.5, "b": 1.0, "dmin": 0.08}, 30),
               "gas": [0.0] * 30} for i, (q, L) in enumerate([(8000, 5280), (10000, 10560), (12000, 7920), (9000, 5280)])]
        tc = typecurve.build(al)
        e = tc["eur_oil"]
        self.assertGreater(e["p10"], e["p50"])
        self.assertGreater(e["p50"], e["p90"])


class Schedule(unittest.TestCase):
    def plan(self, pad, i):
        return {"drill_days": 10.0, "frac_days": 5.0, "drilling_usd": 2e6, "completion_usd": 4e6, "facilities_usd": 0.5e6}

    def test_one_rig_sequence_and_frac_after_drilling(self):
        pads = [{"id": "A", "section": "A", "wells": 2}, {"id": "B", "section": "B", "wells": 2}]
        r = schedule.run(pads, 1, 1, self.plan)
        a, b = r["pads"]
        self.assertGreaterEqual(a["frac_start"], a["drill_end"])
        self.assertAlmostEqual(b["drill_start"], a["drill_end"] + opecon.COSTS["rig_move_days"])
        self.assertLess(b["wells"][0]["drill_days"], 10.0)            # learning curve

    def test_budget_delays_pad_to_next_year(self):
        pads = [{"id": "A", "section": "A", "wells": 2}, {"id": "B", "section": "B", "wells": 2}]
        r = schedule.run(pads, 2, 1, self.plan, budget={0: 15e6, 1: 15e6})
        b = r["pads"][1]
        self.assertGreaterEqual(b["drill_start"], schedule.YEAR_DAYS)
        self.assertEqual(r["delays"][0]["pad"], "B")
        cap, _ = schedule.monthly_capex(r["capex_events"], 36)
        self.assertLessEqual(sum(cap[:12]), 15e6 + 1)

    def test_gantt_shape(self):
        r = schedule.run([{"id": "A", "section": "A", "wells": 3}], 1, 1, self.plan)
        g = schedule.gantt(r, 24)
        self.assertEqual({l["kind"] for l in g["lanes"]}, {"rig", "frac_crew", "pad"})
        self.assertTrue(all(b["end_month"] >= b["start_month"] for b in g["bars"]))

    def test_place_conserves_volume(self):
        c = [100.0] * 10
        self.assertAlmostEqual(sum(schedule.place(c, 45.0, 40)), 1000.0)


class Career(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old, self.old_steer = career.CAREERS, steer.STEER
        career.CAREERS = Path(self.tmp.name)
        steer.STEER = Path(self.tmp.name) / "steer"
        self.sim = FakeSim()
        self.cid = career.new("Test Oil", self.sim, seed=7, background=False)

    def tearDown(self):
        career.CAREERS, steer.STEER = self.old, self.old_steer
        self.tmp.cleanup()

    def test_view_hides_truth(self):
        st, truth = career.load(self.cid)
        v = career.view(st)
        blob = str(v)
        self.assertEqual(st["status"], "active")
        for secret in ("perm_md", "well_factor", "noise_seed", "seed"):
            self.assertNotIn(secret, blob)
        self.assertNotIn("rock", v)

    def test_full_year_loop(self):
        st, truth = career.load(self.cid)
        ids = [a["id"] for a in career.analog_list(st, truth, self.sim) if a["history_months"] >= 6]
        tc, _ = career.build_typecurve(st, truth, self.sim, ids)
        career.save_typecurve(st, "base", ids, tc)
        plan = plan_for(st)
        ev = career.evaluate_plan(st, truth, self.sim, plan)
        self.assertGreater(ev["measures"]["capex_usd"], 0)
        self.assertTrue(all(not k.startswith("_") for k in career.strip_private(ev)))
        with self.assertRaises(career.CareerError):
            career.advance(st, truth, self.sim, 1)                      # no budget yet
        d = career.budget_meeting(st, truth, self.sim, plan)
        self.assertTrue(d["approved"], d)
        career.advance(st, truth, self.sim, 12)
        self.assertEqual(st["month"], 12)
        self.assertEqual(len(st["board"]["reviews"]), 1)
        self.assertTrue(st["wells"], "a pad should have been drilled in year 1")
        self.assertTrue(st["budget_needed"] if "budget_needed" in st else career.view(st)["budget_needed"])
        cap_y1 = sum(st["history"]["capex_usd"][:12])
        self.assertLessEqual(cap_y1, 80e6 * 1.0 + 1)
        # own wells now show up as analogs
        self.assertTrue(any(a["owner"] == "you" for a in career.analog_list(st, truth, self.sim)))

    def test_budget_rejected_over_capital_limit(self):
        st, truth = career.load(self.cid)
        ids = [a["id"] for a in career.analog_list(st, truth, self.sim) if a["history_months"] >= 6]
        tc, _ = career.build_typecurve(st, truth, self.sim, ids)
        career.save_typecurve(st, "base", ids, tc)
        plan = plan_for(st, budget_request={"0": 500e6})
        d = career.budget_meeting(st, truth, self.sim, plan)
        self.assertFalse(d["approved"])
        self.assertFalse(next(c for c in d["conditions"] if c["key"] == "limit")["passes"])

    def test_board_floor_needs_new_wells_and_rejections_cost_once(self):
        st, truth = career.load(self.cid)
        ids = [a["id"] for a in career.analog_list(st, truth, self.sim) if a["history_months"] >= 6]
        tc, _ = career.build_typecurve(st, truth, self.sim, ids)
        career.save_typecurve(st, "base", ids, tc)
        idle = career.check_plan(st, {"design": plan_for(st)["design"], "typecurve": "base", "pads": [], "rigs": 1, "crews": 1,
                                      "budget_request": {"0": 0.0}})
        bc = career.board_check(st, truth, self.sim, idle)
        self.assertGreater(bc["guidance_floor_bbl"], bc["base_oil_bbl"])
        self.assertFalse(bc["floor_reachable"])                  # no pads: the floor cannot be met, and the UI is told so
        c0 = st["board"]["confidence"]
        for _ in range(3):
            self.assertFalse(career.budget_meeting(st, truth, self.sim, idle)["approved"])
        self.assertEqual(st["board"]["confidence"], c0 - 3.0)    # only the first rejection in the cycle costs confidence
        good = plan_for(st, budget_request={})
        bc = career.board_check(st, truth, self.sim, good)
        self.assertTrue(bc["floor_reachable"], bc)
        good = plan_for(st, budget_request={"0": bc["board_limit_usd"]})
        self.assertTrue(career.budget_meeting(st, truth, self.sim, good)["approved"])

    def test_started_pads_are_fixed(self):
        st, truth = career.load(self.cid)
        ids = [a["id"] for a in career.analog_list(st, truth, self.sim) if a["history_months"] >= 6]
        tc, _ = career.build_typecurve(st, truth, self.sim, ids)
        career.save_typecurve(st, "base", ids, tc)
        plan = plan_for(st)
        career.budget_meeting(st, truth, self.sim, plan)
        career.advance(st, truth, self.sim, 2)
        started = next(iter(st["locked"]))
        bad = {"design": plan["design"], "typecurve": "base", "pads": [{"section": started, "wells": 9}], "rigs": 1, "crews": 1}
        with self.assertRaises(career.CareerError):
            career.check_plan(st, bad)


if __name__ == "__main__":
    unittest.main()


class Strategies(unittest.TestCase):
    """Scripted careers on a design-aware fake simulator: the board must punish gaming and reward honest plans."""

    @classmethod
    def setUpClass(cls):
        import strategies
        cls.tmp = tempfile.TemporaryDirectory()
        cls.old, cls.old_steer = career.CAREERS, steer.STEER
        career.CAREERS = Path(cls.tmp.name)
        steer.STEER = Path(cls.tmp.name) / "steer"
        cls.good = strategies.play(1, strategies.GOOD, 5, "p50")
        cls.over = strategies.play(1, strategies.GOOD, 5, "p10")
        cls.sand = strategies.play(1, strategies.GOOD, 5, "p90")
        cls.cheap = strategies.play(1, strategies.CHEAP, 10, "p50")

    @classmethod
    def tearDownClass(cls):
        career.CAREERS, steer.STEER = cls.old, cls.old_steer
        cls.tmp.cleanup()

    def conf(self, run, year):
        return next(t[3] for t in run[1] if t[0] == year)

    def test_honest_plan_survives_five_years(self):
        st, trace, _ = self.good
        self.assertEqual(st["status"], "finished", trace)
        self.assertGreater(st["score"]["value_usd"], 0)

    def test_over_promising_and_sandbagging_cost_confidence(self):
        self.assertLess(self.conf(self.over, 2), self.conf(self.good, 2))
        self.assertLess(self.conf(self.sand, 2), self.conf(self.good, 2))

    def test_cheap_dense_completion_is_sacked_and_warned(self):
        st, trace, warnings = self.cheap
        self.assertEqual(st["status"], "sacked", trace)
        self.assertTrue(warnings)


class TruthMatchesBelief(unittest.TestCase):
    def test_no_variance_means_actual_schedule_equals_plan(self):
        tmp = tempfile.TemporaryDirectory()
        old, old_twp, old_steer = career.CAREERS, career.truth_well_plan, steer.STEER
        career.CAREERS = Path(tmp.name)
        steer.STEER = Path(tmp.name) / "steer"
        career.truth_well_plan = lambda st, d: career.belief_well_plan(d)
        try:
            sim = FakeSim()
            cid = career.new("T", sim, seed=3, background=False)
            st, truth = career.load(cid)
            ids = [a["id"] for a in career.analog_list(st, truth, sim) if a["history_months"] >= 6]
            tc, _ = career.build_typecurve(st, truth, sim, ids)
            career.save_typecurve(st, "base", ids, tc)
            plan = plan_for(st, budget_request={})
            row = career.evaluate_plan(st, truth, sim, plan)["budget_by_year"][0]
            plan = plan_for(st, budget_request={"0": row["board_limit_usd"]})
            planned = {p["pad"]: p for p in career.evaluate_plan(st, truth, sim, plan)["pads"]}
            d = career.budget_meeting(st, truth, sim, plan)
            self.assertTrue(d["approved"], d)
            career.advance(st, truth, sim, 12)
            self.assertTrue(st["locked"])
            for pid, p in st["locked"].items():
                self.assertAlmostEqual(p["drill_start"] / career.MD, planned[pid]["drill_start_month"], places=1)
                self.assertAlmostEqual(p["online"] / career.MD, planned[pid]["online_month"], places=1)
        finally:
            career.CAREERS, career.truth_well_plan, steer.STEER = old, old_twp, old_steer
            tmp.cleanup()
