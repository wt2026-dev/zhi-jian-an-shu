extends Node
## 音效播放层（autoload：`SoundManager`）。合成逻辑在 `SoundKit`，这里只管发声。
##
## Web 自动播放策略：浏览器要求先有用户手势才允许出声，所以底噪不在 `_ready` 里硬起，
## 而是等第一次点击/按键（`note_user_gesture()`）之后再开 —— 否则 Chrome 直接静默丢弃，
## 表现就是"游戏没声音"，而这条在 headless 自检里是查不出来的。

var _players: Array = []
var _ambient_player: AudioStreamPlayer
var _ambient_on := false
var _gesture_seen := false
var _ambient_pending := false


func _ready() -> void:
	# 8 路复用：连续点设备、脉冲光圈同时触发时不至于把声音吃掉
	for i in range(8):
		var p := AudioStreamPlayer.new()
		p.name = "Sfx%d" % i
		add_child(p)
		_players.append(p)
	_ambient_player = AudioStreamPlayer.new()
	_ambient_player.name = "Ambient"
	_ambient_player.volume_db = -14.0
	add_child(_ambient_player)


func play(id: String, volume_db: float = 0.0) -> void:
	var wav := SoundKit.wave_for(id)
	if wav == null:
		return
	for p in _players:
		if p.playing:
			continue
		p.stream = wav
		p.volume_db = volume_db
		p.play()
		return


func play_click() -> void:
	note_user_gesture()
	play("click", -3.0)


func play_select() -> void:
	note_user_gesture()
	play("select", -4.0)


func play_success() -> void:
	play("ok", -2.0)


func play_fail() -> void:
	play("bad", -3.0)


func play_door_open() -> void:
	play("door", -2.0)


## 环境底噪：只在用户已经交互过之后才真正起播。
func start_ambient() -> void:
	if _ambient_on:
		return
	if not _gesture_seen:
		_ambient_pending = true
		return
	var wav := SoundKit.wave_for("ambient")
	if wav == null:
		return
	_ambient_player.stream = wav
	_ambient_player.play()
	_ambient_on = true


func stop_ambient() -> void:
	if _ambient_on:
		_ambient_player.stop()
		_ambient_on = false


func note_user_gesture() -> void:
	if _gesture_seen:
		return
	_gesture_seen = true
	if _ambient_pending:
		_ambient_pending = false
		start_ambient()


func status() -> Dictionary:
	return {"ambient": _ambient_on, "gesture": _gesture_seen}
