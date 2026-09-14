from fastapi import APIRouter
from backend.app.api.v1.endpoints import (
    work_orders,
    equipments,
    auth,
    safety_permits,
    knowledge,
    ai,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(work_orders.router)
api_router.include_router(equipments.router)
api_router.include_router(safety_permits.router)
api_router.include_router(knowledge.router)
api_router.include_router(ai.router)

