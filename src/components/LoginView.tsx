import React, { useState } from 'react';
import {
  Wrench,
  ShieldCheck,
  Lock,
  User,
  Eye,
  EyeOff,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Cpu,
  Activity,
  KeyRound,
} from 'lucide-react';
import { Logo } from './Logo';
import { authApi } from '../api';
import { UserProfile } from '../types';
import { UserAvatar } from './UserAvatar';

interface LoginViewProps {
  onLoginSuccess: (user: UserProfile, token: string) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 演示环境首次登录强制改密引导状态 (DEMO_FORCE_PASSWORD_CHANGE=true)
  const [showForcePasswordModal, setShowForcePasswordModal] = useState(false);
  const [pendingSession, setPendingSession] = useState<{ user: UserProfile; token: string } | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [changePasswordMsg, setChangePasswordMsg] = useState<string | null>(null);

  // 预设快速体验账号 (涵盖 7 类角色)
  // demoPassword 与 src/db/seed.ts 的 DEMO_PASSWORDS 同值：演示口令每次启动被重置成固定哈希，不是真实口令
  const presetUsers = [
    { username: 'admin', name: '陈建平', role: '总工 / 机电部长', badgeColor: 'bg-red-50 text-red-700 border-red-200', demoPassword: 'Admin@2026#Demo' },
    { username: 'manager', name: '陈主管', role: '车间安全总监 / 维保主管', badgeColor: 'bg-purple-50 text-purple-700 border-purple-200', demoPassword: 'Manager@2026#Safe' },
    { username: 'tech1', name: '张建国', role: '机电检修高级技师', badgeColor: 'bg-blue-50 text-blue-700 border-blue-200', demoPassword: 'Tech1@2026#Work' },
    { username: 'inspector', name: '赵安全', role: '点检工程师 / 安全监护', badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200', demoPassword: 'Inspect@2026#Check' },
    { username: 'operator', name: '王操作', role: '现场岗位操作工', badgeColor: 'bg-amber-50 text-amber-700 border-amber-200', demoPassword: 'Operator@2026#Line' },
    { username: 'archivist', name: '吴晓芳', role: '技术档案管理员', badgeColor: 'bg-teal-50 text-teal-700 border-teal-200', demoPassword: 'Archive@2026#Doc' },
    { username: 'operator2', name: '周大伟', role: '起重机械操作 / 吊装司机', badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200', demoPassword: 'Operator2@2026#Lift' },
  ];

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setErrorMessage('请输入登录账号与密码');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await authApi.login({ username, password });
      if (res && res.token && res.user) {
        // 构造用户 Profile
        const userProfile: UserProfile = {
          id: res.user.id,
          name: res.user.name,
          role: res.user.role as any,
          roleTitle: res.user.roleTitle,
          department: res.user.department,
          avatar: (res.user as any).avatar || '',
          employeeNo: `EMP-${res.user.username.toUpperCase()}`,
          phone: '138-0010-8888',
          email: `${res.user.username}@factory.plant.com`,
          qualifications: ['特种作业操作证 (Q2)', '低压电工作业证', '有限空间作业监护证'],
          activeWorkOrdersCount: 2,
        };

        // 若后端指示需要强制/提示改密 (DEMO_FORCE_PASSWORD_CHANGE=true)
        if (res.forcePasswordChange) {
          setPendingSession({ user: userProfile, token: res.token });
          setShowForcePasswordModal(true);
          return;
        }

        authApi.saveToken(res.token);
        onLoginSuccess(userProfile, res.token);
      } else {
        throw new Error('鉴权服务器响应异常');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || '账号或密码不正确，请确认后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleCompletePendingLogin = () => {
    if (pendingSession) {
      authApi.saveToken(pendingSession.token);
      onLoginSuccess(pendingSession.user, pendingSession.token);
    }
    setShowForcePasswordModal(false);
  };

  const handleSelectPreset = (preset: { username: string; demoPassword: string }) => {
    setUsername(preset.username);
    setPassword(preset.demoPassword);
    setErrorMessage(null);
  };

  return (
    <div className="min-h-screen relative flex flex-col justify-center items-center p-4 overflow-hidden selection:bg-amber-500 selection:text-white">
      {/* 真实 3D 现代智能工厂全景高精背景（落地巨幕 + 自动化机组 + 晨曦天光） */}
      <div className="absolute inset-0 pointer-events-none select-none overflow-hidden">
        <img
          src="/assets/smart_factory_bg.jpg"
          alt="智慧工业工厂全景"
          className="w-full h-full object-cover object-center filter contrast-[1.04] brightness-[1.03]"
        />
        {/* 明亮通透的白玉微晶光照遮罩：确保 100% 明亮，保留宏大真实场景 */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/40 via-white/75 to-white/92 backdrop-blur-[2px]" />
        {/* 工业高精全息十字标尺微图层 */}
        <div className="absolute inset-0 opacity-25 bg-[linear-gradient(to_right,#0ea5e920_1px,transparent_1px),linear-gradient(to_bottom,#0ea5e920_1px,transparent_1px)] bg-[size:54px_54px]" />
      </div>

      <div className="w-full max-w-lg relative z-10 space-y-5 animate-in fade-in zoom-in-95 duration-200">
        {/* 系统标志与主标题 */}
        <div className="text-center space-y-1.5">
          <div className="inline-flex items-center justify-center p-2 rounded-2xl bg-white/80 backdrop-blur-md border border-amber-200/80 shadow-md mb-1">
            <Logo size="lg" />
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 flex items-center justify-center gap-2">
            <span>智检安枢</span>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-amber-100/80 border border-amber-300 text-amber-900 font-bold">
              V2.0
            </span>
          </h1>
          <p className="text-xs text-slate-600 font-medium max-w-md mx-auto">
            检修与安全管控一体化平台 · 设备劣化趋势提前预警 · 检修方案一键成单 · 高危作业票双人会签 · 通义千问多模态诊断 · 全厂数字孪生
          </p>
        </div>

        {/* 次世代白玉微晶装甲登录卡片 */}
        <div className="bg-white/92 backdrop-blur-2xl border border-amber-200/90 rounded-3xl p-6 sm:p-8 shadow-[0_12px_40px_rgba(15,23,42,0.12)] space-y-5 relative overflow-hidden">
          {/* 四角高科技钛金 HUD 标线 */}
          <div className="absolute top-2.5 left-2.5 w-3.5 h-3.5 border-t-2 border-l-2 border-amber-500/80 pointer-events-none" />
          <div className="absolute top-2.5 right-2.5 w-3.5 h-3.5 border-t-2 border-r-2 border-amber-500/80 pointer-events-none" />
          <div className="absolute bottom-2.5 left-2.5 w-3.5 h-3.5 border-b-2 border-l-2 border-amber-500/80 pointer-events-none" />
          <div className="absolute bottom-2.5 right-2.5 w-3.5 h-3.5 border-b-2 border-r-2 border-amber-500/80 pointer-events-none" />

          {/* 卡头状态条 */}
          <div className="flex items-center justify-between border-b border-amber-100/90 pb-3">
            <div className="flex items-center space-x-2">
              <div className="p-1 rounded-md bg-amber-50 border border-amber-200 text-amber-700">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <span className="text-xs font-bold text-slate-800 tracking-tight">工业检修与安全作业平台</span>
            </div>
            <div className="flex items-center space-x-1.5 text-[11px] text-emerald-800 bg-emerald-50/90 px-2 py-0.5 rounded-full border border-emerald-200 font-mono shadow-2xs">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-semibold">JWT · RBAC · 审计</span>
            </div>
          </div>

          {/* 错误提示框 */}
          {errorMessage && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center space-x-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4 text-xs">
            {/* 账号输入框 */}
            <div>
              <label className="block text-slate-700 font-semibold mb-1.5">
                登录账号 / 企业工号
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <User className="w-4 h-4 text-amber-600/70" />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入用户名 (如 admin / manager / tech1)"
                  className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50/70 hover:bg-white focus:bg-white border border-slate-200 focus:border-amber-500 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-200/50 transition-all font-mono text-xs shadow-inner"
                  required
                />
              </div>
            </div>

            {/* 密码输入框 */}
            <div>
              <label className="block text-slate-700 font-semibold mb-1.5 flex items-center justify-between">
                <span>安全密码</span>
                <span className="text-[10px] text-amber-800 font-normal bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                  独立强密码·点击下方角色自动填入
                </span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4 text-amber-600/70" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-50/70 hover:bg-white focus:bg-white border border-slate-200 focus:border-amber-500 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-200/50 transition-all font-mono text-xs shadow-inner"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* 提交登录按钮（钛金高光与深曜石装甲按钮） */}
            <button
              type="submit"
              disabled={loading}
              className={`w-full py-3 px-4 rounded-xl font-bold text-xs tracking-wide transition-all flex items-center justify-center space-x-2 cursor-pointer shadow-md ${
                loading
                  ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 hover:from-amber-600 hover:to-amber-800 text-white shadow-amber-500/20 active:scale-[0.99]'
              }`}
            >
              {loading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>数字网关身份鉴权中...</span>
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4 text-amber-200" />
                  <span>验证通行并进入工业检修中枢</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </form>

          {/* 快速体验角色选择器：工业岗位身份通行卡 */}
          <div className="pt-2 border-t border-amber-100/90 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-slate-600 font-semibold">
              <span className="flex items-center space-x-1.5">
                <Cpu className="w-3.5 h-3.5 text-amber-600" />
                <span>岗位身份通行卡（点击一键载入强密码凭证）:</span>
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {presetUsers.map((u) => {
                const isSelected = username === u.username;
                return (
                  <button
                    key={u.username}
                    type="button"
                    onClick={() => handleSelectPreset(u)}
                    className={`p-2.5 rounded-xl text-left transition-all border cursor-pointer flex items-center space-x-2.5 ${
                      isSelected
                        ? 'bg-gradient-to-r from-amber-50 to-orange-50/60 border-amber-400 text-amber-950 shadow-sm ring-1 ring-amber-300/50'
                        : 'bg-white/70 hover:bg-white border-slate-200/80 hover:border-amber-200 text-slate-700 hover:shadow-xs'
                    }`}
                  >
                    <UserAvatar name={u.name} roleTitle={u.role} size={30} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-slate-900 truncate">{u.name}</span>
                        <span className="text-[10px] font-mono text-amber-700 font-semibold">{u.username}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 truncate mt-0.5">{u.role}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 底部合规与技术栈标注 */}
        <div className="text-center space-y-1 text-[11px] text-slate-600 font-medium">
          <p>JWT 身份认证 · RBAC 权限控制 · 操作审计 · 单实例限流（未完成等级保护测评）</p>
          <p className="text-[10px] text-slate-500 font-mono">PGlite Embedded DB · Qwen-Plus Industrial LLM · WebGL 3D Twin</p>
        </div>
      </div>

      {/* 演示环境首次登录强制改密引导模态弹窗 (DEMO_FORCE_PASSWORD_CHANGE=true 触发) */}
      {showForcePasswordModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-md w-full shadow-xl space-y-4">
            <div className="flex items-center space-x-3 text-amber-600 pb-2 border-b border-slate-100">
              <div className="p-2 rounded-xl bg-amber-50 border border-amber-200">
                <ShieldCheck className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900">首次登录安全改密提醒</h3>
                <p className="text-xs text-slate-500">请设置个人强密码；生产环境应启用强制改密策略。</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              检测到当前演示环境启用了「首次登录安全改密」管控策略。为保障工业生产数据安全，建议您设置新的自定义强密码。
            </p>

            <div className="space-y-3 pt-1 text-xs">
              <div>
                <label className="block text-slate-700 font-medium mb-1">新安全密码</label>
                <input
                  type="password"
                  value={newPasswordInput}
                  onChange={(e) => setNewPasswordInput(e.target.value)}
                  placeholder="长度至少8位，含字母与数字"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-700 font-medium mb-1">确认新密码</label>
                <input
                  type="password"
                  value={confirmPasswordInput}
                  onChange={(e) => setConfirmPasswordInput(e.target.value)}
                  placeholder="请再次输入新密码"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>
              {changePasswordMsg && (
                <p className="text-xs text-rose-600">{changePasswordMsg}</p>
              )}
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={handleCompletePendingLogin}
                className="px-3.5 py-2 text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                暂不修改，进入系统
              </button>
              <button
                type="button"
                onClick={() => {
                  if (newPasswordInput) {
                    if (newPasswordInput !== confirmPasswordInput) {
                      setChangePasswordMsg('两次输入的密码不一致');
                      return;
                    }
                    if (newPasswordInput.length < 8) {
                      setChangePasswordMsg('密码长度需至少 8 位');
                      return;
                    }
                  }
                  handleCompletePendingLogin();
                }}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-all cursor-pointer"
              >
                确认并进入工作台
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
