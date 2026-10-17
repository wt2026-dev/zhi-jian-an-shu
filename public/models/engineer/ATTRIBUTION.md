# 数字人（工程师）3D 模型 —— 开源归属与版权声明

| 文件名 | 模型标题 | 原作者（Sketchfab） | 来源链接 | 许可 |
| :--- | :--- | :--- | :--- | :--- |
| `worker_talk.glb` | Worker talk animation | **honved444** | https://sketchfab.com/3d-models/worker-talk-animation-620e27e5126f40d080c5d4bffab9eedb | CC BY 4.0 |
| `asian_worker.glb` | Middle Age Man (Rigged & Animated) | **Animator05** | 待补（Sketchfab 页面，下载时未保留原始链接） | CC BY 4.0 |
| `asian_worker_new.glb` | —（**不是模型**，见下） | 不适用 | 不适用 | 不适用 |
| `china_engineer.glb` | 中国男性工程师（静态，无骨骼无动画） | 待补（无内嵌元数据，见下） | 待补（据代码注释为腾讯混元3D 图生3D 生成，未核实到可引用页面） | 待补 |

- 作者 / 来源 / 标题**提取自 GLB 文件自身的 `asset.extras`**（`generator = Sketchfab-16.15.0`），非人工推测。
- ⚠️ `asian_worker.glb` 例外：该文件当前**不是合法 GLB**（2.6 KB，内容是 Sketchfab 网页
  HTML，属于下载失败残留），因此读不到 `asset.extras`。上表其作者/标题/许可
  **提取自该 HTML 里可见的真实信息**（Animator05 / Middle Age Man / CC Attribution），
  来源链接**未知，标"待补"**而不是编造一个 URL。重新下载到真正的 .glb 后，
  请以 `asset.extras` 为准复核本行。该文件目前也未被任何代码引用。
- ⚠️ `asian_worker_new.glb` 例外：该文件**同样不是合法 GLB**。实测 4,083 字节，magic 四字节为
  `BRAS`（而非 `glTF`），正文是 Sketchfab 网页 HTML（`... Newsfeed Models Collections Likes Purchases ...`）
  ⇒ 与 `asian_worker.glb` 属同一类**下载失败残留**，文件内没有任何模型内容，因此**不存在可署名的对象**。
  当前未被任何代码引用。处置建议：重新下载到真正的 `.glb`，或直接删除；不要为它编造作者/标题/许可。
- ⚠️ `china_engineer.glb` 例外：文件本身**合法**（glTF 2.0，78,286,340 字节），但 `asset.extras` 为 `null`，
  `generator = "Khronos glTF Blender I/O v4.0.43"` —— **没有任何内嵌的作者 / 许可 / 来源字段**，
  因此无法像 `worker_talk.glb` 那样从文件自身取署名。据 `src/components/digital-human/DigitalHumanGLB.tsx`
  头注释，它是**自有生成资产**（腾讯混元3D 图生3D），不是第三方下载件。上表按项目纪律标"待补"，
  **在核实到可引用的生成条款 / 页面之前不得填写具体作者名**（同 `lathe_machine.glb` 的处理方式）。
- ⚠️ **版本控制缺口（2026-10-17 实测）**：本目录下 `asian_worker.glb`、`asian_worker_new.glb`、
  `china_engineer.glb`、`face-texture.jpg` **均未被 git 跟踪**（`git ls-files public/models/engineer/`
  只列出 `ATTRIBUTION.md` 与 `worker_talk.glb`）。而 `DigitalHumanGLB.tsx` 在运行时确实请求
  `/models/engineer/china_engineer.glb` ⇒ **全新 clone 后数字人会静默降级为程序化安全帽小人**。
  这是"代码引用了一个不在仓库里的资产"，需要显式决策：入库（78 MB，需评估 Git LFS）或改为运行时缺失即降级并出告警。

- 用途：数字人"工程师形象"的写实 GLB 通道（`src/components/digital-human/DigitalHumanGLB.tsx`）。
- 备注：模型自带 talk 动画；与 `public/models/*.vrm`（VRoid 官方示例模型）是**两套独立通道**，
  VRM 的授权条款内嵌于各 `.vrm` 文件自身，需按其内嵌许可使用。
