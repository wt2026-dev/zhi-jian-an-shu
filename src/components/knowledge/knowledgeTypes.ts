import { KnowledgeArticle } from '../../types';

export type KnowledgeTab = 'knowledge' | 'review' | 'graph';

export const KNOWLEDGE_CATEGORIES = [
  'all',
  '检修SOP规程',
  '故障树分析',
  '典型事故案例',
  '检修国家标准',
] as const;

export interface KnowledgeReviewItem {
  id: string;
  title: string;
  category: string;
  author: string;
  createdAt?: string;
  content?: string;
  targetEquipment?: string;
  summary?: string;
  tags?: string[];
}

export interface KnowledgeGraphNodeItem {
  id: string;
  article_id: string;
  article_title: string;
  article_content: string;
  entity_type: string;
  entity_name: string;
}

export interface KnowledgeGraphEdgeItem {
  id?: string;
  source?: string;
  target?: string;
  relation?: string;
  [key: string]: unknown;
}

export interface KnowledgeGraphData {
  nodes: KnowledgeGraphNodeItem[];
  edges: KnowledgeGraphEdgeItem[];
}

export interface RagSourceItem {
  id: string;
  title: string;
  category?: string;
  similarity?: number;
  similarityScore?: number;
}

export interface RagAnswerData {
  query: string;
  answer: string;
  sources: RagSourceItem[];
}

export interface NewArticleFormData {
  title: string;
  category: KnowledgeArticle['category'];
  targetEquipment: string;
  summary: string;
  content: string;
  tags: string;
}
