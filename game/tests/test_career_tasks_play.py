"""Career tasks played to the finish through the minigame API (no Julia), and no hidden rock in any linked session."""
import json
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


def default_args(action):
    out = {}
    for name, spec in action.get("args", {}).items():
        if "default" in spec:
            out[name] = spec["default"]
        elif spec["type"] == "enum":
            out[name] = spec["options"][0]
        elif spec["type"] in ("number", "int"):
            out[name] = spec.get("min", 0)
        elif spec["type"] == "list":
            out[name] = []
        elif spec["type"] == "bool":
            out[name] = False
    return out


PREFERRED = ["start_frac", "frac_step", "commit", "plan_month", "next_month", "shut_in", "kill_mud", "kill_sheet", "pump",
             "bid", "answer", "finish"]


def autoplay(kind, sid, limit=300):
    """Play a session to the end with legal default actions (preferring ones that move the game on)."""
    for _ in range(limit):
        code, body = mgapi.handle("GET", f"/api/mg/{kind}", {"id": [sid]}, {}, None)
        s = body["session"]
        if s["status"] == "finished":
            return s
        acts = {a["name"]: a for a in s["actions"]}
        name = next((n for n in PREFERRED if n in acts), next(iter(acts)))
        if kind == "well-control" and s["view"]["phase"] == "drilling":
            r = s["view"].get("readings") or []
            name = "shut_in" if r and r[-1]["pit_gain_bbl"] > 3 else "drill"     # shut in on a clear pit gain
        args = default_args(acts[name])
        if kind == "well-control" and name == "kill_mud":
            sh = s["view"]["shut_in"]
            mw, tvd = s["view"]["well"]["mw_ppg"], sh["tvd_ft"]
            args.update(kmw_ppg=round(mw + sh["sidpp_psi"] / (0.052 * tvd) + 0.05, 2))
        if kind == "well-control" and name == "pump":
            sched = s["view"].get("schedule") or []
            nxt = s["view"].get("next_strokes")
            args["dpp_psi"] = next((p["dpp_psi"] for p in sched if p["strokes"] == nxt), sched[-1]["dpp_psi"] if sched else 500)
        if kind == "well-control" and name == "kill_sheet":
            sh, w = s["view"]["shut_in"], s["view"]["well"]
            kmw = s["view"]["answers"]["kmw_ppg"]
            args.update(icp_psi=w["scr_psi"] + sh["sidpp_psi"], fcp_psi=round(w["scr_psi"] * kmw / w["mw_ppg"]))
        code, body = mgapi.handle("POST", f"/api/mg/{kind}/act", {}, {"id": sid, "action": name, **args}, None)
        if code != 200:
            raise AssertionError(f"{kind} {name} {args}: {body}")
    raise AssertionError(f"{kind} did not finish")


class PlayLinkedTasks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = Path(self.tmp.name)
        self.old = (career.CAREERS, steer.STEER, base.MG, career_tasks.KICK_PROBABILITY)
        career.CAREERS, steer.STEER, base.MG = t / "careers", t / "steer", t / "mg"
        career_tasks.KICK_PROBABILITY = 1.0
        self.sim = FakeSim()
        self.cid = career.new("P", self.sim, seed=33, background=False)
        st, truth = career.load(self.cid)
        ids = [a["id"] for a in career.analog_list(st, truth, self.sim) if a["history_months"] >= 6]
        tc, _ = career.build_typecurve(st, truth, self.sim, ids)
        career.save_typecurve(st, "base", ids, tc)
        opens = [s["section"] for s in st["sections"] if not s["developed"]]
        raw = {"design": {"stage_spacing_ft": 200.0, "half_length_ft": 300.0, "conductivity_mdft": 50.0, "bhp_psi": 1500.0},
               "typecurve": "base", "percentile": "p50", "rigs": 1, "crews": 1, "budget_request": {},
               "pads": [{"section": opens[0], "wells": 2, "completion": "manual", "flowback": "manual"}]}
        row = career.evaluate_plan(st, truth, self.sim, career.check_plan(st, raw))["budget_by_year"][0]
        raw["budget_request"] = {"0": row["board_limit_usd"]}
        self.assertTrue(career.budget_meeting(st, truth, self.sim, career.check_plan(st, raw))["approved"])
        for _ in range(4):                                           # pad locks (a hidden start delay may hold it a little)
            if st["locked"]:
                break
            career.advance(st, truth, self.sim, 1)
        career.save(st, truth)

    def tearDown(self):
        career.CAREERS, steer.STEER, base.MG, career_tasks.KICK_PROBABILITY = self.old
        self.tmp.cleanup()

    def test_no_hidden_rock_in_any_linked_session(self):
        st, _ = career.load(self.cid)
        self.assertTrue(st["tasks"])
        for t in st["tasks"]:
            code, body = mgapi.handle("GET", f"/api/mg/{t['kind']}", {"id": [t["session"]]}, {}, None)
            self.assertEqual(code, 200)
            blob = json.dumps(body)
            for secret in ("perm_md", '"truth"', "porosity"):
                self.assertNotIn(secret, blob, f"{t['kind']} leaks {secret}")

    def test_play_every_no_sim_task_and_see_the_career_change(self):
        st, _ = career.load(self.cid)
        done = {}
        for t in list(st["tasks"]):
            if base.REGISTRY[t["kind"]].sim:
                continue
            s = autoplay(t["kind"], t["session"])
            done[t["kind"]] = s
            self.assertNotIn("perm_md", json.dumps(s))
        st, truth = career.load(self.cid)
        statuses = {t["kind"]: t["status"] for t in st["tasks"] if t["kind"] in done}
        self.assertTrue(all(v == "done" for v in statuses.values()), statuses)
        cf = st.get("cost_factors", {}).get("0", {})
        if "rig-contracts" in done:
            self.assertIn("rig", cf)
        if "water" in done:
            self.assertIn("completion", cf)
        if "well-control" in done:
            self.assertTrue(any("kick" in c["label"] for c in st.get("costs_pending", [])))
        if "hedging" in done:
            self.assertEqual(len(st.get("hedge_books", [])), 1)
        self.assertIn("well-control", done)                          # kicks are certain in this test
        career.advance(st, truth, self.sim, 1) if not career_tasks.blocking_pending(st, (st["month"] + 1) * career.MD) else None


if __name__ == "__main__":
    unittest.main()
