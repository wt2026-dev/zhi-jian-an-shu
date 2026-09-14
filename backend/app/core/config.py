import os
from typing import List
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "工业设备检修报单系统 (Smart Industrial Maintenance System)"
    API_V1_STR: str = "/api/v1"
    
    # 数据库配置: 优先读取 DATABASE_URL，缺省支持异步 SQLite / Postgres
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", 
        "sqlite+aiosqlite:///./maintenance.db"
    )
    
    # Redis 配置 (用于分布式锁、防重复报单幂等键与缓存)
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    
    # 防重复报单时间窗口 (分钟): 同设备在未闭环状态下同故障类型在此时间窗口内禁止重复提单
    DUPLICATE_WINDOW_MINUTES: int = int(os.getenv("DUPLICATE_WINDOW_MINUTES", "15"))
    
    # CORS 跨域允许配置
    BACKEND_CORS_ORIGINS: List[str] = ["*"]
    
    # 安全密钥
    SECRET_KEY: str = os.getenv("SECRET_KEY", "maintenance-prod-secret-key-2026-safe")

    class Config:
        case_sensitive = True
        env_file = ".env"

settings = Settings()
