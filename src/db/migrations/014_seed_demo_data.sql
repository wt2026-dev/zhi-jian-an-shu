-- ==============================================================================
-- 工业设备智能检修与作业协同系统
-- 数据库增量迁移: 012_seed_demo_data.sql
-- 覆盖实体：演示种子数据补充（巡检60条、隐患20条、备件流水30条、合规检查8条、AI纠错8条、多模态日志10条、真实文件4条）
-- 幂等设计：明确固定主键，全部采用 ON CONFLICT (id) DO NOTHING
-- ==============================================================================

-- 1. 补充巡检任务 (inspections: 8 -> 60 条，新增 52 条)
INSERT INTO inspections (
  id, task_no, title, type,
  inspector_id, inspector_name, workshop, route,
  scheduled_date, status, total_points, completed_points, abnormal_count,
  items, started_at, finished_at, summary,
  created_at, updated_at
) VALUES
(
    'insp-seed-001', 'XJ-2026-0812-01', '动力一车间 主循环给水泵及进出水管道密封日常巡检', 'daily',
    'u-inspector', '赵安全 (点检工程师)', '动力一车间', 'A线: 1#水泵 -> 4#电机 -> 11#换热器管网',
    '2026-08-11', 'completed', 27, 27, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"53.3℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"51.0℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"2.3mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.0mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-11 08:30:00', '2026-08-11 10:15:00', '巡检全部 27 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '30 days', CURRENT_TIMESTAMP - INTERVAL '30 days'
  ),
(
    'insp-seed-002', 'XJ-2026-0812-02', '压缩空气站 螺杆空压机油气分离器及排气温度例行点检', 'daily',
    'u-inspector2', '刘德胜 (高级巡检专员)', '压缩空气站', 'B线: 2#空压机 -> 6#工艺空压机 -> 储气罐区',
    '2026-08-11', 'completed', 23, 23, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"54.1℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"51.9℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"2.5mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.3mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-11 08:30:00', '2026-08-11 10:15:00', '巡检全部 23 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '30 days', CURRENT_TIMESTAMP - INTERVAL '30 days'
  ),
(
    'insp-seed-003', 'XJ-2026-0813-03', '轧钢二车间 高压电机轴承测温及定子线圈绝缘巡查', 'daily',
    'u-tech1', '张建国 (机械维修高级技师)', '轧钢二车间', 'C线: 3#轧机行星减速箱 -> 7#卷取机 -> 传动主轴',
    '2026-08-12', 'completed', 30, 30, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"54.9℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"52.8℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"2.7mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.5mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-12 08:30:00', '2026-08-12 10:15:00', '巡检全部 30 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '29 days', CURRENT_TIMESTAMP - INTERVAL '29 days'
  ),
(
    'insp-seed-004', 'XJ-2026-0813-04', '动力二车间 轧机主减速箱润滑油压及振动专项巡检', 'special',
    'u-tech2', '李志强 (电气自动化技师)', '动力二车间', 'D线: 5#多级给水泵 -> 8#抽风机电机 -> 余热系统',
    '2026-08-12', 'completed', 26, 26, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"55.7℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"53.7℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"2.9mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.8mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-12 08:30:00', '2026-08-12 10:15:00', '巡检全部 26 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '29 days', CURRENT_TIMESTAMP - INTERVAL '29 days'
  ),
(
    'insp-seed-005', 'XJ-2026-0814-05', '精密机加工车间 冷轧卷取机减速箱齿面啮合及渗漏排查', 'daily',
    'u-inspector', '赵安全 (点检工程师)', '精密机加工车间', 'E线: 9#五轴龙门加工中心 -> 液压泵站 -> 伺服电柜',
    '2026-08-13', 'completed', 22, 22, 1,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"56.5℃","result":"abnormal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"54.6℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"3.1mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"3.0mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-13 08:30:00', '2026-08-13 10:15:00', '巡检完成，发现 1 处测点轻微超标（振动或温度偏高），已登记隐患并通知当班班长关注。',
    CURRENT_TIMESTAMP - INTERVAL '28 days', CURRENT_TIMESTAMP - INTERVAL '28 days'
  ),
(
    'insp-seed-006', 'XJ-2026-0814-06', '成品包装车间 烧结引风机同步电机轴瓦温升专项巡检', 'daily',
    'u-inspector2', '刘德胜 (高级巡检专员)', '成品包装车间', 'F线: 10#重载机器人 -> 15#自动码垛机 -> 气动输送线',
    '2026-08-13', 'completed', 29, 29, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"57.3℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"55.5℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"3.3mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"3.3mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-13 08:30:00', '2026-08-13 10:15:00', '巡检全部 29 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '28 days', CURRENT_TIMESTAMP - INTERVAL '28 days'
  ),
(
    'insp-seed-007', 'XJ-2026-0815-07', '动力一车间 五轴数控加工中心主轴锥孔及导轨润滑点检', 'daily',
    'u-tech1', '张建国 (机械维修高级技师)', '动力一车间', 'A线: 1#水泵 -> 4#电机 -> 11#换热器管网',
    '2026-08-14', 'completed', 25, 25, 2,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"58.1℃","result":"abnormal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"56.4℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"3.5mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"3.5mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-14 08:30:00', '2026-08-14 10:15:00', '巡检完成，发现 2 处测点轻微超标（振动或温度偏高），已登记隐患并通知当班班长关注。',
    CURRENT_TIMESTAMP - INTERVAL '27 days', CURRENT_TIMESTAMP - INTERVAL '27 days'
  ),
(
    'insp-seed-008', 'XJ-2026-0816-08', '压缩空气站 工业机器人各关节谐波减速机背隙巡视', 'special',
    'u-tech2', '李志强 (电气自动化技师)', '压缩空气站', 'B线: 2#空压机 -> 6#工艺空压机 -> 储气罐区',
    '2026-08-15', 'completed', 21, 21, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"58.9℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"57.3℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"3.7mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"1.8mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-15 08:30:00', '2026-08-15 10:15:00', '巡检全部 21 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '26 days', CURRENT_TIMESTAMP - INTERVAL '26 days'
  ),
(
    'insp-seed-009', 'XJ-2026-0816-09', '轧钢二车间 板式热交换器进出温差与法兰密封巡检', 'daily',
    'u-inspector', '赵安全 (点检工程师)', '轧钢二车间', 'C线: 3#轧机行星减速箱 -> 7#卷取机 -> 传动主轴',
    '2026-08-15', 'completed', 28, 28, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"59.7℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"58.2℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"3.9mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.0mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-15 08:30:00', '2026-08-15 10:15:00', '巡检全部 28 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '26 days', CURRENT_TIMESTAMP - INTERVAL '26 days'
  ),
(
    'insp-seed-010', 'XJ-2026-0817-10', '动力二车间 结晶器冷却水泵机封冲洗液压力例检', 'daily',
    'u-inspector2', '刘德胜 (高级巡检专员)', '动力二车间', 'D线: 5#多级给水泵 -> 8#抽风机电机 -> 余热系统',
    '2026-08-16', 'completed', 24, 24, 1,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"60.5℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"59.1℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"5.2mm/s","result":"abnormal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.3mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-16 08:30:00', '2026-08-16 10:15:00', '巡检完成，发现 1 处测点轻微超标（振动或温度偏高），已登记隐患并通知当班班长关注。',
    CURRENT_TIMESTAMP - INTERVAL '25 days', CURRENT_TIMESTAMP - INTERVAL '25 days'
  ),
(
    'insp-seed-011', 'XJ-2026-0817-11', '精密机加工车间 螺杆式制冷机组吸排气压差与冷媒液位点检', 'daily',
    'u-tech1', '张建国 (机械维修高级技师)', '精密机加工车间', 'E线: 9#五轴龙门加工中心 -> 液压泵站 -> 伺服电柜',
    '2026-08-16', 'completed', 20, 20, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"61.3℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"60.0℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"2.3mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.5mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-16 08:30:00', '2026-08-16 10:15:00', '巡检全部 20 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '25 days', CURRENT_TIMESTAMP - INTERVAL '25 days'
  ),
(
    'insp-seed-012', 'XJ-2026-0818-12', '成品包装车间 变频调速电机冷却风道与滤网清洁巡视', 'special',
    'u-tech2', '李志强 (电气自动化技师)', '成品包装车间', 'F线: 10#重载机器人 -> 15#自动码垛机 -> 气动输送线',
    '2026-08-17', 'completed', 27, 27, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"62.1℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"50.1℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"2.5mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.8mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-17 08:30:00', '2026-08-17 10:15:00', '巡检全部 27 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '24 days', CURRENT_TIMESTAMP - INTERVAL '24 days'
  ),
(
    'insp-seed-013', 'XJ-2026-0818-13', '动力一车间 自动码垛机气缸吸盘真空度与气密性专项点检', 'daily',
    'u-inspector', '赵安全 (点检工程师)', '动力一车间', 'A线: 1#水泵 -> 4#电机 -> 11#换热器管网',
    '2026-08-17', 'completed', 23, 23, 3,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"62.9℃","result":"abnormal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"51.0℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"2.7mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"3.0mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-17 08:30:00', '2026-08-17 10:15:00', '巡检完成，发现 3 处测点轻微超标（振动或温度偏高），已登记隐患并通知当班班长关注。',
    CURRENT_TIMESTAMP - INTERVAL '24 days', CURRENT_TIMESTAMP - INTERVAL '24 days'
  ),
(
    'insp-seed-014', 'XJ-2026-0819-14', '压缩空气站 环冷机余热换热器管束防磨与清灰日常巡视', 'daily',
    'u-inspector2', '刘德胜 (高级巡检专员)', '压缩空气站', 'B线: 2#空压机 -> 6#工艺空压机 -> 储气罐区',
    '2026-08-18', 'completed', 30, 30, 2,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"63.7℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"51.9℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"5.2mm/s","result":"abnormal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"3.3mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-18 08:30:00', '2026-08-18 10:15:00', '巡检完成，发现 2 处测点轻微超标（振动或温度偏高），已登记隐患并通知当班班长关注。',
    CURRENT_TIMESTAMP - INTERVAL '23 days', CURRENT_TIMESTAMP - INTERVAL '23 days'
  ),
(
    'insp-seed-015', 'XJ-2026-0820-15', '轧钢二车间 主循环给水泵及进出水管道密封日常巡检', 'daily',
    'u-tech1', '张建国 (机械维修高级技师)', '轧钢二车间', 'C线: 3#轧机行星减速箱 -> 7#卷取机 -> 传动主轴',
    '2026-08-19', 'completed', 26, 26, 1,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"52.5℃","result":"abnormal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"52.8℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"3.1mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"3.5mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-19 08:30:00', '2026-08-19 10:15:00', '巡检完成，发现 1 处测点轻微超标（振动或温度偏高），已登记隐患并通知当班班长关注。',
    CURRENT_TIMESTAMP - INTERVAL '22 days', CURRENT_TIMESTAMP - INTERVAL '22 days'
  ),
(
    'insp-seed-016', 'XJ-2026-0820-16', '动力二车间 螺杆空压机油气分离器及排气温度例行点检', 'special',
    'u-tech2', '李志强 (电气自动化技师)', '动力二车间', 'D线: 5#多级给水泵 -> 8#抽风机电机 -> 余热系统',
    '2026-08-19', 'completed', 22, 22, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"53.3℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"53.7℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"3.3mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"1.8mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-19 08:30:00', '2026-08-19 10:15:00', '巡检全部 22 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '22 days', CURRENT_TIMESTAMP - INTERVAL '22 days'
  ),
(
    'insp-seed-017', 'XJ-2026-0821-17', '精密机加工车间 高压电机轴承测温及定子线圈绝缘巡查', 'daily',
    'u-inspector', '赵安全 (点检工程师)', '精密机加工车间', 'E线: 9#五轴龙门加工中心 -> 液压泵站 -> 伺服电柜',
    '2026-08-20', 'completed', 29, 29, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"54.1℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"54.6℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"3.5mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.0mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-20 08:30:00', '2026-08-20 10:15:00', '巡检全部 29 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '21 days', CURRENT_TIMESTAMP - INTERVAL '21 days'
  ),
(
    'insp-seed-018', 'XJ-2026-0821-18', '成品包装车间 轧机主减速箱润滑油压及振动专项巡检', 'daily',
    'u-inspector2', '刘德胜 (高级巡检专员)', '成品包装车间', 'F线: 10#重载机器人 -> 15#自动码垛机 -> 气动输送线',
    '2026-08-20', 'completed', 25, 25, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"54.9℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"55.5℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"3.7mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.3mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-20 08:30:00', '2026-08-20 10:15:00', '巡检全部 25 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '21 days', CURRENT_TIMESTAMP - INTERVAL '21 days'
  ),
(
    'insp-seed-019', 'XJ-2026-0822-19', '动力一车间 冷轧卷取机减速箱齿面啮合及渗漏排查', 'daily',
    'u-tech1', '张建国 (机械维修高级技师)', '动力一车间', 'A线: 1#水泵 -> 4#电机 -> 11#换热器管网',
    '2026-08-21', 'completed', 21, 21, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"55.7℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"56.4℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"3.9mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.5mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-21 08:30:00', '2026-08-21 10:15:00', '巡检全部 21 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '20 days', CURRENT_TIMESTAMP - INTERVAL '20 days'
  ),
(
    'insp-seed-020', 'XJ-2026-0822-20', '压缩空气站 烧结引风机同步电机轴瓦温升专项巡检', 'special',
    'u-tech2', '李志强 (电气自动化技师)', '压缩空气站', 'B线: 2#空压机 -> 6#工艺空压机 -> 储气罐区',
    '2026-08-21', 'completed', 28, 28, 1,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"56.5℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"57.3℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"5.2mm/s","result":"abnormal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.8mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-21 08:30:00', '2026-08-21 10:15:00', '巡检完成，发现 1 处测点轻微超标（振动或温度偏高），已登记隐患并通知当班班长关注。',
    CURRENT_TIMESTAMP - INTERVAL '20 days', CURRENT_TIMESTAMP - INTERVAL '20 days'
  ),
(
    'insp-seed-021', 'XJ-2026-0823-21', '轧钢二车间 五轴数控加工中心主轴锥孔及导轨润滑点检', 'daily',
    'u-inspector', '赵安全 (点检工程师)', '轧钢二车间', 'C线: 3#轧机行星减速箱 -> 7#卷取机 -> 传动主轴',
    '2026-08-22', 'completed', 24, 24, 2,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"57.3℃","result":"abnormal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"58.2℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"2.3mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"3.0mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-22 08:30:00', '2026-08-22 10:15:00', '巡检完成，发现 2 处测点轻微超标（振动或温度偏高），已登记隐患并通知当班班长关注。',
    CURRENT_TIMESTAMP - INTERVAL '19 days', CURRENT_TIMESTAMP - INTERVAL '19 days'
  ),
(
    'insp-seed-022', 'XJ-2026-0824-22', '动力二车间 工业机器人各关节谐波减速机背隙巡视', 'daily',
    'u-inspector2', '刘德胜 (高级巡检专员)', '动力二车间', 'D线: 5#多级给水泵 -> 8#抽风机电机 -> 余热系统',
    '2026-08-23', 'completed', 20, 20, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"58.1℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"59.1℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"2.5mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"3.3mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-23 08:30:00', '2026-08-23 10:15:00', '巡检全部 20 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '18 days', CURRENT_TIMESTAMP - INTERVAL '18 days'
  ),
(
    'insp-seed-023', 'XJ-2026-0824-23', '精密机加工车间 板式热交换器进出温差与法兰密封巡检', 'daily',
    'u-tech1', '张建国 (机械维修高级技师)', '精密机加工车间', 'E线: 9#五轴龙门加工中心 -> 液压泵站 -> 伺服电柜',
    '2026-08-23', 'completed', 27, 27, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"58.9℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"60.0℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"2.7mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"3.5mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-23 08:30:00', '2026-08-23 10:15:00', '巡检全部 27 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '18 days', CURRENT_TIMESTAMP - INTERVAL '18 days'
  ),
(
    'insp-seed-024', 'XJ-2026-0825-24', '成品包装车间 结晶器冷却水泵机封冲洗液压力例检', 'special',
    'u-tech2', '李志强 (电气自动化技师)', '成品包装车间', 'F线: 10#重载机器人 -> 15#自动码垛机 -> 气动输送线',
    '2026-08-24', 'completed', 23, 23, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"59.7℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"50.1℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"2.9mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"1.8mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-24 08:30:00', '2026-08-24 10:15:00', '巡检全部 23 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '17 days', CURRENT_TIMESTAMP - INTERVAL '17 days'
  ),
(
    'insp-seed-025', 'XJ-2026-0825-25', '动力一车间 螺杆式制冷机组吸排气压差与冷媒液位点检', 'daily',
    'u-inspector', '赵安全 (点检工程师)', '动力一车间', 'A线: 1#水泵 -> 4#电机 -> 11#换热器管网',
    '2026-08-24', 'completed', 30, 30, 1,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"60.5℃","result":"abnormal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"51.0℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"3.1mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.0mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-24 08:30:00', '2026-08-24 10:15:00', '巡检完成，发现 1 处测点轻微超标（振动或温度偏高），已登记隐患并通知当班班长关注。',
    CURRENT_TIMESTAMP - INTERVAL '17 days', CURRENT_TIMESTAMP - INTERVAL '17 days'
  ),
(
    'insp-seed-026', 'XJ-2026-0826-26', '压缩空气站 变频调速电机冷却风道与滤网清洁巡视', 'daily',
    'u-inspector2', '刘德胜 (高级巡检专员)', '压缩空气站', 'B线: 2#空压机 -> 6#工艺空压机 -> 储气罐区',
    '2026-08-25', 'completed', 26, 26, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"61.3℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"51.9℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"3.3mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.3mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-25 08:30:00', '2026-08-25 10:15:00', '巡检全部 26 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '16 days', CURRENT_TIMESTAMP - INTERVAL '16 days'
  ),
(
    'insp-seed-027', 'XJ-2026-0827-27', '轧钢二车间 自动码垛机气缸吸盘真空度与气密性专项点检', 'daily',
    'u-tech1', '张建国 (机械维修高级技师)', '轧钢二车间', 'C线: 3#轧机行星减速箱 -> 7#卷取机 -> 传动主轴',
    '2026-08-26', 'completed', 22, 22, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"62.1℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"52.8℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"3.5mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.5mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-26 08:30:00', '2026-08-26 10:15:00', '巡检全部 22 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '15 days', CURRENT_TIMESTAMP - INTERVAL '15 days'
  ),
(
    'insp-seed-028', 'XJ-2026-0827-28', '动力二车间 环冷机余热换热器管束防磨与清灰日常巡视', 'special',
    'u-tech2', '李志强 (电气自动化技师)', '动力二车间', 'D线: 5#多级给水泵 -> 8#抽风机电机 -> 余热系统',
    '2026-08-26', 'completed', 29, 29, 2,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"62.9℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"53.7℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"5.2mm/s","result":"abnormal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.8mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-26 08:30:00', '2026-08-26 10:15:00', '巡检完成，发现 2 处测点轻微超标（振动或温度偏高），已登记隐患并通知当班班长关注。',
    CURRENT_TIMESTAMP - INTERVAL '15 days', CURRENT_TIMESTAMP - INTERVAL '15 days'
  ),
(
    'insp-seed-029', 'XJ-2026-0828-29', '精密机加工车间 主循环给水泵及进出水管道密封日常巡检', 'daily',
    'u-inspector', '赵安全 (点检工程师)', '精密机加工车间', 'E线: 9#五轴龙门加工中心 -> 液压泵站 -> 伺服电柜',
    '2026-08-27', 'completed', 25, 25, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"63.7℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"54.6℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"3.9mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"3.0mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-27 08:30:00', '2026-08-27 10:15:00', '巡检全部 25 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '14 days', CURRENT_TIMESTAMP - INTERVAL '14 days'
  ),
(
    'insp-seed-030', 'XJ-2026-0828-30', '成品包装车间 螺杆空压机油气分离器及排气温度例行点检', 'daily',
    'u-inspector2', '刘德胜 (高级巡检专员)', '成品包装车间', 'F线: 10#重载机器人 -> 15#自动码垛机 -> 气动输送线',
    '2026-08-27', 'completed', 21, 21, 1,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"52.5℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"55.5℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"5.2mm/s","result":"abnormal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"3.3mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-27 08:30:00', '2026-08-27 10:15:00', '巡检完成，发现 1 处测点轻微超标（振动或温度偏高），已登记隐患并通知当班班长关注。',
    CURRENT_TIMESTAMP - INTERVAL '14 days', CURRENT_TIMESTAMP - INTERVAL '14 days'
  ),
(
    'insp-seed-031', 'XJ-2026-0829-31', '动力一车间 高压电机轴承测温及定子线圈绝缘巡查', 'daily',
    'u-tech1', '张建国 (机械维修高级技师)', '动力一车间', 'A线: 1#水泵 -> 4#电机 -> 11#换热器管网',
    '2026-08-28', 'completed', 28, 28, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"53.3℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"56.4℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"2.3mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"3.5mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-28 08:30:00', '2026-08-28 10:15:00', '巡检全部 28 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '13 days', CURRENT_TIMESTAMP - INTERVAL '13 days'
  ),
(
    'insp-seed-032', 'XJ-2026-0829-32', '压缩空气站 轧机主减速箱润滑油压及振动专项巡检', 'special',
    'u-tech2', '李志强 (电气自动化技师)', '压缩空气站', 'B线: 2#空压机 -> 6#工艺空压机 -> 储气罐区',
    '2026-08-28', 'completed', 24, 24, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"54.1℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"57.3℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"2.5mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"1.8mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-28 08:30:00', '2026-08-28 10:15:00', '巡检全部 24 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '13 days', CURRENT_TIMESTAMP - INTERVAL '13 days'
  ),
(
    'insp-seed-033', 'XJ-2026-0830-33', '轧钢二车间 冷轧卷取机减速箱齿面啮合及渗漏排查', 'daily',
    'u-inspector', '赵安全 (点检工程师)', '轧钢二车间', 'C线: 3#轧机行星减速箱 -> 7#卷取机 -> 传动主轴',
    '2026-08-29', 'completed', 20, 20, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"54.9℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"58.2℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"2.7mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.0mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-29 08:30:00', '2026-08-29 10:15:00', '巡检全部 20 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '12 days', CURRENT_TIMESTAMP - INTERVAL '12 days'
  ),
(
    'insp-seed-034', 'XJ-2026-0831-34', '动力二车间 烧结引风机同步电机轴瓦温升专项巡检', 'daily',
    'u-inspector2', '刘德胜 (高级巡检专员)', '动力二车间', 'D线: 5#多级给水泵 -> 8#抽风机电机 -> 余热系统',
    '2026-08-30', 'completed', 27, 27, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"55.7℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"59.1℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"2.9mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.3mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-30 08:30:00', '2026-08-30 10:15:00', '巡检全部 27 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '11 days', CURRENT_TIMESTAMP - INTERVAL '11 days'
  ),
(
    'insp-seed-035', 'XJ-2026-0831-35', '精密机加工车间 五轴数控加工中心主轴锥孔及导轨润滑点检', 'daily',
    'u-tech1', '张建国 (机械维修高级技师)', '精密机加工车间', 'E线: 9#五轴龙门加工中心 -> 液压泵站 -> 伺服电柜',
    '2026-08-30', 'completed', 23, 23, 2,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"56.5℃","result":"abnormal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"60.0℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"3.1mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.5mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-30 08:30:00', '2026-08-30 10:15:00', '巡检完成，发现 2 处测点轻微超标（振动或温度偏高），已登记隐患并通知当班班长关注。',
    CURRENT_TIMESTAMP - INTERVAL '11 days', CURRENT_TIMESTAMP - INTERVAL '11 days'
  ),
(
    'insp-seed-036', 'XJ-2026-0901-36', '成品包装车间 工业机器人各关节谐波减速机背隙巡视', 'special',
    'u-tech2', '李志强 (电气自动化技师)', '成品包装车间', 'F线: 10#重载机器人 -> 15#自动码垛机 -> 气动输送线',
    '2026-08-31', 'completed', 30, 30, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"57.3℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"50.1℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"3.3mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.8mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-31 08:30:00', '2026-08-31 10:15:00', '巡检全部 30 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '10 days', CURRENT_TIMESTAMP - INTERVAL '10 days'
  ),
(
    'insp-seed-037', 'XJ-2026-0901-37', '动力一车间 板式热交换器进出温差与法兰密封巡检', 'daily',
    'u-inspector', '赵安全 (点检工程师)', '动力一车间', 'A线: 1#水泵 -> 4#电机 -> 11#换热器管网',
    '2026-08-31', 'completed', 26, 26, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"58.1℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"51.0℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"3.5mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"3.0mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-08-31 08:30:00', '2026-08-31 10:15:00', '巡检全部 26 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '10 days', CURRENT_TIMESTAMP - INTERVAL '10 days'
  ),
(
    'insp-seed-038', 'XJ-2026-0902-38', '压缩空气站 结晶器冷却水泵机封冲洗液压力例检', 'daily',
    'u-inspector2', '刘德胜 (高级巡检专员)', '压缩空气站', 'B线: 2#空压机 -> 6#工艺空压机 -> 储气罐区',
    '2026-09-01', 'completed', 22, 22, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"58.9℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"51.9℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"3.7mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"3.3mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-09-01 08:30:00', '2026-09-01 10:15:00', '巡检全部 22 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '9 days', CURRENT_TIMESTAMP - INTERVAL '9 days'
  ),
(
    'insp-seed-039', 'XJ-2026-0902-39', '轧钢二车间 螺杆式制冷机组吸排气压差与冷媒液位点检', 'daily',
    'u-tech1', '张建国 (机械维修高级技师)', '轧钢二车间', 'C线: 3#轧机行星减速箱 -> 7#卷取机 -> 传动主轴',
    '2026-09-01', 'completed', 29, 29, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"59.7℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"52.8℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"3.9mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"3.5mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-09-01 08:30:00', '2026-09-01 10:15:00', '巡检全部 29 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '9 days', CURRENT_TIMESTAMP - INTERVAL '9 days'
  ),
(
    'insp-seed-040', 'XJ-2026-0903-40', '动力二车间 变频调速电机冷却风道与滤网清洁巡视', 'special',
    'u-tech2', '李志强 (电气自动化技师)', '动力二车间', 'D线: 5#多级给水泵 -> 8#抽风机电机 -> 余热系统',
    '2026-09-02', 'completed', 25, 25, 1,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"60.5℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"53.7℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"5.2mm/s","result":"abnormal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"1.8mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-09-02 08:30:00', '2026-09-02 10:15:00', '巡检完成，发现 1 处测点轻微超标（振动或温度偏高），已登记隐患并通知当班班长关注。',
    CURRENT_TIMESTAMP - INTERVAL '8 days', CURRENT_TIMESTAMP - INTERVAL '8 days'
  ),
(
    'insp-seed-041', 'XJ-2026-0904-41', '精密机加工车间 自动码垛机气缸吸盘真空度与气密性专项点检', 'daily',
    'u-inspector', '赵安全 (点检工程师)', '精密机加工车间', 'E线: 9#五轴龙门加工中心 -> 液压泵站 -> 伺服电柜',
    '2026-09-03', 'completed', 21, 21, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"61.3℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"54.6℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"2.3mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.0mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-09-03 08:30:00', '2026-09-03 10:15:00', '巡检全部 21 个测点完成，参数均在安全阈值以内，设备运行状态良好。',
    CURRENT_TIMESTAMP - INTERVAL '7 days', CURRENT_TIMESTAMP - INTERVAL '7 days'
  ),
(
    'insp-seed-042', 'XJ-2026-0904-42', '成品包装车间 环冷机余热换热器管束防磨与清灰日常巡视', 'daily',
    'u-inspector2', '刘德胜 (高级巡检专员)', '成品包装车间', 'F线: 10#重载机器人 -> 15#自动码垛机 -> 气动输送线',
    '2026-09-03', 'completed', 28, 28, 2,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"62.1℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"55.5℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"5.2mm/s","result":"abnormal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.3mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-09-03 08:30:00', '2026-09-03 10:15:00', '巡检完成，发现 2 处测点轻微超标（振动或温度偏高），已登记隐患并通知当班班长关注。',
    CURRENT_TIMESTAMP - INTERVAL '7 days', CURRENT_TIMESTAMP - INTERVAL '7 days'
  ),
(
    'insp-seed-043', 'XJ-2026-0905-43', '动力一车间 主循环给水泵及进出水管道密封日常巡检', 'daily',
    'u-tech1', '张建国 (机械维修高级技师)', '动力一车间', 'A线: 1#水泵 -> 4#电机 -> 11#换热器管网',
    '2026-09-04', 'in_progress', 24, 14, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"62.9℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"56.4℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"2.7mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.5mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-09-04 09:00:00', NULL, '巡检正在执行中，已完成 14/24 测点。',
    CURRENT_TIMESTAMP - INTERVAL '6 days', CURRENT_TIMESTAMP - INTERVAL '6 days'
  ),
(
    'insp-seed-044', 'XJ-2026-0905-44', '压缩空气站 螺杆空压机油气分离器及排气温度例行点检', 'special',
    'u-tech2', '李志强 (电气自动化技师)', '压缩空气站', 'B线: 2#空压机 -> 6#工艺空压机 -> 储气罐区',
    '2026-09-04', 'in_progress', 20, 12, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"63.7℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"57.3℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"2.9mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.8mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-09-04 09:00:00', NULL, '巡检正在执行中，已完成 12/20 测点。',
    CURRENT_TIMESTAMP - INTERVAL '6 days', CURRENT_TIMESTAMP - INTERVAL '6 days'
  ),
(
    'insp-seed-045', 'XJ-2026-0906-45', '轧钢二车间 高压电机轴承测温及定子线圈绝缘巡查', 'daily',
    'u-inspector', '赵安全 (点检工程师)', '轧钢二车间', 'C线: 3#轧机行星减速箱 -> 7#卷取机 -> 传动主轴',
    '2026-09-05', 'in_progress', 27, 16, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"52.5℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"58.2℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"3.1mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"3.0mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-09-05 09:00:00', NULL, '巡检正在执行中，已完成 16/27 测点。',
    CURRENT_TIMESTAMP - INTERVAL '5 days', CURRENT_TIMESTAMP - INTERVAL '5 days'
  ),
(
    'insp-seed-046', 'XJ-2026-0906-46', '动力二车间 轧机主减速箱润滑油压及振动专项巡检', 'daily',
    'u-inspector2', '刘德胜 (高级巡检专员)', '动力二车间', 'D线: 5#多级给水泵 -> 8#抽风机电机 -> 余热系统',
    '2026-09-05', 'in_progress', 23, 13, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"53.3℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"59.1℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"3.3mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"3.3mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-09-05 09:00:00', NULL, '巡检正在执行中，已完成 13/23 测点。',
    CURRENT_TIMESTAMP - INTERVAL '5 days', CURRENT_TIMESTAMP - INTERVAL '5 days'
  ),
(
    'insp-seed-047', 'XJ-2026-0907-47', '精密机加工车间 冷轧卷取机减速箱齿面啮合及渗漏排查', 'daily',
    'u-tech1', '张建国 (机械维修高级技师)', '精密机加工车间', 'E线: 9#五轴龙门加工中心 -> 液压泵站 -> 伺服电柜',
    '2026-09-06', 'in_progress', 30, 18, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"54.1℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"60.0℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"3.5mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"3.5mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, '2026-09-06 09:00:00', NULL, '巡检正在执行中，已完成 18/30 测点。',
    CURRENT_TIMESTAMP - INTERVAL '4 days', CURRENT_TIMESTAMP - INTERVAL '4 days'
  ),
(
    'insp-seed-048', 'XJ-2026-0908-48', '成品包装车间 烧结引风机同步电机轴瓦温升专项巡检', 'special',
    'u-tech2', '李志强 (电气自动化技师)', '成品包装车间', 'F线: 10#重载机器人 -> 15#自动码垛机 -> 气动输送线',
    '2026-09-07', 'pending', 26, 0, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"54.9℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"50.1℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"3.7mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"1.8mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, NULL, NULL, '任务已派发，等待巡检人员到达现场打卡执行。',
    CURRENT_TIMESTAMP - INTERVAL '3 days', CURRENT_TIMESTAMP - INTERVAL '3 days'
  ),
(
    'insp-seed-049', 'XJ-2026-0908-49', '动力一车间 五轴数控加工中心主轴锥孔及导轨润滑点检', 'daily',
    'u-inspector', '赵安全 (点检工程师)', '动力一车间', 'A线: 1#水泵 -> 4#电机 -> 11#换热器管网',
    '2026-09-07', 'pending', 22, 0, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"55.7℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"51.0℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"3.9mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.0mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, NULL, NULL, '任务已派发，等待巡检人员到达现场打卡执行。',
    CURRENT_TIMESTAMP - INTERVAL '3 days', CURRENT_TIMESTAMP - INTERVAL '3 days'
  ),
(
    'insp-seed-050', 'XJ-2026-0909-50', '压缩空气站 工业机器人各关节谐波减速机背隙巡视', 'daily',
    'u-inspector2', '刘德胜 (高级巡检专员)', '压缩空气站', 'B线: 2#空压机 -> 6#工艺空压机 -> 储气罐区',
    '2026-09-08', 'pending', 29, 0, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"56.5℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"51.9℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"2.1mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.3mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, NULL, NULL, '任务已派发，等待巡检人员到达现场打卡执行。',
    CURRENT_TIMESTAMP - INTERVAL '2 days', CURRENT_TIMESTAMP - INTERVAL '2 days'
  ),
(
    'insp-seed-051', 'XJ-2026-0909-51', '轧钢二车间 板式热交换器进出温差与法兰密封巡检', 'daily',
    'u-tech1', '张建国 (机械维修高级技师)', '轧钢二车间', 'C线: 3#轧机行星减速箱 -> 7#卷取机 -> 传动主轴',
    '2026-09-08', 'pending', 25, 0, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"57.3℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"52.8℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"2.3mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.5mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, NULL, NULL, '任务已派发，等待巡检人员到达现场打卡执行。',
    CURRENT_TIMESTAMP - INTERVAL '2 days', CURRENT_TIMESTAMP - INTERVAL '2 days'
  ),
(
    'insp-seed-052', 'XJ-2026-0910-52', '动力二车间 结晶器冷却水泵机封冲洗液压力例检', 'special',
    'u-tech2', '李志强 (电气自动化技师)', '动力二车间', 'D线: 5#多级给水泵 -> 8#抽风机电机 -> 余热系统',
    '2026-09-09', 'pending', 21, 0, 0,
    '[{"point_id":"P-01","name":"电机前轴承温度","standard":"≤70℃","measured":"58.1℃","result":"normal","notes":"接触式测温"},{"point_id":"P-02","name":"电机后轴承温度","standard":"≤70℃","measured":"53.7℃","result":"normal","notes":"红外测温"},{"point_id":"P-03","name":"驱动端轴承水平振动","standard":"≤4.5mm/s","measured":"2.5mm/s","result":"normal","notes":"压电振动传感器"},{"point_id":"P-04","name":"非驱动端垂直振动","standard":"≤4.5mm/s","measured":"2.8mm/s","result":"normal","notes":"便携测振仪"},{"point_id":"P-05","name":"轴封润滑及冷却水压","standard":"0.25~0.40MPa","measured":"0.32MPa","result":"normal","notes":"就地压力表正常"},{"point_id":"P-06","name":"传动联轴器防脱罩","standard":"紧固无松动","measured":"完好","result":"normal","notes":"目视外观良好"}]'::jsonb, NULL, NULL, '任务已派发，等待巡检人员到达现场打卡执行。',
    CURRENT_TIMESTAMP - INTERVAL '1 days', CURRENT_TIMESTAMP - INTERVAL '1 days'
  )
ON CONFLICT (id) DO NOTHING;

-- 2. 补充安全隐患闭环数据 (hazards: 6 -> 20 条，新增 14 条)
INSERT INTO hazards (
  id, no, title, equipment_id, location,
  level, description, discoverer, source, status,
  related_work_order_id, deadline, rectification_plan, closed_at,
  created_at, updated_at
) VALUES
(
  'HZ-SEED-001', 'HZ-20260904-01', '2#无油螺杆空压机主机联轴器弹性圈磨损，对中偏移0.08mm', 'eq-102', '压缩空气站 · 2#机组区',
  'general', '日常巡检使用激光对中仪排查发现 2# 空压机驱动轴与主机输入轴径向对中偏差 0.08mm（标准≤0.04mm），梅花橡胶弹性缓冲体有发热碎裂硬化痕迹。', '赵安全 (点检工程师)', 'inspection', 'closed',
  'wo-20240902-003', '2026-09-08', '停机闭锁，利用下午定修窗口更换 SP-005 梅花弹性联轴器垫圈，重新使用千分表校正同轴度至 0.02mm 以内。', '2026-09-07 15:40:00',
  CURRENT_TIMESTAMP - INTERVAL '5 days', CURRENT_TIMESTAMP - INTERVAL '1 days'
),
(
  'HZ-SEED-002', 'HZ-20260904-02', '4# 10kV高压循环水主电机接线盒防爆胶圈老化龟裂', 'eq-104', '动力一车间 · 4#高压电机区',
  'major', '巡检发现 10kV 主电机动力进线喇叭口引入防爆密封圈硬化脆裂，锁紧螺母未旋入到底，存在潮气水汽侵入高压接线端子引发相间弧光短路重大恶性隐患。', '刘德胜 (高级巡检专员)', 'inspection', 'verifying',
  'wo-20240902-016', '2026-09-12', '申请一级断电停电，由电气高级技师协同执行 LOTO，更换耐高压特种阻燃防爆密封圈并复测定子绝缘吸收比。', NULL,
  CURRENT_TIMESTAMP - INTERVAL '5 days', CURRENT_TIMESTAMP - INTERVAL '1 days'
),
(
  'HZ-SEED-003', 'HZ-20260905-01', '7#冷轧卷取机减速机高速轴油封渗油且齿面啮合异常啸叫', 'eq-107', '轧钢二车间 · 卷取机跨',
  'major', '卷取机带载运行时减速箱高速输入轴下端有连续滴油（约 20 滴/min），声学传感器拾取到 1800Hz 处异常齿面点蚀冲击啸叫，油温升至 76℃。', '张建国 (机械维修高级技师)', 'work_order', 'rectifying',
  'wo-20240902-004', '2026-09-13', '调取备件更换氟橡胶耐温骨架油封，取润滑油样送铁谱分析磨损颗粒，计划周五定修停机开盖检查齿面啮合斑点。', NULL,
  CURRENT_TIMESTAMP - INTERVAL '5 days', CURRENT_TIMESTAMP - INTERVAL '1 days'
),
(
  'HZ-SEED-004', 'HZ-20260905-02', '11#板式热交换器热侧旁通球阀填料压盖微量渗漏', 'eq-111', '动力一车间 · 换热机房',
  'general', '现场巡视发现换热器热媒进水截止阀阀杆处有微量水汽结晶，填料螺栓未拧紧，长期可能导致密封冲蚀。', '陈主管 (机电部长)', 'report', 'pending',
  NULL, '2026-09-16', '在巡检间隙带压对称紧固阀杆填料压套螺母，若仍渗漏则排空更换柔性石墨填料环。', NULL,
  CURRENT_TIMESTAMP - INTERVAL '5 days', CURRENT_TIMESTAMP - INTERVAL '1 days'
),
(
  'HZ-SEED-005', 'HZ-20260906-01', '12#结晶器冷却循环泵机械密封冲洗管单向阀卡滞倒流', 'eq-112', '动力二车间 · 结晶器水站',
  'general', '水泵自控仪表盘显示机封冲洗液微流量计示数为零，现场检查确认冲洗管路内止回阀阀芯结垢卡滞，机封静环无法获得有效润滑降温。', '李志强 (电气自动化技师)', 'inspection', 'closed',
  'wo-20240902-005', '2026-09-09', '拆卸清洗冲洗管路止回阀，酸洗除垢并更换耐酸耐碱不锈钢密封弹簧，复位后冲洗流量恢复至 4.5L/min。', '2026-09-08 11:20:00',
  CURRENT_TIMESTAMP - INTERVAL '5 days', CURRENT_TIMESTAMP - INTERVAL '1 days'
),
(
  'HZ-SEED-006', 'HZ-20260906-02', '16#环冷机余热换热器进风段波纹管膨胀节焊缝微裂纹', 'eq-116', '动力二车间 · 余热回收系统',
  'major', '红外热像巡查发现膨胀节第3波峰处有局部漏热点（160℃），渗透着色探伤（PT）发现长度约 12mm 的沿晶疲劳裂纹，热烟气微量外溢。', '赵安全 (点检工程师)', 'inspection', 'rectifying',
  'wo-20240902-011', '2026-09-14', '下达动火安全作业票，两端打止裂孔后使用特种奥氏体不锈钢焊条进行现场氩弧补焊，并加装外护隔热抱箍。', NULL,
  CURRENT_TIMESTAMP - INTERVAL '5 days', CURRENT_TIMESTAMP - INTERVAL '1 days'
),
(
  'HZ-SEED-007', 'HZ-20260907-01', '9#五轴数控龙门加工中心X轴导轨防护风琴罩撕裂卷入铁屑', 'eq-109', '精密机加工车间 · 9#数控工位',
  'general', '操作工报修 X 轴移动阻力增大报警，停机发现不锈钢刮屑板与三防布风琴罩连接部脱胶撕裂 50mm，硬质钢屑堆积进入高精密直线导轨滑块缝隙。', '张建国 (机械维修高级技师)', 'work_order', 'closed',
  'wo-20240902-009', '2026-09-10', '拆下破损风琴防护罩，清理滚珠滑块轨道，使用清洗剂除油，换装耐油阻燃高强度风琴防护罩总成。', '2026-09-09 17:00:00',
  CURRENT_TIMESTAMP - INTERVAL '5 days', CURRENT_TIMESTAMP - INTERVAL '1 days'
),
(
  'HZ-SEED-008', 'HZ-20260907-02', '15#自动码垛机器人末端吸盘气管受机械臂弯折疲劳起泡', 'eq-115', '成品包装车间 · 码垛自动化线',
  'general', '机器人运行至第4轴极限位时，耐油聚氨酯气管与线缆拖链边缘发生长期干涉摩擦，管壁出现厚度变薄起泡，供气压力间歇性降至 0.35MPa。', '刘德胜 (高级巡检专员)', 'inspection', 'verifying',
  'wo-20240902-014', '2026-09-13', '重新梳理线缆拖链布线走向，更换高柔性耐磨尼龙聚氨酯气动管，加装螺旋保护弹簧套管并进行 50 次满行程测试。', NULL,
  CURRENT_TIMESTAMP - INTERVAL '5 days', CURRENT_TIMESTAMP - INTERVAL '1 days'
),
(
  'HZ-SEED-009', 'HZ-20260908-01', '3#轧机主传动行星减速箱润滑油站滤网压差发讯器失灵', 'eq-103', '轧钢二车间 · 主传动地下油站',
  'major', '稀油站双筒网式过滤器现场目测压差表已达 0.18MPa（应报警换筒），但中控 DCS 远传压差报警无响应，经查微动开关受油污粘连卡死，无法保障大流量润滑安全。', '赵安全 (点检工程师)', 'inspection', 'pending',
  NULL, '2026-09-15', '立即现场手动切换至备用过滤筒，拆卸清洗压差发讯器电气触点并校验动作灵敏度，若氧化失效直接换新。', NULL,
  CURRENT_TIMESTAMP - INTERVAL '5 days', CURRENT_TIMESTAMP - INTERVAL '1 days'
),
(
  'HZ-SEED-010', 'HZ-20260908-02', '6#离心式工艺空气压缩机中间冷却器冷凝水自动疏水阀堵塞', 'eq-106', '压缩空气站 · 6#离心机房',
  'general', '二段进气温度显示较正常偏高 6℃，现场排查发现浮球式自动排污疏水阀被铁锈杂质卡在常闭位，凝结水无法外排有被高压气流带入次级叶轮造成液击风险。', '陈主管 (机电部长)', 'report', 'rectifying',
  'wo-20240902-008', '2026-09-14', '旁路隔离手动排液，拆检疏水阀阀腔过滤器清洗沉淀污泥，更换耐高温氟橡胶密封球垫。', NULL,
  CURRENT_TIMESTAMP - INTERVAL '5 days', CURRENT_TIMESTAMP - INTERVAL '1 days'
),
(
  'HZ-SEED-011', 'HZ-20260909-01', '8#烧结主抽风机电机滑环碳刷磨损超标且火花等级达到2级', 'eq-108', '烧结引风机房 · 8#跨',
  'major', '运行监视发现风机电机滑环集电环表面打火严重（2级火花），现场测量 6 组碳刷有效剩余长度均小于 15mm（磨损超标 70%），刷握弹簧压力衰减导致接触不良。', '李志强 (电气自动化技师)', 'work_order', 'closed',
  'wo-20240902-012', '2026-09-11', '利用白班降负荷停机窗口，研磨清理集电环铜表面氧化黑斑，成套更换摩根电碳特种电刷，重新校核恒压弹簧力至 22kPa。', '2026-09-10 14:00:00',
  CURRENT_TIMESTAMP - INTERVAL '5 days', CURRENT_TIMESTAMP - INTERVAL '1 days'
),
(
  'HZ-SEED-012', 'HZ-20260909-02', '5#多级高压锅炉给水泵平衡盘回水管流量异常偏低', 'eq-105', '动力二车间 · 给水泵房',
  'general', '给水泵平衡室回水管节流孔板后压力升至 0.8MPa，回水流量计示数下降 30%，表明平衡盘与平衡环间隙变小或回水管路有硬质脱落物节流卡阻。', '刘德胜 (高级巡检专员)', 'inspection', 'rectifying',
  'wo-20240902-007', '2026-09-15', '计划在下次加药检修时拆检平衡盘回水管止回阀与孔板，检测平衡盘轴向窜量是否在合格的 3.0~4.5mm 范围。', NULL,
  CURRENT_TIMESTAMP - INTERVAL '5 days', CURRENT_TIMESTAMP - INTERVAL '1 days'
),
(
  'HZ-SEED-013', 'HZ-20260910-01', '13#螺杆式制冷压缩机组低压吸气截止阀法兰垫片微漏冷媒', 'eq-113', '动力一车间 · 制冷机房',
  'general', '手持卤素电子检漏仪在 13# 螺杆制冷机吸气法兰下部检测到 R134a 泄漏报警，法兰紧固螺栓表面有轻微油污附着。', '赵安全 (点检工程师)', 'report', 'pending',
  NULL, '2026-09-17', '准备回收冷媒至储液器，抽真空后拆卸更换金属缠绕特种耐低温密封垫片，氮气打压保压 24 小时检漏。', NULL,
  CURRENT_TIMESTAMP - INTERVAL '5 days', CURRENT_TIMESTAMP - INTERVAL '1 days'
),
(
  'HZ-SEED-014', 'HZ-20260910-02', '14#变频调速电机驱动端接地碳刷断裂缺失导致轴电流超标', 'eq-114', '轧钢二车间 · 14#辅传动',
  'general', '变频高频谐波诱发电机轴电压达 12V，现场检查发现消轴电流接地碳刷辫线疲劳齐根折断，轴承内圈滚道有电火花微小点蚀坑。', '李志强 (电气自动化技师)', 'inspection', 'pending',
  NULL, '2026-09-18', '重新制作铜编织接地软导线，更换高导电铜石墨接地刷，测量轴对地电压降至 0.8V 安全范围内。', NULL,
  CURRENT_TIMESTAMP - INTERVAL '5 days', CURRENT_TIMESTAMP - INTERVAL '1 days'
)
ON CONFLICT (id) DO NOTHING;

-- 3. 补充备件出入库流水 (spare_parts_movements: 6 -> 30 条，新增 24 条)
INSERT INTO spare_parts_movements (
  id, part_id, type, quantity, balance_after,
  related_work_order_id, operator_name, notes,
  created_at
) VALUES
(
  'MOV-SEED-001', 'SP-002', 'in', 6, 10,
  NULL, '陈建平 (总工)', '碳化硅密封环常规批次补库入库',
  CURRENT_TIMESTAMP - INTERVAL '20 days'
),
(
  'MOV-SEED-002', 'SP-002', 'out', 2, 8,
  'wo-20240902-005', '张建国 (机械维修高级技师)', '12#结晶器水泵机封维修领用',
  CURRENT_TIMESTAMP - INTERVAL '12 days'
),
(
  'MOV-SEED-003', 'SP-005', 'in', 15, 28,
  NULL, '陈建平 (总工)', '梅花弹性垫圈战略集采入库',
  CURRENT_TIMESTAMP - INTERVAL '25 days'
),
(
  'MOV-SEED-004', 'SP-005', 'out', 2, 26,
  'wo-20240902-003', '周大伟 (起重机械操作岗)', '2#螺杆空压机联轴器对中保养更换',
  CURRENT_TIMESTAMP - INTERVAL '8 days'
),
(
  'MOV-SEED-005', 'SP-006', 'in', 10, 18,
  NULL, '陈建平 (总工)', '氟橡胶O型圈检修包标准入库',
  CURRENT_TIMESTAMP - INTERVAL '22 days'
),
(
  'MOV-SEED-006', 'SP-006', 'out', 3, 15,
  'wo-20240902-002', '张建国 (机械维修高级技师)', '1#离心水泵进出法兰密封检修领用',
  CURRENT_TIMESTAMP - INTERVAL '14 days'
),
(
  'MOV-SEED-007', 'SP-007', 'in', 10, 22,
  NULL, '陈主管 (机电部长)', '极压复合锂基润滑脂整箱采购入库',
  CURRENT_TIMESTAMP - INTERVAL '18 days'
),
(
  'MOV-SEED-008', 'SP-007', 'out', 4, 18,
  'wo-20240902-016', '李志强 (电气自动化技师)', '4#高压电机主轴承季度补脂保养',
  CURRENT_TIMESTAMP - INTERVAL '7 days'
),
(
  'MOV-SEED-009', 'SP-010', 'in', 4, 6,
  NULL, '陈建平 (总工)', '隔膜压力变送器校准合格入库',
  CURRENT_TIMESTAMP - INTERVAL '24 days'
),
(
  'MOV-SEED-010', 'SP-010', 'out', 1, 5,
  'wo-20240902-001', '李志强 (电气自动化技师)', '3#轧机行星减速箱润滑管网压力监测换新',
  CURRENT_TIMESTAMP - INTERVAL '15 days'
),
(
  'MOV-SEED-011', 'SP-011', 'in', 5, 8,
  NULL, '陈建平 (总工)', 'Pt100防爆铠装热电阻传感器采购入库',
  CURRENT_TIMESTAMP - INTERVAL '19 days'
),
(
  'MOV-SEED-012', 'SP-011', 'out', 1, 7,
  'wo-20240902-012', '李志强 (电气自动化技师)', '8#抽风机电机轴瓦测温故障传感器替换',
  CURRENT_TIMESTAMP - INTERVAL '5 days'
),
(
  'MOV-SEED-013', 'SP-013', 'in', 10, 16,
  NULL, '陈主管 (机电部长)', '窄V型防静电传动皮带季度采购入库',
  CURRENT_TIMESTAMP - INTERVAL '26 days'
),
(
  'MOV-SEED-014', 'SP-013', 'out', 4, 12,
  'wo-20240902-008', '张建国 (机械维修高级技师)', '6#离心空压机风机传动皮带组整套更换',
  CURRENT_TIMESTAMP - INTERVAL '11 days'
),
(
  'MOV-SEED-015', 'SP-014', 'in', 6, 10,
  NULL, '陈建平 (总工)', '施耐德65A高分断接触器备用入库',
  CURRENT_TIMESTAMP - INTERVAL '21 days'
),
(
  'MOV-SEED-016', 'SP-014', 'out', 2, 8,
  'wo-20240902-009', '李志强 (电气自动化技师)', '9#五轴机床电气控制柜主回路接触器烧损换新',
  CURRENT_TIMESTAMP - INTERVAL '9 days'
),
(
  'MOV-SEED-017', 'SP-017', 'in', 5, 8,
  NULL, '陈建平 (总工)', 'SMC气动三联件调压过滤器成套入库',
  CURRENT_TIMESTAMP - INTERVAL '23 days'
),
(
  'MOV-SEED-018', 'SP-017', 'out', 2, 6,
  'wo-20240902-014', '周大伟 (起重机械操作岗)', '15#自动码垛机器人进气调压滤水器更换',
  CURRENT_TIMESTAMP - INTERVAL '6 days'
),
(
  'MOV-SEED-019', 'SP-018', 'in', 8, 14,
  NULL, '陈主管 (机电部长)', 'Festo电磁换向阀原厂配货入库',
  CURRENT_TIMESTAMP - INTERVAL '27 days'
),
(
  'MOV-SEED-020', 'SP-018', 'out', 3, 11,
  'wo-20240902-004', '张建国 (机械维修高级技师)', '7#减速机润滑分配阀组电磁阀换新',
  CURRENT_TIMESTAMP - INTERVAL '13 days'
),
(
  'MOV-SEED-021', 'SP-019', 'in', 4, 7,
  NULL, '陈建平 (总工)', '贺德克液压站高压玻纤吸油滤芯到货入库',
  CURRENT_TIMESTAMP - INTERVAL '17 days'
),
(
  'MOV-SEED-022', 'SP-019', 'out', 2, 5,
  'wo-20240902-010', '张建国 (机械维修高级技师)', '11#换热器清洗液循环泵液压站滤芯保养',
  CURRENT_TIMESTAMP - INTERVAL '4 days'
),
(
  'MOV-SEED-023', 'SP-020', 'in', 20, 35,
  NULL, '陈主管 (机电部长)', '风机叶轮动平衡精密配重块组到货入库',
  CURRENT_TIMESTAMP - INTERVAL '28 days'
),
(
  'MOV-SEED-024', 'SP-020', 'out', 5, 30,
  'wo-20240902-011', '张建国 (机械维修高级技师)', '16#环冷机余热风机现场动平衡校正配重领用',
  CURRENT_TIMESTAMP - INTERVAL '3 days'
)
ON CONFLICT (id) DO NOTHING;

-- 4. 补充工单安全合规审查记录 (compliance_checks: 1 -> 8 条，新增 7 条)
INSERT INTO compliance_checks (
  id, work_order_id, operator, device_name,
  violations, total_steps, passed_steps, score, summary,
  checked_at, created_at
) VALUES
(
  'comp-seed-001', 'wo-20240902-001', '张建国 (机械维修高级技师)', '3# 轧机主传动行星减速箱',
  '[]'::jsonb, 6, 6, 98, '吊装作业与重型机械检修安措核查完全合格。起重指挥具有有效特种作业证，吊具（6×37+FC钢丝绳）探伤合规，警戒区隔离完备。',
  CURRENT_TIMESTAMP - INTERVAL '10 days', CURRENT_TIMESTAMP - INTERVAL '10 days'
),
(
  'comp-seed-002', 'wo-20240902-002', '李志强 (电气自动化技师)', '1# 离心主循环给水泵',
  '["动火作业二级审批票动火分析取样点距焊割位置距离不足，应在动火点2米内连续测爆","现场配置的灭火器铅封脱落且压力指针处于黄色临界区"]'::jsonb, 5, 4, 76, '动火作业安措执行存在瑕疵，动火分析规范性不足，现场应急消防器材压力临界，已责令当班人员停工整改复验。',
  CURRENT_TIMESTAMP - INTERVAL '8 days', CURRENT_TIMESTAMP - INTERVAL '8 days'
),
(
  'comp-seed-003', 'wo-20240902-003', '周大伟 (起重机械操作岗)', '2# 无油螺杆空压机主机',
  '[]'::jsonb, 5, 5, 95, 'LOTO能量隔离与压力容器泄压合规审查通过。已完成动力主进线三级断电挂牌，储气罐残余压力排空至0.00MPa。',
  CURRENT_TIMESTAMP - INTERVAL '7 days', CURRENT_TIMESTAMP - INTERVAL '7 days'
),
(
  'comp-seed-004', 'wo-20240902-004', '张建国 (机械维修高级技师)', '7# 冷轧卷取机减速机',
  '["进入有限空间作业前未进行有害气体与氧含量持续强制通风，初测氧含量为19.2%低于法定标准（19.5%）","有限空间外部应急救援绳索及三脚架未展开就位","作业票签署审批人未到现场确认安全交底"]'::jsonb, 6, 3, 52, '受限空间检修作业严重不合规！氧含量未达标即行介入，应急救援设施缺失，触发安全红线，现场已紧急叫停整顿。',
  CURRENT_TIMESTAMP - INTERVAL '5 days', CURRENT_TIMESTAMP - INTERVAL '5 days'
),
(
  'comp-seed-005', 'wo-20240902-005', '刘德胜 (高级巡检专员)', '12# 结晶器冷却循环泵',
  '[]'::jsonb, 5, 5, 94, '盲板抽堵及有毒介质管路能量隔离审查通过。盲板规格与管径匹配，加装警示标牌，操作人员穿戴耐酸碱防溅护目镜。',
  CURRENT_TIMESTAMP - INTERVAL '4 days', CURRENT_TIMESTAMP - INTERVAL '4 days'
),
(
  'comp-seed-006', 'wo-20240902-007', '张建国 (机械维修高级技师)', '5# 多级高压锅炉给水泵',
  '["高处作业人员安全带未采用高挂低用原则，系挂点为临时搭设的活动脚手架钢管","下方坠落半径内未设立警示警戒带"]'::jsonb, 6, 4, 72, '登高作业安措部分违规。五级防坠生命绳锚固点不符合安全规范，已令其重新系挂于厂房承重主梁钢结构生命线上。',
  CURRENT_TIMESTAMP - INTERVAL '3 days', CURRENT_TIMESTAMP - INTERVAL '3 days'
),
(
  'comp-seed-007', 'wo-20240902-008', '李志强 (电气自动化技师)', '6# 离心式工艺空气压缩机',
  '[]'::jsonb, 5, 5, 96, '临时用电与机电清洗合规审查合格。移动配电箱配置一机一闸一漏保，接地电阻实测 3.2Ω（≤4Ω），电缆架空绝缘良好。',
  CURRENT_TIMESTAMP - INTERVAL '2 days', CURRENT_TIMESTAMP - INTERVAL '2 days'
)
ON CONFLICT (id) DO NOTHING;

-- 5. 补充 AI 专家纠错反馈记录 (ai_feedback: 0 -> 8 条，5 pending + 3 adopted)
INSERT INTO ai_feedback (
  id, chat_id, model_response, user_correction, corrected_content,
  device_id, created_at, status
) VALUES
(
  'fb-seed-001', 'chat-seed-001', '建议机械密封安装弹簧压缩量设置为 3.8mm，以确保端面具有足够的比压闭合。', '集装式单端面机械密封（SP-001）弹簧自由长度较短，出厂设计压缩量应为 3.5±0.2mm，3.8mm 会导致端面比压过大加剧干磨与发热碳化。', '针对 1# 给水泵集装式单端面机械密封（SP-001），标准安装弹簧压缩量必须严格控制在 3.5±0.2mm 范围。若压缩量达 3.8mm，会使密封面接触比压超出设计极限 15%，引发动静环热裂及O型圈早期硬化失效。安装时须使用深度千分尺精确复核压盖定位台阶尺寸。',
  'eq-101', CURRENT_TIMESTAMP - INTERVAL '3 days', 'adopted'
),
(
  'fb-seed-002', 'chat-seed-002', '10kV 高压电机轴瓦测温热电阻可采用两线制接入温控巡检仪，减少电缆布线。', '高压工业现场电磁干扰强且引线长，两线制导线电阻误差会导致温升测量产生 2~5℃ 虚假偏差，必须采用三线制并配合屏蔽接地。', '4# 10kV 高压循环水主电机轴瓦埋入式 Pt100 热电阻必须采用标准三线制接线。第三根补偿导线可完全消除长距离传输回路电阻对测温精度的影响，并在两端屏蔽层单端可靠接地（接地电阻≤4Ω），避免变频高次谐波在微毫伏信号上诱发跳闸虚警。',
  'eq-104', CURRENT_TIMESTAMP - INTERVAL '3 days', 'adopted'
),
(
  'fb-seed-003', 'chat-seed-003', '螺杆空压机油分芯发生堵塞报警时，可在控制面板按复位键消除报警后继续运行观望。', '油分芯压差达到 0.1MPa 绝对禁止强制复位继续跑，否则可能击穿滤芯造成机油大量窜入压缩空气管网，甚至诱发高温爆炸。', '2# 无油螺杆空压机机油分离滤芯（SP-008）前后压差超过 0.08~0.10MPa 时，中控报警属强制联锁保护信号，严禁直接软件复位放行！必须立即切换备用空压机，停机泄压并更换新油分芯。若强行运行将导致空压机排气严重含油，后端精密仪表气源全线污染。',
  'eq-102', CURRENT_TIMESTAMP - INTERVAL '3 days', 'adopted'
),
(
  'fb-seed-004', 'chat-seed-004', '轧机行星减速箱齿面发生异常点蚀剥落时，推荐直接注入高粘度齿轮油填充间隙。', '重载行星减速机点蚀超标属疲劳损伤，必须先做铁谱磨损分析并测定齿轮侧隙，不能盲目更换稠油。', '3# 轧机主传动减速箱齿轮表面出现宏观剥落坑时，加注过稠润滑油将恶化低温启动流动性并阻碍齿间散热。正确规程应立即提取润滑油底样进行光谱/铁谱分析，若 PQ 铁磁磨粒指数>150，应在检修期开盖探伤并调整齿轮侧隙及接触斑点。',
  'eq-103', CURRENT_TIMESTAMP - INTERVAL '3 days', 'pending'
),
(
  'fb-seed-005', 'chat-seed-005', '多级离心锅炉给水泵启动前，出口主切断闸阀应当处于全开状态以便快速给水。', '多级离心泵属于离心式水泵，全开出口阀启动会使轴功率瞬间超载导致电机过流跳闸，必须全关出口阀启动。', '5# 多级高压锅炉给水泵启动规范：根据离心泵水力特性曲线，零流量（出口阀全闭）时轴功率最小。启动前必须确认出口电动闸阀处于全关状态，仅打开再循环最小流量阀防汽蚀，待电机达到额定转速、出口压力稳定后方可逐步缓慢开启主出口阀。',
  'eq-105', CURRENT_TIMESTAMP - INTERVAL '3 days', 'pending'
),
(
  'fb-seed-006', 'chat-seed-006', '烧结主抽风机电机滑环火花过大时，可使用 120# 粗金相砂纸在运行时直接研磨集电环表面。', '高压旋转滑环严禁带电人工砂纸打磨，不仅极易引发人身伤亡与弧光短路，粗砂纸还会破坏表面导电氧化膜。', '8# 烧结抽风机电机滑环集电环维护禁忌：绝对严禁在电机通电旋转状态下人工使用砂纸研磨！维护必须在严格执行 LOTO 停机断电并充分放电后进行，推荐使用碳化硅金相专用磨石或 00# 细砂布沿切线方向轻柔抛光，清除积碳粉尘后测量跳动度≤0.05mm。',
  'eq-108', CURRENT_TIMESTAMP - INTERVAL '3 days', 'pending'
),
(
  'fb-seed-007', 'chat-seed-007', '数控机床五轴加工中心主轴出现热伸长漂移时，可通过调整数控系统刀具长度补偿直接 offset 0.05mm。', '热伸长是随运转时间动态变化的，固定静态补偿无法解决加工精度漂移，应检查主轴恒温冷却机流量和循环水温。', '9# 五轴龙门加工中心主轴热误差治理：静态修改刀补仅能解决单一工况，机床运转热平衡前主轴伸长为动态曲线。应优先检查主轴外置循环油冷机，确保制冷水温严格跟踪床身基准温度（温差控制在 ±0.5℃ 恒温恒流），并启用系统内置热伸长算法实时探针校准。',
  'eq-109', CURRENT_TIMESTAMP - INTERVAL '3 days', 'pending'
),
(
  'fb-seed-008', 'chat-seed-008', '工业机器人报警伺服跟踪误差超限时，可直接在示教器参数列表中将容许误差阈值改大一倍。', '伺服跟踪超限通常由机械卡阻、减速机缺脂或抱闸未打开引起，盲目放大阈值会损坏伺服电机驱动器。', '10# 重载搬运机器人跟踪误差超差排查规范：严禁通过放大容差参数隐瞒故障。应首先排查机器人外部气管线缆是否干涉受阻，使用扭矩扳手检测各关节抱闸线圈供电（DC24V释放是否彻底），并检查 RV 减速机专用润滑脂是否乳化变质。',
  'eq-110', CURRENT_TIMESTAMP - INTERVAL '3 days', 'pending'
)
ON CONFLICT (id) DO NOTHING;

-- 5.1 对应 3 条 adopted 纠错沉淀至知识库文章 (knowledge_articles)
INSERT INTO knowledge_articles (
  id, title, category, target_equipment, tags,
  summary, content, author, updated_at,
  view_count, likes, file_type, chunks_count, created_at,
  status
) VALUES
(
    'kb-feedback-seed-001',
    '【专家纠错沉淀】1#离心主给水泵机械密封安装弹簧压缩量与端面对中标准规范',
    'AI纠错知识',
    'eq-101',
    '["AI纠错", "机械密封", "专家审定", "水泵检修"]'::jsonb,
    '集装式单端面机械密封（SP-001）安装弹簧压缩量必须严格控制在3.5±0.2mm，避免因压缩过紧导致密封面热裂。',
    '针对 1# 给水泵集装式单端面机械密封（SP-001），标准安装弹簧压缩量必须严格控制在 3.5±0.2mm 范围。若压缩量达 3.8mm，会使密封面接触比压超出设计极限 15%，引发动静环热裂及O型圈早期硬化失效。安装时须使用深度千分尺精确复核压盖定位台阶尺寸。',
    '吴晓芳 (档案管理员)',
    '2026-09-08',
    42, 8, 'feedback', 1, CURRENT_TIMESTAMP - INTERVAL '3 days',
    'approved'
  ),
(
    'kb-feedback-seed-002',
    '【专家纠错沉淀】高压大容量电机轴瓦埋入式测温热电阻三线制抗干扰接线规程',
    'AI纠错知识',
    'eq-104',
    '["AI纠错", "热电阻", "抗干扰", "电机轴瓦"]'::jsonb,
    '10kV 高压主电机轴瓦 Pt100 必须采用三线制消除引线电阻误差，并做单端屏蔽接地以抑制高次谐波跳闸虚警。',
    '4# 10kV 高压循环水主电机轴瓦埋入式 Pt100 热电阻必须采用标准三线制接线。第三根补偿导线可完全消除长距离传输回路电阻对测温精度的影响，并在两端屏蔽层单端可靠接地（接地电阻≤4Ω），避免变频高次谐波在微毫伏信号上诱发跳闸虚警。',
    '陈建平 (总工)',
    '2026-09-07',
    38, 12, 'feedback', 1, CURRENT_TIMESTAMP - INTERVAL '4 days',
    'approved'
  ),
(
    'kb-feedback-seed-003',
    '【专家纠错沉淀】螺杆空压机油气分离滤芯压差保护联锁与应急排查操作禁忌',
    'AI纠错知识',
    'eq-102',
    '["AI纠错", "空压机", "滤芯更换", "安全联锁"]'::jsonb,
    '油分芯前后压差达 0.1MPa 属强制联锁保护信号，严禁直接软件复位，必须倒泵更换滤芯，防窜油污染管网。',
    '2# 无油螺杆空压机机油分离滤芯（SP-008）前后压差超过 0.08~0.10MPa 时，中控报警属强制联锁保护信号，严禁直接软件复位放行！必须立即切换备用空压机，停机泄压并更换新油分芯。若强行运行将导致空压机排气严重含油，后端精密仪表气源全线污染。',
    '陈建平 (总工)',
    '2026-09-06',
    55, 15, 'feedback', 1, CURRENT_TIMESTAMP - INTERVAL '5 days',
    'approved'
  )
ON CONFLICT (id) DO NOTHING;

-- 6. 补充视频多模态/视觉分析日志 (ai_analysis_log: 0 -> 10 条，新增 10 条)
INSERT INTO ai_analysis_log (
  id, video_id, frames_count, question, device_model,
  result, created_at
) VALUES
(
  'ai-log-seed-001', 'pvid-1789028046960-yjzvvy', 6, '检测到 1# 离心水泵前轴承轴封处有轻微汽水喷溅，请评估机封动静环磨损风险及剩余寿命。', '1# 离心主循环给水泵 (PUMP-01)',
  '{"type":"vision","equipmentType":"离心泵","severity":"medium","confidence":0.94,"duration_ms":1240,"diagnosis":"机械密封动环碳化硅接触面微量偏磨，伴随冷却水蒸发析盐结晶，暂未伤及轴套。","possibleCauses":["对中同轴偏差 0.05mm","冲洗液节流孔轻微堵塞","弹簧座受力不均"],"recommendations":["复测同轴度","疏通机封冲洗冷却管","备件库预约 SP-002 碳化硅密封环"]}'::jsonb, CURRENT_TIMESTAMP - INTERVAL '12 days'
),
(
  'ai-log-seed-002', 'pvid-1789027947673-h5kekr', 6, '3# 轧机主行星减速箱带载提速至 1200rpm 时出现周期性金属敲击声，请多模态识别故障源。', '3# 轧机主传动行星减速箱 (GEAR-03)',
  '{"type":"video","equipmentType":"齿轮箱","severity":"high","confidence":0.92,"duration_ms":1850,"diagnosis":"行星齿轮副高速级太阳轮齿根存在局部疲劳微点蚀，齿面啮合冲击特征频率显着。","possibleCauses":["瞬时过载冲击","润滑油清洁度下降（NAS 9级）","高速轴承预紧游隙过大"],"recommendations":["限制最大轧制负荷 85%","取油样送铁谱磨损分析","排定周末停机内窥镜探伤"]}'::jsonb, CURRENT_TIMESTAMP - INTERVAL '11 days'
),
(
  'ai-log-seed-003', 'pvid-1789028409823-nmk8sj', 6, '2# 无油螺杆空压机主机排气端振动偏高，请通过运行多帧图像比对判定。', '2# 无油螺杆空压机主机 (COMP-02)',
  '{"type":"video","equipmentType":"螺杆空压机","severity":"low","confidence":0.96,"duration_ms":1420,"diagnosis":"主机与主电机联轴器梅花弹性体受热老化变形，振动以 1X 基频为主，轴承完好。","possibleCauses":["联轴器胶垫老化硬化","机组地脚螺栓紧固力矩衰减 10%"],"recommendations":["定修更换 SP-005 梅花弹性垫圈","校核地脚螺栓并加注厌氧锁固胶"]}'::jsonb, CURRENT_TIMESTAMP - INTERVAL '10 days'
),
(
  'ai-log-seed-004', NULL, 6, '4# 10kV高压循环水电机红外热成像显示定子接线盒局部温升 72℃，请诊断缺陷成因。', '4# 10kV高压循环水主电机 (MOT-04)',
  '{"type":"vision","equipmentType":"高压电机","severity":"medium","confidence":0.95,"duration_ms":1150,"diagnosis":"U相铜排过渡接线端子接触电阻偏大导致局部焦耳热集聚，热成像呈明显热点辐射。","possibleCauses":["接线螺栓紧固力矩不足（标准 45N·m，估算仅 28N·m）","接触面铜铝氧化膜"],"recommendations":["停电挂牌 LOTO 隔离","砂纸打磨接线铜排并涂抹导电膏","按标准力矩重新坚固"]}'::jsonb, CURRENT_TIMESTAMP - INTERVAL '8 days'
),
(
  'ai-log-seed-005', NULL, 6, '9# 五轴数控龙门加工中心液压刀库抓刀动作迟缓，液压泵压力表轻微抖动。', '9# 五轴数控龙门加工中心 (CNC-09)',
  '{"type":"diagnose","equipmentType":"数控加工中心","severity":"low","confidence":0.89,"duration_ms":980,"diagnosis":"液压站吸油滤芯纳污饱和导致液压泵微量气蚀，供油流量下降 15%。","possibleCauses":["吸油滤芯长期未换阻力增大","液压油泡沫倾向增高"],"recommendations":["领用 SP-019 液压吸油滤芯换新","检查液压油位至油标中上限"]}'::jsonb, CURRENT_TIMESTAMP - INTERVAL '7 days'
),
(
  'ai-log-seed-006', NULL, 6, '7# 冷轧卷取机减速机输入端骨架油封渗漏油滴检测。', '7# 冷轧卷取机减速机 (GEAR-07)',
  '{"type":"vision","equipmentType":"减速机","severity":"medium","confidence":0.93,"duration_ms":1320,"diagnosis":"高速轴旋转骨架油封唇口受硬质微粒划伤，伴随润滑油沿轴颈微量渗出。","possibleCauses":["轴表面粗糙度增加","油封橡胶高温老化磨损"],"recommendations":["擦拭漏油并涂敷荧光检漏剂","排定更换耐磨氟橡胶油封"]}'::jsonb, CURRENT_TIMESTAMP - INTERVAL '6 days'
),
(
  'ai-log-seed-007', NULL, 6, '8# 烧结主抽风机电机轴瓦热成像诊断分析。', '8# 烧结主抽风机同步电机 (MOT-08)',
  '{"type":"diagnose","equipmentType":"同步电机","severity":"high","confidence":0.97,"duration_ms":1600,"diagnosis":"非驱动端滑动轴瓦巴氏合金层摩擦生热，进油节流孔供油不畅导致油膜减薄。","possibleCauses":["润滑稀油站油温偏高","轴瓦微观磨损游隙偏小"],"recommendations":["增加轴瓦进油量至 12L/min","投入稀油站备用板式油冷器降温"]}'::jsonb, CURRENT_TIMESTAMP - INTERVAL '5 days'
),
(
  'ai-log-seed-008', NULL, 6, '10# 重载搬运机器人第四关节伺服电机运行声音频谱异常分析。', '10# 重载搬运机器人 (ROB-10)',
  '{"type":"vision","equipmentType":"工业机器人","severity":"low","confidence":0.91,"duration_ms":1050,"diagnosis":"机器人末端工具线缆包外防护波纹管与转台法兰边缘摩擦引起的高频声响。","possibleCauses":["管线包限位魔术贴脱开","弹性回缩弹簧张力不足"],"recommendations":["重新调整管线包安装支架空间角度","加装自润滑保护衬套"]}'::jsonb, CURRENT_TIMESTAMP - INTERVAL '4 days'
),
(
  'ai-log-seed-009', NULL, 6, '11# 板式热交换器温降效果下降视觉与运行数据综合判定。', '11# 板式热交换器组 (HEX-11)',
  '{"type":"diagnose","equipmentType":"换热器","severity":"medium","confidence":0.9,"duration_ms":1180,"diagnosis":"板片热侧进出口压差达 0.15MPa，板间流道结垢热阻增大 40%。","possibleCauses":["循环冷却水硬度偏高碳酸钙沉积","反冲洗频次不足"],"recommendations":["实施在线柠檬酸温和化学清洗反冲","监测清洗后进出水温差恢复情况"]}'::jsonb, CURRENT_TIMESTAMP - INTERVAL '3 days'
),
(
  'ai-log-seed-010', NULL, 6, '15# 自动码垛机气缸动作同步性视觉动作捕获评估。', '15# 自动码垛机器人 (ROB-15)',
  '{"type":"video","equipmentType":"码垛机器人","severity":"low","confidence":0.94,"duration_ms":1350,"diagnosis":"左右推料气缸伸缩时间差约 85ms，双向节流阀开度微有偏差，运动未失步。","possibleCauses":["气动三联件油雾不足","节流阀调节螺钉微有松脱"],"recommendations":["微调节流阀刻度至同步动作","向 SP-017 油雾器补加气动润滑油"]}'::jsonb, CURRENT_TIMESTAMP - INTERVAL '1 days'
)
ON CONFLICT (id) DO NOTHING;

-- 7. 补充真实上传文件记录 (upload_files: 0 -> 4 条，引用真实存在的文件及实际尺寸)
INSERT INTO upload_files (
  id, stored_name, original_name, size_bytes, mime_type,
  width, height, uploader_id, uploader_name, access,
  created_at
) VALUES
(
  'upload-seed-001', 'equipment_defect_pump_01.png', '1#给水泵机封端渗漏照片.png', 30839, 'image/png',
  256, 256, 'u-inspector', '赵安全 (点检工程师)', 'public',
  CURRENT_TIMESTAMP - INTERVAL '12 days'
),
(
  'upload-seed-002', 'equipment_defect_gearbox_02.png', '3#轧机行星减速箱轴承测温热成像.png', 24922, 'image/png',
  256, 256, 'u-inspector2', '刘德胜 (高级巡检专员)', 'public',
  CURRENT_TIMESTAMP - INTERVAL '9 days'
),
(
  'upload-seed-003', 'equipment_thermal_motor_03.png', '4#高压水电机定子接线盒实拍.png', 27805, 'image/png',
  256, 256, 'u-tech1', '张建国 (机械维修高级技师)', 'public',
  CURRENT_TIMESTAMP - INTERVAL '6 days'
),
(
  'upload-seed-004', 'equipment_vibration_check_04.png', '2#螺杆空压机机体振动频谱检测.png', 28412, 'image/png',
  256, 256, 'u-admin', '陈建平 (总工)', 'public',
  CURRENT_TIMESTAMP - INTERVAL '3 days'
)
ON CONFLICT (id) DO NOTHING;
