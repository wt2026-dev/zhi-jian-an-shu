import { useCallback, useEffect, useRef, useState } from 'react';
import {
  equipmentApi,
  aiPipelineApi,
  AiPipelineTask,
  AiPipelineListItem,
} from '../../api';
import { Equipment } from '../../types';

export function useAiPipeline() {
  const [equipments, setEquipments] = useState<Equipment[]>([]);
  const [equipmentId, setEquipmentId] = useState('');
  const [problem, setProblem] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [task, setTask] = useState<AiPipelineTask | null>(null);
  const [recentTasks, setRecentTasks] = useState<AiPipelineListItem[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const taskSectionRef = useRef<HTMLDivElement>(null);

  const loadRecentTasks = useCallback(async () => {
    setLoadingRecent(true);
    try {
      const res = await aiPipelineApi.list(5);
      setRecentTasks(res.tasks || []);
    } catch {
      // 容错处理，不中断界面
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  useEffect(() => {
    equipmentApi
      .list()
      .then((list) => {
        setEquipments(list || []);
        if (list?.length) setEquipmentId((prev) => prev || list[0].id);
      })
      .catch(() => setError('设备列表加载失败，请刷新重试'));

    void Promise.resolve().then(loadRecentTasks);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadRecentTasks]);

  const isTerminal = task?.status === 'completed' || task?.status === 'failed';

  // 轮询任务进度（后端另提供 GET /events SSE 推送，供大屏/小程序消费）
  const startPolling = useCallback((taskId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await aiPipelineApi.getById(taskId);
        setTask(res.task);
        if (res.task.status === 'completed' || res.task.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          loadRecentTasks();
        }
      } catch {
        /* 单次轮询失败忽略，下一轮重试 */
      }
    }, 2000);
  }, [loadRecentTasks]);

  const handleStart = async () => {
    if (!equipmentId || problem.trim().length < 2) {
      setError('请选择设备并填写至少 2 个字符的问题描述');
      return;
    }
    setError(null);
    setStarting(true);
    setTask(null);
    try {
      const res = await aiPipelineApi.create({ equipmentId, problemDescription: problem.trim() });
      const initial = await aiPipelineApi.getById(res.taskId);
      setTask(initial.task);
      startPolling(res.taskId);
      loadRecentTasks();
      setTimeout(() => {
        taskSectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      }, 50);
    } catch (e: unknown) {
      const err = e as { data?: { message?: string }; message?: string };
      setError(err?.data?.message || err?.message || '启动协同任务失败，请稍后重试');
    } finally {
      setStarting(false);
    }
  };

  const handleSelectRecentTask = async (taskId: string) => {
    setLoadingTaskId(taskId);
    setError(null);
    try {
      const res = await aiPipelineApi.getById(taskId);
      setTask(res.task);
      if (res.task.status === 'running' || res.task.status === 'pending') {
        startPolling(res.task.id);
      } else if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      setTimeout(() => {
        taskSectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      }, 50);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err?.message || '加载任务详情失败');
    } finally {
      setLoadingTaskId(null);
    }
  };

  const report = task?.result?.report;

  return {
    equipments,
    equipmentId,
    setEquipmentId,
    problem,
    setProblem,
    starting,
    error,
    setError,
    task,
    setTask,
    recentTasks,
    loadingRecent,
    loadingTaskId,
    taskSectionRef,
    isTerminal,
    report,
    loadRecentTasks,
    handleStart,
    handleSelectRecentTask,
  };
}
