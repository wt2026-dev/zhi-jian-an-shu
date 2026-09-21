class_name RepairPanel
extends Control
## 按 E 弹出的检修面板：一台设备 = 三道小关（选工具 / 安全判断 / 排序题）。
##
## 题目内容**全部来自 React 侧传进来的真实规程**（`gameData.ts` 的 `MiniGame`），
## 这里只负责渲染和判定，不生成也不改写任何题目文本。
##
## 面板是"哑"的：只上报"这一小关答对了没有"，得分/生命/计时都由 `main.gd` 统一管，
## 免得两处各算一套分。

signal answered(correct: bool)
signal closed()

const KIND_TITLE := {
	"tool": "选工具",
	"safety": "安全判断",
	"order": "排序题",
}

var _steps: Array = []
var _step_idx := 0
var _device_name := ""
var _deadline_hint := ""

# 排序题：玩家已经点过的项（按下标记录，避免同名文本互相干扰）
var _picked: Array[int] = []

var _root: VBoxContainer
var _head: Label
var _progress: Label
var _title: Label
var _prompt: Label
var _body: VBoxContainer
var _feedback: Label
var _next_btn: Button
var _order_tip: Label
var _order_grid: VBoxContainer
var _choice_order: Array[String] = []   # 选工具题：按钮文字的屏幕顺序
var _locked := false


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false
	_build()


func _build() -> void:
	var dim := ColorRect.new()
	dim.color = Color(0.02, 0.03, 0.06, 0.62)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(dim)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(center)

	var card := PanelContainer.new()
	card.custom_minimum_size = Vector2(780.0, 470.0)
	card.add_theme_stylebox_override("panel", _card_style())
	center.add_child(card)

	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 26)
	margin.add_theme_constant_override("margin_right", 26)
	margin.add_theme_constant_override("margin_top", 20)
	margin.add_theme_constant_override("margin_bottom", 20)
	card.add_child(margin)

	_root = VBoxContainer.new()
	_root.add_theme_constant_override("separation", 10)
	margin.add_child(_root)

	var top := HBoxContainer.new()
	_head = Label.new()
	_head.add_theme_font_size_override("font_size", 17)
	_head.add_theme_color_override("font_color", Color("#e6eefb"))
	_head.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(_head)
	_progress = Label.new()
	_progress.add_theme_font_size_override("font_size", 15)
	_progress.add_theme_color_override("font_color", Color("#22d3ee"))
	top.add_child(_progress)
	_root.add_child(top)

	_root.add_child(HSeparator.new())

	_title = Label.new()
	_title.add_theme_font_size_override("font_size", 21)
	_title.add_theme_color_override("font_color", ArtFactory.C_AMBER)
	_root.add_child(_title)

	_prompt = Label.new()
	_prompt.add_theme_font_size_override("font_size", 18)
	_prompt.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_prompt.custom_minimum_size = Vector2(0.0, 56.0)
	_root.add_child(_prompt)

	_body = VBoxContainer.new()
	_body.add_theme_constant_override("separation", 8)
	_body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_root.add_child(_body)

	_feedback = Label.new()
	_feedback.add_theme_font_size_override("font_size", 15)
	_feedback.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_feedback.custom_minimum_size = Vector2(0.0, 44.0)
	_root.add_child(_feedback)

	_next_btn = Button.new()
	_next_btn.text = "继续"
	_next_btn.custom_minimum_size = Vector2(0.0, 44.0)
	_next_btn.add_theme_font_size_override("font_size", 17)
	_next_btn.add_theme_stylebox_override("normal", _btn_style(Color("#16223a")))
	_next_btn.add_theme_stylebox_override("hover", _btn_style(Color("#1f3252")))
	_next_btn.add_theme_stylebox_override("pressed", _btn_style(Color("#0e7490")))
	_next_btn.visible = false
	_next_btn.pressed.connect(_on_next)
	_root.add_child(_next_btn)
	# 面板是在运行时挂到 GameHUD(CanvasLayer) 下的，theme 传不过来 ⇒ 直接 override。
	CJKFont.apply(self)


func _card_style() -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.055, 0.086, 0.145, 0.97)
	sb.set_corner_radius_all(8)
	sb.border_width_left = 1
	sb.border_width_right = 1
	sb.border_width_top = 1
	sb.border_width_bottom = 1
	sb.border_color = Color("#243149")
	sb.shadow_color = Color(0, 0, 0, 0.5)
	sb.shadow_size = 18
	return sb


func _btn_style(bg: Color) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.set_corner_radius_all(8)
	sb.content_margin_left = 14.0
	sb.content_margin_right = 14.0
	sb.content_margin_top = 8.0
	sb.content_margin_bottom = 8.0
	sb.border_width_left = 1
	sb.border_width_right = 1
	sb.border_width_top = 1
	sb.border_width_bottom = 1
	sb.border_color = Color("#2b3a55")
	return sb


## 打开一台设备的检修面板。`steps` 为 `gameData.MiniGame` 原样数组。
func open(device_name: String, steps: Array, time_hint: String = "") -> void:
	_device_name = device_name
	_steps = steps
	_step_idx = 0
	_deadline_hint = time_hint
	visible = true
	_show_step()


func close() -> void:
	visible = false
	_steps = []
	emit_signal("closed")


func current_kind() -> String:
	if _step_idx >= _steps.size():
		return ""
	var s = _steps[_step_idx]
	return String(s.get("kind", "")) if s is Dictionary else ""


## 供验收脚本读取当前题目（题目文本 + 正确项），不参与任何判定
func snapshot() -> Dictionary:
	if _step_idx >= _steps.size():
		return {}
	var s: Dictionary = _steps[_step_idx]
	return {
		"stepIdx": _step_idx,
		"stepCount": _steps.size(),
		"kind": String(s.get("kind", "")),
		"prompt": String(s.get("prompt", "")),
		"options": s.get("options", []),
		"correct": String(s.get("correct", "")),
		"statement": String(s.get("statement", "")),
		"answer": s.get("answer", null),
		"items": s.get("items", []),
		"locked": _locked,
		"picked": _picked.duplicate(),
		# 两类题的按钮都是打乱过的，把"屏幕上第几个 → 原始第几个"报出去。
		# 不报的话外部脚本只能按原始数组下标盲点，命中率就是掷骰子 ——
		# 而且症状会被误读成"游戏判分有 bug"。
		"orderDisplay": _order_display(),
		"optionDisplay": _choice_order.duplicate(),
	}


## 排序题按钮在屏幕上的顺序（元素 = 该按钮对应的原始 items 下标）
func _order_display() -> Array:
	var out: Array = []
	if _order_grid == null:
		return out
	for c in _order_grid.get_children():
		if c is Button:
			out.append(int((c as Button).get_meta("item_index", -1)))
	return out


func _show_step() -> void:
	_locked = false
	_picked.clear()
	_feedback.text = ""
	_next_btn.visible = false
	# 先 remove_child 再 queue_free：queue_free 是延迟释放，只调它的话
	# 同名节点会在同一帧里共存，后面 get_node_or_null("Tip") 会拿到旧节点
	for c in _body.get_children():
		_body.remove_child(c)
		c.queue_free()
	_order_tip = null
	_order_grid = null

	if _step_idx >= _steps.size():
		return
	var s: Dictionary = _steps[_step_idx]
	var kind := String(s.get("kind", ""))
	_head.text = "%s%s" % [_device_name, ("　" + _deadline_hint) if _deadline_hint != "" else ""]
	var hints := {"tool": "（数字键作答）", "safety": "（Y / N 作答）", "order": "（按数字键依次作答）"}
	var hint: String = String(hints.get(kind, ""))
	_progress.text = "第 %d/%d 小关 · %s%s" % [
		_step_idx + 1, _steps.size(), String(KIND_TITLE.get(kind, kind)), String(hint)
	]
	_title.text = String(s.get("title", ""))
	_prompt.text = String(s.get("prompt", ""))

	match kind:
		"tool":
			_build_choices(_shuffled(s.get("options", [])), String(s.get("correct", "")))
		"safety":
			_build_safety(String(s.get("statement", "")))
		"order":
			_build_order(s.get("items", []))
		_:
			_prompt.text = "未知题型：%s" % kind
	# 每小关的按钮/标签都是这一帧 new 出来的，打乱后必须重新挂一次字体。
	CJKFont.apply(_body)


## 选项打乱：每次都重新洗，避免"第一个永远是答案"
func _shuffled(src: Array) -> Array:
	var out := src.duplicate()
	for i in range(out.size() - 1, 0, -1):
		var j := randi() % (i + 1)
		var t = out[i]
		out[i] = out[j]
		out[j] = t
	return out


func _build_choices(options: Array, correct: String) -> void:
	_choice_order.clear()
	for opt in options:
		var text := String(opt)
		_choice_order.append(text)
		var b := _make_button(text)
		b.pressed.connect(func() -> void: _judge(text == correct, "正确答案：%s" % correct))
		_body.add_child(b)


func _build_safety(statement: String) -> void:
	var box := PanelContainer.new()
	box.add_theme_stylebox_override("panel", _btn_style(Color("#101a2e")))
	var l := Label.new()
	l.text = statement
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("font_size", 17)
	box.add_child(l)
	_body.add_child(box)

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	var yes := _make_button("说法正确")
	yes.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var no := _make_button("说法错误")
	no.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(yes)
	row.add_child(no)
	_body.add_child(row)

	# 判定只认 React 传进来的 answer，不在这里猜
	var expect := true
	if _step_idx < _steps.size():
		expect = bool((_steps[_step_idx] as Dictionary).get("answer", true))
	yes.pressed.connect(func() -> void: _judge(true == expect, "该说法%s。" % ("正确" if expect else "错误")))
	no.pressed.connect(func() -> void: _judge(false == expect, "该说法%s。" % ("正确" if expect else "错误")))


func _build_order(items: Array) -> void:
	# 展示顺序打乱，正确顺序 = 原数组顺序
	var order := []
	for i in range(items.size()):
		order.append(i)
	order = _shuffled(order)

	_order_tip = Label.new()
	_order_tip.text = "按正确顺序依次点击（已点 0/%d）" % items.size()
	_order_tip.add_theme_font_size_override("font_size", 14)
	_order_tip.add_theme_color_override("font_color", Color("#7f92ad"))
	_body.add_child(_order_tip)

	_order_grid = VBoxContainer.new()
	_order_grid.add_theme_constant_override("separation", 6)
	_body.add_child(_order_grid)
	for idx in order:
		var text := String(items[idx])
		var b := _make_button(text)
		b.set_meta("item_index", idx)
		b.pressed.connect(func() -> void: _on_order_click(int(idx), items))
		_order_grid.add_child(b)


func _on_order_click(item_index: int, items: Array) -> void:
	if _locked:
		return
	if item_index in _picked:
		return
	_picked.append(item_index)
	if _order_tip != null:
		_order_tip.text = "按正确顺序依次点击（已点 %d/%d）" % [_picked.size(), items.size()]
	# 把已点的按钮标成青色，给玩家反馈
	if _order_grid != null:
		for b in _order_grid.get_children():
			if b is Button and int(b.get_meta("item_index")) == item_index:
				b.add_theme_stylebox_override("normal", _btn_style(Color("#0e7490")))

	if _picked.size() < items.size():
		# 中途点错立刻判错，不用等全点完（否则玩家要返工整题）
		if _picked[_picked.size() - 1] != _picked.size() - 1:
			_judge(false, "正确顺序：" + _join_items(items))
		return

	var ok := true
	for i in range(_picked.size()):
		if _picked[i] != i:
			ok = false
			break
	_judge(ok, "正确顺序：" + _join_items(items))


func _join_items(items: Array) -> String:
	var parts: Array[String] = []
	for it in items:
		parts.append(String(it))
	return " → ".join(parts)


func _make_button(text: String) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(0.0, 46.0)
	b.add_theme_font_size_override("font_size", 16)
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	b.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	b.add_theme_stylebox_override("normal", _btn_style(Color("#16223a")))
	b.add_theme_stylebox_override("hover", _btn_style(Color("#1f3252")))
	b.add_theme_stylebox_override("pressed", _btn_style(Color("#0e7490")))
	return b


## 统一判定出口：答对/答错都锁住本题，等玩家点"继续"
func _judge(correct: bool, explain: String) -> void:
	if _locked:
		return
	_locked = true
	var s: Dictionary = _steps[_step_idx]
	var own_explain := String(s.get("explain", ""))
	_feedback.text = ("✔ " if correct else "✘ ") + (own_explain if own_explain != "" else explain)
	_feedback.add_theme_color_override(
		"font_color", ArtFactory.C_GREEN if correct else ArtFactory.C_RED
	)
	# 已判定后禁用所有选项按钮
	for c in _body.get_children():
		_disable(c)
	_next_btn.visible = true
	_next_btn.grab_focus()
	emit_signal("answered", correct)


func _disable(node: Node) -> void:
	if node is Button:
		(node as Button).disabled = true
	for c in node.get_children():
		_disable(c)


func _on_next() -> void:
	_step_idx += 1
	if _step_idx >= _steps.size():
		close()
		return
	_show_step()


# ---------------------------------------------------------------- 键盘作答
#
# 为什么要有：面板里的按钮是画在 canvas 上的 CanvasItem，不是 DOM 元素，
# 外部脚本没法"按文字找按钮点一下"。加上数字键/Y、N 之后，
# 键盘就能走完整套流程（真人玩也更顺手），端到端验收也不用去猜像素坐标。

func _input(event: InputEvent) -> void:
	if not visible or not (event is InputEventKey):
		return
	var k := event as InputEventKey
	if not k.pressed or k.echo:
		return

	if _locked:
		if _is_key(k, KEY_SPACE) or _is_key(k, KEY_ENTER) or _is_key(k, KEY_KP_ENTER):
			get_viewport().set_input_as_handled()
			_on_next()
		return

	var kind := current_kind()
	if kind == "safety":
		if _is_key(k, KEY_Y):
			get_viewport().set_input_as_handled()
			_pick_safety(true)
		elif _is_key(k, KEY_N):
			get_viewport().set_input_as_handled()
			_pick_safety(false)
		return

	var n := _digit_of(k)
	if n < 1:
		return
	get_viewport().set_input_as_handled()
	if kind == "tool":
		_pick_choice(n)
	elif kind == "order":
		_pick_order(n)


func _digit_of(k: InputEventKey) -> int:
	var c := k.keycode
	if c >= KEY_1 and c <= KEY_9:
		return c - KEY_1 + 1
	if c >= KEY_KP_1 and c <= KEY_KP_9:
		return c - KEY_KP_1 + 1
	return -1


## 选工具：第 n 个按钮（1-based，按屏幕上的顺序）
func _pick_choice(n: int) -> void:
	var b := _nth_button(_body, n)
	if b != null:
		b.pressed.emit()


## 安全判断：Y = 说法正确，N = 说法错误
func _pick_safety(yes: bool) -> void:
	var b := _nth_button(_body, 1 if yes else 2)
	if b != null:
		b.pressed.emit()


## 排序题：数字键点第 n 个按钮，按它自己记的原始下标去判定
func _pick_order(n: int) -> void:
	if _order_grid == null:
		return
	var b := _nth_button(_order_grid, n)
	if b == null:
		return
	var s: Dictionary = _steps[_step_idx]
	_on_order_click(int(b.get_meta("item_index")), s.get("items", []))


## 第 n 个按钮（1-based，按屏幕上的先后）。
## 必须**递归**找：安全判断题的两个按钮是套在 HBoxContainer 里的，
## 只扫一层 child 会拿到 null，表现就是"按了 Y/N 没反应"。
func _nth_button(root: Node, n: int) -> Button:
	var found := _collect_buttons(root)
	if n >= 1 and n <= found.size():
		return found[n - 1] as Button
	return null


func _collect_buttons(root: Node) -> Array:
	var out: Array = []
	var queue: Array = [root]
	while not queue.is_empty():
		var node: Node = queue.pop_front()
		for c in node.get_children():
			if c is Button:
				out.append(c)
			queue.append(c)
	return out


## 同时认 keycode 和 physical_keycode：Web 版偶尔只填其中一个。
func _is_key(k: InputEventKey, want: int) -> bool:
	return k.keycode == want or k.physical_keycode == want
