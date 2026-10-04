import asyncio
import math
import os
from datetime import datetime, timedelta, timezone
from functools import wraps

from jose import JWTError, jwt
from passlib.context import CryptContext
from quart import Quart, jsonify, request

from db import COLUMN_MIGRATIONS, SCHEMA, connect
from rules import (
    DEFAULT_BASE_DISTANCE_MM,
    ConversionError,
    displacement_to_yaw,
    judge,
    resolve_inputs,
    validate_base_distance,
)

SECRET = os.environ.get("JWT_SECRET", "yaw-align-dev-secret")
pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

USERS = {
    "technician": {
        "role": "writer",
        "password_hash": pwd.hash("tech123456"),
    },
    "observer": {
        "role": "reader",
        "password_hash": pwd.hash("obs123456"),
    },
}

app = Quart(__name__)


def _run_db(fn, *args, **kwargs):
    return fn(*args, **kwargs)


async def run_db(fn, *args, **kwargs):
    return await asyncio.to_thread(_run_db, fn, *args, **kwargs)


def init_schema(conn):
    conn.execute(SCHEMA)
    for stmt in COLUMN_MIGRATIONS:
        conn.execute(stmt)


def get_params_row(conn):
    return conn.execute("SELECT * FROM yaw_params WHERE id = 1").fetchone()


def seed_if_empty(conn):
    init_schema(conn)
    now = datetime.now(timezone.utc)

    if get_params_row(conn) is None:
        conn.execute(
            """INSERT INTO yaw_params (id, base_distance_mm, updated_by, updated_at)
               VALUES (1, %s, 'system', %s)""",
            (DEFAULT_BASE_DISTANCE_MM, now),
        )

    count = conn.execute("SELECT COUNT(*) AS n FROM yaw_logs").fetchone()["n"]
    if count > 0:
        return
    samples = [
        ("W01", 0.4, "合格"),
        ("W07", 3.2, "偏航超差"),
    ]
    for code, err, expected_verdict in samples:
        verdict, reason = judge(err)
        assert verdict == expected_verdict
        row = conn.execute(
            """INSERT INTO yaw_logs
               (turbine_code, yaw_err_deg, mode, direct_yaw_err_deg,
                status, verdict, reason, created_by, created_at, processed_at)
               VALUES (%s, %s, 'direct', %s, 'done', %s, %s, %s, %s, %s)
               RETURNING id""",
            (code, err, err, verdict, reason, "technician", now, now),
        ).fetchone()
        conn.execute(
            """INSERT INTO conversion_entries
               (log_id, turbine_code, mode, input_kind, direct_yaw_err_deg,
                yaw_err_deg, verdict, reason, note, created_by, created_at)
               VALUES (%s, %s, 'direct', 'direct', %s, %s, %s, %s, %s, %s, %s)""",
            (
                row["id"],
                code,
                err,
                err,
                verdict,
                reason,
                "种子数据：直填偏航误差",
                "technician",
                now,
            ),
        )


@app.before_serving
async def startup():
    def init():
        with connect() as conn:
            seed_if_empty(conn)
            conn.commit()

    await run_db(init)


def parse_bearer():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


async def current_user():
    token = parse_bearer()
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET, algorithms=["HS256"])
    except JWTError:
        return None
    sub = payload.get("sub")
    if sub not in USERS:
        return None
    return {"username": sub, "role": payload.get("role")}


def require_login(handler):
    @wraps(handler)
    async def wrapper(*args, **kwargs):
        user = await current_user()
        if user is None:
            return jsonify({"detail": "未登录"}), 401
        return await handler(user, *args, **kwargs)

    return wrapper


def require_writer(handler):
    @wraps(handler)
    async def wrapper(*args, **kwargs):
        user = await current_user()
        if user is None:
            return jsonify({"detail": "未登录"}), 401
        if user["role"] != "writer":
            return jsonify({"detail": "仅现场技师可操作该功能"}), 403
        return await handler(user, *args, **kwargs)

    return wrapper


def parse_optional_number(body, key, label) -> float | None:
    """缺省/空串视为未填；非数字给出清楚退回话术。"""
    if key not in body:
        return None
    raw = body.get(key)
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise ConversionError(f"{label}必须是数字（收到：{raw!r}）")
    if not math.isfinite(value):
        raise ConversionError(f"{label}必须是有限数字（收到：{raw!r}）")
    return value


def serialize_entry(row) -> dict:
    return {
        "id": row["id"],
        "log_id": row["log_id"],
        "turbine_code": row["turbine_code"],
        "mode": row["mode"],
        "input_kind": row["input_kind"],
        "displacement_mm": row["displacement_mm"],
        "base_distance_mm": row["base_distance_mm"],
        "direct_yaw_err_deg": row["direct_yaw_err_deg"],
        "yaw_err_deg": row["yaw_err_deg"],
        "verdict": row["verdict"],
        "reason": row["reason"],
        "note": row["note"],
        "created_by": row["created_by"],
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
    }


def describe_resolution(resolved: dict, input_kind: str) -> str:
    if input_kind == "both":
        return (
            "双路核对一致：位移换算与直填误差均为 "
            f"{resolved['yaw_err_deg']:.4f}°"
        )
    if resolved["mode"] == "displacement":
        return (
            f"弦线位移 {resolved['displacement_mm']:g} mm ÷ 基距 "
            f"{resolved['base_distance_mm']:g} mm，atan 换算得 "
            f"{resolved['yaw_err_deg']:.4f}°"
        )
    return f"直填偏航误差 {resolved['yaw_err_deg']:.4f}°"


LOG_COLUMNS = """id, turbine_code, yaw_err_deg, status, verdict, reason,
    created_by, created_at, processed_at, mode, displacement_mm,
    base_distance_mm, direct_yaw_err_deg"""


@app.get("/api/health")
async def health():
    return jsonify({"status": "ok", "service": "yaw-align-log"})


@app.post("/api/auth/login")
async def login():
    body = await request.get_json(force=True, silent=True) or {}
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    user = USERS.get(username)
    if not user or not pwd.verify(password, user["password_hash"]):
        return jsonify({"detail": "用户名或密码错误"}), 401
    exp = datetime.now(timezone.utc) + timedelta(hours=8)
    token = jwt.encode(
        {"sub": username, "role": user["role"], "exp": exp},
        SECRET,
        algorithm="HS256",
    )
    return jsonify(
        {
            "access_token": token,
            "username": username,
            "role": user["role"],
        }
    )


@app.get("/api/logs")
@require_login
async def list_logs(user):
    def query():
        with connect() as conn:
            return conn.execute(
                f"""SELECT {LOG_COLUMNS}
                    FROM yaw_logs ORDER BY id DESC"""
            ).fetchall()

    rows = await run_db(query)
    return jsonify(
        [
            {
                **{k: v for k, v in row.items() if k not in ("created_at", "processed_at")},
                "created_at": row["created_at"].isoformat() if row["created_at"] else None,
                "processed_at": row["processed_at"].isoformat()
                if row["processed_at"]
                else None,
            }
            for row in rows
        ]
    )


@app.post("/api/logs")
@require_writer
async def create_log(user):
    body = await request.get_json(force=True, silent=True) or {}
    turbine_code = (body.get("turbine_code") or "").strip()
    if not turbine_code:
        return jsonify({"detail": "机组编号不能为空"}), 400

    try:
        displacement_mm = parse_optional_number(
            body, "displacement_mm", "弦线位移"
        )
        yaw_err_deg = parse_optional_number(body, "yaw_err_deg", "偏航误差")
    except ConversionError as exc:
        return jsonify({"detail": exc.detail}), 400

    now = datetime.now(timezone.utc)

    def insert():
        # 校验、换算、入队、流水全部在同一个数据库事务内：
        # 任何一步非法/越界都整体回滚，不会出现「进了单却没流水」或反之。
        with connect() as conn:
            init_schema(conn)
            params = get_params_row(conn)
            base = params["base_distance_mm"] if params else None
            try:
                resolved = resolve_inputs(displacement_mm, yaw_err_deg, base)
            except ConversionError as exc:
                conn.rollback()
                return {"error": exc.detail}

            input_kind = "both" if displacement_mm is not None and yaw_err_deg is not None else (
                "displacement" if displacement_mm is not None else "direct"
            )
            angle = resolved["yaw_err_deg"]
            note = describe_resolution(resolved, input_kind)

            with conn.transaction():
                log_row = conn.execute(
                    """INSERT INTO yaw_logs
                       (turbine_code, yaw_err_deg, status, verdict, reason,
                        created_by, created_at, mode, displacement_mm,
                        base_distance_mm, direct_yaw_err_deg)
                       VALUES (%s, %s, 'pending', NULL, NULL, %s, %s, %s, %s, %s, %s)
                       RETURNING """ + LOG_COLUMNS,
                    (
                        turbine_code,
                        angle,
                        user["username"],
                        now,
                        resolved["mode"],
                        resolved["displacement_mm"],
                        resolved["base_distance_mm"],
                        yaw_err_deg,
                    ),
                ).fetchone()
                entry_row = conn.execute(
                    """INSERT INTO conversion_entries
                       (log_id, turbine_code, mode, input_kind, displacement_mm,
                        base_distance_mm, direct_yaw_err_deg, yaw_err_deg,
                        verdict, reason, note, created_by, created_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NULL, NULL, %s, %s, %s)
                       RETURNING *""",
                    (
                        log_row["id"],
                        turbine_code,
                        resolved["mode"],
                        input_kind,
                        resolved["displacement_mm"],
                        resolved["base_distance_mm"],
                        yaw_err_deg,
                        angle,
                        note,
                        user["username"],
                        now,
                    ),
                ).fetchone()
            conn.commit()
            return {"log": log_row, "entry": entry_row}

    result = await run_db(insert)
    if "error" in result:
        return jsonify({"detail": result["error"]}), 400

    log_row = result["log"]
    log_out = {
        **{k: v for k, v in log_row.items() if k not in ("created_at", "processed_at")},
        "created_at": log_row["created_at"].isoformat(),
        "processed_at": None,
    }
    return jsonify({"log": log_out, "entry": serialize_entry(result["entry"])}), 201


@app.get("/api/params")
@require_login
async def get_params(user):
    def query():
        with connect() as conn:
            init_schema(conn)
            row = get_params_row(conn)
            return row

    row = await run_db(query)
    if row is None:
        return jsonify({"base_distance_mm": DEFAULT_BASE_DISTANCE_MM, "configured": False})
    return jsonify(
        {
            "base_distance_mm": row["base_distance_mm"],
            "updated_by": row["updated_by"],
            "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
            "configured": True,
        }
    )


@app.put("/api/params")
@require_writer
async def update_params(user):
    body = await request.get_json(force=True, silent=True) or {}
    try:
        base = parse_optional_number(body, "base_distance_mm", "基距")
    except ConversionError as exc:
        return jsonify({"detail": exc.detail}), 400
    if base is None:
        return jsonify({"detail": "基距不能为空"}), 400
    try:
        validate_base_distance(base)
    except ConversionError as exc:
        return jsonify({"detail": exc.detail}), 400

    now = datetime.now(timezone.utc)

    def upsert():
        with connect() as conn:
            init_schema(conn)
            with conn.transaction():
                conn.execute(
                    """INSERT INTO yaw_params (id, base_distance_mm, updated_by, updated_at)
                       VALUES (1, %s, %s, %s)
                       ON CONFLICT (id) DO UPDATE
                       SET base_distance_mm = EXCLUDED.base_distance_mm,
                           updated_by = EXCLUDED.updated_by,
                           updated_at = EXCLUDED.updated_at""",
                    (base, user["username"], now),
                )
                row = get_params_row(conn)
            conn.commit()
            return row

    row = await run_db(upsert)
    return jsonify(
        {
            "base_distance_mm": row["base_distance_mm"],
            "updated_by": row["updated_by"],
            "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
            "configured": True,
        }
    )


@app.post("/api/conversions/preview")
@require_login
async def preview_conversion(user):
    """换算专页试算：填位移或直填误差（或两路并填核对），不落库。"""
    body = await request.get_json(force=True, silent=True) or {}
    try:
        displacement_mm = parse_optional_number(body, "displacement_mm", "弦线位移")
        yaw_err_deg = parse_optional_number(body, "yaw_err_deg", "偏航误差")
        base = parse_optional_number(body, "base_distance_mm", "基距")
    except ConversionError as exc:
        return jsonify({"detail": exc.detail}), 400

    def compute():
        with connect() as conn:
            init_schema(conn)
            params = get_params_row(conn)
            return params["base_distance_mm"] if params else None

    effective_base = base if base is not None else await run_db(compute)

    try:
        resolved = resolve_inputs(displacement_mm, yaw_err_deg, effective_base)
    except ConversionError as exc:
        return jsonify({"detail": exc.detail}), 400

    angle = resolved["yaw_err_deg"]
    verdict, reason = judge(angle)
    input_kind = (
        "both"
        if displacement_mm is not None and yaw_err_deg is not None
        else ("displacement" if displacement_mm is not None else "direct")
    )
    return jsonify(
        {
            "mode": resolved["mode"],
            "input_kind": input_kind,
            "displacement_mm": resolved["displacement_mm"],
            "base_distance_mm": resolved["base_distance_mm"],
            "direct_yaw_err_deg": yaw_err_deg,
            "yaw_err_deg": angle,
            "verdict": verdict,
            "reason": reason,
            "note": describe_resolution(resolved, input_kind),
        }
    )


@app.get("/api/conversions")
@require_login
async def list_conversions(user):
    """换算流水：观察账号可看，但不可改参数、不可新增。"""
    def query():
        with connect() as conn:
            init_schema(conn)
            return conn.execute(
                """SELECT * FROM conversion_entries
                   ORDER BY id DESC LIMIT 200"""
            ).fetchall()

    rows = await run_db(query)
    return jsonify([serialize_entry(row) for row in rows])
