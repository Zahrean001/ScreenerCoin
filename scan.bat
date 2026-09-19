@echo off
title Trade Screener Coin v2.1.1
color 0F
cls

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [X] Node.js tidak ditemukan.
  echo     Install Node.js LTS dari https://nodejs.org lalu jalankan kembali scan.bat.
  pause
  exit /b 1
)

if not exist "node_modules\tsx\dist\cli.mjs" (
  echo [!] Dependency belum tersedia. Menjalankan npm install...
  call npm.cmd install --no-audit --no-fund
  if errorlevel 1 (
    echo [X] Instalasi dependency gagal. Periksa koneksi internet lalu coba lagi.
    pause
    exit /b 1
  )
)

node node_modules\tsx\dist\cli.mjs scan.ts %*
if errorlevel 1 (
  echo.
  echo [X] Scan gagal. Lihat pesan error di atas untuk detail.
  pause
  exit /b 1
)

echo.
echo ==================================================================================
echo.
echo [V] Scan selesai. Tekan tombol apa saja untuk menutup window ini.
echo [!] Untuk scan ulang / refresh data market, jalankan kembali scan.bat
echo.
pause > nul
