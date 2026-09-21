class_name MapView
extends Node2D
## 把 `MazeMap` 的格子画出来：地面用 TileMapLayer 拼（地砖 / 墙 / 门 / 锁门），
## 战争迷雾用同一坐标系的覆盖层画黑块。
##
## 斜俯视的实现：地面层整体 `scale.y = SQUASH`，迷雾与立物件走
## `MazeArt.screen_of_tile()` 手工投影 —— 两条路必须给出同一个结果，
## 所以缩放系数只在 `MazeArt` 里存一份。

const TILE := MazeArt.TILE
const SQUASH := MazeArt.SQUASH

var map: MazeMap
var ground: TileMapLayer
var fog: FogOverlay
var room_labels: RoomLabels


func _ready() -> void:
	ground = TileMapLayer.new()
	ground.name = "Ground"
	ground.scale = Vector2(1.0, SQUASH)
	add_child(ground)

	fog = FogOverlay.new()
	fog.name = "Fog"
	fog.z_index = 20
	add_child(fog)

	room_labels = RoomLabels.new()
	room_labels.name = "RoomLabels"
	room_labels.z_index = 24
	add_child(room_labels)


func setup(m: MazeMap) -> void:
	map = m
	_build_tile_set()
	_paint()
	fog.map = m
	room_labels.map = m
	refresh()


func _build_tile_set() -> void:
	var ts := TileSet.new()
	ts.tile_size = Vector2i(TILE, TILE)
	var src := TileSetAtlasSource.new()
	src.texture = MazeArt.atlas_texture()
	src.texture_region_size = Vector2i(TILE, TILE)
	for i in range(MazeArt.TILE_COUNT):
		src.create_tile(Vector2i(i, 0))
	ts.add_source(src)
	# 换关时旧的 tile_set 还挂在 layer 上，直接覆盖会留着上一关的图
	if ground.tile_set != null and ground.tile_set != ts:
		ground.tile_set.free()
	ground.tile_set = ts


func _paint() -> void:
	ground.clear()
	for y in range(map.tile_h):
		for x in range(map.tile_w):
			var t := Vector2i(x, y)
			var kind := int(map.tiles[y][x])
			var atlas := MazeArt.T_FLOOR
			match kind:
				MazeMap.Tile.WALL:
					atlas = MazeArt.T_WALL
				MazeMap.Tile.DOOR:
					var d := map.door_at(t)
					atlas = MazeArt.T_DOOR
					if d != null and d.locked and not d.open:
						atlas = MazeArt.T_DOOR_LOCKED
				_:
					atlas = _floor_variant(t)
			ground.set_cell(t, 0, Vector2i(atlas, 0))


## 地面选哪块砖：房间中央铺顶灯暖砖、沿中线铺黄标线、走廊类房间铺格栅。
func _floor_variant(t: Vector2i) -> int:
	var room := map.room_of_tile(t)
	if room == null:
		return MazeArt.T_HAZARD
	var local := t - room.origin
	# 横向中线一条黄标线（虚线砖自带断点），纵向给中央通道那一列
	if local.y == MazeMap.ROOM_H / 2:
		return MazeArt.T_FLOOR_LINE_H
	if local.x == MazeMap.ROOM_W / 2 and (room.gx == room.gy or room.name == "中央通道"):
		return MazeArt.T_FLOOR_LINE_V
	if absi(local.x - MazeMap.ROOM_W / 2) <= 1 and absi(local.y - MazeMap.ROOM_H / 2) <= 1:
		return MazeArt.T_FLOOR_WARM
	if room.name == "管道走廊" or room.name == "中央通道":
		return MazeArt.T_FLOOR_GRATE
	return MazeArt.T_FLOOR


## 迷雾 / 门色 / 房间名跟着探索状态刷新（不重建 TileMap，只重画覆盖层）
func refresh() -> void:
	if fog != null:
		fog.queue_redraw()
	if room_labels != null:
		room_labels.queue_redraw()


func refresh_door(t: Vector2i) -> void:
	var d := map.door_at(t)
	if d == null:
		return
	ground.set_cell(t, 0, Vector2i(MazeArt.T_DOOR if not d.locked or d.open else MazeArt.T_DOOR_LOCKED, 0))
	refresh()


# ============================ 战争迷雾覆盖层 ============================

class FogOverlay:
	extends Node2D
	## 没走过的房间整块涂黑。用世界坐标画矩形而不是 CanvasLayer 全屏遮罩：
	## 遮罩跟着相机走才对（缩放、平移时黑块必须还盖在原来那间房上）。

	var map: MazeMap

	func _draw() -> void:
		if map == null:
			return
		var th := float(MazeArt.TILE) * MazeArt.SQUASH
		for y in range(map.tile_h):
			for x in range(map.tile_w):
				var t := Vector2i(x, y)
				if map.tile_explored(t):
					continue
				var p := MazeArt.screen_of_tile(t)
				draw_rect(
					Rect2(p - Vector2(MazeArt.TILE * 0.5, th * 0.5), Vector2(MazeArt.TILE + 1.0, th + 1.0)),
					Color("#05070c"), true
				)
		# 已探/未探的交界描一圈暗蓝，避免"纯黑一刀切"看不出房间轮廓
		for r in map.rooms:
			var room: MazeMap.Room = r
			if room.explored:
				continue
			var c := MazeArt.screen_of_tile(room.center_tile())
			var w := float(MazeMap.ROOM_W) * MazeArt.TILE
			var h := float(MazeMap.ROOM_H) * MazeArt.TILE * MazeArt.SQUASH
			draw_rect(Rect2(c - Vector2(w, h) * 0.5, Vector2(w, h)), Color(0.06, 0.09, 0.15, 0.55), false, 2.0)


# ============================ 房间名牌 ============================

class RoomLabels:
	extends Node2D
	## 房间名只在探开后显示：没走过的地方连黑带字一起藏起来（零飘字口径）。

	var map: MazeMap
	var _font: Font

	func _ready() -> void:
		_font = load("res://assets/fonts/NotoSansSC.otf")

	func _draw() -> void:
		if map == null or _font == null:
			return
		for r in map.rooms:
			var room: MazeMap.Room = r
			if not room.explored:
				continue
			var p := MazeArt.screen_of_tile(room.origin + Vector2i(MazeMap.ROOM_W / 2, 0))
			var txt := room.name
			var size := 15
			var w := _font.get_string_size(txt, HORIZONTAL_ALIGNMENT_CENTER, -1, size).x
			draw_rect(Rect2(p + Vector2(-w * 0.5 - 7, -34), Vector2(w + 14, 20)), Color(0.03, 0.05, 0.09, 0.72), true)
			draw_string(_font, p + Vector2(-w * 0.5, -19), txt, HORIZONTAL_ALIGNMENT_CENTER, -1, size, Color("#9fb2c8"))
