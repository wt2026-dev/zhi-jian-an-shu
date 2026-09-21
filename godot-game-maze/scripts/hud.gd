class_name GameHud
extends CanvasLayer
## HUD 四区：顶栏（关卡/生命/积分/时间）、左上小地图、右侧线索面板、底部提示条。
##
## 全部读数都从 `MazeGame.snapshot()` / `readout_of()` 取，这一层不自己算分、
## 不自己判断异常 —— 表现层一旦开始算数，就和规则内核对不上了（横版踩过）。

const FONT_PATH := "res://assets/fonts/NotoSansSC.otf"
const PANEL_BG := Color(0.043, 0.063, 0.10, 0.92)
const PANEL_BORDER := Color("#243149")
const TEXT_MAIN := Color("#e6eefb")
const TEXT_DIM := Color("#7f92ad")

var game: MazeGame
var _font: Font
var _glyph_cache: Dictionary = {}

var _level_label: Label
var _lives_label: Label
var _score_label: Label
var _time_label: Label
var _keys_label: Label
var _minimap: Minimap
var _clue_title: Label
var _clue_body: RichTextLabel
var _hint_label: Label
var _toast: Label
var _toast_left := 0.0


func _ready() -> void:
	layer = 30
	_font = load(FONT_PATH)
	set_process(true)
	_build()


func _build() -> void:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)

	root.add_child(_top_bar())
	root.add_child(_minimap_box())
	root.add_child(_clue_box())
	root.add_child(_hint_bar())

	_toast = Label.new()
	_toast.add_theme_font_override("font", _font)
	_toast.add_theme_font_size_override("font_size", 20)
	_toast.add_theme_color_override("font_color", MazeArt.C_CYAN)
	_toast.set_anchors_preset(Control.PRESET_TOP_WIDE)
	_toast.position = Vector2(0, 96)
	_toast.size = Vector2(1280, 30)
	_toast.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_toast.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_toast.visible = false
	root.add_child(_toast)


func _panel(min_size: Vector2) -> PanelContainer:
	var p := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = PANEL_BG
	sb.border_color = PANEL_BORDER
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(6)
	sb.content_margin_left = 12
	sb.content_margin_right = 12
	sb.content_margin_top = 7
	sb.content_margin_bottom = 7
	p.add_theme_stylebox_override("panel", sb)
	p.custom_minimum_size = min_size
	return p


func _label(text: String, size: int, color: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", _font)
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


# ---------------- 顶栏 ----------------

func _top_bar() -> Control:
	var p := _panel(Vector2(0, 46))
	p.set_anchors_preset(Control.PRESET_TOP_WIDE)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 22)
	p.add_child(row)

	_level_label = _label("第 1/4 关", 19, TEXT_MAIN)
	_lives_label = _label("❤❤❤", 19, MazeArt.C_RED)
	_score_label = _label("积分 0", 19, MazeArt.C_AMBER)
	_time_label = _label("时间 ∞", 19, TEXT_MAIN)
	_keys_label = _label("门禁卡 0", 19, MazeArt.C_CYAN)
	for n in [_level_label, _lives_label, _score_label, _time_label, _keys_label]:
		row.add_child(n)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(spacer)
	row.add_child(_label("庖丁智驭 · 故障侦探（俯视迷宫）", 15, TEXT_DIM))
	return p


# ---------------- 左上小地图 ----------------

func _minimap_box() -> Control:
	var p := _panel(Vector2(0, 0))
	p.set_anchors_preset(Control.PRESET_TOP_LEFT)
	p.position = Vector2(14, 62)
	p.custom_minimum_size = Vector2(252, 208)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 4)
	p.add_child(col)
	col.add_child(_label("厂区小地图", 14, TEXT_DIM))
	_minimap = Minimap.new()
	_minimap.game = game
	_minimap.custom_minimum_size = Vector2(228, 152)
	col.add_child(_minimap)
	return p


# ---------------- 右侧线索面板 ----------------

func _clue_box() -> Control:
	var p := _panel(Vector2(0, 0))
	p.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	p.position = Vector2(-306, 62)
	p.custom_minimum_size = Vector2(292, 380)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 8)
	p.add_child(col)
	_clue_title = _label("线索", 17, MazeArt.C_CYAN)
	col.add_child(_clue_title)
	_clue_body = RichTextLabel.new()
	_clue_body.bbcode_enabled = true
	_clue_body.fit_content = false
	_clue_body.scroll_active = true
	_clue_body.custom_minimum_size = Vector2(266, 320)
	_clue_body.add_theme_font_override("normal_font", _font)
	_clue_body.add_theme_font_override("bold_font", _font)
	col.add_child(_clue_body)
	return p


# ---------------- 底部提示条 ----------------

func _hint_bar() -> Control:
	var p := _panel(Vector2(0, 40))
	p.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	p.offset_top = -46
	p.offset_bottom = -6
	_hint_label = _label("点击红色脉冲设备开始检修", 17, TEXT_MAIN)
	_hint_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	p.add_child(_hint_label)
	return p


# ============================ 刷新 ============================

func bind(g: MazeGame) -> void:
	game = g
	_minimap.game = g


func refresh() -> void:
	if game == null or game.map == null:
		return
	var s: Dictionary = game.snapshot()
	_level_label.text = "第 %d/%d 关 · %s" % [
		int(s.level_index), int(s.level_count), Txt.s(LevelPlan.plan(int(s.level_index) - 1).get("name", ""))
	]
	_lives_label.text = _hearts(int(s.lives))
	_score_label.text = "积分 %d" % int(s.score)
	_time_label.text = _time_text(float(s.time_left))
	_keys_label.text = "门禁卡 %d" % int(s.keys)
	_hint_label.text = Txt.s(s.hint)
	_clue_body.text = _clues(s)
	_minimap.queue_redraw()


## 顶栏那三个爱心是产品口径，但 ❤/♡ 属于符号区，字体子集收不收完全看运气 ——
## 缺字形会画成豆腐块，比少画两颗心难看得多（"中文不乱码"这条就死在这儿）。
## 实测 NotoSansSC 没有 U+2764、却有 U+2661，所以**成对**退级：半套 ●♡ 比两套都丑。
const HEART_PAIRS := [[0x2764, 0x2661], [0x2665, 0x2661], [0x25CF, 0x25CB]]

var _heart_pair: Array = []


## 单独做成静态函数，是为了让自检能脱离场景树问一句"顶栏最后会画哪对符号" ——
## 这条口径没有别的验证途径，而它恰好是演示时最显眼的一行字。
static func pick_heart_pair(f: Font) -> Array:
	var fallback: Array = HEART_PAIRS[HEART_PAIRS.size() - 1]
	if f == null:
		return fallback
	for candidate in HEART_PAIRS:
		if f.has_char(int(candidate[0])) and f.has_char(int(candidate[1])):
			return candidate
	return fallback


func _hearts(n: int) -> String:
	if _heart_pair.is_empty():
		_heart_pair = pick_heart_pair(_font)
	var t := ""
	for i in range(LevelPlan.MAX_LIVES):
		t += String.chr(int(_heart_pair[0])) if i < n else String.chr(int(_heart_pair[1]))
	return t


func _glyph(cp: int) -> bool:
	# Godot 4.7 的 FontFile 只暴露 has_char(码位)；has_glyph 吃的是字形索引、
	# 在这个版本上直接调会抛 "Nonexistent function"，整段 HUD 文案就空了。
	if _font == null:
		return false
	if _glyph_cache.has(cp):
		return bool(_glyph_cache[cp])
	var ok := _font.has_char(cp)
	_glyph_cache[cp] = ok
	return ok


## 取一个符号字形，字体子集里没有就退回 ASCII/常用汉字写法。
func _sym(cp: int, fallback: String) -> String:
	if not _glyph(cp):
		return fallback
	return String.chr(cp)


## 不限时显示 ∞ 而不是 0:00 —— 后者会让人以为"已经超时了"，那是读数说谎。
func _time_text(v: float) -> String:
	if v < 0.0:
		return "时间 %s" % _sym(0x221E, "不限")
	var total := int(ceilf(v))
	return "%d:%02d" % [int(total / 60.0), total % 60]


func _clues(s: Dictionary) -> String:
	var dot := _sym(0x25CF, "-")
	var ring := _sym(0x25CB, "o")
	var tick := _sym(0x2714, "V")
	var warn := _sym(0x26A0, "!")
	var sep := _sym(0xFF5D, " | ")
	var lines: Array[String] = []
	lines.append("[b]%s[/b]" % Txt.s(s.brief))
	if Txt.s(s.note) != "":
		lines.append("[color=#7f92ad]%s[/color]" % Txt.s(s.note))
	if Txt.s(s.degraded) != "":
		lines.append("[color=#f59e0b]%s %s[/color]" % [warn, Txt.s(s.degraded)])
	lines.append("")
	lines.append("[b]待修设备[/b]　已修 %d / %d 台" % [
		int(s.total_faults) - int(s.pending), int(s.total_faults)])
	for d in game.map.devices:
		var slot: MazeMap.DeviceSlot = d
		var room: MazeMap.Room = game.map.rooms[slot.room_id]
		if not room.explored:
			# 没探开的房间连设备名都不报 —— 报了就等于把迷雾剪了个洞
			continue
		var tag := "[color=#7f92ad]%s 正常[/color]" % ring
		if slot.faulty and not slot.cleared:
			tag = "[color=#ef4444]%s 故障[/color]" % dot
			if slot.spread:
				tag = "[color=#ef4444]%s 故障扩散[/color]" % dot
		elif slot.cleared:
			tag = "[color=#10b981]%s 已修[/color]" % tick
		lines.append("· %s　%s" % [slot.name, tag])
		lines.append("  [color=#7f92ad]%s%s%s[/color]" % [slot.no, sep, room.name])
	lines.append("")
	lines.append("探索率 %d%%%s 误操作 %d 次" % [int(float(s.explored) * 100.0), sep, int(s.mistakes)])
	var rep: Dictionary = s.repair
	if int(rep.targets) > 0:
		lines.append("")
		lines.append("[color=#22d3ee]修复进度 %d/%d[/color]" % [int(rep.seq), int(rep.targets)])
		lines.append("[color=#7f92ad]%s[/color]" % Txt.s(rep.source))
	return "\n".join(lines)


func toast(text: String, color: Color = MazeArt.C_CYAN, seconds: float = 1.6) -> void:
	_toast.text = text
	_toast.add_theme_color_override("font_color", color)
	_toast.visible = true
	_toast_left = seconds


func _process(delta: float) -> void:
	if _toast_left <= 0.0:
		return
	_toast_left -= delta
	if _toast_left <= 0.0:
		_toast.visible = false


# ============================ 小地图 ============================

class Minimap:
	extends Control
	## 房间级抽象（不是把整张图缩一遍）：黑=没探开，蓝灰=探开，红点=故障，
	## 绿点=正常设备，橙框=锁着的门。玩家扫一眼就知道下一步该往哪走。

	var game: MazeGame

	func _draw() -> void:
		if game == null or game.map == null:
			return
		var m: MazeMap = game.map
		draw_rect(Rect2(Vector2.ZERO, size), Color(0.02, 0.03, 0.05, 0.95), true)
		var cell_x := size.x / float(m.grid_rooms)
		var cell_y := size.y / float(m.grid_rooms)
		for r in m.rooms:
			var room: MazeMap.Room = r
			var at := Vector2(float(room.gx) * cell_x, float(room.gy) * cell_y)
			var box := Rect2(at + Vector2(2, 2), Vector2(cell_x - 4, cell_y - 4))
			if room.explored:
				var lit := Color("#1b2740")
				if not room.device_ids.is_empty():
					var slot: MazeMap.DeviceSlot = m.devices[room.device_ids[0]]
					if slot.faulty and not slot.cleared:
						lit = Color("#3a1a22")
					elif slot.faulty and slot.cleared:
						lit = Color("#123328")
				draw_rect(box, lit, true)
			else:
				draw_rect(box, Color(0, 0, 0, 0.88), true)
			draw_rect(box, Color("#2b3a55"), false, 1.0)
			if not room.explored:
				continue
			for did in room.device_ids:
				var ds: MazeMap.DeviceSlot = m.devices[did]
				var c := MazeArt.C_RED if ds.faulty and not ds.cleared else MazeArt.C_GREEN
				if ds.cleared:
					c = Color("#0f766e")
				draw_circle(box.get_center() + Vector2(float(ds.id % 3) - 1.0, 0) * 5.0, 2.6, c)
		for d in m.doors:
			var door: MazeMap.Door = d
			if not door.locked or door.open:
				continue
			var side_a: MazeMap.Room = m.rooms[door.a]
			var side_b: MazeMap.Room = m.rooms[door.b]
			if not side_a.explored and not side_b.explored:
				continue
			var mid := (Vector2(side_a.gx, side_a.gy) + Vector2(side_b.gx, side_b.gy)) * 0.5
			draw_rect(Rect2(mid * Vector2(cell_x, cell_y) + Vector2(cell_x, cell_y) * 0.5 - Vector2(3.5, 3.5),
				Vector2(7, 7)), MazeArt.C_LOCK, true)
		var e := m.room_of_tile(game.engineer_tile)
		if e != null:
			var ep := Vector2(float(e.gx) * cell_x, float(e.gy) * cell_y) + Vector2(cell_x, cell_y) * 0.5
			draw_circle(ep, 3.4, MazeArt.C_CYAN)
