class_name MazeArt
extends RefCounted
## 俯视工业风的全部程序化美术：地砖图集、设备 2.5D 立牌、脉冲光圈、工程师角色。
##
## 一律用 `Image` 逐像素画，不走 `Node2D._draw()`：
## 好处是**颜色与尺寸能在 headless 里直接断言**（比如"墙必须是浅灰蓝"
## "黄标线必须在第 2 行"），浏览器面板看不见的时候照样能验收；
## 需要矢量感的（光圈、设备体积、阴影）才在节点的 `_draw()` 里画。
##
## 斜俯视口径：整张地图在 Y 方向压到 `SQUASH`，设备/角色再按自身高度往上抬，
## 于是地面是"俯视"、物体是"立着"—— 就是 SimCity 那种斜上方 45° 的味道。

const TILE := 44
const SQUASH := 0.62

# 图集里的 tile 序号（`map_view.gd` 与自检共用，别再抄一遍字面量）
const T_FLOOR := 0
const T_FLOOR_LINE_H := 1
const T_FLOOR_LINE_V := 2
const T_FLOOR_GRATE := 3
const T_FLOOR_WARM := 4
const T_WALL := 5
const T_DOOR := 6
const T_DOOR_LOCKED := 7
const T_HAZARD := 8
const TILE_COUNT := 9

const C_FLOOR := Color("#2b323c")
const C_FLOOR_2 := Color("#232932")
const C_LINE := Color("#e8b73a")
const C_WALL_TOP := Color("#9fb2c8")
const C_WALL_FACE := Color("#6d8199")
const C_WALL_BASE := Color("#3d4b5c")
const C_DOOR := Color("#3f6f8f")
const C_LOCK := Color("#c8842f")
const C_HAZARD := Color("#1b1f26")
const C_LAMP := Color("#ffe9bd")
const C_RED := Color("#ef4444")
const C_GREEN := Color("#10b981")
const C_CYAN := Color("#22d3ee")
const C_AMBER := Color("#f59e0b")

## 格坐标 → 屏幕坐标（格中心）。地面层靠 `scale.y = SQUASH` 达成同样的压缩，
## 立物件与迷雾全走这个函数，保证三者永远对齐 —— 只允许这一处投影公式。
static func screen_of_tile(t: Vector2i) -> Vector2:
	return Vector2(float(t.x) * TILE + TILE * 0.5, (float(t.y) * TILE + TILE * 0.5) * SQUASH)


## 投影的逆：鼠标点哪格就落在哪格。点击选中、点击走位全走它 ——
## 与 `screen_of_tile` 必须严格互逆，自检里逐点验过。
static func tile_of_screen(p: Vector2) -> Vector2i:
	return Vector2i(
		int(floor(p.x / TILE)),
		int(floor(p.y / (TILE * SQUASH)))
	)


static func atlas_image() -> Image:
	var img := Image.create(TILE * TILE_COUNT, TILE, false, Image.Format.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	_draw_floor(img, 0, C_FLOOR)
	_draw_line_h(img, TILE * T_FLOOR_LINE_H)
	_draw_line_v(img, TILE * T_FLOOR_LINE_V)
	_draw_grate(img, TILE * T_FLOOR_GRATE)
	_draw_warm(img, TILE * T_FLOOR_WARM)
	_draw_wall(img, TILE * T_WALL)
	_draw_door(img, TILE * T_DOOR, false)
	_draw_door(img, TILE * T_DOOR_LOCKED, true)
	_draw_hazard(img, TILE * T_HAZARD)
	return img


static func atlas_texture() -> ImageTexture:
	return ImageTexture.create_from_image(atlas_image())


static func _px(img: Image, x: int, y: int, c: Color) -> void:
	if x < 0 or y < 0 or x >= img.get_width() or y >= img.get_height():
		return
	img.set_pixel(x, y, c)


static func _rect(img: Image, ox: int, x0: int, y0: int, x1: int, y1: int, c: Color) -> void:
	for y in range(y0, y1):
		for x in range(x0, x1):
			_px(img, ox + x, y, c)


static func _fill(img: Image, ox: int, c: Color) -> void:
	_rect(img, ox, 0, 0, TILE, TILE, c)


static func _noise_floor(img: Image, ox: int, base: Color) -> void:
	for y in range(TILE):
		for x in range(TILE):
			var h := float((x * 7349 + y * 857) % 13) / 13.0
			var c := base.lerp(Color("#39424e"), h * 0.35)
			_px(img, ox + x, y, c)


static func _draw_floor(img: Image, ox: int, base: Color) -> void:
	_noise_floor(img, ox, base)
	# 板缝：左上两条暗线，拼起来才像一块块铺的地板而不是一片糊
	for i in range(TILE):
		_px(img, ox + i, 0, Color(0, 0, 0, 0.28))
		_px(img, ox, i, Color(0, 0, 0, 0.28))


static func _draw_line_h(img: Image, ox: int) -> void:
	_draw_floor(img, ox, C_FLOOR)
	for x in range(TILE):
		for y in range(20, 24):
			_px(img, ox + x, y, C_LINE if (x % 8) < 6 else C_FLOOR_2)


static func _draw_line_v(img: Image, ox: int) -> void:
	_draw_floor(img, ox, C_FLOOR)
	for y in range(TILE):
		for x in range(20, 24):
			_px(img, ox + x, y, C_LINE if (y % 8) < 6 else C_FLOOR_2)


## 格栅/通道板：中央通道和管道走廊那类房间用它，一眼和车间地面区分开
static func _draw_grate(img: Image, ox: int) -> void:
	_fill(img, ox, C_FLOOR_2)
	for y in range(2, TILE - 2, 6):
		for x in range(TILE):
			_px(img, ox + x, y, Color("#3a4350"))
	for x in range(3, TILE - 2, 11):
		for y in range(TILE):
			_px(img, ox + x, y, Color(0, 0, 0, 0.22))


## 顶灯照到的暖白中心：每个房间铺一块，才有"房间有顶灯、角落暗"的层次
static func _draw_warm(img: Image, ox: int) -> void:
	_draw_floor(img, ox, C_FLOOR)
	var mid := TILE * 0.5
	for y in range(TILE):
		for x in range(TILE):
			var d := Vector2(float(x) - mid, float(y) - mid).length() / mid
			var w := clampf(1.0 - d, 0.0, 1.0)
			w = pow(w, 1.7) * 0.4
			_px(img, ox + x, y, Color(img.get_pixel(ox + x, y)).lerp(C_LAMP, w))


## 墙：顶面浅灰蓝 + 前立面中灰蓝 + 底脚暗边，压缩后仍有体积感
static func _draw_wall(img: Image, ox: int) -> void:
	_rect(img, ox, 0, 0, TILE, 22, C_WALL_TOP)
	_rect(img, ox, 0, 22, TILE, 36, C_WALL_FACE)
	_rect(img, ox, 0, 36, TILE, TILE, C_WALL_BASE)
	for x in range(TILE):
		_px(img, ox + x, 0, Color(1, 1, 1, 0.16))
		_px(img, ox + x, 1, Color(1, 1, 1, 0.08))
	# 砖缝：顶面每隔几像素一道暗线
	for y in [7, 14]:
		for x in range(TILE):
			_px(img, ox + x, y, Color(0, 0, 0, 0.10))
	for x in range(0, TILE, 11):
		for y in range(0, 22):
			_px(img, ox + x, y, Color(0, 0, 0, 0.07))


static func _draw_door(img: Image, ox: int, locked: bool) -> void:
	_fill(img, ox, C_FLOOR_2)
	_rect(img, ox, 4, 2, TILE - 8, TILE - 2, C_DOOR if not locked else Color("#5a4324"))
	for y in range(2, TILE - 2):
		_px(img, ox + 3, y, C_WALL_BASE)
		_px(img, ox + TILE - 4, y, C_WALL_BASE)
	# 门上的推拉槽
	for y in range(8, TILE - 8, 5):
		for x in range(8, TILE - 8):
			_px(img, ox + x, y, Color(0, 0, 0, 0.14))
	if locked:
		_rect(img, ox, TILE / 2 - 5, TILE / 2 - 7, TILE / 2 + 5, TILE / 2 + 3, C_LOCK)
		for y in range(TILE / 2 - 4, TILE / 2 + 7):
			for x in range(TILE / 2 - 2, TILE / 2 + 2):
				_px(img, ox + x, y, Color("#8a5a17"))
	else:
		for x in range(10, TILE - 10):
			_px(img, ox + x, TILE / 2, Color(0.85, 0.95, 1.0, 0.5))


## 黄黑斜纹警示带：故障扩散区/危险边界用它铺地
static func _draw_hazard(img: Image, ox: int) -> void:
	for y in range(TILE):
		for x in range(TILE):
			var band := int((x + y) / 7.0) % 2
			_px(img, ox + x, y, C_LINE if band == 0 else C_HAZARD)


# ============================ 设备图标（供 UI 与迷你地图复用） ============================

static func icon_texture(kind: String, accent: Color, size: int = 56) -> ImageTexture:
	var img := Image.create(size, size, false, Image.Format.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	var dark := accent.darkened(0.5)
	match kind:
		"pump":
			_icon_pump(img, size, accent, dark)
		"compressor":
			_icon_compressor(img, size, accent, dark)
		"gearbox":
			_icon_gear(img, size, accent, dark)
		"motor":
			_icon_motor(img, size, accent, dark)
		"vessel":
			_icon_vessel(img, size, accent, dark)
		_:
			_icon_machine(img, size, accent, dark)
	return ImageTexture.create_from_image(img)


static func _disk(img: Image, cx: float, cy: float, r: float, c: Color) -> void:
	var size := img.get_width()
	for y in range(maxi(0, int(cy - r)), mini(size, int(cy + r) + 1)):
		for x in range(maxi(0, int(cx - r)), mini(size, int(cx + r) + 1)):
			if Vector2(x - cx, y - cy).length() <= r:
				img.set_pixel(x, y, c)


static func _box(img: Image, x0: int, y0: int, x1: int, y1: int, c: Color) -> void:
	var h := img.get_height()
	for y in range(maxi(0, y0), mini(h, y1)):
		for x in range(maxi(0, x0), mini(img.get_width(), x1)):
			img.set_pixel(x, y, c)


static func _icon_motor(img: Image, s: int, ac: Color, dk: Color) -> void:
	_box(img, int(s * 0.18), int(s * 0.38), int(s * 0.72), int(s * 0.72), dk)
	_box(img, int(s * 0.18), int(s * 0.38), int(s * 0.72), int(s * 0.44), ac)
	_disk(img, s * 0.72, s * 0.55, s * 0.13, ac)
	_box(img, int(s * 0.28), int(s * 0.26), int(s * 0.46), int(s * 0.38), dk)


static func _icon_pump(img: Image, s: int, ac: Color, dk: Color) -> void:
	_disk(img, s * 0.44, s * 0.56, s * 0.24, dk)
	_disk(img, s * 0.44, s * 0.56, s * 0.13, ac)
	_box(img, int(s * 0.62), int(s * 0.30), int(s * 0.88), int(s * 0.42), ac)
	_box(img, int(s * 0.36), int(s * 0.14), int(s * 0.5), int(s * 0.36), dk)


static func _icon_compressor(img: Image, s: int, ac: Color, dk: Color) -> void:
	_box(img, int(s * 0.2), int(s * 0.3), int(s * 0.8), int(s * 0.74), dk)
	_box(img, int(s * 0.2), int(s * 0.3), int(s * 0.8), int(s * 0.36), ac)
	for i in range(3):
		_box(img, int(s * 0.26), int(s * (0.44 + i * 0.1)), int(s * 0.74), int(s * (0.48 + i * 0.1)), ac)


static func _icon_gear(img: Image, s: int, ac: Color, dk: Color) -> void:
	_disk(img, s * 0.5, s * 0.55, s * 0.26, dk)
	for k in range(8):
		var a := TAU * float(k) / 8.0
		_disk(img, s * 0.5 + cos(a) * s * 0.27, s * 0.55 + sin(a) * s * 0.27, s * 0.05, ac)
	_disk(img, s * 0.5, s * 0.55, s * 0.09, ac)


static func _icon_vessel(img: Image, s: int, ac: Color, dk: Color) -> void:
	_box(img, int(s * 0.3), int(s * 0.2), int(s * 0.7), int(s * 0.8), dk)
	_disk(img, s * 0.5, s * 0.22, s * 0.2, dk)
	_box(img, int(s * 0.3), int(s * 0.46), int(s * 0.7), int(s * 0.52), ac)


static func _icon_machine(img: Image, s: int, ac: Color, dk: Color) -> void:
	_box(img, int(s * 0.16), int(s * 0.34), int(s * 0.84), int(s * 0.76), dk)
	_box(img, int(s * 0.16), int(s * 0.34), int(s * 0.84), int(s * 0.4), ac)
	_box(img, int(s * 0.58), int(s * 0.16), int(s * 0.7), int(s * 0.36), ac)
