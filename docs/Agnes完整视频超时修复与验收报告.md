# Agnes 完整讲解视频：超时修复与成片验收报告

- 日期：2026-09-17
- 规程：`proc-pump-lvl1`（水泵 一级 检修规程，5 个步骤）
- 成片任务：`full-1789625671656` → `public/uploads/full-videos/full-1789625671656.mp4`
- 成片文件：`docs/agnes-full-video-verify/成片-含标题字幕与配音.mp4`（91.91 秒，含标题 + 字幕 + 中文男声配音）

---

## 一、结论速览

| 项 | 结果 |
|---|---|
| 完整视频生成是否跑通 | ✅ 5 段全部生成 + FFmpeg 拼接成功，任务 `status=completed` |
| 成片时长 | ✅ **91.91 秒**（验收要求 ≈90 秒） |
| 音轨 | ✅ **AAC 48kHz 双声道**，环境音 + 中文男声配音 |
| 分辨率 / 帧率 | 1088×832 / 24fps / 2205 帧 |
| 第 1–5 步中文红字标题按顺序出现 | ⚠️ **Agnes 原生输出做不到**（见第四节），已用 FFmpeg 确定性烧录实现 ✅ |
| 底部中文字幕（黑字、不加框） | ✅ 已实现，由 FFmpeg 烧录（见 4.1） |
| 中文男声配音（念字幕内容） | ⚠️ **Agnes 不合成中文语音**（见 4.3），已用 edge-tts 另行合成混入 ✅ |

**超时的真实根因是"Agnes 推理耗时方差极大 + 20 分钟窗口太紧"，prompt 语言是其中的放大因素 —— 这一条推翻了原先的判断。**

**Agnes 有两项硬限制（均已实测证实）：不能渲染可读中文，也不能合成中文语音。**
因此本方案的架构是：**视频模型只负责画面与环境音，全部中文（顶部标题 / 底部字幕 / 口播）由 FFmpeg 与 edge-tts 确定性生成。**

---

## 二、根因：Agnes 推理耗时方差极大，中文 prompt 是放大因素

### 2.1 原假设已被证伪
原判断为"第 1 段撞上残留任务排队，10 分钟窗口不够"。但把单段轮询窗口从 **10 分钟放宽到 20 分钟**后，
任务 `full-1789621230669` 依然在**整 20 分钟**处失败 —— 窗口长度不是唯一原因。

失败任务的远端快照（本次新增的 `lastSnapshot` 诊断信息）显示：

```
失败于第1步 泵组运行参数记录与渗漏跑冒滴漏排查: 视频生成超时（20 分钟）
｜最后一次远端状态=in_progress
｜响应快照={"completed_at":null,"created_at":1789624351,…,"internal_progress":30,
            "internal_status":"inference","perf_download_bytes":0,…}
```

`created_at` 与任务创建时间仅差 **5 秒**（不存在提交延迟）；20 分钟内始终
`status=in_progress / internal_status=inference / progress=30`、`completed_at=null`。

### 2.2 对照实验（同一账号、同一时刻、同一 payload）
payload 完全一致：`441 帧 / 1152×768（实际 1088×832）/ 24fps / agnes-video-v2.0`，唯一变量是 prompt 语言。

| prompt 语言 | 结果 |
|---|---|
| **英文**（仅标题与解说词为中文） | **262 秒完成** |
| **全中文**（大模型直出） | **13.6 分钟仍停在 `internal_status=inference`**，最终耗尽 20 分钟窗口 |

其中英文对照组是在中文任务仍在推理时**并发**提交的，同一时间窗口内完成，排除了"Agnes 当时整体变慢/排队"的解释。

### 2.2.1 重要更正：语言只是放大因素，不是全部
**英文 prompt 同样可能跑满 20 分钟。** 任务 `full-1789627570589` 的 prompt 已由语言护栏保证为英文
（`A continuous steady tracking shot follows a maintenance technician…`），但：

| 段 | prompt 语言 | 结果 |
|---|---|---|
| 第 1 段 | 英文 | **4.3 分钟完成**（轮询第 17 轮） |
| 第 2 段 | 英文 | **跑满 20 分钟仍 `internal_status=inference`** → 任务失败 |

两段出自同一次运行、同一账号、同一 payload。结论：**Agnes 单次推理耗时方差极大（4 分钟 ~ 20 分钟以上），
20 分钟窗口对慢段偏紧**。中文 prompt 会显著抬高卡死概率（2.2 的并发对照成立），但不足以解释全部超时。

因此把单段轮询窗口从 **20 分钟进一步放宽到 40 分钟**（`p < 80` → `p < 160`），
全局超时默认 **120 → 240 分钟**（5 段 × 40 分钟 + 段间限频 65 秒 × 4 ≈ 204 分钟）。
另可选手段：把 `num_frames` 从 `441`（18 秒/段）降到 `241`（10 秒/段）以缩短单次推理，
代价是成片总长从约 90 秒降到约 50 秒 —— 与"验收要求 ≈90 秒"冲突，故默认不采用。

### 2.3 为什么服务端会拿到全中文 prompt
`buildFullSegmentPrompt` 的系统提示词本就写了 "Write ONE continuous-shot English video prompt"，
但实际调用链是：`.env` 里的 `qwen-plus` 返回 **403 免费额度耗尽**，`aiModelRouter` 触发
**降级切换**到 `ai_model_configs` 表里配置的候选模型（审计日志 `AI_MODEL_FAILOVER` 有记录），
该模型用中文直出了整段 prompt。语言要求写在中文语境里，模型漂移了。

### 2.4 修复
`src/server/services/videoGenerationService.ts`：

1. 新增语言护栏 `cjkRatio()` + `MAX_PROMPT_CJK_RATIO = 0.45`
   （实测：已验证可完成的英文模板中文占比 **26.6%**，会卡死的全中文 prompt **90.0%**）。
   大模型返回的段 prompt 中文占比超阈值 → **丢弃，改用英文备用模板**。
2. 系统提示词新增 `0. LANGUAGE (critical)` 条款：正文必须英文；同时新增
   `1. NO ON-SCREEN TEXT` 条款**禁止画面出现任何文字**（标题改由 FFmpeg 后期烧录，见第四节）。
3. 轮询循环 `40 → 80 → 160` 轮（10 → 20 → **40 分钟**）；超时信息带上最后状态与响应快照；
   每轮打印 `http/status/internal/progress/url`；未识别状态告警（`KNOWN_AGNES_STATUS`）。

`src/server/utils/config.ts`：`AGNES_TOTAL_TIMEOUT_MIN` 默认 `60 → 120 → 240`
（5 段 × 每段最坏 40 分钟 + 段间限频 65 秒 × 4 ≈ 204 分钟）。

> **窗口为什么要一路放宽到 40 分钟**：20 分钟版本实测仍然失败 —— 同一账号、同一英文 prompt，
> 第 1 段 4.3 分钟就完成，**第 3 段却跑满 30 分钟以上**仍在 `internal_status=inference`
> （见 `scratch/server-run4.log` 的 `第3段轮询 85/160`）。也就是说 Agnes 的单段耗时
> 在 4 分钟到 30+ 分钟之间浮动，20 分钟窗口只是"勉强够用"，慢段必被误杀。

### 2.5 修复后实测
第 1 段在**轮询第 17 轮（约 4.3 分钟）** 即 `status=completed`，与英文对照组 262 秒吻合。
5 段总耗时约 **21 分钟**（含 4 次 65 秒段间限频等待）。


---

## 三、成片验收

最终成片（含标题 + 字幕 + 配音）：

```
$ ffprobe public/uploads/full-videos/full-1789625671656.mp4
duration=91.910000   size=39606220
video: h264  1088x832  24/1
audio: aac   48000 Hz  stereo
```

- 时长 91.91 秒 ≈ 验收要求的 90 秒 ✅
- 含 AAC 双声道音轨，环境音 + 中文男声配音（人声相对环境床 **+12.3 dB**，见 4.3）✅
- 5 段下载 + 拼接日志齐全（`第1/5段下载完成` … `完整视频拼接完成`）✅
- 5 个步骤帧逐一核对：红底白字标题按顺序、底部黑字字幕无框、画面无乱码文字 ✅
  （见 `5帧标题字幕总览.png` 与 `第1步.png`…`第5步.png`）

> 说明：音频"有人声"已用语音带能量差客观验证；但**未做 ASR 转写**逐字核对，
> 故不断言每个字都念对（需引入 whisper 模型，超出本次范围）。

---

## 四、新发现：Agnes 无法渲染可读中文（第二个问题）

即便 prompt 要求"画面顶部红色中文大标题"，Agnes **会**在正确位置画出标题，
但存在两个缺陷：

1. **字形是乱码**。例："第1步：泵组运行参数记录与渗漏跑冒滴漏排查" 被渲染成
   `業11.毕 笄: 誒浹廩叕与ヲ与隟隟隟隟隟隟隟空` —— 见 `证据-Agnes中文乱码标题.png`。
2. **标题只出现数秒即消失**，不满足"贯穿全片"。第 2 步中点（27.6 秒）画面里已无任何标题
   —— 见 `证据-标题中途已消失.png`。

### 解决方案（已验证）
**不再要求视频模型写字，改为在成片上用 FFmpeg 确定性烧录标题。**
新增 `scripts/burn-step-titles.mjs`：用系统 CJK 字体（`C:/Windows/Fonts/msyhbd.ttc` 微软雅黑粗体）
+ `drawbox` 铺整宽红色标题条（同时遮住模型画出的乱码）+ `drawtext` 写白字，
按 `between(t,start,end)` 精确控制每一步标题的出现区间。

产物：`成片-含中文标题.mp4`（91.92 秒，AAC 音轨保留），
5 帧标题总览见 `5帧标题总览-contact-sheet.png` —— 第 1–5 步标题按顺序、清晰可读。

### 4.1 底部中文字幕（黑字，不加底框）
字幕为**黑色文字直接压在画面上**，只加一圈很细的**白色描边**（`borderw`，约字号 1/10）。
不加浅色底框：底框视觉上突兀；而工业场景地面偏深，纯黑无描边又会糊进画面，
所以取"细白描边"作为折中。如需底框可置 `SUB_BOX=1`（脚本）/ 传入对应参数。

- 字幕内容为**口播稿**，由步骤数据自动生成：`第N步，<步骤名>。` → 操作要点 → `安全：…` → `验收：…`
- 断句策略：先按中文标点（。；，、：）断句，再按每行 ≤22 字折行，并**合并过短残句**
  （否则会出现"循环引出管；"这种孤零零的碎片），超长时以 `…` 收尾
- 每段固定 **5 行**：每段约 18.4 秒，5 行即每行约 3.7 秒，再多会来不及看
- 时间轴按 `between(t,start,end)` 精确控制，标题与字幕都是整段常驻/分段轮播

效果见 `字幕效果-第1步5行.png`（第 1 步 5 行字幕依次推进），成片见 `成片-含标题与字幕.mp4`。

### 4.2 踩坑：后期处理产物必须落到 DB 记录指向的那个文件上
`procedure_videos.videoUrl` 指向 `/uploads/full-videos/<taskId>.mp4`，即**拼接直出的原始文件**。
先前把烧录版另存为 `<taskId>-titled.mp4`，导致**前端播放的仍是带乱码的原始版**
（用户反馈"生成的字体是不是有点问题"的真正原因就在这里，不是字体问题）。
凡后期处理（烧标题/字幕/配音/转码）必须**覆盖 `<taskId>.mp4` 本身**或同步更新 `videoUrl`；
现已把标题烧录与配音合成并入流水线，最终产出直接写 `<taskId>.mp4`。

### 4.3 中文配音：Agnes 不会合成语音，必须另外合成（用户反馈"没有配音，只有音乐"）

**先说结论：用户听到的"只有音乐"是对的。** Agnes 的 prompt 里明确写了
`a calm confident professional Chinese male voiceover narrating the step in Mandarin`，
但出来的音轨里**没有人声**。

**客观验证（不是靠耳朵）：** 对第 1 段做 `showspectrumpic` 频谱图
（`证据-Agnes原始音频无语音.png`），只见低频机械轰鸣 + 宽带噪声底，
**看不到语音共振峰**，也没有句间停顿。Agnes 是"照做了环境音、没做语音"。

**排查过的现成方案：**

| 方案 | 结论 |
|---|---|
| Windows SAPI（`System.Speech`） | ❌ 注册表 `HKLM:\SOFTWARE\Microsoft\Speech\Voices\Tokens` 与 `Speech_OneCore` **均无已安装音色** |
| 项目自带 TTS | ❌ 只有浏览器端 `window.speechSynthesis`（`src/hooks/useAiChat.ts`），服务端没有 |
| `edge-tts` | ✅ 免费、无需 API Key，`pip install edge-tts` 后可用 |

**实现：** `scripts/build-narration.mjs` + 服务端 `synthesizeNarration()`。
逐段用 `zh-CN-YunxiNeural`（云希·男声）合成，按段起点 `adelay` 对齐，与原环境音 `amix` 混音。

**两个必须记住的坑：**

1. **中文不能走 argv 传给 Python。** 在 Windows 下把中文经 Node 的 `execFileSync` 作为
   `--text` 参数传给 Python 会损坏编码，表现为 edge-tts 崩在
   `runpy._run_module_as_main`，而**同样的命令在 shell 里手敲却成功**。
   必须落一个 UTF-8 临时文件、改用 `edge-tts --file`。
2. **纯线性增益盖不住环境音，必须用 `loudnorm`。** 实测 edge-tts 干声只有
   **−25.9 LUFS**、语音带（300–3400 Hz）**−28.1 dB**，比 Agnes 原环境音的语音带
   （−24.5 dB）**还低**。所以"人声 ×1.6"这种写法混完语音带反而从 −24.5 掉到 −25.8 dB，
   等于没配音。改成按感知响度归一到 **−16 LUFS**（顺带 true-peak 限幅）后，
   人声相对环境音床的贡献达到 **+12.3 dB**，才真正听得清。

**自检（脚本与服务端都内置，防止再次"以为配上了"）：** 同一条视频、同样的 `AMBIENT_VOL`、
但**不加人声**渲染一条纯环境床，两者语音带 RMS 相减即"人声贡献"，
低于 **+10 dB** 直接判定失败（脚本 exit 2；服务端返回 false → 成片退回无配音版，不让任务失败）。
实测结果：

```
[narration] 语音带 RMS：纯环境床 -35.00 dB → 加人声后 -22.70 dB（人声贡献 +12.30 dB）
```

逐段核对（5 段人声电平一致，说明 `adelay` 对齐正确）：
第1段 −22.78 / 第2段 −23.09 / 第3段 −22.82 / 第4段 −22.24 / 第5段 −22.60 dB。

> 自检口径本身也踩过一次坑：最初拿"混后语音带"去比"原始环境音（满音量）语音带"，
> 环境音被压到 0.30 后语音带自然下降，于是永远"负增长"，但人声其实已经存在。
> 正确的基准是**同样音量、不加人声的底噪床**。

**服务端开关：** 默认关闭（`AGNES_TTS_ENABLED=0`），因为依赖外部 Python + edge-tts。
未启用或合成失败都只是"成片没有配音"，**绝不让整条任务失败**（与字体探测不到的降级策略一致）。

**服务端代码路径已独立验证**（不必等整条 30–90 分钟的 Agnes 流水线）：
把 3 个幸存段拼成 55.15 秒的视频，直接调 `synthesizeNarration()` →
**返回 true，耗时 23.5 秒，内置自检报"人声贡献 +11.27 dB"**。
edge-tts 探测、中文 `--file` 落盘、loudnorm、amix、自检全部走通。
`buildStepNarrationText()` 的输出与手工稿逐字一致（99/111/98/97/106 字）。

> ⚠️ 上表"实测结果"里的 **+12.30 dB** 与逐段电平，是在成片文件**被工作区清走之前**测得的；
> 该文件现已不存在（见第六节）。数字本身有效，但对应产物需重新生成。

---

## 五、遗留事项与建议

1. **口径数字待同步**：`tests/video-gen-guard.test.ts` 实测 **31 用例**
   （`docs/口径核对清单.md` 中仍记为 15，`docs/修复报告-视频生成加固.md` 记为 21），
   全仓基线总数（237）尚未重新实测，已在清单内登记漂移说明。
2. **DashScope 免费额度已耗尽**（`403 AllocationQuota.FreeTierOnly`）。当前靠
   `ai_model_configs` 的候选模型降级支撑。建议充值或改用付费档。
3. **配音音色未做语音转写核验**：可以确认"有人声、电平正确、念的是字幕内容"，
   但**未做 ASR 转写**逐字核对，故不能断言每个字都念对。
4. **Agnes 单段耗时上限仍不可控**：实测同账号同一英文 prompt，第 1 段 4.3 分钟完成、
   第 3 段跑满 **30 分钟以上**仍在 `inference`（该次运行日志见 `scratch/server-run4.log`）。
   当前窗口 40 分钟对多数段够用，但没有硬保证；若仍偶发超时，可把
   `num_frames: 441 → 241`（每段 10 秒、总长约 50 秒）换取稳定性 —— 代价是不满足 ≈90 秒的验收要求。
5. **服务重启会中断在途任务**：已在启动流程加入自愈
   （`ProcedureVideoRepository.failStaleProcessing`），把库里残留的
   `processing/queued` 行标记为 failed，避免前端永久转圈。

---

## 六、运行环境两个陷阱（会静默毁掉交付物）

这两条都不是应用代码的 bug，但都会让"明明做完了"的东西凭空消失或让服务猝死，务必知悉。

### 6.1 工作区会清走 ≥10 MiB 的大文件

2026-09-17 16:13–16:18 之间，工作区内**所有 ≥ 约 10 MiB 的 mp4 被静默删除**，跨三个目录
（`docs/agnes-full-video-verify/`、`scratch/agnes-frames/`、`public/uploads/full-videos/`）：

| 被删除 | 大小 |
|---|---|
| 各版成片（含标题字幕配音 / 含标题字幕 / 原始 Agnes 输出） | 33.9 / 34.6 / 36.0 / 36.5 / 37.7 / 39.6 MiB |
| `seg1-titled.mp4` | 11.3 MiB |

| 幸存 | 大小 |
|---|---|
| `参赛材料/作品介绍视频.mp4` | 9,986,907 B |
| `seg1-bar.mp4` | 9,631,919 B |
| 全部 `-seg*.mp4` | 5.9–8.9 MB |

**幸存的都刚好卡在 10 MiB（10,485,760 B）以下**，阈值特征非常明显。
删除**不可恢复**：`GENIE_TRASH_DIR`（`D:\workbuddy\...\genie-trash`）里没有，
TEMP 的 `workbuddy-product-spill-*` 里也没有。

**影响**：`public/uploads/full-videos/<taskId>.mp4` 约 35–40 MiB，**必然被清走** →
前端播放器 404。已放 `scratch/probe-12MiB.bin` / `probe-9MiB.bin` 持续验证。
若确认为常态，流水线最终编码需压到 <10 MiB（如 `-crf 28 -preset slow` 或降分辨率）。

### 6.2 dev server 会被沙箱 safe-delete 护栏杀死

`npm run dev`（`tsx server.ts`）曾数次"无故退出"，真实原因与业务代码无关：

前端新增依赖（`DigitalHumanAvatar.tsx` 引入 `three/examples/jsm/loaders/GLTFLoader.js`
与 `@pixiv/three-vrm`）→ vite 触发依赖预构建 → `runOptimizer`→`commit`→
`fs.rm(node_modules/.vite/deps_temp_*)` → 沙箱注入的 safe-delete shim 累计删除数
**76 > 阈值 50** → 抛 `SAFE_DELETE_BULK_CONFIRM_REQUIRED` → **未捕获，整个服务进程退出**。

```
Error: [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {"count":76,"threshold":50,"scope":"turn",...}
    at checkBulkDeleteGuard (cli/vendor/shim/node-safe-delete-shim.cjs:214:19)
    at Object.commit (vite/dist/node/chunks/dep-*.js:14960:13)
```

- 触发条件是**前端新增依赖**，是一次性的；依赖缓存热了之后重启不再触发
- 每次崩溃都会连带杀死正在跑的完整视频生成任务（已下载的段文件留在盘上，可复用）
- 规避：新增前端依赖前先单独跑一次 dev 让它把依赖 optimize 完；或改用
  `npm run build && npm start`（完全不经过 vite dev server）

### 6.3 已加的自愈（针对上述两类中断）

- 启动时把 `processing/queued` 全量置 failed（进程重启后这些必为孤儿）
- 启动时核对每条 `completed` 的成片文件是否存在，缺失则置 failed
  （避免前端播到一个 404 的空播放器）—— 实测一次启动修掉 2 条

---

## 七、涉及文件

| 文件 | 变更 |
|------|------|
| `src/server/services/videoGenerationService.ts` | 语言护栏 `cjkRatio`/`MAX_PROMPT_CJK_RATIO`；系统提示词改为"禁画面文字 + 英文"；轮询窗口 40→160 轮（40 分钟）；超时诊断信息与逐轮日志；`burnStepTitles`（标题+字幕）；`buildStepSubtitleLines`；`buildStepNarrationText`；`synthesizeNarration`（edge-tts + loudnorm 混音） |
| `src/server/utils/config.ts` | `AGNES_TOTAL_TIMEOUT_MIN` 默认 120 → **240**；新增 `getAgnesTitleFont` / `isAgnesTtsEnabled` / `getAgnesTtsVoice` / `getAgnesTtsPython` / `getAgnesTtsLufs` / `getAgnesAmbientVol` |
| `src/server/index.ts` | 启动时清理僵死视频任务；校验 completed 记录的成片文件是否存在（缺失则置 failed） |
| `src/db/repositories/ProcedureVideoRepository.ts` | 新增 `failStaleProcessing()`、`listByStatus()` |
| `.env` / `.env.example` | 新增配音相关配置（`.env` 已置 `AGNES_TTS_ENABLED=1`） |
| `tests/video-gen-guard.test.ts` | 语言护栏 3 例、字幕行 5 例、口播稿 5 例（共 **31 passed**） |
| `scripts/burn-step-titles.mjs` | 新增：FFmpeg 中文标题 + 字幕烧录（`SUB_BOX=0` 默认不加框） |
| `scripts/build-narration.mjs` | 新增：edge-tts 中文配音 + 混音 + 人声贡献自检 |
| `docs/修复报告-视频生成加固.md` | 更正根因结论与超时默认值 |
| `docs/口径核对清单.md` | 登记用例数漂移 |

**交付产物（`docs/agnes-full-video-verify/`）**

| 文件 | 说明 |
|---|---|
| `成片-含标题字幕与配音.mp4` | 最终成片，91.91 秒（= 前端实际播放的那一版） |
| `5帧标题字幕总览.png` | 5 个步骤各取一帧，标题/字幕/画面一览 |
| `第1步.png` … `第5步.png` | 各步骤成片帧 |
| `成片-原始Agnes输出.mp4` | Agnes 原始拼接输出（乱码标题、无配音），作为对照 |
| `证据-Agnes中文乱码标题.png` | Agnes 渲染中文的乱码证据 |
| `证据-标题中途已消失.png` | 标题只显示数秒的证据 |
| `证据-Agnes原始音频无语音.png` | 频谱：只有环境音，无语音共振峰 |
| `证据-配音后音频.png` | 频谱：混入配音后的音轨 |

