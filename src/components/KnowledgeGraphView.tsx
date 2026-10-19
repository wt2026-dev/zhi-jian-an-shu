import React, { useState, useEffect, useMemo } from 'react';
import {
  Share2,
  Sparkles,
  Search,
  BookOpen,
  X,
  Layers,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  Info,
} from 'lucide-react';
import { knowledgeApi } from '../api';
import { KnowledgeGraphNode, KnowledgeGraphEdge, UserProfile } from '../types';
import { ForceGraph } from './knowledge/ForceGraph';

// 节点类型颜色配置表（模块级常量，纯静态）
const typeColors: Record<string, string> = {
  设备: '#3b82f6', // 蓝
  故障: '#ef4444', // 红
  方法: '#10b981', // 绿
  备件: '#f97316', // 橙
  部件: '#8b5cf6', // 紫
};

interface KnowledgeGraphViewProps {
  currentUser: UserProfile;
  onOpenArticle?: (articleId: string) => void;
}

export const KnowledgeGraphView: React.FC<KnowledgeGraphViewProps> = ({
  currentUser,
  onOpenArticle,
}) => {
  const [nodes, setNodes] = useState<KnowledgeGraphNode[]>([]);
  const [edges, setEdges] = useState<KnowledgeGraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [equipmentFilter, setEquipmentFilter] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractMessage, setExtractMessage] = useState<string | null>(null);

  // 选中节点详情抽屉
  const [selectedNode, setSelectedNode] = useState<KnowledgeGraphNode | null>(null);

  const loadGraph = async (equip?: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await knowledgeApi.graph(equip || undefined);
      setNodes(data.nodes || []);
      setEdges(data.edges || []);
    } catch (err: any) {
      setError(err?.message || '图谱数据加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGraph();
  }, []);

  // 执行 AI 图谱抽取
  const handleExtract = async () => {
    setExtracting(true);
    setExtractMessage('Qwen-Plus 正在阅读已审核知识文章并抽取实体与关系...');
    try {
      const res = await knowledgeApi.extractGraph();
      setExtractMessage(`抽取完成！已成功为 ${res.extractedArticles || 0} 篇新知识提炼知识图谱。`);
      await loadGraph(equipmentFilter);
    } catch (err: any) {
      setExtractMessage('抽取失败: ' + err.message);
    } finally {
      setExtracting(false);
      setTimeout(() => setExtractMessage(null), 5000);
    }
  };

  // 力导向图数据构建（自研 SVG ForceGraph，替代原 echarts force graph）
  const graphNodes = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        label: n.entity_name,
        color: typeColors[n.entity_type] || '#64748b',
        radius: n.entity_type === '设备' ? 27 : 21,
        tooltip: `[${n.entity_type}] ${n.entity_name}\n关联知识: ${n.article_title || '规程文章'}\n👉 点击节点查看完整规程`,
      })),
    [nodes]
  );
  const graphEdges = useMemo(
    () =>
      edges.map((e) => ({
        source: e.source_node_id,
        target: e.target_node_id,
        label: e.relation,
        tooltip: `关系: ${e.relation || '关联'}`,
      })),
    [edges]
  );
  const legend = useMemo(
    () => Object.entries(typeColors).map(([label, color]) => ({ label, color })),
    []
  );
  const handleGraphNodeClick = (id: string) => {
    setSelectedNode(nodes.find((n) => n.id === id) ?? null);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* 头部导航与操作栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-50 flex items-center justify-center shadow-xs border border-cyan-200">
              <Share2 className="w-5 h-5 text-cyan-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                工业设备知识图谱 (Knowledge Graph)
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-50 text-cyan-700 border border-cyan-200 font-mono font-medium">
                  力导向拓扑推理
                </span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                基于 DashScope Qwen-Plus 自动抽取设备、故障、方法、备件与部件之间的多维关联网络
              </p>
            </div>
          </div>
        </div>

        {/* 顶部操作区 */}
        <div className="flex items-center gap-3">
          {currentUser.role === 'admin' && (
            <button
              onClick={handleExtract}
              disabled={extracting}
              className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white rounded-xl text-xs font-semibold shadow-xs transition-all cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4" />
              <span>{extracting ? 'AI 知识抽取中...' : '一键抽取未处理文章图谱'}</span>
            </button>
          )}
        </div>
      </div>

      {extractMessage && (
        <div className="p-3 rounded-xl bg-cyan-50 border border-cyan-200 text-xs text-cyan-800 flex items-center gap-2">
          <Info className="w-4 h-4 text-cyan-600 shrink-0" />
          <span>{extractMessage}</span>
        </div>
      )}

      {/* 过滤控制栏 */}
      <div className="card-industrial bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center space-x-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-80">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={equipmentFilter}
              onChange={(e) => setEquipmentFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadGraph(equipmentFilter)}
              placeholder="按设备型号/名称过滤图谱 (如: 离心泵、电机)..."
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-cyan-500 focus:bg-white"
            />
          </div>
          <button
            onClick={() => loadGraph(equipmentFilter)}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 transition-colors cursor-pointer"
          >
            查询过滤
          </button>
          {equipmentFilter && (
            <button
              onClick={() => {
                setEquipmentFilter('');
                loadGraph();
              }}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              重置
            </button>
          )}
        </div>

        {/* 统计指标 */}
        <div className="flex items-center space-x-4 text-xs font-mono text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            实体节点: <b className="text-slate-800">{nodes.length}</b>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-cyan-500" />
            关系连线: <b className="text-slate-800">{edges.length}</b>
          </span>
        </div>
      </div>

      {/* 图谱主渲染区 */}
      <div className="card-industrial p-0 relative h-[650px] overflow-hidden bg-white border border-slate-200 rounded-2xl flex flex-col shadow-xs">
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 text-sm">
            <RefreshCw className="w-8 h-8 text-cyan-600 animate-spin mb-3" />
            <span>正在加载知识图谱节点与拓扑关系...</span>
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-red-500 text-sm">{error}</div>
        ) : nodes.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 text-sm space-y-4">
            <Layers className="w-12 h-12 text-slate-500" />
            <span>知识图谱中暂无节点数据。</span>
            {currentUser.role === 'admin' && (
              <button
                onClick={handleExtract}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold cursor-pointer shadow-xs"
              >
                立即调用 Qwen-Plus 执行图谱抽取
              </button>
            )}
          </div>
        ) : (
          <ForceGraph
            nodes={graphNodes}
            edges={graphEdges}
            legend={legend}
            onNodeClick={handleGraphNodeClick}
          />
        )}

        {/* 节点点击详情抽屉 */}
        {selectedNode && (
          <div className="absolute top-4 right-4 w-96 max-h-[90%] overflow-y-auto bg-white/95 border border-slate-200 shadow-xl rounded-2xl p-5 space-y-4 backdrop-blur-md z-20 text-slate-800 card-industrial">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <span
                  className="px-2.5 py-0.5 rounded text-xs font-bold text-white shadow-xs"
                  style={{ backgroundColor: typeColors[selectedNode.entity_type] || '#3b82f6' }}
                >
                  {selectedNode.entity_type}
                </span>
                <h4 className="text-sm font-bold text-slate-800 line-clamp-1">{selectedNode.entity_name}</h4>
              </div>
              <button onClick={() => setSelectedNode(null)} className="text-slate-500 hover:text-slate-700 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 关联规程信息 */}
            <div className="space-y-1.5 text-xs">
              <span className="text-slate-500 font-semibold flex items-center gap-1">
                <BookOpen className="w-3.5 h-3.5 text-cyan-600" /> 关联知识文章：
              </span>
              <p className="text-slate-800 font-bold bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                {selectedNode.article_title || '设备检修规程'}
              </p>
            </div>

            {/* 规程正文节选 */}
            {selectedNode.article_content && (
              <div className="space-y-1.5 text-xs">
                <span className="text-slate-500 font-semibold">规程正文详细指引：</span>
                <div className="max-h-60 overflow-y-auto p-3 bg-slate-50 rounded-lg border border-slate-200 text-[11px] text-slate-700 leading-relaxed whitespace-pre-line">
                  {selectedNode.article_content}
                </div>
              </div>
            )}

            {/* 相邻关系 */}
            <div className="space-y-1.5 text-xs pt-1">
              <span className="text-slate-500 font-semibold">图谱关联拓扑：</span>
              <div className="space-y-1 max-h-36 overflow-y-auto">
                {edges
                  .filter((e) => e.source_node_id === selectedNode.id || e.target_node_id === selectedNode.id)
                  .map((e, idx) => {
                    const isSource = e.source_node_id === selectedNode.id;
                    const otherNodeId = isSource ? e.target_node_id : e.source_node_id;
                    const otherNode = nodes.find((n) => n.id === otherNodeId);
                    return (
                      <div key={idx} className="p-2 rounded bg-slate-50 border border-slate-200 text-[11px] flex items-center justify-between">
                        <span className="text-slate-600">{isSource ? `→ ${e.relation}` : `← ${e.relation}`}</span>
                        <span className="font-semibold text-cyan-700">{otherNode?.entity_name || '关联实体'}</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
