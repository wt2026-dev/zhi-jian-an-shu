// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProceduresHeader } from '../../src/components/procedures/ProceduresHeader';
import { ProcedureListSidebar } from '../../src/components/procedures/ProcedureListSidebar';
import { ProcedureStepsSection } from '../../src/components/procedures/ProcedureStepsSection';
import { ProcedureVideoSection } from '../../src/components/procedures/ProcedureVideoSection';
import { ProcedureScriptModal } from '../../src/components/procedures/ProcedureScriptModal';
import { MaintenanceProcedure, ProcedureVideo, VideoScript } from '../../src/types';

describe('ProceduresView 模块化子组件单元测试', () => {
  afterEach(cleanup);

  const mockProcedure: MaintenanceProcedure = {
    id: 'proc-1',
    title: '离心泵机械密封更换规程',
    equipmentType: '水泵',
    maintenanceLevel: '二级检修',
    estimatedMinutes: 90,
    steps: [
      {
        step_no: 1,
        name: '能量隔离上锁挂牌',
        content: '切断进线电源并在断路器手柄悬挂LOTO锁具',
        tools: 'LOTO安全锁具、验电笔',
        safety: '确保回路零电压无残余电荷',
        acceptance: '验电确认三相无电',
      },
      {
        step_no: 2,
        name: '拆卸联轴器护罩',
        content: '卸下护罩固定螺栓并移开护罩',
        tools: '套筒扳手、呆扳手',
        safety: '佩戴防割手套防止边角划伤',
        acceptance: '紧固件分类收纳',
      },
    ],
  };

  it('ProceduresHeader 正确渲染标题、类型过滤与视频生成按钮', () => {
    const onSelectType = vi.fn();
    const onGenerateRealVideo = vi.fn();

    render(
      <ProceduresHeader
        activeProcedure={mockProcedure}
        generatingScript={false}
        generatingVideo={false}
        videoDuration={18}
        selectedType="all"
        selectedLevel="all"
        onSelectType={onSelectType}
        onSelectLevel={vi.fn()}
        onSetVideoDuration={vi.fn()}
        onOpenScriptModal={vi.fn()}
        onGenerateRealVideo={onGenerateRealVideo}
        onGenerateFullVideo={vi.fn()}
      />
    );

    expect(screen.getByText('工业标准化检修作业指引 (SOP)')).toBeDefined();
    expect(screen.getByText('强制合规互锁')).toBeDefined();

    // 点击设备类型过滤
    const pumpBtn = screen.getByText('水泵');
    fireEvent.click(pumpBtn);
    expect(onSelectType).toHaveBeenCalledWith('水泵');

    // 点击生成视频
    const genBtn = screen.getByText('生成18秒视频讲解');
    fireEvent.click(genBtn);
    expect(onGenerateRealVideo).toHaveBeenCalled();
  });

  it('ProcedureListSidebar 正确展示指引列表与进度', () => {
    const onSelectProcedureId = vi.fn();
    render(
      <ProcedureListSidebar
        procedures={[mockProcedure]}
        activeProcedureId="proc-1"
        completedSteps={{ 'proc-1': [1] }}
        onSelectProcedureId={onSelectProcedureId}
      />
    );

    expect(screen.getByText('匹配指引 (1)')).toBeDefined();
    expect(screen.getByText('离心泵机械密封更换规程')).toBeDefined();
    expect(screen.getByText('1/2')).toBeDefined();
  });

  it('ProcedureStepsSection 步骤卡片流渲染与合规互锁状态', () => {
    const onToggleStep = vi.fn();
    render(
      <ProcedureStepsSection
        activeProcedure={mockProcedure}
        checkedSteps={[1]}
        isAllStepsCompleted={false}
        onToggleStep={onToggleStep}
      />
    );

    expect(screen.getByText('能量隔离上锁挂牌')).toBeDefined();
    expect(screen.getByText('已完成达标')).toBeDefined();
    expect(screen.getByText('拆卸联轴器护罩')).toBeDefined();
    expect(screen.getByText('1/2')).toBeDefined();

    // 点击第2步
    const confirmBtn = screen.getByText('确认完成');
    fireEvent.click(confirmBtn);
    expect(onToggleStep).toHaveBeenCalledWith(2);
  });

  it('ProcedureVideoSection 正确渲染生成进度与历史视频记录', () => {
    const mockVideos: ProcedureVideo[] = [
      {
        id: 'vid-1',
        procedureId: 'proc-1',
        taskId: 'task-1001',
        videoUrl: 'https://example.com/video1.mp4',
        status: 'completed',
        createdAt: '2026-09-20T10:00:00.000Z',
      },
    ];

    const onSelectVideoUrl = vi.fn();

    render(
      <ProcedureVideoSection
        generatingVideo={true}
        videoStatusText="正在生成完整讲解视频..."
        videoError={null}
        videoSuccessNotice={null}
        currentTaskId="task-1002"
        currentActiveVideoUrl="https://example.com/video1.mp4"
        historyVideos={mockVideos}
        loadingVideos={false}
        internalStatus="rendering"
        elapsedSec={45}
        progressPct={50}
        canDeleteVideo={true}
        onRefreshVideos={vi.fn()}
        onCancelVideoTask={vi.fn()}
        onDismissSuccessNotice={vi.fn()}
        onRetryGenerate={vi.fn()}
        onSelectVideoUrl={onSelectVideoUrl}
        onDeleteVideo={vi.fn()}
      />
    );

    expect(screen.getByText('Agnes AI 实操视频')).toBeDefined();
    expect(screen.getByText('正在生成完整讲解视频...')).toBeDefined();
    expect(screen.getByText('渲染中')).toBeDefined();
    expect(screen.getByText('50%')).toBeDefined();
    expect(screen.getByText('历史记录 (1)')).toBeDefined();
  });

  it('ProcedureScriptModal 分镜弹窗交互', () => {
    const mockScript: VideoScript = {
      title: '离心泵分镜脚本',
      subtitles: ['切断进线电源', '拆卸护罩'],
      voiceover: ['请首先切断进线电源', '然后卸下联轴器护罩螺栓'],
    };

    const onClose = vi.fn();
    const onPlayPause = vi.fn();

    render(
      <ProcedureScriptModal
        isOpen={true}
        activeProcedure={mockProcedure}
        videoScript={mockScript}
        currentStepIndex={0}
        isPlaying={false}
        isMuted={false}
        isFullscreen={false}
        onClose={onClose}
        onToggleFullscreen={vi.fn()}
        onToggleMute={vi.fn()}
        onPlayPause={onPlayPause}
        onNextStep={vi.fn()}
        onPrevStep={vi.fn()}
        onReplay={vi.fn()}
        onSelectStepIndex={vi.fn()}
      />
    );

    expect(screen.getByText('离心泵分镜脚本')).toBeDefined();
    expect(screen.getByText('播放讲解')).toBeDefined();

    const playBtn = screen.getByText('播放讲解');
    fireEvent.click(playBtn);
    expect(onPlayPause).toHaveBeenCalled();
  });
});
