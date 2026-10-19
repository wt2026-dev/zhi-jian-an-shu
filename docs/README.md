# docs/ 目录索引

> 文档体系精简版。已移除全部应试答辩速记、模拟提示词、预测清单及重复问卷，保留核心工程设计规格、系统落地与安全方案、以及历史技术演进记录。

## 目录分层

### 1. 核心设计与规格文档 (`docs/说明书重写/`)
系统完整的软件工程规格说明与用户手册：
- [1-功能需求说明书.md](file:///d:/%E5%AE%9E%E9%AA%8C/%E5%AE%9E%E9%AA%8C%E9%A1%B9%E7%9B%AE2/docs/%E8%AF%B4%E6%98%8E%E4%B9%A6%E9%87%8D%E5%86%99/1-%E5%8A%9F%E8%83%BD%E9%9C%80%E6%B1%82%E8%AF%B4%E6%98%8E%E4%B9%A6.md)
- [2-概要设计说明书.md](file:///d:/%E5%AE%9E%E9%AA%8C/%E5%AE%9E%E9%AA%8C%E9%A1%B9%E7%9B%AE2/docs/%E8%AF%B4%E6%98%8E%E4%B9%A6%E9%87%8D%E5%86%99/2-%E6%A6%82%E8%A6%81%E8%AE%BE%E8%AE%A1%E8%AF%B4%E6%98%8E%E4%B9%A6.md)
- [3-详细设计说明书.md](file:///d:/%E5%AE%9E%E9%AA%8C/%E5%AE%9E%E9%AA%8C%E9%A1%B9%E7%9B%AE2/docs/%E8%AF%B4%E6%98%8E%E4%B9%A6%E9%87%8D%E5%86%99/3-%E8%AF%A6%E7%BB%86%E8%AE%BE%E8%AE%A1%E8%AF%B4%E6%98%8E%E4%B9%A6.md)
- [4-数据库设计说明书.md](file:///d:/%E5%AE%9E%E9%AA%8C/%E5%AE%9E%E9%AA%8C%E9%A1%B9%E7%9B%AE2/docs/%E8%AF%B4%E6%98%8E%E4%B9%A6%E9%87%8D%E5%86%99/4-%E6%95%B0%E6%8D%AE%E5%BA%93%E8%AE%BE%E8%AE%A1%E8%AF%B4%E6%98%8E%E4%B9%A6.md)
- [5-界面设计书.md](file:///d:/%E5%AE%9E%E9%AA%8C/%E5%AE%9E%E9%AA%8C%E9%A1%B9%E7%9B%AE2/docs/%E8%AF%B4%E6%98%8E%E4%B9%A6%E9%87%8D%E5%86%99/5-%E7%95%8C%E9%9D%A2%E8%AE%BE%E8%AE%A1%E4%B9%A6.md)
- [6-用户操作手册.md](file:///d:/%E5%AE%9E%E9%AA%8C/%E5%AE%9E%E9%AA%8C%E9%A1%B9%E7%9B%AE2/docs/%E8%AF%B4%E6%98%8E%E4%B9%A6%E9%87%8D%E5%86%99/6-%E7%94%A8%E6%88%B7%E6%93%8D%E4%BD%9C%E6%89%8B%E5%86%8C.md)

### 2. 现行架构与试点工程方案
生产就绪、硬件对接与安全合规方案：
- [安全可信证据链.md](file:///d:/%E5%AE%9E%E9%AA%8C/%E5%AE%9E%E9%AA%8C%E9%A1%B9%E7%9B%AE2/docs/%E5%AE%89%E5%85%A8%E5%8F%AF%E4%BF%A1%E8%AF%81%E6%8D%AE%E9%93%BE.md) — 等保 2.0 视角下的安全防护与审计留痕
- [工业化演进与硬件对接方案.md](file:///d:/%E5%AE%9E%E9%AA%8C/%E5%AE%9E%E9%AA%8C%E9%A1%B9%E7%9B%AE2/docs/%E5%B7%A5%E4%B8%9A%E5%8C%96%E6%BC%94%E8%BF%9B%E4%B8%8E%E7%A1%AC%E4%BB%B6%E5%AF%B9%E6%8E%A5%E6%96%B9%E6%A1%88.md) — 工业网关、PLC/SCADA 与真实传感器对接方案
- [生产差距清单-试点部署.md](file:///d:/%E5%AE%9E%E9%AA%8C/%E5%AE%9E%E9%AA%8C%E9%A1%B9%E7%9B%AE2/docs/%E7%94%9F%E4%BA%A7%E5%B7%AE%E8%B7%9D%E6%B8%85%E5%8D%95-%E8%AF%95%E7%82%B9%E9%83%A8%E7%BD%B2.md) — 工业现场试点上线前的差距清单与实施方案
- [试点现场验收清单.md](file:///d:/%E5%AE%9E%E9%AA%8C/%E5%AE%9E%E9%AA%8C%E9%A1%B9%E7%9B%AE2/docs/%E8%AF%95%E7%82%B9%E7%8E%B0%E5%9C%BA%E9%AA%8C%E6%94%B6%E6%B8%85%E5%8D%95.md) — 现场部署前置检查、业务闭环演练与放行判据
- [技术债修复方案-godfile拆分与CRLF统一.md](file:///d:/%E5%AE%9E%E9%AA%8C/%E5%AE%9E%E9%AA%8C%E9%A1%B9%E7%9B%AE2/docs/%E6%8A%80%E6%9C%AF%E5%80%BA%E4%BF%AE%E5%A4%8D%E6%96%B9%E6%A1%88-godfile%E6%8B%86%E5%88%86%E4%B8%8ECRLF%E7%BB%9F%E4%B8%80.md) — 核心巨型文件（God-file）拆解路线与规范
- [产品落地证据清单.md](file:///d:/%E5%AE%9E%E9%AA%8C/%E5%AE%9E%E9%AA%8C%E9%A1%B9%E7%9B%AE2/docs/%E4%BA%A7%E5%93%81%E8%90%BD%E5%9C%B0%E8%AF%81%E6%8D%AE%E6%B8%85%E5%8D%95.md) — 真实部署落地证据与关键场景链路
- [数字人形象-诊断与选型.md](file:///d:/%E5%AE%9E%E9%AA%8C/%E5%AE%9E%E9%AA%8C%E9%A1%B9%E7%9B%AE2/docs/%E6%95%B0%E5%AD%97%E4%BA%BA%E5%BD%A2%E8%B1%A1-%E8%AF%8A%E6%96%AD%E4%B8%8E%E9%80%89%E5%9E%8B.md) — 数字人渲染与模型选型结论
- [敏感文件审计清单.md](file:///d:/%E5%AE%9E%E9%AA%8C/%E5%AE%9E%E9%AA%8C%E9%A1%B9%E7%9B%AE2/docs/%E6%95%8F%E6%84%9F%E6%96%87%E4%BB%B6%E5%AE%A1%E8%AE%A1%E6%B8%85%E5%8D%95.md) — 密钥与敏感配置审计

### 3. 指标与评测基线
- [AI效果评测基线.md](file:///d:/%E5%AE%9E%E9%AA%8C/%E5%AE%9E%E9%AA%8C%E9%A1%B9%E7%9B%AE2/docs/AI%E6%95%88%E6%9E%9C%E8%AF%84%E6%B5%8B%E5%9F%BA%E7%BA%BF.md) — 诊断、方案推荐与 RAG 评测指标
- [运营指标基线.md](file:///d:/%E5%AE%9E%E9%AA%8C/%E5%AE%9E%E9%AA%8C%E9%A1%B9%E7%9B%AE2/docs/%E8%BF%90%E8%90%A5%E6%8C%87%E6%A0%87%E5%9F%BA%E7%BA%BF.md) — MTBF/MTTR、工单流转与安全覆盖率定义

### 4. 历史归档与测试证据
- `docs/history/`：历次迭代缺陷修复、性能调优与单项验收报告
- `docs/equipment3d-shots/`：3D 数字孪生渲染与各视角断言快照
- `docs/agnes-full-video-verify/`：视频生成管线验收快照
- `docs/ratelimit-shots/`：高频限流与防暴力破解测试证据
