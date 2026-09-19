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

// 演示环境各角色独立强密码配置 (参照等保三级设计的独立密码)
const DEMO_CREDENTIALS: Record<string, string> = {
  admin: 'Admin@2026#Demo',
  manager: 'Manager@2026#Safe',
  tech1: 'Tech1@2026#Work',
  inspector: 'Inspect@2026#Check',
  operator: 'Operator@2026#Line',
  archivist: 'Archive@2026#Doc',
  operator2: 'Operator2@2026#Lift',
};

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('Admin@2026#Demo');
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
  const presetUsers = [
    { username: 'admin', name: '陈建平', role: '总工 / 机电部长', badgeColor: 'bg-red-50 text-red-700 border-red-200' },
    { username: 'manager', name: '陈主管', role: '车间安全总监 / 维保主管', badgeColor: 'bg-purple-50 text-purple-700 border-purple-200' },
    { username: 'tech1', name: '张建国', role: '机电检修高级技师', badgeColor: 'bg-blue-50 text-blue-700 border-blue-200' },
    { username: 'inspector', name: '赵安全', role: '点检工程师 / 安全监护', badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    { username: 'operator', name: '王操作', role: '现场岗位操作工', badgeColor: 'bg-amber-50 text-amber-700 border-amber-200' },
    { username: 'archivist', name: '吴晓芳', role: '技术档案管理员', badgeColor: 'bg-teal-50 text-teal-700 border-teal-200' },
    { username: 'operator2', name: '周大伟', role: '起重机械操作 / 吊装司机', badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
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

  const handleSelectPreset = (uname: string) => {
    setUsername(uname);
    setPassword(DEMO_CREDENTIALS[uname] || 'Admin@2026#Demo');
    setErrorMessage(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col justify-center items-center p-4 relative overflow-hidden selection:bg-blue-500 selection:text-white">
      {/* 极简高科技网格背景 */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f080_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f080_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />

      <div className="w-full max-w-md relative z-10 space-y-6 animate-in fade-in zoom-in-95 duration-200">
        {/* 系统标志与主标题 */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center mb-1">
            <Logo size="lg" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 flex items-center justify-center space-x-2">
            <span>庖丁智驭 PaoDing SmartOps</span>
          </h1>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            工业现场状态机互斥 · 高危作业票会签 · Chroma RAG 知识检索 · 设备劣化趋势预警
          </p>
        </div>

        {/* 登录卡片 */}
        <div className="card-industrial bg-white border border-slate-200 rounded-lg p-6 sm:p-7 shadow-sm space-y-5 relative">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-semibold text-slate-800">企业级安全网关认证</span>
            </div>
            <div className="flex items-center space-x-1.5 text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="font-medium">JWT RBAC 在线</span>
            </div>
          </div>

          {/* 错误提示框 */}
          {errorMessage && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center space-x-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4 text-xs">
            {/* 账号输入框 */}
            <div>
              <label className="block text-slate-700 font-medium mb-1.5">
                登录账号 / 工号
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入用户名 (如 admin / manager / tech1)"
                  className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-mono text-xs"
                  required
                />
              </div>
            </div>

            {/* 密码输入框 */}
            <div>
              <label className="block text-slate-700 font-medium mb-1.5 flex items-center justify-between">
                <span>登录密码</span>
                <span className="text-[10px] text-slate-500 font-normal">各角色独立强密码（点击预设自动填入）</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  className="w-full pl-9 pr-10 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-mono text-xs"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-slate-600 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* 提交登录按钮 */}
            <button
              type="submit"
              disabled={loading}
              className={`w-full py-2.5 px-4 rounded-lg font-semibold text-xs transition-all flex items-center justify-center space-x-2 cursor-pointer shadow-sm ${
                loading
                  ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white active:scale-[0.99]'
              }`}
            >
              {loading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>安全网关身份验证中...</span>
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4" />
                  <span>登录系统进入检修工作台</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </form>

          {/* 快速体验角色选择器 */}
          <div className="pt-2 border-t border-slate-100 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
              <span className="flex items-center space-x-1">
                <Cpu className="w-3.5 h-3.5 text-blue-600" />
                <span>预设角色账号快捷填入 (演示与多岗位切换):</span>
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {presetUsers.map((u) => (
                <button
                  key={u.username}
                  type="button"
                  onClick={() => handleSelectPreset(u.username)}
                  className={`p-2 rounded-lg text-left transition-all border cursor-pointer flex items-center space-x-2.5 ${
                    username === u.username
                      ? 'bg-blue-50 border-blue-400 text-blue-900 shadow-xs'
                      : 'bg-slate-50/80 hover:bg-slate-100 border-slate-200 text-slate-700'
                  }`}
                >
                  <UserAvatar name={u.name} roleTitle={u.role} size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-slate-900 truncate">{u.name}</span>
                      <span className="text-[10px] font-mono text-blue-600">{u.username}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 truncate mt-0.5">{u.role}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 底部合规与技术栈标注 */}
        <div className="text-center space-y-1 text-[11px] text-slate-500">
          <p>工业互联网安全防护体系（参照等保三级规范设计） · 生产制造安全作业许可标准 GB 30871</p>
          <p className="text-[10px] text-slate-500">FastAPI + Redis Mutex + PostgreSQL 16 + ChromaDB RAG</p>
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
                <p className="text-xs text-slate-500">参照等保三级规范设计的安全基线 (DEMO_FORCE_PASSWORD_CHANGE=true)</p>
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
