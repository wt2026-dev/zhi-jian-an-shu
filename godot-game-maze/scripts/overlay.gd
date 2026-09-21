class_name GameOverlay
extends CanvasLayer
## 全屏遮罩：等待数据 / 关卡简报 / 本关结算 / 失败 / 通关。
##
## "等待数据"这一屏不许跳过：React 没把台账推进来之前，画面只能是这句话，
## 不能自己编一批设备把关跑起来 —— 那是项目里最硬的一条数据红线。

const FONT_PATH := "res://assets/fonts/NotoSansSC.otf"

signal begin_pressed()
signal next_pressed()
signal restart_pressed()

var _font: Font
var _title: Label
var _body: RichTextLabel
var _btn: Button
var _mode := ""


func _ready() -> void:
	layer = 40
	_font = load(FONT_PATH)
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(root)

	var dim := ColorRect.new()
	dim.color = Color(0.02, 0.03, 0.06, 0.78)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(dim)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(center)

	var card := PanelContainer.new()
	card.custom_minimum_size = Vector2(720, 300)
	card.add_theme_stylebox_override("panel", _card_style())
	center.add_child(card)

	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 12)
	card.add_child(col)

	_title = Label.new()
	_title.add_theme_font_override("font", _font)
	_title.add_theme_font_size_override("font_size", 28)
	_title.add_theme_color_override("font_color", MazeArt.C_AMBER)
	col.add_child(_title)

	_body = RichTextLabel.new()
	_body.bbcode_enabled = true
	_body.custom_minimum_size = Vector2(680, 160)
	_body.add_theme_font_override("normal_font", _font)
	_body.add_theme_font_override("bold_font", _font)
	col.add_child(_body)

	_btn = Button.new()
	_btn.add_theme_font_override("font", _font)
	_btn.add_theme_font_size_override("font_size", 19)
	_btn.custom_minimum_size = Vector2(0, 50)
	_btn.add_theme_stylebox_override("normal", _btn_style(Color("#16223a")))
	_btn.add_theme_stylebox_override("hover", _btn_style(Color("#1f3252")))
	_btn.add_theme_stylebox_override("pressed", _btn_style(Color("#0e7490")))
	_btn.pressed.connect(_on_btn)
	col.add_child(_btn)
	_show("wait", "正在接入台账数据", "等待 React 侧下发真实设备与规程……\n没有数据时不会编造任何设备来开场。", "请稍候", "")
	visible = false


func _card_style() -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.055, 0.086, 0.145, 0.98)
	sb.border_color = Color("#243149")
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(10)
	sb.content_margin_left = 26
	sb.content_margin_right = 26
	sb.content_margin_top = 22
	sb.content_margin_bottom = 22
	sb.shadow_color = Color(0, 0, 0, 0.6)
	sb.shadow_size = 24
	return sb


func _btn_style(bg: Color) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.set_corner_radius_all(8)
	sb.content_margin_left = 18
	sb.content_margin_right = 18
	sb.content_margin_top = 10
	sb.content_margin_bottom = 10
	sb.border_color = Color("#2b3a55")
	sb.set_border_width_all(1)
	return sb


func _show(mode: String, title: String, body: String, btn: String, action: String) -> void:
	_mode = action
	_title.text = title
	_body.text = body
	_btn.text = btn
	_btn.disabled = action.is_empty()
	show()


func show_wait() -> void:
	_show("wait", "正在接入台账数据",
		"等待 React 侧下发真实设备与检修规程（消息类型 maze-data）。\n" +
		"没有数据时这里不会编造设备、读数或题目。", "请稍候", "")


## 开场简报：把本关机制说清楚（几台故障、有没有锁房、限不限时），别让评委猜
func show_brief(snapshot: Dictionary) -> void:
	var lines: Array[String] = []
	lines.append("[color=#9fb2c8]%s[/color]" % Txt.s(snapshot.note))
	lines.append("")
	lines.append("[b]玩法[/b]　WASD 平移地图（不是走路）· 滚轮缩放 · Shift 加速平移 · 左键点设备/地面")
	lines.append("[b]目标[/b]　找到红色脉冲的设备 → 点它看读数 → 修复（按规程顺序点操作件）")
	lines.append("[b]代价[/b]　点错零件扣 1 条命；没探开的房间是黑的；上锁的房间要先找门禁卡")
	if float(snapshot.time_left) > 0.0:
		lines.append("")
		lines.append("[color=#f59e0b]本关限时 %d 秒，未修的故障会向相邻房间扩散，每档扣 %d 分[/color]" % [
			int(snapshot.time_left), int(LevelPlan.SPREAD_PENALTY)])
	_show("brief", "第 %d 关 · %s" % [int(snapshot.level_index), Txt.s(snapshot.brief)],
		"\n".join(lines), "开始（空格）", "begin")


func show_settle(s: Dictionary) -> void:
	_show("settle", "第 %d 关完成" % int(s.level_index),
		"积分 %d　｜　本关时间奖励 +%d　｜　误操作 %d 次　｜　剩余生命 %d\n" % [
			int(s.score), int(s.bonus), int(s.mistakes), int(s.lives)] +
		"[color=#7f92ad]下一关地图更大、故障更多，机制逐关叠加。[/color]",
		"下一关（空格）", "next")


func show_win(s: Dictionary) -> void:
	_show("win", "全厂恢复运行 · 通关",
		"总分 %d　｜　剩余生命 %d　｜　误操作 %d 次\n[color=#7f92ad]" % [
			int(s.score), int(s.lives), int(s.mistakes)] +
		"四关全部来自真实台账与真实检修规程，题目不是编的。[/color]",
		"再来一轮（空格）", "restart")


func show_over(s: Dictionary, reason: String) -> void:
	_show("over", "本关失败",
		reason + "\n积分 %d　｜　已修 %d/%d 台" % [
			int(s.score), int(s.total_faults) - int(s.pending), int(s.total_faults)],
		"重新开始（空格）", "restart")


func hide_overlay() -> void:
	visible = false


func mode() -> String:
	return _mode


func _on_btn() -> void:
	match _mode:
		"begin":
			begin_pressed.emit()
		"next":
			next_pressed.emit()
		"restart":
			restart_pressed.emit()
		_:
			pass


func _input(event: InputEvent) -> void:
	if not visible or _mode.is_empty():
		return
	if not (event is InputEventKey):
		return
	var k := event as InputEventKey
	if not k.pressed or k.echo:
		return
	if k.keycode == KEY_SPACE or k.keycode == KEY_ENTER or k.keycode == KEY_KP_ENTER \
			or k.physical_keycode == KEY_SPACE or k.physical_keycode == KEY_ENTER:
		get_viewport().set_input_as_handled()
		_on_btn()
