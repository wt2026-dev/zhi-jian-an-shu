import uuid
from datetime import datetime
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from backend.app.api.deps import get_db, get_current_user, require_roles
from backend.app.models.models import SafetyPermitModel, UserModel

router = APIRouter(prefix="/safety-permits", tags=["安全管理高危作业票与双人审批"])

class CreateSafetyPermitRequest(BaseModel):
    permitType: str = Field(..., description="作业票类型: 动火作业票, 受限空间作业票, 高处作业票, LOTO停电上锁票, 临时用电作业票, 吊装作业票")
    riskLevel: str = Field(..., description="风险级别: 极大风险 (Level 1), 较大风险 (Level 2), 一般风险 (Level 3), 低风险 (Level 4)")
    title: str = Field(..., description="作业票标题与内容")
    equipmentId: Optional[str] = None
    equipmentName: Optional[str] = None
    workshop: str
    location: str
    validUntil: str
    precautions: List[str] = []
    lotoNumber: Optional[str] = None
    hazards: List[str] = []
    safetyChecklist: List[Dict[str, Any]] = []

class DualApprovalRequest(BaseModel):
    step: str = Field(..., description="审批环节: 'guardian' (现场监护人会签) 或 'supervisor' (安全主管终审)")
    passApproval: bool = Field(..., alias="pass", description="是否批准通过")
    comment: Optional[str] = "审核合格，准予作业"
    gasTestResults: Optional[Dict[str, Any]] = None  # { oxygen: 20.9, combustible_gas: 0.1, toxic_gas: 0 }

class ClosePermitRequest(BaseModel):
    closeRemark: Optional[str] = "现场作业完毕，无遗留火种，工完料净场地清，LOTO安全锁具已按规程安全解锁释放"

def _map_permit_to_dict(p: SafetyPermitModel) -> dict:
    return {
        "id": p.id,
        "permitNo": p.permit_no,
        "permitType": p.permit_type,
        "riskLevel": p.risk_level,
        "title": p.title,
        "equipmentId": p.equipment_id,
        "equipmentName": p.equipment_name,
        "workshop": p.workshop,
        "location": p.location,
        "applicant": p.applicant,
        "applicantDept": p.applicant_dept,
        "appliedAt": p.applied_at,
        "validUntil": p.valid_until,
        "status": p.status,
        "precautions": p.precautions or [],
        "lotoNumber": p.loto_number,
        "hazards": p.hazards or [],
        "safetyChecklist": p.safety_checklist or [],
        "gasTestResults": p.gas_test_results,
        "guardianApproval": p.guardian_approval,
        "supervisorApproval": p.supervisor_approval,
        "closedAt": p.closed_at,
        "closedBy": p.closed_by,
        "closeRemark": p.close_remark,
        "createdAt": p.created_at.isoformat() if p.created_at else None,
    }

@router.get("", summary="获取安全作业票列表")
async def list_safety_permits(
    risk_level: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    workshop: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    query = select(SafetyPermitModel).order_by(SafetyPermitModel.created_at.desc())
    if risk_level and risk_level != "all":
        query = query.where(SafetyPermitModel.risk_level == risk_level)
    if status_filter and status_filter != "all":
        query = query.where(SafetyPermitModel.status == status_filter)
    if workshop and workshop != "all":
        query = query.where(SafetyPermitModel.workshop == workshop)
    
    result = await db.execute(query)
    permits = result.scalars().all()
    return [_map_permit_to_dict(p) for p in permits]

@router.get("/{permit_id}", summary="获取作业票详情")
async def get_safety_permit(
    permit_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    result = await db.execute(select(SafetyPermitModel).where(SafetyPermitModel.id == permit_id))
    permit = result.scalar_one_or_none()
    if not permit:
        raise HTTPException(status_code=404, detail="未找到对应的安全作业票")
    return _map_permit_to_dict(permit)

@router.post("", summary="申请提交高危安全作业票")
async def create_safety_permit(
    req: CreateSafetyPermitRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    now = datetime.now()
    permit_no = f"SP-{now.strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}"
    applied_at_str = now.strftime("%Y-%m-%d %H:%M:%S")

    new_permit = SafetyPermitModel(
        id=f"sp-{uuid.uuid4().hex[:12]}",
        permit_no=permit_no,
        permit_type=req.permitType,
        risk_level=req.riskLevel,
        title=req.title,
        equipment_id=req.equipmentId,
        equipment_name=req.equipmentName or "通用作业机位",
        workshop=req.workshop,
        location=req.location,
        applicant=f"{current_user.name} ({current_user.role_title})",
        applicant_dept=current_user.department,
        applied_at=applied_at_str,
        valid_until=req.validUntil,
        status="pending_approval",
        precautions=req.precautions,
        loto_number=req.lotoNumber,
        hazards=req.hazards,
        safety_checklist=req.safetyChecklist,
        gas_test_results=None,
        guardian_approval=None,
        supervisor_approval=None,
    )

    db.add(new_permit)
    await db.commit()
    await db.refresh(new_permit)
    return _map_permit_to_dict(new_permit)

@router.post("/{permit_id}/approve", summary="双人审批业务流转 (监护人审核 + 安全主管终审)")
async def approve_safety_permit(
    permit_id: str,
    req: DualApprovalRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    result = await db.execute(select(SafetyPermitModel).where(SafetyPermitModel.id == permit_id))
    permit = result.scalar_one_or_none()
    if not permit:
        raise HTTPException(status_code=404, detail="安全作业票不存在")
    
    if permit.status in ["approved", "closed"]:
        raise HTTPException(status_code=400, detail=f"作业票当前状态为【{permit.status}】，无需重复审核")

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # 若任一环节选择驳回
    if not req.passApproval:
        permit.status = "rejected"
        if req.step == "guardian":
            permit.guardian_approval = {
                "signed": False,
                "name": current_user.name,
                "role": "现场安全监护人",
                "signedAt": now_str,
                "comment": req.comment or "现场安全措施不达标，驳回整改",
                "gasTestPassed": False,
            }
        else:
            permit.supervisor_approval = {
                "signed": False,
                "name": current_user.name,
                "role": "车间安全总监/主管",
                "signedAt": now_str,
                "comment": req.comment or "安全条件审核不通过，驳回整改",
            }
        await db.commit()
        await db.refresh(permit)
        return _map_permit_to_dict(permit)

    # 步骤1: 现场监护人审核 (Guardian)
    if req.step == "guardian":
        gas_passed = True
        # 若传入气体分析数据，校验国家受限空间/动火作业标准
        if req.gasTestResults:
            oxygen = float(req.gasTestResults.get("oxygen", 20.9))
            combustible = float(req.gasTestResults.get("combustible_gas", 0))
            if not (19.5 <= oxygen <= 23.5) or combustible > 0.5:
                gas_passed = False
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"气体检测超标不合格！氧气含量需在 19.5%~23.5%，可燃气体LEL必须≤0.5% (实测: 氧气{oxygen}%, 可燃气{combustible}%)",
                )
            permit.gas_test_results = req.gasTestResults

        permit.guardian_approval = {
            "signed": True,
            "name": current_user.name,
            "role": "现场安全监护人",
            "signedAt": now_str,
            "comment": req.comment or "现场灭火设施就位，人员安全交底完毕，动火/受限空间环境合格",
            "gasTestPassed": gas_passed,
        }

    # 步骤2: 安全主管终审 (Supervisor)
    elif req.step == "supervisor":
        # 权限校验: 主管终审必须为 admin 或 manager 角色
        if current_user.role not in ["admin", "manager"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"权限拦截：终审放行需要【车间安全主管/总工】权限，当前角色为【{current_user.role_title}】",
            )
        
        permit.supervisor_approval = {
            "signed": True,
            "name": current_user.name,
            "role": "车间安全总监/主管",
            "signedAt": now_str,
            "comment": req.comment or "审批批准：安全措施已核验到位，准予现场作业",
        }

    # 核心双人审批判定: 当监护人与安全主管双人均签署通过时，正式生效
    guardian_ok = permit.guardian_approval and permit.guardian_approval.get("signed") is True
    supervisor_ok = permit.supervisor_approval and permit.supervisor_approval.get("signed") is True

    if guardian_ok and supervisor_ok:
        permit.status = "approved"

    await db.commit()
    await db.refresh(permit)
    return _map_permit_to_dict(permit)

@router.post("/{permit_id}/close", summary="现场完工终结闭环与 LOTO 锁具解除")
async def close_safety_permit(
    permit_id: str,
    req: ClosePermitRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    result = await db.execute(select(SafetyPermitModel).where(SafetyPermitModel.id == permit_id))
    permit = result.scalar_one_or_none()
    if not permit:
        raise HTTPException(status_code=404, detail="安全作业票不存在")
    
    if permit.status != "approved":
        raise HTTPException(status_code=400, detail="只有已批准且在控的作业票方可办理完工闭环")

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    permit.status = "closed"
    permit.closed_at = now_str
    permit.closed_by = f"{current_user.name} ({current_user.role_title})"
    permit.close_remark = req.closeRemark

    await db.commit()
    await db.refresh(permit)
    return _map_permit_to_dict(permit)

@router.delete("/{permit_id}", summary="作废/删除安全作业票 (限草稿或已驳回票据)")
async def delete_safety_permit(
    permit_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    result = await db.execute(select(SafetyPermitModel).where(SafetyPermitModel.id == permit_id))
    permit = result.scalar_one_or_none()
    if not permit:
        raise HTTPException(status_code=404, detail="未找到作业票")
    if permit.status == "approved":
        raise HTTPException(status_code=400, detail="已生效批准的高危作业票禁止直接删除，请走闭环流程")
    
    await db.delete(permit)
    await db.commit()
    return {"success": True, "message": "作业票已作废删除"}
