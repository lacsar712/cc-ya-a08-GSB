import os

import psycopg
from psycopg.rows import dict_row

DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://app:app@localhost:54399/yawalign",
)


def connect():
    return psycopg.connect(DSN, row_factory=dict_row)


# 单值表：当前生效的弦线当量参数（臂长，毫米）。
EQUIV_PARAM_SCHEMA = """
CREATE TABLE IF NOT EXISTS equiv_params (
    id integer PRIMARY KEY DEFAULT 1,
    arm_mm double precision NOT NULL,
    updated_by text NOT NULL,
    updated_at timestamptz NOT NULL,
    CONSTRAINT equiv_params_singleton CHECK (id = 1)
);
"""

# 换算流水：每次位移→偏航角换算都在此留痕，与 yaw_logs 入队同事务提交。
CONV_LEDGER_SCHEMA = """
CREATE TABLE IF NOT EXISTS conv_ledger (
    id serial PRIMARY KEY,
    displacement_mm double precision NOT NULL,
    arm_mm double precision NOT NULL,
    yaw_err_deg double precision NOT NULL,
    source text NOT NULL,
    log_id integer,
    turbine_code text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_ledger_log ON conv_ledger (log_id);
"""

LOGS_SCHEMA = """
CREATE TABLE IF NOT EXISTS yaw_logs (
    id serial PRIMARY KEY,
    turbine_code text NOT NULL,
    yaw_err_deg double precision NOT NULL,
    displacement_mm double precision,
    arm_mm double precision,
    input_source text NOT NULL DEFAULT 'error',
    conv_ledger_id integer,
    status text NOT NULL DEFAULT 'pending',
    verdict text,
    reason text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL,
    processed_at timestamptz
);
"""

# 旧库（基线版本）增量补列，幂等。
LOGS_MIGRATIONS = [
    "ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS displacement_mm double precision",
    "ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS arm_mm double precision",
    "ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS input_source text NOT NULL DEFAULT 'error'",
    "ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS conv_ledger_id integer",
]

SCHEMA = LOGS_SCHEMA + EQUIV_PARAM_SCHEMA + CONV_LEDGER_SCHEMA

# 种子当量臂长（毫米）：弦线基准半径 2000 mm。
DEFAULT_ARM_MM = 2000.0


def ensure_schema(conn):
    conn.execute(LOGS_SCHEMA)
    for stmt in LOGS_MIGRATIONS:
        conn.execute(stmt)
    conn.execute(EQUIV_PARAM_SCHEMA)
    conn.execute(CONV_LEDGER_SCHEMA)
    seeded = conn.execute(
        "SELECT arm_mm, updated_by, updated_at FROM equiv_params WHERE id = 1"
    ).fetchone()
    return seeded
