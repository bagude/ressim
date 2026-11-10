"""What the career shows about its stakes (no Julia): year-end projection, pad report cards, staff baselines on tasks,
frac hits under standard practice, and Continue running until something needs the player."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import career  # noqa: E402
import career_tasks  # noqa: E402
from minigames import base  # noqa: E402
import test_career_tasks  # noqa: E402


class Stakes(unittest.TestCase):
    setUp, tearDown, approve, opens = (getattr(test_career_tasks.CareerTasks, n) for n in ("setUp", "tearDown", "approve", "opens"))   # fixture only

    def test_projection_matches_year_review_formula(self):
        st, truth = career.load(self.cid)
        st, truth = self.approve([{"section": s, "wells": 3} for s in self.opens(st, 2)])
        self.assertIsNone(career.view(st)["projection"])            # nothing produced this year yet
        career.advance(st, truth, self.sim, 6)
        v = career.view(st)
        p = v["projection"]
        self.assertEqual(v["sack_below"], career.SACK_BELOW)
        self.assertEqual(p["months_done"], 6)
        r, c, parts = career.review_parts(p["oil_pace_bbl"], p["guidance_bbl"], p["capex_projected_usd"], p["approved_usd"])
        self.assertAlmostEqual(p["confidence_change"], sum(parts.values()))
        self.assertAlmostEqual(p["confidence_after"], max(0, min(100, st["board"]["confidence"] + sum(parts.values()))))

    def test_pad_report_card_after_three_months(self):
        st, truth = career.load(self.cid)
        st, truth = self.approve([{"section": s, "wells": 2} for s in self.opens(st, 1)])
        career.advance(st, truth, self.sim, 12)
        cards = [m for m in st["inbox"] if (m.get("data") or {}).get("kind") == "pad_report"]
        self.assertEqual(len(cards), 1)
        d = cards[0]["data"]
        self.assertGreater(d["actual_oil_bbl"], 0)
        self.assertGreater(d["forecast_oil_bbl"], 0)
        self.assertAlmostEqual(d["split"]["type_curve_vs_rock_bbl"] + d["split"]["execution_bbl"], d["gap_bbl"], delta=2)
        self.assertNotIn("perm_md", str(d))

    def test_diagnostics_per_well(self):
        st, truth = career.load(self.cid)
        st, truth = self.approve([{"section": s, "wells": 3} for s in self.opens(st, 2)])
        career.advance(st, truth, self.sim, 12)
        d = career.diagnostics(st, truth, self.sim)
        self.assertTrue(d["wells"])
        for r in d["wells"]:
            self.assertEqual(len(r["monthly"]["actual_oil_bbl"]), r["months"])
            self.assertEqual(len(r["monthly"]["forecast_oil_bbl"]), r["months"])
            self.assertAlmostEqual(r["split"]["type_curve_vs_rock_bbl"] + r["split"]["execution_bbl"],
                                   r["actual_oil_bbl"] - r["forecast_oil_bbl"], delta=3)
        w = next(w for w in st["wells"] if w.get("cum_oil"))
        self.assertAlmostEqual(sum(w["oil_hist"]["oil"]), w["cum_oil"], delta=1)
        self.assertIn(d["summary"]["bigger_gap"], ("type curve", "execution"))
        self.assertTrue(d["notes"])

    def test_staff_outcome_on_every_task(self):
        st, truth = career.load(self.cid)
        st, truth = self.approve([{"section": s, "wells": 3} for s in self.opens(st, 2)])
        tasks = career.view(st)["tasks"]
        self.assertTrue(tasks)
        for t in tasks:
            self.assertTrue(t["staff_outcome"]["headline"], t["kind"])
            self.assertNotIn("warned", t)

    def test_until_event_stops_before_lapse_then_lets_it_lapse(self):
        st, truth = career.load(self.cid)
        st, truth = self.approve([{"section": s, "wells": 3} for s in self.opens(st, 2)])
        stops = []
        for _ in range(40):
            if st["month"] >= 12:
                break
            r = career.advance(st, truth, self.sim, 12, until_event=True)
            stops.append(r["stop"]["reason"] if r["stop"] else None)
            if r["stop"] and r["stop"]["reason"] == "budget_needed":
                break
        self.assertIn("task_due", stops)
        self.assertIn("pad_online", stops)
        due = [t for t in st["tasks"] if t.get("warned")]
        self.assertTrue(due and all(t["status"] == "lapsed" for t in due))     # the second Continue let them lapse
        r = career.advance(st, truth, self.sim, 12, until_event=True)          # year end: a hard stop, not an error
        self.assertEqual(r["stop"]["reason"], "budget_needed")
        self.assertEqual(r["months"], [])

    def test_frac_hits_staff_take_standard_practice_damage(self):
        st, truth = career.load(self.cid)
        st, truth = self.approve([{"section": s, "wells": 3} for s in self.opens(st, 6)])
        for _ in range(12):
            if any(t["kind"] == "frac-hits" for t in st["tasks"]):
                break
            career.advance(st, truth, self.sim, 1)
        t = next((t for t in st["tasks"] if t["kind"] == "frac-hits"), None)
        self.assertIsNotNone(t, "no frac-hit task in this seed")
        mg = base.load("frac-hits", t["session"])
        _, rows = career_tasks.frac_hits_standard(mg)
        career_tasks.delegate(st, t["id"], truth)
        expected = sum(1 for r in rows if r["loss_share"] > 0)
        got = sum(1 for w in st["wells"] + truth["analogs"] for m in w.get("multipliers", []) if m["why"] == "frac hit (standard practice)")
        self.assertEqual(got, expected)
        self.assertIn("staff_result", t)


if __name__ == "__main__":
    unittest.main()
