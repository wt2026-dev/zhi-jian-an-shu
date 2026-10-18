import { useState, useEffect, useCallback } from 'react';
import { adminAiReviewApi, AiGenerationReview, AiAnalysisTraceLog } from '../../api';

export function useAdminAiReviews() {
  const [mainTab, setMainTab] = useState<'reviews' | 'traceability'>('reviews');
  const [reviews, setReviews] = useState<AiGenerationReview[]>([]);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [counts, setCounts] = useState({
    pending: 0,
    approved: 0,
    rejected: 0,
    all: 0,
  });
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<AiGenerationReview | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 版本追溯日志相关状态
  const [traceLogs, setTraceLogs] = useState<AiAnalysisTraceLog[]>([]);
  const [traceLoading, setTraceLoading] = useState(false);
  const [modelFilter, setModelFilter] = useState<string>('all');
  const [traceDetail, setTraceDetail] = useState<AiAnalysisTraceLog | null>(null);

  const fetchTraceLogs = useCallback(async (model?: string) => {
    setTraceLoading(true);
    try {
      const logs = await adminAiReviewApi.listTraceLogs(model && model !== 'all' ? model : undefined);
      setTraceLogs(logs || []);
    } catch (e: unknown) {
      const err = e as { data?: { message?: string }; message?: string };
      setError(err?.data?.message || err?.message || '获取追溯日志失败');
    } finally {
      setTraceLoading(false);
    }
  }, []);

  const fetchCounts = useCallback(async () => {
    try {
      const allList = await adminAiReviewApi.list();
      const list = allList || [];
      setCounts({
        pending: list.filter((r) => r.status === 'pending').length,
        approved: list.filter((r) => r.status === 'approved').length,
        rejected: list.filter((r) => r.status === 'rejected').length,
        all: list.length,
      });
    } catch {
      // 容错处理
    }
  }, []);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const list = await adminAiReviewApi.list(
        statusFilter === 'all' ? undefined : (statusFilter as 'pending' | 'approved' | 'rejected')
      );
      setReviews(list || []);
      setError(null);
    } catch (e: unknown) {
      const err = e as { data?: { message?: string }; message?: string };
      setError(err?.data?.message || err?.message || '审核列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      await fetchCounts();
    });
    return () => {
      active = false;
    };
  }, [fetchCounts]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      if (mainTab === 'reviews') {
        await fetchList();
      } else {
        await fetchTraceLogs(modelFilter);
      }
    });
    return () => {
      active = false;
    };
  }, [statusFilter, mainTab, modelFilter, fetchList, fetchTraceLogs]);

  const handleApprove = async (id: string) => {
    setActing(true);
    try {
      await adminAiReviewApi.approve(id);
      setDetail((d) => (d && d.id === id ? { ...d, status: 'approved' } : d));
      await fetchList();
      await fetchCounts();
    } catch (e: unknown) {
      const err = e as { data?: { message?: string }; message?: string };
      setError(err?.data?.message || err?.message || '审核通过失败');
    } finally {
      setActing(false);
    }
  };

  const handleReject = async () => {
    if (!detail || !rejectNote.trim()) return;
    setActing(true);
    try {
      await adminAiReviewApi.reject(detail.id, rejectNote.trim());
      setRejectOpen(false);
      setRejectNote('');
      setDetail((d) => (d ? { ...d, status: 'rejected' } : d));
      await fetchList();
      await fetchCounts();
    } catch (e: unknown) {
      const err = e as { data?: { message?: string }; message?: string };
      setError(err?.data?.message || err?.message || '驳回失败');
    } finally {
      setActing(false);
    }
  };

  return {
    mainTab,
    setMainTab,
    reviews,
    statusFilter,
    setStatusFilter,
    counts,
    loading,
    detail,
    setDetail,
    rejectOpen,
    setRejectOpen,
    rejectNote,
    setRejectNote,
    acting,
    error,
    traceLogs,
    traceLoading,
    modelFilter,
    setModelFilter,
    traceDetail,
    setTraceDetail,
    fetchTraceLogs,
    fetchCounts,
    fetchList,
    handleApprove,
    handleReject,
  };
}
