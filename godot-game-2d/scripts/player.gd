class_name Engineer
extends CharacterBody2D

## 检修工程师：黄安全帽 + 蓝工装的 2D 卡通角色。
##
## 锚点 = 脚底中心（y=0 就是地面），main.gd 用 `place_at(x, GROUND_Y)` 直接落位。
## 手感参数与 Web 版 `src/components/game/platformerEngine.ts` 对齐，
## 保证两边跳起来的高度是一致的（验收脚本会量）。

const SPEED := 300.0
const ACCEL := 2600.0
const FRICTION := 2800.0
const GRAVITY := 2000.0
const JUMP_V := -700.0
const JUMP_CUT := -260.0      # 松开跳跃键立刻压住上升速度 → 短跳
const MAX_FALL := 1500.0
const COYOTE := 0.09          # 离开地面后仍可起跳的宽限
const JUMP_BUFFER := 0.12     # 落地前提前按跳的缓冲

const BODY_W := 30.0
const BODY_H := 62.0

var frozen := true
var facing := "right"

var _sprite: AnimatedSprite2D
var _coyote := 0.0
var _buffer := 0.0
var _bob := 0.0


func _ready() -> void:
	_sprite = AnimatedSprite2D.new()
	_sprite.name = "Sprite"
	_sprite.sprite_frames = ArtFactory.engineer_frames()
	_sprite.position = Vector2(0.0, -BODY_H / 2.0)
	_sprite.play("idle_right")
	add_child(_sprite)

	var cs := CollisionShape2D.new()
	cs.name = "Shape"
	var rect := RectangleShape2D.new()
	rect.size = Vector2(BODY_W, BODY_H)
	cs.shape = rect
	cs.position = Vector2(0.0, -BODY_H / 2.0)
	add_child(cs)

	motion_mode = CharacterBody2D.MOTION_MODE_GROUNDED
	up_direction = Vector2.UP


func place_at(x: float, ground_y: float) -> void:
	global_position = Vector2(x, ground_y)
	velocity = Vector2.ZERO
	_coyote = 0.0
	_buffer = 0.0
	_play()


func set_frozen(v: bool) -> void:
	frozen = v
	# 唯一开关在 GameInput：答题/开场白/结算期间任何脚本都别想移动角色
	GameInput.set_move_enabled(not v)
	if frozen:
		velocity = Vector2.ZERO
		_play()


func _physics_process(delta: float) -> void:
	if frozen:
		velocity = Vector2.ZERO
		move_and_slide()
		return

	var axis := GameInput.move_axis()

	# 水平：加速/减速分开，避免"松键立刻停"的塑料感
	if absf(axis) > 0.01:
		velocity.x = move_toward(velocity.x, axis * SPEED, ACCEL * delta)
		facing = "left" if axis < 0.0 else "right"
	else:
		velocity.x = move_toward(velocity.x, 0.0, FRICTION * delta)

	# 垂直：重力 + 土狼时间 + 输入缓冲
	var grounded := is_on_floor()
	if grounded:
		_coyote = COYOTE
	else:
		_coyote = maxf(0.0, _coyote - delta)

	if GameInput.jump_just_pressed():
		_buffer = JUMP_BUFFER
	else:
		_buffer = maxf(0.0, _buffer - delta)

	if _coyote > 0.0 and _buffer > 0.0:
		velocity.y = JUMP_V
		_coyote = 0.0
		_buffer = 0.0

	# 松键截断上升
	if velocity.y < JUMP_CUT and not GameInput.jump_held():
		velocity.y = JUMP_CUT

	velocity.y = minf(velocity.y + GRAVITY * delta, MAX_FALL)
	move_and_slide()

	_bob += delta
	_play()


func _play() -> void:
	if _sprite == null:
		return
	var moving := (not frozen) and absf(velocity.x) > 12.0
	var anim := ("walk_" if moving else "idle_") + facing
	if _sprite.animation != anim:
		_sprite.play(anim)
	_sprite.speed_scale = 1.0 if moving else 0.6
	if frozen:
		_sprite.stop()
		_sprite.set_frame_and_progress(0, 0.0)


## 验收探针用：脚底离地高度（<0 表示在空中）
func air_height() -> float:
	return -global_position.y
