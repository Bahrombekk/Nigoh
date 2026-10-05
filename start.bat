@echo off
chcp 65001 >nul
title Nigoh — kamera xaritasi
cd /d "%~dp0"

echo.
echo   NIGOH — ishga tushmoqda
echo   ------------------------
echo.

if not exist "venv\Scripts\python.exe" (
  echo   [!] venv topilmadi. Avval quyidagini bajaring:
  echo         py -m venv venv
  echo         venv\Scripts\python.exe -m pip install -r backend\requirements.txt
  echo.
  pause
  exit /b 1
)

if not exist "mediamtx\mediamtx.exe" (
  echo   [!] mediamtx\mediamtx.exe topilmadi — video oqimlar ishlamaydi.
  echo       https://github.com/bluenviron/mediamtx/releases dan Windows
  echo       arxivini yuklab, mediamtx\ papkasiga oching.
  echo.
)

echo   [*] Sayt ishga tushmoqda (MediaMTX'ni tizim o'zi ko'taradi)...
start "" http://localhost:8010
venv\Scripts\python.exe backend\main.py
