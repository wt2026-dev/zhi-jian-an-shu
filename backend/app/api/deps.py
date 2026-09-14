from typing import AsyncGenerator, List, Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.app.core.database import AsyncSessionLocal
from backend.app.core.security import decode_access_token
from backend.app.models.models import UserModel

security = HTTPBearer(auto_error=False)

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()

async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> UserModel:
    """提取并校验 Bearer JWT Token，获取当前登录用户"""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="缺少访问凭证，请先登录系统获取令牌 (Missing Bearer Token)",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    token = credentials.credentials
    try:
        payload = decode_access_token(token)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"无效或已过期的凭据: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user_id = payload.get("sub") or payload.get("user_id")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token 载荷中缺少主体标识",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    result = await db.execute(select(UserModel).where(UserModel.id == user_id, UserModel.is_active == True))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户不存在或已被停用",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return user

def require_roles(allowed_roles: List[str]):
    """RBAC 角色鉴权拦截器: 校验用户是否具备指定角色 (admin 默认全局豁免放行)"""
    async def role_checker(current_user: UserModel = Depends(get_current_user)) -> UserModel:
        if current_user.role == "admin":
            return current_user
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"权限不足：当前角色【{current_user.role_title}】无权执行此操作，需要【{'或'.join(allowed_roles)}】权限。",
            )
        return current_user
    return role_checker
