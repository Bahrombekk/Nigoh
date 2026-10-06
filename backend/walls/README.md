# walls/ — server tomonidagi video devor (mozaika)

```
walls/
├─ api.py        POST /walls — tanlovni saqlaydi, bitta mozaika oqimi manzili + katak xaritasi
├─ registry.py   video_walls registri: wall_key, save_wall, load_wall, wall_relays
└─ mosaic.py     grid_for, mosaic_args — FFmpeg xstack buyrug'i
```

Qanday birlashadi: brauzer `POST /walls` yuboradi -> `registry.save_wall`
kalit beradi va API chiptali `wall_<kalit>` manzilini qaytaradi -> MediaMTX
shu yo'l so'ralganda `stream_launcher.py wall_<kalit>` ni chaqiradi ->
`camera/media/launcher.py` (`run_wall`) `registry.wall_relays()` dan har
katakning lokal relay yo'lini oladi va `mosaic.mosaic_args()` bilan FFmpeg'ni
ishga tushiradi. Bir xil tanlov — bitta kalit, bitta oqim.
