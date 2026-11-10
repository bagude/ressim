"""Land-auction and rig-contracts minigames: determinism, hidden truth, refused actions, full playthroughs, and that a sensible
strategy beats a silly one. No simulator needed (sim=False). Run: python -m unittest discover game/tests"""
import json
import math
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import mgapi  # noqa: E402
from minigames import base, land_auction, rig_contracts  # noqa: E402,F401


def new(kind, **params):
    code, out = mgapi.handle("POST", f"/api/mg/{kind}/new", {}, {"params": {"seed": 1, **params}}, None)
    assert code == 200, out
    return out["session"]


def act(kind, sid, action, **args):
    return mgapi.handle("POST", f"/api/mg/{kind}/act", {}, {"id": sid, "action": action, **args}, None)


def keys(obj):
    """Every dict key in a nested structure."""
    if isinstance(obj, dict):
        return set(obj) | set().union(*(keys(v) for v in obj.values()))
    if isinstance(obj, list):
        return set().union(*(keys(v) for v in obj)) if obj else set()
    return set()


def state(kind, sid):
    return base.load(kind, sid)


# ---- scripted players --------------------------------------------------------------------------------------------------
def auction_play(kind_seed, factor, appraise=False):
    """Bid factor x the P50 estimated value on every positive tract, scaled to fit the budget."""
    s = new("land-auction", seed=kind_seed)
    sid = s["id"]
    while s["status"] == "active":
        cur = [t for t in s["view"]["tracts"] if t["open"]]
        if appraise:
            for t in cur:
                if any(a["name"] == "appraise" and t["id"] in a["args"]["tract"]["options"] for a in s["actions"]):
                    code, out = act("land-auction", sid, "appraise", tract=t["id"])
                    assert code == 200, out
                    s = out["session"]
            cur = [t for t in s["view"]["tracts"] if t["open"]]
        bids = {f"bid_{t['slot']}": max(0.0, factor * t["estimate"]["value_p50_usd"]) / 1e6 for t in cur}
        cap = s["view"]["budget_usd"] / 1e6 * 0.999
        total = sum(bids.values())
        if total > cap:
            bids = {k: v * cap / total for k, v in bids.items()}
        code, out = act("land-auction", sid, "bid", **bids)
        assert code == 200, out
        s = out["session"]
    return s


def rig_play(seed, strategy, **params):
    s = new("rig-contracts", seed=seed, **params)
    sid = s["id"]
    while s["status"] == "active":
        for action, args in strategy(s["view"], len(s["view"]["fleet"])):
            code, out = act("rig-contracts", sid, action, **args)
            assert code == 200, out
        code, out = act("rig-contracts", sid, "next_month")
        assert code == 200, out
        s = out["session"]
    return s


def rig_play_direct(seed, strategy, **params):
    """Same as rig_play but straight on the Game object: no session files, so many seeds stay fast."""
    g = base.REGISTRY["rig-contracts"]
    params = {"seed": seed, **params}
    st = base.new_state("rig-contracts", params)
    g.new(st, params, None)
    while st["status"] == "active":
        v = g.view(st)["view"]
        for action, args in strategy(v, len(v["fleet"])):
            g.act(st, action, args, None)
        g.act(st, "next_month", {}, None)
    return st


def term_then_spot(v, fleet):
    """Lock 18-month rigs at the start to cover most of the programme, then top up with spot."""
    need = v["rigs_needed_per_month"]
    if v["month"] == 1:
        return [("contract", {"months": 18})] * math.ceil(need - 1e-9)
    return [("hire_spot", {})] if fleet < need - 0.3 else []


def spot_only(v, fleet):
    return [("hire_spot", {})] * math.ceil(v["rigs_needed_per_month"] - 1e-9)


def wait_then_cram(v, fleet):
    """Silly: do nothing for 16 months, then hire every spot rig the market will give."""
    return [("hire_spot", {})] * (6 - fleet) if v["month"] > 16 else []


class MGTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_mg = base.MG
        base.MG = Path(self.tmp.name)

    def tearDown(self):
        base.MG = self.old_mg
        self.tmp.cleanup()


class LandAuctionTest(MGTest):
    def test_registered(self):
        code, out = mgapi.handle("GET", "/api/mg", {}, {}, None)
        live = {g["kind"]: g["status"] for g in out}
        self.assertEqual(live["land-auction"], "live")
        self.assertEqual(live["rig-contracts"], "live")

    def test_seeded_determinism(self):
        a, b = new("land-auction"), new("land-auction")
        self.assertEqual(a["view"], b["view"])
        self.assertEqual(state("land-auction", a["id"])["truth"], state("land-auction", b["id"])["truth"])
        ra, rb = auction_play(7, 0.6, True), auction_play(7, 0.6, True)
        self.assertEqual(ra["result"], rb["result"])
        self.assertNotEqual(new("land-auction", seed=2)["view"], a["view"])

    def test_view_hides_truth(self):
        s = new("land-auction")
        st = state("land-auction", s["id"])
        text = json.dumps(s)
        self.assertFalse(keys(s) & {"truth", "result", "eur_boe", "rival_estimates_eur_boe", "true_value_usd"})
        for tid, t in st["truth"]["tracts"].items():
            self.assertNotIn(str(round(t["eur_boe"])), text)
            for b in t["rival_bids"].values():
                if b["bid_usd"] > 0:
                    self.assertNotIn(str(b["bid_usd"]), text)
        # later rounds are not announced and nothing hidden appears after an appraisal either
        self.assertTrue(all(t["round"] == 1 for t in s["view"]["tracts"]))
        code, out = act("land-auction", s["id"], "appraise", tract=s["view"]["tracts"][0]["id"])
        self.assertEqual(code, 200)
        self.assertNotIn("truth", keys(out["session"]))

    def test_illegal_actions_refused(self):
        sid = new("land-auction")["id"]
        code, out = act("land-auction", sid, "x")
        self.assertEqual(code, 400)
        self.assertIn("not available", out["errors"][0])
        code, out = act("land-auction", sid, "appraise", tract="T99")
        self.assertEqual(code, 400)
        code, out = act("land-auction", sid, "bid", bid_a=59, bid_b=59)
        self.assertEqual(code, 400)
        self.assertIn("budget", out["errors"][0])
        code, out = act("land-auction", sid, "bid", bid_a="lots")
        self.assertEqual(code, 400)
        tid = state("land-auction", sid)["tracts"][0]["id"]
        self.assertEqual(act("land-auction", sid, "appraise", tract=tid)[0], 200)
        self.assertEqual(act("land-auction", sid, "appraise", tract=tid)[0], 400)    # one appraisal per tract

    def test_full_playthrough(self):
        s = auction_play(3, 0.55, True)
        self.assertEqual(s["status"], "finished")
        self.assertEqual(s["actions"], [])
        r = s["result"]
        for k in ("score", "stars", "headline", "breakdown", "lookback"):
            self.assertIn(k, r)
        self.assertIn(r["stars"], (0, 1, 2, 3))
        st = state("land-auction", s["id"])
        self.assertEqual(set(r["lookback"]), {t["id"] for t in st["tracts"]})
        self.assertTrue(all("true_value_usd" in x and "paid_usd" in x for x in r["lookback"].values()))
        self.assertAlmostEqual(r["breakdown"]["value_created_usd"],
                               r["breakdown"]["value_won_usd"] - r["breakdown"]["paid_usd"] - r["breakdown"]["appraisal_usd"], delta=5e3)
        self.assertEqual(act("land-auction", s["id"], "bid")[0], 400)               # finished sessions refuse actions

    def test_value_rises_with_eur(self):
        self.assertLess(land_auction.npv_per_well(250_000), 0)
        self.assertGreater(land_auction.npv_per_well(600_000), 0)
        self.assertGreater(land_auction.npv_per_well(900_000), land_auction.npv_per_well(600_000))

    def test_sensible_beats_silly(self):
        seeds = range(1, 11)
        sensible = [auction_play(sd, 0.55, True)["result"] for sd in seeds]
        silly = [auction_play(sd, 3.0)["result"] for sd in seeds]
        mean = lambda rs: sum(r["breakdown"]["value_created_usd"] for r in rs) / len(rs)
        self.assertGreater(mean(sensible), mean(silly))
        self.assertLess(mean(silly), 0)          # bidding 3x estimate buys the winner's curse


class RigContractsTest(MGTest):
    def test_seeded_determinism(self):
        a, b = new("rig-contracts"), new("rig-contracts")
        self.assertEqual(a["view"], b["view"])
        self.assertEqual(rig_play(4, term_then_spot)["result"], rig_play(4, term_then_spot)["result"])
        self.assertNotEqual(new("rig-contracts", seed=2)["view"]["market"], a["view"]["market"])

    def test_view_hides_truth(self):
        s = new("rig-contracts")
        st = state("rig-contracts", s["id"])
        self.assertFalse(keys(s) & {"truth", "result", "regime", "hindsight_plan"})
        shown = s["view"]["market"]["spot_usd_day"]
        self.assertEqual(shown, st["truth"]["spot_usd_day"][:rig_contracts.HISTORY + 1])     # history and today only
        code, out = act("rig-contracts", s["id"], "next_month")
        self.assertEqual(len(out["session"]["view"]["market"]["spot_usd_day"]), rig_contracts.HISTORY + 2)

    def test_illegal_actions_refused(self):
        sid = new("rig-contracts")["id"]
        self.assertEqual(act("rig-contracts", sid, "x")[0], 400)
        self.assertEqual(act("rig-contracts", sid, "release", rig="R1")[0], 400)   # no rigs yet: release is not legal
        self.assertEqual(act("rig-contracts", sid, "finish")[0], 400)              # target not met
        self.assertEqual(act("rig-contracts", sid, "contract", months=9)[0], 400)
        for _ in range(rig_contracts.MAX_RIGS):
            self.assertEqual(act("rig-contracts", sid, "hire_spot")[0], 200)
        code, out = act("rig-contracts", sid, "hire_spot")
        self.assertEqual(code, 400)
        self.assertEqual(act("rig-contracts", sid, "release", rig="R99")[0], 400)
        self.assertEqual(act("rig-contracts", sid, "release", rig="R1")[0], 200)

    def test_release_fee(self):
        sid = new("rig-contracts")["id"]
        act("rig-contracts", sid, "contract", months=12)
        act("rig-contracts", sid, "next_month")
        rate = state("rig-contracts", sid)["rigs"][0]["usd_day"]
        code, out = act("rig-contracts", sid, "release", rig="R1")
        self.assertEqual(code, 200)
        fee = state("rig-contracts", sid)["costs"]["release_usd"]
        self.assertAlmostEqual(fee, rig_contracts.RELEASE_FEE * rate * rig_contracts.DAYS * 11, delta=1)

    def test_full_playthrough(self):
        s = rig_play(5, term_then_spot)
        self.assertEqual(s["status"], "finished")
        r = s["result"]
        for k in ("score", "stars", "headline", "breakdown", "lookback"):
            self.assertIn(k, r)
        self.assertAlmostEqual(r["breakdown"]["wells_drilled"], r["breakdown"]["target_wells"], delta=0.05)
        self.assertEqual(len(r["lookback"]["spot_usd_day"]), rig_contracts.HISTORY + rig_contracts.MONTHS)
        self.assertGreater(r["breakdown"]["hindsight_cost_per_target_well_usd"], 0)

    def test_finish_early(self):
        sid = new("rig-contracts", target_wells=10)["id"]
        for _ in range(4):
            act("rig-contracts", sid, "hire_spot")
        code, out = act("rig-contracts", sid, "next_month")
        self.assertIn("finish", [a["name"] for a in out["session"]["actions"]])
        code, out = act("rig-contracts", sid, "finish")
        self.assertEqual(code, 200)
        self.assertEqual(out["session"]["status"], "finished")

    def test_sensible_beats_silly(self):
        seeds = range(1, 9)
        def mean(key, strat, **kw):
            rs = [rig_play_direct(sd, strat, **kw)["result"] for sd in seeds]
            return sum(r["score"] if key == "score" else r["breakdown"][key] for r in rs) / len(rs)
        self.assertGreater(mean("score", term_then_spot), mean("score", wait_then_cram) + 20)
        # term-contracting while the market is soft beats spot-only in a tight market, on score and on direct cost per well
        self.assertGreater(mean("score", term_then_spot, market="soft"), mean("score", spot_only, market="tight"))
        cost = "rig_cost_per_target_well_usd"
        self.assertLess(mean(cost, term_then_spot, market="soft"), mean(cost, spot_only, market="tight"))
        # and locking in a term rig at the top of a tight market is punished
        self.assertLess(mean("score", term_then_spot, market="tight"), mean("score", term_then_spot, market="soft"))


if __name__ == "__main__":
    unittest.main()
