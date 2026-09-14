from typing import List, Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.app.api.deps import get_db, get_current_user
from backend.app.core.security import verify_password, create_access_token
from backend.app.models.models import UserModel

router = APIRouter(prefix="/auth", tags=["用户认证与RBAC鉴权"])

class LoginRequest(BaseModel):
    username: str
    password: str

class UserProfileResponse(BaseModel):
    id: str
    username: str
    name: str
    role: str
    roleTitle: str
    department: str
    phone: Optional[str] = None
    email: Optional[str] = None
    permissions: List[str] = []

class LoginResponse(BaseModel):
    token: str
    tokenType: str = "bearer"
    expiresIn: int
    user: UserProfileResponse

@router.post("/login", response_model=LoginResponse, summary="用户账号密码登录获取 JWT")
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    """用户登录接口：验证账号密码，签发 HS256 JWT Token"""
    result = await db.execute(select(UserModel).where(UserModel.username == req.username))
    user = result.scalar_one_or_none()
    
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="账号或密码错误，请核对后重试",
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="该账号已被锁定停用，请联系车间系统管理员",
        )
    
    token = create_access_token({
        "sub": user.id,
        "user_id": user.id,
        "username": user.username,
        "name": user.name,
        "role": user.role,
        "role_title": user.role_title,
    })
    
    return LoginResponse(
        token=token,
        tokenType="bearer",
        expiresIn=480 * 60,
        user=UserProfileResponse(
            id=user.id,
            username=user.username,
            name=user.name,
            role=user.role,
            roleTitle=user.role_title,
            department=user.department,
            phone=user.phone,
            email=user.email,
            permissions=user.permissions or [],
        ),
    )

@router.get("/me", response_model=UserProfileResponse, summary="获取当前登录用户信息 (校验Token)")
async def get_me(current_user: UserModel = Depends(get_current_user)):
    """通过 Bearer Token 获取当前登录用户信息"""
    return UserProfileResponse(
        id=current_user.id,
        username=current_user.username,
        name=current_user.name,
        role=current_user.role,
        roleTitle=current_user.role_title,
        department=current_user.department,
        phone=current_user.phone,
        email=current_user.email,
        permissions=current_user.permissions or [],
    )

@router.get("/users", response_model=List[UserProfileResponse], summary="获取系统用户列表 (需要管理员或主管权限)")
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    """查询用户列表"""
    result = await db.execute(select(UserModel).order_by(UserModel.created_at.asc()))
    users = result.scalars().all()
    return [
        UserProfileResponse(
            id=u.id,
            username=u.username,
            name=u.name,
            role=u.role,
            roleTitle=u.role_title,
            department=u.department,
            phone=u.phone,
            email=u.email,
            permissions=u.permissions or [],
        )
        for u in users
    ]
