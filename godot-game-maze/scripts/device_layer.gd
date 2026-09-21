class_name DeviceLayer
extends Node2D
## 设备与钥匙卡的俯视立牌：地面是压扁的（俯视），物体是立着的（有体积），
## 合起来就是 SimCity 那种斜上方 45° 的味道。
##
## 光圈用 `_draw()` 画而不是贴图：脉冲半径每帧变，画矢量比每帧生成 Image 便宜得多。
## 位置一律走 `MazeArt.screen_of_tile()` —— 和地面、迷雾共用同一个投影，
## 三者错位这种 bug 就只能靠"只允许一处投影公式"来防。

const TILE := MazeArt.TILE
const BODY_W := 40.0
const BODY_H := 30.0

var map: MazeMap
var pulse := 0.0
var _icons: Dictionary = {}


func _ready() -> void:
	z_index = 10


func setup(m: MazeMap) -> void:
	map = m
	_icons.clear()
	_preload_icons()
	queue_redraw()


## 图标按 `icon` 种类 + 状态色缓存；每关几十台，重复着色没必要每次重画
func _preload_icons() -> void:
	if map == null:
		return
	for d in map.devices:
		var slot: MazeMap.DeviceSlot = d
		var key := "%s|%s" % [slot.icon, _accent_of(slot).to_html()]
		if not _icons.has(key):
			_icons[key] = MazeArt.icon_texture(slot.icon, _accent_of(slot), 52)


func _accent_of(slot: MazeMap.DeviceSlot) -> Color:
	if slot.faulty and not slot.cleared:
		return MazeArt.C_RED
	if slot.faulty:
		return MazeArt.C_GREEN.darkened(0.25)
	return MazeArt.C_GREEN


func _process(delta: float) -> void:
	pulse = fmod(pulse + delta, 1.0)
	# 只有红圈在跳，绿色常亮 —— 全场一起闪既费重绘也干扰判断
	queue_redraw()


func _draw() -> void:
	if map == null:
		return
	for k in map.keycards:
		var kc: MazeMap.Keycard = k
		if kc.taken or not map.tile_explored(kc.tile):
			continue
		_draw_keycard(MazeArt.screen_of_tile(kc.tile))
	for d in map.devices:
		var slot: MazeMap.DeviceSlot = d
		var room: MazeMap.Room = map.rooms[slot.room_id]
		if not room.explored:
			continue
		_draw_device(slot, MazeArt.screen_of_tile(slot.tile))


func _draw_device(slot: MazeMap.DeviceSlot, at: Vector2) -> void:
	# 底座阴影：物体"站在地上"的第一线索
	draw_colored_polygon(
		PackedVector2Array([
			at + Vector2(-BODY_W * 0.62, 6), at + Vector2(0, 13),
			at + Vector2(BODY_W * 0.62, 6), at + Vector2(0, -1),
		]),
		Color(0, 0, 0, 0.42)
	)
	# 机座：一块压扁的立方体（顶面亮、前脸暗）
	var top := at.y - BODY_H * 0.55
	draw_rect(Rect2(Vector2(at.x - BODY_W * 0.5, top), Vector2(BODY_W, BODY_H * 0.42)),
		Color("#54627a"), true)
	draw_rect(Rect2(Vector2(at.x - BODY_W * 0.5, top + BODY_H * 0.42), Vector2(BODY_W, BODY_H * 0.62)),
		Color("#313b4c"), true)
	draw_rect(Rect2(Vector2(at.x - BODY_W * 0.5, top), Vector2(BODY_W, BODY_H)), Color(0, 0, 0, 0.55), false, 1.0)

	var accent := _accent_of(slot)
	var key := "%s|%s" % [slot.icon, accent.to_html()]
	var tex: Texture2D = _icons.get(key)
	if tex != null:
		var s := 52.0
		draw_texture_rect(tex, Rect2(Vector2(at.x - s * 0.5, top - s + 8), Vector2(s, s)), false)

	_draw_ring(at + Vector2(0, 6), accent, slot)

	if slot.spread and slot.faulty and not slot.cleared:
		# 扩散过的故障：脚下压一圈黄黑警示带，比再多一个光圈都显眼
		draw_set_transform(at + Vector2(0, 8), 0.0, Vector2(1.0, 0.42))
		for i in range(12):
			var a := TAU * float(i) / 12.0
			var c := MazeArt.C_LINE if i % 2 == 0 else Color("#1b1f26")
			draw_rect(Rect2(Vector2(cos(a) * 34.0, sin(a) * 34.0) - Vector2(4, 4), Vector2(8, 8)), c, true)
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


## 脉冲光圈：故障红圈呼吸式扩散，健康设备淡绿常亮（验收口径「正常淡绿色光圈」）
func _draw_ring(foot: Vector2, accent: Color, slot: MazeMap.DeviceSlot) -> void:
	var flashing := slot.faulty and not slot.cleared
	if flashing:
		var k := pulse if pulse < 0.5 else 1.0 - pulse
		var r := 24.0 + k * 26.0
		draw_arc(foot, r, 0, TAU, 40, Color(accent.r, accent.g, accent.b, 0.85 - k * 0.6), 2.5)
		draw_arc(foot, 23.0, 0, TAU, 36, accent, 2.0)
		draw_arc(foot, 30.0 + k * 10.0, 0, TAU, 36, Color(accent.r, accent.g, accent.b, 0.30), 1.5)
	else:
		draw_arc(foot, 23.0, 0, TAU, 36, Color(accent.r, accent.g, accent.b, 0.5), 2.0)
		if slot.cleared:
			draw_line(foot + Vector2(-6, 0), foot + Vector2(-1, 5), MazeArt.C_GREEN, 2.5)
			draw_line(foot + Vector2(-1, 5), foot + Vector2(7, -6), MazeArt.C_GREEN, 2.5)
	draw_set_transform(foot, 0.0, Vector2(1.0, 0.42))
	draw_circle(Vector2.ZERO, 20.0, Color(0, 0, 0, 0.28))
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


func _draw_keycard(at: Vector2) -> void:
	var bob := sin(pulse * TAU) * 3.0
	var c := at + Vector2(0, -10 + bob)
	draw_rect(Rect2(c - Vector2(11, 8), Vector2(22, 16)), Color("#0e7490"), true)
	draw_rect(Rect2(c - Vector2(11, 8), Vector2(22, 16)), MazeArt.C_CYAN, false, 1.5)
	draw_rect(Rect2(c - Vector2(7, -3), Vector2(8, 5)), Color("#a5f3fc"), true)
	draw_arc(c + Vector2(0, -14), 5.0, 0, TAU, 16, MazeArt.C_CYAN, 1.5)
