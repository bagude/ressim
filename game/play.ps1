# Start Frac Challenge and open it in the browser. Ctrl+C to stop.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
python (Join-Path $here "server.py") --open @args
