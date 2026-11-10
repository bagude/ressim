"""Minigames inside career mode (no Julia): task creation, blocking, delegation, and each result's effect on the career."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import career  # noqa: E402
import career_tasks  # noqa: E402
import mgapi  # noqa: E402
import steer  # noqa: E402
from minigames import base  # noqa: E402
from test_career import FakeSim  # noqa: E402


class CareerTasks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = Path(self.tmp.name)
        self.old = (career.CAREERS, steer.STEER, base.MG, career_tasks.KICK_PROBABILITY)
        career.CAREERS, steer.STEER, base.MG = t / "careers", t / "steer", t / "mg"
        career_tasks.KICK_PROBABILITY = 0.0
        self.sim = FakeSim()
        self.cid = career.new("T", self.sim, seed=21, background=False)
        st, truth = career.load(self.cid)
        ids = [a["id"] for a in career.analog_list(st, truth, self.sim) if a["history_months"] >= 6]
        tc, _ = career.build_typecurve(st, truth, self.sim, ids)
        career.save_typecurve(st, "base", ids, tc)
        career.save(st, truth)

    def tearDown(self):
        career.CAREERS, steer.STEER, base.MG, career_tasks.KICK_PROBABILITY = self.old
        self.tmp.cleanup()

    def approve(self, pads):
        st, truth = career.load(self.cid)
        raw = {"design": {"stage_spacing_ft": 200.0, "half_length_ft": 300.0, "conductivity_mdft": 50.0, "bhp_psi": 1500.0},
               "typecurve": "base", "percentile": "p50", "rigs": 1, "crews": 1, "budget_request": {}, "pads": pads}
        row = career.evaluate_plan(st, truth, self.sim, career.check_plan(st, raw))["budget_by_year"][0]
        raw["budget_request"] = {"0": row["board_limit_usd"]}
        d = career.budget_meeting(st, truth, self.sim, career.check_plan(st, raw))
        self.assertTrue(d["approved"], d)
        return st, truth

    def opens(self, st, n):
        return [s["section"] for s in st["sections"] if not s["developed"]][:n]

    def test_yearly_optional_tasks_created_and_lapse(self):
        st, truth = career.load(self.cid)
        st, truth = self.approve([{"section": s, "wells": 3} for s in self.opens(st, 2)])
        kinds = {t["kind"] for t in st["tasks"]}
        self.assertIn("hedging", kinds)
        self.assertIn("rig-contracts", kinds)
        self.assertTrue(all(not t["blocking"] for t in st["tasks"]))
        career.advance(st, truth, self.sim, 12)                      # optional tasks never block
        self.assertTrue(all(t["status"] in ("lapsed", "open") for t in st["tasks"] if t["kind"] == "hedging"))
        self.assertTrue(any(t["status"] == "lapsed" for t in st["tasks"]))

    def test_manual_completion_blocks_until_done_or_delegated(self):
        st, truth = career.load(self.cid)
        st, truth = self.approve([{"section": s, "wells": 3, "completion": "manual", "flowback": "manual"} for s in self.opens(st, 1)])
        career.advance(st, truth, self.sim, 1)
        kinds = [t["kind"] for t in st["tasks"] if t["blocking"]]
        self.assertIn("pump-job", kinds)
        self.assertIn("flowback", kinds)
        with self.assertRaises(career.CareerError):
            career.advance(st, truth, self.sim, 6)       # stops at the first blocking task's due point
        stopped = st["month"]
        self.assertLess(stopped, 7)
        for t in [t for t in st["tasks"] if t["blocking"] and t["status"] == "open"]:
            career_tasks.delegate(st, t["id"])
        career.advance(st, truth, self.sim, 3)
        self.assertEqual(st["month"], stopped + 3)

    def test_pump_job_result_changes_the_pad_wells(self):
        st, truth = career.load(self.cid)
        st, truth = self.approve([{"section": s, "wells": 3, "completion": "manual"} for s in self.opens(st, 1)])
        career.advance(st, truth, self.sim, 1)
        t = next(t for t in st["tasks"] if t["kind"] == "pump-job")
        mg = base.load("pump-job", t["session"])
        mg["status"] = "finished"
        mg["growth"] = {"runaway": False, "propped": {"half_length_ft": 410.0, "conductivity_mdft": [7.5, 5.0]}}
        mg["standard_propped"] = {"half_length_ft": 205.0, "conductivity_mdft": 3.75}   # you doubled the standard job
        mg["result"] = {"headline": "test", "score": 1.0}
        career_tasks.apply(st, truth, mg)
        pad = t["link"]["pad"]
        for w in [w for w in st["wells"] if w["pad"] == pad]:
            self.assertEqual(w["design"]["half_length_ft"], 600.0)          # plan 300 ft x 2
            self.assertEqual(w["design"]["conductivity_mdft"], 100.0)       # plan 50 md-ft x 2
        self.assertEqual(t["status"], "done")

    def test_hedge_book_settles_against_career_prices(self):
        st, truth = career.load(self.cid)
        st, truth = self.approve([{"section": s, "wells": 3} for s in self.opens(st, 1)])
        career.save(st, truth)
        t = next(t for t in st["tasks"] if t["kind"] == "hedging")
        code, body = mgapi.handle("POST", "/api/mg/hedging/act", {}, {"id": t["session"], "action": "swap", "share_pct": 50, "quarters": 4}, None)
        self.assertEqual(code, 200, body)
        self.assertNotIn("price", str(body["session"]["view"].get("history")))
        code, body = mgapi.handle("POST", "/api/mg/hedging/act", {}, {"id": t["session"], "action": "commit"}, None)
        self.assertEqual(code, 200, body)
        st, truth = career.load(self.cid)
        self.assertEqual(len(st["hedge_books"]), 1)
        career.advance(st, truth, self.sim, 6)
        h = st["history"]
        self.assertEqual(len(h["hedge_usd"]), 6)
        swap = st["hedge_books"][0]["book"][0]["price"]
        for wti, hg in zip(h["wti_usd_bbl"], h["hedge_usd"]):
            self.assertTrue(hg == 0 or (hg > 0) == (wti < swap))       # swaps pay when price falls below the swap

    def test_kick_task_and_cost(self):
        career_tasks.KICK_PROBABILITY = 1.0
        st, truth = career.load(self.cid)
        st, truth = self.approve([{"section": s, "wells": 2} for s in self.opens(st, 1)])
        career.advance(st, truth, self.sim, 1)
        kicks = [t for t in st["tasks"] if t["kind"] == "well-control"]
        self.assertEqual(len(kicks), 2)
        before = sum(c["usd"] for c in st.get("costs_pending", []))
        career_tasks.delegate(st, kicks[0]["id"])
        self.assertGreater(sum(c["usd"] for c in st["costs_pending"]), before)

    def test_land_auction_adds_sections(self):
        st, truth = career.load(self.cid)
        n0 = len(st["sections"])
        mg = {"kind": "land-auction", "id": "x" * 12, "link": {"career": self.cid, "task": "t999"},
              "tracts": [{"id": "T1", "winner": "You"}], "result": {"lookback": {"T1": {"true_eur_boe": 500000}}}}
        st.setdefault("tasks", []).append({"id": "t999", "kind": "land-auction", "label": "x", "link": {"year": 1}, "session": "x" * 12,
                                           "blocking": False, "due_day": 9999.0, "due_month": 1.0, "created_month": 0, "status": "open"})
        career_tasks.apply(st, truth, mg)
        self.assertEqual(len(st["sections"]), n0 + 1)
        new = st["sections"][-1]["section"]
        self.assertTrue(any(r["section"] == new for r in truth["rock"]))
        self.assertNotIn("perm_md", str(career.view(st)["sections"]))


if __name__ == "__main__":
    unittest.main()
