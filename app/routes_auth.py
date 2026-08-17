"""Nigoh — autentifikatsiya endpointlari."""
from fastapi import APIRouter, HTTPException, Request, Response

from core import security
from core.db import get_db

from .models import LoginIn

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
def login(body: LoginIn, response: Response):
    with get_db() as db:
        security.purge_expired_sessions(db)
        row = db.execute(
            "SELECT id, username, pw_hash, pw_salt FROM admins WHERE username = ?",
            (body.username,),
        ).fetchone()
        if row is None or not security.verify_password(
            body.password, row["pw_hash"], row["pw_salt"]
        ):
            raise HTTPException(401, "Login yoki parol noto'g'ri")
        token = security.create_session(db, row["id"])
        username = row["username"]

    response.set_cookie(
        security.SESSION_COOKIE, token, httponly=True, samesite="lax",
        max_age=security.SESSION_HOURS * 3600, path="/",
    )
    return {"username": username}


@router.post("/logout")
def logout(request: Request, response: Response):
    with get_db() as db:
        security.delete_session(db, request.cookies.get(security.SESSION_COOKIE))
    response.delete_cookie(security.SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(request: Request):
    token = request.cookies.get(security.SESSION_COOKIE)
    with get_db() as db:
        admin = security.session_admin(db, token)
    if admin is None:
        return {"authenticated": False}
    return {"authenticated": True, "username": admin["username"]}
