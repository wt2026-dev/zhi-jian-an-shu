import React, { useContext, useState, useRef } from 'react';
import { LotoLock, SafetyPermit, UserProfile } from '../../types';
import { safetyPermitApi } from '../../api';
import AppDataContext from '../../context/AppDataContext';

interface UseLotoManagementProps {
  currentUser: UserProfile;
  lotoLocks?: LotoLock[];
  activePermit: SafetyPermit | null;
}

export function useLotoManagement({ currentUser, lotoLocks, activePermit }: UseLotoManagementProps) {
  const appData = useContext(AppDataContext);
  const [fallbackLotoLocks, setFallbackLotoLocks] = useState<LotoLock[] | null>(null);
  const lotoLockList = appData?.lotoLocks ?? fallbackLotoLocks ?? lotoLocks ?? [];

  const refreshLotoLocks = async () => {
    if (appData) {
      await appData.refreshLotoLocks();
    } else {
      const locks = await safetyPermitApi.getLotoLocks();
      if (!Array.isArray(locks)) throw new Error('LOTO 台账响应格式错误');
      setFallbackLotoLocks(locks);
    }
  };

  const prevPermitIdRef = useRef<string | null>(null);
  const [lockForm, setLockForm] = useState({ lockNo: '', pointName: '', energySource: '', location: '' });
  const [releaseRemarks, setReleaseRemarks] = useState<Record<string, string>>({});
  const [lotoBusy, setLotoBusy] = useState<string | null>(null);
  const [lotoError, setLotoError] = useState<string | null>(null);
  const [lotoNeedsRefresh, setLotoNeedsRefresh] = useState(false);

  // Synchronize active permit reset on change without synchronous effect setState
  if (activePermit?.id !== prevPermitIdRef.current) {
    prevPermitIdRef.current = activePermit?.id ?? null;
    if (lockForm.lockNo || lockForm.pointName || Object.keys(releaseRemarks).length > 0 || lotoError) {
      setLockForm({ lockNo: '', pointName: '', energySource: '', location: '' });
      setReleaseRemarks({});
      setLotoError(null);
    }
  }

  const canWriteLoto = ['admin', 'manager', 'inspector'].includes(currentUser.role);

  const handleLotoSubmit = async (e: React.FormEvent, lock?: LotoLock) => {
    e.preventDefault();
    if (!activePermit || lotoBusy || lotoNeedsRefresh) return;
    if (!canWriteLoto) {
      setLotoError('仅管理员、主管或安全巡检员可写入人工记录');
      return;
    }
    const unlockRemark = lock ? (releaseRemarks[lock.id] || '').trim() : '';
    if (lock ? !unlockRemark : !lockForm.lockNo.trim() || !lockForm.pointName.trim()) {
      setLotoError(lock ? '请填写释放备注' : '请填写锁号和隔离点名称');
      return;
    }
    if (lock && (lock.permitNo !== activePermit.permitNo || lock.status !== 'locked')) return;
    setLotoBusy(lock?.id || 'register');
    setLotoError(null);
    let recorded = false;
    try {
      if (lock) {
        await safetyPermitApi.releaseLotoLock(lock.id, { unlockRemark });
      } else {
        await safetyPermitApi.registerLotoLock({
          lockNo: lockForm.lockNo.trim(),
          permitNo: activePermit.permitNo,
          pointName: lockForm.pointName.trim(),
          energySource: lockForm.energySource.trim() || undefined,
          location: lockForm.location.trim() || undefined,
        });
      }
      recorded = true;
      setLotoNeedsRefresh(true);
      if (lock) setReleaseRemarks((prev) => ({ ...prev, [lock.id]: '' }));
      else setLockForm({ lockNo: '', pointName: '', energySource: '', location: '' });
      await refreshLotoLocks();
      setLotoNeedsRefresh(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '请求失败，请稍后重试';
      setLotoError(recorded ? `人工记录已保存，但台账刷新失败，请重试刷新，勿重复提交。${message}` : message);
    } finally {
      setLotoBusy(null);
    }
  };

  const handleRefreshLoto = async () => {
    if (lotoBusy) return;
    setLotoBusy('refresh');
    setLotoError(null);
    try {
      await refreshLotoLocks();
      setLotoNeedsRefresh(false);
    } catch (err: unknown) {
      setLotoError(err instanceof Error ? err.message : '台账刷新失败，请重试');
    } finally {
      setLotoBusy(null);
    }
  };

  const activeLotoLocks = lotoLockList.filter((l) => l.status === 'locked');
  const relatedLotoLocks = lotoLockList.filter((l) => l.permitNo === activePermit?.permitNo);

  return {
    lotoLockList,
    activeLotoLocks,
    relatedLotoLocks,
    lockForm,
    setLockForm,
    releaseRemarks,
    setReleaseRemarks,
    lotoBusy,
    lotoError,
    lotoNeedsRefresh,
    canWriteLoto,
    handleLotoSubmit,
    handleRefreshLoto,
  };
}
