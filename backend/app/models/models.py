from datetime import datetime
from sqlalchemy import (
    Column,
    String,
    Integer,
    Text,
    DateTime,
    JSON,
    ForeignKey,
    Index,
    Boolean,
)
from sqlalchemy.orm import relationship
from backend.app.core.database import Base

class EquipmentModel(Base):
    __tablename__ = "equipments"

    id = Column(String(64), primary_key=True, index=True)
    code = Column(String(64), unique=True, index=True, nullable=False)
    name = Column(String(128), nullable=False, index=True)
    category = Column(String(64), nullable=False)
    model = Column(String(64), nullable=False)
    workshop = Column(String(64), nullable=False, index=True)
    location = Column(String(128), nullable=False)
    install_date = Column(String(32), nullable=True)
    manufacturer = Column(String(128), nullable=True)
    status = Column(String(32), default="running", nullable=False, index=True)
    health_score = Column(Integer, default=95)
    criticality = Column(String(32), default="主要生产")
    telemetry = Column(JSON, default=dict)
    specs = Column(JSON, default=dict)
    maintenance_history = Column(JSON, default=list)
    next_inspection_date = Column(String(32), nullable=True)
    assigned_technician = Column(String(64), nullable=True)
    qr_code = Column(String(128), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    work_orders = relationship("WorkOrderModel", back_populates="equipment", cascade="all, delete-orphan")


class WorkOrderModel(Base):
    __tablename__ = "work_orders"

    id = Column(String(64), primary_key=True, index=True)
    order_no = Column(String(64), unique=True, index=True, nullable=False)
    title = Column(String(256), nullable=False)
    equipment_id = Column(String(64), ForeignKey("equipments.id", ondelete="CASCADE"), nullable=False, index=True)
    equipment_name = Column(String(128), nullable=False)
    equipment_code = Column(String(64), nullable=False)
    workshop = Column(String(64), nullable=False, index=True)
    fault_type = Column(String(64), nullable=False, index=True)
    priority = Column(String(32), nullable=False, index=True)  # urgent, high, medium, low
    status = Column(String(32), nullable=False, default="created", index=True)  # created, dispatched, in_progress, pending_acceptance, completed, cancelled
    creator = Column(String(128), nullable=False)
    dispatcher = Column(String(128), nullable=True)
    assignee = Column(String(128), nullable=True)
    assignee_id = Column(String(64), nullable=True)
    
    created_at = Column(String(64), nullable=False)
    dispatched_at = Column(String(64), nullable=True)
    accepted_at = Column(String(64), nullable=True)
    completed_at = Column(String(64), nullable=True)
    accepted_by_inspector_at = Column(String(64), nullable=True)
    
    description = Column(Text, nullable=False)
    photos = Column(JSON, default=list)
    safety_requirements = Column(JSON, default=list)
    repair_log = Column(JSON, nullable=True)
    acceptance = Column(JSON, nullable=True)
    
    # 状态互斥与并发控制字段 (Optimistic Locking & Concurrency Control)
    version = Column(Integer, default=1, nullable=False)
    idempotency_key = Column(String(128), nullable=True, index=True)
    
    # 审计与时序字段
    created_timestamp = Column(DateTime, default=datetime.utcnow, index=True, nullable=False)
    updated_timestamp = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    is_deleted = Column(Boolean, default=False, nullable=False, index=True)

    equipment = relationship("EquipmentModel", back_populates="work_orders")
    logs = relationship("WorkOrderLogModel", back_populates="work_order", cascade="all, delete-orphan", order_by="WorkOrderLogModel.created_timestamp.desc()")

    __table_args__ = (
        Index("idx_equipment_status_time", "equipment_id", "status", "created_timestamp"),
        Index("idx_order_equipment_fault", "equipment_id", "fault_type", "status"),
    )


class WorkOrderLogModel(Base):
    __tablename__ = "work_order_logs"

    id = Column(String(64), primary_key=True, index=True)
    work_order_id = Column(String(64), ForeignKey("work_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    action = Column(String(64), nullable=False)  # CREATE, DISPATCH, CLAIM, COMPLETE, ACCEPT, REJECT, CANCEL
    previous_status = Column(String(32), nullable=True)
    new_status = Column(String(32), nullable=False)
    operator_name = Column(String(128), nullable=False)
    operator_role = Column(String(64), nullable=True)
    comment = Column(Text, nullable=True)
    created_at = Column(String(64), nullable=False)
    created_timestamp = Column(DateTime, default=datetime.utcnow, index=True)

    work_order = relationship("WorkOrderModel", back_populates="logs")


class UserModel(Base):
    """用户账号与 RBAC 角色权限模型"""
    __tablename__ = "users"

    id = Column(String(64), primary_key=True, index=True)
    username = Column(String(64), unique=True, index=True, nullable=False)
    hashed_password = Column(String(256), nullable=False)
    name = Column(String(128), nullable=False)
    role = Column(String(32), nullable=False, index=True)  # admin, manager, technician, inspector, operator
    role_title = Column(String(128), nullable=False)
    department = Column(String(128), nullable=False)
    phone = Column(String(32), nullable=True)
    email = Column(String(128), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    permissions = Column(JSON, default=list)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SafetyPermitModel(Base):
    """高危安全作业票模型 (含动火/受限空间双人审批与 LOTO 联锁)"""
    __tablename__ = "safety_permits"

    id = Column(String(64), primary_key=True, index=True)
    permit_no = Column(String(64), unique=True, index=True, nullable=False)
    permit_type = Column(String(64), nullable=False, index=True)  # 动火作业票, 受限空间作业票, 高处作业票, LOTO停电上锁票, 临时用电作业票, 吊装作业票
    risk_level = Column(String(64), nullable=False, index=True)  # 极大风险 (Level 1), 较大风险 (Level 2), 一般风险 (Level 3), 低风险 (Level 4)
    title = Column(String(256), nullable=False)
    equipment_id = Column(String(64), ForeignKey("equipments.id", ondelete="SET NULL"), nullable=True, index=True)
    equipment_name = Column(String(128), nullable=True)
    workshop = Column(String(64), nullable=False, index=True)
    location = Column(String(128), nullable=False)
    applicant = Column(String(128), nullable=False)
    applicant_dept = Column(String(128), nullable=True)
    applied_at = Column(String(64), nullable=False)
    valid_until = Column(String(64), nullable=False)
    status = Column(String(32), default="pending_approval", nullable=False, index=True)  # pending_approval, approved, rejected, closed
    
    precautions = Column(JSON, default=list)
    loto_number = Column(String(64), nullable=True)
    hazards = Column(JSON, default=list)
    safety_checklist = Column(JSON, default=list)
    
    # 现场气体检测分析结果 (受限空间与动火关键前置条件)
    gas_test_results = Column(JSON, nullable=True)  # { oxygen: 20.9, combustible_gas: 0.1, toxic_gas: 0, tester: 'xxx', test_time: 'xxx' }

    # 双人审批业务关键流转 (Double-signature approval workflow)
    guardian_approval = Column(JSON, nullable=True)    # 现场监护人会签: { signed: bool, name: str, signed_at: str, comment: str, gas_test_passed: bool }
    supervisor_approval = Column(JSON, nullable=True)  # 安全主管/总监终审: { signed: bool, name: str, signed_at: str, comment: str }
    
    closed_at = Column(String(64), nullable=True)
    closed_by = Column(String(128), nullable=True)
    close_remark = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class KnowledgeArticleModel(Base):
    """RAG 检修知识库文章模型"""
    __tablename__ = "knowledge_articles"

    id = Column(String(64), primary_key=True, index=True)
    title = Column(String(256), nullable=False, index=True)
    category = Column(String(64), nullable=False, index=True)  # 检修SOP规程, 故障树分析, 典型事故案例, 检修国家标准
    target_equipment = Column(String(128), default="通用设备", index=True)
    tags = Column(JSON, default=list)
    summary = Column(Text, nullable=False)
    content = Column(Text, nullable=False)
    author = Column(String(128), nullable=False)
    updated_at = Column(String(64), nullable=False)
    view_count = Column(Integer, default=1)
    likes = Column(Integer, default=0)
    file_type = Column(String(32), default="manual")  # manual, pdf, docx, md, txt
    chunks_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    chunks = relationship("KnowledgeChunkModel", back_populates="article", cascade="all, delete-orphan")


class KnowledgeChunkModel(Base):
    """RAG 向量化文本切片分块模型"""
    __tablename__ = "knowledge_chunks"

    id = Column(String(64), primary_key=True, index=True)
    article_id = Column(String(64), ForeignKey("knowledge_articles.id", ondelete="CASCADE"), nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False)
    text = Column(Text, nullable=False)
    char_length = Column(Integer, nullable=False)
    metadata_json = Column(JSON, default=dict)
    # 向量嵌入哈希或高维特征序列存储
    vector_embedding = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    article = relationship("KnowledgeArticleModel", back_populates="chunks")

