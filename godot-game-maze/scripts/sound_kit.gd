class_name SoundKit
extends RefCounted
## 程序化合成的音效素材工厂（纯计算，不碰音频总线、不建播放器）。
##
## 为什么不用音频文件：比赛现场要"咔 / 叮咚 / 嗡 / 唰 + 车间底噪"这五种声音，
## 找现成素材要么带版权要么中文环境下拉不到；而这些都是**包络 + 波形**算得出来的
## 非写实音色，直接按采样率合成 16bit PCM 塞进 `AudioStreamWAV`：
## 零外部依赖、几百 KB、而且能在 headless 自检里断言"有响度、不削顶、能无缝循环"。
##
## 播放侧在 `sound_manager.gd`（autoload），合成侧留在这里 —— 自检可以直接调静态函数。

const SAMPLE_RATE := 22050

## 每种声音的时长（秒）：自检按它核对采样数，改这里等于改验收口径。
const DURATIONS := {
	"click": 0.09,
	"select": 0.13,
	"ok": 0.42,
	"bad": 0.5,
	"door": 0.34,
	"ambient": 2.0,
}

static var _cache: Dictionary = {}


static func synth(id: String) -> PackedFloat32Array:
	match id:
		"click":
			return _tone_click()
		"select":
			return _tone_select()
		"ok":
			return _tone_ok()
		"bad":
			return _tone_bad()
		"door":
			return _tone_door()
		"ambient":
			return _tone_ambient()
		_:
			return PackedFloat32Array()


static func wave_for(id: String) -> AudioStreamWAV:
	if _cache.has(id):
		return _cache[id]
	var samples := synth(id)
	if samples.is_empty():
		return null
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.stereo = false
	wav.mix_rate = SAMPLE_RATE
	wav.data = _to_pcm16(samples)
	if id == "ambient":
		wav.loop_mode = AudioStreamWAV.LOOP_FORWARD
		wav.loop_begin = 0
		wav.loop_end = samples.size()
	_cache[id] = wav
	return wav


static func ids() -> Array:
	return DURATIONS.keys()


static func expected_samples(id: String) -> int:
	return int(SAMPLE_RATE * float(DURATIONS.get(id, 0.2)))


## 自检用：把 PCM16 还原成峰值与 RMS，判断"到底有没有声音 / 有没有削顶"。
static func analyze(data: PackedByteArray) -> Dictionary:
	var peak := 0.0
	var sum := 0.0
	var n := data.size() / 2
	for i in range(n):
		var s := int(data[i * 2]) | (int(data[i * 2 + 1]) << 8)
		if s >= 32768:
			s -= 65536
		var v := float(s) / 32768.0
		peak = maxf(peak, absf(v))
		sum += v * v
	return {"count": n, "peak": peak, "rms": sqrt(sum / float(maxi(1, n)))}


# ============================ 各音色的包络与波形 ============================

static func _tone_click() -> PackedFloat32Array:
	# "咔"：极短的高频阻尼振荡 + 一小撮噪声起手（点设备按钮的手感声）
	var n := expected_samples("click")
	var out := PackedFloat32Array()
	out.resize(n)
	for i in range(n):
		var t := float(i) / SAMPLE_RATE
		var env := exp(-t * 46.0)
		var v := sin(TAU * 1750.0 * t) * 0.62 + sin(TAU * 2650.0 * t) * 0.22
		v += _noise(i) * 0.35 * exp(-t * 90.0)
		out[i] = clampf(v * env, -1.0, 1.0) * 0.8
	return out


static func _tone_select() -> PackedFloat32Array:
	# 选中设备的轻"嗒"：比 click 低一点、带下滑，和"咔"区分开
	var n := expected_samples("select")
	var out := PackedFloat32Array()
	out.resize(n)
	var dur := float(DURATIONS["select"])
	for i in range(n):
		var t := float(i) / SAMPLE_RATE
		var f := lerpf(980.0, 640.0, t / dur)
		var env := exp(-t * 26.0)
		out[i] = clampf(sin(TAU * f * t) * env * 0.7, -1.0, 1.0)
	return out


static func _tone_ok() -> PackedFloat32Array:
	# "叮咚"上扬：A5 → E6 两个铃音，后者更亮更长
	var n := expected_samples("ok")
	var out := PackedFloat32Array()
	out.resize(n)
	for i in range(n):
		var t := float(i) / SAMPLE_RATE
		var a := _bell(t, 0.0, 880.0, 6.0)
		var b := _bell(t, 0.11, 1318.5, 5.0)
		out[i] = clampf((a * 0.7 + b * 0.85) * 0.72, -1.0, 1.0)
	return out


static func _bell(t: float, at: float, freq: float, decay: float) -> float:
	if t < at:
		return 0.0
	var d := t - at
	return sin(TAU * freq * d) * exp(-d * decay) \
		+ sin(TAU * freq * 2.0 * d) * exp(-d * decay * 1.9) * 0.22


static func _tone_bad() -> PackedFloat32Array:
	# 低沉"嗡"：110Hz 基 + 微失谐 112.5Hz 拍频，发闷但不刺耳（点错零件的反馈）
	var n := expected_samples("bad")
	var out := PackedFloat32Array()
	out.resize(n)
	for i in range(n):
		var t := float(i) / SAMPLE_RATE
		var env := minf(t * 24.0, 1.0) * exp(-t * 5.2)
		var v := sin(TAU * 110.0 * t) * 0.55 + sin(TAU * 112.5 * t) * 0.4
		v += sin(TAU * 220.0 * t) * 0.16
		out[i] = clampf(v * env, -1.0, 1.0) * 0.72
	return out


static func _tone_door() -> PackedFloat32Array:
	# 迷雾散开的"唰"：一阶低通噪声，截止频率随时间抬升
	var n := expected_samples("door")
	var out := PackedFloat32Array()
	out.resize(n)
	var dur := float(DURATIONS["door"])
	var prev := 0.0
	for i in range(n):
		var t := float(i) / SAMPLE_RATE
		var p := t / dur
		var env := sin(PI * clampf(p, 0.0, 1.0)) * 0.9
		prev += (_noise(i) - prev) * lerpf(0.06, 0.5, p)
		out[i] = clampf(prev * env * 1.7, -1.0, 1.0) * 0.5
	return out


static func _tone_ambient() -> PackedFloat32Array:
	# 车间底噪：50Hz 工频嗡鸣 + 二次/三次谐波 + 极慢幅调；末端与前段交叉淡化保证无缝循环
	var n := expected_samples("ambient")
	var out := PackedFloat32Array()
	out.resize(n)
	var dur := float(DURATIONS["ambient"])
	for i in range(n):
		var t := float(i) / SAMPLE_RATE
		var am := 0.72 + 0.28 * sin(TAU * t / dur)
		var v := sin(TAU * 50.0 * t) * 0.42
		v += sin(TAU * 100.0 * t) * 0.17
		v += sin(TAU * 150.0 * t) * 0.07
		v += (_noise(i) - 0.5) * 0.06
		out[i] = v * am * 0.5
	_crossfade_tail(out, int(SAMPLE_RATE * 0.08))
	return out


## 循环接缝处理：尾巴线性淡出的同时把开头等长一段淡入进来。
## 不做这步的话 50Hz 正弦在循环点相位跳变，听感就是每两秒"哒"一下。
static func _crossfade_tail(out: PackedFloat32Array, fade: int) -> void:
	var n := out.size()
	if n < fade * 2:
		return
	for i in range(fade):
		var w := float(i) / float(fade)
		var head := out[i]
		var tail_idx := n - fade + i
		out[i] = head * w + out[tail_idx] * (1.0 - w)
		out[tail_idx] = out[tail_idx] * w + head * (1.0 - w)


## 确定性伪随机（不用 randf）：同一种音效每次合成完全一致，
## 自检里"峰值 / 采样数"才钉得死，不会每次跑都飘。
static func _noise(i: int) -> float:
	var h := float((i * 1103515245 + 12345) & 0x7fffffff)
	return fmod(h / 65536.0, 1.0)


static func _to_pcm16(samples: PackedFloat32Array) -> PackedByteArray:
	var bytes := PackedByteArray()
	bytes.resize(samples.size() * 2)
	for i in range(samples.size()):
		var v := clampf(samples[i], -1.0, 1.0)
		var s := int(round(v * 32767.0))
		if s < 0:
			s += 65536
		bytes[i * 2] = s & 0xff
		bytes[i * 2 + 1] = (s >> 8) & 0xff
	return bytes
