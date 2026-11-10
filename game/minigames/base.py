"""Minigame framework. Every game is a module that registers a Game; sessions are JSON files under game/mg/<kind>/.

A game implements:
    new(state, params, ctx)              fills a fresh state (it may hold hidden truth; it never leaves the server directly)
    act(state, action, args, ctx) -> [event strings]
    view(state) -> {view, actions, notes, result?}   (only what the player may see)
ctx = Ctx(worker, truth_sim, workdir). Simulator-backed games use ctx.call(kind, data) and ctx.truth_sim.
"""
import json
import random
import uuid
from pathlib import Path

GAME = Path(__file__).resolve().parents[1]
MG = GAME / "mg"
REGISTRY = {}


class GameError(Exception):
    pass


class Game:
    kind = ""
    title = ""
    blurb = ""
    sim = False

    def new(self, state, params, ctx):
        raise NotImplementedError

    def act(self, state, action, args, ctx):
        raise NotImplementedError

    def view(self, state):
        raise NotImplementedError


def register(game):
    REGISTRY[game.kind] = game
    return game


class Ctx:
    def __init__(self, worker, truth_sim=None, workdir=None):
        self.worker = worker
        self.truth_sim = truth_sim
        self.workdir = workdir

    def call(self, kind, data, sub):
        if self.worker is None:
            raise GameError("this action needs the simulator; the server was started with --no-sim")
        return self.worker.call(kind, data, Path(self.workdir) / sub)


def store_dir(kind):
    d = MG / kind
    d.mkdir(parents=True, exist_ok=True)
    return d


def save(state):
    d = store_dir(state["kind"])
    tmp = d / f"{state['id']}.json.tmp"
    tmp.write_text(json.dumps(state))
    tmp.replace(d / f"{state['id']}.json")


def load(kind, sid):
    if kind not in REGISTRY:
        raise GameError(f"unknown minigame '{kind}'")
    if not (isinstance(sid, str) and len(sid) == 12 and all(c in "0123456789abcdef" for c in sid)):
        raise GameError("unknown session")
    f = MG / kind / f"{sid}.json"
    if not f.exists():
        raise GameError("unknown session")
    return json.loads(f.read_text())


def new_state(kind, params):
    seed = params.get("seed") if isinstance(params, dict) else None
    seed = int(seed) if seed is not None else random.randrange(10 ** 9)
    return {"id": uuid.uuid4().hex[:12], "kind": kind, "seed": seed, "status": "active", "turn": 0, "log": [], "result": None}


def rng(state, *keys):
    return random.Random(f"{state['seed']}|{state['kind']}|" + "|".join(str(k) for k in keys))


HIDDEN_IN_CAREER = {"perm_md", "truth", "rock", "porosity"}


def scrub(x):
    """Remove hidden rock from anything a career-linked session sends (it would reveal the career's truth)."""
    if isinstance(x, dict):
        return {k: scrub(v) for k, v in x.items() if k not in HIDDEN_IN_CAREER}
    if isinstance(x, list):
        return [scrub(v) for v in x]
    return x


def session_view(state):
    g = REGISTRY[state["kind"]]
    v = g.view(state)
    if (state.get("link") or {}).get("career"):
        v = scrub(v)
    out = {"id": state["id"], "kind": state["kind"], "title": g.title, "status": state["status"], "turn": state["turn"],
           "notes": v.get("notes", []), "actions": v.get("actions", []) if state["status"] == "active" else [],
           "view": v.get("view", {}), "log": state["log"][-50:], "link": state.get("link")}
    if state.get("result"):
        out["result"] = scrub(state["result"]) if (state.get("link") or {}).get("career") else state["result"]
    return out


def num(args, name, lo, hi, default=None):
    v = args.get(name, default)
    try:
        v = float(v)
    except (TypeError, ValueError):
        raise GameError(f"{name} must be a number")
    if not lo <= v <= hi:
        raise GameError(f"{name} must be between {lo:g} and {hi:g}")
    return v


def stars_for(ratio, cuts=(0.8, 0.9, 0.97)):
    return sum(1 for c in cuts if ratio >= c)


def relative(mine, ref, floor):
    """Performance against a reference value that may be zero or negative: 1 + (mine - ref) / max(|ref|, floor).
    Equals mine / ref when ref is positive and large; stays meaningful when the reference loses money."""
    return 1.0 + (mine - ref) / max(abs(ref), floor)


def versus(mine, ref, what):
    d = mine - ref
    return f"${abs(d) / 1e6:.2f} MM {'better' if d >= 0 else 'worse'} than {what}"


def arg(type_, **kw):
    return {"type": type_, **kw}
