# PostgreSQL ma'lumot katalogini loyiha ichiga ko'chirish:
#     C:\Program Files\PostgreSQL\17\data  ->  backend\database\pgdata
#
# Ishga tushirish (PowerShell, ADMINISTRATOR sifatida):
#     powershell -ExecutionPolicy Bypass -File backend\database\scripts\move_pgdata.ps1           # reja (hech narsa o'zgarmaydi)
#     powershell -ExecutionPolicy Bypass -File backend\database\scripts\move_pgdata.ps1 -Apply    # ko'chirish
#     powershell -ExecutionPolicy Bypass -File backend\database\scripts\move_pgdata.ps1 -Rollback # eski joyga qaytarish
#
# Nima qiladi (-Apply):
#   1. Zaxira: pg_dump -> backend\database\backups\nigoh-<vaqt>-pgdata-oldidan.dump
#   2. Servisni to'xtatadi (Nigoh serveri bu paytda bazaga ulana olmaydi, ~1 daqiqa).
#   3. Katalogni nusxalaydi (robocopy) — ESKI KATALOG O'CHIRILMAYDI, orqaga qaytish uchun turadi.
#   4. Servis hisobiga (NT AUTHORITY\NetworkService) yangi katalogga to'liq ruxsat beradi.
#   5. Servisni yangi katalogga yo'naltiradi (sc.exe config ... -D <yangi>) va ishga tushiradi.
#   6. Tekshiradi: ulanish ishlaydi va data_directory haqiqatan yangi joy.
#   Biror qadam yiqilsa — servis eski katalog bilan qayta ishga tushiriladi.
#
# Eslatma: pgdata git'ga tushmaydi (.gitignore). Loyiha papkasi zaxiralansa,
# ishlab turgan pgdata'dan fayl nusxasi YAROQLI ZAXIRA EMAS — zaxira uchun
# faqat backup.sh / pg_dump ishlating.
param([switch]$Apply, [switch]$Rollback)
$ErrorActionPreference = "Stop"

$Service = "postgresql-x64-17"
$PgBin   = "C:\Program Files\PostgreSQL\17\bin"
$OldDir  = "C:\Program Files\PostgreSQL\17\data"
$NewDir  = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path + "\pgdata"
$Account = "NT AUTHORITY\NetworkService"
$BinPath = { param($dir) "`"$PgBin\pg_ctl.exe`" runservice -N `"$Service`" -D `"$dir`" -w" }

function Step($text) { Write-Host "-- $text" -ForegroundColor Cyan }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$svc = Get-CimInstance Win32_Service -Filter "Name='$Service'"
if (-not $svc) { throw "Servis topilmadi: $Service" }
Write-Host "Servis:   $($svc.State), hisob $($svc.StartName)"
Write-Host "Hozir:    $($svc.PathName)"
Write-Host "Eski:     $OldDir"
Write-Host "Yangi:    $NewDir"

if ($Rollback) {
    if (-not $isAdmin) { throw "Administrator sifatida ishga tushiring." }
    Step "Servis eski katalogga qaytarilmoqda"
    Stop-Service $Service
    & sc.exe config $Service binPath= (& $BinPath $OldDir) | Out-Null
    Start-Service $Service
    Write-Host "Tayyor: servis $OldDir dan ishlayapti. Yangi katalog o'chirilmadi: $NewDir"
    exit 0
}

if (-not $Apply) {
    Write-Host "`nReja (o'zgartirish uchun -Apply):"
    Write-Host "  1. pg_dump zaxira"
    Write-Host "  2. Stop-Service $Service"
    Write-Host "  3. robocopy `"$OldDir`" `"$NewDir`" /E"
    Write-Host "  4. icacls `"$NewDir`" /grant `"$Account`":(OI)(CI)F"
    Write-Host "  5. sc.exe config $Service binPath= ... -D `"$NewDir`""
    Write-Host "  6. Start-Service + tekshiruv"
    exit 0
}

if (-not $isAdmin) { throw "Administrator sifatida ishga tushiring (servis va ruxsatlar o'zgaradi)." }
if ($svc.PathName -like "*$NewDir*") { Write-Host "Allaqachon ko'chirilgan."; exit 0 }
if ((Test-Path $NewDir) -and (Get-ChildItem $NewDir -Force | Select-Object -First 1)) {
    throw "$NewDir bo'sh emas — avvalgi urinish qoldig'i bo'lishi mumkin, tekshiring."
}

# .env dan DATABASE_URL (zaxira va tekshiruv uchun)
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$dbUrl = (Get-Content "$root\.env" | Where-Object { $_ -match '^DATABASE_URL=' }) -replace '^DATABASE_URL=', ''
if (-not $dbUrl) { throw ".env da DATABASE_URL yo'q" }

Step "1. Zaxira (pg_dump)"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dump = "$root\backend\database\backups\nigoh-$stamp-pgdata-oldidan.dump"
New-Item -ItemType Directory -Force (Split-Path $dump) | Out-Null
& "$PgBin\pg_dump.exe" --format=custom --file $dump --dbname $dbUrl
if ($LASTEXITCODE) { throw "pg_dump yiqildi" }
Write-Host "   $dump"

Step "2. Servisni to'xtatish"
Stop-Service $Service

try {
    Step "3. Nusxalash"
    New-Item -ItemType Directory -Force $NewDir | Out-Null
    & robocopy $OldDir $NewDir /E /COPY:DAT /R:2 /W:2 /NFL /NDL /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy xatosi: $LASTEXITCODE" }

    Step "4. Ruxsat: $Account"
    & icacls $NewDir /grant "${Account}:(OI)(CI)F" /T /Q | Out-Null
    if ($LASTEXITCODE) { throw "icacls yiqildi" }

    Step "5. Servisni yangi katalogga yo'naltirish"
    & sc.exe config $Service binPath= (& $BinPath $NewDir) | Out-Null
    if ($LASTEXITCODE) { throw "sc.exe config yiqildi" }

    Step "6. Ishga tushirish va tekshirish"
    Start-Service $Service
    Start-Sleep -Seconds 3
    $dir = & "$PgBin\psql.exe" -d $dbUrl -t -A -c "SHOW data_directory"
    # PostgreSQL yo'lni "C:/..." ko'rinishida qaytarishi mumkin — solishtirishdan oldin bir xillashtiriladi.
    $got = "$dir".Trim().Replace("/", "\").TrimEnd("\")
    if ($LASTEXITCODE -or ($got -ine $NewDir.TrimEnd("\"))) { throw "Tekshiruv: data_directory = '$dir'" }
    Write-Host "`nTAYYOR. Baza endi shu yerdan ishlayapti: $NewDir" -ForegroundColor Green
    Write-Host "Eski katalog o'chirilmadi ($OldDir). Bir necha kun muammosiz ishlagach qo'lda o'chirishingiz mumkin."
}
catch {
    Write-Host "`nXATO: $_" -ForegroundColor Red
    Write-Host "Eski katalog bilan qayta ishga tushirilmoqda..."
    & sc.exe config $Service binPath= (& $BinPath $OldDir) | Out-Null
    Start-Service $Service
    Write-Host "Servis eski joydan ishlayapti; o'zgarish bekor qilindi."
    exit 1
}
