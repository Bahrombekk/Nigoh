# stats/ — statistika

```
stats/
├─ api.py          GET /stats/* — dashboard, timeline va har ko'rsatkich alohida endpoint (require_user)
├─ overview.py     GET /stats/overview yig'ma hisoboti; states_of, quality
├─ admin_api.py    /admin/uptime, /admin/outages/hourly, /admin/cameras/{ref}/history (require_admin)
├─ recorder.py     StatsRecorder (yagona `service`): har daqiqada holatlar, 5 daqiqalik suratlar
└─ reporting/      sof hisob (HTTP yo'q)
   ├─ period.py    davr (oxirgi N kun / sanalar oralig'i), kuzatuv qamrovi, pct
   ├─ engine.py    har kameraning davrdagi uzilishlari — Snapshot, 60 s kesh
   └─ metrics.py   uptime, uzilishlar, MTTR, hududlar, reyting, xarita, SLA, liniya
```

Qanday birlashadi: `recorder.py` (app/bootstrap.py ishga tushiradi)
`availability_snapshots` va `status_changes` ga yozadi; health va reconciler
`camera_events` ga yozadi. `reporting/engine.py` shu jadvallardan
(`database/repositories/reports.py`) davr bo'yicha `Snapshot` quradi,
`metrics.py` undan ko'rsatkich chiqaradi, `api.py` va `overview.py` javobga
aylantiradi. `admin_api.py` esa `camera_events` ni bevosita o'qiydi.
Qoidalar: kuzatuv bo'shlig'i "o'chiq" emas; 2 daqiqadan qisqa tugagan
uzilish — "qisqa sakrash"; ma'lumot 30 kun saqlanadi.
