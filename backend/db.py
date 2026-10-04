import os

import psycopg
from psycopg.rows import dict_row

DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://app:app@localhost:54399/yawalign",
)


def connect():
    return psycopg.connect(DSN, row_factory=dict_row)


SCHEMA = """
CREATE TABLE IF NOT EXISTS yaw_logs (
    id serial PRIMARY KEY,
    turbine_code text NOT NULL,
    yaw_err_deg double precision NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    verdict text,
    reason text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL,
    processed_at timestamptz
);

-- 弦线位移基距当量（mm）：专页维护，只保留一行当前值并记录维护人
CREATE TABLE IF NOT EXISTS yaw_params (
    id integer PRIMARY KEY DEFAULT 1,
    base_distance_mm double precision NOT NULL,
    updated_by text NOT NULL,
    updated_at timestamptz NOT NULL,
    CONSTRAINT yaw_params_singleton CHECK (id = 1)
);

-- 换算流水：位移换算偏航角的每一次演算；入队与流水同事务落齐
CREATE TABLE IF NOT EXISTS conversion_entries (
    id serial PRIMARY KEY,
    log_id integer REFERENCES yaw_logs (id),
    turbine_code text,
    mode text NOT NULL,
    input_kind text NOT NULL,
    displacement_mm double precision,
    base_distance_mm double precision,
    direct_yaw_err_deg double precision,
    yaw_err_deg double precision NOT NULL,
    verdict text,
    reason text,
    note text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS conversion_entries_log_id_idx
    ON conversion_entries (log_id);
CREATE INDEX IF NOT EXISTS conversion_entries_created_at_idx
    ON conversion_entries (created_at DESC);
"""

# 旧库补列（演示库初始版本无下列字段）
COLUMN_MIGRATIONS = [
    """ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS mode text""",
    """ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS displacement_mm double precision""",
    """ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS base_distance_mm double precision""",
    """ALTER TABLE yaw_logs ADD COLUMN IF NOT EXISTS direct_yaw_err_deg double precision""",
]
