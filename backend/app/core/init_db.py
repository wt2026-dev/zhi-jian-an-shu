import asyncio
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from backend.app.core.database import engine, Base, AsyncSessionLocal
from backend.app.models.models import (
    EquipmentModel,
    WorkOrderModel,
    WorkOrderLogModel,
    UserModel,
    SafetyPermitModel,
    KnowledgeArticleModel,
    KnowledgeChunkModel,
)
from backend.app.core.security import get_password_hash
from backend.app.services.rag_service import chunk_document_text, rag_vector_store


INITIAL_EQUIPMENTS_SEED = [
    {
        "id": "eq-101",
        "code": "EQ-2024-PUMP-01",
        "name": "1# 离心主循环给水泵",
        "category": "泵类设备",
        "model": "KOBELCO KIS-300D",
        "workshop": "动力一车间",
        "location": "给水泵房 A 区 101# 机位",
        "install_date": "2021-03-15",
        "manufacturer": "神户制钢所机械株式会社",
        "status": "warning",
        "health_score": 78,
        "criticality": "关键核心",
        "telemetry": {
            "temperature": 78.5,
            "vibration": 4.8,
            "voltage": 382.4,
            "current": 46.2,
            "pressure": 1.62,
            "rpm": 2980,
            "loadRate": 86.5,
            "lastUpdated": "刚刚",
        },
        "specs": {
            "额定功率": "55 kW",
            "设计扬程": "85 m",
            "设计流量": "180 m³/h",
            "润滑脂牌号": "美孚 Mobilith SHC 220",
            "轴承型号": "SKF 6314-2Z/C3",
        },
        "maintenance_history": [],
        "next_inspection_date": "2026-09-10",
        "assigned_technician": "张建国 (高级技师)",
        "qr_code": "QR-EQ-PUMP-01",
    },
    {
        "id": "eq-102",
        "code": "EQ-2024-COMP-02",
        "name": "2# 无油螺杆空压机主机",
        "category": "压缩机",
        "model": "Atlas Copco ZR-250",
        "workshop": "动力一车间",
        "location": "压缩机房 B 区 202# 机位",
        "install_date": "2020-08-10",
        "manufacturer": "阿特拉斯·科普柯",
        "status": "running",
        "health_score": 94,
        "criticality": "关键核心",
        "telemetry": {
            "temperature": 68.2,
            "vibration": 1.6,
            "voltage": 380.1,
            "current": 125.0,
            "pressure": 0.78,
            "rpm": 1480,
            "loadRate": 74.0,
            "lastUpdated": "刚刚",
        },
        "specs": {
            "排气量": "42.5 m³/min",
            "主电机功率": "250 kW",
            "冷却方式": "水冷闭式循环",
        },
        "maintenance_history": [],
        "next_inspection_date": "2026-09-15",
        "assigned_technician": "李志强 (电气专工)",
        "qr_code": "QR-EQ-COMP-02",
    },
    {
        "id": "eq-103",
        "code": "EQ-2024-GEAR-03",
        "name": "3# 轧机主传动行星减速箱",
        "category": "传动减速机",
        "model": "SEW-Eurodrive P2.PS..082",
        "workshop": "重型热轧车间",
        "location": "主轧制线 3# 精轧机组侧",
        "install_date": "2019-11-20",
        "manufacturer": "SEW 工业减速机 (中国)",
        "status": "fault",
        "health_score": 58,
        "criticality": "关键核心",
        "telemetry": {
            "temperature": 91.3,
            "vibration": 7.4,
            "voltage": 381.0,
            "current": 210.5,
            "pressure": 0.45,
            "rpm": 980,
            "loadRate": 92.0,
            "lastUpdated": "刚刚",
        },
        "specs": {
            "额定扭矩": "128,000 N·m",
            "速比": "28.5",
            "润滑油容量": "420 L",
        },
        "maintenance_history": [],
        "next_inspection_date": "2026-09-05",
        "assigned_technician": "张建国 (高级技师)",
        "qr_code": "QR-EQ-GEAR-03",
    },
    {
        "id": "eq-104",
        "code": "EQ-2024-MOT-04",
        "name": "4# 10kV高压循环水主电机",
        "category": "大型电机",
        "model": "西门子 1LA4 500-4",
        "workshop": "公用工程车间",
        "location": "循环水池泵房配电间",
        "install_date": "2022-05-18",
        "manufacturer": "西门子电机 (中国)",
        "status": "running",
        "health_score": 96,
        "criticality": "主要生产",
        "telemetry": {
            "temperature": 54.1,
            "vibration": 0.9,
            "voltage": 10000.0,
            "current": 38.0,
            "rpm": 1495,
            "loadRate": 68.0,
            "lastUpdated": "刚刚",
        },
        "specs": {
            "额定电压": "10 kV",
            "额定功率": "630 kW",
            "绝缘等级": "F级",
        },
        "maintenance_history": [],
        "next_inspection_date": "2026-10-01",
        "assigned_technician": "王安全 (安全总监)",
        "qr_code": "QR-EQ-MOT-04",
    },
]

INITIAL_WORK_ORDERS_SEED = [
    {
        "id": "wo-20240902-001",
        "order_no": "WO-20260902-101",
        "title": "3# 轧机行星减速箱输入轴剧烈振动超标伴随高频金属摩擦异响抢修",
        "equipment_id": "eq-103",
        "equipment_name": "3# 轧机主传动行星减速箱",
        "equipment_code": "EQ-2024-GEAR-03",
        "workshop": "重型热轧车间",
        "fault_type": "机械振动",
        "priority": "urgent",
        "status": "in_progress",
        "creator": "巡检专工-孙巡检",
        "dispatcher": "车间主任-陈建平",
        "assignee": "张建国 (高级技师)",
        "assignee_id": "u-tech",
        "created_at": "2026/09/02 08:30:15",
        "dispatched_at": "2026/09/02 08:45:00",
        "accepted_at": "2026/09/02 08:50:30",
        "description": "在线监测显示输入侧高速轴垂直向振动达 7.4mm/s (报警阈值 4.5mm/s)，频谱见显著轴承外圈特征频率(BPFO)及高阶谐波，润滑油温攀升至91.3°C，需停机拆卸检查轴承及齿轮接触斑点。",
        "safety_requirements": [
            "必须实施高压 MCC 柜 LOTO 挂牌断电并验电确认",
            "热轧主产线联锁停机确认并挂禁止合闸标示牌",
            "液压管路泄压并安装机械防坠安全销",
            "高温设备冷却至 40°C 以下方可开始拆装",
        ],
        "photos": [],
        "repair_log": {
            "causeAnalysis": "高速轴承内圈跑套伴随滚子表面微点蚀疲劳损伤，引发偏心及高频共振。",
            "resolutionSteps": "1. 激光对中复核；2. 液压拆卸受损轴承；3. 轴颈微米级探伤并清洗轴承室；4. 采用感应加热器热装新SKF轴承；5. 加注极压润滑脂并试运转。",
            "partsUsed": [
                {
                    "id": "p1",
                    "name": "调心滚子轴承",
                    "code": "SKF 22324 CC/W33",
                    "spec": "重载标准件",
                    "qty": 1,
                    "unit": "套",
                    "unitPrice": 4850,
                },
                {
                    "id": "p2",
                    "name": "耐高温氟橡胶骨架油封",
                    "code": "FKM-TC 120*150*12",
                    "spec": "耐温200°C",
                    "qty": 2,
                    "unit": "件",
                    "unitPrice": 180,
                },
            ],
            "workHours": 3.5,
            "completionPhotos": [],
            "remark": "已完成激光同轴度校正，偏差小于 0.03mm。",
        },
        "acceptance": None,
        "version": 3,
    },
    {
        "id": "wo-20240902-002",
        "order_no": "WO-20260902-102",
        "title": "1# 离心给水泵前轴承箱油温异常偏高与端面机械密封微量滴漏",
        "equipment_id": "eq-101",
        "equipment_name": "1# 离心主循环给水泵",
        "equipment_code": "EQ-2024-PUMP-01",
        "workshop": "动力一车间",
        "fault_type": "轴承过热",
        "priority": "high",
        "status": "dispatched",
        "creator": "点检员-赵安全",
        "dispatcher": "车间主任-陈建平",
        "assignee": "张建国 (高级技师)",
        "assignee_id": "u-tech",
        "created_at": "2026/09/02 09:12:00",
        "dispatched_at": "2026/09/02 09:30:00",
        "description": "红外测温显示非驱动端轴承箱外壳温度达到 78.5°C，伴随静环端面微量冷凝水滴漏，疑似机封密封面轻微颗粒卡阻或弹簧比压失调。",
        "safety_requirements": [
            "进出口水阀关闭并锁死阀门手轮",
            "泵壳体内高压热水排净泄压",
            "穿戴耐酸碱防烫护目镜",
        ],
        "photos": [],
        "repair_log": None,
        "acceptance": None,
        "version": 2,
    },
    {
        "id": "wo-20240902-003",
        "order_no": "WO-20260901-089",
        "title": "2# 无油空压机空气滤清器差压超标与末级油气分离器定期维护保养",
        "equipment_id": "eq-102",
        "equipment_name": "2# 无油螺杆空压机主机",
        "equipment_code": "EQ-2024-COMP-02",
        "workshop": "动力一车间",
        "fault_type": "定期润滑维保",
        "priority": "low",
        "status": "completed",
        "creator": "维保主管-陈建平",
        "dispatcher": "车间主任-陈建平",
        "assignee": "李志强 (电气专工)",
        "assignee_id": "u-tech2",
        "created_at": "2026/09/01 14:00:00",
        "dispatched_at": "2026/09/01 14:10:00",
        "accepted_at": "2026/09/01 14:20:00",
        "completed_at": "2026/09/01 17:30:00",
        "accepted_by_inspector_at": "2026/09/01 18:00:00",
        "description": "空压机累计运行达 4000 小时例行周期保养，更换初效及高效空滤芯，复测冷却水流量与压缩级间温度。",
        "safety_requirements": ["空压机储气罐彻底排空余压", "电控箱主回路隔离"],
        "photos": [],
        "repair_log": {
            "causeAnalysis": "周期性粉尘堵塞引起的进气阻力上升。",
            "resolutionSteps": "更换原厂阿特拉斯滤芯两件，吹扫进气管道，重置运行倒计时计时器。",
            "partsUsed": [
                {
                    "id": "p3",
                    "name": "重型重载空气滤芯",
                    "code": "AC-1613-8004",
                    "spec": "无油专用",
                    "qty": 2,
                    "unit": "只",
                    "unitPrice": 1200,
                }
            ],
            "workHours": 2.5,
            "completionPhotos": [],
            "remark": "空载运转 30 分钟无漏气与异响，压差读数恢复绿色良级。",
        },
        "acceptance": {
            "inspectorName": "王安全 (安全总监)",
            "pass": True,
            "score": 5,
            "comment": "维保工艺符合规范，现场卫生整洁，设备各项参数恢复标准设计值。",
            "signatureDate": "2026/09/01",
        },
        "version": 4,
    },
]

INITIAL_USERS_SEED = [
    {
        "id": "u-admin",
        "username": "admin",
        "hashed_password": get_password_hash("password123"),
        "name": "陈建平",
        "role": "admin",
        "role_title": "总工/机电部长",
        "department": "生产机电保全部",
        "phone": "13800100001",
        "email": "chen.jp@plant.industry.cn",
        "is_active": True,
        "permissions": ["all"],
    },
    {
        "id": "u-manager",
        "username": "manager",
        "hashed_password": get_password_hash("password123"),
        "name": "陈主管",
        "role": "manager",
        "role_title": "车间维保主管",
        "department": "动力一车间",
        "phone": "13800100002",
        "email": "manager.chen@plant.industry.cn",
        "is_active": True,
        "permissions": ["dispatch", "safety_final_approval", "work_order_audit", "user_view"],
    },
    {
        "id": "u-tech1",
        "username": "tech1",
        "hashed_password": get_password_hash("password123"),
        "name": "张建国",
        "role": "technician",
        "role_title": "机电检修高级技师",
        "department": "机械维保一班",
        "phone": "13800100003",
        "email": "zhang.jg@plant.industry.cn",
        "is_active": True,
        "permissions": ["claim_order", "complete_order", "safety_apply"],
    },
    {
        "id": "u-inspector",
        "username": "inspector",
        "hashed_password": get_password_hash("password123"),
        "name": "赵安全",
        "role": "inspector",
        "role_title": "点检工程师 / 专职安全监护员",
        "department": "安全环保与设备质检科",
        "phone": "13800100004",
        "email": "zhao.safe@plant.industry.cn",
        "is_active": True,
        "permissions": ["inspection", "safety_guardian_approval", "qa_acceptance"],
    },
    {
        "id": "u-operator",
        "username": "operator",
        "hashed_password": get_password_hash("password123"),
        "name": "王操作",
        "role": "operator",
        "role_title": "现场生产岗位操作工",
        "department": "热轧重型车间",
        "phone": "13800100005",
        "email": "wang.op@plant.industry.cn",
        "is_active": True,
        "permissions": ["create_work_order", "scan_qr"],
    },
]

INITIAL_SAFETY_PERMITS_SEED = [
    {
        "id": "sp-101",
        "permit_no": "SP-20260902-01",
        "permit_type": "动火作业票",
        "risk_level": "极大风险 (Level 1)",
        "title": "3# 轧机主传动行星减速箱齿圈表面等离子电弧热喷涂补焊",
        "equipment_id": "eq-103",
        "equipment_name": "3# 轧机主传动行星减速箱",
        "workshop": "重型热轧车间",
        "location": "主轧制线 3# 精轧机组侧",
        "applicant": "张建国 (高级技师)",
        "applicant_dept": "机械维保一班",
        "applied_at": "2026/09/02 08:30:00",
        "valid_until": "2026/09/02 18:00:00",
        "status": "pending_approval",
        "precautions": [
            "动火作业点半径 10 米内易燃润滑油脂及棉纱必须彻底清理干净",
            "现场配备两具 8kg 磷酸铵盐干粉灭火器及灭火水带，保持消防水压正常",
            "必须办理 LOTO 停电上锁隔离，并实施机械传动制动闭锁",
        ],
        "loto_number": "LOTO-2026-0902-01",
        "hazards": ["高温飞溅灼伤", "易燃油气爆燃", "高温有害烟气吸入"],
        "safety_checklist": [
            {"id": "sc-1", "item": "作业区域周边 10m 内易燃杂物清除", "checked": True},
            {"id": "sc-2", "item": "消防灭火器材就位且压力指针在绿区", "checked": True},
            {"id": "sc-3", "item": "电焊机外壳有效接地，二次线绝缘良好", "checked": True},
            {"id": "sc-4", "item": "受限空间/易燃气体可燃度测试合格", "checked": False},
        ],
        "gas_test_results": {
            "oxygen": 20.9,
            "combustible_gas": 0.05,
            "toxic_gas": 0.0,
            "tester": "赵安全",
            "test_time": "2026/09/02 08:45:00",
        },
        "guardian_approval": {
            "signed": True,
            "name": "赵安全",
            "role": "现场专职安全监护员",
            "signedAt": "2026/09/02 08:50:00",
            "comment": "现场防火隔离帘布已铺设，气体检测仪读数正常合格，符合监护要求。",
            "gasTestPassed": True,
        },
        "supervisor_approval": None,
    },
    {
        "id": "sp-102",
        "permit_no": "SP-20260902-02",
        "permit_type": "受限空间作业票",
        "risk_level": "极大风险 (Level 1)",
        "title": "给水泵房地下蓄水廊道泥沙清淤与进水滤网防腐探伤",
        "equipment_id": "eq-101",
        "equipment_name": "1# 离心主循环给水泵",
        "workshop": "动力一车间",
        "location": "地下 -4.5m 进水涵洞",
        "applicant": "李志强 (电气专工)",
        "applicant_dept": "动力机电检修班",
        "applied_at": "2026/09/02 07:40:00",
        "valid_until": "2026/09/02 12:00:00",
        "status": "approved",
        "precautions": [
            "强制机械送风通风至少 30 分钟方可入内",
            "持续佩戴四合一便携式多气体检测报警仪",
            "必须系挂全身式安全带及防坠救生绳",
        ],
        "loto_number": "LOTO-2026-0902-02",
        "hazards": ["缺氧窒息", "硫化氢/一氧化碳中毒", "滑跌淹溺"],
        "safety_checklist": [
            {"id": "sc-1", "item": "进水管道阀门双重截止上锁并加盲板", "checked": True},
            {"id": "sc-2", "item": "轴流风机持续送风且风量满足规范", "checked": True},
            {"id": "sc-3", "item": "36V 安全电压防爆防潮照明灯", "checked": True},
            {"id": "sc-4", "item": "洞口双人警戒监护与对讲联络正常", "checked": True},
        ],
        "gas_test_results": {
            "oxygen": 21.0,
            "combustible_gas": 0.0,
            "toxic_gas": 0.0,
            "tester": "赵安全",
            "test_time": "2026/09/02 07:50:00",
        },
        "guardian_approval": {
            "signed": True,
            "name": "赵安全",
            "role": "现场专职安全监护员",
            "signedAt": "2026/09/02 08:00:00",
            "comment": "连续强制排风合格，多气体检测正常，救生三脚架绳索牢固。",
            "gasTestPassed": True,
        },
        "supervisor_approval": {
            "signed": True,
            "name": "陈主管",
            "role": "车间安全总监/主管",
            "signedAt": "2026/09/02 08:15:00",
            "comment": "安全前置措施完备，双人会签合格，核准作业。",
        },
    },
]

INITIAL_KNOWLEDGE_ARTICLES_SEED = [
    {
        "id": "kb-101",
        "title": "离心式给水泵滚动轴承与机械密封过热故障树分析与快速排除SOP",
        "category": "检修SOP规程",
        "target_equipment": "离心泵类",
        "tags": ["离心泵", "轴承发热", "机械密封", "振动超标", "国家规程"],
        "summary": "针对大型离心式给水泵非驱动端/驱动端轴承外壳温升超标（>75℃）与机封泄漏的故障树展开分析，涵盖润滑油劣化、动静环偏磨与同轴度超标处置步骤。",
        "content": """### 一、轴承箱温升超标排查 SOP 步骤
1. **测温复核**：使用双波段红外测温枪，复测轴承外壳及端盖温度。若温度持续攀升超过 80℃ 或温升速率 > 1℃/min，必须立即汇报调度减负荷或倒换备用泵；
2. **润滑状态诊断**：
   - 检查轴承箱视油镜油位，正常油位应保持在中心线 1/2 至 2/3 位置；
   - 观察润滑脂颜色，若呈现乳白色混浊，说明发生乳化进水；若呈灰黑色并伴有焦糊异味，说明润滑脂氧化变质结焦；
   - 补充注脂时切忌过量，滚动轴承内部空隙填充率以 1/3~1/2 为宜，过量注脂会导致搅拌摩擦生热；
3. **振动与轴对中复核**：
   - 使用激光对中仪测量电机与泵联轴器径向与角向跳动，径向公差要求 ≤0.05 mm；
   - 若出现 2X 工频振动，重点排查软脚与不对中。

### 二、机械密封微量滴漏处理规程
1. 正常机封泄漏量标准为 ≤3 滴/min；
2. 若泄漏呈持续水线，检查冷却冲洗水路压力（冲洗水压应高于密封腔压力 0.05~0.1 MPa）；
3. 停机拆检时，必须核对静环与动环端面平面度（光带检验 ≤0.0009 mm），严禁硬敲密封面。""",
        "author": "张建国 (高级技师)",
        "updated_at": "2026-09-01",
        "view_count": 142,
        "likes": 28,
        "file_type": "manual",
        "chunks_count": 3,
    },
    {
        "id": "kb-102",
        "title": "工业螺杆空压机主机排气高温与末级油气分离压差大处置指南",
        "category": "故障树分析",
        "target_equipment": "螺杆空压机",
        "tags": ["空压机", "排气高温", "油分压差", "阿特拉斯", "周期维保"],
        "summary": "详细阐述阿特拉斯无油及喷油螺杆空压机出现温度保护跳机、温控阀卡阻、热交换器结垢和油气分离滤芯压差超标时的诊断方法与零件更换规范。",
        "content": """### 螺杆空压机排气高温故障排查流程
1. **环境与通风核查**：确认空压机房环境温度低于 40℃，导风罩滤网无积灰柳絮堵塞；
2. **温控阀芯测试**：
   - 当油温达到 71℃ 时温控阀应开启，85℃ 时应全开旁路流向冷却器；
   - 若油冷却器进出口温差 < 3℃，判定温控阀内部热敏石蜡元件老化卡死在小循环位，需整套更换阀芯；
3. **油分芯压差判定**：
   - 监控机头控制屏上的油分压差（Delta P），标准允许压差为 ≤0.8 bar；
   - 超过 1.0 bar 必须更换油气分离器滤芯，否则主电机过载电流将增加 8%~12%，并存在静电摩擦引发腔内油雾爆燃的重大安全隐患。""",
        "author": "李志强 (电气专工)",
        "updated_at": "2026-08-28",
        "view_count": 96,
        "likes": 19,
        "file_type": "manual",
        "chunks_count": 2,
    },
    {
        "id": "kb-103",
        "title": "工业设备检修 LOTO 停电挂牌上锁与危险能量隔离安全规范 (GB/T 33579)",
        "category": "检修国家标准",
        "target_equipment": "通用机电设备",
        "tags": ["LOTO", "停电上锁", "零能量验证", "国家标准", "高危防护"],
        "summary": "符合 GB/T 33579-2017 机械安全危险能量控制标准，详细规范机电抢修前电气隔离、液压蓄能释放、机械闭锁与双人双锁流程。",
        "content": """### LOTO 六步安全锁定工作法
1. **作业准备与辨识**：由检修负责人核对设备位号与动力源图纸，辨识所有电气、气动、液压、重力位能；
2. **通知操作人员**：通知当班车间操作班长，经调度许可后开始停机；
3. **设备安全关停**：按下控制柜正常停机按钮，等待转子完全静止；
4. **能量隔离与阻断**：
   - 断开 MCC 柜总隔离开关手柄；
   - 关闭进出料高压阀门，插入物理机械盲板；
5. **挂牌上锁 (LOTO)**：
   - 每一位进入设备内部的作业人员必须在多孔安全锁夹上挂上自己的专属安全挂锁与生命警示标牌；
   - 严禁他人代锁或代解锁；
6. **零能量验证 (Zero Energy Verification)**：
   - 尝试按下就地启动按钮，验证设备不会转动；
   - 使用经校验合格的验电器对三相母线进行验电，确认无感应电或残留电压；
   - 泄放气动与液压蓄能器余压。""",
        "author": "陈建平 (总工程师)",
        "updated_at": "2026-08-15",
        "view_count": 310,
        "likes": 65,
        "file_type": "manual",
        "chunks_count": 3,
    },
]

async def init_database():
    """初始化建表及种子数据"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as session:
        # 1. 检查并初始化用户账号
        u_check = await session.execute(select(func.count(UserModel.id)))
        if u_check.scalar_one() == 0:
            for u in INITIAL_USERS_SEED:
                session.add(UserModel(**u))
            await session.commit()

        # 2. 检查并初始化设备数据
        eq_check = await session.execute(select(func.count(EquipmentModel.id)))
        if eq_check.scalar_one() == 0:
            for item in INITIAL_EQUIPMENTS_SEED:
                session.add(EquipmentModel(**item))
            await session.commit()

        # 3. 检查并初始化工单数据
        wo_check = await session.execute(select(func.count(WorkOrderModel.id)))
        if wo_check.scalar_one() == 0:
            for item in INITIAL_WORK_ORDERS_SEED:
                session.add(WorkOrderModel(**item))
            await session.commit()

        # 4. 检查并初始化安全作业票
        sp_check = await session.execute(select(func.count(SafetyPermitModel.id)))
        if sp_check.scalar_one() == 0:
            for sp in INITIAL_SAFETY_PERMITS_SEED:
                session.add(SafetyPermitModel(**sp))
            await session.commit()

        # 5. 检查并初始化知识库与向量切片
        kb_check = await session.execute(select(func.count(KnowledgeArticleModel.id)))
        if kb_check.scalar_one() == 0:
            for kb in INITIAL_KNOWLEDGE_ARTICLES_SEED:
                chunks = chunk_document_text(kb["content"], 500, 50)
                kb_copy = dict(kb)
                kb_copy["chunks_count"] = len(chunks)
                session.add(KnowledgeArticleModel(**kb_copy))
                
                for idx, c_text in enumerate(chunks):
                    session.add(KnowledgeChunkModel(
                        id=f"{kb['id']}_chunk_{idx}",
                        article_id=kb["id"],
                        chunk_index=idx,
                        text=c_text,
                        char_length=len(c_text),
                        metadata_json={"title": kb["title"], "category": kb["category"]},
                    ))
                rag_vector_store.add_chunks(kb["id"], kb["title"], kb["category"], chunks)
            await session.commit()

