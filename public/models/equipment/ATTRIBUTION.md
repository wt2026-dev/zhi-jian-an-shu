# 工业设备 3D 模型 —— 开源归属与版权声明

本目录下的 10 个工业设备 GLB 模型用于 3D 数字化车间场景（L2 车间设备层）。
**全部为 CC BY 4.0（Creative Commons Attribution 4.0 International）**，允许免费商用、修改与再分发，
**前提是保留原作者署名** —— 因此本文件即为履行该署名义务的载体。

> **数据来源说明**：下表作者 / 来源 / 标题均**逐字提取自 GLB 文件自身的
> `asset.extras` 字段**（`author` / `license` / `source` / `title`），非人工推测。
> 复核脚本：`scratch/glb-meta.py`（读取 GLB 头部 JSON chunk 并打印 `asset`）。
> 如需重新核对，运行
> `C:/Users/26783/.workbuddy-ai/binaries/python/versions/3.13.12/python.exe scratch/glb-meta.py`。

## 一、署名清单

| 文件名 | 模型标题 | 原作者（Sketchfab） | 来源链接 | 许可 |
| :--- | :--- | :--- | :--- | :--- |
| `centrifugal_pump.glb` | CENTRIFUGAL PUMP \| BOMBA CENTRÍFUGA | **ENGIPROS** | https://sketchfab.com/3d-models/centrifugal-pump-bomba-centrifuga-a49b7e1567714040826fc6a24c4e8a7d | CC BY 4.0 |
| `double_suction_pump.glb` | CENTRIFUGAL PUMP WITH A DOUBLE SUCTION | **ENGIPROS** | https://sketchfab.com/3d-models/centrifugal-pump-with-a-double-suction-59e68f6a5cb341c9b517beaa6ad47fed | CC BY 4.0 |
| `electric_motor.glb` | Electric Motor | **Scarecrow_original** | https://sketchfab.com/3d-models/electric-motor-66b2ea9eb6e5468d91d814395036a537 | CC BY 4.0 |
| `electric_motor_high_poly.glb` | Electric Motor (high poly) | **Scarecrow_original** | https://sketchfab.com/3d-models/electric-motor-high-poly-048b9dc3095e44c0883b6b7944ad4916 | CC BY 4.0 |
| `exhaust_fan_motor.glb` | Low poly exhaust fan with motor | **anDDDres** | https://sketchfab.com/3d-models/low-poly-exhaust-fan-with-motor-dc2468a471164a618cee7d4f3f7db5dd | CC BY 4.0 |
| `hydraulic_press.glb` | hydraulicpressStation | **Bharath** (sketchfab.com/sneeky) | https://sketchfab.com/3d-models/hydraulicpressstation-60fa8fdc21844122abe535b0d21a4a95 | CC BY 4.0 |
| `lathe_machine.glb` | — （见下方"待补"说明） | **待补** | **待补** | **待确认** |
| `machinery_device_1.glb` | Machinery device | **maxpsr** | https://sketchfab.com/3d-models/machinery-device-2c908f435f7340b785fd1eb58c4fb0a8 | CC BY 4.0 |
| `machinery_device_2.glb` | Machinery device | **maxpsr** | https://sketchfab.com/3d-models/machinery-device-560748f914fd4209aa8437242fbfd3b8 | CC BY 4.0 |
| `milling_machine.glb` | Corded Milling Machine FREE | **LordSamueliSolo** | https://sketchfab.com/3d-models/corded-milling-machine-free-f5236fcf79ac40869f6f4bccb9155ef5 | CC BY 4.0 |

## 二、唯一"待补"项：`lathe_machine.glb`

该文件是**本目录中唯一没有内嵌授权元数据**的模型，无法从文件本身确认原作者。
客观事实（可复核）：

- `asset.generator` = `Khronos glTF Blender I/O v4.0.44`（即经 Blender 官方 glTF 导出器产出，
  **不是** Sketchfab 导出，因此没有 Sketchfab 的 `extras` 授权块）；
- `asset.copyright` 缺失，`asset.extras` 缺失；
- 节点名 `mesinbubut`（印尼语"车床"），网格名 `Cube.005`，材质名 `Material`，贴图名 `texture`。

> **处理方式（有意为之，不是遗漏）**：在拿到可核实的来源之前，本表**不填任何作者名**。
> 编造署名比"待补"更糟 —— CC BY 的署名义务要求信息**真实**，填一个假名字等于没履行义务，
> 且会把上游作者的权益转错给第三方。
>
> **补全方式（二选一）**：
> 1. 从模型获取渠道（下载页 / 购买记录 / 素材包清单）回填作者与来源链接；
> 2. 若无法确认来源，将该设备从 `EQUIPMENT_GLB_MAP`（`src/components/equipment3d/equipment.ts`）
>    中移除 —— 代码会自动回退到程序化几何，不影响场景可用性。

## 三、使用声明

- 模型加载进 Three.js 场景时经 **Box3 包围盒归一化**并做坐标原点对准，
  未对网格拓扑、UV、材质做失真性修改。
- 各模型原始尺度差异极大（实测包围盒：`milling_machine` 2.34×2.00×2.04 →
  `hydraulic_press` 425.16×592.94×358.00），**归一化是必需的**，不是可选项。
- 资产仅用于本系统内的设备数字化展示、工单巡检与状态监控。
- 加载失败时自动回退到程序化几何（见 `loadEquipmentGLB`），不阻塞场景渲染。

## 四、同仓库其他模型资产

本目录只覆盖"车间设备"。`public/models/` 下其余模型（机械臂、数字人）的署名见：
`public/models/robotarm/ATTRIBUTION.md`、`public/models/engineer/ATTRIBUTION.md`。
