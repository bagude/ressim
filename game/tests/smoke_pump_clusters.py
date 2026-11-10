"""Pump the Job with clusters on the real simulator: one cluster, four with big holes, four with limited entry.
Run from ressim/: python game/tests/smoke_pump_clusters.py"""
import sys
import time
from pathlib import Path

GAME = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(GAME))
import field  # noqa: E402
import sim  # noqa: E402
from minigames import base  # noqa: E402

JOB = {"fluid": "slickwater", "rate_bpm": 15, "minutes": 60, "sand": "100_mesh", "schedule": [[0.25, 0.5], [0.5, 1.0], [0.75, 1.5]]}
w = sim.Worker()
w.start()
try:
    ctx_sim = field.TruthSim(w)
    for label, extra in (("1 cluster crosslinked", {"clusters": 1, "fluid": "crosslinked"}), ("1 cluster", {"clusters": 1}), ("6 clusters, 4 shots", {"clusters": 6, "shots_per_cluster": 4, "rate_bpm": 15}), ("4 clusters, 24 shots (big holes)", {"clusters": 4, "shots_per_cluster": 24}),
                         ("4 clusters, 3 shots (limited entry)", {"clusters": 4, "shots_per_cluster": 3})):
        st = base.new_state("pump-job", {"seed": 11})
        g = base.REGISTRY["pump-job"]
        ctx = base.Ctx(w, ctx_sim, base.store_dir("pump-job") / st["id"])
        g.new(st, {}, ctx)
        t0 = time.time()
        ev = g.act(st, "pump", dict(JOB, **extra), ctx)
        v = g.view(st)["view"]
        r = st["result"]
        print(f"{label}: {time.time() - t0:.0f} s, stars {r['stars']}, {r['headline']}")
        for e in ev[:2]:
            print("   ", e)
        if v.get("clusters"):
            assert abs(sum(c["fluid_share"] for c in v["clusters"]) - 1.0) < 0.02
            assert len(st["production"]["stage"]["oil"]) == 120 and st["production"]["fractures_per_stage"] == len(v["clusters"])
        (base.store_dir("pump-job") / f"{st['id']}.json").unlink(missing_ok=True)
    print("pump clusters smoke OK")
finally:
    w.stop()
