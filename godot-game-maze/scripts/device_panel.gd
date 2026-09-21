class_name DevicePanel
extends Control
## 点设备后的读数面板 +「修复」小游戏（两种模式共用一张卡片）。
##
## 读数**只念** `maze-data` 里带进来的实测值：异常标红由 React 侧按项目唯一那套阈值
## 判定（`statusMapping.telemetryToStatus`），这里不重新判、也不用 0 顶替缺失读数 ——
## 缺的就是「未接入」。
##
## 小游戏里的操作牌文本同样全部来自真实规程（`MazeGame.repair_spec`），
## 面板只负责摆出来 + 把点击回报给规则内核，判定不在这里。

const FONT_PATH := "res://assets/fonts/NotoSansSC.otf"

signal repair_requested()
signal part_pressed(index: int)
signal close_requested()

var game: MazeGame
var _font: Font
var _card: PanelContainer
var _title: Label
var _sub: Label
var _rows: VBoxContainer
var _prompt: Label
var _parts: GridContainer
var _actions: HBoxContainer
var _repair_btn: Button
var _close_btn: Button
var _foot: Label
var _progress: Label


func _ready() -> void:
	_font = load(FONT_PATH)
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false
	_build()


func _build() -> void:
	var dim := ColorRect.new()
	dim.color = Color(0.02, 0.03, 0.06, 0.55)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(dim)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	# 让开四边固定件：左边小地图、右边线索面板、上下顶栏与提示条。
	# 用 offset 而不是 position —— 锚点是 0/1 全拉伸，写 position 会连锚点一起被改写，
	# 结果卡片跑到屏幕外（截图里验收出来的就是那个）。
	center.offset_left = 286
	center.offset_top = 60
	center.offset_right = -312
	center.offset_bottom = -56
	add_child(center)

	_card = PanelContainer.new()
	_card.custom_minimum_size = Vector2(660, 430)
	_card.add_theme_stylebox_override("panel", _card_style())
	center.add_child(_card)

	var margin := MarginContainer.new()
	for k in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		margin.add_theme_constant_override(k, 22 if k.ends_with("left") or k.ends_with("right") else 18)
	_card.add_child(margin)

	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 10)
	margin.add_child(col)

	_title = _label("", 24, Color("#e6eefb"))
	col.add_child(_title)
	_sub = _label("", 15, Color("#7f92ad"))
	col.add_child(_sub)
	col.add_child(HSeparator.new())

	_prompt = _label("", 17, MazeArt.C_AMBER)
	_prompt.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	col.add_child(_prompt)

	_rows = VBoxContainer.new()
	_rows.add_theme_constant_override("separation", 6)
	_rows.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(_rows)

	_parts = GridContainer.new()
	_parts.add_theme_constant_override("h_separation", 10)
	_parts.add_theme_constant_override("v_separation", 10)
	_parts.columns = 3
	_parts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_parts.visible = false
	col.add_child(_parts)

	_progress = _label("", 15, MazeArt.C_CYAN)
	col.add_child(_progress)

	_foot = _label("", 14, Color("#7f92ad"))
	_foot.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	col.add_child(_foot)

	_actions = HBoxContainer.new()
	_actions.add_theme_constant_override("separation", 12)
	col.add_child(_actions)
	_repair_btn = _button("开始修复（按规程顺序点操作件）")
	_repair_btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_repair_btn.pressed.connect(func() -> void: repair_requested.emit())
	_actions.add_child(_repair_btn)
	_close_btn = _button("返回地图（Esc）")
	_close_btn.pressed.connect(func() -> void: close_requested.emit())
	_actions.add_child(_close_btn)


func _label(text: String, size: int, color: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", _font)
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


func _button(text: String) -> Button:
	var b := Button.new()
	b.text = text
	b.add_theme_font_override("font", _font)
	b.add_theme_font_size_override("font_size", 16)
	b.custom_minimum_size = Vector2(0, 44)
	b.add_theme_stylebox_override("normal", _btn_style(Color("#16223a")))
	b.add_theme_stylebox_override("hover", _btn_style(Color("#1f3252")))
	b.add_theme_stylebox_override("pressed", _btn_style(Color("#0e7490")))
	return b


func _card_style() -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.055, 0.086, 0.145, 0.97)
	sb.border_color = Color("#243149")
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(8)
	sb.shadow_color = Color(0, 0, 0, 0.5)
	sb.shadow_size = 18
	return sb


func _btn_style(bg: Color) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.set_corner_radius_all(8)
	sb.content_margin_left = 14
	sb.content_margin_right = 14
	sb.content_margin_top = 8
	sb.content_margin_bottom = 8
	sb.border_color = Color("#2b3a55")
	sb.set_border_width_all(1)
	return sb


# ============================ 两种模式的刷新 ============================

func open_device() -> void:
	visible = true
	_refresh()


func close() -> void:
	visible = false


func refresh_if_open() -> void:
	if visible:
		_refresh()


func _refresh() -> void:
	if game == null:
		return
	var slot := game.selected
	if slot == null:
		visible = false
		return
	var ro: Dictionary = game.readout_of(slot)
	_title.text = "%s　%s" % [Txt.s(ro.name), _state_tag(ro)]
	_sub.text = "编号 %s　｜　类型 %s　｜　%s" % [Txt.s(ro.no), Txt.s(ro.category), _room_name(slot)]
	_clear(_rows)
	if game.phase == MazeGame.Phase.REPAIR:
		_prompt.text = "按规程顺序点击操作件（点对 3 个即修复完成，点错扣 1 条命）"
		_rows.visible = false
		_parts.visible = true
		_progress.text = "修复进度 %d/%d　来源：%s" % [
			int(game.repair_seq), int(game.repair_targets), game.repair_source]
		_build_parts()
		_repair_btn.visible = false
		_foot.text = game.hint
		return

	_prompt.text = "实测读数（异常项标红；判定沿用平台唯一阈值，缺失一律显示「未接入」）"
	_rows.visible = true
	_parts.visible = false
	_progress.text = ""
	for s in ro.get("spots", []):
		var sd: Dictionary = s
		_rows.add_child(_spot_row(sd))
	_repair_btn.visible = bool(ro.faulty) and not bool(ro.cleared)
	_repair_btn.disabled = not bool(ro.get("has_order", true))
	_foot.text = _footer(ro)


func _room_name(slot: MazeMap.DeviceSlot) -> String:
	var room: MazeMap.Room = game.map.rooms[slot.room_id]
	return "位于 %s" % room.name


func _state_tag(ro: Dictionary) -> String:
	if bool(ro.get("spread", false)):
		return "［故障已扩散］"
	if bool(ro.get("cleared", false)):
		return "［已修复］"
	return "［故障待修］" if bool(ro.get("faulty", false)) else "［运行正常］"


func _footer(ro: Dictionary) -> String:
	if not bool(ro.get("faulty", false)):
		return "提示：这台设备读数正常，没有待办检修工单 —— 它是干扰项，别在它身上耗时间。"
	if bool(ro.get("cleared", false)):
		return "这台已经修好了，去下一台红色脉冲设备。"
	if not bool(ro.get("has_order", true)):
		return "台账里这台设备没挂检修规程：修不了，也不在这里编题目。"
	return "点「开始修复」进入按规程顺序点操作件的检修环节。"


## 一行读数：测点名 + 读数。异常整行红、缺失走「未接入」灰字。
func _spot_row(sd: Dictionary) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	var abnormal := bool(sd.get("abnormal", false))
	var reading := Txt.s(sd.get("reading", ""))
	var missing := reading == "未接入"
	var name_l := _label(Txt.s(sd.get("label", "")), 16, Color("#9fb2c8"))
	name_l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(name_l)
	var value := _label(reading, 18, MazeArt.C_RED if abnormal else (Color("#7f92ad") if missing else Color("#e6eefb")))
	value.custom_minimum_size = Vector2(150, 0)
	row.add_child(value)
	var mark := _label("异常" if abnormal else ("无数据" if missing else "正常"), 14,
		MazeArt.C_RED if abnormal else Color("#7f92ad"))
	mark.custom_minimum_size = Vector2(48, 0)
	row.add_child(mark)
	return row


func _build_parts() -> void:
	_clear(_parts)
	var i := 0
	for p in game.repair_parts:
		var pd: Dictionary = p
		var b := _button(Txt.s(pd.get("label", "")))
		b.custom_minimum_size = Vector2(196, 64)
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		if bool(pd.get("clicked", false)):
			b.add_theme_stylebox_override("normal", _btn_style(Color("#0e7490")))
			b.disabled = true
		var idx := i
		b.pressed.connect(func() -> void: part_pressed.emit(idx))
		_parts.add_child(b)
		i += 1


func _clear(node: Node) -> void:
	# 先 remove_child 再 queue_free：只 queue_free 的话同帧里新旧节点共存，
	# 下一格刷新时会读到上一台设备的读数行
	for c in node.get_children():
		node.remove_child(c)
		c.queue_free()


## 数字键 1~9 点操作件：面板里的是 CanvasItem 按钮，不是 DOM，
## 端到端验收脚本只有靠键盘才能"点到第 3 个零件"。
func _input(event: InputEvent) -> void:
	if not visible or not (event is InputEventKey):
		return
	var k := event as InputEventKey
	if not k.pressed or k.echo:
		return
	if _is_key(k, KEY_ESCAPE):
		get_viewport().set_input_as_handled()
		close_requested.emit()
		return
	if game != null and game.phase == MazeGame.Phase.REPAIR:
		var n := _digit_of(k)
		if n >= 1 and n <= game.repair_parts.size():
			get_viewport().set_input_as_handled()
			part_pressed.emit(n - 1)
		elif _is_key(k, KEY_ENTER) or _is_key(k, KEY_KP_ENTER) or _is_key(k, KEY_SPACE):
			get_viewport().set_input_as_handled()
			repair_requested.emit()


func _digit_of(k: InputEventKey) -> int:
	var c := k.keycode
	if c >= KEY_1 and c <= KEY_9:
		return c - KEY_1 + 1
	if c >= KEY_KP_1 and c <= KEY_KP_9:
		return c - KEY_KP_1 + 1
	return -1


func _is_key(k: InputEventKey, want: int) -> bool:
	return k.keycode == want or k.physical_keycode == want
