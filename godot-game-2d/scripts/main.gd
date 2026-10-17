extends Node2D
## 检修闯关主流程。
##
## 职责：接 React 传来的真实规程数据 → 建关 → 跑状态机 → 计分 → 回传 React。
## 游戏侧**不生成任何题目**：题目文本、正确项、设备名全部来自 payload；
## 没有规程的设备不允许开始检修（不造假兜底）。
##
## 状态机：
##   WAIT(等数据) → BRIEF(关卡开场白) → RUN(跑动) ⇄ PANEL(检修面板) → SETTLE(结算) → 下一关/通关

# ---------- 世界布局 ----------
const GROUND_Y := 560.0
const SPACING := 260.0
const FIRST_X := 300.0
const INTERACT_RANGE := 96.0

# ---------- 与 React 侧 levelPlay.ts 对齐的计分口径 ----------
const MAX_LIVES := 3
const STEP_SECONDS := {"tool": 22.0, "safety": 25.0, "order": 40.0}
const BASE_SCORE := 100
const SPEED_BONUS := 50

# ---------- 阶段 ----------
enum Phase { WAIT, BRIEF, RUN, PANEL, SETTLE }

var phase: int = Phase.WAIT

# ---------- 节点 ----------
var world: Node2D
var bg_root: Node2D
var markers: Node2D
var ground_sprite: Sprite2D
var ground_body: StaticBody2D
var player: Engineer
var camera: Camera2D
var hud: GameHUD
var panel: RepairPanel

# ---------- 数据 ----------
var devices: Array = []
var levels: Array = []
var device_slot: Dictionary = {}       # deviceId -> slot index
var device_markers: Array = []          # slot index -> EquipmentMarker
var world_width := 1280.0

# ---------- 关卡运行态 ----------
var level_index := 0
var targets: Dictionary = {}            # deviceId -> target dict
var target_ids: Array = []
var cleared: Array = []
var lives := MAX_LIVES
var score := 0
var level_score := 0
var elapsed := 0.0
var time_left := -1.0
var step_elapsed := 0.0
var first_try := 0
var step_total := 0
var mistakes := 0
var active_device := ""
var best_total := 0
var has_s := false
var cleared_levels := 0

# ---------- 桥 ----------
var _poll_accum := 0.0
var _beat_accum := 0.0
var _settle_at := 0


func _ready() -> void:
	RenderingServer.set_default_clear_color(Color("#0b1220"))

	# 把 Noto Sans SC 显式塞到 viewport 的 theme 上。
	# 踩过的坑：只设 project.godot 的 `gui/theme/default_font` 时，挂到 CanvasLayer 下的
	# Control（HUD / 检修面板 / 设备标签）拿不到这个主题，Chinese 全部渲染成豆腐块。
	# 在 viewport 上 set_theme 是唯一稳定能覆盖全 UI 的入口。
	var f: FontFile = load("res://assets/fonts/NotoSansSC.otf")
	if f != null:
		var t := Theme.new()
		t.default_font = f
		t.default_font_size = 16
		get_viewport().theme = t

	world = Node2D.new()
	world.name = "World"
	add_child(world)

	bg_root = Node2D.new()
	bg_root.name = "Background"
	world.add_child(bg_root)

	markers = Node2D.new()
	markers.name = "Markers"
	world.add_child(markers)

	player = Engineer.new()
	player.name = "Player"
	player.visible = false
	world.add_child(player)

	camera = Camera2D.new()
	camera.name = "Camera2D"
	camera.position_smoothing_enabled = true
	camera.position_smoothing_speed = 8.0
	player.add_child(camera)

	hud = GameHUD.new()
	hud.name = "GameUI"
	add_child(hud)
	hud.begin_pressed.connect(_on_begin)
	hud.next_level_pressed.connect(_on_next_level)
	hud.restart_pressed.connect(_on_restart)

	panel = RepairPanel.new()
	panel.name = "RepairPanel"
	hud.add_child(panel)          # 同一个 CanvasLayer 且排在 HUD 之后 → 盖在 HUD 之上
	panel.answered.connect(_on_answered)
	panel.closed.connect(_on_panel_closed)

	_post({"type": "repair-game", "event": "ready", "version": 1})
	print("[main] ready, 等待规程数据")

	# 桌面调试：Web 版数据由 React iframe 注入，编辑器里 F5 直接跑时收不到，
	# 会永远停在 WAIT 黑屏。仅桌面加载本地调试 payload，Web 行为完全不变。
	if not OS.has_feature("web"):
		_load_debug_payload()


func _load_debug_payload() -> void:
	if not FileAccess.file_exists("res://debug_payload.json"):
		return
	var f := FileAccess.open("res://debug_payload.json", FileAccess.READ)
	if f == null:
		return
	var parsed = JSON.parse_string(f.get_as_text())
	if parsed is Dictionary and (parsed as Dictionary).has("devices"):
		print("[main] 桌面调试：加载 res://debug_payload.json")
		apply_payload(parsed)


func _process(delta: float) -> void:
	_poll_accum += delta
	if _poll_accum >= 0.15:
		_poll_accum = 0.0
		_poll_inbox()

	if phase == Phase.RUN:
		_tick_timer(delta)
		_tick_interact()
		_update_hud()
	elif phase == Phase.BRIEF:
		# 空格/回车也能开始：验收脚本用真实按键比"猜按钮像素坐标"可靠得多
		if Input.is_action_just_pressed("jump") or Input.is_action_just_pressed("interact"):
			_on_begin()
	elif phase == Phase.SETTLE:
		# 结算刚弹出时先吞掉输入：答完最后一道题那次空格会一路传到这儿，
		# 玩家还没看清星级就被推进下一关了。
		if Input.is_action_just_pressed("jump") and Time.get_ticks_msec() - _settle_at > 600:
			_on_next_level()

	_beat_accum += delta
	if _beat_accum >= 0.4:
		_beat_accum = 0.0
		_post_state()


# ============================ 数据桥 ============================

func _poll_inbox() -> void:
	if not OS.has_feature("web"):
		return
	# 用"JS 侧数组 + Godot 轮询"而不是给 window 挂回调：
	# MessageEvent 是原生 JS 对象，跨边界取 .data 容易踩到包装差异；
	# 让 JS 把 payload 压进数组、Godot 每次 shift 一个字符串，零编解码风险。
	var raw = JavaScriptBridge.eval(
		"(window.__godotInbox && window.__godotInbox.length) ? window.__godotInbox.shift() : ''"
	)
	if typeof(raw) != TYPE_STRING or String(raw).is_empty():
		return
	var parsed = JSON.parse_string(String(raw))
	if parsed is Dictionary:
		_handle_message(parsed)


func _handle_message(msg: Dictionary) -> void:
	var t := String(msg.get("type", ""))
	if t == "repair-data":
		apply_payload(msg)


func _post(payload: Dictionary) -> void:
	if not OS.has_feature("web"):
		return
	# JSON.stringify 的产物本身就是合法 JS 字面量，可直接塞进 eval
	JavaScriptBridge.eval("window.__godotPost(%s)" % JSON.stringify(payload))


func apply_payload(msg: Dictionary) -> void:
	devices = msg.get("devices", [])
	levels = msg.get("levels", [])
	if not (devices is Array) or not (levels is Array) or devices.is_empty() or levels.is_empty():
		print("[main] payload 不完整，保持等待：devices=%d levels=%d" % [devices.size(), levels.size()])
		return
	_build_world()
	level_index = 0
	cleared_levels = 0
	best_total = 0
	has_s = false
	score = 0
	start_level(0)


func _build_world() -> void:
	for c in bg_root.get_children():
		bg_root.remove_child(c)
		c.queue_free()
	for c in markers.get_children():
		markers.remove_child(c)
		c.queue_free()
	device_markers.clear()
	device_slot.clear()

	var n := devices.size()
	world_width = FIRST_X * 2.0 + SPACING * float(n - 1)

	# ---- 三层视差
	var scales := [Vector2(0.12, 0.08), Vector2(0.38, 0.2), Vector2(0.72, 0.42)]
	for i in range(3):
		var px := Parallax2D.new()
		px.name = "Parallax%d" % i
		px.scroll_scale = scales[i]
		var layer := Node2D.new()
		layer.set_script(load("res://scripts/parallax_layer.gd"))
		layer.call("setup", i, world_width, GROUND_Y)
		px.add_child(layer)
		bg_root.add_child(px)

	# ---- 地面
	ground_sprite = Sprite2D.new()
	ground_sprite.name = "Ground"
	ground_sprite.texture = ArtFactory.ground_texture(int(world_width), int(GROUND_Y))
	ground_sprite.centered = false
	ground_sprite.position = Vector2(0.0, GROUND_Y)
	world.add_child(ground_sprite)

	ground_body = StaticBody2D.new()
	ground_body.name = "GroundBody"
	world.add_child(ground_body)
	_add_static_rect(ground_body, Vector2(world_width / 2.0, GROUND_Y + 100.0), Vector2(world_width + 400.0, 200.0))
	# 两端封墙：不封的话角色会跑出关卡边界，镜头跟着出画面
	_add_static_rect(ground_body, Vector2(-30.0, GROUND_Y - 200.0), Vector2(60.0, 800.0))
	_add_static_rect(ground_body, Vector2(world_width + 30.0, GROUND_Y - 200.0), Vector2(60.0, 800.0))

	# ---- 设备沿地面等距排列
	for i in range(n):
		var d: Dictionary = devices[i]
		var m := EquipmentMarker.new()
		m.name = "Dev%d" % i
		m.position = Vector2(_slot_x(i), GROUND_Y)
		markers.add_child(m)
		m.setup(
			String(d.get("no", "")),
			String(d.get("name", "")),
			String(d.get("icon", "motor"))
		)
		device_markers.append(m)
		device_slot[String(d.get("id", ""))] = i

	player.visible = true
	player.place_at(FIRST_X - 150.0, GROUND_Y)
	camera.limit_left = 0
	camera.limit_right = int(world_width)
	camera.limit_top = -200
	camera.limit_bottom = int(GROUND_Y + 120.0)


func _add_static_rect(body: StaticBody2D, center: Vector2, size: Vector2) -> void:
	var cs := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = size
	cs.shape = rect
	cs.position = center
	body.add_child(cs)


func _slot_x(slot: int) -> float:
	return FIRST_X + SPACING * float(slot)


## React 侧约定：`timeLimit = 0` 表示**不限时**（见 `masterLevels.ts`）。
## 踩过的坑：直接把 0 塞进 time_left，倒计时第一轮就判定"烧完了"，
## 第 1 关开局 0.25s 直接结算、角色被冻住，看起来像"按键没反应"。
## 这里把"不限时"统一成 -1，_tick_timer 见到负数直接跳过。
static func time_limit_of(lv: Dictionary) -> float:
	var raw := float(lv.get("timeLimit", 0))
	if raw > 0.0:
		return raw
	var phases: Array = lv.get("phaseSeconds", [])
	if not phases.is_empty():
		return float(phases[0])
	return -1.0


# ============================ 关卡流程 ============================

func start_level(idx: int) -> void:
	level_index = idx
	var lv: Dictionary = levels[idx]
	targets.clear()
	target_ids.clear()
	cleared.clear()
	active_device = ""
	lives = MAX_LIVES
	level_score = 0
	elapsed = 0.0
	mistakes = 0
	first_try = 0
	step_total = 0
	step_elapsed = 0.0
	time_left = time_limit_of(lv)
	var tlist: Array = lv.get("targets", [])
	for t in tlist:
		var d: Dictionary = t
		var id := String(d.get("deviceId", ""))
		targets[id] = d
		target_ids.append(id)

	# 设备状态：本关目标闪红、其他暗绿
	for i in range(device_markers.size()):
		var m: EquipmentMarker = device_markers[i]
		m.alarming = false
		m.cleared = false
		m.show_arrow = false
	for id in target_ids:
		var slot := int(device_slot.get(id, -1))
		if slot >= 0:
			device_markers[slot].alarming = true
			device_markers[slot].refresh()

	player.set_frozen(true)
	player.place_at(FIRST_X - 150.0, GROUND_Y)
	_refresh_arrow()

	hud.set_level(idx + 1, levels.size(), String(lv.get("name", "")))
	hud.set_score(score)
	hud.refresh_hearts(lives)
	_refresh_timer_from_phase()
	_update_hud()
	hud.show_brief(
		"第 %d/%d 关 · %s" % [idx + 1, levels.size(), String(lv.get("name", ""))],
		String(lv.get("brief", "")),
		"开始检修"
	)
	phase = Phase.BRIEF
	_post_state()


func _refresh_timer_from_phase() -> void:
	var lv: Dictionary = levels[level_index]
	var phase_seconds: Array = lv.get("phaseSeconds", [])
	if phase_seconds.is_empty():
		return
	time_left = float(phase_seconds[0])


func _on_begin() -> void:
	hud.hide_brief()
	player.set_frozen(false)
	phase = Phase.RUN
	_post_state()


func _on_restart() -> void:
	hud.hide_settle()
	start_level(level_index)


func _on_next_level() -> void:
	hud.hide_settle()
	if level_index + 1 >= levels.size():
		_post({"type": "repair-game", "event": "all-clear", "totalScore": score, "hasS": has_s})
		score = 0
		cleared_levels = 0
		has_s = false
		start_level(0)
		return
	start_level(level_index + 1)


func _tick_timer(delta: float) -> void:
	elapsed += delta
	step_elapsed += delta
	if time_left < 0.0:
		return
	time_left = maxf(0.0, time_left - delta)
	if time_left > 0.0:
		return
	# 分阶段限时（BOSS 关）：本阶段烧完不判负，扣命并把本阶段重新起表
	var lv: Dictionary = levels[level_index]
	var phase_seconds: Array = lv.get("phaseSeconds", [])
	if not phase_seconds.is_empty():
		lives = maxi(0, lives - 1)
		mistakes += 1
		var step := _current_step_index()
		time_left = float(phase_seconds[mini(step, phase_seconds.size() - 1)])
		hud.refresh_hearts(lives)
		if lives <= 0:
			_finish_level(false, "阶段超时，生命耗尽")
		return
	_finish_level(false, "限时内没处理完全部设备")


func _tick_interact() -> void:
	var near := _nearest_target()
	if near == "":
		hud.set_hint("跑到闪红灯的故障设备旁边，按 E 检修")
	else:
		var m: EquipmentMarker = device_markers[int(device_slot[near])]
		hud.set_hint("按 E 检修　%s" % m.device_name)
	if Input.is_action_just_pressed("interact") and near != "":
		_open_panel(near)


func _nearest_target() -> String:
	var best := ""
	var best_d := INTERACT_RANGE
	for id in target_ids:
		if id in cleared:
			continue
		var slot := int(device_slot.get(id, -1))
		if slot < 0:
			continue
		var d := absf(player.global_position.x - _slot_x(slot))
		if d < best_d:
			best_d = d
			best = id
	return best


func _open_panel(id: String) -> void:
	var t: Dictionary = targets[id]
	var steps: Array = t.get("steps", [])
	if steps.is_empty():
		# 红线：没有真实规程就不许开始，也不编题
		hud.set_hint("本设备暂无标准化规程，无法开始检修")
		return
	active_device = id
	step_total = steps.size()
	step_elapsed = 0.0
	player.set_frozen(true)
	hud.set_hint("")
	panel.open(String(t.get("deviceName", "")), steps, _timer_hint())
	phase = Phase.PANEL
	_post_state()


func _timer_hint() -> String:
	var lv: Dictionary = levels[level_index]
	if not (lv.get("phaseSeconds", []) as Array).is_empty():
		return "本阶段限时"
	if time_left >= 0.0:
		return "剩余 %ds" % int(ceil(time_left))
	return ""


func _on_answered(correct: bool) -> void:
	if correct:
		first_try += 1
		var kind := panel.current_kind()
		var budget: float = float(STEP_SECONDS.get(kind, 30.0))
		var ratio := clampf(1.0 - step_elapsed / budget, 0.0, 1.0)
		var gained := BASE_SCORE + int(round(ratio * float(SPEED_BONUS)))
		level_score += gained
		score += gained
	else:
		mistakes += 1
		lives = maxi(0, lives - 1)
		hud.refresh_hearts(lives)
	step_elapsed = 0.0
	hud.set_score(score)
	if lives <= 0:
		panel.close()
		_finish_level(false, "生命耗尽，检修中止")


func _on_panel_closed() -> void:
	if phase == Phase.PANEL:
		phase = Phase.RUN
		player.set_frozen(false)
	if active_device != "" and not (active_device in cleared):
		cleared.append(active_device)
		var slot := int(device_slot.get(active_device, -1))
		if slot >= 0:
			device_markers[slot].cleared = true
			device_markers[slot].alarming = false
			device_markers[slot].refresh()
	active_device = ""
	_refresh_arrow()
	# 进入下一阶段（BOSS 战）时把本阶段计时重置
	var lv: Dictionary = levels[level_index]
	var phase_seconds: Array = lv.get("phaseSeconds", [])
	if not phase_seconds.is_empty():
		var step := _current_step_index()
		time_left = float(phase_seconds[mini(step, phase_seconds.size() - 1)])
	if cleared.size() >= target_ids.size():
		_finish_level(true, "")
	_post_state()


func _current_step_index() -> int:
	return maxi(0, cleared.size())


func _refresh_arrow() -> void:
	for i in range(device_markers.size()):
		device_markers[i].show_arrow = false
	# 教学关（sequential）只给"当前该去的那台"画箭头
	for id in target_ids:
		if id in cleared:
			continue
		var t: Dictionary = targets[id]
		if bool(t.get("sequential", false)):
			var slot := int(device_slot.get(id, -1))
			if slot >= 0:
				device_markers[slot].show_arrow = true
		break


func _finish_level(win: bool, reason: String) -> void:
	phase = Phase.SETTLE
	_settle_at = Time.get_ticks_msec()
	player.set_frozen(true)
	hud.set_hint("")
	var rate := 1.0 if step_total == 0 else float(first_try) / float(step_total)
	var grade := _grade_for(mistakes, rate)
	var stars := _stars_for(grade)
	if win:
		cleared_levels = maxi(cleared_levels, level_index + 1)
		best_total = maxi(best_total, score)
		if grade == "S":
			has_s = true
	var body := "用时 %.1fs ｜ 正确率 %d%% ｜ 失误 %d ｜ 本关积分 %d" % [
		elapsed, int(round(rate * 100.0)), mistakes, level_score
	]
	if not win:
		body = "%s\n%s" % [reason, body]
	var is_last := level_index + 1 >= levels.size()
	if is_last:
		body += "\n总积分 %d ｜ 当前职称 %s" % [score, _rank_name()]
	hud.show_settle(
		"第 %d 关 · %s" % [level_index + 1, "通过" if win else "需返工"],
		stars,
		body,
		"再来一轮" if is_last else "进入下一关",
		win,
		true
	)
	_post({
		"type": "repair-game",
		"event": "level-clear" if win else "level-fail",
		"level": level_index + 1,
		"levelName": String((levels[level_index] as Dictionary).get("name", "")),
		"score": level_score,
		"totalScore": score,
		"stars": stars,
		"grade": grade,
		"seconds": snappedf(elapsed, 0.1),
		"accuracy": rate,
		"mistakes": mistakes,
		"reason": reason,
	})
	_post_state()


## 与 `levelPlay.gradeFor` 同口径：先看失误数，再看一次通过率
func _grade_for(m: int, rate: float) -> String:
	if m == 0 and rate >= 1.0:
		return "S"
	if m <= 1 and rate >= 0.66:
		return "A"
	if m <= 3:
		return "B"
	return "C"


func _stars_for(grade: String) -> int:
	if grade == "S":
		return 3
	if grade == "A":
		return 2
	if grade == "B":
		return 1
	return 0


## 与 `masterLevels.rankFor` 同口径
func _rank_name() -> String:
	if cleared_levels >= 4 and has_s:
		return "总工"
	if cleared_levels >= 3 or (cleared_levels >= 2 and best_total >= 900):
		return "高级技师"
	if cleared_levels >= 1:
		return "技师"
	return "学徒"


func _update_hud() -> void:
	hud.set_score(score)
	hud.set_timer(time_left if time_left >= 0.0 else -1.0)
	hud.refresh_hearts(lives)


# ============================ 验收探针 ============================

## 每 0.4s 回传一次完整快照。验收脚本靠它读状态，不靠像素猜。
func _post_state() -> void:
	var step_info := {}
	if phase == Phase.PANEL:
		step_info = panel.snapshot()
	var lv: Dictionary = {} if levels.is_empty() else levels[level_index]
	_post({
		"type": "repair-game",
		"event": "state",
		"phase": _phase_name(),
		"level": level_index + 1,
		"levelCount": levels.size(),
		"levelKind": String(lv.get("kind", "")),
		"levelName": String(lv.get("name", "")),
		"targetCount": target_ids.size(),
		"clearedCount": cleared.size(),
		"cleared": cleared.duplicate(),
		"targets": target_ids.duplicate(),
		"lives": lives,
		"score": score,
		"levelScore": level_score,
		"elapsed": snappedf(elapsed, 0.1),
		"timeLeft": snappedf(time_left, 0.1),
		"mistakes": mistakes,
		"firstTry": first_try,
		"stepTotal": step_total,
		"activeDevice": active_device,
		"panel": step_info,
		"playerX": snappedf(player.global_position.x, 0.1),
		"playerY": snappedf(player.global_position.y, 0.1),
		"playerVX": snappedf(player.velocity.x, 0.1),
		"onFloor": player.is_on_floor() if player != null else false,
		"deviceCount": device_markers.size(),
		"deviceXs": _device_xs(),
		"overlay": hud.overlay_state(),
		# 字体自检：Web 导出的中文是不是豆腐块，看这三个值就能定位
		# （没加载？= fontLoaded=false / TextServer 不对？= 类名含 Fallback 或 Dummy /
		#   字形没进栅格化器？= sampleWidth 远小于 64）
		"font": CJKFont.diag,
		"rank": _rank_name(),
		"grade": "" if phase != Phase.SETTLE else _grade_for(mistakes, float(first_try) / maxf(1.0, float(step_total))),
	})


func _phase_name() -> String:
	match phase:
		Phase.WAIT:
			return "wait"
		Phase.BRIEF:
			return "brief"
		Phase.RUN:
			return "run"
		Phase.PANEL:
			return "panel"
		_:
			return "settle"


func _device_xs() -> Array:
	var out: Array = []
	for i in range(device_markers.size()):
		out.append(_slot_x(i))
	return out
