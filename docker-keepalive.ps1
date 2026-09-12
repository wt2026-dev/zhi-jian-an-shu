# ============================================
# Industrial Maintenance - Docker KeepAlive v4
# ASCII-only script (avoid GBK/UTF-8 path issues)
# Runs every 2 minutes via Windows Task Scheduler
# v4: NEVER kills processes. Only checks WSL state
# and starts Docker Desktop when it is stopped.
# ============================================
$log = Join-Path $env:USERPROFILE "industrial-keepalive.log"

function Log($msg) {
    Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg) -Encoding UTF8
}

try {
    # Step 1: Check if WSL docker-desktop distro is running
    $wslState = wsl.exe -l -v 2>$null | Out-String
    $distroStopped = $wslState -match "docker-desktop\s+Stopped"

    if ($distroStopped) {
        # WSL VM is stopped -> Docker engine is down. Start Docker Desktop (do NOT kill anything)
        Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
        Log "WSL docker-desktop stopped, started Docker Desktop"
    } else {
        # Step 2: Engine seems alive, verify backend; restart app container if needed
        docker ps 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            try {
                $r = Invoke-WebRequest -Uri "http://localhost:3000/" -TimeoutSec 3 -UseBasicParsing
                if ($r.StatusCode -ne 200) {
                    docker start industrial-maintenance-app 2>$null | Out-Null
                    Log "Backend HTTP $($r.StatusCode), restarted app container"
                }
            } catch {
                docker start industrial-maintenance-app 2>$null | Out-Null
                Log "Backend HTTP failed, restarted app container"
            }
        } else {
            # Engine CLI failed but WSL not reported stopped (starting up?) - do nothing, wait for next cycle
            Log "WSL alive but engine CLI failed (likely starting), skipped this cycle"
        }
    }
} catch {
    Log ("KeepAlive error: " + $_.Exception.Message)
}
