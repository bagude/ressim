# Frac Challenge

A game built on Ressim. **Illustrative economics; the SPE1 benchmark oil; not a real play.**

```powershell
python game\server.py --open      # or .\game\play.ps1 ; the simulator is ready in about 10 s
```

- **Levels** (`levels.py`): seven one-well puzzles, from stages and half-length up to a budgeted per-stage sandbox. Each run is a real `run_fracwell` simulation (4-15 s) with a pressure-field animation.
- **Career** (`career.py`): five years running an operator's asset team. Hidden rock and real production come from ressim; you see only producing analogs. You build type curves (`typecurve.py`), plan pads, rigs and budgets (`schedule.py`, `opecon.py`), pitch a capital budget to the board, and advance month by month. Forecast vs actual drives board confidence.
- API: `API.md`. Design: `docs/2026-11-09-planning-design.md`. Front end (`web/`) is owned by the ressim-ab session.

Tests: `python -m unittest discover game/tests` (seconds, no Julia).
End to end with the real simulator: `python game/tests/smoke_api.py` and `python game/tests/smoke_career.py`.
Star thresholds: `python game/calibrate.py [level ...]`.
