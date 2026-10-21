-- ============================================================
-- 028_work_order_timestamps_timestamptz.sql
-- 工单时间列 VARCHAR → TIMESTAMPTZ
--
-- 背景：001 建表时 created_at / dispatched_at / accepted_at / completed_at /
-- accepted_by_inspector_at 为 VARCHAR(64)，存的是本地时间字符串；而
-- getReliabilityMetrics() 直接做 completed_at - created_at，PGlite 报
--   operator does not exist: character varying - character varying
-- 导致 GET /api/v1/work-orders/stats 500。
--
-- 数据口径：
--   · 空串 / NULL → NULL（缺失时点不伪造为 0）；
--   · 带 Z / ±hh:mm 偏移的字符串按自身偏移解析；
--   · 其余历史字符串是 Asia/Shanghai 本地时间（种子用 toLocaleString('zh-CN')），
--     显式按 'Asia/Shanghai' 解释，避免换部署机时区后整体偏移；
--   · 列已是 TIMESTAMPTZ 时原值直通（幂等：重复执行不会二次换算）。
-- ============================================================

ALTER TABLE work_orders
  ALTER COLUMN created_at TYPE TIMESTAMPTZ
  USING CASE
    WHEN pg_typeof(created_at) = 'timestamp with time zone'::regtype THEN created_at::timestamptz
    WHEN created_at IS NULL OR btrim(created_at::text) = '' THEN NULL
    WHEN created_at::text ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' THEN created_at::text::timestamptz
    ELSE created_at::text::timestamp AT TIME ZONE 'Asia/Shanghai'
  END;

ALTER TABLE work_orders
  ALTER COLUMN dispatched_at TYPE TIMESTAMPTZ
  USING CASE
    WHEN pg_typeof(dispatched_at) = 'timestamp with time zone'::regtype THEN dispatched_at::timestamptz
    WHEN dispatched_at IS NULL OR btrim(dispatched_at::text) = '' THEN NULL
    WHEN dispatched_at::text ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' THEN dispatched_at::text::timestamptz
    ELSE dispatched_at::text::timestamp AT TIME ZONE 'Asia/Shanghai'
  END;

ALTER TABLE work_orders
  ALTER COLUMN accepted_at TYPE TIMESTAMPTZ
  USING CASE
    WHEN pg_typeof(accepted_at) = 'timestamp with time zone'::regtype THEN accepted_at::timestamptz
    WHEN accepted_at IS NULL OR btrim(accepted_at::text) = '' THEN NULL
    WHEN accepted_at::text ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' THEN accepted_at::text::timestamptz
    ELSE accepted_at::text::timestamp AT TIME ZONE 'Asia/Shanghai'
  END;

ALTER TABLE work_orders
  ALTER COLUMN completed_at TYPE TIMESTAMPTZ
  USING CASE
    WHEN pg_typeof(completed_at) = 'timestamp with time zone'::regtype THEN completed_at::timestamptz
    WHEN completed_at IS NULL OR btrim(completed_at::text) = '' THEN NULL
    WHEN completed_at::text ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' THEN completed_at::text::timestamptz
    ELSE completed_at::text::timestamp AT TIME ZONE 'Asia/Shanghai'
  END;

ALTER TABLE work_orders
  ALTER COLUMN accepted_by_inspector_at TYPE TIMESTAMPTZ
  USING CASE
    WHEN pg_typeof(accepted_by_inspector_at) = 'timestamp with time zone'::regtype THEN accepted_by_inspector_at::timestamptz
    WHEN accepted_by_inspector_at IS NULL OR btrim(accepted_by_inspector_at::text) = '' THEN NULL
    WHEN accepted_by_inspector_at::text ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' THEN accepted_by_inspector_at::text::timestamptz
    ELSE accepted_by_inspector_at::text::timestamp AT TIME ZONE 'Asia/Shanghai'
  END;
