"""The staff benchmark (no Julia): an autopilot career on the same field, in memory, with no files besides its result."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import benchmark  # noqa: E402
import career  # noqa: E402
import steer  # noqa: E402
import test_career_tasks  # noqa: E402
from minigames import base  # noqa: E402


class Benchmark(unittest.TestCase):
    setUp, tearDown, approve, opens = (getattr(test_career_tasks.CareerTasks, n) for n in ("setUp", "tearDown", "approve", "opens"))

    def files(self):
        return sorted(str(p) for d in (steer.STEER, base.MG) if d.exists() for p in d.rglob("*") if p.is_file())

    def test_staff_career_runs_to_the_end_in_memory(self):
        before = self.files()
        b = benchmark.compute(self.cid, self.sim)
        self.assertEqual(self.files(), before)                       # no steering or minigame sessions written
        self.assertTrue(benchmark.path(self.cid).exists())
        self.assertIn(b["status"], ("finished", "sacked"))
        self.assertGreater(b["wells"], 0)
        self.assertTrue(b["by_year"])
        self.assertAlmostEqual(b["value_usd"], b["realised_pv10_usd"] + b["remaining_pv10_usd"])
        st, _ = career.load(self.cid)
        self.assertEqual(st["month"], 0)                             # the player's career is untouched
        v = career.view(st)
        self.assertEqual(v["benchmark"]["status"], "ready")                  # no foresight while playing
        self.assertEqual(v["benchmark"]["reviews_so_far"], [])               # the player has no review yet
        self.assertNotIn("value_usd", v["benchmark"])
        st["status"] = "finished"
        self.assertEqual(career.view(st)["benchmark"]["value_usd"], b["value_usd"])

    def test_deterministic(self):
        a = benchmark.compute(self.cid, self.sim)
        b = benchmark.compute(self.cid, self.sim)
        self.assertAlmostEqual(a["value_usd"], b["value_usd"], places=0)

    def test_grade_and_sacked_score(self):
        self.assertEqual(benchmark.grade(130e6, 100e6)["grade"], "A")
        self.assertEqual(benchmark.grade(90e6, 100e6)["grade"], "C")
        self.assertEqual(benchmark.grade(-10e6, -5e6)["grade"], "D")     # losing twice what staff lose
        st, truth = career.load(self.cid)
        st, truth = self.approve([{"section": s, "wells": 3} for s in self.opens(st, 2)])
        st["board"]["confidence"] = career.SACK_BELOW - 1
        career.advance(st, truth, self.sim, 1)
        self.assertEqual(st["status"], "sacked")
        self.assertIsNotNone(st["score"])
        self.assertEqual(st["score"]["status"], "sacked")


if __name__ == "__main__":
    unittest.main()
