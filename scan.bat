@echo off
title Trade Screener Coin v2.0
color 0F
cls

set NODE_TLS_REJECT_UNAUTHORIZED=0

cd /d "%~dp0"
node node_modules\tsx\dist\cli.mjs scan.ts %*

echo.
echo ==================================================================================
echo.
echo [V] Scan selesai. Tekan tombol apa saja untuk menutup window ini.
echo [!] Untuk scan ulang / refresh data market, jalankan kembali scan.bat
echo.
pause > nul
