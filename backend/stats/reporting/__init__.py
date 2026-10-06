"""Nigoh — statistika hisob qatlami (sof hisob: HTTP, ruxsat yo'q).

Bazadan xom ma'lumot (`database/repositories/reports.py`,
`database/repositories/stats.py`) olinadi, bu yerda ko'rsatkichlarga
aylanadi; HTTP qatlami (`stats/api.py`, `stats/overview.py`) har
ko'rsatkichni alohida endpoint qilib beradi.

    period.py   — davr (oxirgi N kun yoki aniq oraliq) va kuzatuv bo'shliqlari
    engine.py   — har kameraning davrdagi uzilishlari (bitta hisob, keshlanadi)
    metrics.py  — ko'rsatkichlar: uptime, uzilishlar, MTTR, hududlar,
                  reyting, xarita, SLA, kunlik/soatlik, liniya

Asosiy qoidalar (hamma ko'rsatkichda bir xil):

  * kuzatuv bo'shlig'i (server ishlamagan vaqt) uptime'ga ham, uzilish
    davomiyligiga ham kirmaydi — "ma'lumot yo'q" "o'chiq" degani emas;
  * 2 daqiqadan qisqa, tugagan uzilish — "qisqa sakrash", undan uzuni yoki
    hali davom etayotgani — haqiqiy uzilish;
  * MTTR faqat tiklangan haqiqiy uzilishlardan hisoblanadi;
  * vaqt kesimlari mahalliy zonada (NIGOH_TZ).
"""
