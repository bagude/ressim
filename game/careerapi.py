"""HTTP handlers for career mode. Returns (status, json-able body). Truth never leaves through here."""
import json

import career
import field
import typecurve


def _truth_sim(worker):
    return field.TruthSim(worker)


def handle(method, path, query, body, worker):
    try:
        if method == "GET" and path == "/api/careers":
            return 200, career.list_careers()
        if method == "POST" and path == "/api/career/new":
            if worker is None:
                return 503, {"ok": False, "errors": ["server started with --no-sim"]}
            seed = None
            if body.get("share"):
                import workover
                seed = workover.seed_from_code(body["share"])
            cid = career.new(body.get("name") or "Operator", _truth_sim(worker), seed=seed)
            st, _ = career.load(cid)
            return 200, {"ok": True, "career": career.view(st)}
        cid = query.get("id", [None])[0] if method == "GET" else body.get("id")
        if worker is None and path not in ("/api/career", "/api/career/field", "/api/career/geology", "/api/career/geomodel", "/api/career/share"):
            return 503, {"ok": False, "errors": ["server started with --no-sim"]}
        ts = _truth_sim(worker)
        with career.lock_for(cid if isinstance(cid, str) else ""):
            st, truth = career.load(cid)
            if method == "GET" and path == "/api/career":
                if st["status"] not in ("generating", "error") and worker is not None:
                    import benchmark
                    benchmark.ensure(st["id"], ts)
                return 200, {"ok": True, "career": career.view(st)}
            if st["status"] == "generating":
                return 409, {"ok": False, "errors": [f"field still being simulated ({100 * st['progress']:.0f} %)"]}
            if method == "GET" and path == "/api/career/field":
                return 200, career.well_field(st, truth, query.get("well", [""])[0])
            if method == "GET" and path == "/api/career/geology":
                import geodesk
                return 200, {"ok": True, "wells": geodesk.wells(st, truth), "units": {"top_name": "Pay top", "base_name": "Pay base"},
                             "planned": geodesk.planned(st), "faults_known": geodesk.faults_known(truth),
                             "structure": ({"note": "top of pay varies (dip, residual relief and faults); map it from the tops"}
                                           if truth.get("structure") else {"top_tvd_ft": geodesk.TOP_TVD, "note": "flat in this model"}),
                             "attributes": list(geodesk.ATTRIBUTES), "geomodels": st.get("geomodels", {}),
                             "company_map": st.get("geology", []), "gr_cutoff": geodesk.GR_CUTOFF, "note": geodesk.NOTE}
            if method == "POST" and path == "/api/career/geomodel":
                import geodesk
                try:
                    gm = geodesk.check_geomodel(st, body)
                except ValueError as e:
                    return 400, {"ok": False, "errors": [str(e)]}
                career.save(st)
                return 200, {"ok": True, "geomodel": {k: gm[k] for k in ("name", "sections", "created_month")}}
            if method == "GET" and path == "/api/career/share":
                import workover
                return 200, {"ok": True, "code": workover.share_code(st), "note": "recreates this career's starting field; none of your decisions"}
            if method == "GET" and path == "/api/career/workovers":
                import workover
                return 200, {"ok": True, **workover.candidates(st, truth, ts)}
            if method == "POST" and path == "/api/career/workover":
                import workover
                r = workover.perform(st, body.get("well"), body.get("kind"))
                career.save(st)
                return 200, {"ok": True, "workover": r, "career": career.view(st)}
            if method == "GET" and path == "/api/career/diagnostics":
                return 200, {"ok": True, "month": st["month"], **career.diagnostics(st, truth, ts)}
            if method == "GET" and path == "/api/career/analogs":
                return 200, {"ok": True, "month": st["month"], "units": career.opecon.UNITS, "analogs": career.analog_list(st, truth, ts)}
            if method == "POST" and path == "/api/career/typecurve":
                ids = body.get("analogs") or []
                prox = None
                if isinstance(body.get("proximity"), dict):      # auto-forecast: the nearest producing wells
                    prox = career.proximity_analogs(st, truth, ts, body["proximity"])
                    ids = [c["id"] for c in prox]
                if isinstance(body.get("normalise"), dict):      # {geomodel, attribute}: geology normalisation (lateral stays on)
                    body = dict(body, normalise_to=body["normalise"], normalise=True)
                tc, al = career.build_typecurve(st, truth, ts, ids, normalise=bool(body.get("normalise", True)),
                                                dmin=float(body.get("dmin", 0.08)))
                out = {"ok": True, "per_ft": tc["per_ft"], "gor_mcf_bbl": tc["gor_mcf_bbl"], "eur_oil": tc["eur_oil"],
                       "months_with_enough_wells": tc["months_with_enough_wells"],
                       "wells": [{"id": w["id"], "aligned_oil": w["aligned_oil"], "fit": w["fit"]} for w in tc["wells"]],
                       "percentile_series": tc["percentile_series"], "fits": tc["fits"],
                       "fit_curves": {k: (typecurve.curve(f) if f else None) for k, f in tc["fits"].items()}}
                if body.get("overrides"):           # the player's hand-adjusted parameters, previewed live
                    adj = {k: dict(v) for k, v in tc["fits"].items() if v}
                    for pct, p in (body["overrides"] or {}).items():
                        if pct in adj and isinstance(p, dict):
                            for k in ("qi", "di", "b", "dmin"):
                                if k in p:
                                    x = float(p[k])
                                    if not (x >= 0 and (k != "qi" or x > 0) and (k != "b" or x <= 2.5)):
                                        return 400, {"ok": False, "errors": [f"overrides.{pct}.{k} out of range"]}
                                    adj[pct][k] = x
                    out["adjusted"] = {"fits": adj, "eur_oil": {k: sum(typecurve.curve(f)) for k, f in adj.items()},
                                       "fit_curves": {k: typecurve.curve(f) for k, f in adj.items()}}
                src = body.get("normalise_to")
                if src is not None and not (isinstance(src, dict) and src.get("geomodel") and src.get("attribute")):
                    return 400, {"ok": False, "errors": ["normalise_to must be {geomodel, attribute}"]}
                geo = career.geology_fit(st, al, src) if (src or body.get("normalise_geology")) else None
                if prox:
                    out["proximity"] = {"analogs": prox, "note": "the nearest producing wells with 6+ months, by distance from mid-lateral"}
                if geo:
                    out["geology"] = geo
                if body.get("save"):
                    career.save_typecurve(st, body["save"], ids, tc, body.get("overrides"), geology=geo)
                    career.save(st)
                    out["saved"] = st["typecurves"][str(body["save"])[:40]]
                return 200, out
            if method == "POST" and path == "/api/career/plan":
                plan = career.check_plan(st, body.get("plan"))
                raw = career.evaluate_plan(st, truth, ts, plan)
                bc = rv = None
                if career.view(st)["budget_needed"]:
                    bc = career.board_check(st, truth, ts, plan)
                    bc["conditions"] = career.board_conditions(st, truth, ts, plan, raw, bc)
                elif st["status"] == "active" and st["plan"] is not None:
                    rv = career.revision(st, truth, ts, plan, bool(body.get("revise_guidance")), body.get("budget_usd"))
                sc = career.scenarios(st, raw, body["scenarios"]) if body.get("scenarios") else None
                pop = career.pop_bands(st, plan)
                for row in raw["pads"]:
                    row.update(pop.get(row["pad"], {}))
                return 200, {"ok": True, "plan": plan, **career.strip_private(raw), "board_check": bc, "revision": rv, "scenarios": sc}
            if method == "POST" and path == "/api/career/budget":
                plan = career.check_plan(st, body.get("plan"))
                d = career.budget_meeting(st, truth, ts, plan)
                career.save(st)
                return 200, {"ok": True, "decision": d, "career": career.view(st)}
            if method == "POST" and path == "/api/career/revise":
                plan = career.check_plan(st, body.get("plan"))
                rv = career.revision(st, truth, ts, plan, bool(body.get("revise_guidance")), body.get("budget_usd"), apply=True)
                if rv["allowed"]:
                    career.save(st)
                return (200 if rv["allowed"] else 400), {"ok": rv["allowed"], "revision": rv, "errors": rv["reasons"], "career": career.view(st)}
            if method == "POST" and path == "/api/career/task/delegate":
                import career_tasks
                try:
                    msg = career_tasks.delegate(st, body.get("task"), truth)
                except ValueError as e:
                    return 400, {"ok": False, "errors": [str(e)]}
                career.save(st, truth)
                return 200, {"ok": True, "outcome": msg, "career": career.view(st)}
            if method == "POST" and path == "/api/career/advance":
                until = bool(body.get("until_event"))
                n = body.get("max_months", 12) if until else body.get("months", 1)
                if not isinstance(n, int) or not 1 <= n <= 12:
                    return 400, {"ok": False, "errors": ["months / max_months must be 1 to 12"]}
                before = len(st["inbox"])
                try:
                    r = career.advance(st, truth, ts, n, until_event=until)
                finally:
                    career.save(st, truth)
                return 200, {"ok": True, "months_advanced": len(r["months"]), "stop": r["stop"],
                             "new_messages": st["inbox"][before:], "career": career.view(st)}
        return 404, {"ok": False, "errors": ["no such endpoint"]}
    except career.CareerError as e:
        return 400, {"ok": False, "errors": [str(e)]}
    except RuntimeError as e:
        return 500, {"ok": False, "errors": [f"simulator: {e}"]}
