-- ==============================================================================
-- 工业设备智能检修与作业协同系统 (Industrial Ops Maintenance System v2.0.0)
-- 数据库增量迁移: 005_user_avatar_wxopenid.sql
-- 覆盖实体：用户表扩展（小程序头像持久化 + 微信 openid 绑定）
-- ==============================================================================

-- 1. 用户头像 URL（小程序 wx.chooseMedia 上传后由 /api/v1/user/avatar 写入）
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar VARCHAR(512);

-- 2. 微信小程序 openid（wx.login code2session 后与既有工号账号绑定）
ALTER TABLE users ADD COLUMN IF NOT EXISTS wx_open_id VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_users_wx_open_id ON users(wx_open_id);
