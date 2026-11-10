"""Fast tests (no Julia): economics, validation, scoring. Run: python -m unittest discover game/tests"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import economics as eco  # noqa: E402
import engine  # noqa: E402
import levels as lv  # noqa: E402


class Economics(unittest.TestCase):
    def test_monthly_volumes_conserve_total(self):
        t = [0.5, 10.0, 30.4375, 45.0, 60.875]
        q = [100.0, 50.0, 20.0, 10.0, 5.0]
        v = eco.monthly_volumes(t, q, q, q, 2)
        expected = 0.5 * 100 + 9.5 * 50 + 20.4375 * 20 + 14.5625 * 10 + 15.875 * 5
        self.assertAlmostEqual(sum(v["oil_stb"]), expected)
        self.assertAlmostEqual(v["oil_stb"][0], 0.5 * 100 + 9.5 * 50 + 20.4375 * 20)   # step ending exactly at month end stays in month 1

    def test_npv_no_production_is_minus_capex_minus_discounted_opex(self):
        vol = {k: [0.0] * 12 for k in ("oil_stb", "gas_mscf", "water_stb")}
        c = dict(eco.DEFAULT_COSTS)
        cf = eco.cashflow(vol, 1e6, eco.DEFAULT_PRICES, c)
        r = 1.1 ** (1 / 12) - 1
        self.assertAlmostEqual(cf["npv_usd"], -1e6 - sum(c["opex_usd_month"] / (1 + r) ** m for m in range(1, 13)), places=4)

    def test_capex_items(self):
        d = {"stages": 2, "half_length_ft": [100.0, 200.0], "conductivity_mdft": [10.0, 10.0], "bhp_psi": 1500.0}
        c = eco.capex(d, 1000.0, eco.DEFAULT_COSTS)
        self.assertAlmostEqual(c["fracture_size_usd"], 25_000 * (1 + 4))
        self.assertAlmostEqual(c["lift_usd"], 400_000.0)
        self.assertAlmostEqual(c["total_usd"], 1_500_000 + 500_000 + 120_000 + 125_000 + 30_000 + 400_000)

    def test_stars(self):
        self.assertEqual(eco.stars(5.0, [0, 4, 6]), 2)
        self.assertEqual(eco.stars(-1.0, [0, 4, 6]), 0)


class Validation(unittest.TestCase):
    def test_fixed_controls_fill_in(self):
        d, e = lv.normalise(lv.get_level("first-light"), {"stages": 4, "half_length_ft": 200})
        self.assertEqual(e, [])
        self.assertEqual(d["conductivity_mdft"], [50.0] * 4)
        self.assertEqual(d["bhp_psi"], 1500.0)

    def test_out_of_range_is_an_error_not_a_clamp(self):
        _, e = lv.normalise(lv.get_level("first-light"), {"stages": 40, "half_length_ft": 200})
        self.assertTrue(any("stages" in x for x in e))
        _, e = lv.normalise(lv.get_level("sand-and-pressure"), {"stages": 4, "half_length_ft": 200, "conductivity_mdft": 50, "bhp_psi": 200})
        self.assertTrue(any("bhp" in x for x in e))

    def test_lists_only_on_per_stage_levels(self):
        _, e = lv.normalise(lv.get_level("first-light"), {"stages": 2, "half_length_ft": [200, 300]})
        self.assertTrue(e)
        d, e = lv.normalise(lv.get_level("engineers-sandbox"),
                            {"stages": 2, "half_length_ft": [200, 300], "conductivity_mdft": [10, 20], "bhp_psi": 2000})
        self.assertEqual(e, [])
        self.assertEqual(d["half_length_ft"], [200.0, 300.0])

    def test_spec_spans_the_lateral(self):
        level = lv.get_level("tight-rock")
        d, _ = lv.normalise(level, {"stages": 4, "half_length_ft": 200, "conductivity_mdft": 20, "bhp_psi": 2000})
        s = lv.to_spec(level, d)
        self.assertAlmostEqual(s["positions_ft"][-1] + s["edge_ft"] - (s["positions_ft"][0] - s["edge_ft"]), level["lateral_ft"])

    def test_budget_checked_before_simulating(self):
        class NoWorker:
            def run(self, *a):
                raise AssertionError("should not simulate")
        r = engine.play(NoWorker(), "engineers-sandbox", {"stages": 12, "half_length_ft": 450, "conductivity_mdft": 200, "bhp_psi": 1000})
        self.assertFalse(r["ok"])
        self.assertTrue(r["over_budget"])


class Evaluate(unittest.TestCase):
    def test_evaluate_and_scores_from_csv(self):
        level = lv.get_level("first-light")
        d, _ = lv.normalise(level, {"stages": 2, "half_length_ft": 200})
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / "summary_field.csv").write_text(
                "time_days,FIELD:oil_prod_stb_d,FIELD:gas_prod_mscf_d,FIELD:water_prod_stb_d,FIELD:water_inj_stb_d,FIELD:gas_inj_mscf_d\n"
                + "".join(f"{m * 30.4375},100,300,1,0,0\n" for m in range(1, 25)))
            (out / "stages.csv").write_text("stage,position_ft,half_length_on_mesh_ft,conductivity_mdft,cum_oil_stb,cum_gas_mscf,cum_water_stb\n"
                                            "1,375,200,50,1,1,1\n2,1125,200,50,1,1,1\n")
            r = engine.evaluate(level, d, out)
            self.assertAlmostEqual(r["totals"]["oil_stb"], 100 * 30.4375 * 24)
            self.assertEqual(len(r["monthly"]["cash_usd"]), 24)
            self.assertAlmostEqual(r["monthly"]["cum_disc_cash_usd"][-1], r["npv_usd"])
            old = engine.SCORES
            engine.SCORES = out / "scores.json"
            try:
                self.assertTrue(engine.record_score("first-light", "p", r)["new_best"])
                worse = dict(r, npv_usd=r["npv_usd"] - 1)
                self.assertFalse(engine.record_score("first-light", "p", worse)["new_best"])
                self.assertEqual(len(engine.leaderboard("first-light")), 1)
                json.loads((out / "scores.json").read_text())
            finally:
                engine.SCORES = old


if __name__ == "__main__":
    unittest.main()
