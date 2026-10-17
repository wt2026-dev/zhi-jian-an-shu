extends Node2D

## 一层视差背景（使用外部贴图）。
##
## main.gd 建三个 Parallax2D，scroll_scale 分别 (0.12,0.08)/(0.38,0.2)/(0.72,0.42)，
## 这里按 layer 号决定用哪张贴图：0=远景厂房，1=中景车间通道，2=近景故障工位。
## 贴图放在 res://assets/backgrounds/ 目录下。

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
var _texture: Texture2D = null


func setup(layer: int, width: float, ground_y: float) -> void:
	_layer = layer
	_width = width
	_ground_y = ground_y

	# 加载对应层的贴图
	var texture_path := ""
	match layer:
		0:
			texture_path = "res://assets/backgrounds/factory_far.png"
		1:
			texture_path = "res://assets/backgrounds/workshop_mid.png"
		2:
			texture_path = "res://assets/backgrounds/repair_near.png"

	if ResourceLoader.exists(texture_path):
		_texture = load(texture_path)
	else:
		# 找不到贴图时回退到程序化绘制
		print("[parallax] 找不到贴图: ", texture_path, "，使用程序化绘制")

	queue_redraw()


func _draw() -> void:
	if _texture != null:
		# 绘制贴图，平铺
		var tex_w := _texture.get_width()
		var tex_h := _texture.get_height()
		var scale := (_ground_y + 200.0) / float(tex_h)
		var draw_w := tex_w * scale
		var x := -400.0
		while x < _width + 400.0:
			draw_texture_rect(_texture, Rect2(x, -200.0, draw_w, tex_h * scale), false)
			x += draw_w
	else:
		# 回退：程序化绘制
		var span := _width
		match _layer:
			0:
				_draw_far(span)
			1:
				_draw_mid(span)
			_:
				_draw_near(span)


# ---------------------------------------------------------------- 程序化绘制（回退）

func _draw_far(span: float) -> void:
	draw_rect(Rect2(-400.0, -400.0, span + 800.0, _ground_y + 400.0), C_WALL)
	var x := -200.0
	while x < span + 400.0:
		draw_rect(Rect2(x, 40.0, 26.0, _ground_y - 40.0), C_WALL_HI)
		x += 190.0
	for band in range(2):
		var y := 150.0 + float(band) * 74.0
		var c := Color("#1d3b52") if band == 0 else Color("#172f42")
		var wx := -160.0
		while wx < span + 400.0:
			draw_rect(Rect2(wx, y, 54.0, 40.0), c)
			draw_rect(Rect2(wx, y, 54.0, 3.0), C_CYAN_DIM)
			wx += 132.0
	draw_rect(Rect2(-400.0, 96.0, span + 800.0, 10.0), C_STEEL)


func _draw_mid(span: float) -> void:
	var x := -120.0
	while x < span + 300.0:
		draw_rect(Rect2(x, 60.0, 18.0, _ground_y - 60.0), C_STEEL)
		draw_rect(Rect2(x + 18.0, 60.0, 4.0, _ground_y - 60.0), C_STEEL_HI)
		draw_line(Vector2(x + 18.0, 130.0), Vector2(x + 128.0, 210.0), C_STEEL_HI, 5.0)
		draw_line(Vector2(x + 18.0, 210.0), Vector2(x + 128.0, 130.0), C_STEEL_HI, 5.0)
		x += 300.0
	for row in range(2):
		var y := 250.0 + float(row) * 92.0
		draw_rect(Rect2(-400.0, y, span + 800.0, 22.0), C_STEEL)
		draw_rect(Rect2(-400.0, y + 3.0, span + 800.0, 5.0), C_STEEL_HI)
		draw_rect(Rect2(-400.0, y + 19.0, span + 800.0, 3.0), C_CYAN_DIM)
		var fx := -300.0
		while fx < span + 400.0:
			draw_rect(Rect2(fx, y - 4.0, 12.0, 30.0), C_STEEL_HI)
			fx += 220.0
	draw_rect(Rect2(-400.0, _ground_y - 26.0, span + 800.0, 26.0), Color("#101827"))


func _draw_near(span: float) -> void:
	var x := -80.0
	while x < span + 200.0:
		draw_line(Vector2(x, 60.0), Vector2(x + 130.0, 150.0), C_STEEL, 8.0)
		draw_line(Vector2(x + 130.0, 150.0), Vector2(x + 260.0, 60.0), C_STEEL, 8.0)
		draw_line(Vector2(x, 60.0), Vector2(x + 260.0, 60.0), C_STEEL_HI, 6.0)
		draw_rect(Rect2(x + 128.0, 150.0, 6.0, 26.0), C_STEEL)
		x += 260.0
	var lx := 40.0
	while lx < span + 200.0:
		draw_rect(Rect2(lx - 3.0, 60.0, 6.0, 120.0), C_STEEL_HI)
		draw_circle(Vector2(lx, 212.0), 7.0, C_AMBER)
		lx += 340.0
	var y := 400.0
	draw_rect(Rect2(-400.0, y, span + 800.0, 34.0), C_STEEL)
	draw_rect(Rect2(-400.0, y + 4.0, span + 800.0, 6.0), C_STEEL_HI)
	var vx := 120.0
	while vx < span + 300.0:
		draw_circle(Vector2(vx, y + 17.0), 17.0, C_STEEL_HI)
		draw_circle(Vector2(vx, y + 17.0), 8.0, C_CYAN_DIM)
		vx += 430.0
	var sx := -400.0
	var i := 0
	while sx < span + 800.0:
		var c := C_AMBER if i % 2 == 0 else Color("#1f2937")
		draw_rect(Rect2(sx, _ground_y - 10.0, 34.0, 10.0), Color(c.r, c.g, c.b, 0.55 if i % 2 == 0 else 0.9))
		sx += 34.0
		i += 1
