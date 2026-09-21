class_name EngineerLayer
extends Node2D
## 工程师（俯视小人）与走位路径预览。
##
## 他是"点击驱动"的：点地面他走过去、走过去才把房间点亮。相机平移才归键盘 ——
## 两者分工写死在这一层，免得又长成横版跑酷那种"用角色撞设备"的玩法。

const TILE := MazeArt.TILE

var map: MazeMap
var walk: Array = []
var tile := Vector2i.ZERO
var facing := Vector2.RIGHT
var _bob := 0.0
var _moving := false


func _ready() -> void:
	z_index = 14


func setup(m: MazeMap, at: Vector2i) -> void:
	map = m
	tile = at
	walk = []
	queue_redraw()


func set_walk(path: Array) -> void:
	walk = path


func set_tile(t: Vector2i) -> void:
	if t != tile:
		facing = (MazeArt.screen_of_tile(t) - MazeArt.screen_of_tile(tile)).normalized()
	tile = t


func is_moving() -> bool:
	return not walk.is_empty()


func _process(delta: float) -> void:
	_moving = not walk.is_empty()
	_bob = fmod(_bob + delta * (7.0 if _moving else 1.6), TAU)
	queue_redraw()


func _draw() -> void:
	# 路径点：走之前先看清"要绕哪些门"，迷宫里没有比这更有用的反馈
	var i := 0
	for p in walk:
		i += 1
		var at := MazeArt.screen_of_tile(p)
		var a := 0.75 - float(i) / float(maxi(6, walk.size())) * 0.5
		draw_circle(at + Vector2(0, 2), 3.0, Color(MazeArt.C_CYAN.r, MazeArt.C_CYAN.g, MazeArt.C_CYAN.b, clampf(a, 0.18, 0.75)))
	if map != null and walk.is_empty():
		# 站立处一圈淡青：知道自己在整张图的哪一格
		draw_set_transform(MazeArt.screen_of_tile(tile) + Vector2(0, 4), 0.0, Vector2(1.0, 0.42))
		draw_arc(Vector2.ZERO, 15.0, 0, TAU, 28, Color(MazeArt.C_CYAN.r, MazeArt.C_CYAN.g, MazeArt.C_CYAN.b, 0.4), 1.5)
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	_draw_engineer(MazeArt.screen_of_tile(tile))


## 俯视小人：安全帽 + 反光背心，压扁的椭圆阴影托住，站在格子上而不是贴在图上
func _draw_engineer(foot: Vector2) -> void:
	var bob := sin(_bob) * (2.2 if _moving else 0.8)
	var c := foot + Vector2(0, -14 + bob)
	draw_set_transform(foot + Vector2(0, 4), 0.0, Vector2(1.0, 0.42))
	draw_circle(Vector2.ZERO, 11.0, Color(0, 0, 0, 0.45))
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	# 身体（背心）
	draw_rect(Rect2(c - Vector2(7, 2), Vector2(14, 16)), Color("#f97316"), true)
	draw_rect(Rect2(c - Vector2(7, 6), Vector2(14, 3)), Color("#fde68a"), true)
	# 肩带
	draw_line(c + Vector2(-4, 2), c + Vector2(-4, 13), Color("#fde68a"), 2.0)
	draw_line(c + Vector2(4, 2), c + Vector2(4, 13), Color("#fde68a"), 2.0)
	# 安全帽：俯视最显眼的就是这一圈
	draw_circle(c + Vector2(0, -6), 8.0, Color("#fbbf24"))
	draw_circle(c + Vector2(0, -7), 5.5, Color("#fde68a"))
	draw_line(c + Vector2(-8, -6), c + Vector2(8, -6), Color("#b45309"), 1.5)
	# 朝向指示（右手提工具箱）
	var box := c + facing * 11.0 + Vector2(0, 8)
	draw_rect(Rect2(box - Vector2(4, 3), Vector2(8, 6)), Color("#334155"), true)
	draw_rect(Rect2(box - Vector2(4, 3), Vector2(8, 6)), Color("#94a3b8"), false, 1.0)
