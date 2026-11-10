"""Frac-hits (Parent-Child) and water-logistics minigames: determinism, hidden truth, refused actions, full playthroughs, and
that a sensible strategy beats a silly one. No simulator needed (sim=False). Run: python -m unittest discover game/tests"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import mgapi  # noqa: E402
import minigames  # noqa: E402
from minigames import base, frac_hits, water  # noqa: E402,F401


def new(kind, **params):
    code, out = mgapi.handle("POST", f"/api/mg/{kind}/new", {}, {"params": {"seed": 1, **params}}, None)
    assert code == 200, out
    return out["session"]


def act(kind, sid, action, **args):
    return mgapi.handle("POST", f"/api/mg/{kind}/act", {}, {"id": sid, "action": action, **args}, None)


def keys(obj):
    if isinstance(obj, dict):
        return set(obj) | set().union(*(keys(v) for v in obj.values()))
    if isinstance(obj, list):
        return set().union(*(keys(v) for v in obj)) if obj else set()
    return set()


def state(kind, sid):
    return base.load(kind, sid)


# ---- scripted players --------------------------------------------------------------------------------------------------
def close_bits(v, ft=700):
    return [int(p["distance_ft"] < ft) for p in v["parents"]]


def fh_ignore(v):
    return {}


def fh_shut_close(v):
    return {"shut_in": close_bits(v)}


def fh_play_direct(seed, strategy, respond=False):
    g = base.REGISTRY["frac-hits"]
    st = base.new_state("frac-hits", {"seed": seed})
    g.new(st, {"seed": seed}, None)
    g.act(st, "plan", strategy(g.view(st)["view"]), None)
    g.act(st, "start_frac", {}, None)
    while st["status"] == "active":
        if respond:
            for p in g.view(st)["view"]["parents"]:
                if p["gauge"] and p["status"] == "producing" and p["readings"] and p["readings"][-1]["signal"] != "quiet":
                    g.act(st, "shut_in", {"parent": p["id"]}, None)
        g.act(st, "frac_step", {}, None)
    return st


def fh_play_http(seed, plan, respond=True):
    s = new("frac-hits", seed=seed)
    sid = s["id"]
    code, out = act("frac-hits", sid, "plan", **plan)
    assert code == 200, out
    code, out = act("frac-hits", sid, "start_frac")
    assert code == 200, out
    s = out["session"]
    while s["status"] == "active":
        if respond:
            for p in s["view"]["parents"]:
                if p["gauge"] and p["status"] == "producing" and p["readings"] and p["readings"][-1]["signal"] != "quiet":
                    code, out = act("frac-hits", sid, "shut_in", parent=p["id"])
                    assert code == 200, out
        code, out = act("frac-hits", sid, "frac_step")
        assert code == 200, out
        s = out["session"]
    return s


def need(v):
    m = v["month"] - 1
    return max(0.0, v["schedule"][m]["demand_bbl"] - v["storage_bbl"])


def w_truck_fresh(v):
    """Silly at high volume: truck in fresh water only."""
    return {"fresh_bbl": min(v["fresh_permit_bbl_month"], need(v)), "transport": "trucks"}


def w_pipe_recycle(v):
    """Lay a pipeline, recycle the forecast produced water and top up with fresh."""
    rec = v["produced_water_forecast_bbl"][v["month"] - 1]
    return {"fresh_bbl": min(v["fresh_permit_bbl_month"], max(0.0, need(v) - 0.8 * rec)), "recycle_bbl": rec,
            "transport": "pipeline"}


def w_play_direct(seed, strategy, **params):
    g = base.REGISTRY["water"]
    params = {"seed": seed, **params}
    st = base.new_state("water", params)
    g.new(st, params, None)
    while st["status"] == "active":
        g.act(st, "plan_month", strategy(g.view(st)["view"]), None)
    return st


def w_play_http(seed, strategy, **params):
    s = new("water", seed=seed, **params)
    while s["status"] == "active":
        code, out = act("water", s["id"], "plan_month", **strategy(s["view"]))
        assert code == 200, out
        s = out["session"]
    return s


class MGTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_mg = base.MG
        base.MG = Path(self.tmp.name)

    def tearDown(self):
        base.MG = self.old_mg
        self.tmp.cleanup()


class RegistryTest(MGTest):
    def test_registered_and_imported(self):
        self.assertNotIn("frac_hits", minigames.FAILED)
        self.assertNotIn("water", minigames.FAILED)
        code, out = mgapi.handle("GET", "/api/mg", {}, {}, None)
        live = {g["kind"]: g for g in out}
        self.assertEqual(live["frac-hits"]["status"], "live")
        self.assertEqual(live["frac-hits"]["title"], "Parent-Child")
        self.assertEqual(live["water"]["status"], "live")
        self.assertEqual(live["water"]["title"], "Water Logistics")
        self.assertFalse(live["water"]["sim"] or live["frac-hits"]["sim"])


class FracHitsTest(MGTest):
    def test_honesty_note(self):
        notes = " ".join(new("frac-hits")["notes"])
        self.assertIn("fracture interaction and parent depletion effects are not modelled by the simulator; hit probabilities "
                      "and losses are game rules drawn from public industry ranges", notes)

    def test_seeded_determinism(self):
        a, b = new("frac-hits"), new("frac-hits")
        self.assertEqual(a["view"], b["view"])
        self.assertEqual(state("frac-hits", a["id"])["truth"], state("frac-hits", b["id"])["truth"])
        plan = {"shut_in": [1, 0, 0], "gauges": [0, 1, 1]}
        self.assertEqual(fh_play_http(4, plan)["result"], fh_play_http(4, plan)["result"])
        self.assertNotEqual(new("frac-hits", seed=2)["view"], a["view"])

    def test_setup_ranges(self):
        for sd in range(1, 21):
            v = fh_play_direct(sd, fh_ignore)
            ds = [p["distance_ft"] for p in v["parents"]]
            self.assertTrue(all(330 <= d <= 1320 for d in ds))
            self.assertTrue(4 <= v["steps"] <= 6)
            for t in v["truth"]["parents"]:
                self.assertTrue(frac_hits.SEV_MIN <= t["severity"] <= frac_hits.SEV_MAX)
        self.assertGreater(frac_hits.hit_prob(330, 7500), frac_hits.hit_prob(1320, 7500))
        self.assertGreater(frac_hits.hit_prob(600, 9000), frac_hits.hit_prob(600, 5000))

    def test_view_hides_truth(self):
        hidden = {"truth", "result", "u", "k", "severity", "hit_step", "precursor", "false_alarm_step", "hit_probability",
                  "lookback", "hindsight"}
        # find a seed where an ungauged parent is hit mid-job and check the whole session (view and log) after every step
        for sd in range(1, 40):
            s = new("frac-hits", seed=sd)
            st = state("frac-hits", s["id"])
            size = st["job_bbl_stage"]
            hit_ids = [p["id"] for p, t in zip(st["parents"], st["truth"]["parents"])
                       if t["u"] < frac_hits.hit_prob(p["distance_ft"], size, t["k"])]
            if hit_ids:
                break
        self.assertTrue(hit_ids)
        self.assertFalse(keys(s) & hidden)
        sid = s["id"]
        act("frac-hits", sid, "start_frac")
        for _ in range(st["steps"] - 1):
            code, out = act("frac-hits", sid, "frac_step")
            self.assertEqual(code, 200)
            s = out["session"]
            self.assertFalse(keys(s) & hidden)
            text = json.dumps(s)
            for p in s["view"]["parents"]:
                self.assertEqual(p["readings"], [])              # no gauges: nothing is shown
                self.assertFalse(p["hit_seen"])
            for pid in hit_ids:
                self.assertNotIn(f"{pid} gauge", text)
            for t in st["truth"]["parents"]:
                self.assertNotIn(str(round(t["severity"], 3)), text)
        code, out = act("frac-hits", sid, "frac_step")
        self.assertEqual(out["session"]["status"], "finished")
        self.assertIn("lookback", out["session"]["result"])

    def test_gauges_show_hits(self):
        """With gauges on every parent, every hit is shown in the step it arrives."""
        seen = 0
        for sd in range(1, 15):
            s = fh_play_http(sd, {"gauges": [1, 1, 1]}, respond=False)
            for p, lb in zip(s["view"]["parents"], s["result"]["lookback"]["parents"]):
                self.assertEqual(p["hit_seen"], lb["hit"])
                if lb["hit"]:
                    seen += 1
                    self.assertEqual(p["hit_seen_step"], lb["hit_step"])
        self.assertGreater(seen, 0)

    def test_illegal_actions_refused(self):
        sid = new("frac-hits")["id"]
        self.assertEqual(act("frac-hits", sid, "x")[0], 400)
        self.assertEqual(act("frac-hits", sid, "frac_step")[0], 400)               # not before the frac starts
        self.assertEqual(act("frac-hits", sid, "shut_in", parent="P1")[0], 400)     # plan phase: use 'plan'
        code, out = act("frac-hits", sid, "plan", shut_in=[1, 0])
        self.assertEqual(code, 400)
        self.assertEqual(act("frac-hits", sid, "plan", shut_in="yes")[0], 400)
        self.assertEqual(act("frac-hits", sid, "plan", gauges=[1, 2, 0])[0], 400)
        code, out = act("frac-hits", sid, "plan", preload=[1, 0, 0])               # pre-load needs a shut-in
        self.assertEqual(code, 400)
        self.assertIn("pre-load", out["errors"][0])
        self.assertEqual(act("frac-hits", sid, "plan", job_bbl_stage=20000)[0], 400)
        self.assertEqual(act("frac-hits", sid, "plan", shut_in=[1, 0, 0], preload=[1, 0, 0], job_bbl_stage=6000)[0], 200)
        self.assertEqual(act("frac-hits", sid, "start_frac")[0], 200)
        self.assertEqual(act("frac-hits", sid, "plan")[0], 400)                    # plan is locked
        self.assertEqual(act("frac-hits", sid, "shut_in", parent="P1")[0], 400)    # already shut in
        self.assertEqual(act("frac-hits", sid, "shut_in", parent="P9")[0], 400)
        self.assertEqual(act("frac-hits", sid, "shut_in", parent="P2")[0], 200)
        st = state("frac-hits", sid)
        self.assertEqual(st["parents"][1]["shut_step"], 0)
        self.assertEqual(st["job_bbl_stage"], 6000)

    def test_full_playthrough(self):
        s = fh_play_http(5, {"shut_in": [1, 0, 0], "preload": [1, 0, 0], "gauges": [0, 1, 1], "job_bbl_stage": 7000})
        self.assertEqual(s["status"], "finished")
        self.assertEqual(s["actions"], [])
        r = s["result"]
        for k in ("score", "stars", "headline", "breakdown", "lookback"):
            self.assertIn(k, r)
        self.assertIn(r["stars"], (0, 1, 2, 3))
        self.assertTrue(0 < r["score"] <= 100)
        b = r["breakdown"]
        self.assertAlmostEqual(b["total_value_usd"], b["child_value_usd"] - b["parent_loss_usd"] - b["deferral_usd"]
                               - b["preload_and_gauges_usd"], delta=5)
        self.assertGreaterEqual(b["hindsight_value_usd"], b["total_value_usd"] - 1)
        self.assertEqual(len(r["lookback"]["parents"]), 3)
        self.assertEqual(act("frac-hits", s["id"], "frac_step")[0], 400)

    def test_mid_job_shut_in_limits_damage(self):
        self.assertEqual(frac_hits.damage_share(True, 2, None, False), 1.0)
        self.assertEqual(frac_hits.damage_share(True, 2, 3, False), frac_hits.RESPONSE_BASE)
        self.assertEqual(frac_hits.damage_share(True, 2, 0, False), frac_hits.SHUT_MIT)
        self.assertLess(frac_hits.damage_share(True, 2, 0, True), frac_hits.SHUT_MIT)
        self.assertEqual(frac_hits.damage_share(False, 2, None, False), 0.0)

    def test_sensible_beats_silly(self):
        seeds = range(1, 41)
        mean = lambda strat, key: sum(fh_play_direct(sd, strat)["result"]["breakdown"][key] for sd in seeds) / len(seeds)
        self.assertGreater(mean(fh_shut_close, "total_value_usd"), mean(fh_ignore, "total_value_usd") + 100_000)
        self.assertLess(mean(fh_shut_close, "regret_usd"), mean(fh_ignore, "regret_usd"))
        # shutting in the far parents too is a waste of production
        shut_all = lambda v: {"shut_in": [1, 1, 1]}
        self.assertGreater(mean(fh_shut_close, "total_value_usd"), mean(shut_all, "total_value_usd"))


class WaterTest(MGTest):
    def test_honesty_note(self):
        notes = " ".join(new("water")["notes"])
        self.assertIn("water volumes and costs are illustrative logistics; the reservoir model's fluid produces little water, "
                      "so these volumes are not from the simulator", notes)

    def test_seeded_determinism(self):
        a, b = new("water"), new("water")
        self.assertEqual(a["view"], b["view"])
        self.assertEqual(state("water", a["id"])["truth"], state("water", b["id"])["truth"])
        self.assertEqual(w_play_http(3, w_pipe_recycle)["result"], w_play_http(3, w_pipe_recycle)["result"])
        self.assertNotEqual(new("water", seed=2)["view"], a["view"])

    def test_view_hides_truth(self):
        hidden = {"truth", "result", "threshold", "u_regulator", "produced", "regulator_threshold_bbl_month", "lookback",
                  "hindsight_plan"}
        s = new("water", volume="high")
        st = state("water", s["id"])
        self.assertFalse(keys(s) & hidden)
        text = json.dumps(s)
        self.assertNotIn(str(st["truth"]["threshold"]), text)
        for x in st["truth"]["produced"]:
            self.assertNotIn(str(x), text)
        # a disposal-heavy month (regulator-relevant): only that month's actual supply is revealed, never the threshold
        code, out = act("water", s["id"], "plan_month", fresh_bbl=1_200_000, transport="trucks")
        self.assertEqual(code, 200)
        s = out["session"]
        self.assertFalse(keys(s) & hidden)
        text = json.dumps(s)
        self.assertNotIn(str(st["truth"]["threshold"]), text)
        self.assertNotIn(str(round(st["truth"]["threshold"])), text)
        for x in st["truth"]["produced"][1:]:
            self.assertNotIn(f"{x:,.0f}", text)
            self.assertNotIn(str(round(x)), text)
        self.assertEqual(s["view"]["history"][0]["produced_bbl"], round(st["truth"]["produced"][0]))

    def test_illegal_actions_refused(self):
        sid = new("water")["id"]
        self.assertEqual(act("water", sid, "x")[0], 400)
        self.assertEqual(act("water", sid, "plan_month", fresh_bbl=5_000_000)[0], 400)        # over the permit
        self.assertEqual(act("water", sid, "plan_month", fresh_bbl="lots")[0], 400)
        self.assertEqual(act("water", sid, "plan_month", recycle_bbl=-5)[0], 400)
        self.assertEqual(act("water", sid, "plan_month", swd_bbl=10_000_000)[0], 400)          # over SWD capacity
        self.assertEqual(act("water", sid, "plan_month", transport="helicopter")[0], 400)
        self.assertEqual(state("water", sid)["month"], 0)
        self.assertEqual(code_of(act("water", sid, "plan_month", fresh_bbl=100_000)), 200)
        self.assertEqual(code_of(new_bad_volume()), 400)

    def test_full_playthrough(self):
        s = w_play_http(5, w_pipe_recycle, volume="high")
        self.assertEqual(s["status"], "finished")
        self.assertEqual(s["actions"], [])
        r = s["result"]
        for k in ("score", "stars", "headline", "breakdown", "lookback"):
            self.assertIn(k, r)
        self.assertIn(r["stars"], (0, 1, 2, 3))
        self.assertTrue(0 < r["score"] <= 100)
        self.assertEqual(len(s["view"]["history"]), water.MONTHS)
        self.assertEqual(len(r["lookback"]["hindsight_plan"]), water.MONTHS)
        self.assertAlmostEqual(sum(h["total_usd"] for h in s["view"]["history"]), s["view"]["total_cost_usd"], delta=3)
        self.assertEqual(r["breakdown"]["total_cost_usd"], s["view"]["total_cost_usd"])
        self.assertTrue(s["view"]["pipeline"]["installed"])
        self.assertEqual(act("water", s["id"], "plan_month")[0], 400)

    def test_regulator_cut(self):
        """Pushing everything into SWD with no recycling triggers the seismicity rule more often than staying low."""
        heavy = sum(any(h["regulator_cut"] for h in w_play_direct(sd, w_truck_fresh, volume="high")["history"])
                    for sd in range(1, 21))
        light = sum(any(h["regulator_cut"] for h in w_play_direct(sd, w_pipe_recycle, volume="high")["history"])
                    for sd in range(1, 21))
        self.assertGreater(heavy, light)
        self.assertEqual(water.cut_prob(500_000, 600_000, 1_000_000), 0.0)
        self.assertGreater(water.cut_prob(950_000, 600_000, 1_000_000), water.cut_prob(650_000, 600_000, 1_000_000))

    def test_sensible_beats_silly(self):
        seeds = range(1, 31)
        cost = lambda strat: sum(w_play_direct(sd, strat, volume="high")["result"]["breakdown"]["total_cost_usd"]
                                 for sd in seeds) / len(seeds)
        score = lambda strat: sum(w_play_direct(sd, strat, volume="high")["result"]["score"] for sd in seeds) / len(seeds)
        self.assertLess(cost(w_pipe_recycle), cost(w_truck_fresh))
        self.assertGreater(score(w_pipe_recycle), score(w_truck_fresh) + 20)


def code_of(resp):
    return resp[0]


def new_bad_volume():
    return mgapi.handle("POST", "/api/mg/water/new", {}, {"params": {"seed": 1, "volume": "huge"}}, None)


if __name__ == "__main__":
    unittest.main()
