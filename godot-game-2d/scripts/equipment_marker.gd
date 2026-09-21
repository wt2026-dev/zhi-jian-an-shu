class_name EquipmentMarker
extends Node2D

## 一台设备的世界内表示：2D 图标 + 悬浮标签（编号 + 名称）+ 状态光圈。
##
## 锚点 = 设备底座（y=0 贴地面）。状态由 main.gd 写 `alarming` / `cleared`，
## 写完必须调 `refresh()`——这里不做任何"自动判定"，避免和真源口径打架。

const ICON_Y := -104.0          # 图标中心相对底座的高度
const PLATE_Y := -172.0         # 悬浮标签中心
const PLATE_W := 168.0
const PLATE_H := 44.0

var device_no := ""
var device_name := ""
var alarming := false
var cleared := false
var show_arrow := false
var icon_kind := "motor"

var _icon: Sprite2D
var _plate: Sprite2D
var _label: Label
var _pulse := 0.0


func _ready() -> void:
	_icon = Sprite2D.new()
	_icon.name = "Icon"
	_icon.position = Vector2(0.0, ICON_Y)
	add_child(_icon)

	_plate = Sprite2D.new()
	_plate.name = "Plate"
	_plate.position = Vector2(0.0, PLATE_Y)
	add_child(_plate)

	_label = Label.new()
	_label.name = "Label"
	_label.position = Vector2(-PLATE_W / 2.0, PLATE_Y - PLATE_H / 2.0)
	_label.size = Vector2(PLATE_W, PLATE_H)
	_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_label.add_theme_font_size_override("font_size", 16)
	add_child(_label)
	# 设备标签是 Node2D 下的裸 Label，既不在 theme 传播链上也不是 CanvasLayer 的子节点，
	# 必须显式挂字体，否则设备名全是 □。
	CJKFont.apply(_label)

	set_process(false)


func setup(no: String, name_: String, kind: String) -> void:
	device_no = no
	device_name = name_
	icon_kind = kind
	refresh()


func refresh() -> void:
	var accent := _accent()
	_icon.texture = ArtFactory.equipment_icon(icon_kind, accent)
	_plate.texture = ArtFactory.label_plate(int(PLATE_W), int(PLATE_H), accent)
	_label.text = "%s　%s" % [device_no, device_name] if device_no != "" else device_name
	_label.add_theme_color_override(
		"font_color", Color("#e6edf7") if not cleared else Color("#a7f3d0")
	)
	set_process(alarming or show_arrow or cleared)
	queue_redraw()


func _accent() -> Color:
	if cleared:
		return ArtFactory.C_GREEN
	if alarming:
		return ArtFactory.C_RED
	return Color("#2f6b52")


func _process(delta: float) -> void:
	_pulse += delta
	if alarming and not cleared:
		queue_redraw()
	elif show_arrow:
		queue_redraw()


func _draw() -> void:
	# 底座：让设备"落在"地面上，而不是浮着
	draw_rect(Rect2(-42.0, -12.0, 84.0, 12.0), Color("#243149"))
	draw_rect(Rect2(-46.0, -4.0, 92.0, 4.0), Color("#161f33"))

	if cleared:
		draw_arc(Vector2(0.0, ICON_Y), 58.0, 0.0, TAU, 44, Color(0.204, 0.827, 0.6, 0.85), 3.0)
		draw_rect(Rect2(-40.0, -14.0, 80.0, 4.0), ArtFactory.C_GREEN)
		# 勾：画出来的，不用字体（缺字形会变豆腐块）
		draw_line(Vector2(-10.0, ICON_Y), Vector2(-3.0, ICON_Y + 8.0), ArtFactory.C_GREEN, 5.0)
		draw_line(Vector2(-3.0, ICON_Y + 8.0), Vector2(12.0, ICON_Y - 10.0), ArtFactory.C_GREEN, 5.0)
		return

	if alarming:
		var t := fmod(_pulse, 1.5) / 1.5
		draw_arc(
			Vector2(0.0, ICON_Y), 52.0 + t * 44.0, 0.0, TAU, 48,
			Color(0.937, 0.267, 0.267, (1.0 - t) * 0.85), 5.0
		)
		draw_arc(Vector2(0.0, ICON_Y), 56.0, 0.0, TAU, 48, Color(0.937, 0.267, 0.267, 0.7), 3.0)
		draw_rect(Rect2(-42.0, -16.0, 84.0, 8.0), Color(0.937, 0.267, 0.267, 0.55))
		# 顶部警示条（三角形 + 竖杠，同样是画出来的）
		var blink := 0.55 + 0.45 * absf(sin(_pulse * 3.0))
		var c := Color(0.937, 0.267, 0.267, blink)
		draw_colored_polygon(
			PackedVector2Array([
				Vector2(0.0, PLATE_Y - 46.0), Vector2(-11.0, PLATE_Y - 26.0), Vector2(11.0, PLATE_Y - 26.0)
			]),
			c
		)
		draw_rect(Rect2(-3.0, PLATE_Y - 42.0, 6.0, 9.0), Color("#0b1220"))
		draw_rect(Rect2(-3.0, PLATE_Y - 30.0, 6.0, 3.0), Color("#0b1220"))
		return

	# 正常设备：暗绿光圈，低调
	draw_arc(Vector2(0.0, ICON_Y), 56.0, 0.0, TAU, 40, Color(0.204, 0.827, 0.6, 0.35), 2.0)
	draw_rect(Rect2(-40.0, -14.0, 80.0, 3.0), Color(0.204, 0.827, 0.6, 0.30))

	if show_arrow:
		var bob := sin(_pulse * 3.4) * 6.0
		var y := PLATE_Y - 78.0 + bob
		draw_colored_polygon(
			PackedVector2Array([
				Vector2(0.0, y + 26.0), Vector2(-16.0, y), Vector2(16.0, y)
			]),
			ArtFactory.C_AMBER
		)
