import time
import random
from datetime import datetime, timedelta
from typing import List, Optional, Tuple, Dict, Any
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, update, desc

from backend.app.models.models import WorkOrderModel, WorkOrderLogModel, EquipmentModel
from backend.app.schemas.schemas import (
    WorkOrderCreateSchema,
    WorkOrderUpdateSchema,
    WorkOrderDispatchSchema,
    WorkOrderCompleteSchema,
    WorkOrderAcceptanceSchema,
    WorkOrderStatusTransitionSchema,
)
from backend.app.core.config import settings

# 状态中文字典
STATUS_LABELS = {
    "created": "待派单",
    "dispatched": "待接单",
    "in_progress": "检修中",
    "pending_acceptance": "待验收",
    "completed": "已归档",
    "cancelled": "已取消",
}

# 严格有限状态机 (FSM) 状态互斥流转矩阵
ALLOWED_TRANSITIONS: Dict[str, List[str]] = {
    "created": ["dispatched", "cancelled"],
    "dispatched": ["in_progress", "created", "cancelled"],  # 支持退回重新派发
    "in_progress": ["pending_acceptance", "cancelled"],
    "pending_acceptance": ["completed", "in_progress"],     # 验收不合格可驳回检修中
    "completed": [],                                         # 归档后为终态，不可随意更改
    "cancelled": [],                                         # 取消后为终态
}

class WorkOrderService:
    @staticmethod
    def generate_order_no() -> str:
        date_str = datetime.now().strftime("%Y%m%d")
        rand_num = random.randint(100, 999)
        return f"WO-{date_str}-{rand_num}"

    @staticmethod
    async def get_work_order_by_id(db: AsyncSession, order_id: str) -> Optional[WorkOrderModel]:
        stmt = select(WorkOrderModel).where(
            and_(WorkOrderModel.id == order_id, WorkOrderModel.is_deleted == False)
        )
        result = await db.execute(stmt)
        return result.scalars().first()

    @staticmethod
    async def check_duplicate_reporting(
        db: AsyncSession,
        equipment_id: str,
        fault_type: str,
        title: str,
        force_submit: bool = False
    ) -> Optional[WorkOrderModel]:
        """
        防重复报单校验逻辑：
        检查相同设备在指定时间窗口内（默认15分钟），是否存在处于未闭环状态（created, dispatched, in_progress）
        的同类报单。若存在且未设置 force_submit=True，则触发拦截。
        """
        if force_submit:
            return None

        window_threshold = datetime.utcnow() - timedelta(minutes=settings.DUPLICATE_WINDOW_MINUTES)
        
        # 活跃中未完成的工单状态
        active_statuses = ["created", "dispatched", "in_progress"]

        stmt = select(WorkOrderModel).where(
            and_(
                WorkOrderModel.equipment_id == equipment_id,
                WorkOrderModel.status.in_(active_statuses),
                WorkOrderModel.created_timestamp >= window_threshold,
                WorkOrderModel.is_deleted == False,
            )
        ).order_by(desc(WorkOrderModel.created_timestamp))

        result = await db.execute(stmt)
        existing = result.scalars().first()
        return existing

    @classmethod
    async def create_work_order(
        db: AsyncSession,
        data: WorkOrderCreateSchema,
    ) -> WorkOrderModel:
        # 1. 验证报修设备是否存在
        eq_stmt = select(EquipmentModel).where(EquipmentModel.id == data.equipmentId)
        eq_res = await db.execute(eq_stmt)
        equipment = eq_res.scalars().first()
        if not equipment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"关联设备不存在 (ID: {data.equipmentId})",
            )

        # 2. 防重复报单校验
        duplicate_order = await WorkOrderService.check_duplicate_reporting(
            db=db,
            equipment_id=data.equipmentId,
            fault_type=data.faultType,
            title=data.title,
            force_submit=data.forceSubmit or False,
        )

        if duplicate_order:
            status_label = STATUS_LABELS.get(duplicate_order.status, duplicate_order.status)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "DUPLICATE_WORK_ORDER",
                    "message": f"防重复报单拦截：设备【{equipment.name}】在{settings.DUPLICATE_WINDOW_MINUTES}分钟内已存在处理中的同类工单【{duplicate_order.order_no}】({status_label})，请勿重复提交。",
                    "existingOrder": {
                        "id": duplicate_order.id,
                        "orderNo": duplicate_order.order_no,
                        "title": duplicate_order.title,
                        "status": duplicate_order.status,
                        "statusLabel": status_label,
                        "priority": duplicate_order.priority,
                        "createdAt": duplicate_order.created_at,
                    },
                },
            )

        # 3. 生成新工单实体
        now = datetime.now()
        now_str = now.strftime("%Y/%m/%d %H:%M:%S")
        order_id = f"wo-{int(time.time() * 1000)}"
        order_no = WorkOrderService.generate_order_no()

        new_order = WorkOrderModel(
            id=order_id,
            order_no=order_no,
            title=data.title,
            equipment_id=equipment.id,
            equipment_name=equipment.name,
            equipment_code=equipment.code,
            workshop=equipment.workshop,
            fault_type=data.faultType,
            priority=data.priority,
            status="created",
            creator=data.creator or "现场操作员",
            created_at=now_str,
            description=data.description,
            safety_requirements=data.safetyRequirements or ["穿戴劳保鞋与安全帽", "实施 LOTO 停电挂牌"],
            photos=[],
            repair_log=None,
            acceptance=None,
            version=1,
            idempotency_key=data.idempotencyKey,
            created_timestamp=datetime.utcnow(),
            updated_timestamp=datetime.utcnow(),
            is_deleted=False,
        )

        db.add(new_order)

        # 4. 记录初始审计日志
        log_entry = WorkOrderLogModel(
            id=f"log-{int(time.time() * 1000)}-{random.randint(10, 99)}",
            work_order_id=order_id,
            action="CREATE",
            previous_status=None,
            new_status="created",
            operator_name=data.creator or "现场操作员",
            operator_role="operator",
            comment=f"创建报修工单: {data.title}",
            created_at=now_str,
            created_timestamp=datetime.utcnow(),
        )
        db.add(log_entry)

        # 5. 设备状态同步: 紧急/高优报修自动置设备为故障或检修中
        if data.priority in ["urgent", "high"]:
            equipment.status = "fault"

        await db.commit()
        await db.refresh(new_order)
        return new_order

    @classmethod
    async def dispatch_work_order(
        db: AsyncSession,
        order_id: str,
        data: WorkOrderDispatchSchema,
    ) -> WorkOrderModel:
        order = await WorkOrderService.get_work_order_by_id(db, order_id)
        if not order:
            raise HTTPException(status_code=404, detail="工单不存在")

        # 状态互斥校验
        if order.status != "created":
            curr_label = STATUS_LABELS.get(order.status, order.status)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "STATE_MUTEX_ERROR",
                    "message": f"状态互斥拦截：当前工单状态为【{curr_label}】，仅【待派单】状态工单可执行派发。",
                    "currentStatus": order.status,
                },
            )

        # 乐观锁并发校验
        if data.version is not None and order.version != data.version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="工单数据已被其他人员更新，请刷新最新状态后再试。",
            )

        now_str = datetime.now().strftime("%Y/%m/%d %H:%M:%S")
        order.status = "dispatched"
        order.dispatcher = data.dispatcher or "检修车间主管"
        order.assignee = data.assigneeName or "高级检修技师"
        order.assignee_id = data.assigneeId
        order.dispatched_at = now_str
        order.version += 1

        # 记录流转日志
        log_entry = WorkOrderLogModel(
            id=f"log-{int(time.time() * 1000)}-{random.randint(10, 99)}",
            work_order_id=order.id,
            action="DISPATCH",
            previous_status="created",
            new_status="dispatched",
            operator_name=order.dispatcher,
            operator_role="admin",
            comment=f"指派给技师【{order.assignee}】，预计工时: {data.estimatedHours}小时",
            created_at=now_str,
        )
        db.add(log_entry)

        await db.commit()
        await db.refresh(order)
        return order

    @classmethod
    async def claim_work_order(
        db: AsyncSession,
        order_id: str,
        operator_name: Optional[str] = None,
        version: Optional[int] = None,
    ) -> WorkOrderModel:
        order = await WorkOrderService.get_work_order_by_id(db, order_id)
        if not order:
            raise HTTPException(status_code=404, detail="工单不存在")

        if order.status != "dispatched":
            curr_label = STATUS_LABELS.get(order.status, order.status)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "STATE_MUTEX_ERROR",
                    "message": f"状态互斥拦截：当前工单状态为【{curr_label}】，仅【待接单】工单允许技师接单。",
                    "currentStatus": order.status,
                },
            )

        if version is not None and order.version != version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="工单已被其他人员接单或修改，请刷新最新数据。",
            )

        now_str = datetime.now().strftime("%Y/%m/%d %H:%M:%S")
        order.status = "in_progress"
        order.accepted_at = now_str
        order.version += 1

        log_entry = WorkOrderLogModel(
            id=f"log-{int(time.time() * 1000)}-{random.randint(10, 99)}",
            work_order_id=order.id,
            action="CLAIM",
            previous_status="dispatched",
            new_status="in_progress",
            operator_name=operator_name or order.assignee or "责任技师",
            operator_role="technician",
            comment="技师现场确认接单，开始执行安全隔离与检修作业",
            created_at=now_str,
        )
        db.add(log_entry)

        await db.commit()
        await db.refresh(order)
        return order

    @classmethod
    async def complete_work_order(
        db: AsyncSession,
        order_id: str,
        data: WorkOrderCompleteSchema,
    ) -> WorkOrderModel:
        order = await WorkOrderService.get_work_order_by_id(db, order_id)
        if not order:
            raise HTTPException(status_code=404, detail="工单不存在")

        if order.status != "in_progress":
            curr_label = STATUS_LABELS.get(order.status, order.status)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "STATE_MUTEX_ERROR",
                    "message": f"状态互斥拦截：当前工单状态为【{curr_label}】，仅【检修中】工单允许上报完工。",
                    "currentStatus": order.status,
                },
            )

        if data.version is not None and order.version != data.version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="工单已被其他人员修改，请刷新后提交。",
            )

        now_str = datetime.now().strftime("%Y/%m/%d %H:%M:%S")
        order.status = "pending_acceptance"
        order.completed_at = now_str
        order.version += 1
        order.repair_log = {
            "causeAnalysis": data.causeAnalysis,
            "resolutionSteps": data.resolutionSteps,
            "partsUsed": [p.dict() for p in data.partsUsed],
            "workHours": data.workHours,
            "completionPhotos": data.completionPhotos or [],
            "remark": data.remark or "",
        }

        log_entry = WorkOrderLogModel(
            id=f"log-{int(time.time() * 1000)}-{random.randint(10, 99)}",
            work_order_id=order.id,
            action="COMPLETE",
            previous_status="in_progress",
            new_status="pending_acceptance",
            operator_name=data.operatorName or order.assignee or "责任技师",
            operator_role="technician",
            comment=f"检修完工上报，耗时 {data.workHours} 小时，消耗备件 {len(data.partsUsed)} 项，等待质检验收",
            created_at=now_str,
        )
        db.add(log_entry)

        await db.commit()
        await db.refresh(order)
        return order

    @classmethod
    async def accept_work_order(
        db: AsyncSession,
        order_id: str,
        data: WorkOrderAcceptanceSchema,
    ) -> WorkOrderModel:
        order = await WorkOrderService.get_work_order_by_id(db, order_id)
        if not order:
            raise HTTPException(status_code=404, detail="工单不存在")

        if order.status != "pending_acceptance":
            curr_label = STATUS_LABELS.get(order.status, order.status)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "STATE_MUTEX_ERROR",
                    "message": f"状态互斥拦截：当前工单状态为【{curr_label}】，仅【待验收】工单可执行验收复核。",
                    "currentStatus": order.status,
                },
            )

        now_str = datetime.now().strftime("%Y/%m/%d %H:%M:%S")

        if data.pass_:
            order.status = "completed"
            action = "ACCEPT"
            comment = f"质量验收合格归档 (评级: {data.score}星) - {data.comment}"
            order.accepted_by_inspector_at = now_str
        else:
            order.status = "in_progress"
            action = "REJECT"
            comment = f"质量验收未通过驳回重修 - {data.comment}"

        order.version += 1
        order.acceptance = {
            "inspectorName": data.inspectorName,
            "pass": data.pass_,
            "score": data.score,
            "comment": data.comment,
            "signatureDate": datetime.now().strftime("%Y/%m/%d"),
        }

        log_entry = WorkOrderLogModel(
            id=f"log-{int(time.time() * 1000)}-{random.randint(10, 99)}",
            work_order_id=order.id,
            action=action,
            previous_status="pending_acceptance",
            new_status=order.status,
            operator_name=data.inspectorName,
            operator_role="inspector",
            comment=comment,
            created_at=now_str,
        )
        db.add(log_entry)

        # 验收合格闭环后，若该设备无其他未完成工单，恢复设备为正常运行状态
        if data.pass_:
            other_active_stmt = select(func.count(WorkOrderModel.id)).where(
                and_(
                    WorkOrderModel.equipment_id == order.equipment_id,
                    WorkOrderModel.id != order.id,
                    WorkOrderModel.status.in_(["created", "dispatched", "in_progress", "pending_acceptance"]),
                    WorkOrderModel.is_deleted == False,
                )
            )
            count_res = await db.execute(other_active_stmt)
            active_count = count_res.scalar_one()
            if active_count == 0:
                eq_stmt = select(EquipmentModel).where(EquipmentModel.id == order.equipment_id)
                eq_res = await db.execute(eq_stmt)
                eq = eq_res.scalars().first()
                if eq:
                    eq.status = "running"
                    eq.health_score = max(eq.health_score or 85, 92)

        await db.commit()
        await db.refresh(order)
        return order

    @classmethod
    async def transition_status(
        db: AsyncSession,
        order_id: str,
        data: WorkOrderStatusTransitionSchema,
    ) -> WorkOrderModel:
        order = await WorkOrderService.get_work_order_by_id(db, order_id)
        if not order:
            raise HTTPException(status_code=404, detail="工单不存在")

        current = order.status
        target = data.targetStatus

        # 状态机互斥校验
        allowed = ALLOWED_TRANSITIONS.get(current, [])
        if target not in allowed:
            curr_label = STATUS_LABELS.get(current, current)
            target_label = STATUS_LABELS.get(target, target)
            allowed_labels = [STATUS_LABELS.get(s, s) for s in allowed]
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "INVALID_STATE_TRANSITION",
                    "message": f"状态互斥拦截：当前工单状态为【{curr_label}】，无法直接变更为【{target_label}】。允许的下一步状态为：{', '.join(allowed_labels) if allowed_labels else '无 (终态)'}。",
                    "currentStatus": current,
                    "targetStatus": target,
                    "allowedStatuses": allowed,
                },
            )

        # 乐观锁校验
        if data.version is not None and order.version != data.version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="工单状态已被其他用户修改，请刷新后再操作。",
            )

        now_str = datetime.now().strftime("%Y/%m/%d %H:%M:%S")
        order.status = target
        order.version += 1

        log_entry = WorkOrderLogModel(
            id=f"log-{int(time.time() * 1000)}-{random.randint(10, 99)}",
            work_order_id=order.id,
            action="TRANSITION",
            previous_status=current,
            new_status=target,
            operator_name=data.operatorName,
            operator_role=data.operatorRole,
            comment=data.comment or f"状态变更为: {STATUS_LABELS.get(target, target)}",
            created_at=now_str,
        )
        db.add(log_entry)

        await db.commit()
        await db.refresh(order)
        return order
