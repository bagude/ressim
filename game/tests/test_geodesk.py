"""The geology desk (no Julia): legacy verticals and horizontals with logs from the hidden rock, auto-picks, saved
interpretations, and type curves normalised to them."""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import career  # noqa: E402
import geodesk  # noqa: E402
import test_career_tasks  # noqa: E402


class Desk(unittest.TestCase):
    setUp, tearDown, approve, opens = (getattr(test_career_tasks.CareerTasks, n) for n in ("setUp", "tearDown", "approve", "opens"))

    def test_wells_logs_by_vintage_and_no_truth(self):
        st, truth = career.load(self.cid)
        ws = geodesk.wells(st, truth)
        self.assertEqual(ws, geodesk.wells(st, truth))                                     # deterministic
        vs = [w for w in ws if w["type"] == "vertical"]
        hs = [w for w in ws if w["type"] == "horizontal"]
        self.assertTrue(15 * 0.8 <= len(vs) <= 40)
        self.assertEqual(len(hs), len(truth["analogs"]))
        for w in vs:
            if w["log"] is None:
                self.assertIn("tops", w)
                continue
            self.assertEqual(set(w["log"]) - {"md_ft", "tvd_ft"}, set(w["curves"]) | set(w["derived_curves"]))   # missing curves are absent
            if "rhob" in w["curves"] or "dt" in w["curves"]:
                self.assertIn("phi", w["derived_curves"])
            if w["vintage"] == "pre-1970":
                self.assertNotIn("gr", w["curves"])
        for w in hs:
            self.assertEqual(set(w["log"]), {"md_ft", "tvd_ft", "gr"})
        # auto-picks recover thickness on verticals with a gamma ray and no depth shift
        errs = [abs(w["picks_auto"]["base_tvd"] - w["picks_auto"]["top_tvd"] - geodesk._rock(truth, w["section"])["thickness_ft"])
                for w in vs if w["log"] and "gr" in w["curves"] and w["picks_auto"]]
        self.assertTrue(errs)
        self.assertLess(sum(errs) / len(errs), 8.0)
        blob = json.dumps(ws)
        for secret in ("perm_md", "\"porosity\"", "well_factor", "depth_shift", "gr_scale", "tops_only"):
            self.assertNotIn(secret, blob)

    def test_proximity_auto_forecast_picks_nearest(self):
        st, truth = career.load(self.cid)
        sec = self.opens(st, 1)[0]
        near = career.proximity_analogs(st, truth, self.sim, {"pad": sec, "n": 5, "radius_ft": 50000})
        self.assertEqual(len(near), 5)
        self.assertEqual([c["distance_ft"] for c in near], sorted(c["distance_ft"] for c in near))
        tc, al = career.build_typecurve(st, truth, self.sim, [c["id"] for c in near])
        self.assertTrue(tc["fits"]["p50"])
        with self.assertRaises(career.CareerError):
            career.proximity_analogs(st, truth, self.sim, {"pad": sec, "radius_ft": 10})

    def test_auto_map_save_and_normalise(self):
        st, truth = career.load(self.cid)
        auto = geodesk.auto_geomodel(st, truth)
        self.assertTrue(all("gross_ft" in v for v in auto["sections"].values()))
        # the auto map's thickness tracks the truth
        err = [abs(v["gross_ft"] - geodesk._rock(truth, s)["thickness_ft"]) / geodesk._rock(truth, s)["thickness_ft"] for s, v in auto["sections"].items()]
        self.assertLess(sum(err) / len(err), 0.25)
        gm = geodesk.check_geomodel(st, {"name": "mine", "sections": {s: {k: v[k] for k in v} for s, v in auto["sections"].items()}})
        with self.assertRaises(ValueError):
            geodesk.check_geomodel(st, {"name": "bad", "sections": {"Z9": {"hcpv": 1}}})
        with self.assertRaises(ValueError):
            geodesk.check_geomodel(st, {"name": "company map", "sections": {"A1": {"hcpv": 1}}})
        ids = [a["id"] for a in career.analog_list(st, truth, self.sim) if a["history_months"] >= 6]
        tc, al = career.build_typecurve(st, truth, self.sim, ids)
        g = career.geology_fit(st, al, {"geomodel": "mine", "attribute": "gross_ft"})
        career.save_typecurve(st, "geo", ids, tc, geology=g)
        if g["exponent"]:
            sec = self.opens(st, 1)[0]
            want = max(0.25, min(4.0, (gm["sections"][sec]["gross_ft"] / g["ref_value"]) ** g["exponent"]))
            self.assertAlmostEqual(career.geo_factor(st, st["typecurves"]["geo"], sec), want)
        with self.assertRaises(career.CareerError):
            career.geology_fit(st, al, {"geomodel": "nope", "attribute": "hcpv"})


if __name__ == "__main__":
    unittest.main()
