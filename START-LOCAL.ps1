param(
  [int]$Port = 5173
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Не найден $Name. Установите Node.js 22.13+ и повторите запуск."
  }
}

try {
  Require-Command "node"
  Require-Command "npm"

  $nodeVersion = (& node -p "process.versions.node").Trim()
  $major = [int](($nodeVersion -split "\.")[0])
  if ($major -lt 22) {
    throw "Требуется Node.js 22.13 или новее. Сейчас установлена версия $nodeVersion."
  }

  if (-not (Test-Path -LiteralPath "node_modules")) {
    Write-Host "Устанавливаю зависимости..." -ForegroundColor Cyan
    npm ci
  }

  if (-not (Test-Path -LiteralPath ".dev.vars")) {
    Write-Host "Локальная конфигурация будет создана автоматически при подготовке базы." -ForegroundColor DarkCyan
  }

  Write-Host "Запускаю сайт на http://localhost:$Port" -ForegroundColor Green
  $env:PORT = "$Port"
  npm run dev -- --port $Port
}
catch {
  Write-Host ""
  Write-Host "Запуск не выполнен: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Окно оставлено открытым. Исправьте указанную проблему и запустите файл снова." -ForegroundColor Yellow
  Read-Host "Нажмите Enter для выхода"
  exit 1
}
finally {
  if ($Host.Name -notmatch "ISE") {
    Write-Host ""
    Write-Host "Сервер остановлен. Для повторного запуска выполните: .\START-LOCAL.ps1" -ForegroundColor DarkGray
  }
}
