-- ==============================================================================
-- Migration 025: 多厂区层级（factories）+ 设备厂区归属
-- 目的：支撑「全国地图 → 城市 → 厂区 → 车间 → 设备」五层下钻大屏。
-- 数据纪律：
--   - 广州主厂（factory_gz）为真实厂区，现有 29 台设备全部归属该厂；
--   - 南京/成都/武汉分厂为演示数据（is_demo=true），设备为演示样例，
--     前端展示时必须标注「演示数据」；
--   - 不伪造工业产值/人员规模等运营指标（无该字段，前端显示「未接入」）。
-- 幂等：IF NOT EXISTS / ON CONFLICT，重复执行不报错。
-- ==============================================================================

-- 1. 厂区表
CREATE TABLE IF NOT EXISTS factories (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128),
  city VARCHAR(64),
  region VARCHAR(64),
  geo_lng FLOAT,
  geo_lat FLOAT,
  address VARCHAR(256),
  status VARCHAR(16),
  is_demo BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_factories_city ON factories(city);
CREATE INDEX IF NOT EXISTS idx_factories_region ON factories(region);

INSERT INTO factories (id, name, city, region, geo_lng, geo_lat, address, status, is_demo)
VALUES
  ('factory_gz', '广州主厂', '广州', '华南', 113.31, 23.12, '广东省广州市（真实厂区）', 'running', FALSE),
  ('factory_nj', '南京分厂', '南京', '华东', 118.78, 32.05, '江苏省南京市（演示数据）', 'running', TRUE),
  ('factory_cd', '成都分厂', '成都', '西南', 104.07, 30.57, '四川省成都市（演示数据）', 'running', TRUE),
  ('factory_wh', '武汉分厂', '武汉', '华中', 114.30, 30.59, '湖北省武汉市（演示数据）', 'maintenance', TRUE)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, city = EXCLUDED.city, region = EXCLUDED.region,
  geo_lng = EXCLUDED.geo_lng, geo_lat = EXCLUDED.geo_lat, address = EXCLUDED.address,
  status = EXCLUDED.status, is_demo = EXCLUDED.is_demo;

-- 2. 设备厂区归属：现有设备全部归属广州主厂
ALTER TABLE equipments ADD COLUMN IF NOT EXISTS factory_id VARCHAR(64);
UPDATE equipments SET factory_id = 'factory_gz' WHERE factory_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_equipments_factory ON equipments(factory_id);

-- 3. 演示分厂样例设备（每厂 3-5 台，泵/电机/阀门类）
--    说明：设备的「演示」属性经 factory_id JOIN factories.is_demo 判定，
--    不在 equipments 上另加 is_demo 列（避免台账表语义膨胀）。
INSERT INTO equipments (id, code, name, category, model, workshop, location, install_date, manufacturer, status, health_score, criticality, telemetry, specs, maintenance_history, next_inspection_date, assigned_technician, qr_code, factory_id)
VALUES
  ('eq_demo_nj_p01', 'NJ-P-01', '循环冷却水泵A', '泵类', 'IS200-150-315', '南京分厂·公用工程泵房', '泵房 1 号位', '2024-03-15', '演示数据·南方泵业', 'running', 92, '主要生产', '{"temperature":46.2,"vibration":1.8,"current":28.4,"voltage":380.1,"pressure":0.42,"loadRate":71.0,"rpm":1450}', '{"额定流量":"400m³/h","额定扬程":"32m","额定功率":"55kW"}', '[]', '2026-10-20', '演示·陈工', 'QR-DEMO-NJ-P01', 'factory_nj'),
  ('eq_demo_nj_m01', 'NJ-M-01', '高压离心电机', '电机', 'YKK400-4', '南京分厂·公用工程泵房', '配电间旁 2 号位', '2024-03-15', '演示数据·湘潭电机', 'running', 88, '关键核心', '{"temperature":58.7,"vibration":2.3,"current":64.2,"voltage":6000.0,"pressure":0.0,"loadRate":78.5,"rpm":1480}', '{"额定功率":"250kW","额定电压":"6kV","绝缘等级":"F级"}', '[]', '2026-11-05', '演示·刘工', 'QR-DEMO-NJ-M01', 'factory_nj'),
  ('eq_demo_nj_v01', 'NJ-V-01', '气动调节阀', '阀门', 'ZJHP-16K', '南京分厂·公用工程泵房', '出水总管 DN200', '2024-06-01', '演示数据·吴忠仪表', 'warning', 74, '通用辅助', '{"temperature":31.5,"vibration":0.4,"current":0.0,"voltage":24.0,"pressure":0.55,"loadRate":40.0,"rpm":0}', '{"公称通径":"DN200","公称压力":"PN16"}', '[]', '2026-09-28', '演示·陈工', 'QR-DEMO-NJ-V01', 'factory_nj'),
  ('eq_demo_cd_p01', 'CD-P-01', '罗茨风机', '风机', 'L93WD', '成都分厂·动力站', '风机房 1 号位', '2024-05-20', '演示数据·长鼓集团', 'running', 90, '主要生产', '{"temperature":52.3,"vibration":2.1,"current":52.6,"voltage":380.2,"pressure":0.06,"loadRate":66.0,"rpm":960}', '{"额定风量":"55.6m³/min","额定升压":"68.6kPa","额定功率":"90kW"}', '[]', '2026-10-12', '演示·赵工', 'QR-DEMO-CD-P01', 'factory_cd'),
  ('eq_demo_cd_p02', 'CD-P-02', '冷却循环泵', '泵类', 'IS150-125-250', '成都分厂·动力站', '泵房 2 号位', '2024-05-20', '演示数据·南方泵业', 'running', 95, '通用辅助', '{"temperature":43.8,"vibration":1.5,"current":24.1,"voltage":380.3,"pressure":0.38,"loadRate":63.0,"rpm":1450}', '{"额定流量":"200m³/h","额定扬程":"20m","额定功率":"30kW"}', '[]', '2026-11-18', '演示·赵工', 'QR-DEMO-CD-P02', 'factory_cd'),
  ('eq_demo_cd_m01', 'CD-M-01', '立磨主电机', '电机', 'YRKK560-6', '成都分厂·动力站', '主厂房 3 号位', '2024-05-20', '演示数据·湘潭电机', 'running', 85, '关键核心', '{"temperature":61.4,"vibration":2.6,"current":88.5,"voltage":6000.0,"pressure":0.0,"loadRate":82.0,"rpm":985}', '{"额定功率":"630kW","额定电压":"6kV","绝缘等级":"F级"}', '[]', '2026-10-30', '演示·孙工', 'QR-DEMO-CD-M01', 'factory_cd'),
  ('eq_demo_wh_p01', 'WH-P-01', '高压给水泵', '泵类', 'DG46-50', '武汉分厂·锅炉给水间', '给水间 1 号位', '2023-11-08', '演示数据·长沙水泵厂', 'fault', 41, '关键核心', '{"temperature":78.9,"vibration":6.8,"current":96.3,"voltage":6000.0,"pressure":0.21,"loadRate":95.0,"rpm":2950}', '{"额定流量":"46m³/h","额定扬程":"550m","额定功率":"132kW"}', '[]', '2026-09-22', '演示·周工', 'QR-DEMO-WH-P01', 'factory_wh'),
  ('eq_demo_wh_m01', 'WH-M-01', '引风机电机', '电机', 'YKK450-4', '武汉分厂·锅炉给水间', '风机间 2 号位', '2023-11-08', '演示数据·湘潭电机', 'overhauling', 62, '主要生产', '{"temperature":55.2,"vibration":3.1,"current":0.0,"voltage":6000.0,"pressure":0.0,"loadRate":0.0,"rpm":0}', '{"额定功率":"355kW","额定电压":"6kV","绝缘等级":"F级"}', '[]', '2026-10-08', '演示·周工', 'QR-DEMO-WH-M01', 'factory_wh'),
  ('eq_demo_wh_v01', 'WH-V-01', '蒸汽球阀', '阀门', 'Q41F-25C', '武汉分厂·锅炉给水间', '蒸汽总管 DN150', '2023-11-08', '演示数据·永盛阀门', 'running', 89, '通用辅助', '{"temperature":36.4,"vibration":0.3,"current":0.0,"voltage":24.0,"pressure":0.62,"loadRate":35.0,"rpm":0}', '{"公称通径":"DN150","公称压力":"PN25"}', '[]', '2026-11-25', '演示·郑工', 'QR-DEMO-WH-V01', 'factory_wh'),
  ('eq_demo_wh_p02', 'WH-P-02', '备用给水泵', '泵类', 'DG46-50', '武汉分厂·锅炉给水间', '给水间 2 号位', '2023-11-08', '演示数据·长沙水泵厂', 'standby', 91, '主要生产', '{"temperature":25.1,"vibration":0.2,"current":0.0,"voltage":0.0,"pressure":0.0,"loadRate":0.0,"rpm":0}', '{"额定流量":"46m³/h","额定扬程":"550m","额定功率":"132kW"}', '[]', '2026-12-01', '演示·郑工', 'QR-DEMO-WH-P02', 'factory_wh')
ON CONFLICT (id) DO NOTHING;
