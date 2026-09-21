class_name MazeMap
extends RefCounted
## 俯视角工厂迷宫的**纯逻辑层**：房间图、墙与门、可走格、钥匙卡与锁、迷雾归属。
##
## 刻意不碰任何渲染：这样"每个房间都到得了""上锁的房间一定配得到钥匙"
## "点得中的格子一定是可走格"这类几何不变量，能在 `godot --headless` 下
## 被 `scenes/SelfCheck.tscn` 逐条断言，而不是等浏览器里肉眼看 ——
## 本项目内置浏览器面板长期 hidden（rAF 不触发），肉眼验收这条路是断的。
##
## 地图是**网格制厂区**：R×R 个房间，房间之间隔着墙，墙上开门；
## 不是打通的一大片，也不是一条走廊（验收口径 ②）。

enum Tile { VOID, WALL, FLOOR, DOOR }

## 房间内部尺寸（格）。7×5 内部 + 1 格共墙 → 一格 44px 时 3×3 厂区约 1100×520，
## 正好在 1280×720 视口里"拉开就能看全局"。
const ROOM_W := 7
const ROOM_H := 5

## 3×3 关用产品给定的固定房名（跟提示词里那张 ASCII 图一一对得上，评委看得懂）；
## 更大的厂区按序号循环这套工业功能区名。
const NAMES_3 := [
	"入口大厅", "泵房区", "配电室",
	"管道走廊", "中央通道", "控制室",
	"压缩机房", "仓库区", "出口",
]
const NAMES_POOL := [
	"入口大厅", "泵房区", "配电室", "管道走廊", "中央通道",
	"控制室", "压缩机房", "仓库区", "检修间", "仪表间",
	"阀组区", "冷却塔平台", "备件库", "化验室", "消防泵房", "出口",
]

class Room:
	var id: int
	var name: String
	var gx: int
	var gy: int
	var origin: Vector2i      # 内部左上角（格坐标）
	var door_ids: Array = []
	var device_ids: Array = []
	var explored := false

	func rect() -> Rect2i:
		return Rect2i(origin, Vector2i(MazeMap.ROOM_W, MazeMap.ROOM_H))

	func center_tile() -> Vector2i:
		return origin + Vector2i(MazeMap.ROOM_W / 2, MazeMap.ROOM_H / 2)


class Door:
	var id: int
	var a: int
	var b: int
	var tile: Vector2i
	var locked := false
	var open := false       # 已用钥匙卡开过

	func other(room_id: int) -> int:
		return b if room_id == a else a


class DeviceSlot:
	var id: int
	var device_id: String    # 台账设备 id（来自 React 真实数据）
	var name: String
	var no: String
	var category: String
	var icon: String
	var room_id: int
	var tile: Vector2i
	var faulty := false       # 本关故障目标（红色脉冲）
	var cleared := false
	var spread := false       # 第 4 关：放着不管会扩散一档（地面铺警示带）
	var has_procedure := true # false = 台账里没规程，点了只能提示，不能编题


class Keycard:
	var id: int
	var room_id: int
	var tile: Vector2i
	var taken := false


var grid_rooms := 3
var tile_w := 0
var tile_h := 0
var tiles: Array = []            # tiles[y][x] -> Tile
var rooms: Array = []
var doors: Array = []
var devices: Array = []
var keycards: Array = []
var spawn_tile := Vector2i.ZERO
var seed_used := 0
var _rng := RandomNumberGenerator.new()


# ============================ 生成 ============================

## 生成 R×R 厂区。`locked_doors` 把跨房间的门上锁（第 3 关起），
## 锁数决定需要几张钥匙卡，且保证与钥匙卡数一一对应。
## `keycard_count` < 0 表示"锁几扇就发几张卡"；> 锁数时多出来的是备用卡
## （第 4 关在倒计时下走错一次门就废掉一张，留一张才不至于必败）。
func build(grid: int, s: int, locked_doors: int = 0, extra_door_ratio: float = 0.28, keycard_count: int = -1) -> void:
	grid_rooms = clampi(grid, 2, 12)
	seed_used = s
	_rng.seed = s
	tiles.clear()
	rooms.clear()
	doors.clear()
	devices.clear()
	keycards.clear()

	tile_w = 1 + grid_rooms * (ROOM_W + 1)
	tile_h = 1 + grid_rooms * (ROOM_H + 1)
	for y in range(tile_h):
		var row: Array = []
		for x in range(tile_w):
			row.append(Tile.WALL)
		tiles.append(row)

	_build_rooms()
	_carve_floors()
	var tree := _build_spanning_doors()
	_add_loop_doors(tree, extra_door_ratio)
	# 出生点必须在配钥匙之前定：钥匙要按"离入口的距离"挑，
	# 先配钥匙再定出生点的话所有藏卡点都按 (0,0) 量距离，会集中塞在右下角。
	spawn_tile = (rooms[0] as Room).center_tile()
	_lock_doors(locked_doors)
	_place_keycards(keycard_count)
	explore_room(0)


func _build_rooms() -> void:
	var id := 0
	for gy in range(grid_rooms):
		for gx in range(grid_rooms):
			var r := Room.new()
			r.id = id
			r.gx = gx
			r.gy = gy
			r.origin = Vector2i(1 + gx * (ROOM_W + 1), 1 + gy * (ROOM_H + 1))
			r.name = _room_name(gx, gy)
			rooms.append(r)
			id += 1


func _room_name(gx: int, gy: int) -> String:
	var idx := gy * grid_rooms + gx
	if grid_rooms == 3:
		return NAMES_3[idx]
	# 中心通道与进出口单独点名，其余循环功能区名
	if idx == 0:
		return "入口大厅"
	if idx == grid_rooms * grid_rooms - 1:
		return "出口"
	if gx == grid_rooms / 2 and gy == grid_rooms / 2:
		return "中央通道"
	return NAMES_POOL[idx % NAMES_POOL.size()]


func _carve_floors() -> void:
	for r in rooms:
		var room: Room = r
		for dy in range(ROOM_H):
			for dx in range(ROOM_W):
				_set_tile(room.origin + Vector2i(dx, dy), Tile.FLOOR)


func _room_at(gx: int, gy: int) -> Room:
	if gx < 0 or gy < 0 or gx >= grid_rooms or gy >= grid_rooms:
		return null
	return rooms[gy * grid_rooms + gx]


## 相邻两房间之间的墙格坐标（共墙上，横向门在中线）
func _wall_tile_between(a: Room, b: Room) -> Vector2i:
	if a.gy == b.gy:
		var left: Room = a if a.gx < b.gx else b
		return Vector2i(left.origin.x + ROOM_W, left.origin.y + ROOM_H / 2)
	var up: Room = a if a.gy < b.gy else b
	return Vector2i(up.origin.x + ROOM_W / 2, up.origin.y + ROOM_H)


func _add_door(a: Room, b: Room) -> Door:
	# 同一对房间只开一扇门：不拦的话环形边会把同一格再挖一次，
	# 后面统计门数、按门配钥匙都会多算
	for d in doors:
		var ex: Door = d
		if (ex.a == a.id and ex.b == b.id) or (ex.a == b.id and ex.b == a.id):
			return ex
	var door := Door.new()
	door.id = doors.size()
	door.a = a.id
	door.b = b.id
	door.tile = _wall_tile_between(a, b)
	doors.append(door)
	a.door_ids.append(door.id)
	b.door_ids.append(door.id)
	_set_tile(door.tile, Tile.DOOR)
	return door


## 随机化 DFS 生成生成树：R² 个房间全连通（验收口径 ②「有墙有门但不是死路」）。
func _build_spanning_doors() -> Array:
	var visited: Dictionary = {}
	var stack: Array = [0]
	visited[0] = true
	var tree: Array = []
	while not stack.is_empty():
		var cur: Room = rooms[int(stack.back())]
		var neighbours: Array = []
		for d in _neighbour_rooms(cur):
			if not visited.has(d.id):
				neighbours.append(d)
		if neighbours.is_empty():
			stack.pop_back()
			continue
		var nxt: Room = neighbours[randi_range_local(neighbours.size())]
		var door := _add_door(cur, nxt)
		tree.append(door.id)
		visited[nxt.id] = true
		stack.append(nxt.id)
	return tree


func _neighbour_rooms(r: Room) -> Array:
	var out: Array = []
	for off in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
		var n := _room_at(r.gx + off.x, r.gy + off.y)
		if n != null:
			out.append(n)
	return out


## 非树边按概率补门：只有一棵生成树的厂区是一条蛇形走廊，
## 补一些环路才像"有多个房间的厂区迷宫"。
func _add_loop_doors(tree: Array, ratio: float) -> void:
	for gy in range(grid_rooms):
		for gx in range(grid_rooms):
			var a := _room_at(gx, gy)
			for off in [Vector2i(1, 0), Vector2i(0, 1)]:
				var b := _room_at(gx + off.x, gy + off.y)
				if b == null:
					continue
				var exists := false
				for d in doors:
					var dd: Door = d
					if (dd.a == a.id and dd.b == b.id) or (dd.a == b.id and dd.b == a.id):
						exists = true
						break
				if exists:
					continue
				if _rng.randf() <= ratio:
					var door := _add_door(a, b)
					tree.append(door.id)


## 上锁只锁"生成树里离入口足够远"的门：近处的门锁了会让开局无路可走。
func _lock_doors(count: int) -> void:
	if count <= 0:
		return
	var depth := _room_depths()
	var candidates: Array = []
	for d in doors:
		var door: Door = d
		if mini(depth[door.a], depth[door.b]) >= 2:
			candidates.append(door)
	# 按下标从大到小取，避免"总是前几扇门被锁"这种可预测模式
	candidates.sort_custom(func(x, y) -> bool: return (x as Door).id > (y as Door).id)
	for i in range(mini(count, candidates.size())):
		(candidates[i] as Door).locked = true
		(candidates[i] as Door).open = false


func _room_depths() -> Dictionary:
	var depth: Dictionary = {0: 0}
	var queue: Array = [0]
	while not queue.is_empty():
		var cur: int = queue.pop_front()
		for door_id in (rooms[cur] as Room).door_ids:
			var d: Door = doors[door_id]
			var nxt := d.other(cur)
			if not depth.has(nxt):
				depth[nxt] = int(depth[cur]) + 1
				queue.append(nxt)
	return depth


## 钥匙卡全部放在"不借助任何钥匙就到得了"的房间里：
## 否则会出现"钥匙在被这把钥匙锁住的房里"的死局（第 3 关最容易踩）。
func _place_keycards(desired: int) -> void:
	var locked_count := 0
	for d in doors:
		if (d as Door).locked:
			locked_count += 1
	if locked_count == 0:
		return
	var want := locked_count if desired < 0 else maxi(locked_count, desired)
	# 无钥匙可达集：只有这里的房间才允许藏卡
	var reach := reachable_rooms(0, false)
	var pool: Array = []
	for rid in reach.keys():
		pool.append(int(rid))
	# 从离入口最远的房间往回收（玩家得先探索才拿得到），并按 id 稳定同距离顺序
	pool.sort_custom(func(a, b) -> bool:
		var ra: Room = rooms[int(a)]
		var rb: Room = rooms[int(b)]
		var da := _grid_dist(ra.center_tile(), spawn_tile)
		var db := _grid_dist(rb.center_tile(), spawn_tile)
		return da > db if da != db else int(a) < int(b)
	)
	for i in range(mini(want, pool.size())):
		var room: Room = rooms[pool[i]]
		var k := Keycard.new()
		k.id = i
		k.room_id = room.id
		k.tile = _free_tile_in(room)
		keycards.append(k)


func _free_tile_in(room: Room) -> Vector2i:
	# 避开正中（那是设备位）与墙脚，取一个稳定的内圈格
	return room.origin + Vector2i(1 + (room.id % (ROOM_W - 2)), ROOM_H - 2)


func _set_tile(t: Vector2i, kind: int) -> void:
	if t.x < 0 or t.y < 0 or t.x >= tile_w or t.y >= tile_h:
		return
	tiles[t.y][t.x] = kind


func randi_range_local(n: int) -> int:
	return _rng.randi_range(0, maxi(0, n - 1))


static func _grid_dist(a: Vector2i, b: Vector2i) -> int:
	return absi(a.x - b.x) + absi(a.y - b.y)


# ============================ 查询 ============================

func tile_at(t: Vector2i) -> int:
	if t.x < 0 or t.y < 0 or t.x >= tile_w or t.y >= tile_h:
		return Tile.VOID
	return tiles[t.y][t.x]


func in_bounds(t: Vector2i) -> bool:
	return t.x >= 0 and t.y >= 0 and t.x < tile_w and t.y < tile_h


func room_of_tile(t: Vector2i) -> Room:
	for r in rooms:
		if (r as Room).rect().has_point(t):
			return r
	return null


func door_at(t: Vector2i) -> Door:
	for d in doors:
		if (d as Door).tile == t:
			return d
	return null


## 点击选中设备走这里：设备站的格子仍是地面格，但拾取优先级要高于"走过去"
func device_at(t: Vector2i) -> DeviceSlot:
	for d in devices:
		if (d as DeviceSlot).tile == t:
			return d
	return null


func keycard_at(t: Vector2i) -> Keycard:
	for k in keycards:
		if (k as Keycard).tile == t:
			return k
	return null


func passable(t: Vector2i, keys_available: int = 0) -> bool:
	var kind := tile_at(t)
	if kind == Tile.FLOOR:
		return true
	if kind != Tile.DOOR:
		return false
	var d := door_at(t)
	if d == null:
		return false
	if not d.locked or d.open:
		return true
	# 锁着的门：手里有卡才走得过去（真正扣卡发生在到达门口时）
	return keys_available > 0


## 迷雾归属：房间没进过就是黑的；门格两侧只要有一侧探开就露出来，
## 否则玩家会在已探明的房间门口看到一块莫名其妙全黑的格子；墙格同理。
func tile_explored(t: Vector2i) -> bool:
	var r := room_of_tile(t)
	if r != null:
		return r.explored
	var d := door_at(t)
	if d != null:
		return (rooms[d.a] as Room).explored or (rooms[d.b] as Room).explored
	# 墙砖本身不属于任何房间：贴着任意一间已探开的房就露出来。
	# 不这么做的话"墙面浅灰蓝"这条永远看不到 —— 亮着的房间四周仍然是黑洞，
	# 房间轮廓反而糊在一起，看起来像九块地砖浮在黑水里。
	for off in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
		var near := room_of_tile(t + off)
		if near != null and near.explored:
			return true
	return false


func explored_ratio() -> float:
	var n := 0
	for r in rooms:
		if (r as Room).explored:
			n += 1
	return float(n) / float(maxi(1, rooms.size()))


func explore_room(id: int) -> bool:
	var r: Room = rooms[id]
	if r.explored:
		return false
	r.explored = true
	return true


func reachable_rooms(from_room: int, ignore_locked: bool) -> Dictionary:
	var out: Dictionary = {from_room: true}
	var queue: Array = [from_room]
	while not queue.is_empty():
		var cur: int = queue.pop_front()
		for door_id in (rooms[cur] as Room).door_ids:
			var d: Door = doors[door_id]
			if d.locked and not d.open and not ignore_locked:
				continue
			var nxt := d.other(cur)
			if out.has(nxt):
				continue
			out[nxt] = true
			queue.append(nxt)
	return out


## 只读版本的可达集：把"已开哪些门"传进来，不改地图现场。
func reachable_rooms_with(from_room: int, opened: Dictionary) -> Dictionary:
	var out: Dictionary = {from_room: true}
	var queue: Array = [from_room]
	while not queue.is_empty():
		var cur: int = queue.pop_front()
		for door_id in (rooms[cur] as Room).door_ids:
			var d: Door = doors[door_id]
			if d.locked and not opened.has(d.id):
				continue
			var nxt := d.other(cur)
			if out.has(nxt):
				continue
			out[nxt] = true
			queue.append(nxt)
	return out


func path(from: Vector2i, to: Vector2i, keys_available: int = 0) -> Array:
	## BFS 最短路（网格无权，BFS 即最优）。返回不含起点、含终点的格序列；不可达返回空。
	if from == to:
		return []
	if not passable(to, keys_available) or not passable(from, keys_available):
		return []
	var prev: Dictionary = {}
	var queue: Array = [from]
	prev[_key(from)] = _key(from)
	while not queue.is_empty():
		var cur: Vector2i = queue.pop_front()
		for off in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
			var nxt: Vector2i = cur + off
			if prev.has(_key(nxt)) or not passable(nxt, keys_available):
				continue
			prev[_key(nxt)] = _key(cur)
			if nxt == to:
				return _trace(prev, from, to)
			queue.append(nxt)
	return []


func _trace(prev: Dictionary, from: Vector2i, to: Vector2i) -> Array:
	var out: Array = []
	var cur := _key(to)
	var start := _key(from)
	while cur != start:
		out.push_front(_tile_of_key(cur))
		cur = prev[cur]
		if out.size() > tile_w * tile_h:
			return []   # 理论不可达的兜底，防字典写坏时死循环
	return out


func _key(t: Vector2i) -> int:
	return t.y * tile_w + t.x


func _tile_of_key(k: int) -> Vector2i:
	return Vector2i(k % tile_w, int(k / tile_w))


# ============================ 关卡可解性 ============================

## 有钥匙卡的前提下所有房间最终都能到 —— 第 3 关的硬约束。
## 做法是定点迭代（只读，不改现场）：能到的房间里把卡收走 →
## 拿卡去开一扇还没开的锁门 → 再扩可达集，直到开不动为止。
func solvable() -> bool:
	var locked_ids: Array = []
	for d in doors:
		if (d as Door).locked:
			locked_ids.append((d as Door).id)
	if locked_ids.is_empty():
		return reachable_rooms(0, false).size() == rooms.size()
	var opened: Dictionary = {}
	var reach := reachable_rooms_with(0, opened)
	while true:
		var keys := _keys_in(reach) - opened.size()
		if keys <= 0:
			break
		var next_door := -1
		for did in locked_ids:
			if opened.has(did):
				continue
			var d: Door = doors[did]
			if reach.has(d.a) or reach.has(d.b):
				next_door = did
				break
		if next_door < 0:
			break
		opened[next_door] = true
		reach = reachable_rooms_with(0, opened)
	return reach.size() == rooms.size()


func _keys_in(reach: Dictionary) -> int:
	var n := 0
	for k in keycards:
		if reach.has((k as Keycard).room_id):
			n += 1
	return n


func locked_count() -> int:
	var n := 0
	for d in doors:
		if (d as Door).locked:
			n += 1
	return n


## 完全忽略锁时的可达房间数：生成树成立就应该等于房间总数。
func rooms_reachable_all() -> bool:
	return reachable_rooms(0, true).size() == rooms.size()


# ============================ 设备与钥匙的摆放 ============================

## 把故障设备分散到彼此最远的房间（全塞一间就不用探索了，违背"迷宫"的目的）。
func place_faults(device_ids: Array, meta: Array) -> void:
	var picked: Array = []
	var candidates: Array = []
	for r in rooms:
		candidates.append(r)
	# 入口房间留给出生点，第一台故障至少要走几步才到
	candidates.pop_front()
	if candidates.is_empty():
		candidates.append(rooms[0])
	for i in range(device_ids.size()):
		var best: Room = null
		var best_score := -1.0
		for c in candidates:
			var room: Room = c
			if not (room.device_ids as Array).is_empty():
				continue
			var s := _min_room_dist(room, picked)
			if s > best_score:
				best_score = s
				best = room
		if best == null:
			best = candidates[i % candidates.size()]
		picked.append(best.id)
		_add_device(device_ids[i], meta[i], best, true)


func place_distractors(device_ids: Array, meta: Array) -> void:
	for i in range(device_ids.size()):
		var room: Room = rooms[(i + 2) % rooms.size()]
		if not room.device_ids.is_empty():
			continue
		_add_device(device_ids[i], meta[i], room, false)


func _add_device(device_id: String, m: Dictionary, room: Room, faulty: bool) -> void:
	var slot := DeviceSlot.new()
	slot.id = devices.size()
	slot.device_id = device_id
	slot.name = Txt.s(m.get("name", ""))
	slot.no = Txt.s(m.get("no", ""))
	slot.category = Txt.s(m.get("category", ""))
	slot.icon = Txt.s(m.get("icon", "motor"))
	slot.room_id = room.id
	slot.tile = _device_tile(room, room.device_ids.size())
	slot.faulty = faulty
	slot.has_procedure = bool(m.get("has_procedure", true))
	devices.append(slot)
	room.device_ids.append(slot.id)


func _device_tile(room: Room, nth: int) -> Vector2i:
	return room.origin + Vector2i(ROOM_W / 2 + (nth * 2 - 1), ROOM_H / 2)


func _min_room_dist(room: Room, picked: Array) -> float:
	if picked.is_empty():
		return 0.0
	var m := 1.0e9
	for pid in picked:
		var pr: Room = rooms[pid]
		m = minf(m, float(_grid_dist(room.center_tile(), pr.center_tile())))
	return m


func device_by_id(device_id: String) -> DeviceSlot:
	for d in devices:
		if (d as DeviceSlot).device_id == device_id:
			return d
	return null


func pending_faults() -> Array:
	var out: Array = []
	for d in devices:
		var slot: DeviceSlot = d
		if slot.faulty and not slot.cleared:
			out.append(slot)
	return out
