"""Nigoh — server tomonidagi video devor (mozaika).

    api.py        POST /walls — tanlovni saqlaydi, bitta mozaika oqimi manzilini qaytaradi
    registry.py   tanlov registri (video_walls jadvali), kalit va relay yo'llari
    mosaic.py     FFmpeg buyrug'ini quradi (xstack setka)

Qanday birlashadi: brauzer `POST /walls` bilan kameralar tanlovini
yuboradi -> registry kalit beradi (`wall_<kalit>` yo'li, chipta bilan) ->
MediaMTX shu yo'l so'ralganda `stream_launcher.py wall_<kalit>` ni
chaqiradi -> camera/media/launcher.py `registry.wall_relays()` dan har
katakning lokal relay yo'lini oladi va `mosaic.mosaic_args()` bilan
FFmpeg'ni ishga tushiradi. Bir xil tanlov — bitta kalit, bitta oqim,
server bir marta kodlaydi.
"""
