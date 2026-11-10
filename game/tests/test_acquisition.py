"""Acquisition (no Julia): the yearly package, the data room has no hidden rock, a winning bid merges the field."""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import career  # noqa: E402
import mgapi  # noqa: E402
import test_career_tasks  # noqa: E402


class Acquisition(unittest.TestCase):
    setUp, tearDown, approve, opens = (getattr(test_career_tasks.CareerTasks, n) for n in ("setUp", "tearDown", "approve", "opens"))

    def test_bid_wins_and_merges(self):
        st, truth = career.load(self.cid)
        st, truth = self.approve([{"section": s, "wells": 3} for s in self.opens(st, 1)])
        career.save(st, truth)
        t = next(t for t in st["tasks"] if t["kind"] == "acquisition")
        code, body = mgapi.handle("GET", "/api/mg/acquisition", {"id": [t["session"]]}, {}, None)
        self.assertEqual(code, 200)
        blob = json.dumps(body)
        for secret in ("perm_md", "true_value", "rival_bids", "well_factor"):
            self.assertNotIn(secret, blob)
        v = body["session"]["view"]
        self.assertTrue(v["data_room"])
        self.assertGreater(v["seller_case"]["asking_usd"], 0)
        n_sec, n_an = len(st["sections"]), len(truth["analogs"])
        cap = v["max_affordable_usd"]
        self.assertGreater(cap, 0)
        code, body = mgapi.handle("POST", "/api/mg/acquisition/act", {}, {"id": t["session"], "action": "bid", "bid_mm": cap / 1e6 + 1}, None)
        self.assertEqual(code, 400)                                  # more than the company can finance
        code, body = mgapi.handle("POST", "/api/mg/acquisition/act", {}, {"id": t["session"], "action": "bid", "bid_mm": cap / 1e6 - 0.01}, None)
        self.assertEqual(code, 200, body)
        st, truth = career.load(self.cid)
        if not body["session"]["result"]["breakdown"]["won"]:         # a rival outbid what we can finance in this seed
            self.assertEqual(len(st["sections"]), n_sec)
            return
        self.assertEqual(len(st["sections"]), n_sec + 3)
        self.assertGreater(len(truth["analogs"]), n_an)
        self.assertTrue(any(c["label"] == "acquisition" for c in st["costs_pending"]))
        career.advance(st, truth, self.sim, 1)                     # the new wells produce
        self.assertTrue(any(a["section"].startswith(chr(65 + 3)) for a in career.analog_list(st, truth, self.sim)))


    def test_merge_package_directly(self):
        import career_tasks
        st, truth = career.load(self.cid)
        pkg = career_tasks.build_package(st, truth)
        n_sec, n_an = len(st["sections"]), len(truth["analogs"])
        added = career_tasks.merge_package(st, truth, pkg)
        self.assertEqual(len(added), 3)
        self.assertEqual(len(st["sections"]), n_sec + 3)
        self.assertEqual(len(truth["analogs"]), n_an + len(pkg["wells"]))
        self.assertTrue(all(a["online_month"] < st["month"] for a in truth["analogs"][n_an:]))


if __name__ == "__main__":
    unittest.main()
