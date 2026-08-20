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
  echo         venv\Scripts\python.exe -m pip install -r requirements.txt
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  echo   [!] .env topilmadi. .env.example dan nusxa olib, kamera
  echo       mikroservisining manzili va kalitini yozing:
  echo         NIGOH_URL=https://...
  echo         NIGOH_KEY=...
  echo.
  pause
  exit /b 1
)

echo   [*] Sayt ishga tushmoqda (kamera qatlami — mikroservisda)...
start "" http://localhost:8010
venv\Scripts\python.exe main.py
