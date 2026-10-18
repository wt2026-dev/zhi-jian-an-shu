-- ==============================================================================
-- Migration 026: 修后验收标准（acceptance_standards）
-- 目的：给「维修完成后必须验收测试」提供**可追溯来源**的判定阈值。
--
-- 为什么单独建表而不是写死在代码里：
--   系统原有的温度/振动阈值（statusMapping.THRESHOLDS：80℃ / 4.5mm/s）是
--   **报警线**，不是**修后合格线**。用报警线当验收线会放过"修完了但没修好"
--   的设备，所以两者必须分开存、分开演进。
--
-- 数据纪律（重要）：
--   - 每一条阈值都必须带 source（来源）与 confidence；
--     source = '待工程确认' 表示该数值来自需求方口头指标，尚未取得设备手册/验收规程佐证，
--     前端必须原样把这句话显示出来，不能包装成"厂家标准"。
--   - 额定电流（rated_current_a）整库都没有真实台账数据：
--     只有 eq-104 的点检备注文字提到"额定电流 38A"，其余设备无数据。
--     因此默认**不写**额定电流；source='unconfigured' 表示该项无标准，
--     验收时该项只能"未配置/不可判定"，**绝不允许**按额定功率÷电压推算。
--   - 不得用 0 或空字符串表示"没有标准"，NULL 才表示缺测。
--
-- 幂等：IF NOT EXISTS + ON CONFLICT DO UPDATE，可重复执行。
-- ==============================================================================

CREATE TABLE IF NOT EXISTS acceptance_standards (
  id VARCHAR(64) PRIMARY KEY,
  -- 适用范围：'default' 表示全厂通用基线；具体设备 ID 表示该设备单独覆盖
  scope VARCHAR(64) NOT NULL DEFAULT 'default',
  -- 验收项键（与验收清单一一对应）
  item_key VARCHAR(48) NOT NULL,
  item_label VARCHAR(128) NOT NULL,
  -- 实测指标：temperature / vibration / current / visual / switch
  metric VARCHAR(24) NOT NULL,
  unit VARCHAR(16),
  -- 上限/下限；NULL = 未配置（不可判定），绝不用 0 冒充
  max_limit FLOAT,
  min_limit FLOAT,
  -- 判定要求：auto = 有数值即自动判；manual = 目视/听音，需人工确认
  judged_by VARCHAR(16) NOT NULL DEFAULT 'auto',
  -- 数据来源与可信度：待工程确认 / 设备手册 / 验收规程 / unconfigured
  source VARCHAR(96) NOT NULL DEFAULT '待工程确认',
  -- confidence 必须放得下 'pending_engineering'（19 字符），别收到 16
  confidence VARCHAR(32) NOT NULL DEFAULT 'pending_engineering',
  -- 是否需要实测值录入
  requires_measure FLOAT[],
  sort_order INT NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (scope, item_key)
);

CREATE INDEX IF NOT EXISTS idx_acceptance_standards_scope ON acceptance_standards(scope);

-- 全厂通用基线（scope='default'）
-- 温度/振动阈值来自需求方给出的修后验收指标；来源如实标注为"待工程确认"。
INSERT INTO acceptance_standards
  (id, scope, item_key, item_label, metric, unit, max_limit, min_limit, judged_by, source, confidence, sort_order, note)
VALUES
  ('acc-default-temp', 'default', 'no_load_temp',
   '空载运行 30 分钟，轴承温度 ≤ 70℃', 'temperature', '℃', 70, NULL, 'auto',
   '待工程确认（需求方给出的修后验收指标，尚未取得设备手册佐证）', 'pending_engineering', 1,
   '修后合格线，与系统报警线（80℃）不同；报警线不能当验收线用。'),

  ('acc-default-vib', 'default', 'vibration',
   '设备振动值 ≤ 2.8mm/s', 'vibration', 'mm/s', 2.8, NULL, 'auto',
   '待工程确认（需求方给出的修后验收指标，尚未取得设备手册佐证）', 'pending_engineering', 2,
   '修后合格线，与系统报警线（4.5mm/s）不同。'),

  ('acc-default-current', 'default', 'running_current',
   '运行电流在额定范围内', 'current', 'A', NULL, NULL, 'auto',
   'unconfigured（该设备额定电流台账缺失，不做推算）', 'unconfigured', 3,
   '额定电流无台账数据。系统只有额定功率/额定电压，按其推算额定电流属于编造，禁止。'),

  ('acc-default-leak', 'default', 'no_leak_noise',
   '无泄漏、无异响、无异常噪音', 'visual', NULL, NULL, NULL, 'manual',
   '目视/听音确认（无量化阈值）', 'manual', 4,
   '定性项：由维修人员现场确认，不产生数值判定。'),

  ('acc-default-guard', 'default', 'safety_guard',
   '安全防护装置恢复正常', 'switch', NULL, NULL, NULL, 'manual',
   '目视/功能确认（无量化阈值）', 'manual', 5,
   '定性项：安全防护（护罩/联锁/急停）恢复后由维修人员确认。')
ON CONFLICT (scope, item_key) DO UPDATE SET
  item_label = EXCLUDED.item_label,
  metric = EXCLUDED.metric,
  unit = EXCLUDED.unit,
  max_limit = EXCLUDED.max_limit,
  min_limit = EXCLUDED.min_limit,
  judged_by = EXCLUDED.judged_by,
  source = EXCLUDED.source,
  confidence = EXCLUDED.confidence,
  sort_order = EXCLUDED.sort_order,
  note = EXCLUDED.note;
