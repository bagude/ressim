"""Client for the long-lived Julia worker (worker.jl). One request at a time; thread-safe."""
import csv
import os
import subprocess
import threading
from pathlib import Path

GAME = Path(__file__).resolve().parent
ROOT = GAME.parent
ENV_DIR = ROOT.parent / "stage-sim" / ".venv" / "julia_env"   # read-only, same as ressim.ps1
JULIA = ENV_DIR / "pyjuliapkg" / "install" / "bin" / "julia.exe"


class Worker:
    def __init__(self, log=print):
        self.log = log
        self.lock = threading.Lock()
        self.ready = threading.Event()
        self.proc = None
        self.error = None

    def start(self):
        """Start Julia in the background; `ready` is set once Ressim is compiled (about a minute)."""
        def boot():
            try:
                self.proc = subprocess.Popen(
                    [str(JULIA), f"--project={ENV_DIR}", str(GAME / "worker.jl")],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    text=True, encoding="utf-8", errors="replace", bufsize=1, cwd=str(ROOT))
                msg = self._read_reply()
                if msg != "READY":
                    raise RuntimeError(f"worker failed to start: {msg}")
                self.ready.set()
                self.log("simulator ready")
            except Exception as e:  # surfaced through status()
                self.error = str(e)
                self.log(f"worker error: {e}")
        threading.Thread(target=boot, daemon=True).start()

    def _read_reply(self):
        for line in self.proc.stdout:
            if line.startswith("@@"):
                return line[2:].strip()
        raise RuntimeError("worker exited")

    def status(self):
        if self.error:
            return "error"
        return "ready" if self.ready.is_set() else "warming"

    def run(self, spec_path, outdir, oil_rate_target=None):
        """Run one spec. Returns (seconds, cells). Raises RuntimeError on a simulator error."""
        if not self.ready.wait(timeout=600):
            raise RuntimeError(self.error or "simulator still starting")
        target = "-" if oil_rate_target is None else f"{oil_rate_target:.6g}"
        with self.lock:
            self.proc.stdin.write(f"RUN\t{spec_path}\t{outdir}\t{target}\n")
            self.proc.stdin.flush()
            msg = self._read_reply()
        if not msg.startswith("OK"):
            raise RuntimeError(msg[4:] if msg.startswith("ERR") else msg)
        _, secs, cells = msg.split()
        return float(secs), int(cells)

    def call(self, kind, data, outdir):
        """Minigame physics in the worker (kinds: grow, bhpsched, marching, field). Returns the parsed JSON result."""
        if not self.ready.wait(timeout=600):
            raise RuntimeError(self.error or "simulator still starting")
        outdir = Path(outdir)
        outdir.mkdir(parents=True, exist_ok=True)
        inp, outp = outdir / f"{kind}.toml", outdir / f"{kind}.json"
        inp.write_text(toml_dumps(data), encoding="utf-8")
        with self.lock:
            self.proc.stdin.write(f"CALL\t{kind}\t{inp}\t{outp}\n")
            self.proc.stdin.flush()
            msg = self._read_reply()
        if not msg.startswith("OK"):
            raise RuntimeError(msg[4:] if msg.startswith("ERR") else msg)
        import json
        return json.loads(outp.read_text())

    def stop(self):
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.stdin.write("QUIT\n"); self.proc.stdin.flush()
                self.proc.wait(timeout=10)
            except Exception:
                self.proc.kill()


def write_spec(path, spec):
    """Write a FracWellSpec as TOML (only numbers, strings and lists of numbers)."""
    def val(v):
        if isinstance(v, str):
            return '"' + v.replace('"', "") + '"'
        if isinstance(v, (list, tuple)):
            return "[" + ", ".join(val(x) for x in v) + "]"
        if isinstance(v, bool):
            raise TypeError("no booleans in a spec")
        if isinstance(v, int):
            return str(v)
        return repr(float(v))
    Path(path).write_text("".join(f"{k} = {val(v)}\n" for k, v in spec.items()), encoding="utf-8")


def toml_value(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return repr(v)
    if isinstance(v, str):
        return '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(toml_value(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ", ".join(f"{k} = {toml_value(x)}" for k, x in v.items() if x is not None) + "}"
    raise TypeError(f"cannot write {type(v).__name__} to TOML")


def toml_dumps(d):
    """Top-level keys, one per line; nested tables and arrays of tables written inline (valid TOML 1.0)."""
    return "".join(f"{k} = {toml_value(v)}\n" for k, v in d.items() if v is not None)


def read_summary(outdir):
    """Field rates from summary_field.csv as lists: time_days, oil_stb_d, gas_mscf_d, water_stb_d."""
    t, o, g, w = [], [], [], []
    with open(os.path.join(outdir, "summary_field.csv"), newline="") as f:
        r = csv.DictReader(f)
        for row in r:
            t.append(float(row["time_days"]))
            o.append(float(row["FIELD:oil_prod_stb_d"]))
            g.append(float(row["FIELD:gas_prod_mscf_d"]))
            w.append(float(row["FIELD:water_prod_stb_d"]))
    return t, o, g, w


def read_stages(outdir):
    with open(os.path.join(outdir, "stages.csv"), newline="") as f:
        return [{k: float(v) for k, v in row.items()} for row in csv.DictReader(f)]
