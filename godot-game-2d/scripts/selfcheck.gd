extends Node
## 美术自检：把程序化生成的帧动画与设备图标拼成一张蒙太奇 PNG，
## 供人工/Read 目视检查（排版类缺陷数字断言查不出来）。
##
## 运行（用场景而不是 --script：`--script` 下在 `_init` 里调 `quit()` 会被
## 随后的 main loop 初始化覆盖掉，进程永远不退出）：
##   godot --headless --path <项目> res://scenes/SelfCheck.tscn

var problems: Array[String] = []


func _ready() -> void:
	print("[1] 生成角色帧集 ...")
	var sf := ArtFactory.engineer_frames()
	var anims := sf.get_animation_names()
	print("    animations = ", anims)
	if anims.size() != 8:
		problems.append("动画数应为 8（4 方向 × 行走/待机），实际 %d" % anims.size())
	for a: String in anims:
		var n := sf.get_frame_count(a)
		var want := ArtFactory.WALK_FRAMES if a.begins_with("walk") else ArtFactory.IDLE_FRAMES
		if n != want:
			problems.append("动画 %s 帧数应为 %d，实际 %d" % [a, want, n])

	print("[2] 拼蒙太奇 ...")
	var cw := ArtFactory.FW
	var ch := ArtFactory.FH
	var gap := 4
	var cols := 8
	var icon_w := ArtFactory.ICON
	# 画布宽度要同时容得下"8 帧角色"和"6 个图标"两行里更宽的那一行，
	# 高度要把图标行和地面条分开 —— 第一版算窄了，图标被裁掉最后一个、地面还压在图标上
	var grid_w: int = maxi(cols * (cw + gap) + gap, 6 * (icon_w + gap) + gap)
	var ground_h := 30
	var total_h := 4 * (ch + gap) + gap + icon_w + gap + ground_h + gap
	var montage := Image.create(grid_w + 8, total_h, false, Image.FORMAT_RGBA8)
	montage.fill(Color("#111827"))

	var y := gap
	for dir: String in ArtFactory.DIRECTIONS:
		var walk: String = "walk_" + dir
		for i in range(cols):
			var img := sf.get_frame_texture(walk, i).get_image()
			img.convert(Image.FORMAT_RGBA8)
			_blit(montage, img, gap + i * (cw + gap), y)
		print("    方向 ", dir, " 已拼入")
		y += ch + gap

	print("[3] 六种设备图标 ...")
	var kinds := ["pump", "motor", "compressor", "gearbox", "machine", "vessel"]
	var accents := [ArtFactory.C_RED, ArtFactory.C_GREEN, ArtFactory.C_RED, ArtFactory.C_GREEN, ArtFactory.C_GREEN, ArtFactory.C_RED]
	y += gap
	var icon_y := y
	for i in range(kinds.size()):
		var icon := ArtFactory.equipment_icon(kinds[i], accents[i]).get_image()
		icon.convert(Image.FORMAT_RGBA8)
		_blit(montage, icon, gap + i * (icon_w + gap), icon_y)
		_ink(icon, kinds[i])
		print("    图标 ", kinds[i], " ok")

	print("[4] 地面贴图 ...")
	var g := ArtFactory.ground_texture(grid_w, 430).get_image()
	g.convert(Image.FORMAT_RGBA8)
	_blit(montage, g, 8, icon_y + icon_w + gap)

	print("[5] 逐帧非空体检 ...")
	for a: String in anims:
		for i in range(sf.get_frame_count(a)):
			var im := sf.get_frame_texture(a, i).get_image()
			im.convert(Image.FORMAT_RGBA8)
			var d := im.get_data()
			var count := 0
			for p in range(im.get_width() * im.get_height()):
				if d[p * 4 + 3] > 127:
					count += 1
			if count < 200:
				problems.append("帧 %s#%d 不透明像素只有 %d，像是画空了" % [a, i, count])

	print("[6] 限时口径（踩过的坑：timeLimit=0 被当成「限时 0 秒」）...")
	var MainScript := load("res://scripts/main.gd") as GDScript
	var probe: Node = MainScript.new()
	var cases := [
		{"lv": {"timeLimit": 0, "phaseSeconds": []}, "want": -1.0, "why": "timeLimit=0 应是不限时"},
		{"lv": {"timeLimit": 150, "phaseSeconds": []}, "want": 150.0, "why": "全关限时"},
		{"lv": {"timeLimit": 0, "phaseSeconds": [40, 30, 55]}, "want": 40.0, "why": "BOSS 分阶段：起手取第 1 段"},
	]
	for c in cases:
		var got: float = probe.time_limit_of(c["lv"] as Dictionary)
		var want: float = float(c["want"])
		if not is_equal_approx(got, want):
			problems.append("time_limit_of 出错（%s）：期望 %s，实际 %s" % [String(c["why"]), want, got])
		else:
			print("    ", c["why"], " -> ", got)
	probe.free()

	print("[7] 落盘 ...")
	# 2 倍最近邻放大：原始帧只有 44×64，不放大在预览里看不出"眼睛被帽子盖住"这类缺陷
	var big := _upscale(montage, 2)
	var abs_dir := ProjectSettings.globalize_path("res://_preview")
	DirAccess.make_dir_recursive_absolute(abs_dir)
	var out_path := abs_dir.path_join("art_montage.png")
	var err := big.save_png(out_path)
	print("    saved = ", out_path, " err=", err, " size=", big.get_width(), "x", big.get_height())

	if problems.is_empty():
		print("SELFCHECK OK")
	else:
		print("SELFCHECK FAILED:")
		for p in problems:
			print("  - ", p)
	get_tree().quit(0 if problems.is_empty() else 1)


## 最近邻放大：像素画放大只能用最近邻，线性插值会把像素糊成一片。
func _upscale(src: Image, k: int) -> Image:
	var w := src.get_width() * k
	var h := src.get_height() * k
	var out := Image.create(w, h, false, Image.FORMAT_RGBA8)
	var sd := src.get_data()
	var od := out.get_data()
	var sw := src.get_width()
	for y in range(h):
		var sy := y / k
		for x in range(w):
			var si := (sy * sw + x / k) * 4
			var di := (y * w + x) * 4
			od[di] = sd[si]
			od[di + 1] = sd[si + 1]
			od[di + 2] = sd[si + 2]
			od[di + 3] = sd[si + 3]
	out.set_data(w, h, false, Image.FORMAT_RGBA8, od)
	return out


func _blit(dst: Image, src: Image, x: int, y: int) -> void:
	# 走 get_data() 而不是逐点 get_pixel：后者每次都要过 Variant 装箱
	var sw := src.get_width()
	var sh := src.get_height()
	var sd := src.get_data()
	var dw := dst.get_width()
	var dh := dst.get_height()
	var dd := dst.get_data()
	for sy in range(sh):
		for sx in range(sw):
			var si := (sy * sw + sx) * 4
			if sd[si + 3] <= 0:
				continue
			var dx := x + sx
			var dy := y + sy
			if dx < 0 or dy < 0 or dx >= dw or dy >= dh:
				continue
			var di := (dy * dw + dx) * 4
			dd[di] = sd[si]
			dd[di + 1] = sd[si + 1]
			dd[di + 2] = sd[si + 2]
			dd[di + 3] = sd[si + 3]
	dst.set_data(dw, dh, false, Image.FORMAT_RGBA8, dd)


## 图标体检：不能是空图，也不能是一整块纯色（那就是"纯色块"了）。
func _ink(icon: Image, kind: String) -> void:
	var d := icon.get_data()
	var opaque := 0
	var colors := {}
	for p in range(icon.get_width() * icon.get_height()):
		if d[p * 4 + 3] > 127:
			opaque += 1
			colors[d[p * 4] * 65536 + d[p * 4 + 1] * 256 + d[p * 4 + 2]] = true
	if opaque < 500:
		problems.append("图标 %s 不透明像素仅 %d" % [kind, opaque])
	if colors.size() < 6:
		problems.append("图标 %s 只有 %d 种颜色，太像纯色块" % [kind, colors.size()])
