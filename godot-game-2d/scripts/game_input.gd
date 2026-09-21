extends Node

## 输入自动加载：唯一的"能不能动"开关。
##
## 为什么要有它：答题/开场白/结算时角色必须完全不能动。如果每个脚本各自
## 判断状态，漏一处就是"面板开着人还在跑"。集中到一个开关上，player.gd 只认这里。

var move_enabled := true


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS


func set_move_enabled(v: bool) -> void:
	move_enabled = v


func move_axis() -> float:
	if not move_enabled:
		return 0.0
	return Input.get_axis("move_left", "move_right")


func jump_just_pressed() -> bool:
	return move_enabled and Input.is_action_just_pressed("jump")


func jump_held() -> bool:
	return move_enabled and Input.is_action_pressed("jump")
