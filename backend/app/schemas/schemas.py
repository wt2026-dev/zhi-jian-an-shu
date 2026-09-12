from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime

# 备件消耗项
class SparePartUsageSchema(BaseModel):
    id: str
    name: str
    code: str
    spec: str
    qty: float
    unit: str
    unitPrice: float

# 检修完工报告
class RepairLogSchema(BaseModel):
    causeAnalysis: str
    resolutionSteps: str
    partsUsed: List[SparePartUsageSchema] = []
    workHours: float = 1.0
    completionPhotos: List[str] = []
    remark: Optional[str] = ""

# 质检验收报告
class AcceptanceSchema(BaseModel):
    inspectorName: str
    pass_: bool = Field(True, alias="pass")
    score: int = 5
    comment: str
    signatureDate: str

    class Config:
        populate_by_name = True

# 创建工单请求
class WorkOrderCreateSchema(BaseModel):
    title: str = Field(..., min_length=2, max_length=200, description="工单标题")
    equipmentId: str = Field(..., description="报修设备ID")
    faultType: str = Field("机械振动", description="故障分类")
    priority: str = Field("high", description="紧急程度: urgent/high/medium/low")
    description: str = Field(..., min_length=2, description="故障征兆详细描述")
    safetyRequirements: List[str] = Field(default_factory=list, description="强制安全防护要求")
    creator: Optional[str] = "现场维保人员"
    idempotencyKey: Optional[str] = Field(None, description="防重复提交幂等唯一键")
    forceSubmit: Optional[bool] = Field(False, description="是否忽略防重复预警强制提交")

# 更新工单基础信息
class WorkOrderUpdateSchema(BaseModel):
    title: Optional[str] = None
    faultType: Optional[str] = None
    priority: Optional[str] = None
    description: Optional[str] = None
    safetyRequirements: Optional[List[str]] = None
    version: Optional[int] = Field(None, description="乐观锁版本号校验")

# 派单请求
class WorkOrderDispatchSchema(BaseModel):
    assigneeId: str
    assigneeName: Optional[str] = None
    dispatcher: Optional[str] = None
    estimatedHours: Optional[float] = 2.0
    dispatcherNote: Optional[str] = None
    version: Optional[int] = Field(None, description="乐观锁版本号")

# 接单请求
class WorkOrderClaimSchema(BaseModel):
    operatorName: Optional[str] = None
    version: Optional[int] = Field(None, description="乐观锁版本号")

# 完工上报请求
class WorkOrderCompleteSchema(BaseModel):
    causeAnalysis: str
    resolutionSteps: str
    workHours: float = 2.0
    partsUsed: List[SparePartUsageSchema] = []
    remark: Optional[str] = None
    completionPhotos: List[str] = []
    operatorName: Optional[str] = None
    version: Optional[int] = Field(None, description="乐观锁版本号")

# 质检验收请求
class WorkOrderAcceptanceSchema(BaseModel):
    inspectorName: str
    pass_: bool = Field(True, alias="pass")
    score: int = 5
    comment: str
    version: Optional[int] = Field(None, description="乐观锁版本号")

    class Config:
        populate_by_name = True

# 状态流转通用互斥校验请求
class WorkOrderStatusTransitionSchema(BaseModel):
    targetStatus: str = Field(..., description="目标状态: created/dispatched/in_progress/pending_acceptance/completed/cancelled")
    operatorName: str = "系统操作员"
    operatorRole: Optional[str] = "admin"
    comment: Optional[str] = None
    version: Optional[int] = Field(None, description="乐观并发锁版本号")

# 工单操作流转日志响应
class WorkOrderLogResponseSchema(BaseModel):
    id: str
    workOrderId: str = Field(..., alias="work_order_id")
    action: str
    previousStatus: Optional[str] = Field(None, alias="previous_status")
    newStatus: str = Field(..., alias="new_status")
    operatorName: str = Field(..., alias="operator_name")
    operatorRole: Optional[str] = Field(None, alias="operator_role")
    comment: Optional[str] = None
    createdAt: str = Field(..., alias="created_at")

    class Config:
        populate_by_name = True
        from_attributes = True

# 工单响应对象 (与前端类型定义 WorkOrder 100% 对齐)
class WorkOrderResponseSchema(BaseModel):
    id: str
    orderNo: str
    title: str
    equipmentId: str
    equipmentName: str
    equipmentCode: str
    workshop: str
    faultType: str
    priority: str
    status: str
    creator: str
    dispatcher: Optional[str] = None
    assignee: Optional[str] = None
    assigneeId: Optional[str] = None
    createdAt: str
    dispatchedAt: Optional[str] = None
    acceptedAt: Optional[str] = None
    completedAt: Optional[str] = None
    acceptedByInspectorAt: Optional[str] = None
    description: str
    photos: List[str] = []
    safetyRequirements: List[str] = []
    repairLog: Optional[Dict[str, Any]] = None
    acceptance: Optional[Dict[str, Any]] = None
    version: int = 1
    logs: Optional[List[WorkOrderLogResponseSchema]] = None

    class Config:
        populate_by_name = True
        from_attributes = True

# 工单统计响应
class WorkOrderStatsResponseSchema(BaseModel):
    totalCount: int
    createdCount: int
    dispatchedCount: int
    inProgressCount: int
    pendingAcceptanceCount: int
    completedCount: int
    cancelledCount: int
    urgentCount: int
    highCount: int
    mediumCount: int
    lowCount: int
    mttrHours: float
    mtbfHours: float
    completionRate: float

# 设备响应
class EquipmentResponseSchema(BaseModel):
    id: str
    code: str
    name: str
    category: str
    model: str
    workshop: str
    location: str
    installDate: Optional[str] = None
    manufacturer: Optional[str] = None
    status: str
    healthScore: int
    criticality: str
    telemetry: Dict[str, Any]
    specs: Dict[str, Any]
    maintenanceHistory: List[Dict[str, Any]] = []
    nextInspectionDate: Optional[str] = None
    assignedTechnician: Optional[str] = None
    qrCode: Optional[str] = None

    class Config:
        populate_by_name = True
        from_attributes = True
