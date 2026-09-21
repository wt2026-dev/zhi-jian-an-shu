class_name LevelPlan
extends RefCounted
## 四关的**关卡形状**：地图多大、几台故障、有没有锁房、限不限时。
##
## 只定"形状"，不定内容 —— 故障是哪几台设备、修它的题目是什么，
## 全部由 React 侧从真实台账 + 真实规程算出来（`src/components/game/mazeLevels.ts`），
## 运行时用 `maze-data` 推进来。这里出现任何设备名或题面都是越界。
##
## 递进口径照产品提示词的表：
##   1 | 3×3 | 1 台 | 教学：点设备 → 看读数 → 点修复
##   2 | 5×5 | 2 台 | 干扰项：正常设备也亮，但不是红色
##   3 | 7×7 | 3 台 | 有锁着的房间，要先找钥匙卡
##   4 | 9×9 | 4 台 | 限时，故障会扩散

const MAX_LIVES := 3
const BASE_SCORE := 100
const SPEED_BONUS := 50
## 第 4 关：每过这么多秒，一台还没修的故障会"扩散"一档（扣分 + 提示）
const SPREAD_SECONDS := 24.0
const SPREAD_PENALTY := 30


static func plans() -> Array:
	return [
		{
			"index": 1, "name": "新手入职", "grid": 3, "faults": 1,
			"locked_doors": 0, "time_limit": 0.0, "spread": false, "seed": 20260921,
			"extra_door_ratio": 0.18,
			"brief": "跟箭头走：先探开房间，点到闪红灯的设备，看读数再动手修。",
		},
		{
			"index": 2, "name": "干扰排查", "grid": 5, "faults": 2,
			"locked_doors": 0, "time_limit": 0.0, "spread": false, "seed": 20260922,
			"extra_door_ratio": 0.3,
			"brief": "淡绿光圈的也在亮，但那是正常运行 —— 只有红色脉冲才是要修的那台。",
		},
		{
			"index": 3, "name": "受限区域", "grid": 7, "faults": 3,
			"locked_doors": 3, "time_limit": 0.0, "spread": false, "seed": 20260923,
			"extra_door_ratio": 0.34,
			"brief": "有几扇门锁着。先在已探开的房间里找到钥匙卡，再去开受限区。",
		},
		{
			"index": 4, "name": "全厂抢修", "grid": 9, "faults": 4,
			"locked_doors": 4, "time_limit": 260.0, "spread": true, "seed": 20260924,
			"extra_door_ratio": 0.4,
			"brief": "全厂停产等着。拖延的代价是故障扩散 —— 每一档扩散都要扣分。",
		},
	]


static func plan(index: int) -> Dictionary:
	var all := plans()
	return all[clampi(index, 0, all.size() - 1)]


static func count() -> int:
	return plans().size()
