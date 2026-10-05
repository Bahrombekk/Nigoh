-- Nigoh bazasi va ilova roli — PostgreSQL o'rnatilgandan keyin BIR MARTA.
--
-- Linux:
--     sudo -u postgres psql -v parol='<NIGOH_DB_PAROL>' -f deploy/postgres/setup-roles.sql
-- Windows:
--     psql -U postgres -p 5434 -v parol=<NIGOH_DB_PAROL> -f deploy\postgres\setup-roles.sql
--
-- Ishlab chiqish mashinasida testlar uchun nigoh_test ham kerak bo'lsa:
--     ... -v test_db=1 ...
--
-- Ilova superuser bilan ulanmaydi. `nigoh` — oddiy rol: faqat o'z bazasiga
-- egalik qiladi, boshqa bazalarni ko'rmaydi, rol yarata olmaydi. Shu bilan
-- ilovadagi biror xato yoki SQL in'ektsiya butun serverni emas, faqat o'z
-- bazasini ko'radi.
--
-- `nigoh_readonly` — odam qo'lda ko'rishi uchun (PyCharm, DBeaver,
-- pgAdmin): faqat SELECT. Tasodifiy DELETE/UPDATE ma'lumotni buzmaydi.
-- Parolini alohida bering: ALTER ROLE nigoh_readonly PASSWORD '...';
\set ON_ERROR_STOP on

CREATE ROLE nigoh LOGIN PASSWORD :'parol'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE nigoh_readonly LOGIN
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

CREATE DATABASE nigoh OWNER nigoh ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE nigoh FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE nigoh TO nigoh;
GRANT CONNECT ON DATABASE nigoh TO nigoh_readonly;

\connect nigoh
-- public sxemasi faqat nigoh'niki: boshqa rollar unda jadval yarata olmaydi.
ALTER SCHEMA public OWNER TO nigoh;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO nigoh_readonly;
-- Ilova keyin yaratadigan jadvallar ham avtomatik faqat o'qishga ochiq.
ALTER DEFAULT PRIVILEGES FOR ROLE nigoh IN SCHEMA public
    GRANT SELECT ON TABLES TO nigoh_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO nigoh_readonly;

\if :{?test_db}
\connect postgres
CREATE DATABASE nigoh_test OWNER nigoh ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE nigoh_test FROM PUBLIC;
\connect nigoh_test
ALTER SCHEMA public OWNER TO nigoh;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
\endif
