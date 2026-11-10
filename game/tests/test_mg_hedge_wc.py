"""Tests for the hedging and well-control minigames (no simulator). Run: python -m unittest discover game/tests"""
import json
import statistics
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import mgapi  # noqa: E402
from minigames import base  # noqa: E402
from minigames import hedging as hg  # noqa: E402
from minigames import well_control as wc  # noqa: E402

HEDGE = base.REGISTRY["hedging"]
WELL = base.REGISTRY["well-control"]


def fresh(game, seed):
    st = base.new_state(game.kind, {"seed": seed})
    game.new(st, {"seed": seed}, None)
    return st


def act(game, st, action, **args):
    """Apply an action the way mgapi does, refusing actions the view does not offer."""
    legal = {a["name"] for a in game.view(st)["actions"]}
    if action not in legal:
        raise AssertionError(f"{action} not legal; legal: {sorted(legal)}")
    ev = game.act(st, action, args, None)
    st["turn"] += 1
    return ev


def play_hedge(seed, programme):
    """programme: None (no hedging), 'swap' or 'collar'. 60 % in the first quarter, then 20 % layers each quarter."""
    st = fresh(HEDGE, seed)
    while st["status"] == "active":
        share = 60 if st["quarter"] == 0 else 20
        names = {a["name"] for a in HEDGE.view(st)["actions"]}
        if programme == "swap" and "swap" in names:
            act(HEDGE, st, "swap", share_pct=share, quarters=4)
        elif programme == "collar" and "collar" in names:
            s = st["spot"]
            act(HEDGE, st, "collar", share_pct=share, quarters=4, put_strike=round(0.9 * s, 2),
                call_strike=round(1.15 * s, 2))
        act(HEDGE, st, "advance")
    return st


def play_well(seed, kmw_error=0.0):
    """Shut in on the first sign of the kick, answer with the textbook formulas and hold the kill-sheet line."""
    st = fresh(WELL, seed)
    while st["truth"]["kick_turns"] == 0:
        act(WELL, st, "drill")
    act(WELL, st, "shut_in")
    v = WELL.view(st)["view"]
    w, s = v["well"], v["shut_in"]
    kmw = wc.kill_mud_weight(w["mw_ppg"], s["sidpp_psi"], s["tvd_ft"]) + kmw_error
    g = wc.influx_gradient(w["mw_ppg"], s["sidpp_psi"], s["sicp_psi"], wc.influx_height(s["pit_gain_bbl"]))
    act(WELL, st, "kill_mud", kmw_ppg=kmw, maasp_psi=wc.maasp(w["shoe_fracture_emw_ppg"], w["mw_ppg"], w["shoe_tvd_ft"]),
        influx=wc.classify(g))
    act(WELL, st, "kill_sheet", icp_psi=wc.icp(w["scr_psi"], s["sidpp_psi"]), fcp_psi=wc.fcp(w["scr_psi"], kmw, w["mw_ppg"]))
    while st["status"] == "active":
        v = WELL.view(st)["view"]
        nxt = next(r for r in v["schedule"] if r["strokes"] == v["next_strokes"])
        act(WELL, st, "pump", dpp_psi=nxt["dpp_psi"])
    return st


class StorageMixin:
    def setUp(self):
        self._mg = base.MG
        self._tmp = tempfile.TemporaryDirectory()
        base.MG = Path(self._tmp.name)

    def tearDown(self):
        base.MG = self._mg
        self._tmp.cleanup()


class Formulas(unittest.TestCase):
    def test_hand_worked_kill_sheet(self):
        kmw = wc.kill_mud_weight(10.0, 520.0, 10_000.0)
        self.assertAlmostEqual(kmw, 11.0)
        self.assertAlmostEqual(wc.icp(600.0, 520.0), 1120.0)
        self.assertAlmostEqual(wc.fcp(600.0, kmw, 10.0), 660.0)

    def test_required_dpp_runs_from_icp_to_fcp(self):
        kmw = wc.kill_mud_weight(10.0, 520.0, 10_000.0)
        self.assertAlmostEqual(wc.required_dpp(0.0, 520.0, 600.0, 10.0, kmw, 10_000.0), 1120.0)
        self.assertAlmostEqual(wc.required_dpp(1.0, 520.0, 600.0, 10.0, kmw, 10_000.0), 660.0)
        self.assertAlmostEqual(wc.required_dpp(0.5, 520.0, 600.0, 10.0, kmw, 10_000.0), 890.0)

    def test_maasp_and_influx(self):
        self.assertAlmostEqual(wc.maasp(14.0, 10.0, 5000.0), 1040.0)
        # 10 bbl: 600 ft x 0.0291 = 17.46 bbl around the collars, so all of it sits there
        self.assertAlmostEqual(wc.influx_height(10.0), 10.0 / 0.0291)
        self.assertAlmostEqual(wc.influx_height(17.46 + 4.59), 600.0 + 100.0)
        # SICP - SIDPP = 140 psi over 400 ft with 10 ppg mud (0.52 psi/ft): 0.52 - 0.35 = 0.17 psi/ft -> gas
        g = wc.influx_gradient(10.0, 500.0, 640.0, 400.0)
        self.assertAlmostEqual(g, 0.17)
        self.assertEqual(wc.classify(g), "gas")
        self.assertEqual(wc.classify(0.33), "oil")
        self.assertEqual(wc.classify(0.45), "water")

    def test_black76_put_call_parity(self):
        c = hg.black76(70.0, 65.0, 0.5, 0.35, put=False)
        p = hg.black76(70.0, 65.0, 0.5, 0.35, put=True)
        self.assertAlmostEqual(c - p, 70.0 - 65.0)
        self.assertGreater(hg.premium(70.0, 65.0, 0.5, True, True), p)     # dealer markup
        self.assertLess(hg.premium(70.0, 75.0, 0.5, False, False), hg.black76(70.0, 75.0, 0.5, 0.35, put=False))

    def test_swap_settlement_and_over_hedging(self):
        book = [{"type": "swap", "first_month": 0, "bbl": [1000.0], "price": 70.0}]
        self.assertAlmostEqual(hg.settle(book, 0, 80.0), -10_000.0)
        self.assertAlmostEqual(hg.settle(book, 0, 60.0), 10_000.0)
        self.assertEqual(hg.settle(book, 1, 60.0), 0.0)


class Determinism(unittest.TestCase):
    def test_hedging_seed_reproduces(self):
        a, b = play_hedge(7, "swap"), play_hedge(7, "swap")
        self.assertEqual(a["truth"], b["truth"])
        self.assertEqual(a["result"], b["result"])
        self.assertNotEqual(fresh(HEDGE, 8)["truth"]["price"], a["truth"]["price"])

    def test_well_control_seed_reproduces(self):
        a, b = play_well(7), play_well(7)
        self.assertEqual(a["result"], b["result"])
        self.assertEqual(a["readings"], b["readings"])


class HiddenTruth(unittest.TestCase):
    def test_hedging_view_hides_future_prices(self):
        st = fresh(HEDGE, 3)
        act(HEDGE, st, "advance")
        out = HEDGE.view(st)
        text = json.dumps(out)
        self.assertNotIn("truth", text)
        self.assertNotIn("surprise", text)
        for p in st["truth"]["price"][3:]:      # no future price appears anywhere
            self.assertNotIn(json.dumps(p), text)
        self.assertEqual([r["wti"] for r in out["view"]["history"]], st["truth"]["price"][:3])

    def test_well_view_hides_truth(self):
        st = fresh(WELL, 3)
        for _ in range(st["truth"]["kick_turn"] + 1):
            act(WELL, st, "drill")
        text = json.dumps(WELL.view(st))
        for k in ("truth", "kick_turn", "influx_rate", "influx_type", "influx_gradient", "sidpp", "kmw"):
            self.assertNotIn(k, text)
        act(WELL, st, "shut_in")
        text = json.dumps(WELL.view(st))
        self.assertIn("sidpp_psi", text)                    # observed once shut in
        for k in ("truth", "kick_turn", "influx_type", "influx_gradient", '"icp_psi"', '"fcp_psi"', "schedule"):
            self.assertNotIn(k, text)


class Api(StorageMixin, unittest.TestCase):
    def _new(self, kind):
        code, out = mgapi.handle("POST", f"/api/mg/{kind}/new", {}, {"params": {"seed": 1}}, None)
        self.assertEqual(code, 200, out)
        self.assertNotIn("truth", json.dumps(out))
        return out["session"]["id"]

    def _act(self, kind, sid, action, **args):
        return mgapi.handle("POST", f"/api/mg/{kind}/act", {}, dict(args, id=sid, action=action), None)

    def test_illegal_actions_refused(self):
        for kind in ("hedging", "well-control"):
            sid = self._new(kind)
            code, out = self._act(kind, sid, "x")
            self.assertEqual(code, 400)
            self.assertFalse(out["ok"])
        sid = self._new("well-control")
        code, _ = self._act("well-control", sid, "pump", dpp_psi=500)     # not before shut-in
        self.assertEqual(code, 400)
        sid = self._new("hedging")
        code, out = self._act("hedging", sid, "swap", share_pct=95)        # over the 80 % cap
        self.assertEqual(code, 400)
        self.assertIn("share_pct", out["errors"][0])
        code, out = self._act("hedging", sid, "put", share_pct=50, put_strike=200)
        self.assertEqual(code, 400)

    def test_full_hedging_playthrough_over_api(self):
        sid = self._new("hedging")
        code, out = self._act("hedging", sid, "collar", share_pct=50, quarters=4, put_strike=63, call_strike=80)
        self.assertEqual(code, 200, out)
        while out["session"]["status"] == "active":
            code, out = self._act("hedging", sid, "advance")
            self.assertEqual(code, 200, out)
        res = out["session"]["result"]
        self.assertIn(res["stars"], (0, 1, 2, 3))
        self.assertIn("wti_path_usd_bbl", res["lookback"])
        self.assertIn("unhedged_cash_usd", res["lookback"])
        code, out = self._act("hedging", sid, "advance")
        self.assertEqual(code, 400)                                       # finished

    def test_full_well_control_playthrough_over_api(self):
        sid = self._new("well-control")
        out = None
        for _ in range(3):
            code, out = self._act("well-control", sid, "drill")
            self.assertEqual(code, 200, out)
        code, out = self._act("well-control", sid, "shut_in")
        if out["session"]["view"]["phase"] == "drilling":                 # false alarm: drill once more
            self._act("well-control", sid, "drill")
            code, out = self._act("well-control", sid, "shut_in")
        v = out["session"]["view"]
        self.assertEqual(v["phase"], "shut_in")
        code, out = self._act("well-control", sid, "kill_mud", kmw_ppg=12.0, maasp_psi=1200, influx="gas")
        self.assertEqual(code, 200, out)
        code, out = self._act("well-control", sid, "kill_sheet", icp_psi=1000, fcp_psi=600)
        while out["session"]["status"] == "active":
            code, out = self._act("well-control", sid, "pump", dpp_psi=out["session"]["view"]["schedule"][0]["dpp_psi"])
            self.assertEqual(code, 200, out)
        self.assertIsNotNone(out["session"]["result"])
        self.assertIn("correct", out["session"]["result"]["lookback"])


class HedgingScoring(unittest.TestCase):
    def test_hedging_lowers_cash_flow_volatility(self):
        for programme in ("swap", "collar"):
            ratios = [play_hedge(seed, programme)["result"]["breakdown"]["sd_ratio"] for seed in range(40)]
            self.assertLess(statistics.mean(ratios), 0.85, programme)
            self.assertGreater(sum(r < 1.0 for r in ratios), 30, programme)

    def test_no_hedging_is_the_baseline(self):
        st = play_hedge(5, None)
        b = st["result"]["breakdown"]
        self.assertAlmostEqual(b["sd_ratio"], 1.0)
        self.assertAlmostEqual(b["cash_ratio"], 1.0)
        self.assertLessEqual(st["result"]["stars"], 2)

    def test_breach_is_zero_stars(self):
        for seed in range(60):
            st = play_hedge(seed, None)
            if st["result"]["breakdown"]["covenant_breach_quarter"] is not None:
                self.assertEqual(st["result"]["stars"], 0)
                return
        self.skipTest("no breach in these seeds")

    def test_cap_limits_coverage(self):
        st = fresh(HEDGE, 2)
        act(HEDGE, st, "swap", share_pct=60, quarters=4)
        act(HEDGE, st, "swap", share_pct=60, quarters=4)    # only 20 % more fits
        for row in HEDGE.view(st)["view"]["coverage"][:12]:
            self.assertLessEqual(row["hedge_ratio"], hg.HEDGE_CAP + 1e-6)


class WellControlScoring(unittest.TestCase):
    def test_correct_formulas_score_three_stars(self):
        for seed in range(10):
            st = play_well(seed)
            self.assertEqual(st["status"], "finished")
            self.assertEqual(st["result"]["stars"], 3, (seed, st["result"]))
            self.assertTrue(st["result"]["breakdown"]["well_dead"])

    def test_wrong_kmw_scores_less(self):
        for seed in range(10):
            good, bad = play_well(seed), play_well(seed, kmw_error=-0.5)
            self.assertLess(bad["result"]["stars"], good["result"]["stars"], seed)
            self.assertLess(bad["result"]["score"], good["result"]["score"], seed)
            self.assertEqual(bad["result"]["breakdown"]["points"]["kmw"], 0.0)

    def test_late_shut_in_scores_less(self):
        st = fresh(WELL, 4)
        while st["truth"]["kick_turns"] < 3 and st["status"] == "active":
            act(WELL, st, "drill")
        if st["status"] == "active":
            act(WELL, st, "shut_in")
            self.assertGreater(st["shut_in"]["pit_gain_bbl"], play_well(4)["shut_in"]["pit_gain_bbl"])


if __name__ == "__main__":
    unittest.main()
