import asyncio
import os
from datetime import datetime, timedelta, timezone
from functools import wraps

from jose import JWTError, jwt
from passlib.context import CryptContext
from quart import Quart, jsonify, request

from conversion import (
    ConversionError,
    displacement_to_yaw,
    parse_number,
    validate_arm,
    validate_yaw,
)
from db import DEFAULT_ARM_MM, connect, ensure_schema
from rules import judge

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

# 位移换算与直填误差两路答案的一致容差（度）。
TWO_ROUTE_TOL_DEG = 1e-6

app = Quart(__name__)


def _run_db(fn, *args, **kwargs):
    return fn(*args, **kwargs)


async def run_db(fn, *args, **kwargs):
    return await asyncio.to_thread(_run_db, fn, *args, **kwargs)


def seed_if_empty(conn):
    seeded = ensure_schema(conn)
    now = datetime.now(timezone.utc)
    if seeded is None:
        conn.execute(
            """INSERT INTO equiv_params (id, arm_mm, updated_by, updated_at)
               VALUES (1, %s, %s, %s)""",
            (DEFAULT_ARM_MM, "system", now),
        )
        arm_mm = DEFAULT_ARM_MM
    else:
        arm_mm = float(seeded["arm_mm"])

    count = conn.execute("SELECT COUNT(*) AS n FROM yaw_logs").fetchone()["n"]
    if count > 0:
        return arm_mm

    # 种子记录走「直填误差」一路。
    samples = [
        ("W01", 0.4, "合格"),
        ("W07", 3.2, "偏航超差"),
    ]
    for code, err, expected_verdict in samples:
        verdict, reason = judge(err)
        assert verdict == expected_verdict
        conn.execute(
            """INSERT INTO yaw_logs
               (turbine_code, yaw_err_deg, input_source, status, verdict, reason,
                created_by, created_at, processed_at)
               VALUES (%s, %s, 'error', 'done', %s, %s, %s, %s, %s)""",
            (code, err, verdict, reason, "technician", now, now),
        )
    return arm_mm


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
            return jsonify({"detail": "仅现场技师可提交偏航记录"}), 403
        return await handler(user, *args, **kwargs)

    return wrapper


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


def get_arm(conn):
    row = conn.execute(
        "SELECT arm_mm, updated_by, updated_at FROM equiv_params WHERE id = 1"
    ).fetchone()
    return float(row["arm_mm"]), row


LOG_COLUMNS = """id, turbine_code, yaw_err_deg, displacement_mm, arm_mm,
                 input_source, conv_ledger_id, status, verdict, reason,
                 created_by, created_at, processed_at"""


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
    return jsonify(rows)


@app.get("/api/equiv-param")
@require_login
async def get_equiv_param(user):
    def query():
        with connect() as conn:
            _, row = get_arm(conn)
            return row

    row = await run_db(query)
    return jsonify(
        {
            "arm_mm": float(row["arm_mm"]),
            "updated_by": row["updated_by"],
            "updated_at": row["updated_at"],
        }
    )


@app.put("/api/equiv-param")
@require_writer
async def update_equiv_param(user):
    body = await request.get_json(force=True, silent=True) or {}
    try:
        arm_mm = validate_arm(parse_number(body.get("arm_mm")))
    except ConversionError as exc:
        return jsonify({"detail": str(exc)}), 400

    now = datetime.now(timezone.utc)

    def save():
        with connect() as conn:
            conn.execute(
                """UPDATE equiv_params
                   SET arm_mm = %s, updated_by = %s, updated_at = %s
                   WHERE id = 1""",
                (arm_mm, user["username"], now),
            )
            conn.commit()
            return arm_mm

    await run_db(save)
    return jsonify(
        {
            "arm_mm": arm_mm,
            "updated_by": user["username"],
            "updated_at": now,
        }
    )


@app.get("/api/conv-ledger")
@require_login
async def list_conv_ledger(user):
    def query():
        with connect() as conn:
            return conn.execute(
                """SELECT id, displacement_mm, arm_mm, yaw_err_deg, source,
                          log_id, turbine_code, created_by, created_at
                   FROM conv_ledger
                   WHERE source = 'submit'
                   ORDER BY id DESC
                   LIMIT 200"""
            ).fetchall()

    rows = await run_db(query)
    return jsonify(rows)


@app.post("/api/convert/preview")
@require_login
async def convert_preview(user):
    """专页试算：位移或直填误差均可，不落流水、不入队。"""
    body = await request.get_json(force=True, silent=True) or {}

    def calc():
        with connect() as conn:
            arm_mm, _ = get_arm(conn)
            return arm_mm

    arm_mm = await run_db(calc)
    try:
        disp_raw = body.get("displacement_mm")
        err_raw = body.get("yaw_err_deg")
        has_disp = disp_raw is not None and not (
            isinstance(disp_raw, str) and not disp_raw.strip()
        )
        has_err = err_raw is not None and not (
            isinstance(err_raw, str) and not err_raw.strip()
        )
        if not has_disp and not has_err:
            return (
                jsonify({"detail": "请填写弦线位移或偏航误差后再试算"}),
                400,
            )

        result = {"arm_mm": arm_mm}
        if has_disp:
            disp = parse_number(disp_raw, empty_msg="弦线位移必须是数字")
            result["displacement_mm"] = disp
            result["yaw_err_deg"] = displacement_to_yaw(disp, arm_mm)
        if has_err:
            direct = validate_yaw(
                parse_number(err_raw, empty_msg="偏航误差必须是数字")
            )
            result["direct_err_deg"] = direct
        if has_disp and has_err:
            converted = result["yaw_err_deg"]
            result["consistent"] = (
                abs(converted - direct) <= TWO_ROUTE_TOL_DEG
            )
        return jsonify(result)
    except ConversionError as exc:
        return jsonify({"detail": str(exc)}), 400


def _resolve_inputs(conn, body):
    """解析提交的位移/误差两路，返回入队所需字段。非法或越界抛 ConversionError。"""
    disp_raw = body.get("displacement_mm")
    err_raw = body.get("yaw_err_deg")
    has_disp = disp_raw is not None and not (
        isinstance(disp_raw, str) and not disp_raw.strip()
    )
    has_err = err_raw is not None and not (
        isinstance(err_raw, str) and not err_raw.strip()
    )
    if not has_disp and not has_err:
        raise ConversionError("请填写弦线位移或偏航误差后再提交")

    arm_mm, _ = get_arm(conn)
    displacement_mm = None
    if has_disp:
        displacement_mm = parse_number(
            disp_raw, empty_msg="弦线位移必须是数字"
        )
        yaw_from_disp = displacement_to_yaw(displacement_mm, arm_mm)
    if has_err:
        yaw_err_deg = validate_yaw(
            parse_number(err_raw, empty_msg="偏航误差必须是数字")
        )
        if has_disp:
            # 两路答案须一致：以换算值为准，直填值仅作核对。
            if abs(yaw_from_disp - yaw_err_deg) > TWO_ROUTE_TOL_DEG:
                raise ConversionError(
                    f"位移换算偏航角为 {yaw_from_disp:.4f}°，"
                    f"与直填误差 {yaw_err_deg:.4f}° 不一致，"
                    "请核对读数或当量臂长"
                )
            return yaw_from_disp, displacement_mm, arm_mm, "both"
        return yaw_err_deg, None, None, "error"
    return yaw_from_disp, displacement_mm, arm_mm, "displacement"


@app.post("/api/logs")
@require_writer
async def create_log(user):
    body = await request.get_json(force=True, silent=True) or {}
    turbine_code = (body.get("turbine_code") or "").strip()
    if not turbine_code:
        return jsonify({"detail": "机组编号不能为空"}), 400

    now = datetime.now(timezone.utc)

    def insert():
        with connect() as conn:
            # 换算失败（非法/越界/两路不一致）抛异常，整事务回滚，不写队列不写流水。
            yaw_err_deg, displacement_mm, arm_mm, source = _resolve_inputs(
                conn, body
            )

            # 入队与流水同一事务落齐。
            with conn.transaction():
                log_row = conn.execute(
                    """INSERT INTO yaw_logs
                       (turbine_code, yaw_err_deg, displacement_mm, arm_mm,
                        input_source, status, created_by, created_at)
                       VALUES (%s, %s, %s, %s, %s, 'pending', %s, %s)
                       RETURNING id""",
                    (
                        turbine_code,
                        yaw_err_deg,
                        displacement_mm,
                        arm_mm,
                        source,
                        user["username"],
                        now,
                    ),
                ).fetchone()

                ledger_row = None
                if displacement_mm is not None:
                    ledger_row = conn.execute(
                        """INSERT INTO conv_ledger
                           (displacement_mm, arm_mm, yaw_err_deg, source,
                            log_id, turbine_code, created_by, created_at)
                           VALUES (%s, %s, %s, 'submit', %s, %s, %s, %s)
                           RETURNING id""",
                        (
                            displacement_mm,
                            arm_mm,
                            yaw_err_deg,
                            log_row["id"],
                            turbine_code,
                            user["username"],
                            now,
                        ),
                    ).fetchone()
                    conn.execute(
                        "UPDATE yaw_logs SET conv_ledger_id = %s WHERE id = %s",
                        (ledger_row["id"], log_row["id"]),
                    )

                row = conn.execute(
                    f"SELECT {LOG_COLUMNS} FROM yaw_logs WHERE id = %s",
                    (log_row["id"],),
                ).fetchone()
            conn.commit()
            return row

    try:
        row = await run_db(insert)
    except ConversionError as exc:
        return jsonify({"detail": str(exc)}), 400
    return jsonify(row), 201
