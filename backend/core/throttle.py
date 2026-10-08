"""Takroriy xato urinishlarni sekinlashtirish (ip bo'yicha).

Nima uchun alohida modul: bir xil mexanizm ikki joyda kerak —
konsolga kirish (parol taxmin qilish) va API kaliti. Ikkalasida ham
qoida bir xil: bir necha bepul urinish, keyin ikki barobarlanadigan
kutish, uzoq tinchlikdan keyin hisob unutiladi. Chaqiruvchi kutish
muddatini mijozga aytadi (429 + Retry-After) — so'rov ichida uxlamaydi.

Hisob XOTIRADA turadi. Jarayon qayta ishga tushsa nolga qaytadi —
bu ataylab: qulf bazaga yozilsa, shu bilan o'zi DoS quroliga
aylanardi (begona ip nomidan urinib, haqiqiy foydalanuvchini
qulflab qo'yish mumkin bo'lardi). Xotira cheksiz o'smasligi uchun
`limit` dan oshganda eskirgan yozuvlar tozalanadi.

Tarkibi:
    Throttle(free, max_delay, ttl, limit)   ip bo'yicha eksponensial kutish
        .retry_after(ip)    yana urinish uchun necha soniya qolgani (0 — mumkin)
        .note_fail(ip)      xato urinishni hisobga oladi
        .clear(ip)          muvaffaqiyatdan keyin hisobni o'chiradi
    Lockout(max_fails, block_s, ttl, limit)  N xato -> qat'iy blok (kalit ixtiyoriy)
        .retry_after(key)   blok tugashigacha soniya (0 — mumkin)
        .note_fail(key)     -> blokgacha qolgan urinishlar
        .clear(key)

Kim ishlatadi: users/api.py (login: Lockout, 5 xato -> 5 daqiqa, (login, ip)
    bo'yicha — v3 siyosati), app/deps.py (API kaliti: Throttle, free=3,
    ttl=10 daqiqa, max_delay=30 s).
"""
import threading
import time


class Throttle:
    """Ip bo'yicha eksponensial kutish.

    `free` — shu songacha kutish yo'q (odam parolni adashtirishi normal).
    `max_delay` — kutishning yuqori chegarasi.
    `ttl` — shuncha tinch turgan ip hisobi unutiladi.
    """

    def __init__(self, free: int = 5, max_delay: float = 30.0,
                 ttl: float = 3600.0, limit: int = 1000) -> None:
        self.free = free
        self.max_delay = max_delay
        self._ttl = ttl
        self._limit = limit
        self._fails: dict[str, tuple[int, float]] = {}
        self._lock = threading.Lock()

    def retry_after(self, ip: str) -> float:
        """Shu ip yana urinishi uchun necha soniya qolgani (0 — mumkin)."""
        now = time.monotonic()
        with self._lock:
            if len(self._fails) > self._limit:    # xotira cheksiz o'smasin
                for k, (_, t) in list(self._fails.items()):
                    if now - t > self._ttl:
                        self._fails.pop(k, None)
            count, last = self._fails.get(ip, (0, 0.0))
            if now - last > self._ttl or count < self.free:
                return 0.0
            wait = min(2.0 ** (count - self.free), self.max_delay)
            return max(0.0, last + wait - now)

    def note_fail(self, ip: str) -> None:
        now = time.monotonic()
        with self._lock:
            count, last = self._fails.get(ip, (0, 0.0))
            if now - last > self._ttl:
                count = 0
            self._fails[ip] = (count + 1, now)

    def clear(self, ip: str) -> None:
        with self._lock:
            self._fails.pop(ip, None)


class Lockout:
    """Belgilangan sondagi xatodan keyin qat'iy blok (v3 kirish siyosati).

    `max_fails` ta ketma-ket xato -> `block_s` soniya blok. Blok tugagach
    hisob noldan boshlanadi. Kalit chaqiruvchida — kirishda (login, ip):
    bitta ip'dan boshqa loginlarga urinish begona hisobni qulflamaydi,
    begona ip esa haqiqiy foydalanuvchini qulflay olmaydi (uning ip'i
    boshqa). Oxirgi xatodan `ttl` o'tsa hisob unutiladi.

    Hisob XOTIRADA (Throttle bilan bir xil sabab — bazadagi qulf DoS
    quroliga aylanardi).
    """

    def __init__(self, max_fails: int = 5, block_s: float = 300.0,
                 ttl: float = 900.0, limit: int = 5000) -> None:
        self.max_fails = max_fails
        self.block_s = block_s
        self._ttl = ttl
        self._limit = limit
        # kalit -> (xatolar soni, oxirgi xato vaqti, blok tugash vaqti)
        self._fails: dict[tuple, tuple[int, float, float]] = {}
        self._lock = threading.Lock()

    def _get(self, key, now: float) -> tuple[int, float, float]:
        count, last, until = self._fails.get(key, (0, 0.0, 0.0))
        if until and now >= until:                 # blok tugadi — hisob noldan
            self._fails.pop(key, None)
            return 0, 0.0, 0.0
        if not until and now - last > self._ttl:
            return 0, 0.0, 0.0
        return count, last, until

    def retry_after(self, key) -> float:
        """Blok tugashigacha necha soniya (0 — urinish mumkin)."""
        now = time.monotonic()
        with self._lock:
            if len(self._fails) > self._limit:
                for k, (_, last, until) in list(self._fails.items()):
                    if (until and now >= until) or (not until and now - last > self._ttl):
                        self._fails.pop(k, None)
            _, _, until = self._get(key, now)
            return max(0.0, until - now) if until else 0.0

    def note_fail(self, key) -> int:
        """Xatoni hisobga oladi. Qaytadi: blokgacha qolgan urinishlar (0 — blok boshlandi)."""
        now = time.monotonic()
        with self._lock:
            count, _, _ = self._get(key, now)
            count += 1
            until = now + self.block_s if count >= self.max_fails else 0.0
            self._fails[key] = (count, now, until)
            return max(0, self.max_fails - count)

    def clear(self, key) -> None:
        with self._lock:
            self._fails.pop(key, None)
