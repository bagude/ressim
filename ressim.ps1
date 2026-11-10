# Wrapper: runs bin/ressim.jl with the pinned Julia environment that stage-sim already uses.
# The environment is only read here; nothing is installed or changed in it.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$envDir = Join-Path $here "..\stage-sim\.venv\julia_env"
$julia = Join-Path $envDir "pyjuliapkg\install\bin\julia.exe"
& $julia "--project=$envDir" (Join-Path $here "bin\ressim.jl") @args
exit $LASTEXITCODE
