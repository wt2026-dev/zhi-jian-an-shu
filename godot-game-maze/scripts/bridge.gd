extends Node
## React ↔ Godot 的唯一通道（autoload：`Bridge`）。
##
## 沿用 `godot-game-2d` 已跑通的"JS 数组 + 轮询 shift"方案，不给 window 挂回调：
## MessageEvent 是原生 JS 对象，跨 WebAssembly 边界取 .data 容易踩包装差异，
## 而"字符串进数组、Godot 每次 shift 一条"零编解码风险。
## 收发两端都由 export_presets.cfg 里注入的 `__godotInbox` / `__godotPost` 兜住。

signal payload_received(msg: Dictionary)

var _poll_accum := 0.0
var _posted := 0
var _received := 0


func _process(delta: float) -> void:
	_poll_accum += delta
	if _poll_accum < 0.1:
		return
	_poll_accum = 0.0
	_poll()


func _poll() -> void:
	if not OS.has_feature("web"):
		return
	var raw = JavaScriptBridge.eval(
		"(window.__godotInbox && window.__godotInbox.length) ? window.__godotInbox.shift() : ''"
	)
	if typeof(raw) != TYPE_STRING or Txt.s(raw).is_empty():
		return
	var parsed = JSON.parse_string(Txt.s(raw))
	if parsed is Dictionary:
		_received += 1
		payload_received.emit(parsed)


func post(payload: Dictionary) -> void:
	if not OS.has_feature("web"):
		return
	# JSON.stringify 的产物本身就是合法 JS 字面量，可直接塞进 eval
	JavaScriptBridge.eval("window.__godotPost(%s)" % JSON.stringify(payload))
	_posted += 1


func counters() -> Dictionary:
	return {"posted": _posted, "received": _received}
