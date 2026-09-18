# 机械臂 3D 模型 —— 开源归属与版权声明

| 文件名 | 模型标题 | 原作者（Sketchfab） | 来源链接 | 许可 |
| :--- | :--- | :--- | :--- | :--- |
| `6_axis_industrial_robot_arm.glb` | 6 Axis Industrial Robot Arm | **Jayson Stauffer** | https://sketchfab.com/3d-models/6-axis-industrial-robot-arm-3ecc74c22c584b2b8295f17dedcdb89f | CC BY 4.0 |

- 作者 / 来源 / 标题**提取自 GLB 文件自身的 `asset.extras`**（`generator = Sketchfab-15.42.0`），非人工推测。
- 用途：3D 车间 L2 产线的机械臂工作站阵列（`src/components/equipment3d/productionLine.ts`
  的 `initRobotGLB()`，共 4–6 台）。
- 加载策略：异步加载，就绪后**隐藏程序化机械臂几何**，避免新旧两套叠加；
  加载失败时保留程序化几何，不白屏。
- 性能处理：GLB 就绪后**关闭该模型投影阴影**（6 台 × GLB 材质，远观不可见，
  可省 shadow map 重算）。
- 未对网格拓扑、UV、材质做失真性修改；仅做 Box3 归一化与朝向校正。
