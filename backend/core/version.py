"""Nigoh versiyasi — yagona manba (semantik: KATTA.KICHIK.TUZATISH).

Butun loyiha (backend, interfeys, git tag) shu raqam bilan yuradi. Fayl
tuzilmasi, baza bilan ishlash qatlami va API'lar shu versiyaga mos keladi —
versiya o'zgarsa, nima o'zgargani git tag izohida yoziladi.

KATTA — mos kelmaydigan o'zgarish (masalan baza sxemasi), KICHIK — yangi
imkoniyat, TUZATISH — xato tuzatish va ichki qayta qurish. Chiqarishda git
tag ham shu bilan bir xil bo'ladi (v2.2.0).

    2.2.0  kamera guruhlari, Sozlamalar sahifasi (super admin, sayt
           sozlamalari bazada, audit), markalar statistikasi, kamera paneli
           (pasport, ishonchlilik, tarix), holat qoidasi, temir yo'l v2 (OSM)
    2.1.1  backend mavzu bo'yicha qayta qurildi (app/, database/, camera/,
           stats/, users/, walls/), repozitoriy va xizmatlar klass, log tizimi
    2.1.0  dashboard v2: SLA, uzilish turlari, liniya, xarita, ma'lumot sifati
    2.0.0  PostgreSQL, sxema v2

Tarkibi:
    VERSION     joriy versiya satri

Kim ishlatadi: app/factory.py (OpenAPI versiyasi), app/system_api.py
    (/admin/status — faqat kirganlarga; ochiq /health uni bermaydi).
"""
VERSION = "2.2.0"
