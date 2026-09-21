class_name CameraRig
extends Camera2D
## 斜俯视"上帝视角"的相机：**WASD 是平移地图，不是控制角色走路**（产品口径第一条）。
## 角色由点击驱动走位，键盘只负责看地图 —— 这两件事分开，才不像横版跑酷。

const ZOOM_MIN := 0.55
const ZOOM_MAX := 1.9
const ZOOM_STEP := 0.12
## 世界像素/秒。除以 zoom 才是屏幕上的移动速度：拉近了自然就走得慢，手感才一致。
const PAN_SPEED := 640.0
const FAST_MULTIPLIER := 2.5

var bounds := Rect2(-200, -200, 2000, 1200)


func _ready() -> void:
	zoom = Vector2(0.92, 0.92)
	position_smoothing_enabled = false


## 地图铺好后按真实尺寸限制相机范围（不限制的话能一路平移到全是黑的地方的外面）
func fit(rect: Rect2) -> void:
	bounds = rect.grow(120.0)
	global_position = rect.get_center()
	_clamp()


func focus_on(p: Vector2) -> void:
	global_position = p
	_clamp()


func _process(delta: float) -> void:
	var dir := Vector2.ZERO
	if Input.is_action_pressed("pan_left"):
		dir.x -= 1.0
	if Input.is_action_pressed("pan_right"):
		dir.x += 1.0
	if Input.is_action_pressed("pan_up"):
		dir.y -= 1.0
	if Input.is_action_pressed("pan_down"):
		dir.y += 1.0
	if dir == Vector2.ZERO:
		return
	var speed := PAN_SPEED / zoom.x
	if Input.is_action_pressed("pan_fast"):
		speed *= FAST_MULTIPLIER
	global_position += dir.normalized() * speed * delta
	_clamp()


func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventMouseButton):
		return
	var mb := event as InputEventMouseButton
	if not mb.pressed:
		return
	if mb.button_index == MOUSE_BUTTON_WHEEL_UP:
		_set_zoom(zoom.x + ZOOM_STEP)
		get_viewport().set_input_as_handled()
	elif mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
		_set_zoom(zoom.x - ZOOM_STEP)
		get_viewport().set_input_as_handled()


func _set_zoom(v: float) -> void:
	zoom = Vector2(clampf(v, ZOOM_MIN, ZOOM_MAX), clampf(v, ZOOM_MIN, ZOOM_MAX))
	_clamp()


## 可见半幅要按 zoom 折算：zoom=2 时同一张地图在屏幕上只占一半，
## 还按未缩放的半幅夹的话，边缘房间会永远拉不进视野。
func _clamp() -> void:
	var half := get_viewport_rect().size * 0.5 / zoom.x
	var x0 := bounds.position.x + half.x
	var x1 := bounds.end.x - half.x
	var y0 := bounds.position.y + half.y
	var y1 := bounds.end.y - half.y
	var p := global_position
	if x1 > x0:
		p.x = clampf(p.x, x0, x1)
	else:
		p.x = (bounds.position.x + bounds.end.x) * 0.5
	if y1 > y0:
		p.y = clampf(p.y, y0, y1)
	else:
		p.y = (bounds.position.y + bounds.end.y) * 0.5
	global_position = p
