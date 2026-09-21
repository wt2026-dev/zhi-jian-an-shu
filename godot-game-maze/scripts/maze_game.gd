class_name MazeGame
extends RefCounted
## 迷宫版《故障侦探》的**规则内核**：走位、探索、门禁卡、读数面板、修复小游戏、
## 计分/生命/倒计时/故障扩散 —— 全是纯逻辑，不碰节点也不碰画。
##
## 为什么单独一层：内置浏览器面板长期是 hidden 的，画面验收这条路随时会断；
## 而"点错零件必须扣命""锁门必须扣卡""钥匙在被锁的房里就是死局""0 秒 = 不限时"
## 这些恰恰是最容易被改坏、又最难靠截图发现的规则。放这里就能在
## `--headless` 下逐条断言（见 `scripts/selfcheck.gd` 第 8~11 节）。
##
## 内容边界：设备、读数、题面**只从 React 传进来的 `maze-data` 里取**（真实台账 +
## 真实规程）。本文件里出现的任何字符串都是玩家提示（"点错了"），不是题目内容。

signal event(kind: String, data: Dictionary)

enum Phase { EXPLORE, READOUT, REPAIR, SETTLE, GAME_OVER, WIN }

## 工程师每秒走几格。44px 一格，7 格/秒 ≈ 300px/秒，和横版那套 RUN_SPEED 同量级
const WALK_TILES_PER_SEC := 7.0
## 一次修对（本台的小游戏一次没点错）才给。不是"手快"奖励：
## 倒计时只压第 4 关，前三关不限时，用速度做奖励会让教学关变成拼手速。
const PERFECT_BONUS := LevelPlan.SPEED_BONUS
## 剩余时间奖励的除数：每 4 秒余量换 1 分，260s 满余量 ≈ 65 分，
## 和"一台 100 分"比是加分项而不是决定项 —— 别让倒计时变成唯一玩法。
const TIME_BONUS_DIV := 4.0

var plan: Dictionary = {}
var level: Dictionary = {}
var map: MazeMap
var roster: Dictionary = {}
var payload: Dictionary = {}
var level_index := 1
var phase: int = Phase.EXPLORE
var lives := LevelPlan.MAX_LIVES
var mistakes := 0
var score := 0
var keys := 0
## -1 = 不限时。⚠️ payload 里的 `timeLimit: 0` 必须换算成 -1，直接塞 0 的话
## 第一轮 tick 就判定"烧完了"（横版踩过，表现为开局瞬间结算、按键全无反应）。
var time_left := -1.0
var elapsed := 0.0
var next_spread_at := 1.0e20
var spread_hits := 0
var engineer_tile := Vector2i.ZERO
var pending_walk: Array = []
var walk_accum := 0.0
var walk_intent := ""
var walk_intent_data: Dictionary = {}
var selected: MazeMap.DeviceSlot = null
var repair_parts: Array = []
var repair_seq := 0
var repair_targets := 0
var repair_misses := 0
var repair_source := ""
var hint := ""
var brief := ""
var note := ""
var degraded := ""
var level_bonus := 0
var _seen_fault_ids: Dictionary = {}


# ============================ 装配 ============================

## 吃一份 `maze-data`。返回 false 表示这数据没法玩（空关会让玩家对着黑屏空转），
## 调用方应当停在"数据未接入"的提示上，而不是硬起一关。
func setup(p: Dictionary) -> bool:
	payload = p
	roster.clear()
	for d in p.get("devices", []):
		var dto: Dictionary = d
		roster[Txt.s(dto.get("id", ""))] = dto
	var levels: Array = p.get("levels", [])
	if roster.is_empty() or levels.is_empty():
		note = "未收到台账数据（maze-data 的 devices/levels 为空）：游戏不启动，未编造设备"
		return false
	level_index = 1
	lives = LevelPlan.MAX_LIVES
	mistakes = 0
	score = 0
	start_level(1)
	return true


func levels() -> Array:
	return payload.get("levels", [])


func level_count() -> int:
	return levels().size()


func level_dto(index: int) -> Dictionary:
	for l in levels():
		if int((l as Dictionary).get("index", 0)) == index:
			return l
	return {}


## 开第 `index` 关：按关卡形状重造厂区，再把 payload 里的真实设备摆进去。
func start_level(index: int) -> void:
	level_index = clampi(index, 1, maxi(1, level_count()))
	plan = LevelPlan.plan(level_index - 1)
	level = level_dto(level_index)
	if level.is_empty():
		level = {"index": level_index, "gridRooms": int(plan.get("grid", 3)), "faults": [], "degraded": null}
	phase = Phase.EXPLORE
	phase_reset()
	_build_map()
	brief = Txt.s(plan.get("brief", ""))
	note = Txt.s(level.get("note", ""))
	degraded = Txt.s(level.get("degraded", "")) if level.get("degraded") != null else ""
	hint = "第 %d 关：%s" % [level_index, brief]
	event.emit("level_started", {"index": level_index})


## 每关重置的只是"这一关的状态"；分数/生命跨关累计（通关奖励、一命通关才有意义）
func phase_reset() -> void:
	phase = Phase.EXPLORE
	selected = null
	repair_parts = []
	repair_seq = 0
	repair_targets = 0
	repair_misses = 0
	pending_walk.clear()
	walk_accum = 0.0
	walk_intent = ""
	walk_intent_data = {}
	level_bonus = 0
	_seen_fault_ids.clear()
	var tl := float(level.get("timeLimit", plan.get("time_limit", 0.0)))
	if tl <= 0.0:
		tl = float(plan.get("time_limit", 0.0))
	time_left = tl if tl > 0.0 else -1.0
	elapsed = 0.0
	spread_hits = 0
	next_spread_at = 1.0e20 if not bool(plan.get("spread", false)) else LevelPlan.SPREAD_SECONDS


func _build_map() -> void:
	map = MazeMap.new()
	var grid := int(level.get("gridRooms", plan.get("grid", 3)))
	var locked := int(level.get("lockedRooms", plan.get("locked_doors", 0)))
	var cards := int(level.get("keycardCount", -1))
	map.build(grid, int(plan.get("seed", 1)), locked, float(plan.get("extra_door_ratio", 0.28)), cards)
	keys = 0

	var faults: Array = level.get("faults", [])
	var fault_ids: Array = []
	var meta: Array = []
	for f in faults:
		var fd: Dictionary = f
		var did := Txt.s(fd.get("deviceId", ""))
		if not roster.has(did):
			# 名单里没有这台设备 = React 那边把关卡引用的设备裁掉了。宁可少一台故障，
			# 也不在这里凭空补一台 —— 补出来的名字和读数全是编的。
			continue
		fault_ids.append(did)
		meta.append(_meta_of(did))
	map.place_faults(fault_ids, meta)

	var dist_ids: Array = []
	var dist_meta: Array = []
	for did in level.get("distractorIds", []):
		var id := Txt.s(did)
		if roster.has(id) and not _seen_fault_ids.has(id):
			dist_ids.append(id)
			dist_meta.append(_meta_of(id))
	map.place_distractors(dist_ids, dist_meta)
	for f in faults:
		_seen_fault_ids[Txt.s((f as Dictionary).get("deviceId", ""))] = true

	engineer_tile = map.spawn_tile
	map.explore_room(map.room_of_tile(engineer_tile).id)


func _meta_of(device_id: String) -> Dictionary:
	var dto: Dictionary = roster.get(device_id, {})
	return {
		"name": Txt.s(dto.get("name", "")),
		"no": Txt.s(dto.get("no", "")),
		"category": Txt.s(dto.get("category", "")),
		"icon": Txt.s(dto.get("icon", "machine")),
		"has_procedure": true,
	}


## payload 里这台设备的故障条目（拿不到返回空字典）
func fault_dto_of(device_id: String) -> Dictionary:
	for f in level.get("faults", []):
		if Txt.s((f as Dictionary).get("deviceId", "")) == device_id:
			return f
	return {}


func spots_of(device_id: String) -> Array:
	var dto: Dictionary = roster.get(device_id, {})
	var spots: Array = dto.get("spots", [])
	return spots


# ============================ 交互：点地图 ============================

## 点一格。黑格不响应（还没探开的地方凭什么点得中）；设备 > 钥匙卡 > 锁门 > 可走地面。
func tap(t: Vector2i) -> void:
	if phase != Phase.EXPLORE:
		return
	if not map.in_bounds(t) or not map.tile_explored(t):
		hint = "那片区域还没探开 —— 先在亮着的房间里走走"
		event.emit("blocked", {"tile": t})
		return
	var slot := map.device_at(t)
	if slot != null:
		_pick_device(slot)
		return
	var kc := map.keycard_at(t)
	if kc != null and not kc.taken:
		_walk_to(t, "keycard", {"keycard_id": kc.id})
		return
	var door := map.door_at(t)
	if door != null and door.locked and not door.open:
		_walk_to(t, "door", {"door_id": door.id})
		return
	if map.passable(t, keys):
		_walk_to(t, "move", {})
		return
	hint = "那里过不去：前面是墙"
	event.emit("blocked", {"tile": t})


func _pick_device(slot: MazeMap.DeviceSlot) -> void:
	selected = slot
	_walk_to(slot.tile, "inspect", {"device_id": slot.device_id})
	phase = Phase.READOUT
	event.emit("device_picked", {"device_id": slot.device_id})


func _walk_to(t: Vector2i, intent: String, data: Dictionary) -> void:
	var p := map.path(engineer_tile, t, keys)
	if p.is_empty() and engineer_tile != t:
		hint = "走不到那里（被墙或锁着的门挡住了）"
		event.emit("blocked", {"tile": t})
		return
	pending_walk = p
	walk_accum = 0.0
	walk_intent = intent
	walk_intent_data = data


# ============================ 推进 ============================

func tick(dt: float) -> void:
	if phase == Phase.GAME_OVER or phase == Phase.WIN:
		return
	elapsed += dt
	_advance_walk(dt)
	_tick_spread()
	_tick_clock(dt)


func _advance_walk(dt: float) -> void:
	if pending_walk.is_empty():
		return
	walk_accum += dt * WALK_TILES_PER_SEC
	while not pending_walk.is_empty() and walk_accum >= 1.0:
		walk_accum -= 1.0
		engineer_tile = pending_walk[0]
		pending_walk.pop_front()
		_enter_tile(engineer_tile)
	if pending_walk.is_empty():
		_arrive()


## 走一格就探开它所属的房间 —— 这就是"走过才亮"，不是"镜头扫到就亮"。
## 站在门格上时两侧都点亮：人已经到门口了，只亮一侧会让下一步"往哪儿走"
## 在迷雾里彻底看不见（门里的房间连地面都不显示，点也点不动）。
func _enter_tile(t: Vector2i) -> void:
	event.emit("step", {"tile": t})
	var room := map.room_of_tile(t)
	if room != null:
		if map.explore_room(room.id):
			event.emit("room_explored", {"room_id": room.id, "room_name": room.name})
		return
	var door := map.door_at(t)
	if door == null:
		return
	for rid in [door.a, door.b]:
		var r: MazeMap.Room = map.rooms[int(rid)]
		if map.explore_room(r.id):
			event.emit("room_explored", {"room_id": r.id, "room_name": r.name})


func _arrive() -> void:
	var intent := walk_intent
	var data := walk_intent_data
	walk_intent = ""
	walk_intent_data = {}
	match intent:
		"keycard":
			_take_keycard(int(data.get("keycard_id", -1)))
		"door":
			_try_door(int(data.get("door_id", -1)))
		"inspect":
			# 面板在点下的那一刻就弹了，走到只是补个"人到位了"的交代
			event.emit("arrived", data)
		_:
			pass


func _take_keycard(kid: int) -> void:
	for k in map.keycards:
		var kc: MazeMap.Keycard = k
		if kc.id != kid or kc.taken:
			continue
		kc.taken = true
		keys += 1
		hint = "捡到门禁卡（手上 %d 张）：棕色带锁的房间门可以开了" % keys
		event.emit("keycard_taken", {"keys": keys})
		return


func _try_door(did: int) -> void:
	if did < 0 or did >= map.doors.size():
		return
	var d: MazeMap.Door = map.doors[did]
	if not d.locked or d.open:
		return
	if keys <= 0:
		hint = "这扇门上着锁 —— 得先找到门禁卡（已探开的房间里翻）"
		mistakes += 1
		event.emit("door_denied", {"door_id": did})
		return
	keys -= 1
	d.open = true
	map.explore_room(d.a)
	map.explore_room(d.b)
	hint = "刷卡开门（剩 %d 张）：里面的房间亮起来了" % keys
	event.emit("door_opened", {"door_id": did, "keys": keys, "tile": d.tile})


func _tick_clock(dt: float) -> void:
	if time_left < 0.0:
		return
	time_left = maxf(0.0, time_left - dt)
	if time_left > 0.0:
		return
	if map.pending_faults().is_empty():
		return
	phase = Phase.GAME_OVER
	hint = "倒计时归零，还有 %d 台故障没处理 —— 本关失败" % map.pending_faults().size()
	event.emit("time_out", {})


func _tick_spread() -> void:
	if not bool(plan.get("spread", false)):
		return
	var pending: Array = []
	for slot in map.pending_faults():
		var s: MazeMap.DeviceSlot = slot
		if fault_dto_of(s.device_id).get("spreadable", false):
			pending.append(s)
	if pending.is_empty():
		next_spread_at = elapsed + LevelPlan.SPREAD_SECONDS
		return
	if elapsed < next_spread_at:
		return
	next_spread_at = elapsed + LevelPlan.SPREAD_SECONDS
	spread_hits += 1
	var victim: MazeMap.DeviceSlot = pending[spread_hits % pending.size()]
	victim.spread = true
	score = maxi(0, score - LevelPlan.SPREAD_PENALTY)
	hint = "「%s」的故障扩散了：扣 %d 分。再不动手还会继续扣" % [victim.name, LevelPlan.SPREAD_PENALTY]
	event.emit("spread", {"device_id": victim.device_id, "penalty": LevelPlan.SPREAD_PENALTY})


# ============================ 修复小游戏 ============================

## 从读数面板进入修复小游戏。题目（要点的操作牌）**只取自真实规程**：
## 优先用那道 `order` 题的 `items`（规程原文拆出来的动作），没有排序题时退回
## "按 payload 里 steps 的先后点"（那就是规程步骤的原序），两种都不编造内容。
func begin_repair() -> void:
	if selected == null or phase != Phase.READOUT:
		return
	if not selected.faulty:
		hint = "这台设备读数正常，没有待办检修工单 —— 它是干扰项"
		return
	if selected.cleared:
		hint = "「%s」已经修好了" % selected.name
		return
	phase = Phase.REPAIR
	repair_seq = 0
	repair_misses = 0
	repair_parts = []
	var spec: Dictionary = repair_spec(selected.device_id, _fault_steps(), distractor_pool())
	repair_parts = spec.get("parts", [])
	repair_targets = int(spec.get("targets", 0))
	repair_source = Txt.s(spec.get("source", ""))
	hint = "按规程顺序点 %d 个操作件（点错扣 1 条命）" % repair_targets
	event.emit("repair_started", {"device_id": selected.device_id, "source": repair_source})


func _fault_steps() -> Array:
	if selected == null:
		return []
	var st: Array = fault_dto_of(selected.device_id).get("steps", [])
	return st


## 纯函数：把真实 steps 编成"屏幕上的一排操作牌"。自检直接调它，不需要现场。
static func repair_spec(device_id: String, steps: Array, extra_pool: Array = []) -> Dictionary:
	var targets: Array = []
	var source := ""
	for s in steps:
		var sd: Dictionary = s
		if Txt.s(sd.get("kind", "")) == "order":
			var items: Array = sd.get("items", [])
			if items.size() >= 3:
				for i in range(mini(3, items.size())):
					targets.append(Txt.s(items[i]))
				source = "检修规程排序题（真实动作，按规程原序点）"
			break
	if targets.is_empty():
		for s in steps:
			var sd: Dictionary = s
			var label := Txt.s(sd.get("title", ""))
			if label != "" and targets.size() < 3:
				targets.append(label)
		source = "规程步骤顺序（这台设备的规程没给出 3 个以上动作，按步骤先后点）"
	var out: Array = []
	var used: Dictionary = {}
	for i in range(targets.size()):
		var label: String = Txt.s(targets[i])
		if used.has(label):
			continue
		used[label] = true
		out.append({"label": label, "seq": i, "clicked": false})
	# 干扰项：只从别的设备/别的题的真实文本里取，取不到就不摆 —— 空位也比编一个好看
	var pool: Array = []
	for row in extra_pool:
		var text := Txt.s(row)
		if not used.has(text) and not pool.has(text):
			pool.append(text)
	var want := clampi(out.size() - 1, 0, 3)
	for i in range(mini(want, pool.size())):
		out.append({"label": pool[i], "seq": -1, "clicked": false})
	return {"parts": out, "targets": targets.size(), "source": source, "device_id": device_id}


func click_part(i: int) -> void:
	if phase != Phase.REPAIR or i < 0 or i >= repair_parts.size():
		return
	var p: Dictionary = repair_parts[i]
	if bool(p.get("clicked", false)):
		return
	var seq := int(p.get("seq", -1))
	if seq != repair_seq:
		repair_misses += 1
		_lose_life("点错了「%s」：规程里的下一个动作是「%s」" % [Txt.s(p.get("label", "")), _expected_label()])
		# 打回重排：整串重新点。只回退一格的话，玩家看不见自己错在哪一步，
		# 只会反复点同一个位置 —— 教学场景里这比扣命更劝退。
		repair_seq = 0
		for q in repair_parts:
			q["clicked"] = false
		event.emit("repair_wrong", {"index": i, "lives": lives})
		return
	p["clicked"] = true
	repair_seq += 1
	event.emit("repair_right", {"index": i, "seq": seq})
	if repair_seq >= repair_targets:
		_finish_repair()


func _expected_label() -> String:
	for p in repair_parts:
		if int(p.get("seq", -1)) == repair_seq:
			return Txt.s(p.get("label", ""))
	return "（无）"


func _finish_repair() -> void:
	if selected == null:
		return
	selected.cleared = true
	var done_id := selected.device_id
	var gained := LevelPlan.BASE_SCORE
	if repair_misses == 0:
		gained += PERFECT_BONUS
	score += gained
	phase = Phase.EXPLORE
	hint = "「%s」修复完成，+%d 分（一次修对 +%d）" % [selected.name, gained, PERFECT_BONUS]
	# 修完就松手：面板留在"已修复"状态会让人以为还要再点一次，回到地图找下一台才对
	selected = null
	event.emit("repair_done", {"device_id": done_id, "gained": gained, "perfect": repair_misses == 0})
	if map.pending_faults().is_empty():
		_complete_level()


## 面板上的"返回"：修不好可以退回地图再想想（不扣命，扣不了命才算宽容的错误成本）
func close_panel() -> void:
	if phase == Phase.READOUT or phase == Phase.REPAIR:
		phase = Phase.EXPLORE
		selected = null
		repair_parts = []
		event.emit("panel_closed", {})


func _complete_level() -> void:
	level_bonus = 0
	if time_left > 0.0:
		level_bonus = int(time_left / TIME_BONUS_DIV)
		score += level_bonus
	phase = Phase.SETTLE if level_index < level_count() else Phase.WIN
	hint = "本关 %d 台故障全部处理完%s" % [
		level.get("faults", []).size(),
		"，时间奖励 +%d 分" % level_bonus if level_bonus > 0 else ""
	]
	event.emit("level_done", {"index": level_index, "bonus": level_bonus, "score": score})


func next_level() -> void:
	if phase == Phase.SETTLE and level_index < level_count():
		start_level(level_index + 1)


func _lose_life(msg: String) -> void:
	mistakes += 1
	lives = maxi(0, lives - 1)
	hint = msg
	if lives <= 0:
		phase = Phase.GAME_OVER
		event.emit("game_over", {"reason": msg})


## 面板 / HUD 共用的读数视图：异常红、缺失「未接入」，都不在这里改数值。
func readout_of(slot: MazeMap.DeviceSlot) -> Dictionary:
	if slot == null:
		return {}
	var spots: Array = []
	for s in spots_of(slot.device_id):
		var sd: Dictionary = s
		var reading = sd.get("reading", null)
		spots.append({
			"label": Txt.s(sd.get("label", "")),
			"reading": Txt.s(reading) if reading != null else "未接入",
			"abnormal": bool(sd.get("abnormal", false)),
			"severity": Txt.s(sd.get("severity", "")),
		})
	return {
		"name": slot.name,
		"no": slot.no,
		"category": slot.category,
		"icon": slot.icon,
		"faulty": slot.faulty,
		"cleared": slot.cleared,
		"spread": slot.spread,
		"spots": spots,
		"has_order": not _order_items(slot.device_id).is_empty(),
	}


func _order_items(device_id: String) -> Array:
	for s in fault_dto_of(device_id).get("steps", []):
		var sd: Dictionary = s
		if Txt.s(sd.get("kind", "")) == "order":
			var items: Array = sd.get("items", [])
			return items
	return []


## 干扰项的原料：别的故障设备的规程动作 + 工具题选项（都是真实文本，不编）
func distractor_pool() -> Array:
	var out: Array = []
	for f in level.get("faults", []):
		var fd: Dictionary = f
		if selected != null and Txt.s(fd.get("deviceId", "")) == selected.device_id:
			continue
		for s in fd.get("steps", []):
			var sd: Dictionary = s
			for it in sd.get("items", []):
				if not out.has(Txt.s(it)):
					out.append(Txt.s(it))
			for o in sd.get("options", []):
				if not out.has(Txt.s(o)):
					out.append(Txt.s(o))
	return out


func is_distractor(device_id: String) -> bool:
	return fault_dto_of(device_id).is_empty()


# ============================ 快照 ============================

func snapshot() -> Dictionary:
	return {
		"level_index": level_index,
		"level_count": level_count(),
		"phase": phase,
		"lives": lives,
		"score": score,
		"mistakes": mistakes,
		"keys": keys,
		"time_left": time_left,
		"elapsed": elapsed,
		"explored": map.explored_ratio(),
		"rooms": map.rooms.size(),
		"pending": map.pending_faults().size(),
		"total_faults": level.get("faults", []).size(),
		"hint": hint,
		"brief": brief,
		"note": note,
		"degraded": degraded,
		"spread_hits": spread_hits,
		"bonus": level_bonus,
		"repair": {
			"source": repair_source,
			"targets": repair_targets,
			"seq": repair_seq,
			"misses": repair_misses,
		},
	}
