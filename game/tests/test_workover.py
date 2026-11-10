"""Workovers and share codes (no Julia)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import career  # noqa: E402
import test_career_tasks  # noqa: E402
import workover  # noqa: E402


class Workover(unittest.TestCase):
    setUp, tearDown, approve, opens = (getattr(test_career_tasks.CareerTasks, n) for n in ("setUp", "tearDown", "approve", "opens"))

    def test_fading_multiplier(self):
        mm = {"from_month": 10, "factor": 1.6, "fade_months": 20}
        self.assertEqual(workover.multiplier(mm, 9), 1.0)
        self.assertAlmostEqual(workover.multiplier(mm, 10), 1.6)
        self.assertAlmostEqual(workover.multiplier(mm, 20), 1.3)
        self.assertEqual(workover.multiplier(mm, 40), 1.0)
        self.assertEqual(workover.multiplier({"from_month": 0, "factor": 0.8}, 50), 0.8)

    def test_card_perform_and_production_rises(self):
        st, truth = career.load(self.cid)
        st, truth = self.approve([{"section": s, "wells": 3} for s in self.opens(st, 1)])
        career.advance(st, truth, self.sim, 11)
        c = workover.candidates(st, truth, self.sim)
        w = next(x for x in c["wells"] if any(o["kind"] == "cleanout" for o in x["options"]))
        well = next(x for x in st["wells"] if x["id"] == w["well"])
        before = list(well["oil_hist"]["oil"])
        workover.perform(st, w["well"], "cleanout")
        with self.assertRaises(career.CareerError):
            workover.perform(st, w["well"], "cleanout")
        self.assertTrue(any("cleanout" in x["label"] for x in st["costs_pending"]))
        career.advance(st, truth, self.sim, 1)
        self.assertEqual(len(well["oil_hist"]["oil"]), len(before) + 1)

    def test_rta_on_a_producing_well(self):
        import rta
        st, truth = career.load(self.cid)
        st, truth = self.approve([{"section": s, "wells": 3} for s in self.opens(st, 1)])
        career.advance(st, truth, self.sim, 11)
        w = next(w for w in st["wells"] if len((w.get("oil_hist") or {}).get("oil", [])) >= 6)
        r = rta.analyse(st, truth, self.sim, w["id"])
        self.assertGreater(len(r["points"]), 3)
        self.assertGreater(r["linear_flow"]["a_sqrt_k_ft2_sqrt_md"], 0)
        self.assertTrue(all(p["dp_over_q"] > 0 for p in r["points"]))
        with self.assertRaises(career.CareerError):
            rta.analyse(st, truth, self.sim, "nope")

    def test_probabilistic_eur_fan_is_ordered(self):
        import prob
        st, truth = career.load(self.cid)
        st, truth = self.approve([{"section": s, "wells": 3} for s in self.opens(st, 1)])
        career.advance(st, truth, self.sim, 11)
        w = next(w for w in st["wells"] if len((w.get("oil_hist") or {}).get("oil", [])) >= 4)
        r = prob.run(st, truth, self.sim, w["id"])
        e = r["eur_oil_bbl"]
        self.assertLessEqual(e["p90"], e["p50"])
        self.assertLessEqual(e["p50"], e["p10"])
        self.assertGreaterEqual(e["p90"], r["cum_oil_bbl"])
        self.assertEqual(len(r["fan"]["p50"]), prob.FAN_MONTHS)
        self.assertNotIn("porosity", str(r["kept"]))

    def test_share_code_round_trip(self):
        st, _ = career.load(self.cid)
        code = workover.share_code(st)
        self.assertEqual(workover.seed_from_code(code), st["seed"])
        with self.assertRaises(career.CareerError):
            workover.seed_from_code("nonsense")


if __name__ == "__main__":
    unittest.main()
