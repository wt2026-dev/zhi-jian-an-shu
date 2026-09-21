extends Node
## 中文字体统一入口（autoload）。
##
## 踩过的坑（2026-09-21，页面全是豆腐块 □）：
##
## 1. `gui/theme/default_font` 只写在 `project.godot` 里 **不够** —— 挂到 `CanvasLayer`
##    下的 Control（HUD / 检修面板）拿不到这个 theme，中文全渲染成 □。
## 2. `get_viewport().theme = t` 同样没下透（实测截图仍是 □）。
##    ⇒ 稳定做法：给 **每个 Control 直接** `add_theme_font_override("font", f)`，
##      不依赖任何 theme 传播路径。
## 3. `load()` 返回非 null **不代表能渲染**：Web 导出若跑在 fallback/dummy
##    TextServer 上，FontFile 能加载但没有字形。所以这里把诊断写进 `diag`，
##    由 `main.gd` 的探针带出去，浏览器里一眼能看出是"没加载"还是"没字形"。

var font: FontFile = null
var diag: Dictionary = {}


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	font = load("res://assets/fonts/NotoSansSC.otf") as FontFile
	var ts := TextServerManager.get_primary_interface()
	var sample := "检修闯关"
	diag = {
		"fontLoaded": font != null,
		"textServer": ts.get_class() if ts != null else "",
		"sampleWidth": snappedf(font.get_string_size(sample, 16).x, 0.1) if font != null else -1.0,
		"asciiWidth": snappedf(font.get_string_size("ABCD", 16).x, 0.1) if font != null else -1.0,
	}
	# 中文 4 字按 16px 应该 ~64px 宽；若只有几个 px 说明字形没进栅格化器。
	print("[CJKFont] ", diag)


## 递归给 root 及其所有 Control 子节点打上中文字体。
## 每个小关 / 每台设备的标签都是运行时 new 出来的，建完必须调一次。
func apply(root: Node) -> void:
	if font == null or root == null:
		return
	_apply_rec(root)


func _apply_rec(n: Node) -> void:
	if n is Control:
		(n as Control).add_theme_font_override("font", font)
	for ch in n.get_children():
		_apply_rec(ch)
