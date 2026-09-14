from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.app.core.config import settings
from backend.app.core.init_db import init_database
from backend.app.api.v1.router import api_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 服务启动时自动执行建表与基础数据初始化
    print("🚀 启动工业设备检修报单系统生产级后端...")
    await init_database()
    print("✅ 数据库表与设备基线数据初始化完毕。")
    yield
    print("🛑 后端服务安全终止。")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version="2.0.0",
    description="工业设备报单、维修派工、安全防护隔离与状态互斥流转生产级 RESTful API 服务",
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=f"{settings.API_V1_STR}/docs",
    redoc_url=f"{settings.API_V1_STR}/redoc",
    lifespan=lifespan,
)

# 跨域配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册 API v1 路由
app.include_router(api_router, prefix=settings.API_V1_STR)

@app.get("/health", tags=["系统状态"])
async def health_check():
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "version": "2.0.0",
        "anti_duplicate_window": f"{settings.DUPLICATE_WINDOW_MINUTES}m",
        "state_mutex_engine": "active",
    }

@app.get("/", tags=["系统入口"])
async def root():
    return {
        "message": "工业设备维修报单系统生产级后端已就绪",
        "api_docs": f"{settings.API_V1_STR}/docs",
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host="0.0.0.0", port=8000, reload=True)
