@echo off
setlocal
cd /d "%~dp0"
title Vodniki local site
powershell.exe -NoLogo -NoProfile -NoExit -ExecutionPolicy Bypass -File "%~dp0start-site.ps1"
endlocal
