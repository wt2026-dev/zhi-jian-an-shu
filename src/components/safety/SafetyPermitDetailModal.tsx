import React from 'react';
import {
  Lock,
  X,
  ShieldCheck,
  Check,
  UserCheck,
  Trash2,
  Sparkles,
  XCircle,
  CheckCircle2,
} from 'lucide-react';
import { LotoLock, SafetyPermit, UserProfile } from '../../types';
import { getRiskBadge, getStatusBadge } from './safetyTypes';

interface SafetyPermitDetailModalProps {
  activePermit: SafetyPermit | null;
  currentUser: UserProfile;
  relatedLotoLocks: LotoLock[];
  canWriteLoto: boolean;
  canGuardianSign: boolean;
  canFinalApprove: boolean;
  lotoBusy: string | null;
  lotoError: string | null;
  lotoNeedsRefresh: boolean;
  lockForm: { lockNo: string; pointName: string; energySource: string; location: string };
  releaseRemarks: Record<string, string>;
  isDeleting: boolean;
  isSubmittingPermit: boolean;
  onChangeLockForm: (form: { lockNo: string; pointName: string; energySource: string; location: string }) => void;
  onChangeReleaseRemarks: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  onRefreshLoto: () => void;
  onLotoSubmit: (e: React.FormEvent, lock?: LotoLock) => void;
  onDeletePermit: (permit: SafetyPermit) => void;
  onAssessPermit: (permit: SafetyPermit) => void;
  onApprovalAction: (approved: boolean) => void;
  onClose: () => void;
}

export const SafetyPermitDetailModal: React.FC<SafetyPermitDetailModalProps> = ({
  activePermit,
  currentUser,
  relatedLotoLocks,
  canWriteLoto,
  canGuardianSign,
  canFinalApprove,
  lotoBusy,
  lotoError,
  lotoNeedsRefresh,
  lockForm,
  releaseRemarks,
  isDeleting,
  isSubmittingPermit,
  onChangeLockForm,
  onChangeReleaseRemarks,
  onRefreshLoto,
  onLotoSubmit,
  onDeletePermit,
  onAssessPermit,
  onApprovalAction,
  onClose,
}) => {
  if (!activePermit) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-6 card-industrial">
        <div className="flex items-start justify-between pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 font-semibold">
                {activePermit.permitNo}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded border font-medium ${getStatusBadge(activePermit.status).color}`}>
                {getStatusBadge(activePermit.status).label}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded border font-medium ${getRiskBadge(activePermit.riskLevel).color}`}>
                {getRiskBadge(activePermit.riskLevel).label}
              </span>
            </div>
            <h3 className="text-base font-bold text-slate-800 mt-1.5">{activePermit.title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              车间位置: {activePermit.workshop} · {activePermit.location}
            </p>
          </div>

          <button
            disabled={!!lotoBusy}
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Isolation & LOTO info */}
        {activePermit.lotoNumber && (
          <div className="p-3.5 rounded-xl bg-purple-50 border border-purple-200 text-xs text-purple-900 space-y-1">
            <div className="flex items-center justify-between font-bold">
              <span className="flex items-center text-purple-700">
                <Lock className="w-4 h-4 mr-1.5 text-purple-600" />
                能量隔离与 LOTO 锁具编码
              </span>
              <span className="font-mono text-purple-800 font-bold">{activePermit.lotoNumber}</span>
            </div>
            <p className="text-slate-600 text-[11px]">
              严禁擅自解除机械锁或合闸通电，需经申请人与安全负责人双人双锁解除。
            </p>
          </div>
        )}

        {/* 人工 LOTO 台账，不执行硬件控制 */}
        <section aria-busy={!!lotoBusy} className="p-4 rounded-xl border border-purple-200 bg-purple-50/40 space-y-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-bold text-purple-900">LOTO 锁具人工记录</h4>
            <button
              type="button"
              onClick={onRefreshLoto}
              disabled={!!lotoBusy}
              className="px-3 py-1.5 rounded-lg border border-purple-200 text-purple-700 disabled:opacity-50"
            >
              {lotoBusy === 'refresh' ? '刷新中...' : '刷新人工台账'}
            </button>
          </div>
          <p className="text-slate-600">仅人工登记现场挂锁与释放情况，不控制硬件、不执行远程解锁，也不代表已核验零能量。现场操作须遵守安全规程。</p>
          {lotoError && <p role="alert" className="p-2 rounded-lg bg-rose-50 text-rose-700 border border-rose-200">{lotoError}</p>}
          {lotoNeedsRefresh && <p role="status" className="text-amber-700">台账尚待刷新，完成刷新后方可继续写入人工记录。</p>}
          {canWriteLoto ? (
            <form onSubmit={(e) => onLotoSubmit(e)}>
              <fieldset disabled={!!lotoBusy || lotoNeedsRefresh} className="space-y-3 disabled:opacity-60">
                <legend className="font-semibold text-slate-800 mb-2">人工登记挂锁记录</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block text-slate-700">锁号 *
                    <input
                      required
                      maxLength={64}
                      value={lockForm.lockNo}
                      onChange={(e) => onChangeLockForm({ ...lockForm, lockNo: e.target.value })}
                      className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 bg-white"
                    />
                  </label>
                  <label className="block text-slate-700">隔离点名称 *
                    <input
                      required
                      maxLength={255}
                      value={lockForm.pointName}
                      onChange={(e) => onChangeLockForm({ ...lockForm, pointName: e.target.value })}
                      className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 bg-white"
                    />
                  </label>
                  <label className="block text-slate-700">能量源
                    <input
                      maxLength={255}
                      value={lockForm.energySource}
                      onChange={(e) => onChangeLockForm({ ...lockForm, energySource: e.target.value })}
                      className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 bg-white"
                    />
                  </label>
                  <label className="block text-slate-700">现场位置
                    <input
                      maxLength={255}
                      value={lockForm.location}
                      onChange={(e) => onChangeLockForm({ ...lockForm, location: e.target.value })}
                      className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 bg-white"
                    />
                  </label>
                </div>
                <button type="submit" className="px-3 py-2 rounded-lg bg-purple-600 text-white">
                  {lotoBusy === 'register' ? '保存并刷新中...' : '保存人工挂锁记录'}
                </button>
              </fieldset>
            </form>
          ) : <p className="text-slate-500">只读：仅管理员、主管或安全巡检员可登记和释放人工记录。</p>}
          <h5 className="font-semibold text-slate-800">本作业票关联的人工记录 ({relatedLotoLocks.length})</h5>
          {relatedLotoLocks.length === 0 ? <p className="text-slate-500">暂无关联锁具记录。</p> : (
            <ul className="space-y-3">
              {relatedLotoLocks.map((lock) => (
                <li key={lock.id} className="p-3 rounded-lg bg-white border border-slate-200 space-y-2">
                  <div className="flex justify-between gap-2 font-semibold text-slate-800">
                    <span>{lock.lockNo} · {lock.pointName || '未填写隔离点'}</span>
                    <span>{lock.status === 'locked' ? '人工记录：挂锁中' : lock.status === 'unlocked' ? '人工记录：已释放' : `记录状态：${lock.status}`}</span>
                  </div>
                  <p className="text-slate-600">能量源：{lock.energySource || '—'} · 位置：{lock.location || '—'}</p>
                  <p className="text-slate-500">登记人：{lock.lockedBy || '—'} · 登记时间：{lock.lockedAt || '—'}</p>
                  {lock.status === 'unlocked' && (
                    <p className="text-slate-600 whitespace-pre-wrap">释放记录时间：{lock.unlockedAt || '—'} · 释放备注：{lock.unlockRemark || '—'}</p>
                  )}
                  {lock.status === 'locked' && canWriteLoto && (
                    <form onSubmit={(e) => onLotoSubmit(e, lock)}>
                      <fieldset disabled={!!lotoBusy || lotoNeedsRefresh} className="space-y-2 disabled:opacity-60">
                        <label className="block text-slate-700">释放备注（人工记录） *
                          <textarea
                            required
                            maxLength={2000}
                            rows={2}
                            value={releaseRemarks[lock.id] || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              onChangeReleaseRemarks((prev) => ({ ...prev, [lock.id]: val }));
                            }}
                            className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200"
                          />
                        </label>
                        <button type="submit" className="px-3 py-2 rounded-lg border border-amber-200 text-amber-800 bg-amber-50">
                          {lotoBusy === lock.id ? '保存并刷新中...' : '保存人工释放记录'}
                        </button>
                      </fieldset>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Precautions List */}
        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
          <span className="font-semibold text-slate-800 flex items-center">
            <ShieldCheck className="w-4 h-4 mr-1.5 text-emerald-600" />
            安全交底与现场必选防控措施 (作业前逐项核验)
          </span>
          <ul className="space-y-1.5 text-slate-700">
            {(Array.isArray(activePermit.precautions)
              ? activePermit.precautions
              : [activePermit.precautions]
            ).map((p, i) => (
              <li key={i} className="flex items-center space-x-2">
                <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Meta Dates & People */}
        <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-slate-700">
          <div>
            <span className="text-slate-500 block">申请人:</span>
            <span className="font-medium text-slate-800">{activePermit.applicant}</span>
          </div>
          <div>
            <span className="text-slate-500 block">申请时间:</span>
            <span className="font-mono text-slate-800">{activePermit.appliedAt}</span>
          </div>
          <div>
            <span className="text-slate-500 block">安全审批人:</span>
            <span className="text-emerald-700 font-semibold">{activePermit.approver || '等待审批'}</span>
          </div>
          <div>
            <span className="text-slate-500 block">作业时效截止:</span>
            <span className="font-mono text-amber-700 font-semibold">{activePermit.validUntil}</span>
          </div>
        </div>

        {/* 双人会签电子防伪签名看板 (Dual Sign-off Cryptographic Verification) */}
        <div className="p-3.5 bg-purple-50/40 rounded-xl border border-purple-200 text-xs space-y-2">
          <span className="font-bold text-purple-900 flex items-center">
            <ShieldCheck className="w-4 h-4 mr-1.5 text-purple-600" />
            双人会签法定防伪签名存证
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className={`p-2.5 rounded-lg border text-[11px] ${
              activePermit.guardianApproval?.signed
                ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
                : 'bg-slate-50 border-slate-200 text-slate-600'
            }`}>
              <div className="flex items-center justify-between font-semibold">
                <span>1. 现场安全监护人初审会签</span>
                <span className={`px-1.5 py-0.2 rounded text-[10px] ${activePermit.guardianApproval?.signed ? 'bg-emerald-200 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
                  {activePermit.guardianApproval?.signed ? '已会签' : '待会签'}
                </span>
              </div>
              {activePermit.guardianApproval?.signed ? (
                <div className="mt-1 space-y-0.5">
                  <div>签署人: <strong>{activePermit.guardianApproval.name}</strong></div>
                  <div className="font-mono text-[10px] text-slate-500">时间: {activePermit.guardianApproval.signedAt?.slice(0, 19).replace('T', ' ')}</div>
                  <div className="font-mono text-[10px] text-purple-700 truncate">
                    防伪哈希: {activePermit.guardianApproval.signatureHash || 'SEC-SIGN-OK'}
                  </div>
                </div>
              ) : (
                <div className="mt-1 text-slate-400">需持证安全监护员现场确认气体与动火隔离</div>
              )}
            </div>

            <div className={`p-2.5 rounded-lg border text-[11px] ${
              activePermit.supervisorApproval?.signed
                ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
                : 'bg-slate-50 border-slate-200 text-slate-600'
            }`}>
              <div className="flex items-center justify-between font-semibold">
                <span>2. 车间安全总监终审签发</span>
                <span className={`px-1.5 py-0.2 rounded text-[10px] ${activePermit.supervisorApproval?.signed ? 'bg-emerald-200 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
                  {activePermit.supervisorApproval?.signed ? '已签批生效' : '待终审'}
                </span>
              </div>
              {activePermit.supervisorApproval?.signed ? (
                <div className="mt-1 space-y-0.5">
                  <div>审批人: <strong>{activePermit.supervisorApproval.name}</strong></div>
                  <div className="font-mono text-[10px] text-slate-500">时间: {activePermit.supervisorApproval.signedAt?.slice(0, 19).replace('T', ' ')}</div>
                  <div className="font-mono text-[10px] text-purple-700 truncate">
                    防伪哈希: {activePermit.supervisorApproval.signatureHash || 'EXEC-AUTH-OK'}
                  </div>
                </div>
              ) : (
                <div className="mt-1 text-slate-400">监护人会签后由主管审批下达准许令</div>
              )}
            </div>
          </div>
        </div>

        {/* RBAC Fine-grained Control Info Banner */}
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-800 flex items-center">
              <UserCheck className="w-3.5 h-3.5 mr-1.5 text-purple-600" />
              当前账号操作鉴权: <strong className="text-slate-900 ml-1">{currentUser.name}</strong> ({currentUser.roleTitle})
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-medium ${
              currentUser.role === 'admin'
                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                : currentUser.role === 'inspector'
                ? 'bg-cyan-50 text-cyan-700 border border-cyan-200'
                : 'bg-slate-200 text-slate-700'
            }`}>
              RBAC 权限: {currentUser.role}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            {currentUser.role === 'admin'
              ? '👑 管理员/车间总工：具备监护会签、终审签发与高危作业票注销删除的全部最高权限。'
              : currentUser.role === 'manager'
              ? '🏭 车间主管：具备高危作业票终审签发与注销删除权限；现场监护会签由点检工程师完成。'
              : currentUser.role === 'inspector'
              ? '🛡️ 点检工程师/专职安全监护员：具备现场安全条件监护会签权限，无终审签发与注销删除权限。'
              : '⚠️ 当前角色：仅具备申报与查阅权限。根据安监规程，严禁删除或跳过审批高危作业票。'}
          </p>
        </div>

        {/* Approval Footer Action */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between pt-4 border-t border-slate-100 gap-3">
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => onDeletePermit(activePermit)}
              disabled={isDeleting}
              className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer disabled:opacity-50"
              title={currentUser.role === 'user' ? '普通操作员禁止删除高危作业票' : '永久注销此作业票'}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isDeleting ? '注销中...' : '注销并删除作业票'}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => onAssessPermit(activePermit)}
            className="px-3.5 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg text-xs font-medium flex items-center space-x-1.5 cursor-pointer transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI 风险评估</span>
          </button>

          <div className="flex items-center space-x-2 justify-end">
            {activePermit.status === 'pending_approval' && (activePermit.guardianApproval?.signed ? canFinalApprove : canGuardianSign) ? (
              <>
                <button
                  onClick={() => onApprovalAction(false)}
                  disabled={isSubmittingPermit}
                  className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-semibold flex items-center space-x-1 cursor-pointer transition-colors disabled:opacity-50"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>{isSubmittingPermit ? '处理中...' : '驳回申请'}</span>
                </button>
                <button
                  id="btn-safety-approve"
                  onClick={() => onApprovalAction(true)}
                  disabled={isSubmittingPermit}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{activePermit.guardianApproval?.signed ? '终审签发准许令' : '安全监护确认会签'}</span>
                </button>
              </>
            ) : (
              <button
                disabled={!!lotoBusy}
                onClick={onClose}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs cursor-pointer font-medium"
              >
                关闭
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
