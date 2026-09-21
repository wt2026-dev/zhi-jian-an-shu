extends Node2D
## 《故障侦探 · 俯视迷宫》场景根：拼视图、转发点击、播音效、走关卡流程。
##
## 分工口径：所有"规则"都在 `MazeGame`（纯逻辑，可 headless 断言），
## 这一层只做三件事 —— 把点击换算成格子、把状态画出来、把事件变成声音与刷新。
## 数据只来自 React 的 `maze-data`；没数据时停在"等待接入"屏，不编设备。

const TILE := MazeArt.TILE

var game := MazeGame.new()
var cam: CameraRig
var map_view: MapView
var device_layer: DeviceLayer
var engineer: EngineerLayer
var hud: GameHud
var panel: DevicePanel
var panel_layer: CanvasLayer
var overlay: GameOverlay

var _has_data := false
var _running := false
var _payload: Dictionary = {}


func _ready() -> void:
	cam = CameraRig.new()
	cam.name = "Camera"
	add_child(cam)

	map_view = MapView.new()
	map_view.name = "MapView"
	add_child(map_view)

	device_layer = DeviceLayer.new()
	device_layer.name = "Devices"
	add_child(device_layer)

	engineer = EngineerLayer.new()
	engineer.name = "Engineer"
	add_child(engineer)

	hud = GameHud.new()
	hud.name = "Hud"
	add_child(hud)

	panel = DevicePanel.new()
	panel.name = "DevicePanel"
	panel.game = game
	# 必须挂在 CanvasLayer 上：直接挂在 Node2D 下的话它是**世界坐标**控件，
	# 相机一平移面板就跟着跑出屏幕（截图里它整块躲到了左边界外面）。
	# layer 20 < HUD 的 30，所以读数时顶栏/小地图/线索还看得见。
	panel_layer = CanvasLayer.new()
	panel_layer.name = "PanelLayer"
	panel_layer.layer = 20
	add_child(panel_layer)
	panel_layer.add_child(panel)
	panel.repair_requested.connect(_on_repair_requested)
	panel.part_pressed.connect(_on_part_pressed)
	panel.close_requested.connect(_on_panel_closed)

	overlay = GameOverlay.new()
	overlay.name = "Overlay"
	add_child(overlay)
	overlay.begin_pressed.connect(_on_begin)
	overlay.next_pressed.connect(_on_next_level)
	overlay.restart_pressed.connect(_on_restart)

	game.event.connect(_on_game_event)
	hud.bind(game)
	Bridge.payload_received.connect(_on_payload)
	overlay.show_wait()
	overlay.visible = true
	_post({"type": "maze-game", "event": "ready", "version": 1})


func _process(delta: float) -> void:
	if not _running or game.map == null:
		return
	game.tick(delta)
	engineer.set_tile(game.engineer_tile)
	engineer.set_walk(game.pending_walk)
	hud.refresh()
	panel.refresh_if_open()
	_follow_engineer()


## 相机不硬跟（上帝视角由人决定看哪儿），只在角色快走出视野时把它带回来。
func _follow_engineer() -> void:
	var p := MazeArt.screen_of_tile(game.engineer_tile)
	var half := get_viewport_rect().size * 0.5 / cam.zoom.x
	var box := Rect2(cam.global_position - half, half * 2.0).grow(36.0)
	if not box.has_point(p):
		cam.focus_on(p)


# ============================ 数据 ============================

func _post(payload: Dictionary) -> void:
	Bridge.post(payload)


func _on_payload(msg: Dictionary) -> void:
	if Txt.s(msg.get("type", "")) != "maze-data":
		return
	apply_payload(msg)


## 也给 Capture 场景直接喂数据用（`res://data/maze_payload.json` 是真实台账快照）。
## 生产场景不走这条路：Web 里没收到 `maze-data` 就一直停在等待屏，不自己编设备。
func apply_payload(msg: Dictionary) -> void:
	_payload = msg
	if not game.setup(msg):
		overlay.show_wait()
		overlay.visible = true
		return
	_has_data = true
	_build_view()
	overlay.show_brief(game.snapshot())
	overlay.visible = true
	_running = false
	_post({"type": "maze-game", "event": "data_accepted",
		"levels": game.level_count(), "devices": game.roster.size()})


func _build_view() -> void:
	map_view.setup(game.map)
	device_layer.setup(game.map)
	engineer.setup(game.map, game.engineer_tile)
	var w := float(game.map.tile_w) * TILE
	var h := float(game.map.tile_h) * TILE * MazeArt.SQUASH
	cam.fit(Rect2(0, 0, w, h))
	hud.refresh()


# ============================ 输入 ============================

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey or event is InputEventMouseButton:
		SoundManager.note_user_gesture()
	if not _running or game.map == null:
		return
	if panel.visible:
		return
	if not (event is InputEventMouseButton):
		return
	var mb := event as InputEventMouseButton
	if not mb.pressed or mb.button_index != MOUSE_BUTTON_LEFT:
		return
	# 世界坐标就是投影后的屏幕坐标，所以反投影只需一次除法
	var t := MazeArt.tile_of_screen(get_global_mouse_position())
	game.tap(t)


func _on_begin() -> void:
	overlay.visible = false
	_running = true
	SoundManager.start_ambient()
	SoundManager.play_select()
	cam.focus_on(MazeArt.screen_of_tile(game.engineer_tile))
	hud.refresh()


func _on_next_level() -> void:
	game.next_level()
	_build_view()
	overlay.show_brief(game.snapshot())
	_running = false
	SoundManager.play_select()


func _on_restart() -> void:
	if not _has_data:
		return
	apply_payload(_payload)
	SoundManager.play_select()


# ============================ 面板与修复 ============================

func _on_repair_requested() -> void:
	SoundManager.play_click()
	game.begin_repair()
	panel.refresh_if_open()
	hud.refresh()


func _on_part_pressed(index: int) -> void:
	game.click_part(index)
	panel.refresh_if_open()
	hud.refresh()


func _on_panel_closed() -> void:
	SoundManager.play_click()
	game.close_panel()
	panel.close()
	hud.refresh()


# ============================ 事件 → 音效 / 重绘 ============================

func _on_game_event(kind: String, data: Dictionary) -> void:
	match kind:
		"room_explored":
			# "唰"——迷雾散开：新开房间和开门共用这条音，语义上是同一件事
			SoundManager.play_door_open()
			map_view.refresh()
			hud.toast("探开：%s" % Txt.s(data.get("room_name", "")))
		"door_opened":
			SoundManager.play_door_open()
			map_view.refresh_door(data.get("tile", Vector2i.ZERO) if data.has("tile") else Vector2i.ZERO)
			map_view.refresh()
			hud.toast("门禁卡已使用", MazeArt.C_AMBER)
		"door_denied":
			SoundManager.play_fail()
			hud.toast("这扇门锁着", MazeArt.C_RED)
		"keycard_taken":
			SoundManager.play_select()
			hud.toast("捡到门禁卡", MazeArt.C_CYAN)
		"device_picked":
			SoundManager.play_click()
			hud.clear_toast()
			panel.open_device()
		"arrived":
			map_view.refresh()
		"blocked":
			SoundManager.play_fail()
		"repair_right":
			SoundManager.play_click()
		"repair_wrong":
			SoundManager.play_fail()
			hud.toast("点错操作件 -1 生命", MazeArt.C_RED)
			map_view.refresh()
		"repair_done":
			SoundManager.play_success()
			device_layer.queue_redraw()
			map_view.refresh()
			hud.toast("修复完成 +%d 分" % int(data.get("gained", 0)), MazeArt.C_GREEN)
		"spread":
			SoundManager.play_fail()
			device_layer.queue_redraw()
			hud.toast("故障扩散 -%d 分" % int(data.get("penalty", 0)), MazeArt.C_RED, 2.4)
		"level_done":
			_running = false
			SoundManager.play_success()
			var s := game.snapshot()
			_post({"type": "maze-game", "event": "level_done",
				"index": int(s.level_index), "score": int(s.score)})
			if game.phase == MazeGame.Phase.WIN:
				overlay.show_win(s)
			else:
				overlay.show_settle(s)
		"game_over", "time_out":
			_running = false
			SoundManager.play_fail()
			var over := game.snapshot()
			var reason := "三条生命都耗完了：点错操作件、空手撞锁门都会扣命。" \
				if kind == "game_over" else "倒计时归零，还有故障没处理。"
			overlay.show_over(over, reason)
		_:
			pass
