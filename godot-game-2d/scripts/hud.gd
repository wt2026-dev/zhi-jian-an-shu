class_name GameHUD
extends CanvasLayer
## 游戏 HUD：生命值 / 积分 / 计时器 / 关卡进度 + 开场白与结算浮层。
##
## 图标一律程序化绘制（心形贴图 + 五角星多边形），不用 "❤""★" 字符 ——
## 中文字体不一定收录这些码位，缺字形就是豆腐块。

signal begin_pressed
signal next_level_pressed
signal restart_pressed

const TOP_H := 58.0

var root: Control

var _hearts: HBoxContainer
var _level_label: Label
var _score_label: Label
var _timer_label: Label
var _hint_label: Label
var _hint_box: PanelContainer
var _brief_box: PanelContainer
var _brief_title: Label
var _brief_body: Label
var _brief_btn: Button
var _settle_box: PanelContainer
var _settle_title: Label
var _settle_stars: HBoxContainer
var _settle_body: Label
var _settle_btn: Button
var _settle_btn2: Button


func _ready() -> void:
	layer = 10
	root = Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	_build_top()
	_build_hint()
	_build_brief()
	_build_settle()


func _build_top() -> void:
	var bar := PanelContainer.new()
	bar.set_anchors_preset(Control.PRESET_TOP_WIDE)
	bar.custom_minimum_size = Vector2(0.0, TOP_H)
	bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.031, 0.051, 0.098, 0.88)
	sb.border_width_bottom = 2
	sb.border_color = Color("#1f2b45")
	sb.content_margin_left = 20.0
	sb.content_margin_right = 20.0
	bar.add_theme_stylebox_override("panel", sb)
	root.add_child(bar)

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 18)
	bar.add_child(row)

	_hearts = HBoxContainer.new()
	_hearts.add_theme_constant_override("separation", 4)
	row.add_child(_hearts)

	_level_label = Label.new()
	_level_label.add_theme_font_size_override("font_size", 19)
	_level_label.add_theme_color_override("font_color", Color("#e6eefb"))
	_level_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_level_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(_level_label)

	_score_label = Label.new()
	_score_label.add_theme_font_size_override("font_size", 18)
	_score_label.add_theme_color_override("font_color", ArtFactory.C_AMBER)
	row.add_child(_score_label)

	_timer_label = Label.new()
	_timer_label.add_theme_font_size_override("font_size", 18)
	_timer_label.add_theme_color_override("font_color", ArtFactory.C_CYAN)
	_timer_label.custom_minimum_size = Vector2(96.0, 0.0)
	_timer_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	row.add_child(_timer_label)

	refresh_hearts(3)


func _build_hint() -> void:
	_hint_box = PanelContainer.new()
	_hint_box.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_hint_box.anchor_left = 0.5
	_hint_box.anchor_right = 0.5
	_hint_box.offset_left = -240.0
	_hint_box.offset_right = 240.0
	_hint_box.offset_top = -96.0
	_hint_box.offset_bottom = -46.0
	_hint_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.043, 0.071, 0.125, 0.9)
	sb.set_corner_radius_all(8)
	sb.border_width_left = 3
	sb.border_color = ArtFactory.C_CYAN
	sb.content_margin_left = 14.0
	sb.content_margin_right = 14.0
	_hint_box.add_theme_stylebox_override("panel", sb)
	_hint_label = Label.new()
	_hint_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_hint_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_hint_label.add_theme_font_size_override("font_size", 17)
	_hint_label.add_theme_color_override("font_color", Color("#e6eefb"))
	_hint_box.add_child(_hint_label)
	root.add_child(_hint_box)
	_hint_box.visible = false


func _build_brief() -> void:
	_brief_box = PanelContainer.new()
	_brief_box.set_anchors_preset(Control.PRESET_CENTER)
	_brief_box.anchor_left = 0.5
	_brief_box.anchor_right = 0.5
	_brief_box.anchor_top = 0.5
	_brief_box.anchor_bottom = 0.5
	_brief_box.offset_left = -360.0
	_brief_box.offset_right = 360.0
	_brief_box.offset_top = -160.0
	_brief_box.offset_bottom = 160.0
	_brief_box.add_theme_stylebox_override("panel", _card_style())
	root.add_child(_brief_box)

	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 14)
	_brief_box.add_child(col)
	_brief_title = Label.new()
	_brief_title.add_theme_font_size_override("font_size", 26)
	_brief_title.add_theme_color_override("font_color", ArtFactory.C_AMBER)
	_brief_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(_brief_title)
	_brief_body = Label.new()
	_brief_body.add_theme_font_size_override("font_size", 18)
	_brief_body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_brief_body.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_brief_body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(_brief_body)
	_brief_btn = _primary_button("开始检修")
	_brief_btn.pressed.connect(func() -> void: emit_signal("begin_pressed"))
	col.add_child(_brief_btn)
	_brief_box.visible = false


func _build_settle() -> void:
	_settle_box = PanelContainer.new()
	_settle_box.set_anchors_preset(Control.PRESET_CENTER)
	_settle_box.anchor_left = 0.5
	_settle_box.anchor_right = 0.5
	_settle_box.anchor_top = 0.5
	_settle_box.anchor_bottom = 0.5
	_settle_box.offset_left = -340.0
	_settle_box.offset_right = 340.0
	_settle_box.offset_top = -190.0
	_settle_box.offset_bottom = 190.0
	_settle_box.add_theme_stylebox_override("panel", _card_style())
	root.add_child(_settle_box)

	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 12)
	_settle_box.add_child(col)
	_settle_title = Label.new()
	_settle_title.add_theme_font_size_override("font_size", 26)
	_settle_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(_settle_title)
	_settle_stars = HBoxContainer.new()
	_settle_stars.alignment = BoxContainer.ALIGNMENT_CENTER
	_settle_stars.add_theme_constant_override("separation", 10)
	col.add_child(_settle_stars)
	_settle_body = Label.new()
	_settle_body.add_theme_font_size_override("font_size", 17)
	_settle_body.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_settle_body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_settle_body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(_settle_body)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	_settle_btn = _primary_button("继续")
	_settle_btn.pressed.connect(func() -> void: emit_signal("next_level_pressed"))
	_settle_btn2 = _ghost_button("重玩本关")
	_settle_btn2.pressed.connect(func() -> void: emit_signal("restart_pressed"))
	row.add_child(_settle_btn)
	row.add_child(_settle_btn2)
	col.add_child(row)
	_settle_box.visible = false


func _card_style() -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.055, 0.086, 0.145, 0.97)
	sb.set_corner_radius_all(8)
	sb.set_border_width_all(1)
	sb.border_color = Color("#243149")
	sb.shadow_color = Color(0, 0, 0, 0.5)
	sb.shadow_size = 18
	sb.set_content_margin_all(24.0)
	return sb


func _primary_button(text: String) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(0.0, 48.0)
	b.add_theme_font_size_override("font_size", 18)
	b.add_theme_stylebox_override("normal", _btn(Color("#0e7490")))
	b.add_theme_stylebox_override("hover", _btn(Color("#0891b2")))
	b.add_theme_stylebox_override("pressed", _btn(Color("#155e75")))
	return b


func _ghost_button(text: String) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(0.0, 48.0)
	b.add_theme_font_size_override("font_size", 17)
	b.add_theme_stylebox_override("normal", _btn(Color("#16223a")))
	b.add_theme_stylebox_override("hover", _btn(Color("#1f3252")))
	b.add_theme_stylebox_override("pressed", _btn(Color("#0e7490")))
	return b


func _btn(bg: Color) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.set_corner_radius_all(8)
	sb.set_content_margin_all(10.0)
	sb.set_border_width_all(1)
	sb.border_color = Color("#2b3a55")
	return sb


# ============================ 对外接口 ============================

func refresh_hearts(lives: int, max_lives: int = 3) -> void:
	for c in _hearts.get_children():
		_hearts.remove_child(c)
		c.queue_free()
	for i in range(max_lives):
		var t := TextureRect.new()
		t.texture = ArtFactory.heart_texture(i < lives)
		t.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		t.custom_minimum_size = Vector2(26.0, 24.0)
		_hearts.add_child(t)


func set_level(index: int, total: int, name: String) -> void:
	_level_label.text = "第 %d/%d 关 · %s" % [index, total, name]


func set_score(score: int) -> void:
	_score_label.text = "积分 %d" % score


func set_timer(seconds: float) -> void:
	if seconds < 0.0:
		_timer_label.text = "不限时"
		_timer_label.add_theme_color_override("font_color", Color("#7f92ad"))
		return
	_timer_label.add_theme_color_override(
		"font_color", ArtFactory.C_RED if seconds <= 10.0 else ArtFactory.C_CYAN
	)
	var s := int(ceil(seconds))
	_timer_label.text = "%02d:%02d" % [s / 60, s % 60]


func set_hint(text: String) -> void:
	_hint_label.text = text
	_hint_box.visible = text != ""


func show_brief(title: String, body: String, button: String = "开始检修") -> void:
	_brief_title.text = title
	_brief_body.text = body
	_brief_btn.text = button
	_brief_box.visible = true
	_settle_box.visible = false
	_hint_box.visible = false


func hide_brief() -> void:
	_brief_box.visible = false


func show_settle(title: String, stars: int, body: String, next_text: String, show_next: bool, show_restart: bool) -> void:
	_settle_title.text = title
	_settle_title.add_theme_color_override(
		"font_color", ArtFactory.C_GREEN if stars >= 2 else ArtFactory.C_AMBER
	)
	for c in _settle_stars.get_children():
		_settle_stars.remove_child(c)
		c.queue_free()
	for i in range(3):
		var st := Control.new()
		st.custom_minimum_size = Vector2(46.0, 46.0)
		var pts := ArtFactory.star_points(21.0)
		var filled := i < stars
		st.draw.connect(func() -> void:
			st.draw_colored_polygon(
				pts,
				ArtFactory.C_AMBER if filled else Color("#2b3a55")
			)
		)
		_settle_stars.add_child(st)
	_settle_body.text = body
	_settle_btn.text = next_text
	_settle_btn.visible = show_next
	_settle_btn2.visible = show_restart
	_settle_box.visible = true
	_brief_box.visible = false
	_hint_box.visible = false


func hide_settle() -> void:
	_settle_box.visible = false


func overlay_state() -> String:
	if _brief_box.visible:
		return "brief"
	if _settle_box.visible:
		return "settle"
	return "none"
