$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$siteUrl = 'http://localhost:5173'
$browserJob = $null

try {
  Set-Location -LiteralPath $projectRoot

  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    throw 'Node.js was not found. Install Node.js 22.13 or newer.'
  }

  $versionText = (& node --version).Trim()
  $versionMatch = [regex]::Match($versionText, '^v?(\d+)\.(\d+)\.(\d+)')
  if (-not $versionMatch.Success) {
    throw "Could not detect the Node.js version: $versionText"
  }

  $major = [int]$versionMatch.Groups[1].Value
  $minor = [int]$versionMatch.Groups[2].Value
  if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 13)) {
    throw "Node.js 22.13 or newer is required. Installed version: $versionText."
  }

  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npmCommand) {
    throw 'npm was not found. Reinstall Node.js with npm.'
  }
  $npm = $npmCommand.Source

  $lockFile = Join-Path $projectRoot 'package-lock.json'
  if (-not (Test-Path -LiteralPath $lockFile)) {
    throw 'package-lock.json was not found. Run this script from the project root.'
  }
  $lockHash = (Get-FileHash -LiteralPath $lockFile -Algorithm SHA256).Hash
  $dependencyMarker = Join-Path $projectRoot 'node_modules\.vodniki-lock-hash'
  $dependenciesReady = (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\vinext\dist\cli.js')) -and
    (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\wrangler\bin\wrangler.js')) -and
    (Test-Path -LiteralPath $dependencyMarker) -and
    ((Get-Content -LiteralPath $dependencyMarker -Raw -ErrorAction SilentlyContinue).Trim() -eq $lockHash)

  if (-not $dependenciesReady) {
    Write-Host 'Installing dependencies from package-lock.json (npm ci)...' -ForegroundColor Cyan
    & $npm ci
    if ($LASTEXITCODE -ne 0) {
      throw 'Dependency installation failed.'
    }
    Set-Content -LiteralPath $dependencyMarker -Value $lockHash -NoNewline -Encoding ascii
  }

  $portProbe = $null
  try {
    $portProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 5173)
    $portProbe.Start()
  }
  catch {
    throw 'Port 5173 is already in use. Close the other application and try again.'
  }
  finally {
    if ($portProbe) { $portProbe.Stop() }
  }

  $browserJob = Start-Job -ArgumentList $siteUrl -ScriptBlock {
    param($url)
    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
      try {
        $response = Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing
        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
          Start-Process $url
          return
        }
      }
      catch {
        Start-Sleep -Seconds 1
      }
    }
  }

  Write-Host 'Starting the site. The browser will open when the server is ready.' -ForegroundColor Green
  Write-Host "Site address: $siteUrl" -ForegroundColor Cyan
  Write-Host 'Keep this terminal open. Press Ctrl+C to stop the server.' -ForegroundColor Yellow
  & $npm run dev
  if ($LASTEXITCODE -ne 0) {
    throw "The server exited with code $LASTEXITCODE. See the error above."
  }
}
catch {
  Write-Host ''
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host ''
  Read-Host 'Press Enter to close this window'
}
finally {
  if ($browserJob) {
    Stop-Job -Job $browserJob -ErrorAction SilentlyContinue
    Remove-Job -Job $browserJob -Force -ErrorAction SilentlyContinue
  }
}
