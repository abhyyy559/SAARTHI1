# Demo day, one command: build the app, start the server, and give it an
# HTTPS address phones can open. Phones need HTTPS for the mic, the QR
# scanner, push alerts and "Add to home screen"; plain http://<laptop-ip>
# does not work for any of them.
#
#   powershell -ExecutionPolicy Bypass -File scripts\demo-https.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\demo-https.ps1 -SkipBuild
#
# It prints an https://....trycloudflare.com address and a QR code for it.
# Open THAT address on every device, the laptop too: share QR codes then
# point to it as well. Ctrl+C stops the tunnel and the server.
#
# The address is a Cloudflare "quick tunnel": free, no account, a new
# address each run, and anyone with the address can use the app while it
# runs (chat answers use your Groq and Sarvam keys). Stop it after the demo.
# For a permanent address, deploy with render.yaml + vercel.json instead
# (see docs/DEMO-READY.md).
param([switch]$SkipBuild, [int]$Port = 8003)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
New-Item -ItemType Directory -Force (Join-Path $root 'logs') | Out-Null

$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { $python = 'python' }

# cloudflared: the official Windows build, checked against Cloudflare's
# published SHA-256 before first use.
$cf = Join-Path $root 'tools\cloudflared.exe'
if (-not (Test-Path $cf)) {
    $version = '2026.10.0'
    $sha256 = '86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c'
    Write-Host "Downloading cloudflared $version from github.com/cloudflare ..."
    New-Item -ItemType Directory -Force (Join-Path $root 'tools') | Out-Null
    $url = "https://github.com/cloudflare/cloudflared/releases/download/$version/cloudflared-windows-amd64.exe"
    Invoke-WebRequest -Uri $url -OutFile $cf -UseBasicParsing
    $got = (Get-FileHash $cf -Algorithm SHA256).Hash.ToLower()
    if ($got -ne $sha256) { Remove-Item $cf -Force; throw "cloudflared checksum mismatch ($got)" }
}

if (-not $SkipBuild) {
    Write-Host 'Building the app (frontend-react/dist) ...'
    Push-Location (Join-Path $root 'frontend-react')
    try { npm run build; if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' } } finally { Pop-Location }
}

function Test-Up([int]$p) {
    try { (Invoke-WebRequest -Uri "http://127.0.0.1:$p/api/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $false }
}

$server = $null
if (Test-Up $Port) {
    Write-Host "A server is already running on port $Port; using it (it must serve frontend-react/dist)."
} else {
    Write-Host "Starting the server on port $Port ..."
    $env:PYTHONIOENCODING = 'utf-8'
    $server = Start-Process -FilePath $python -PassThru -NoNewWindow `
        -ArgumentList '-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', "$Port" `
        -RedirectStandardOutput (Join-Path $root 'logs\server.out.log') `
        -RedirectStandardError (Join-Path $root 'logs\server.err.log')
    for ($i = 0; $i -lt 60 -and -not (Test-Up $Port); $i++) { Start-Sleep -Milliseconds 500 }
    if (-not (Test-Up $Port)) { throw 'The server did not start: see logs\server.err.log' }
}

$tunnelLog = Join-Path $root 'logs\tunnel.log'
if (Test-Path $tunnelLog) { Remove-Item $tunnelLog -Force }
Write-Host 'Opening the HTTPS tunnel ...'
$tunnel = Start-Process -FilePath $cf -PassThru -NoNewWindow `
    -ArgumentList 'tunnel', '--no-autoupdate', '--url', "http://127.0.0.1:$Port" `
    -RedirectStandardOutput (Join-Path $root 'logs\tunnel.out.log') -RedirectStandardError $tunnelLog

try {
    $public = $null
    for ($i = 0; $i -lt 90 -and -not $public; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-Path $tunnelLog) {
            $m = Select-String -Path $tunnelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
            if ($m) { $public = $m.Matches[0].Value }
        }
    }
    if (-not $public) { throw 'No tunnel address after 45 s: see logs\tunnel.log' }

    Write-Host ''
    Write-Host "  WeatherGPT is live at:  $public" -ForegroundColor Green
    Write-Host '  Open it on every phone (and on this laptop). Scan:' -ForegroundColor Green
    Push-Location (Join-Path $root 'frontend-react')
    try {
        node -e "require('qrcode').toString(process.argv[1], { type: 'terminal', small: true }).then((q) => console.log(q))" $public
        node -e "require('qrcode').toFile(process.argv[2], process.argv[1], { width: 600, margin: 2 })" $public (Join-Path $root 'logs\app-qr.png')
    } finally { Pop-Location }
    Write-Host "  (QR also saved as logs\app-qr.png.)  Ctrl+C to stop."
    while (-not $tunnel.HasExited) { Start-Sleep -Seconds 2 }
    Write-Host 'The tunnel stopped: see logs\tunnel.log'
} finally {
    if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}
