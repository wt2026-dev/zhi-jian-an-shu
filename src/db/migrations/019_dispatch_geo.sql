-- ==============================================================================
-- 调度模块真实化：真实厂区经纬度 + 球面距离支撑
-- 019_dispatch_geo.sql
-- 注：编号接 018_dispatch_location.sql 之后；幂等设计，可在已有库上重复执行。
-- 厂区中心（示例）：经度 113.31，纬度 23.12。
--   若拿到真实厂区坐标，只需替换本文件顶部注释中的中心值与各车间偏移常量，
--   然后重跑 npm run db:migrate 即可（幂等，仅空值填充，不覆盖已上报的真实位置）。
-- 坐标体系：旧 map_x/map_y（0~1000 画布）保留兼容；新增 geo_lng/geo_lat 为真实经纬度，新逻辑以 geo 为准。
-- 偏移量级：0.001° ≈ 100m（经度，北纬 23°）/ 111m（纬度），全厂约 1.2km × 0.8km。
-- ==============================================================================

-- 1. equipments 扩展真实经纬度
ALTER TABLE equipments ADD COLUMN IF NOT EXISTS geo_lng FLOAT;
ALTER TABLE equipments ADD COLUMN IF NOT EXISTS geo_lat FLOAT;

-- 2. users 扩展真实经纬度
ALTER TABLE users ADD COLUMN IF NOT EXISTS geo_lng FLOAT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS geo_lat FLOAT;

-- 3. technician_locations 扩展真实经纬度（上报记录，兼容旧平面坐标字段）
ALTER TABLE technician_locations ADD COLUMN IF NOT EXISTS geo_lng FLOAT;
ALTER TABLE technician_locations ADD COLUMN IF NOT EXISTS geo_lat FLOAT;

-- 4. 设备按车间生成真实经纬度：厂区中心 + 车间确定性偏移 + 编码散点（±80m），幂等：仅空值填充
UPDATE equipments SET
  geo_lng = 113.31 + (CASE workshop
    WHEN '公用工程车间' THEN -0.004
    WHEN '动力一车间' THEN -0.004
    WHEN '烧结车间' THEN -0.001
    WHEN '连铸车间' THEN  0.001
    WHEN '重型热轧车间' THEN 0.000
    WHEN '冷轧精整车间' THEN 0.003
    WHEN '机加工车间' THEN 0.004
    WHEN '智能装配车间' THEN 0.003
    WHEN '成品包装线' THEN 0.005
    ELSE 0.001 END) + ((abs(hashtext(code)) % 16) - 8) * 0.0001,
  geo_lat = 23.12 + (CASE workshop
    WHEN '公用工程车间' THEN  0.002
    WHEN '动力一车间' THEN -0.001
    WHEN '烧结车间' THEN  0.002
    WHEN '连铸车间' THEN  0.000
    WHEN '重型热轧车间' THEN -0.002
    WHEN '冷轧精整车间' THEN 0.002
    WHEN '机加工车间' THEN 0.000
    WHEN '智能装配车间' THEN -0.002
    WHEN '成品包装线' THEN -0.001
    ELSE 0.001 END) + ((abs(hashtext(code) + 13) % 16) - 8) * 0.0001
WHERE geo_lng IS NULL OR geo_lat IS NULL;

-- 5. 种子师傅真实经纬度（对应 018 迁移中的平面坐标位置，车间语义一致），幂等：仅空值填充
UPDATE users SET geo_lng = 113.307, geo_lat = 23.121
WHERE username = 'tech1' AND (geo_lng IS NULL OR geo_lat IS NULL);
UPDATE users SET geo_lng = 113.305, geo_lat = 23.123
WHERE username = 'tech2' AND (geo_lng IS NULL OR geo_lat IS NULL);
UPDATE users SET geo_lng = 113.310, geo_lat = 23.120
WHERE username = 'inspector' AND (geo_lng IS NULL OR geo_lat IS NULL);
UPDATE users SET geo_lng = 113.311, geo_lat = 23.117
WHERE username = 'inspector2' AND (geo_lng IS NULL OR geo_lat IS NULL);
