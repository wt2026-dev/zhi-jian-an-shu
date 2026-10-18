// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { KnowledgeBaseView } from '../../src/components/KnowledgeBaseView';
import { knowledgeApi } from '../../src/api';
import { KnowledgeArticle, UserProfile } from '../../src/types';
import { ToastProvider } from '../../src/context/ToastContext';

vi.mock('../../src/api', () => ({
  knowledgeApi: {
    reviewList: vi.fn(),
    graph: vi.fn(),
    extractGraph: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    create: vi.fn(),
    upload: vi.fn(),
    search: vi.fn(),
  },
}));

const mockUser: UserProfile = {
  id: 'u-1',
  name: '张工程师',
  role: 'admin',
  roleTitle: '主任工程师',
  department: '机械维保部',
  phone: '13800000001',
};

const mockArticles: KnowledgeArticle[] = [
  {
    id: 'art-1',
    title: '离心泵机械密封拆装与泄漏处置规程',
    category: '检修SOP规程',
    targetEquipment: '离心泵/给水泵',
    summary: '针对工业离心泵集装式机械密封的更换、静压试验及泄漏排查要点',
    content: '1. 停机并执行能量隔离；\n2. 拆卸联轴器护罩；\n3. 检查动静环磨损。',
    tags: ['机械密封', '泄漏', '离心泵'],
    author: '王主任',
    updatedAt: '2026-09-01',
    viewCount: 128,
  },
  {
    id: 'art-2',
    title: '罗茨鼓风机轴承过热故障树排查指引',
    category: '故障树分析',
    targetEquipment: '罗茨风机',
    summary: '基于故障树深入解析轴承箱温升超标原因与对策',
    content: '1. 测量轴承游隙；\n2. 分析润滑油品污染度；\n3. 校验齿轮啮合间隙。',
    tags: ['罗茨风机', '轴承', '温升'],
    author: '赵技师',
    updatedAt: '2026-09-15',
    viewCount: 85,
  },
];

describe('KnowledgeBaseView 模块化重构验证', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(knowledgeApi.reviewList).mockResolvedValue([
      {
        id: 'rev-1',
        title: '待审压缩机气阀检修 SOP',
        category: '检修SOP规程',
        author: '孙技术员',
        createdAt: '2026-10-15T08:00:00Z',
      },
    ]);
    vi.mocked(knowledgeApi.graph).mockResolvedValue({
      nodes: [
        {
          id: 'node-1',
          article_id: 'art-1',
          article_title: '离心泵机械密封拆装规程',
          article_content: '图谱关联内容',
          entity_type: '设备',
          entity_name: '1#循环水主泵',
        },
      ],
      edges: [{ id: 'e-1', source: 'node-1', target: 'node-2', relation: '包含故障' }],
    });
    vi.mocked(knowledgeApi.search).mockResolvedValue({
      success: true,
      query: '离心泵',
      results: [
        {
          chunkId: 'chk-1',
          docTitle: '离心泵机械密封拆装与泄漏处置规程',
          category: '检修SOP规程',
          similarity: 0.94,
          text: '集装式机械密封需保证对中精度在0.05mm以内。',
        },
      ],
    });
  });

  const renderView = (props: {
    currentUser?: UserProfile;
    articles?: KnowledgeArticle[];
    onAddArticle?: (art: KnowledgeArticle) => void;
    onAskAiWithContext?: (q: string, a: KnowledgeArticle) => void;
  } = {}) => {
    return render(
      <ToastProvider>
        <KnowledgeBaseView
          currentUser={props.currentUser ?? mockUser}
          articles={props.articles ?? mockArticles}
          onAddArticle={props.onAddArticle ?? vi.fn()}
          onAskAiWithContext={props.onAskAiWithContext ?? vi.fn()}
        />
      </ToastProvider>
    );
  };

  it('1. 完整渲染知识库主视图、标题与文章卡片列表', () => {
    renderView();

    expect(screen.getByText('工业设备检修知识库与 RAG 语义搜索中心')).toBeInTheDocument();
    expect(screen.getByText('离心泵机械密封拆装与泄漏处置规程')).toBeInTheDocument();
    expect(screen.getByText('罗茨鼓风机轴承过热故障树排查指引')).toBeInTheDocument();
    expect(screen.getByText('#机械密封')).toBeInTheDocument();
  });

  it('2. 支持按类目与关键词实时过滤文章', () => {
    renderView();

    // 搜索风机
    const searchInput = screen.getByPlaceholderText(/输入故障症状、设备型号或规范/);
    fireEvent.change(searchInput, { target: { value: '罗茨风机' } });

    expect(screen.getByText('罗茨鼓风机轴承过热故障树排查指引')).toBeInTheDocument();
    expect(screen.queryByText('离心泵机械密封拆装与泄漏处置规程')).not.toBeInTheDocument();

    // 清空搜索
    fireEvent.change(searchInput, { target: { value: '' } });
    expect(screen.getByText('离心泵机械密封拆装与泄漏处置规程')).toBeInTheDocument();

    // 点击类目过滤
    const sopTab = screen.getByRole('button', { name: '检修SOP规程' });
    fireEvent.click(sopTab);
    expect(screen.getByText('离心泵机械密封拆装与泄漏处置规程')).toBeInTheDocument();
    expect(screen.queryByText('罗茨鼓风机轴承过热故障树排查指引')).not.toBeInTheDocument();
  });

  it('3. 支持审核队列与知识图谱 Tab 自由切换', async () => {
    renderView();

    // 切换到审核队列
    const reviewTabBtn = screen.getByRole('button', { name: '审核队列' });
    fireEvent.click(reviewTabBtn);

    await waitFor(() => {
      expect(knowledgeApi.reviewList).toHaveBeenCalled();
      expect(screen.getByText('待审压缩机气阀检修 SOP')).toBeInTheDocument();
      expect(screen.getByText('审核通过并入库')).toBeInTheDocument();
    });

    // 切换到知识图谱
    const graphTabBtn = screen.getByRole('button', { name: '知识图谱' });
    fireEvent.click(graphTabBtn);

    await waitFor(() => {
      expect(knowledgeApi.graph).toHaveBeenCalled();
      expect(screen.getByText('1#循环水主泵')).toBeInTheDocument();
    });
  });

  it('4. 点击文章卡片弹出详情，并支持基于此篇规程发起 AI 深度问答', () => {
    const handleAskAi = vi.fn();
    renderView({ onAskAiWithContext: handleAskAi });

    // 点击第一篇文章卡片
    fireEvent.click(screen.getByText('离心泵机械密封拆装与泄漏处置规程'));

    expect(screen.getByText('适用: 离心泵/给水泵')).toBeInTheDocument();
    expect(screen.getByText(/1\. 停机并执行能量隔离/)).toBeInTheDocument();

    // 点击发起 AI 深度问答
    const aiBtn = screen.getByRole('button', { name: /基于此篇规程发起 AI 深度问答/ });
    fireEvent.click(aiBtn);

    expect(handleAskAi).toHaveBeenCalledTimes(1);
    expect(handleAskAi.mock.calls[0][0]).toContain('请根据规程《离心泵机械密封拆装与泄漏处置规程》');
  });

  it('5. 支持打开并提交新建文章模态', async () => {
    const handleAdd = vi.fn();
    vi.mocked(knowledgeApi.create).mockResolvedValue({
      id: 'art-new',
      title: '高压给水泵平衡盘研磨工艺',
      category: '检修SOP规程',
      targetEquipment: '高压给水泵',
      summary: '平衡盘研磨技巧与接触面检测',
      content: '详细研磨步骤与红丹粉检查',
      tags: ['给水泵', '平衡盘'],
      author: '张工程师 (主任工程师)',
      updatedAt: '2026-10-18',
      viewCount: 0,
    });

    renderView({ onAddArticle: handleAdd });

    // 点击发布新检修知识文档
    const createBtn = screen.getByRole('button', { name: /发布新检修知识文档/ });
    fireEvent.click(createBtn);

    expect(screen.getByText('录入新工业检修规程 / 案例知识')).toBeInTheDocument();

    // 填写标题与内容
    fireEvent.change(screen.getByPlaceholderText(/例如: 离心压缩机干气密封系统检修/), {
      target: { value: '高压给水泵平衡盘研磨工艺' },
    });
    fireEvent.change(screen.getByPlaceholderText(/详细撰写前期准备、安全措施、作业步骤/), {
      target: { value: '详细研磨步骤与红丹粉检查' },
    });

    // 提交
    fireEvent.click(screen.getByRole('button', { name: '发布建档' }));

    await waitFor(() => {
      expect(knowledgeApi.create).toHaveBeenCalled();
      expect(handleAdd).toHaveBeenCalledTimes(1);
    });
  });

  it('6. 执行 RAG 语义搜索并展示知识图谱研判卡片', async () => {
    renderView();

    const searchInput = screen.getByPlaceholderText(/输入故障症状、设备型号或规范/);
    fireEvent.change(searchInput, { target: { value: '密封泄漏对中标准' } });

    const ragBtn = screen.getByRole('button', { name: /RAG 语义规程检索/ });
    fireEvent.click(ragBtn);

    await waitFor(() => {
      expect(knowledgeApi.search).toHaveBeenCalledWith('密封泄漏对中标准', 4, undefined);
      expect(screen.getByText('RAG 知识图谱与规程综合研判回复')).toBeInTheDocument();
      expect(screen.getByText(/DashScope 向量语义检索最佳匹配/)).toBeInTheDocument();
    });
  });
});
