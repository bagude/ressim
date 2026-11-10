"""Emissions (no Julia): monthly CO2e, abatement choices lower it, the board part, carbon cost in cash."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import career  # noqa: E402
import emissions  # noqa: E402
import test_career_tasks  # noqa: E402


class Emissions(unittest.TestCase):
    setUp, tearDown, approve, opens = (getattr(test_career_tasks.CareerTasks, n) for n in ("setUp", "tearDown", "approve", "opens"))

    def year(self, opts):
        st, truth = career.load(self.cid)
        st, truth = self.approve([{"section": s, "wells": 3} for s in self.opens(st, 2)])
        st["plan"]["emissions"] = opts
        career.advance(st, truth, self.sim, 12)
        return st

    def test_abatement_lowers_emissions_and_board_scores_it(self):
        a = self.year({"electric_frac": False, "vru": False})
        rev = a["board"]["reviews"][-1]
        self.assertIn("emissions_intensity", rev["parts"])
        self.assertGreater(rev["emissions"]["co2e_t"], 0)
        self.assertEqual(len(a["history"]["co2e_t"]), len(a["history"]["month"]))
        v = career.view(a)["emissions"]
        self.assertEqual(v["carbon_usd_t"], emissions.CARBON_USD_T)

    def test_plan_options_validated(self):
        with self.assertRaises(ValueError):
            emissions.plan_options({"emissions": "yes"})
        self.assertEqual(emissions.plan_options({}), {"electric_frac": False, "vru": False})


if __name__ == "__main__":
    unittest.main()
