"""Mid-year plan revision (no Julia): free plan changes, budget top-ups, guidance revisions, and the board's arithmetic
that keeps an early honest warning cheaper than a year-end miss while a late or lowball revision never pays."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import career  # noqa: E402
import test_career_tasks  # noqa: E402


def year_end_total(short, months_done, revise):
    """Confidence change over the year for a true shortfall `short` (share of original guidance), with an honest,
    accurate revision at `months_done` or none. Capex on budget."""
    g = 1000.0
    oil = g * (1 - short)
    if not revise:
        return sum(career.review_parts(oil, g, 1.0, 1.0, g, 1.0)[2].values())
    cost = career.GUIDANCE_BASE_CONF + career.GUIDANCE_CONF * short * (0.5 + 0.5 * months_done / 12.0)
    return -cost + sum(career.review_parts(oil, oil, 1.0, 1.0, g, 1.0)[2].values())


class Arithmetic(unittest.TestCase):
    def test_early_warning_beats_a_miss_and_late_one_does_not(self):
        for short in (0.1, 0.2, 0.3):
            self.assertGreater(year_end_total(short, 3, True), year_end_total(short, 0, False), short)
        self.assertLess(year_end_total(0.05, 11, True), year_end_total(0.05, 0, False))
        for short in (0.05, 0.1, 0.2, 0.4):                            # later is never better than earlier
            self.assertLess(year_end_total(short, 9, True), year_end_total(short, 3, True))

    def test_lowball_then_beat_earns_nothing(self):
        g = 1000.0
        honest = sum(career.review_parts(1000.0, g, 1.0, 1.0, g, 1.0)[2].values())
        lowball = -career.GUIDANCE_BASE_CONF - career.GUIDANCE_CONF * 0.1 * 0.5 + \
            sum(career.review_parts(1000.0, 900.0, 1.0, 1.0, g, 1.0)[2].values())
        self.assertLess(lowball, honest)
        self.assertEqual(career.review_parts(1050.0, 900.0, 1.0, 1.0, g, 1.0)[2]["production_vs_guidance"],
                         career.review_parts(1050.0, g, 1.0, 1.0, g, 1.0)[2]["production_vs_guidance"])


class Revise(unittest.TestCase):
    setUp, tearDown, approve, opens = (getattr(test_career_tasks.CareerTasks, n) for n in ("setUp", "tearDown", "approve", "opens"))

    def raw(self, st, pads):
        return career.check_plan(st, {"design": {"stage_spacing_ft": 200.0, "half_length_ft": 300.0, "conductivity_mdft": 50.0,
                                                 "bhp_psi": 1500.0}, "typecurve": "base", "percentile": "p50", "rigs": 1,
                                      "crews": 1, "budget_request": {}, "pads": pads})

    def test_drop_pads_revise_guidance_and_projection_rebases(self):
        st, truth = career.load(self.cid)
        secs = self.opens(st, 4)
        st, truth = self.approve([{"section": s, "wells": 3} for s in secs])
        career.advance(st, truth, self.sim, 3)
        g0, conf0 = st["board"]["guidance"]["0"], st["board"]["confidence"]
        keep = [{"section": s, "wells": 3} for s in secs if s in st["locked"]]
        plan = self.raw(st, keep)
        pv = career.revision(st, truth, self.sim, plan, revise_guidance=True)       # preview changes nothing
        self.assertEqual(st["board"]["guidance"]["0"], g0)
        self.assertLess(pv["new_guidance_bbl"], g0)
        rv = career.revision(st, truth, self.sim, plan, revise_guidance=True, apply=True)
        self.assertTrue(rv["allowed"], rv)
        self.assertAlmostEqual(st["board"]["guidance"]["0"], rv["new_guidance_bbl"])
        self.assertAlmostEqual(st["board"]["confidence"], conf0 + rv["confidence_change"])
        self.assertLess(rv["confidence_change"], 0)
        self.assertEqual(st["board"]["original"]["0"]["guidance_bbl"], g0)
        self.assertEqual(sorted(p["id"] for p in st["plan"]["pads"]), sorted(st["locked"]))
        pr = career.projection(st)                                                 # right after: on the new number
        self.assertAlmostEqual(pr["oil_pace_bbl"], rv["new_guidance_bbl"], delta=1.0)
        again = career.revision(st, truth, self.sim, plan, revise_guidance=True, apply=True)
        self.assertFalse(again["allowed"])                                         # once a quarter
        career.advance(st, truth, self.sim, 9)
        rev = st["board"]["reviews"][-1]
        self.assertAlmostEqual(rev["guidance_bbl"], rv["new_guidance_bbl"])

    def test_budget_top_up_costs_confidence_and_is_capped(self):
        st, truth = career.load(self.cid)
        secs = self.opens(st, 3)
        st, truth = self.approve([{"section": s, "wells": 3} for s in secs])
        career.advance(st, truth, self.sim, 2)
        plan = self.raw(st, [{"section": s, "wells": 3} for s in secs])
        appr = st["board"]["approved"]["0"]
        too_much = career.revision(st, truth, self.sim, plan, budget_usd=1e12, apply=True)
        self.assertFalse(too_much["allowed"])
        self.assertEqual(st["board"]["approved"]["0"], appr)
        lim = too_much["board_limit_usd"]
        if lim > appr * 1.01:
            conf0 = st["board"]["confidence"]
            rv = career.revision(st, truth, self.sim, plan, budget_usd=(appr + lim) / 2, apply=True)
            self.assertTrue(rv["allowed"], rv)
            self.assertLessEqual(st["board"]["confidence"], conf0 - career.TOPUP_BASE_CONF + 1e-9)
            self.assertEqual(st["board"]["original"]["0"]["approved_usd"], appr)

    def test_free_change_inside_budget(self):
        st, truth = career.load(self.cid)
        secs = self.opens(st, 3)
        st, truth = self.approve([{"section": s, "wells": 3} for s in secs])
        career.advance(st, truth, self.sim, 1)
        conf0 = st["board"]["confidence"]
        plan = self.raw(st, [{"section": s, "wells": 4 if s not in st["locked"] else 3} for s in secs])
        rv = career.revision(st, truth, self.sim, plan, apply=True)
        self.assertTrue(rv["allowed"], rv)
        self.assertEqual(rv["confidence_change"], 0)
        self.assertEqual(st["board"]["confidence"], conf0)

    def test_scenarios_move_npv_the_right_way(self):
        st, truth = career.load(self.cid)
        plan = self.raw(st, [{"section": s, "wells": 3} for s in self.opens(st, 2)])
        ev = career.evaluate_plan(st, truth, self.sim, plan)
        sc = career.scenarios(st, ev, [{"name": "low", "oil_usd_bbl": 50}, {"name": "high", "oil_price_factor": 1.3},
                                       {"name": "capex+20", "capex_factor": 1.2}, {"name": "late", "delay_months": 6}])
        c = {r["name"]: r for r in sc["cases"]}
        self.assertAlmostEqual(c["plan"]["npv10_usd"], ev["measures"]["npv10_usd"], delta=1.0)
        self.assertLess(c["low"]["npv10_usd"], c["plan"]["npv10_usd"])
        self.assertGreater(c["high"]["npv10_usd"], c["plan"]["npv10_usd"])
        self.assertLess(c["capex+20"]["npv10_usd"], c["plan"]["npv10_usd"])
        self.assertLess(c["late"]["npv10_usd"], c["plan"]["npv10_usd"])
        with self.assertRaises(career.CareerError):
            career.scenarios(st, ev, [{}] * 11)

    def test_pop_band_and_truth_delays(self):
        st, truth = career.load(self.cid)
        secs = self.opens(st, 4)
        plan = self.raw(st, [{"section": s, "wells": 3} for s in secs])
        band = career.pop_bands(st, plan, n=40)
        for b in band.values():
            self.assertLessEqual(b["online_month_p10"], b["online_month_p50"])
            self.assertLessEqual(b["online_month_p50"], b["online_month_p90"])
        self.assertTrue(any(b["online_month_p90"] > b["online_month_p10"] for b in band.values()))
        d1 = career.pad_delay(st["seed"], secs[0])
        self.assertEqual(d1, career.pad_delay(st["seed"], secs[0]))                    # fixed per pad

    def test_yearly_jobs_lapse_at_year_end(self):
        st, truth = career.load(self.cid)
        st, truth = self.approve([{"section": s, "wells": 3} for s in self.opens(st, 2)])
        career.advance(st, truth, self.sim, 12)
        yearly = [t for t in st["tasks"] if (t.get("link") or {}).get("year") == 1]
        self.assertTrue(yearly)
        self.assertTrue(all(t["status"] != "open" for t in yearly), [(t["kind"], t["status"]) for t in yearly])


if __name__ == "__main__":
    unittest.main()
