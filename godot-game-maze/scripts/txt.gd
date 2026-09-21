class_name Txt
extends RefCounted
## JSON → 界面文本的唯一转换器。
##
## 为什么要有这个：GDScript 的 `String(v)` 强转在 4.7 上只吃字符串，遇到
## `Dictionary.get()` 返回的 null / int / float 会抛
## "Invalid call 'String' constructor" 并**中断当前函数**。本项目所有关卡内容
## 都来自 `maze_payload.json`（`reading: null`、`degraded: null` 是设计的一部分，
## 台账里就有 9 处缺测点），所以一旦在渲染路径上踩到这个错，表现就是
## "点开设备没有面板"——没有崩溃弹窗，只有一片安静，最难查的那种。
## `str()` 也不安全：`str(null)` 会渲染成 `<null>`，那是把内部值念给评委听。


## 取一个要显示给人看的字符串；`null` → `fallback`（界面据此显示「未接入」）。
static func s(v, fallback: String = "") -> String:
	if v == null:
		return fallback
	if v is String:
		return v
	return str(v)
