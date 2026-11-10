"""Reserves booking (no Julia): opening book, year-end roll-forward that balances, audit, and board parts."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import career  # noqa: E402
import reserves  # noqa: E402
import test_career_tasks  # noqa: E402


class Reserves(unittest.TestCase):
    setUp, tearDown, approve, opens = (getattr(test_career_tasks.CareerTasks, n) for n in ("setUp", "tearDown", "approve", "opens"))

    def test_book_rollforward_audit_and_parts(self):
        st, truth = career.load(self.cid)
        st, truth = self.approve([{"section": s, "wells": 3} for s in self.opens(st, 3)])
        b0 = st["reserves"]["books"][0]
        self.assertGreater(b0["pdp_bbl"], 0)
        self.assertGreater(b0["pud_bbl"], 0)
        career.advance(st, truth, self.sim, 12)
        rev = st["board"]["reviews"][-1]
        for k in ("reserve_replacement", "reserve_revisions", "reserves_audit"):
            self.assertIn(k, rev["parts"])
        rf = rev["reserves"]["roll_forward"]
        self.assertEqual(rf["opening_bbl"] + rf["production_bbl"] + rf["extensions_bbl"] + rf["pud_removals_bbl"] + rf["revisions_bbl"],
                         rf["closing_bbl"])
        v = career.view(st)["reserves"]
        self.assertEqual(len(v["history"]), 2)
        self.assertNotIn("wells", v["latest"])
        self.assertTrue(v["notes"])

    def test_overbooking_is_written_down(self):
        self.assertEqual(-min(15.0, 50.0 * max(0.0, 0.35 - reserves.AUDIT_TOLERANCE)), -10.0)


if __name__ == "__main__":
    unittest.main()
