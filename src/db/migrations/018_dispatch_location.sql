-- ==============================================================================
-- 内部师傅距离调度模块 (Dispatch & Location)
-- 018_dispatch_location.sql
-- 注：编号接 017_ai_model_configs.sql 之后；幂等设计，可在空库与已有库上重复执行
-- 坐标体系：厂区平面归一化坐标 0~1000（非经纬度），显示时按比例换算米制（100 单位 ≈ 200m）
-- ==============================================================================

-- 1. users 表扩展：技能标签 / 在线状态 / 平面坐标 / 最近上报时间
ALTER TABLE users ADD COLUMN IF NOT EXISTS skills JSONB DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS online_status VARCHAR(16) NOT NULL DEFAULT 'offline';
ALTER TABLE users ADD COLUMN IF NOT EXISTS map_x FLOAT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS map_y FLOAT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_location_at VARCHAR(64);

-- 2. equipments 表扩展：故障设备平面点位
ALTER TABLE equipments ADD COLUMN IF NOT EXISTS map_x FLOAT;
ALTER TABLE equipments ADD COLUMN IF NOT EXISTS map_y FLOAT;

-- 3. 师傅位置上报记录表
CREATE TABLE IF NOT EXISTS technician_locations (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  map_x FLOAT NOT NULL,
  map_y FLOAT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'online',
  reported_at VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_technician_locations_user ON technician_locations(user_id, created_at DESC);

-- 4. 种子技师/点检员补齐技能与初始位置（幂等：仅当 skills 为空数组 / 坐标为空时填充，
--    避免每次启动迁移覆盖师傅实时上报的位置与状态）
UPDATE users SET skills = '["泵类检修","轴承更换","机械密封更换","润滑保养","对中校准"]'::jsonb
WHERE username = 'tech1' AND skills = '[]'::jsonb;
UPDATE users SET skills = '["电气故障","电机检修","变频器调试","高压测试","PLC 排查"]'::jsonb
WHERE username = 'tech2' AND skills = '[]'::jsonb;
UPDATE users SET skills = '["设备点检","隐患排查","振动监测"]'::jsonb
WHERE username = 'inspector' AND skills = '[]'::jsonb;
UPDATE users SET skills = '["巡检管理","状态监测","温度测振"]'::jsonb
WHERE username = 'inspector2' AND skills = '[]'::jsonb;

UPDATE users SET map_x = 140, map_y = 320, online_status = 'online'
WHERE username = 'tech1' AND map_x IS NULL AND last_location_at IS NULL;
UPDATE users SET map_x = 300, map_y = 160, online_status = 'online'
WHERE username = 'tech2' AND map_x IS NULL AND last_location_at IS NULL;
UPDATE users SET map_x = 480, map_y = 300, online_status = 'idle'
WHERE username = 'inspector' AND map_x IS NULL AND last_location_at IS NULL;
UPDATE users SET map_x = 520, map_y = 680, online_status = 'idle'
WHERE username = 'inspector2' AND map_x IS NULL AND last_location_at IS NULL;

-- 5. 设备按车间区域补齐平面坐标（0~1000 画布；车间分区 + hashtext(code) 确定性散点，幂等：仅空坐标填充）
UPDATE equipments SET map_x = 80  + (abs(hashtext(code)) % 140) + 20, map_y = 80  + (abs(hashtext(code) + 7) % 140) + 20 WHERE workshop = '公用工程车间' AND map_x IS NULL;
UPDATE equipments SET map_x = 80  + (abs(hashtext(code)) % 140) + 20, map_y = 430 + (abs(hashtext(code) + 7) % 140) + 20 WHERE workshop = '动力一车间' AND map_x IS NULL;
UPDATE equipments SET map_x = 360 + (abs(hashtext(code)) % 140) + 20, map_y = 80  + (abs(hashtext(code) + 7) % 140) + 20 WHERE workshop = '烧结车间' AND map_x IS NULL;
UPDATE equipments SET map_x = 360 + (abs(hashtext(code)) % 140) + 20, map_y = 430 + (abs(hashtext(code) + 7) % 140) + 20 WHERE workshop = '连铸车间' AND map_x IS NULL;
UPDATE equipments SET map_x = 360 + (abs(hashtext(code)) % 140) + 20, map_y = 740 + (abs(hashtext(code) + 7) % 140) + 20 WHERE workshop = '重型热轧车间' AND map_x IS NULL;
UPDATE equipments SET map_x = 650 + (abs(hashtext(code)) % 140) + 20, map_y = 80  + (abs(hashtext(code) + 7) % 140) + 20 WHERE workshop = '冷轧精整车间' AND map_x IS NULL;
UPDATE equipments SET map_x = 650 + (abs(hashtext(code)) % 140) + 20, map_y = 430 + (abs(hashtext(code) + 7) % 140) + 20 WHERE workshop = '机加工车间' AND map_x IS NULL;
UPDATE equipments SET map_x = 650 + (abs(hashtext(code)) % 140) + 20, map_y = 740 + (abs(hashtext(code) + 7) % 140) + 20 WHERE workshop = '智能装配车间' AND map_x IS NULL;
UPDATE equipments SET map_x = 860 + (abs(hashtext(code)) % 100) + 20, map_y = 430 + (abs(hashtext(code) + 7) % 140) + 20 WHERE workshop = '成品包装线' AND map_x IS NULL;
-- 兜底：未知车间 / 空车间的设备落在画布中部临时区（"未标定"区域）
UPDATE equipments SET map_x = 500 + (abs(hashtext(code)) % 80), map_y = 260 + (abs(hashtext(code) + 7) % 80)
WHERE map_x IS NULL;
