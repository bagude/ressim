"""HTTP handlers for geosteering sessions (standalone level and career wells). Returns (status, body)."""
import career
import field
import steer
import steergame


def _finish_career(s, truth_sim):
    link = s["link"]
    with career.lock_for(link["career"]):
        st, truth = career.load(link["career"])
        res = steergame.finish_career_well(s)
        w = next(w for w in st["wells"] if w["id"] == link["well"])
        w["steer"].update(finished=True, in_zone_pct=res["in_zone_pct"], bucket_counts=res["bucket_counts"])
        career.inbox(st, "operations", f"Well {w['id']} at total depth", f"You kept {res['in_zone_pct']:.0f} % of the lateral in the pay.",
                     {"pad": w["pad"], "well": w["id"], "wells": [w["id"]], "session": s["id"], "in_zone_pct": res["in_zone_pct"]})
        career.save(st)
    return res


def handle(method, path, query, body, worker):
    try:
        if method == "POST" and path == "/api/steer/new":
            seed = body.get("seed")
            s = steer.new_session(seed=int(seed) if seed is not None else None)
            return 200, {"ok": True, "session": steer.view(s)}
        sid = query.get("id", [None])[0] if method == "GET" else body.get("id")
        s = steer.load(sid)
        if method == "GET" and path == "/api/steer":
            return 200, {"ok": True, "session": steer.view(s)}
        if s["finished"] and path != "/api/steer/preview":
            return 400, {"ok": False, "errors": ["well already finished"], "session": steer.view(s)}
        if method == "POST" and path == "/api/steer/preview":
            return 200, {"ok": True, **steer.preview(s, body.get("interpretation"))}
        if method == "POST" and path == "/api/steer/drill":
            if body.get("interpretation") is not None:
                s["interpretation"] = steer.check_interp(body["interpretation"])
            if body.get("sidetrack_to_md") is not None:
                steer.sidetrack(s, body["sidetrack_to_md"])
            else:
                steer.drill(s, float(body.get("target_inclination_deg")), look_around=bool(body.get("look_around")))
            steer.save(s)
            out = {"ok": True, "session": steer.view(s)}
            if s["interpretation"]:
                out["preview"] = steer.preview(s, s["interpretation"])
            return 200, out
        if method == "POST" and path == "/api/steer/prognosis":
            src = None
            if body.get("type_well"):
                import career
                import geodesk
                cid = (s.get("link") or {}).get("career")
                st, truth = career.load(cid)
                w = next((w for w in geodesk.wells(st, truth) if w["id"] == body["type_well"]), None)
                if w is None or w["type"] != "vertical":
                    return 400, {"ok": False, "errors": ["type_well must be a vertical well with a log"]}
                picks = body.get("type_well_picks") or w.get("picks_auto")
                if not picks:
                    return 400, {"ok": False, "errors": ["the type well has no picks"]}
                src = {"well": w["id"], "typelog": steer.typelog_from_well(w.get("log"), picks, s["truth"]["pay_ft"])}
            try:
                p = steer.set_prognosis(s, body.get("target_ft", s["truth"]["pay_ft"] / 2), body.get("top_tvd_along") or [], src)
            except (ValueError, TypeError, KeyError) as e:
                return 400, {"ok": False, "errors": [str(e)]}
            steer.save(s)
            return 200, {"ok": True, "prognosis": {k: v for k, v in p.items() if k != "typelog_source"}, "session": steer.view(s)}
        if method == "POST" and path == "/api/steer/autosteer":
            steer.auto_steer(s, steergame.STAFF_RATING)
            steer.save(s)
            return 200, {"ok": True, "session": steer.view(s)}
        if method == "POST" and path == "/api/steer/finish":
            if steer.bit(s)["md"] < s["truth"]["lateral_ft"] - 1e-6:
                return 400, {"ok": False, "errors": ["drill to total depth first"]}
            if s["link"]:
                _finish_career(s, field.TruthSim(worker))
            else:
                if worker is None:
                    return 503, {"ok": False, "errors": ["server started with --no-sim"]}
                steergame.finish_level(s, field.TruthSim(worker))
            steer.save(s)
            return 200, {"ok": True, "session": steer.view(s)}
        return 404, {"ok": False, "errors": ["no such endpoint"]}
    except (ValueError, TypeError) as e:
        return 400, {"ok": False, "errors": [str(e)]}
    except career.CareerError as e:
        return 400, {"ok": False, "errors": [str(e)]}
    except RuntimeError as e:
        return 500, {"ok": False, "errors": [f"simulator: {e}"]}
