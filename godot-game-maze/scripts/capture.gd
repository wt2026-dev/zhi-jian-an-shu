extends "res://scripts/main.gd"
## 目视验收产物（`godot --path godot-game-maze res://scenes/Capture.tscn`，**窗口模式**）。
##
## 为什么单独一个场景：`--headless` 下 viewport 是 dummy 驱动，抓出来的图全黑，
## 而"斜俯视工业风到底像不像"这件事没法靠断言证明 —— 只能存图给人看。
## headless 管"规则对不对"（SelfCheck），这里管"眼睛看到的对不对"。
##
## 走位全部走真实入口（`tap()` + `tick()`），一格一格点：黑格子点不动，
## 踩到门口两侧才亮 —— 所以图里的迷雾边界就是玩家走到那一步时看到的边界。
## 只有一处例外：`_reveal_all()` 把整图点亮，用来给评委看关卡全貌（锁门、钥匙卡位）。

const OUT_DIR := "res://_preview"
const DT := 1.0 / 30.0
## 单次走位的帧预算：9×9 最长通路 ~60 格、7 格/秒，留 4 倍余量
const MAX_FRAMES := 1500


func _ready() -> void:
	super()
	var raw := ""
	if FileAccess.file_exists("res://data/maze_payload.json"):
		raw = FileAccess.get_file_as_string("res://data/maze_payload.json")
	var parsed = JSON.parse_string(raw)
	if not (parsed is Dictionary):
		push_error("读不到 data/maze_payload.json，先跑 npx tsx scratch/dump_maze_payload.ts")
		get_tree().quit(1)
		return
	apply_payload(parsed)
	overlay.visible = false
	DirAccess.make_dir_recursive_absolute(OUT_DIR)
	await _shoot_all()
	print("CAPTURE DONE")
	get_tree().quit(0)


func _shoot_all() -> void:
	for idx in range(1, game.level_count() + 1):
		game.start_level(idx)
		_build_view()
		await _settle("shot_l%d_entry.png" % idx)
		var slot := _reachable_fault()
		if slot == null:
			continue
		await _reach(slot.tile)
		game.tap(slot.tile)
		await _settle("shot_l%d_walk.png" % idx)
		if int(game.phase) == MazeGame.Phase.READOUT:
			await _settle("shot_l%d_panel.png" % idx)
			game.begin_repair()
			var next := _next_correct_index()
			if next >= 0:
				game.click_part(next)
			panel.refresh_if_open()
			await _settle("shot_l%d_repair.png" % idx)
			game.close_panel()
			panel.close()
		if idx >= 3:
			_reveal_all()
			await _settle("shot_l%d_full.png" % idx)


## 挑一台"此刻就走得到"的故障设备：第 3、4 关有锁门，站在出生点不一定够得着。
func _reachable_fault() -> MazeMap.DeviceSlot:
	for entry in game.map.pending_faults():
		var slot: MazeMap.DeviceSlot = entry
		if not game.map.path(game.map.spawn_tile, slot.tile, game.keys).is_empty():
			return slot
	return null


## 一格一格地点到目标格。和自检里 `_reach` 同一套动作，只是中间要吐帧给渲染器。
func _reach(target: Vector2i) -> void:
	for hop in range(600):
		await _walk_until_idle()
		if game.engineer_tile == target:
			return
		if int(game.phase) == MazeGame.Phase.READOUT:
			game.close_panel()      # 路过别的设备把面板顶开了，关掉再走
			panel.close()
		if int(game.phase) != MazeGame.Phase.EXPLORE:
			return
		var p: Array = game.map.path(game.engineer_tile, target, game.keys)
		if p.is_empty():
			return
		game.tap(p[0])


func _walk_until_idle() -> void:
	var guard := 0
	while not game.pending_walk.is_empty() and guard < MAX_FRAMES:
		guard += 1
		_step(DT)
		await get_tree().process_frame


## 把所有房间点亮（只动迷雾位图，不碰规则状态）。
func _reveal_all() -> void:
	for r in game.map.rooms:
		game.map.explore_room((r as MazeMap.Room).id)
	map_view.refresh()
	device_layer.queue_redraw()
	hud.refresh()


## 下一张该点的操作牌（依据和玩家用眼睛判断时完全一样：seq 对上 repair_seq）。
func _next_correct_index() -> int:
	for i in range(game.repair_parts.size()):
		if int((game.repair_parts[i] as Dictionary).get("seq", -1)) == game.repair_seq:
			return i
	return -1


func _step(dt: float) -> void:
	game.tick(dt)
	engineer.set_tile(game.engineer_tile)
	engineer.set_walk(game.pending_walk)
	hud.refresh()
	panel.refresh_if_open()
	_follow_engineer()


## 稳定几帧再抓：脉冲光圈/迷雾重绘都在 queue_redraw 之后才落到 canvas item 上。
func _settle(file: String) -> void:
	for i in range(4):
		_step(DT)
		await get_tree().process_frame
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	var err := img.save_png(OUT_DIR + "/" + file)
	# 取样点落在主视图中央偏左（不是 HUD 面板上），全黑就是渲染没起来
	var px := img.get_pixelv(Vector2(360, 420))
	print("  · %-26s %s %dx%d 中央亮度 %.2f%s" % [
		file, "OK" if err == OK else "写盘失败(%d)" % err,
		img.get_width(), img.get_height(), px.v,
		" ← 全黑，说明没拿到真渲染" if px.v < 0.02 else ""
	])
