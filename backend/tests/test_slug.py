from database import cameras, get_db, slugify, unique_slug
from tests.factories import add_camera


def test_slugify_lotin_va_kirill():
    assert slugify("Toshkent Amir Temur") == "toshkent_amir_temur"
    assert slugify("Farg'ona ko'chasi") == "fargona_kochasi"
    assert slugify("Чорсу бозори") == "chorsu_bozori"
    assert slugify("!!!") == "kamera"          # bo'sh qolmaydi
    assert slugify("A--B  C") == "a_b_c"


def test_unique_slug_takrorda_raqam_qoshadi():
    with get_db() as db:
        row_id = add_camera(db, "sinov_slug", name="S", ip=None)
        try:
            assert unique_slug(db, "Sinov Slug") == "sinov_slug_2"
            # o'zining yozuvi hisobga olinmaydi (tahrirlash holati)
            assert unique_slug(db, "Sinov Slug", exclude_id=row_id) == "sinov_slug"
        finally:
            cameras.delete(db, row_id)
