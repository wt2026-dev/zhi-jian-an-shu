extends Node2D

## 一层视差背景（immediate mode 绘制）。
##
## main.gd 建三个 Parallax2D，scroll_scale 分别 (0.12,0.08)/(0.38,0.2)/(0.72,0.42)，
## 这里按 layer 号决定画什么：0=远景厂房轮廓+窗光，1=中景钢结构+管线，2=近景桁架+灯具。
## 全部是程序化绘制：没有外部贴图，也就不存在"资源丢失导致白屏"。

const C_WALL := Color("#131c2e")
const C_WALL_HI := Color("#1a2540")
const C_STEEL := Color("#1b2436")
const C_STEEL_HI := Color("#2b3a55")
const C_CYAN := Color("#22d3ee")
const C_CYAN_DIM := Color("#0e7490")
const C_AMBER := Color("#fbbf24")
const C_GLASS := Color("#0f172a")

var _layer := 0
var _width := 1280.0
var _ground_y := 560.0


func setup(layer: int, width: float, ground_y: float) -> void:
	_layer = layer
	_width = width
	_ground_y = ground_y
	queue_redraw()


func _draw() -> void:
	var span := _width
	match _layer:
		0:
			_draw_far(span)
		1:
			_draw_mid(span)
		_:
			_draw_near(span)


# ---------------------------------------------------------------- 远景

func _draw_far(span: float) -> void:
	# 远处厂房的整片墙体
	draw_rect(Rect2(-400.0, -400.0, span + 800.0, _ground_y + 400.0), C_WALL)

	# 竖向壁柱
	var x := -200.0
	while x < span + 400.0:
		draw_rect(Rect2(x, 40.0, 26.0, _ground_y - 40.0), C_WALL_HI)
		x += 190.0

	# 两排厂房窗：上排亮一点（假装是车间照明）
	for band in range(2):
		var y := 150.0 + float(band) * 74.0
		var c := Color("#1d3b52") if band == 0 else Color("#172f42")
		var wx := -160.0
		while wx < span + 400.0:
			draw_rect(Rect2(wx, y, 54.0, 40.0), c)
			draw_rect(Rect2(wx, y, 54.0, 3.0), C_CYAN_DIM)
			wx += 132.0

	# 顶部桁架剪影
	draw_rect(Rect2(-400.0, 96.0, span + 800.0, 10.0), C_STEEL)


# ---------------------------------------------------------------- 中景

func _draw_mid(span: float) -> void:
	# 钢结构立柱 + 斜撑
	var x := -120.0
	while x < span + 300.0:
		draw_rect(Rect2(x, 60.0, 18.0, _ground_y - 60.0), C_STEEL)
		draw_rect(Rect2(x + 18.0, 60.0, 4.0, _ground_y - 60.0), C_STEEL_HI)
		# 斜撑
		draw_line(
			Vector2(x + 18.0, 130.0), Vector2(x + 128.0, 210.0), C_STEEL_HI, 5.0
		)
		draw_line(
			Vector2(x + 18.0, 210.0), Vector2(x + 128.0, 130.0), C_STEEL_HI, 5.0
		)
		x += 300.0

	# 两条贯穿的工艺管线：粗管 + 青色高光 + 法兰
	for row in range(2):
		var y := 250.0 + float(row) * 92.0
		draw_rect(Rect2(-400.0, y, span + 800.0, 22.0), C_STEEL)
		draw_rect(Rect2(-400.0, y + 3.0, span + 800.0, 5.0), C_STEEL_HI)
		draw_rect(Rect2(-400.0, y + 19.0, span + 800.0, 3.0), C_CYAN_DIM)
		var fx := -300.0
		while fx < span + 400.0:
			draw_rect(Rect2(fx, y - 4.0, 12.0, 30.0), C_STEEL_HI)
			fx += 220.0

	# 地面阴影带，让中景和地面衔接
	draw_rect(Rect2(-400.0, _ground_y - 26.0, span + 800.0, 26.0), Color("#101827"))


# ---------------------------------------------------------------- 近景

func _draw_near(span: float) -> void:
	# 顶部桁架（人字梁）
	var x := -80.0
	while x < span + 200.0:
		draw_line(Vector2(x, 60.0), Vector2(x + 130.0, 150.0), C_STEEL, 8.0)
		draw_line(Vector2(x + 130.0, 150.0), Vector2(x + 260.0, 60.0), C_STEEL, 8.0)
		draw_line(Vector2(x, 60.0), Vector2(x + 260.0, 60.0), C_STEEL_HI, 6.0)
		draw_rect(Rect2(x + 128.0, 150.0, 6.0, 26.0), C_STEEL)
		x += 260.0

	# 吊灯：灯罩 + 光锥 + 琥珀灯泡（近景才画，制造纵深）
	var lx := 40.0
	while lx < span + 200.0:
		draw_rect(Rect2(lx - 3.0, 60.0, 6.0, 120.0), C_STEEL_HI)
		draw_colored_polygon(
			PackedVector2Array([
				Vector2(lx - 26.0, 214.0), Vector2(lx + 26.0, 214.0), Vector2(lx + 10.0, 186.0), Vector2(lx - 10.0, 186.0)
			]),
			C_STEEL_HI
		)
		draw_circle(Vector2(lx, 212.0), 7.0, C_AMBER)
		draw_colored_polygon(
			PackedVector2Array([
				Vector2(lx - 24.0, 214.0), Vector2(lx + 24.0, 214.0), Vector2(lx + 92.0, 372.0), Vector2(lx - 92.0, 372.0)
			]),
			Color(0.984, 0.749, 0.141, 0.07)
		)
		lx += 340.0

	# 近景粗管 + 阀门手轮
	var y := 400.0
	draw_rect(Rect2(-400.0, y, span + 800.0, 34.0), C_STEEL)
	draw_rect(Rect2(-400.0, y + 4.0, span + 800.0, 6.0), C_STEEL_HI)
	var vx := 120.0
	while vx < span + 300.0:
		draw_circle(Vector2(vx, y + 17.0), 17.0, C_STEEL_HI)
		draw_circle(Vector2(vx, y + 17.0), 8.0, C_CYAN_DIM)
		vx += 430.0

	# 地面警示条纹（琥珀/深色交替）——近景贴着地面走
	var sx := -400.0
	var i := 0
	while sx < span + 800.0:
		var c := C_AMBER if i % 2 == 0 else Color("#1f2937")
		draw_rect(Rect2(sx, _ground_y - 10.0, 34.0, 10.0), Color(c.r, c.g, c.b, 0.55 if i % 2 == 0 else 0.9))
		sx += 34.0
		i += 1
