extends Node
## 无头自检（`godot --headless --path godot-game-maze res://scenes/SelfCheck.tscn`）。
##
## 为什么要它：本项目的内置浏览器面板经常是 hidden 状态，rAF 不触发 →
## Canvas 根本没法挂载，"打开页面看一眼"这条验收路是断的。所以把**能算的**全部搬到命令行：
## 迷宫连通性、锁与钥匙的可解性、点击到格子的投影、地砖配色、音效响不响。
## 目视部分只留一个产物：`_preview/maze_art_montage.png`。
##
## 为什么用场景而不是 `--script`：`--script` 下在 `_init` 里调 `quit()` 会被随后的
## main loop 初始化覆盖，进程永远不退出（`godot-game-2d` 已经踩过一次）。

var problems: Array[String] = []
var _maps: Dictionary = {}
var _passes := 0


func _ready() -> void:
	print("=== 故障侦探 · 俯视迷宫 自检 ===")
	_check_map_logic()
	_check_reachability()
	_check_fog()
	_check_projection()
	_check_art()
	_check_sound()
	var payload := _check_payload()
	_check_rules(payload)
	_check_fonts(payload)
	_write_montage()
	# 断言条数下限：某一段中途报错就再也不会执行到后面的 `_check`，而 `problems`
	# 那时是空的 —— 于是"没跑完"会被念成"全部通过"。这条兜住那种假绿。
	_check(_passes >= MIN_ASSERTS,
		"实际执行 %d 条断言（下限 %d；掉了说明有检查段中途报错退出）" % [_passes, MIN_ASSERTS])
	if problems.is_empty():
		print("\n自检全部通过 ✅（%d 条断言）" % _passes)
		get_tree().quit(0)
		return
	print("\n自检失败 %d 条 ❌" % problems.size())
	for p in problems:
		print("  - ", p)
	get_tree().quit(1)


## 每次改自检都按实际输出调整：这个数只用来抓"整段没跑完"，不用来记精确条数。
const MIN_ASSERTS := 175


## Color 没有 distance_to：自己算 RGB 欧氏距离（阈值 0.06 ≈ 肉眼不可辨的偏色）
func _close(a: Color, b: Color) -> float:
	return sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)


func _check(cond: bool, msg: String) -> void:
	if cond:
		_passes += 1
		print("  ✓ ", msg)
	else:
		problems.append(msg)
		print("  ❌ ", msg)


# ============================ 迷宫逻辑 ============================

func _check_map_logic() -> void:
	print("\n[1] 迷宫结构：房间 / 墙 / 门 / 锁")
	for plan in LevelPlan.plans():
		var grid := int(plan.get("grid", 3))
		var locked := int(plan.get("locked_doors", 0))
		var map := MazeMap.new()
		map.build(grid, int(plan.get("seed", 1)), locked, float(plan.get("extra_door_ratio", 0.3)))
		_maps[grid] = map
		var label := "第%d关 %d×%d" % [int(plan.get("index", 0)), grid, grid]
		print("    · %s：%d 房间 / %d 门 / %d 锁 / %d 钥匙卡 / %d 格×%d 格" % [
			label, map.rooms.size(), map.doors.size(), map.locked_count(), map.keycards.size(),
			map.tile_w, map.tile_h
		])
		_check(map.rooms.size() == grid * grid, "%s 房间数 = %d²" % [label, grid])
		_check(map.doors.size() >= map.rooms.size() - 1, "%s 门数够连成生成树（不是一堆孤岛房间）" % label)
		_check(map.rooms_reachable_all(), "%s 忽略锁时全部房间连通" % label)
		_check(map.solvable(), "%s 有钥匙卡的前提下最终所有房间可达（无死锁）" % label)
		_check(map.locked_count() == locked, "%s 上锁门数 = 关卡设定的 %d" % [label, locked])
		_check(map.keycards.size() >= map.locked_count(),
			"%s 钥匙卡不少于锁数（少一张就有房间永远进不去）" % label)
		_check(_wall_mass(map), "%s 房间之间有实体墙（不是打通的一片）" % label)
		_check(_doors_on_shared_wall(map), "%s 每扇门都落在两房间的共墙上" % label)
		# 3×3 是教学关，一棵树的"蛇形"就够短；5×5 以上必须出现环路门，
		# 否则 49 个房间串成一条线，玩家转身都难，不像厂区像贪吃蛇。
		if grid >= 5:
			_check(map.doors.size() > map.rooms.size() - 1,
				"%s 除生成树外还有环路门（%d 门 / %d 房间）" % [label, map.doors.size(), map.rooms.size()])


func _wall_mass(map: MazeMap) -> bool:
	var walls := 0
	for y in range(map.tile_h):
		for x in range(map.tile_w):
			if int(map.tiles[y][x]) == MazeMap.Tile.WALL:
				walls += 1
	return walls > map.tile_w * map.tile_h / 4


func _doors_on_shared_wall(map: MazeMap) -> bool:
	for entry in map.doors:
		var door: MazeMap.Door = entry
		if int(map.tiles[door.tile.y][door.tile.x]) != MazeMap.Tile.DOOR:
			return false
		var horiz := map.room_of_tile(door.tile + Vector2i(-1, 0)) != null \
			and map.room_of_tile(door.tile + Vector2i(1, 0)) != null
		var vert := map.room_of_tile(door.tile + Vector2i(0, -1)) != null \
			and map.room_of_tile(door.tile + Vector2i(0, 1)) != null
		if not (horiz or vert):
			return false
	return true


# ============================ 可达性与点击走位 ============================

func _check_reachability() -> void:
	print("\n[2] 点击走位：出生点到每台设备都走得通")
	for plan in LevelPlan.plans():
		var grid := int(plan.get("grid", 3))
		var label := "第%d关 %d×%d" % [int(plan.get("index", 0)), grid, grid]
		var map: MazeMap = _maps[grid]
		var faults := int(plan.get("faults", 1))
		var ids: Array = []
		var meta: Array = []
		for i in range(faults):
			ids.append("dev-%d" % i)
			meta.append({
				"name": "11# 给水泵" if i == 0 else "设备%d" % i,
				"no": "EQ-%03d" % i, "category": "泵类设备", "icon": "pump", "has_procedure": true
			})
		map.place_faults(ids, meta)
		var dis: Array = []
		var dmeta: Array = []
		for i in range(3):
			dis.append("dis-%d" % i)
			dmeta.append({
				"name": "正常设备%d" % i, "no": "EQ-1%02d" % i,
				"category": "大型电机", "icon": "motor", "has_procedure": true
			})
		map.place_distractors(dis, dmeta)

		var unreachable: Array = []
		for entry in map.devices:
			var s: MazeMap.DeviceSlot = entry
			if s.tile == map.spawn_tile:
				continue
			# 走到门口可能需要钥匙：允许把手里的卡全用上
			if map.path(map.spawn_tile, s.tile, map.keycards.size()).is_empty():
				unreachable.append(s.name)
		_check(unreachable.is_empty(), "%s 每台设备都能从入口走到（%d 台）%s" % [
			label, map.devices.size(), "" if unreachable.is_empty() else "，走不到：%s" % str(unreachable)
		])
		_check(map.pending_faults().size() == faults,
			"%s 故障设备 = 关卡设定的 %d 台" % [label, faults])
		_check(_fault_rooms_spread(map), "%s 故障设备分散在不同房间（逼着探索）" % label)
		_check(_first_fault_needs_walking(map), "%s 第一台故障不在出生点脚下（教学关也得走两步）" % label)


func _fault_rooms_spread(map: MazeMap) -> bool:
	var seen: Dictionary = {}
	for entry in map.pending_faults():
		var s: MazeMap.DeviceSlot = entry
		if seen.has(s.room_id):
			return false
		seen[s.room_id] = true
	return true


func _first_fault_needs_walking(map: MazeMap) -> bool:
	var list := map.pending_faults()
	if list.is_empty():
		return false
	return (list[0] as MazeMap.DeviceSlot).tile != map.spawn_tile


# ============================ 战争迷雾 ============================

func _check_fog() -> void:
	print("\n[3] 战争迷雾：没走过的房间是黑的")
	var map: MazeMap = _maps[3]
	_check(map.explored_ratio() < 0.2,
		"开局只亮入口大厅一间（覆盖 %.0f%%）" % (map.explored_ratio() * 100.0))
	var spawn_room: MazeMap.Room = map.room_of_tile(map.spawn_tile)
	_check(map.tile_explored(spawn_room.center_tile()), "已探房间内地格是亮的")
	var far: MazeMap.Room = map.rooms[map.rooms.size() - 1]
	_check(not map.tile_explored(far.center_tile()), "未探房间内地格是黑的")
	var was_dark := not far.explored
	_check(map.explore_room(far.id) and was_dark, "走进陌生房间会点亮它")
	_check(not map.explore_room(far.id), "重复进入不再生效（开门声不会连响）")
	_check(map.explored_ratio() > 0.2, "点亮后覆盖率上升（小地图要跟着变）")


# ============================ 斜俯视投影 ============================

func _check_projection() -> void:
	print("\n[4] 斜俯视投影：格 ↔ 屏幕必须严格可逆（点不中设备就是这里错）")
	var a := MazeArt.screen_of_tile(Vector2i(0, 0))
	var b := MazeArt.screen_of_tile(Vector2i(1, 0))
	var c := MazeArt.screen_of_tile(Vector2i(0, 1))
	_check(is_equal_approx(b.x - a.x, float(MazeArt.TILE)), "横向一格 = %d px" % MazeArt.TILE)
	_check(absf((c.y - a.y) - MazeArt.TILE * MazeArt.SQUASH) < 0.01,
		"纵向一格 = %.1f px（被压到 %.2f）" % [MazeArt.TILE * MazeArt.SQUASH, MazeArt.SQUASH])
	_check(c.y - a.y < b.x - a.x, "Y 被压缩 → 视角来自斜上方，不是正俯视也不是横版")
	for t in [Vector2i(0, 0), Vector2i(4, 7), Vector2i(13, 19), Vector2i(72, 55)]:
		var p := MazeArt.screen_of_tile(t)
		var back := MazeArt.tile_of_screen(p)
		_check(back == t, "格 %s 投影到 %s 后反解回 %s" % [str(t), str(p), str(back)])


# ============================ 美术 ============================

func _check_art() -> void:
	print("\n[5] 美术：地砖图集与设备图标")
	var img := MazeArt.atlas_image()
	_check(img.get_width() == MazeArt.TILE * MazeArt.TILE_COUNT and img.get_height() == MazeArt.TILE,
		"图集 %d×%d，%d 块砖" % [img.get_width(), img.get_height(), MazeArt.TILE_COUNT])
	var wall_top := img.get_pixel(MazeArt.TILE * MazeArt.T_WALL + 8, 4)
	_check(_close(wall_top, MazeArt.C_WALL_TOP) < 0.06,
		"墙面浅灰蓝 (%.2f, %.2f, %.2f)" % [wall_top.r, wall_top.g, wall_top.b])
	var floor_c := img.get_pixel(MazeArt.TILE * MazeArt.T_FLOOR + 22, 34)
	_check(floor_c.v < 0.35, "地面深灰，不是白底")
	var line := img.get_pixel(MazeArt.TILE * MazeArt.T_FLOOR_LINE_H + 2, 21)
	_check(_close(line, MazeArt.C_LINE) < 0.08, "地砖黄标线存在")
	# 取样点躲开锁孔（那是更深的 #8a5a17，本来就该和锁体不同色）
	var locked := img.get_pixel(MazeArt.TILE * MazeArt.T_DOOR_LOCKED + 18, 16)
	_check(_close(locked, MazeArt.C_LOCK) < 0.08, "上锁门带锁色标记（第 3 关一眼知道哪扇要卡）")
	var open_door := img.get_pixel(MazeArt.TILE * MazeArt.T_DOOR + MazeArt.TILE / 2, MazeArt.TILE / 2)
	_check(open_door != locked, "开着的门与锁着的门不是同一张图")
	var warm := img.get_pixel(MazeArt.TILE * MazeArt.T_FLOOR_WARM + 22, 22)
	var corner := img.get_pixel(MazeArt.TILE * MazeArt.T_FLOOR_WARM + 2, 2)
	_check(warm.v > corner.v, "房间中央比角落亮（顶灯效果）")
	for kind in ["pump", "motor", "compressor", "gearbox", "vessel", "machine"]:
		var icon := MazeArt.icon_texture(kind, MazeArt.C_CYAN, 56).get_image()
		var filled := 0
		for y in range(icon.get_height()):
			for x in range(icon.get_width()):
				if icon.get_pixel(x, y).a > 0.5:
					filled += 1
		_check(filled > 120, "图标 %s 非空（着色 %d px）" % [kind, filled])


# ============================ 音效 ============================

func _check_sound() -> void:
	print("\n[6] 音效：合成结果到底响不响")
	for id in SoundKit.ids():
		var wav: AudioStreamWAV = SoundKit.wave_for(Txt.s(id))
		if wav == null:
			_check(false, "音效 %s 合成为空" % id)
			continue
		var st := SoundKit.analyze(wav.data)
		print("    · %s：%d 采样，峰值 %.2f，RMS %.3f" % [id, st.count, st.peak, st.rms])
		_check(absf(float(st.count) - float(SoundKit.expected_samples(Txt.s(id)))) <= 2.0,
			"%s 时长对得上" % id)
		_check(st.peak > 0.25 and st.peak <= 1.0, "%s 有响度且不削顶" % id)
		_check(st.rms > 0.02, "%s 不是静音" % id)
	var amb := SoundKit.wave_for("ambient")
	_check(amb.loop_mode == AudioStreamWAV.LOOP_FORWARD, "底噪是循环播放的（不然每两秒静一下）")
	var click := SoundKit.wave_for("click")
	_check(SoundKit.analyze(click.data).count < SoundKit.analyze(amb.data).count / 4,
		"'咔'是短音，不会盖住操作节奏")


# ============================ 真实 payload ============================

const PAYLOAD_PATH := "res://data/maze_payload.json"


## 读的是 React 侧 `buildMazePayload(真实台账, 真实规程)` 落下来的快照
## （`npx tsx scratch/dump_maze_payload.ts`）。
## 为什么不在这里手写一份假数据：那样"关卡内容全部来自真实规程"这条口径
## 就变成自检自己给自己出题了，React 侧改了题目这里也发现不了。
func _payload() -> Dictionary:
	if not FileAccess.file_exists(PAYLOAD_PATH):
		return {}
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(PAYLOAD_PATH))
	return parsed if parsed is Dictionary else {}


func _check_payload() -> Dictionary:
	print("\n[7] 真实 payload：关卡内容的来源核验")
	var p := _payload()
	if p.is_empty():
		_check(false, "读到 %s（先跑 npx tsx scratch/dump_maze_payload.ts）" % PAYLOAD_PATH)
		return {}
	var devices: Array = p.get("devices", [])
	var levels: Array = p.get("levels", [])
	print("    · devices=%d levels=%d" % [devices.size(), levels.size()])
	_check(Txt.s(p.get("type", "")) == "maze-data", "消息类型 maze-data（与 React 侧常量一致）")
	_check(devices.size() > 0, "台账设备 %d 台（真实 id / 编号 / 读数）" % devices.size())
	_check(levels.size() == LevelPlan.count(), "关卡数 = %d" % LevelPlan.count())
	var want := [1, 2, 3, 4]
	for i in range(levels.size()):
		var l: Dictionary = levels[i]
		var faults: Array = l.get("faults", [])
		var grid := int(l.get("gridRooms", 0))
		_check(faults.size() == want[i], "第%d关故障 %d 台（产品口径 %d 台）" % [i + 1, faults.size(), want[i]])
		_check(grid == int(LevelPlan.plan(i).get("grid", 0)),
			"第%d关网格 %d×%d 与关卡表一致" % [i + 1, grid, grid])
		_check(int(l.get("timeLimit", 0)) > 0 == (i == 3), "只有第 4 关限时（其余 0 = 不限时）")
		_check(int(l.get("keycardCount", 0)) >= int(l.get("lockedRooms", 0)),
			"第%d关门禁卡 %d ≥ 锁门 %d" % [i + 1, int(l.get("keycardCount", 0)), int(l.get("lockedRooms", 0))])
		var fault_ids: Array = []
		for f in faults:
			var fd: Dictionary = f
			var did := Txt.s(fd.get("deviceId", ""))
			fault_ids.append(did)
			_check(_roster_has(devices, did), "第%d关故障设备 %s 在名单里" % [i + 1, did])
			var order = _order_step(fd.get("steps", []))
			_check(order != null, "第%d关「%s」有排序题（修复小游戏取材处）" % [i + 1, Txt.s(fd.get("deviceName", ""))])
			if order != null:
				_check((order as Dictionary).get("items", []).size() >= 3,
					"「%s」的操作件 ≥3 个真实动作" % Txt.s(fd.get("deviceName", "")))
		for x in l.get("distractorIds", []):
			_check(not fault_ids.has(Txt.s(x)), "第%d关干扰项 %s 不与故障位重叠" % [i + 1, Txt.s(x)])
	var missing := 0
	for d in devices:
		for s in (d as Dictionary).get("spots", []):
			if (s as Dictionary).get("reading", null) == null:
				missing += 1
	_check(missing > 0, "台账确有缺测点：%d 处 reading=null → 界面显示「未接入」而不是 0" % missing)
	return p


func _roster_has(devices: Array, id: String) -> bool:
	for d in devices:
		if Txt.s((d as Dictionary).get("id", "")) == id:
			return true
	return false


func _order_step(steps: Array):
	for s in steps:
		if Txt.s((s as Dictionary).get("kind", "")) == "order":
			return s
	return null


# ============================ 规则内核：纯点击通关 ============================

func _check_rules(p: Dictionary) -> void:
	print("\n[8] 规则内核：只用点击，把四关一台台修完")
	if p.is_empty():
		_check(false, "无 payload，跳过规则内核核验")
		return
	var g := MazeGame.new()
	_check(g.setup(p), "装配 payload 成功")
	_check(g.time_left < 0.0, "第 1 关 timeLimit=0 换算成「不限时」（不是 0 秒开局即结算）")
	_check(absf(g.map.explored_ratio() - 1.0 / 9.0) < 0.02,
		"开局只亮 1/9 间房（黑着 %.0f%%）" % ((1.0 - g.map.explored_ratio()) * 100.0))
	for idx in range(1, LevelPlan.count() + 1):
		var cleared := _clear_level(g)
		var total := int(g.snapshot().total_faults)
		var s: Dictionary = g.snapshot()
		print("    · 第%d关：修好 %d/%d 台，积分 %d，误操作 %d，用时 %.1fs" % [
			idx, cleared, total, int(s.score), int(s.mistakes), float(s.elapsed)])
		_check(cleared == total, "第%d关 %d 台故障全部靠点击走位 + 修复清完" % [idx, total])
		_check(float(s.explored) > 0.2,
			"第%d关走过之后地图亮起来了（%.0f%%）" % [idx, float(s.explored) * 100.0])
	_check(int(g.snapshot().phase) == MazeGame.Phase.WIN, "四关全清 → 通关态")
	_check(int(g.snapshot().score) >= 400, "总积分 %d（每台基础分 100 起）" % int(g.snapshot().score))
	_check_penalty_rules(p)


## 只用 `tap()` + `tick()` 把一关修完（和玩家在屏幕上能做的事完全一样）。
## 返回修好的台数；卡住时返回当时已修的数量，让断言把"走不到哪儿"报出来。
func _clear_level(g: MazeGame) -> int:
	if int(g.phase) == MazeGame.Phase.SETTLE:
		g.next_level()     # 和玩家点「下一关」走同一条路，不在自检里开后门
	var first_fault = g.map.pending_faults().size()
	for round_i in range(60):
		var moved := false
		moved = _explore_reachable(g) or moved
		moved = _take_visible_keycards(g) or moved
		moved = _repair_visible_faults(g) or moved
		moved = _open_a_locked_door(g) or moved
		if g.map.pending_faults().is_empty():
			break
		if not moved:
			break
	return first_fault - g.map.pending_faults().size()


func _drain(g: MazeGame) -> void:
	var guard := 0
	while not g.pending_walk.is_empty() and guard < 500:
		g.tick(0.05)
		guard += 1


func _reach(g: MazeGame, target: Vector2i) -> bool:
	for guard in range(4000):
		_drain(g)
		if g.engineer_tile == target:
			return true
		if int(g.phase) == MazeGame.Phase.READOUT:
			g.close_panel()      # 路过别的设备把面板顶开了，关掉再走
		if int(g.phase) != MazeGame.Phase.EXPLORE:
			return false
		var p: Array = g.map.path(g.engineer_tile, target, g.keys)
		if p.is_empty():
			return false
		g.tap(p[0])
	return false


## 走遍所有"不要钥匙"的门：站在门口就把两侧房间点亮（和玩家能做的动作一样）
func _explore_reachable(g: MazeGame) -> bool:
	var moved := false
	for d in g.map.doors:
		var door: MazeMap.Door = d
		if door.locked and not door.open:
			continue
		var ra: MazeMap.Room = g.map.rooms[door.a]
		var rb: MazeMap.Room = g.map.rooms[door.b]
		if ra.explored and rb.explored:
			continue
		if not ra.explored and not rb.explored:
			continue
		if _reach(g, door.tile):
			moved = true
	return moved


func _take_visible_keycards(g: MazeGame) -> bool:
	var moved := false
	for k in g.map.keycards:
		var kc: MazeMap.Keycard = k
		if kc.taken or not g.map.tile_explored(kc.tile):
			continue
		if _reach(g, kc.tile):
			moved = true
	return moved


func _repair_visible_faults(g: MazeGame) -> bool:
	var moved := false
	for s in g.map.pending_faults():
		var slot: MazeMap.DeviceSlot = s
		var room: MazeMap.Room = g.map.rooms[slot.room_id]
		if not room.explored:
			continue
		if not _reach(g, slot.tile) or int(g.phase) != MazeGame.Phase.READOUT:
			continue
		g.begin_repair()
		if int(g.phase) != MazeGame.Phase.REPAIR:
			continue
		_click_in_order(g)
		moved = true
	return moved


func _open_a_locked_door(g: MazeGame) -> bool:
	if g.keys <= 0:
		return false
	for d in g.map.doors:
		var door: MazeMap.Door = d
		if not door.locked or door.open:
			continue
		var ra: MazeMap.Room = g.map.rooms[door.a]
		var rb: MazeMap.Room = g.map.rooms[door.b]
		if not ra.explored and not rb.explored:
			continue
		if _reach(g, door.tile):
			return true
	return false


func _click_in_order(g: MazeGame) -> void:
	for guard in range(80):
		if int(g.phase) != MazeGame.Phase.REPAIR:
			return
		var idx := _index_of_seq(g, g.repair_seq)
		if idx < 0:
			return
		g.click_part(idx)


func _index_of_seq(g: MazeGame, seq: int) -> int:
	for i in range(g.repair_parts.size()):
		if int((g.repair_parts[i] as Dictionary).get("seq", -2)) == seq:
			return i
	return -1


## 奖惩与失败判定：点错扣命、扣到 0 判负、扩散扣分、空手撞锁门算误操作不扣命
func _check_penalty_rules(p: Dictionary) -> void:
	var g := MazeGame.new()
	g.setup(p)
	var slot: MazeMap.DeviceSlot = g.map.pending_faults()[0]
	_reach(g, slot.tile)
	g.begin_repair()
	var wrong := _index_of_seq(g, g.repair_seq + 1)
	if wrong < 0:
		wrong = _index_of_seq(g, -1)
	_check(wrong >= 0, "屏幕上存在「顺序不对 / 干扰项」的操作牌（用来验惩罚）")
	var lives_before := g.lives
	var score_before := g.score
	g.click_part(wrong)
	_check(g.lives == lives_before - 1, "点错操作件扣 1 条命（%d → %d）" % [lives_before, g.lives])
	_check(g.repair_seq == 0, "点错之后整串重排（不是悄悄跳过那一步）")
	_check(g.score == score_before, "点错只扣命，不倒扣已有积分")
	g.lives = 1
	g.click_part(_index_of_seq(g, -1) if _index_of_seq(g, -1) >= 0 else wrong)
	_check(int(g.phase) == MazeGame.Phase.GAME_OVER, "生命扣光 → 本关失败")

	var h := MazeGame.new()
	h.setup(p)
	h.start_level(4)
	h.score = 100
	h.plan["spread"] = true
	h.next_spread_at = h.elapsed + 0.01
	h.tick(0.05)
	_check(h.spread_hits == 1, "第 4 关到点会扩散一档")
	_check(h.score == 100 - LevelPlan.SPREAD_PENALTY, "扩散扣 %d 分" % LevelPlan.SPREAD_PENALTY)
	_check(not h.map.pending_faults().is_empty(), "扩散不改变故障清单（只是视觉与扣分加压）")

	var k := MazeGame.new()
	k.setup(p)
	k.start_level(4)
	var tl := float(k.level.get("timeLimit", 0))
	_check(tl > 0.0 and k.time_left > 0.0, "第 4 关倒计时 %d 秒确实生效" % int(tl))
	k.time_left = 0.2
	k.tick(0.5)
	_check(int(k.phase) == MazeGame.Phase.GAME_OVER, "倒计时归零且还有未修故障 → 失败")


# ============================ 中文字形 ============================

## 验收口径里的"中文不乱码"不是玄学：字体子集缺哪个字就画成豆腐块。
##
## 查两段，缺一不可：
## 1. **界面自己写的文案** —— 改 HUD 时加了个生僻字，这里立刻掉一条；
## 2. **真实 payload 里的全部文本** —— 设备名、规程动作、工具名来自台账，
##    那是 React 侧随时可能换的数据（`11# 给水泵` 这种带 `#` 的名字已经在里面了）。
##    只查自己的文案等于把"数据里会不会有缺的字"这件事留到演示现场。
func _check_fonts(payload: Dictionary) -> void:
	print("\n[9] 中文不乱码：字体子集逐字查")
	var f: Font = load("res://assets/fonts/NotoSansSC.otf")
	_check(f != null, "内置字体加载成功")
	if f == null:
		return
	var ui := "故障侦探俯视迷宫入口大厅泵房配电室管道走廊控制室压缩机房仓库区出口积分时间" \
		+ "门禁卡未接入修复规程读数轴承温度振动负载异常正常设备编号类型位于找到红色脉冲" \
		+ "开始按顺序点击操作件点错扣命探开捡到刷卡开门生命奖励总分通关失败扩散" \
		+ "第关台需定位并修复健康干扰项别身耗先在图找张迟迟不修的会向相邻屋压"
	var data := _payload_text(payload)
	_check(_missing_glyphs(f, ui).is_empty(), "界面文案 %d 字全部有字形" % ui.length())
	# 字数下限是这条自己的护栏：摊出来是空的，"全部有字形"就成了句永远为真的空话
	# （第一版就是这样：`_payload_text` 中途抛错返回 ""，断言照样打 ✓）。
	_check(data.length() > 400 and _missing_glyphs(f, data).is_empty(),
		"真实数据文本 %d 字（设备名/规程动作/工具名）全部有字形" % data.length())
	# 装饰符号允许缺（HUD 有 ASCII 兜底），只把现状打出来，别让它"看着像坏了"
	var syms := {"❤": 0x2764, "♡": 0x2661, "∞": 0x221E, "●": 0x25CF, "○": 0x25CB, "✔": 0x2714, "⚠": 0x26A0}
	var avail: Array[String] = []
	for k in syms.keys():
		if f.has_char(int(syms[k])):
			avail.append(Txt.s(k))
	print("    · 可选符号有字形：%s（其余走 ●/○/V/! 兜底）" % (" ".join(avail) if not avail.is_empty() else "无"))
	# 顶栏爱心走的是符号区，必须**成对**可用：半套 ●♡ 比两套都丑，
	# 而这一行在演示时正好摆在屏幕最上方，谁都看得见。
	var hearts: Array = GameHud.pick_heart_pair(f)
	_check(f.has_char(int(hearts[0])) and f.has_char(int(hearts[1])),
		"顶栏生命符号用「%s / %s」，两个码位都有字形" % [String.chr(int(hearts[0])), String.chr(int(hearts[1]))])


## 把 payload 里所有会显示给人看的字符串摊成一段文本（键名不参与，那些不上屏）
func _payload_text(payload: Dictionary) -> String:
	var out := ""
	for d in payload.get("devices", []):
		var dev: Dictionary = d
		out += Txt.s(dev.get("no", "")) + Txt.s(dev.get("name", "")) + Txt.s(dev.get("category", ""))
		for s in dev.get("spots", []):
			var sp: Dictionary = s
			out += Txt.s(sp.get("label", "")) + Txt.s(sp.get("reading", ""))
	for l in payload.get("levels", []):
		var lv: Dictionary = l
		out += Txt.s(lv.get("note", "")) + Txt.s(lv.get("degraded", ""))
		for f in lv.get("faults", []):
			var fd: Dictionary = f
			out += Txt.s(fd.get("deviceName", ""))
			for st in fd.get("steps", []):
				var sd: Dictionary = st
				out += Txt.s(sd.get("title", "")) + Txt.s(sd.get("prompt", "")) \
					+ Txt.s(sd.get("correct", "")) + Txt.s(sd.get("statement", ""))
				for x in sd.get("options", []):
					out += Txt.s(x)
				for x in sd.get("items", []):
					out += Txt.s(x)
	return out


func _missing_glyphs(f: Font, text: String) -> Array[String]:
	var missing: Array[String] = []
	var seen := {}
	for i in range(text.length()):
		var cp := text.unicode_at(i)
		if seen.has(cp):
			continue
		seen[cp] = true
		if not f.has_char(cp):
			missing.append(String.chr(cp))
	if not missing.is_empty():
		print("    · 缺字形：%s" % "".join(missing))
	return missing


# ============================ 目视产物 ============================

func _write_montage() -> void:
	print("\n[10] 美术蒙太奇 → _preview/maze_art_montage.png")
	var atlas := MazeArt.atlas_image()
	var gap := 6
	var icon_size := 56
	var strip_h := 96
	var w := maxi(atlas.get_width(), 3 * (icon_size + gap) + gap)
	var h := atlas.get_height() + gap + icon_size * 2 + gap + strip_h + gap
	var out := Image.create(w, h, false, Image.Format.FORMAT_RGBA8)
	out.fill(Color("#0b1220"))
	_blit(out, atlas, gap, gap)
	var y := atlas.get_height() + gap * 2
	var kinds := ["pump", "motor", "compressor", "gearbox", "vessel", "machine"]
	for i in range(kinds.size()):
		var ac: Color = MazeArt.C_RED if i % 2 == 0 else MazeArt.C_GREEN
		var icon := MazeArt.icon_texture(kinds[i], ac, icon_size).get_image()
		_blit(out, icon, gap + (i % 3) * (icon_size + gap), y + (i / 3) * (icon_size + gap))
	# 真场景渲染的截图不在这里：headless 下 viewport 是 dummy 驱动，抓出来只会是全黑。
	# 那部分走 scenes/Capture.tscn（窗口模式跑一次，存 _preview/shot_levelN.png）。
	if DirAccess.make_dir_recursive_absolute("res://_preview") == OK:
		out.save_png("res://_preview/maze_art_montage.png")
		print("    maze_art_montage.png 已写出（人肉目视用）")


func _blit(dst: Image, src: Image, ox: int, oy: int) -> void:
	for y in range(src.get_height()):
		for x in range(src.get_width()):
			var c := src.get_pixel(x, y)
			if c.a <= 0.01:
				continue
			if ox + x >= dst.get_width() or oy + y >= dst.get_height():
				continue
			dst.set_pixel(ox + x, oy + y, c)


