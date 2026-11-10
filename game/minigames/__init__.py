"""Minigames. Importing this package registers every game module listed in GAMES (missing modules are skipped)."""
import importlib

from .base import REGISTRY, GameError  # noqa: F401

GAMES = ["pump_job", "flowback", "facility", "lift", "land_auction", "rig_contracts", "hedging", "diagnostics", "well_control",
         "frac_hits", "water"]
LOADED, FAILED = [], {}
for _m in GAMES:
    try:
        importlib.import_module(f".{_m}", __name__)
        LOADED.append(_m)
    except ModuleNotFoundError as e:
        if e.name and e.name.endswith(_m):
            continue
        FAILED[_m] = str(e)
    except Exception as e:  # noqa: BLE001  a broken game must not take the server down
        FAILED[_m] = str(e)
