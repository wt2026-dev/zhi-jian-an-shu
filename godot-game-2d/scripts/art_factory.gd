class_name ArtFactory
extends RefCounted
## 程序化像素美术工厂 —— 全部纹理在运行时生成，不依赖任何外部图片资源。
##
## 为什么不用纯色块：现有 Canvas 版被否掉的第一条就是"纯色块、角色扁平"。
## 这里用"按行填充矩形"的方式画真正的像素图（`Image.fill_rect` 是 C++ 实现，
## 逐行填充几十行就够画一个圆/一条腿，比逐像素 set_pixel 快两个数量级）。
##
## 产出三类资源：
##   - 工程师 SpriteFrames：4 方向 × (8 帧行走 + 4 帧待机)
##   - 设备图标：泵 / 电机 / 压缩机 / 减速机 / 机床 / 换热容器 六种可辨识剪影
##   - 地面与前景小件贴图

# ============================ 调色板 ============================

const C_OUTLINE := Color("#0b1220")
const C_CYAN := Color("#22d3ee")
const C_CYAN_DIM := Color("#0e7490")
const C_AMBER := Color("#fbbf24")
const C_AMBER_DARK := Color("#d99a12")
const C_RED := Color("#ef4444")
const C_GREEN := Color("#34d399")
const C_SKIN := Color("#f2c49b")
const C_SKIN_DARK := Color("#cf9c72")
const C_OVERALL := Color("#2563eb")
const C_OVERALL_DARK := Color("#1d4ed8")
const C_SHIRT := Color("#dbe3ee")
const C_SHIRT_DARK := Color("#a8b6c9")
const C_BOOT := Color("#1f2937")
const C_STEEL := Color("#64748b")
const C_STEEL_DARK := Color("#3f4a5c")
const C_STEEL_LIGHT := Color("#94a3b8")
const C_GLASS := Color("#0f172a")

# ============================ 基础绘制原语 ============================

static func _clip(img: Image, r: Rect2i) -> Rect2i:
	return r.intersection(Rect2i(0, 0, img.get_width(), img.get_height()))


static func box(img: Image, x: int, y: int, w: int, h: int, c: Color) -> void:
	if w <= 0 or h <= 0:
		return
	var r := _clip(img, Rect2i(x, y, w, h))
	if r.size.x > 0 and r.size.y > 0:
		img.fill_rect(r, c)


## 椭圆（也用于画圆）：逐行算半宽，每行只调用一次原生 fill_rect。
static func disc(img: Image, cx: int, cy: int, rx: int, ry: int, c: Color) -> void:
	if rx <= 0 or ry <= 0:
		return
	for dy in range(-ry, ry + 1):
		var t := 1.0 - float(dy * dy) / float(ry * ry)
		if t <= 0.0:
			continue
		var dx := int(round(float(rx) * sqrt(t)))
		box(img, cx - dx, cy + dy, dx * 2 + 1, 1, c)


## 带线宽的线段：沿线取样并盖方块，得到有厚度的像素肢体。
static func thick_line(img: Image, a: Vector2, b: Vector2, w: int, c: Color) -> void:
	var n := int(max(1.0, a.distance_to(b)))
	for i in range(n + 1):
		var p := a.lerp(b, float(i) / float(n))
		box(img, int(round(p.x)) - w / 2, int(round(p.y)) - w / 2, w, w, c)


## 圆角实心矩形：四角各挖一次，用来做工业风的机柜/底板。
static func round_box(img: Image, x: int, y: int, w: int, h: int, r: int, c: Color) -> void:
	box(img, x + r, y, w - r * 2, h, c)
	box(img, x, y + r, w, h - r * 2, c)


## 描边：把已有不透明区域的外沿补一圈深色，让剪影从背景里"抠"出来。
##
## 走 `get_data()` 直接读 RGBA 字节，不用 `get_pixel`/`set_pixel` ——
## 后者每次调用都要过一遍 Variant 装箱，72×72 的图标逐个像素访问会慢两个数量级。
static func outline(img: Image, c: Color) -> void:
	var w := img.get_width()
	var h := img.get_height()
	var data := img.get_data()
	var opaque := PackedByteArray()
	opaque.resize(w * h)
	for i in range(w * h):
		opaque[i] = 1 if data[i * 4 + 3] > 127 else 0
	var edges: Array[int] = []
	for y in range(h):
		for x in range(w):
			var i := y * w + x
			if opaque[i] == 1:
				continue
			var touching := false
			if x > 0 and opaque[i - 1] == 1:
				touching = true
			elif x < w - 1 and opaque[i + 1] == 1:
				touching = true
			elif y > 0 and opaque[i - w] == 1:
				touching = true
			elif y < h - 1 and opaque[i + w] == 1:
				touching = true
			if touching:
				edges.append(i)
	var rgb := Color(c.r, c.g, c.b, 1.0)
	for i in edges:
		img.set_pixel(i % w, i / w, rgb)


# ============================ 工程师角色 ============================

const FW := 44
const FH := 64
const CX := 22
const FOOT_Y := 61
const HIP_Y := 41
const SHOULDER_Y := 29
const WALK_FRAMES := 8
const IDLE_FRAMES := 4

const DIRECTIONS := ["down", "up", "left", "right"]


## 4 方向 ×（8 帧行走 + 4 帧待机）的 AnimatedSprite2D 帧集。
static func engineer_frames() -> SpriteFrames:
	var sf := SpriteFrames.new()
	sf.remove_animation("default")
	for dir: String in DIRECTIONS:
		var walk: String = "walk_" + dir
		var idle: String = "idle_" + dir
		sf.add_animation(walk)
		sf.set_animation_speed(walk, 12.0)
		sf.set_animation_loop(walk, true)
		for i in range(WALK_FRAMES):
			sf.add_frame(walk, _engineer_texture(dir, float(i) / float(WALK_FRAMES), true))
		sf.add_animation(idle)
		sf.set_animation_speed(idle, 6.0)
		sf.set_animation_loop(idle, true)
		for i in range(IDLE_FRAMES):
			sf.add_frame(idle, _engineer_texture(dir, float(i) / float(IDLE_FRAMES), false))
	return sf


static func _engineer_texture(dir: String, phase: float, moving: bool) -> ImageTexture:
	var img := Image.create(FW, FH, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	if dir == "left" or dir == "right":
		_draw_side(img, dir, phase, moving)
	else:
		_draw_front_back(img, dir == "up", phase, moving)
	return ImageTexture.create_from_image(img)


## 正/背面：双脚左右摆、双臂前后摆、躯干随步频轻微起伏。
##
## 版式硬约束（踩过的坑）：安全帽穹顶**不能压到眼睛**。第一版把穹顶画到
## y=head_top+12，眼睛正好落在帽壳底下 —— 蒙太奇里 4 个方向的角色全是
## "没有脸的黄头盔"。现在固定成一条版式线：
##   帽壳 7..23（相对 head_top=13）→ 眼睛 head_top+11 → 嘴 head_top+14 → 下巴 head_top+15
## 改动这些数字前先跑一次 selfcheck 看蒙太奇。
static func _draw_front_back(img: Image, back: bool, phase: float, moving: bool) -> void:
	var sw := sin(phase * TAU)
	var bob := 0
	if moving:
		bob = int(round(abs(cos(phase * TAU)) * -2.0))
	var hip := HIP_Y + bob
	var sh := SHOULDER_Y + bob

	# ---- 腿：髋 → 膝 → 脚，两段折线才像"抬腿"而不是"摆动木棍"
	var legs := [{"s": -1.0, "x": -5}, {"s": 1.0, "x": 5}]
	for leg: Dictionary in legs:
		var s: float = leg["s"]
		var lx: int = CX + int(leg["x"])
		var swing: float = sw * s * 7.0
		var lift: float = maxf(0.0, sin(phase * TAU + (0.0 if s < 0.0 else PI))) * 4.0
		if not moving:
			swing = 0.0
			lift = 0.0
		var foot := Vector2(float(lx) + swing, float(FOOT_Y) - lift)
		var knee := Vector2(float(lx) + swing * 0.45, float(hip) + (float(FOOT_Y) - float(hip)) * 0.5 - lift * 0.7)
		thick_line(img, Vector2(float(lx), float(hip)), knee, 7, C_OVERALL)
		thick_line(img, knee, foot, 6, C_OVERALL)
		thick_line(img, knee, foot, 2, C_SHIRT_DARK)
		box(img, int(foot.x) - 5, int(foot.y) - 3, 11, 6, C_BOOT)
		box(img, int(foot.x) - 5, int(foot.y) + 2, 11, 2, Color("#0f141d"))

	# ---- 躯干：蓝工装连体裤是主体，白衬衫只在领口露一条（别整件白，那就不像工装了）
	box(img, CX - 9, sh, 18, hip - sh + 4, C_OVERALL)
	box(img, CX - 9, sh, 3, hip - sh + 4, C_OVERALL_DARK)
	box(img, CX + 6, sh, 3, hip - sh + 4, C_OVERALL_DARK)
	box(img, CX - 5, sh, 10, 4, C_SHIRT)
	box(img, CX - 3, sh + 4, 6, 2, C_SKIN_DARK)
	if back:
		thick_line(img, Vector2(float(CX - 6), float(sh + 3)), Vector2(float(CX + 6), float(sh + 13)), 3, C_OVERALL_DARK)
		thick_line(img, Vector2(float(CX + 6), float(sh + 3)), Vector2(float(CX - 6), float(sh + 13)), 3, C_OVERALL_DARK)
	else:
		box(img, CX - 7, sh + 3, 4, 10, C_OVERALL_DARK)
		box(img, CX + 3, sh + 3, 4, 10, C_OVERALL_DARK)
		box(img, CX - 6, sh + 13, 5, 5, C_OVERALL_DARK)
		box(img, CX - 5, sh + 14, 3, 1, C_AMBER)
	box(img, CX - 9, hip - 6, 18, 3, C_AMBER)

	# ---- 手臂：与腿反向摆
	for side: int in [-1, 1]:
		var ax: int = CX + side * 11
		var swing: float = -sw * side * 7.0
		if not moving:
			swing = 0.0
		var hand := Vector2(float(ax) + swing, float(sh) + 19.0)
		thick_line(img, Vector2(float(ax), float(sh + 1)), hand, 6, C_OVERALL)
		thick_line(img, Vector2(float(ax), float(sh + 1)), Vector2(float(ax) + swing * 0.4, float(sh) + 9.0), 6, C_SHIRT)
		disc(img, int(hand.x), int(hand.y), 3, 3, C_SKIN)

	# ---- 头
	var head_top := sh - 16
	box(img, CX - 6, head_top, 13, 16, C_SKIN_DARK if back else C_SKIN)
	box(img, CX - 6, head_top, 3, 16, C_SKIN_DARK)
	if back:
		box(img, CX - 6, head_top, 13, 11, Color("#3f2a1d"))
	else:
		box(img, CX - 4, head_top + 11, 2, 3, C_OUTLINE)
		box(img, CX + 2, head_top + 11, 2, 3, C_OUTLINE)
		box(img, CX - 2, head_top + 14, 5, 1, C_SKIN_DARK)

	# ---- 安全帽：穹顶 7..21、帽檐 19..23，眼睛在 head_top+11 必须露在帽檐之下
	disc(img, CX, head_top + 1, 9, 7, C_AMBER)
	box(img, CX - 10, head_top + 6, 21, 3, C_AMBER)
	box(img, CX - 11, head_top + 9, 23, 2, C_AMBER_DARK)
	box(img, CX - 5, head_top - 4, 4, 6, Color("#ffe08a"))


## 侧面：身体收窄，前后脚沿地面平移，手臂只画靠镜头那一侧。
static func _draw_side(img: Image, dir: String, phase: float, moving: bool) -> void:
	var face := 1 if dir == "right" else -1
	var sw := sin(phase * TAU)
	var bob := 0
	if moving:
		bob = int(round(abs(cos(phase * TAU)) * -2.0))
	var hip := HIP_Y + bob
	var sh := SHOULDER_Y + bob

	# ---- 后腿先画，会被前腿遮住
	for order: int in [1, 0]:
		var sign: float = -1.0 if order == 0 else 1.0
		var swing: float = sw * sign * 8.0
		var lift: float = 0.0
		if moving and sign > 0.0:
			lift = maxf(0.0, sin(phase * TAU)) * 4.0
		if not moving:
			swing = 0.0
		var lx: int = CX - 1 + order * 3
		var foot := Vector2(float(lx) + swing, float(FOOT_Y) - lift)
		var knee := Vector2(float(lx) + swing * 0.5, float(hip) + (float(FOOT_Y) - float(hip)) * 0.5 - lift * 0.6)
		var leg_c: Color = C_OVERALL_DARK if order == 0 else C_OVERALL
		thick_line(img, Vector2(float(lx), float(hip)), knee, 7, leg_c)
		thick_line(img, knee, foot, 6, leg_c)
		# 鞋尖朝行进方向
		box(img, int(foot.x) - 5, int(foot.y) - 3, 11, 6, C_BOOT)
		if face > 0:
			box(img, int(foot.x) + 3, int(foot.y) - 3, 5, 6, C_BOOT)
		else:
			box(img, int(foot.x) - 8, int(foot.y) - 3, 5, 6, C_BOOT)

	# ---- 躯干（侧视更窄）
	box(img, CX - 6, sh, 13, hip - sh + 4, C_OVERALL)
	box(img, CX - 6, sh, 3, hip - sh + 4, C_OVERALL_DARK)
	box(img, CX + 4, sh, 3, hip - sh + 4, C_OVERALL_DARK)
	box(img, CX - 5, sh, 8, 4, C_SHIRT)
	box(img, CX - 6, hip - 6, 13, 3, C_AMBER)

	# ---- 靠镜头一侧的手臂
	var arm_swing: float = -sw * 8.0 * float(face)
	if not moving:
		arm_swing = 0.0
	var hand := Vector2(float(CX) + arm_swing, float(sh) + 19.0)
	thick_line(img, Vector2(float(CX), float(sh + 1)), hand, 6, C_OVERALL)
	disc(img, int(hand.x), int(hand.y), 3, 3, C_SKIN)

	# ---- 头（侧脸：只画一只眼）
	var head_top := sh - 16
	box(img, CX - 6, head_top, 14, 16, C_SKIN)
	box(img, CX - 6, head_top, 3, 16, C_SKIN_DARK)
	box(img, CX + face * 3 - (1 if face > 0 else 0), head_top + 11, 2, 3, C_OUTLINE)
	box(img, CX + face * 5 - (2 if face > 0 else 0), head_top + 14, 4, 1, C_SKIN_DARK)

	# ---- 安全帽：帽檐朝行进方向多伸一截
	disc(img, CX + face, head_top + 1, 9, 7, C_AMBER)
	box(img, CX - 10, head_top + 6, 21, 3, C_AMBER)
	if face > 0:
		box(img, CX + 8, head_top + 6, 6, 3, C_AMBER)
		box(img, CX - 11, head_top + 9, 25, 2, C_AMBER_DARK)
	else:
		box(img, CX - 14, head_top + 6, 6, 3, C_AMBER)
		box(img, CX - 14, head_top + 9, 25, 2, C_AMBER_DARK)
	box(img, CX - 4 + face * 2, head_top - 4, 4, 6, Color("#ffe08a"))


# ============================ 设备图标 ============================

const ICON := 72

## 设备类别 → 图标种类（类别口径来自 `src/types` 的 Equipment.category）。
static func icon_kind_for(category: String) -> String:
	if category.contains("泵"):
		return "pump"
	if category.contains("电机"):
		return "motor"
	if category.contains("压缩") or category.contains("空压"):
		return "compressor"
	if category.contains("减速") or category.contains("传动"):
		return "gearbox"
	if category.contains("机床") or category.contains("机器人"):
		return "machine"
	if category.contains("换热") or category.contains("容器"):
		return "vessel"
	return "motor"


## 设备图标：六种可辨识剪影 + 统一的工业底座与状态色描边。
static func equipment_icon(kind: String, accent: Color) -> ImageTexture:
	var img := Image.create(ICON, ICON, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	match kind:
		"pump":
			_icon_pump(img)
		"motor":
			_icon_motor(img)
		"compressor":
			_icon_compressor(img)
		"gearbox":
			_icon_gearbox(img)
		"machine":
			_icon_machine(img)
		"vessel":
			_icon_vessel(img)
		_:
			_icon_motor(img)
	# 底座 + 状态色底边：让"这台是故障还是正常"一眼可辨
	box(img, 8, 62, 56, 5, C_STEEL_DARK)
	box(img, 6, 66, 60, 3, C_OUTLINE)
	box(img, 8, 62, 56, 2, accent)
	outline(img, C_OUTLINE)
	return ImageTexture.create_from_image(img)


static func _icon_pump(img: Image) -> void:
	# 蜗壳 + 进出口接管 + 联轴器电机
	disc(img, 30, 40, 17, 17, C_STEEL)
	disc(img, 30, 40, 12, 12, C_STEEL_LIGHT)
	disc(img, 30, 40, 5, 5, C_CYAN_DIM)
	box(img, 8, 36, 10, 9, C_STEEL_DARK)      # 吸入管
	box(img, 6, 34, 4, 13, C_STEEL)
	box(img, 26, 16, 9, 12, C_STEEL_DARK)     # 排出管
	box(img, 24, 12, 13, 5, C_STEEL)
	box(img, 46, 30, 16, 20, C_STEEL_DARK)    # 电机
	box(img, 48, 33, 12, 14, C_STEEL)
	box(img, 48, 34, 12, 2, C_STEEL_LIGHT)
	box(img, 44, 36, 4, 8, C_STEEL_LIGHT)     # 联轴器
	box(img, 12, 56, 48, 6, C_STEEL_DARK)     # 底座
	for i in range(3):
		box(img, 16 + i * 16, 58, 4, 3, C_STEEL_LIGHT)


static func _icon_motor(img: Image) -> void:
	box(img, 14, 26, 44, 30, C_STEEL)         # 机身
	disc(img, 14, 41, 4, 15, C_STEEL_DARK)
	disc(img, 58, 41, 4, 15, C_STEEL_DARK)
	for i in range(7):                        # 散热筋
		box(img, 20 + i * 5, 27, 2, 28, C_STEEL_DARK)
	box(img, 26, 18, 18, 9, C_STEEL_DARK)     # 接线盒
	box(img, 28, 20, 14, 5, C_AMBER_DARK)
	box(img, 58, 36, 10, 9, C_STEEL_LIGHT)    # 输出轴
	box(img, 8, 40, 8, 6, C_CYAN_DIM)
	box(img, 12, 56, 48, 6, C_STEEL_DARK)
	box(img, 10, 54, 12, 8, C_STEEL_DARK)
	box(img, 50, 54, 12, 8, C_STEEL_DARK)


static func _icon_compressor(img: Image) -> void:
	# 横卧储气罐 + 缸头 + 驱动电机：第一版画成上下两个圆，看着像雪人，认不出是空压机
	round_box(img, 10, 40, 52, 18, 7, C_STEEL)
	box(img, 16, 43, 40, 4, C_STEEL_LIGHT)
	box(img, 16, 53, 40, 2, C_STEEL_DARK)
	box(img, 14, 22, 22, 18, C_STEEL)          # 缸头
	for i in range(6):
		box(img, 16 + i * 3, 24, 1, 14, C_STEEL_DARK)
	box(img, 12, 20, 26, 3, C_STEEL_DARK)
	box(img, 40, 26, 22, 14, C_STEEL_DARK)     # 驱动电机
	box(img, 42, 28, 18, 10, C_STEEL)
	for i in range(4):
		box(img, 44 + i * 4, 29, 1, 8, C_STEEL_LIGHT)
	box(img, 36, 30, 4, 6, C_CYAN_DIM)
	box(img, 20, 14, 5, 7, C_STEEL_DARK)       # 排气管
	disc(img, 56, 33, 5, 5, C_STEEL_LIGHT)     # 压力表
	disc(img, 56, 33, 2, 2, C_CYAN)
	box(img, 14, 58, 7, 5, C_STEEL_DARK)       # 支腿
	box(img, 50, 58, 7, 5, C_STEEL_DARK)


static func _icon_gearbox(img: Image) -> void:
	box(img, 18, 34, 34, 22, C_STEEL)         # 箱体
	box(img, 14, 30, 42, 6, C_STEEL_DARK)     # 上盖
	disc(img, 35, 45, 8, 8, C_STEEL_DARK)     # 检视盖
	disc(img, 35, 45, 5, 5, C_CYAN_DIM)
	box(img, 8, 40, 12, 7, C_STEEL_LIGHT)     # 输入轴
	box(img, 30, 16, 9, 18, C_STEEL_DARK)     # 输出轴（上出）
	box(img, 27, 12, 15, 6, C_STEEL)
	box(img, 20, 56, 30, 6, C_STEEL_DARK)
	for i in range(4):                        # 地脚螺栓
		box(img, 20 + i * 9, 58, 3, 3, C_STEEL_LIGHT)


static func _icon_machine(img: Image) -> void:
	box(img, 10, 18, 52, 38, C_STEEL)         # 外壳
	box(img, 12, 20, 48, 4, C_STEEL_DARK)
	box(img, 16, 26, 24, 18, C_GLASS)         # 观察窗
	box(img, 17, 27, 22, 16, Color("#164e63"))
	box(img, 19, 29, 8, 12, C_CYAN_DIM)
	box(img, 44, 26, 14, 18, C_STEEL_DARK)    # 控制面板
	box(img, 46, 29, 10, 5, Color("#052e16"))
	box(img, 46, 36, 10, 5, C_AMBER_DARK)
	box(img, 8, 56, 56, 6, C_STEEL_DARK)
	box(img, 14, 12, 10, 6, C_STEEL_DARK)     # 顶置电机
	box(img, 48, 14, 8, 4, C_STEEL_LIGHT)


static func _icon_vessel(img: Image) -> void:
	box(img, 24, 14, 24, 44, C_STEEL)         # 筒体
	disc(img, 36, 14, 12, 5, C_STEEL_DARK)    # 上封头
	disc(img, 36, 58, 12, 5, C_STEEL_DARK)    # 下封头
	for i in range(6):                        # 管束纹
		box(img, 27 + i * 3, 18, 1, 38, C_STEEL_DARK)
	box(img, 12, 24, 12, 8, C_STEEL_DARK)     # 壳程进口
	box(img, 48, 44, 12, 8, C_CYAN_DIM)       # 壳程出口
	box(img, 30, 6, 12, 8, C_STEEL)           # 顶部接管
	box(img, 22, 60, 8, 6, C_STEEL_DARK)      # 鞍座
	box(img, 42, 60, 8, 6, C_STEEL_DARK)
	box(img, 32, 30, 8, 3, C_AMBER)           # 铭牌


# ============================ 地面 / 前景 ============================

## 车间地面：水泥底 + 黄色警戒线 + 格栅缝，铺满整关宽度。
static func ground_texture(width: int, ground_y: int) -> ImageTexture:
	var h := 200
	var img := Image.create(max(width, 16), h, false, Image.FORMAT_RGBA8)
	img.fill(Color("#2b3345"))
	box(img, 0, 0, img.get_width(), 4, Color("#475569"))
	box(img, 0, 4, img.get_width(), 3, C_AMBER)
	box(img, 0, 7, img.get_width(), 2, Color("#1f2937"))
	for x in range(0, img.get_width(), 64):
		box(img, x, 12, 2, h - 12, Color("#232a39"))
	for y in range(20, h, 26):
		box(img, 0, y, img.get_width(), 2, Color("#333c50"))
	return ImageTexture.create_from_image(img)


## 五角星顶点（交给 `draw_colored_polygon` 画）。
## 同样不直接用 "★" 字符，理由和 heart_texture 一样：字体缺字形就是豆腐块。
static func star_points(radius: float, inner_ratio: float = 0.44) -> PackedVector2Array:
	var pts := PackedVector2Array()
	for i in range(10):
		var r: float = radius if i % 2 == 0 else radius * inner_ratio
		var a := -PI / 2.0 + float(i) * PI / 5.0
		pts.append(Vector2(cos(a) * r, sin(a) * r))
	return pts


## 生命值心形图标。
##
## 为什么不用 "❤" 字符：中文字体不一定收录 U+2764，缺字形就是豆腐块 □。
## 这类"符号当图标"的坑在别的项目里踩过，直接画像素图最稳。
static func heart_texture(filled: bool) -> ImageTexture:
	var img := Image.create(18, 16, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	var c: Color = C_RED if filled else Color("#334155")
	disc(img, 5, 6, 4, 4, c)
	disc(img, 12, 6, 4, 4, c)
	for i in range(8):
		box(img, 1 + i, 7 + i, 16 - i * 2, 1, c)
	if filled:
		box(img, 3, 4, 3, 2, Color("#ff9d9d"))
	outline(img, C_OUTLINE)
	return ImageTexture.create_from_image(img)


## 设备悬浮标签的底板：圆角半透明深色 + 左侧状态色条 + 顶部一道高光。
## 半透明是故意的：标签压在背景上时不该把背后的厂房整个糊掉。
static func label_plate(width: int, height: int, accent: Color) -> ImageTexture:
	var img := Image.create(width, height, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	round_box(img, 0, 0, width, height, 7, Color(0.043, 0.071, 0.125, 0.86))
	box(img, 0, 0, 4, height, accent)
	box(img, 6, 3, maxi(1, width - 9), 1, Color(1, 1, 1, 0.12))
	box(img, 0, height - 1, width, 1, Color(0, 0, 0, 0.35))
	return ImageTexture.create_from_image(img)
