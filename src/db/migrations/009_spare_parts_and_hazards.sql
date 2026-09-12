-- ==========================================================================
-- 008_spare_parts_and_hazards.sql
-- 工业备件库存表、出入库流水表与安全隐患闭环管理表
-- ==========================================================================

-- 1. 工业备件库存表
CREATE TABLE IF NOT EXISTS spare_parts (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  spec VARCHAR(255),
  model VARCHAR(255),
  category VARCHAR(100) NOT NULL DEFAULT '通用机械',
  stock INTEGER NOT NULL DEFAULT 0,
  safe_stock INTEGER NOT NULL DEFAULT 5,
  unit VARCHAR(32) NOT NULL DEFAULT '件',
  location VARCHAR(128) NOT NULL,
  price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  target_equipment_type VARCHAR(128),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. 备件出入库流水记录表
CREATE TABLE IF NOT EXISTS spare_parts_movements (
  id VARCHAR(64) PRIMARY KEY,
  part_id VARCHAR(64) NOT NULL REFERENCES spare_parts(id) ON DELETE CASCADE,
  type VARCHAR(16) NOT NULL CHECK (type IN ('in', 'out')),
  quantity INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  related_work_order_id VARCHAR(64),
  operator_name VARCHAR(128) NOT NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. 安全隐患闭环表
CREATE TABLE IF NOT EXISTS hazards (
  id VARCHAR(64) PRIMARY KEY,
  no VARCHAR(64) UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL,
  equipment_id VARCHAR(64),
  location VARCHAR(255) NOT NULL,
  level VARCHAR(32) NOT NULL CHECK (level IN ('general', 'major')),
  description TEXT NOT NULL,
  discoverer VARCHAR(128) NOT NULL,
  source VARCHAR(32) NOT NULL CHECK (source IN ('inspection', 'work_order', 'report')),
  status VARCHAR(32) NOT NULL CHECK (status IN ('pending', 'rectifying', 'verifying', 'closed')),
  related_work_order_id VARCHAR(64),
  deadline VARCHAR(64),
  rectification_plan TEXT,
  closed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引优化高频查询
CREATE INDEX IF NOT EXISTS idx_spare_parts_category ON spare_parts(category);
CREATE INDEX IF NOT EXISTS idx_spare_parts_stock ON spare_parts(stock);
CREATE INDEX IF NOT EXISTS idx_spare_parts_safe ON spare_parts(safe_stock);
CREATE INDEX IF NOT EXISTS idx_spare_movements_part ON spare_parts_movements(part_id);
CREATE INDEX IF NOT EXISTS idx_spare_movements_wo ON spare_parts_movements(related_work_order_id);
CREATE INDEX IF NOT EXISTS idx_hazards_status ON hazards(status);
CREATE INDEX IF NOT EXISTS idx_hazards_level ON hazards(level);
CREATE INDEX IF NOT EXISTS idx_hazards_equip ON hazards(equipment_id);

-- ==========================================================================
-- 注入 22 条真实工业备件种子数据 (与知识图谱实体及典型工业设备精准对应)
-- 包含 4 条低于安全库存线 (stock <= safe_stock)，真实触发红色低库存告警
-- ==========================================================================
INSERT INTO spare_parts (id, name, spec, model, category, stock, safe_stock, unit, location, price, target_equipment_type)
VALUES
  ('SP-001', '集装式单端面机械密封', '轴径Φ65mm 耐温180℃', 'Burgmann M7N', '密封件', 2, 5, '套', '一号备件库 A-02-01', 1850.00, '离心泵/给水泵'),
  ('SP-002', '碳化硅动静密封环组', 'Φ65×Φ85×12mm', 'EagleBurgmann SiC', '密封件', 8, 4, '组', '一号备件库 A-02-02', 680.00, '离心泵/给水泵'),
  ('SP-003', '深沟球轴承 (高精度轻载)', '60×130×31mm', 'SKF 6312-2RS1/C3', '轴承传动', 14, 6, '个', '一号备件库 B-01-05', 420.00, '高压给水泵/电机'),
  ('SP-004', '圆柱滚子轴承 (重载高刚性)', '120×215×40mm', 'NSK NU2224 ECM', '轴承传动', 1, 4, '个', '一号备件库 B-01-08', 2150.00, '烧结引风机/轧机'),
  ('SP-005', '梅花弹性联轴器缓冲垫圈', 'GR-38 聚氨酯 98 Shore A', 'KTR ROTEX-38', '轴承传动', 26, 10, '件', '一号备件库 B-03-02', 85.00, '风机/水泵机组'),
  ('SP-006', '高温氟橡胶 O 型圈检修包', '线径3.5mm 12种规格共80件', 'DuPont Viton A', '密封件', 15, 5, '盒', '一号备件库 A-03-01', 320.00, '全厂通用设备'),
  ('SP-007', '极压复合锂基润滑脂 (高温抗磨)', '1kg/罐 滴点≥260℃', 'Mobil SHC Polyrex 462', '润滑油品', 18, 8, '罐', '二号危化库 C-01-01', 260.00, '电机/轴承箱'),
  ('SP-008', '螺杆空压机油气分离滤芯', 'Φ170×350mm 过滤精度0.1μm', 'Atlas Copco 1622087100', '过滤耗材', 2, 4, '只', '一号备件库 C-02-03', 1450.00, '螺杆空压机'),
  ('SP-009', '空压机进气精密空气滤清器芯', '处理风量12m³/min', 'Mann-Filter C20500', '过滤耗材', 9, 4, '只', '一号备件库 C-02-04', 380.00, '螺杆空压机'),
  ('SP-010', '隔膜式工业压力变送器', '量程 0~1.6MPa 4-20mA输出', 'Rosemount 3051TG', '工控传感', 5, 2, '台', '三号精密仪器库 D-01-02', 3200.00, '循环水泵/风机管网'),
  ('SP-011', '防爆铠装热电阻温度传感器', 'Pt100 A级 插入深150mm', 'Endress+Hauser TMT180', '工控传感', 7, 3, '支', '三号精密仪器库 D-01-05', 850.00, '主轴/电机轴瓦'),
  ('SP-012', '工业压电式三轴振动加速度计', '灵敏度 100mV/g 带航空插头', 'CTC AC102-1A', '工控传感', 3, 3, '只', '三号精密仪器库 D-02-01', 2800.00, '离心风机/主轴箱'),
  ('SP-013', '风机窄V型防静电传动皮带', '截面SPC 长度3350mm', 'Gates Quad-Power 4', '轴承传动', 12, 6, '根', '一号备件库 B-04-01', 210.00, '离心引风机'),
  ('SP-014', '高分断交流接触器 (65A)', '线圈电压 AC220V 3P+1NO/1NC', 'Schneider LC1D65AM7C', '电气元件', 8, 4, '台', '二号电气库 E-01-03', 460.00, 'MCC配电柜/变频柜'),
  ('SP-015', 'PLC 16通道隔离数字量输入模块', 'DC24V 光耦隔离 漏型/源型', 'Siemens S7-1200 SM1221', '电气元件', 2, 3, '块', '三号精密仪器库 D-03-01', 1150.00, '主控PLC电柜'),
  ('SP-016', '高柔性耐折伺服电机编码器线', '10米 双绞屏蔽拖链专用', 'Mitsubishi MR-J3ENCBL10M', '电气元件', 4, 2, '条', '二号电气库 E-02-02', 580.00, '五轴数控加工中心'),
  ('SP-017', '气动三联件调压过滤器油雾器', '管径 G1/2 带自排水与压力表', 'SMC AC4000-04D', '气动液压', 6, 3, '套', '一号备件库 C-03-01', 620.00, '包装码垛机器人'),
  ('SP-018', '二位五通双电控电磁换向阀', '通径 DN10 DC24V IP65', 'Festo VUVS-L25-M52', '气动液压', 11, 4, '只', '一号备件库 C-03-03', 480.00, '气缸控制站'),
  ('SP-019', '液压站高压玻纤吸油滤芯', '过滤精度 10μm 纳污量大', 'Hydac 0160D010BN4HC', '过滤耗材', 5, 2, '只', '一号备件库 C-02-01', 750.00, '五轴机床液压站'),
  ('SP-020', '风机叶轮动平衡精密配重块组', '50g/100g/200g 304不锈钢带螺栓', 'BalTech B-Kit', '通用机械', 30, 10, '套', '一号备件库 B-05-02', 120.00, '离心风机叶轮'),
  ('SP-021', '耐高温全氟聚醚特种合成脂', '500g/盒 适用温度-40~280℃', 'Klüber Barrierta L55/2', '润滑油品', 3, 2, '盒', '二号危化库 C-01-03', 1350.00, '烘箱/热风风机'),
  ('SP-022', 'LOTO 安全绝缘防爆挂锁与搭扣', '工程塑料锁体 6锁6匙带警示牌', 'Master Lock S31RED', '安全防护', 40, 15, '套', '安全劳防库 S-01-01', 45.00, '全厂LOTO能量隔离')
ON CONFLICT (id) DO NOTHING;

-- 注入初始备件出入库流水
INSERT INTO spare_parts_movements (id, part_id, type, quantity, balance_after, related_work_order_id, operator_name, notes)
VALUES
  ('MOV-20260901-01', 'SP-001', 'in', 5, 5, NULL, '陈建平 (总工)', '季度标准采购入库'),
  ('MOV-20260901-02', 'SP-001', 'out', 3, 2, 'WO-20260901-01', '张明远 (机械主管)', '2号高压给水泵抢修领用'),
  ('MOV-20260902-01', 'SP-003', 'in', 20, 20, NULL, '陈建平 (总工)', '年度战略储备批量入库'),
  ('MOV-20260902-02', 'SP-003', 'out', 6, 14, 'WO-20260902-03', '周强 (机修钳工)', '循环水泵定修更换电机前后轴承'),
  ('MOV-20260903-01', 'SP-004', 'out', 3, 1, 'WO-20260903-02', '张明远 (机械主管)', '烧结引风机非驱动端轴承烧损应急更换 (库存告急)')
ON CONFLICT (id) DO NOTHING;

-- ==========================================================================
-- 注入 6 条真实安全隐患闭环种子数据 (涵盖重大/一般隐患与不同闭环流转阶段)
-- ==========================================================================
INSERT INTO hazards (id, no, title, equipment_id, location, level, description, discoverer, source, status, related_work_order_id, deadline, rectification_plan, closed_at)
VALUES
  (
    'HZ-20260901-01',
    'HZ-20260901-01',
    '1号离心主循环水泵机封处冲洗管滴漏渗水',
    'eq-101',
    '二期动力站房 · 1#泵组平台',
    'general',
    '巡检作业排查发现 1# 泵机封动静环压盖周围有持续水渍滴落（约 45 滴/min），冷却冲洗管接头有明显水蚀锈斑，存在机封干磨击穿风险。',
    '陈建平 (总工)',
    'inspection',
    'pending',
    NULL,
    '2026-09-12',
    '计划在下次调峰停泵时更换机械密封冲洗管O型密封圈，并微调紧定螺套对中度。',
    NULL
  ),
  (
    'HZ-20260901-02',
    'HZ-20260901-02',
    '8号烧结主抽风机高速联轴器防护罩锁紧螺栓松脱缺失',
    'eq-108',
    '烧结引风机房 · 8#跨',
    'major',
    '现场巡视发现引风机与主电机联轴器金属防护罩上部4颗防松螺栓缺失2颗，振动导致罩体与轴套间隙仅存 3mm，发生金属摩擦并伴随火花，随时可能卷入人员或甩脱造成重大机械伤害事故！',
    '刘志强 (安全总监)',
    'inspection',
    'rectifying',
    'WO-20260903-02',
    '2026-09-10',
    '紧急停机挂牌上锁，已指派机械班补装 8.8 级高强防松螺栓与弹簧垫圈，校核罩壳垂直度与同轴间隙 ≥25mm。',
    NULL
  ),
  (
    'HZ-20260902-01',
    'HZ-20260902-01',
    '2号螺杆空压机配套储气罐安全阀铅封脱落且超期未校验',
    'eq-102',
    '压缩空气站 · 2#储气罐区',
    'major',
    '安全审查发现 2# 储气罐（工作压力 0.85MPa）顶部弹簧式安全阀铅封破损脱落，检验合格标牌显示校验有效期已过期 14 天，存在超压爆炸重大恶性风险。',
    '刘志强 (安全总监)',
    'report',
    'verifying',
    'WO-20260902-04',
    '2026-09-09',
    '已紧急调运市特检院校验合格的备用安全阀总成完成在线切换，现场已打压 1.05MPa 测试起跳灵敏度，正等待安全总监签署复核验收单。',
    NULL
  ),
  (
    'HZ-20260902-02',
    'HZ-20260902-02',
    '9号五轴数控龙门加工中心伺服电气控制柜强电区积灰引发微弧放电',
    'eq-109',
    '精密机加工车间 · 9#跨',
    'general',
    '机修巡检使用热成像仪观测到 9# 机床伺服驱动器进线端子温度高达 88°C，开柜发现柜顶排风扇滤网破损，粉尘大量附着在母线排间，有间歇性微弱电晕放电声。',
    '王雪梅 (电气技师)',
    'work_order',
    'closed',
    'WO-20260901-03',
    '2026-09-05',
    '停电挂牌，使用特种绝缘精密除尘吸尘器彻底清扫柜体内部，更换高密度防油雾滤网，使用力矩扳手紧固全部进出线端子（复核紧固力矩 9.5 N·m），复测温度降至 42°C。',
    '2026-09-06 16:30:00'
  ),
  (
    'HZ-20260903-01',
    'HZ-20260903-01',
    '10#工业机器人安全红外光栅反射镜片偏移频闪',
    'eq-110',
    '成品包装车间 · 码垛自动化工位',
    'major',
    '码垛工作区安全互锁红外对射光栅B立柱反射镜角度因叉车擦碰微偏，导致光电联锁出现间歇性虚假导通（人员进入危险半径时未可靠触发急停停机），严重违背安全联锁保护规范！',
    '张明远 (机械主管)',
    'report',
    'rectifying',
    'WO-20260903-05',
    '2026-09-10',
    '立即在机器人安全控制回路加装实体物理防护网与临时硬隔离，已重新校正激光对光器同轴度，正在编写安全互锁测试记录。',
    NULL
  ),
  (
    'HZ-20260903-02',
    'HZ-20260903-02',
    '5号锅炉给水泵变频调速柜进风滤棉受潮硬化引发风道阻滞',
    'eq-105',
    '动力动力二车间 · 给水泵房',
    'general',
    '水泵变频调速柜下部进风口阻尼棉被环境油雾凝结硬化堵塞，冷却风量下降约 40%，变频器IGBT结温逼近 78°C 报警阈值。',
    '周强 (机修钳工)',
    'inspection',
    'pending',
    NULL,
    '2026-09-14',
    '申请下个检修窗口停运水泵半小时，拆洗进风金属防尘罩，清洗风机叶轮。',
    NULL
  )
ON CONFLICT (id) DO NOTHING;
