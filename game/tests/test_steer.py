"""Geosteering tests (no Julia). Run: python -m unittest discover game/tests"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import career  # noqa: E402
import steer  # noqa: E402
import steerapi  # noqa: E402
from test_career import FakeSim  # noqa: E402


class Steer(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = steer.STEER, career.CAREERS
        steer.STEER = Path(self.tmp.name) / "steer"
        career.CAREERS = Path(self.tmp.name) / "careers"

    def tearDown(self):
        steer.STEER, career.CAREERS = self.old
        self.tmp.cleanup()

    def test_typelog_barriers_are_hot(self):
        s = steer.new_session(seed=1)
        T = s["truth"]["pay_ft"]
        tl = s["typelog"]
        pay = [g for x, g in zip(tl["s_ft"], tl["gamma_api"]) if abs(x) < T / 2 - 2]
        bar = [g for x, g in zip(tl["s_ft"], tl["gamma_api"]) if abs(x) > T / 2 + 6]
        self.assertGreater(sum(bar) / len(bar), sum(pay) / len(pay) + 40)

    def test_dogleg_cap(self):
        s = steer.new_session(seed=2)
        inc0 = steer.bit(s)["inc"]
        steer.drill(s, inc0 + 30)
        self.assertLessEqual(steer.bit(s)["inc"] - inc0, steer.DLS_MAX * steer.INTERVAL / 100 + 1.0)

    def test_better_steerer_stays_in_zone(self):
        good, bad = [], []
        for seed in range(6):
            a = steer.new_session(seed=seed)
            steer.auto_steer(a, 1.0)
            good.append(steer.in_zone_pct(a))
            b = steer.new_session(seed=seed)
            steer.auto_steer(b, 0.0)
            bad.append(steer.in_zone_pct(b))
        self.assertGreater(sum(good) / 6, sum(bad) / 6 + 10, (good, bad))
        self.assertGreater(sum(good) / 6, 85, good)

    def test_true_interpretation_matches_log(self):
        s = steer.new_session(seed=4)
        steer.auto_steer(s, 0.8)
        st = s["truth"]
        interp = [{"md": sg["md"], "dip_deg": sg["dip_deg"]} for sg in st["segments"]]
        if st["fault"]:
            interp.append({"md": st["fault"]["md"], "dip_deg": steer.dip_at(st, st["fault"]["md"]), "throw_ft": st["fault"]["throw_ft"]})
        pv = steer.preview(s, interp)
        err = sum(abs(a["gamma_api"] - b["gamma_api"]) for a, b in zip(pv["synthetic"], s["gamma"])) / len(s["gamma"])
        wrong = steer.preview(s, [{"md": 0, "dip_deg": steer.dip_at(st, 0) + 3.0}])
        err_wrong = sum(abs(a["gamma_api"] - b["gamma_api"]) for a, b in zip(wrong["synthetic"], s["gamma"])) / len(s["gamma"])
        self.assertLess(err, 8.0)
        self.assertLess(err, err_wrong)

    def test_view_hides_structure_until_finished(self):
        s = steer.new_session(seed=5)
        v = steer.view(s)
        self.assertNotIn("lookback", v)
        self.assertNotIn("segments", str(v))
        self.assertNotIn("truth", v)

    def test_barrier_stages_choke(self):
        s = steer.new_session(seed=6)
        while steer.bit(s)["md"] < s["truth"]["lateral_ft"]:
            steer.drill(s, 80.0)                      # steer hard up, out of the pay
        st = steer.landing(s, 250.0)
        self.assertTrue(any(x["into_barrier_ft"] > 0 for x in st))
        self.assertTrue(all(x["connection_multiple"] < 30 for x in st if x["bucket_ft"] > 0))

    def test_sidetrack(self):
        s = steer.new_session(seed=7)
        for _ in range(4):
            steer.drill(s, steer.bit(s)["inc"])
        days = s["days"]
        steer.sidetrack(s, 600.0)
        self.assertAlmostEqual(steer.bit(s)["md"], 600.0, places=3)
        self.assertGreater(s["days"], days)

    def test_career_staff_and_manual_steering(self):
        sim = FakeSim()
        cid = career.new("G", sim, seed=11, background=False)
        st, truth = career.load(cid)
        ids = [a["id"] for a in career.analog_list(st, truth, sim) if a["history_months"] >= 6]
        tc, _ = career.build_typecurve(st, truth, sim, ids)
        career.save_typecurve(st, "base", ids, tc)
        opens = [x for x in st["sections"] if not x["developed"]][:2]
        raw = {"design": {"stage_spacing_ft": 200.0, "half_length_ft": 300.0, "conductivity_mdft": 50.0, "bhp_psi": 1500.0},
               "typecurve": "base", "percentile": "p50", "rigs": 1, "crews": 1, "budget_request": {},
               "pads": [{"section": x["section"], "wells": 3, "steer": "manual" if i == 0 else "staff"} for i, x in enumerate(opens)]}
        plan = career.check_plan(st, raw)
        row = career.evaluate_plan(st, truth, sim, plan)["budget_by_year"][0]
        raw["budget_request"] = {"0": row["board_limit_usd"]}
        plan = career.check_plan(st, raw)
        self.assertTrue(career.budget_meeting(st, truth, sim, plan)["approved"])
        career.advance(st, truth, sim, 1)                 # the manual pad locks; its first spud is about day 30.4
        career.save(st)
        self.assertEqual(len(career.view(st)["steer_pending"]), 3)
        with self.assertRaises(career.CareerError):
            career.advance(st, truth, sim, 1)
        for w in st["wells"]:
            sid = w["steer"]["session"]
            s = steer.load(sid)
            steer.auto_steer(s, 0.9)
            steer.save(s)
            code, body = steerapi.handle("POST", "/api/steer/finish", {}, {"id": sid}, None)
            self.assertEqual(code, 200, body)
            self.assertIn("lookback", body["session"])
        st, truth = career.load(cid)
        self.assertEqual(career.view(st)["steer_pending"], [])
        career.advance(st, truth, sim, 6)
        staff = [w for w in st["wells"] if w["steer"]["mode"] == "staff"]
        self.assertTrue(staff and all(w["steer"]["finished"] and "in_zone_pct" in w["steer"] for w in staff))


if __name__ == "__main__":
    unittest.main()
