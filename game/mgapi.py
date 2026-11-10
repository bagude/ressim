"""HTTP handlers for minigames: /api/mg, /api/mg/<kind>/new|act, GET /api/mg/<kind>?id=."""
import field
import minigames
from minigames import base

ORDER = ["pump-job", "flowback", "facility", "lift", "land-auction", "rig-contracts", "hedging", "diagnostics", "well-control",
         "frac-hits", "water", "well-test", "gaslift", "pvt-lab", "acquisition"]


def apply_to_career(st, worker):
    """A career task's minigame finished: apply its result to the career, under the career's lock."""
    import career
    import career_tasks
    cid = st["link"]["career"]
    with career.lock_for(cid):
        cs, truth = career.load(cid)
        ev = career_tasks.apply(cs, truth, st)
        career.save(cs, truth)
    return ev


def handle(method, path, query, body, worker):
    try:
        parts = [p for p in path.split("/") if p][2:]          # after "api", "mg"
        if not parts:
            live = {k: g for k, g in base.REGISTRY.items()}
            out = []
            for k in ORDER:
                g = live.get(k)
                out.append({"kind": k, "title": g.title if g else k, "blurb": g.blurb if g else "",
                            "status": "live" if g else "coming", "sim": bool(g and g.sim)})
            return 200, out
        kind = parts[0]
        g = base.REGISTRY.get(kind)
        if g is None:
            return 404, {"ok": False, "errors": [f"unknown minigame '{kind}'"]}
        if g.sim and worker is None and not (method == "GET"):
            return 503, {"ok": False, "errors": ["this minigame needs the simulator; the server was started with --no-sim"]}
        ctx = None
        if method == "POST" and len(parts) == 2 and parts[1] == "new":
            st = base.new_state(kind, body.get("params") or {})
            ctx = base.Ctx(worker, field.TruthSim(worker) if worker else None, base.store_dir(kind) / st["id"])
            g.new(st, body.get("params") or {}, ctx)
            base.save(st)
            return 200, {"ok": True, "session": base.session_view(st)}
        sid = query.get("id", [None])[0] if method == "GET" else body.get("id")
        st = base.load(kind, sid)
        if method == "GET" and len(parts) == 1:
            return 200, {"ok": True, "session": base.session_view(st)}
        if method == "POST" and len(parts) == 2 and parts[1] == "act":
            if st["status"] != "active":
                return 400, {"ok": False, "errors": ["this session is finished"], "session": base.session_view(st)}
            action = body.get("action")
            legal = {a["name"] for a in g.view(st).get("actions", [])}
            if action not in legal:
                return 400, {"ok": False, "errors": [f"action '{action}' is not available now; legal: {sorted(legal)}"]}
            ctx = base.Ctx(worker, field.TruthSim(worker) if worker else None, base.store_dir(kind) / st["id"])
            args = {k: v for k, v in body.items() if k not in ("id", "action")}
            events = g.act(st, action, args, ctx) or []
            st["turn"] += 1
            st["log"].extend(events)
            base.save(st)
            if st["status"] == "finished" and (st.get("link") or {}).get("career"):
                events = events + apply_to_career(st, worker)
            return 200, {"ok": True, "session": base.session_view(st), "events": events}
        return 404, {"ok": False, "errors": ["no such endpoint"]}
    except base.GameError as e:
        return 400, {"ok": False, "errors": [str(e)]}
    except RuntimeError as e:
        return 500, {"ok": False, "errors": [f"simulator: {e}"]}

