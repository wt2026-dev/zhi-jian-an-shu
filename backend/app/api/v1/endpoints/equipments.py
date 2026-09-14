from typing import List, Optional
from datetime import datetime, timedelta
import random
import io
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_

from backend.app.core.database import get_db
from backend.app.models.models import EquipmentModel
from backend.app.schemas.schemas import EquipmentResponseSchema

router = APIRouter(prefix="/equipments", tags=["工业设备台账资产"])

@router.get("", response_model=List[EquipmentResponseSchema], summary="获取设备台账列表")
async def list_equipments(
    workshop: Optional[str] = Query(None, description="所属车间"),
    status: Optional[str] = Query(None, description="状态: running/warning/fault/overhauling/standby"),
    search: Optional[str] = Query(None, description="搜索设备名或编码"),
    db: AsyncSession = Depends(get_db),
):
    conditions = []
    if workshop and workshop != "all":
        conditions.append(EquipmentModel.workshop == workshop)
    if status and status != "all":
        conditions.append(EquipmentModel.status == status)
    if search:
        search_fmt = f"%{search}%"
        conditions.append(
            or_(
                EquipmentModel.name.ilike(search_fmt),
                EquipmentModel.code.ilike(search_fmt),
                EquipmentModel.location.ilike(search_fmt),
            )
        )

    stmt = select(EquipmentModel)
    if conditions:
        stmt = stmt.where(and_(*conditions))
    
    result = await db.execute(stmt)
    equipments = result.scalars().all()
    return equipments

@router.get("/{id}", response_model=EquipmentResponseSchema, summary="获取指定设备台账详情")
async def get_equipment(id: str, db: AsyncSession = Depends(get_db)):
    stmt = select(EquipmentModel).where(EquipmentModel.id == id)
    result = await db.execute(stmt)
    equipment = result.scalars().first()
    if not equipment:
        raise HTTPException(status_code=404, detail="设备不存在")
    return equipment

@router.get("/{id}/qrcode", summary="生成设备电子铭牌专属二维码 (PNG 图像流)")
async def get_equipment_qrcode(id: str, db: AsyncSession = Depends(get_db)):
    """根据设备唯一编码生成工业级巡检与快速报单二维码"""
    stmt = select(EquipmentModel).where(EquipmentModel.id == id)
    result = await db.execute(stmt)
    eq = result.scalars().first()
    if not eq:
        raise HTTPException(status_code=404, detail="设备不存在")
    
    qr_payload = f"EQUIPMENT://{eq.code}?id={eq.id}&name={eq.name}&workshop={eq.workshop}"
    
    try:
        import qrcode
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=10,
            border=3,
        )
        qr.add_data(qr_payload)
        qr.make(fit=True)
        img = qr.make_image(fill_color="#0891b2", back_color="white")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return Response(content=buf.getvalue(), media_type="image/png")
    except Exception:
        # SVG 矢量后备
        svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
            <rect width="200" height="200" fill="#0f172a" rx="16"/>
            <rect x="25" y="25" width="45" height="45" fill="none" stroke="#22d3ee" stroke-width="6" rx="6"/>
            <rect x="130" y="25" width="45" height="45" fill="none" stroke="#22d3ee" stroke-width="6" rx="6"/>
            <rect x="25" y="130" width="45" height="45" fill="none" stroke="#22d3ee" stroke-width="6" rx="6"/>
            <rect x="40" y="40" width="15" height="15" fill="#22d3ee"/>
            <rect x="145" y="40" width="15" height="15" fill="#22d3ee"/>
            <rect x="40" y="145" width="15" height="15" fill="#22d3ee"/>
            <text x="100" y="105" fill="#38bdf8" font-size="12" font-family="monospace" text-anchor="middle" font-weight="bold">{eq.code}</text>
            <text x="100" y="175" fill="#94a3b8" font-size="9" text-anchor="middle">工业设备巡检二维码</text>
        </svg>'''
        return Response(content=svg, media_type="image/svg+xml")

@router.get("/{id}/telemetry-history", summary="获取设备多维时序传感器运行监测指标")
async def get_equipment_telemetry_history(
    id: str,
    hours: int = Query(24, ge=1, le=168),
    db: AsyncSession = Depends(get_db),
):
    """返回用于时序图表展示的连续监控数据 (温度、振动烈度、三相电流、排气压力、负荷率)"""
    stmt = select(EquipmentModel).where(EquipmentModel.id == id)
    result = await db.execute(stmt)
    eq = result.scalars().first()
    if not eq:
        raise HTTPException(status_code=404, detail="设备不存在")
    
    base_temp = (eq.telemetry or {}).get("temperature", 72.0)
    base_vib = (eq.telemetry or {}).get("vibration", 3.2)
    base_current = (eq.telemetry or {}).get("current", 65.0)
    base_pressure = (eq.telemetry or {}).get("pressure", 1.2)
    
    now = datetime.now()
    points = []
    
    # 按照设定的时长生成平滑带噪时序点
    step_minutes = max(15, hours * 60 // 30)
    total_steps = (hours * 60) // step_minutes
    
    for i in range(total_steps, -1, -1):
        t = now - timedelta(minutes=i * step_minutes)
        # 模拟自然波动与微弱漂移
        factor = 1.0 + (0.05 * (1 if i < 5 and eq.status == 'fault' else 0))
        noise = (random.random() - 0.5) * 0.08
        points.append({
            "timestamp": t.strftime("%H:%M"),
            "fullTime": t.strftime("%Y-%m-%d %H:%M:%S"),
            "temperature": round(base_temp * (factor + noise), 1),
            "vibration": round(base_vib * (factor + noise * 1.5), 2),
            "current": round(base_current * (factor + noise), 1),
            "pressure": round(base_pressure * (1.0 + noise * 0.5), 2),
            "loadRate": round(min(100.0, max(20.0, 78.0 + noise * 20)), 1),
        })
        
    return {
        "equipmentId": eq.id,
        "equipmentCode": eq.code,
        "equipmentName": eq.name,
        "status": eq.status,
        "healthScore": eq.health_score,
        "hours": hours,
        "points": points,
    }

