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

rem Interfeys (React) - build yo'q bo'lsa yig'iladi (Node.js kerak: https://nodejs.org).
rem DIQQAT: if-bloklar ichidagi echo matnida qavs ishlatmang - cmd uni blok oxiri deb oladi.
if exist "frontend\dist\index.html" goto ui_ready
where npm >nul 2>nul
if errorlevel 1 goto ui_no_node
echo   [*] Interfeys yig'ilmoqda, birinchi marta bir necha daqiqa...
pushd frontend
if not exist "node_modules" call npm ci
call npm run build
popd
goto ui_ready
:ui_no_node
echo   [!] frontend\dist topilmadi va Node.js o'rnatilmagan - interfeys ochilmaydi.
echo       Node.js o'rnating yoki boshqa kompyuterda: cd frontend, npm ci, npm run build - keyin dist\ ni ko'chiring.
echo.
:ui_ready

echo   [*] Sayt ishga tushmoqda (MediaMTX'ni tizim o'zi ko'taradi)...
start "" http://localhost:8010
venv\Scripts\python.exe backend\main.py
