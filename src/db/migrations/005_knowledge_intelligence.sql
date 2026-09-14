-- 知识智能化：向量、审核、图谱及 AI 纠错均持久化在 PostgreSQL/PGlite。
ALTER TABLE knowledge_articles ADD COLUMN IF NOT EXISTS embedding JSONB;
ALTER TABLE knowledge_articles ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'approved';
ALTER TABLE knowledge_articles ADD COLUMN IF NOT EXISTS reviewer VARCHAR(128);
ALTER TABLE knowledge_articles ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_knowledge_status ON knowledge_articles(status);

CREATE TABLE IF NOT EXISTS knowledge_graph_nodes (
  id VARCHAR(64) PRIMARY KEY,
  entity_type VARCHAR(16) NOT NULL CHECK (entity_type IN ('设备','故障','方法','备件','部件')),
  entity_name VARCHAR(256) NOT NULL,
  article_id VARCHAR(64) NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_article ON knowledge_graph_nodes(article_id);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_name ON knowledge_graph_nodes(entity_name);

CREATE TABLE IF NOT EXISTS knowledge_graph_edges (
  id VARCHAR(64) PRIMARY KEY,
  source_node_id VARCHAR(64) NOT NULL REFERENCES knowledge_graph_nodes(id) ON DELETE CASCADE,
  target_node_id VARCHAR(64) NOT NULL REFERENCES knowledge_graph_nodes(id) ON DELETE CASCADE,
  relation VARCHAR(128) NOT NULL,
  article_id VARCHAR(64) NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_graph_edges_article ON knowledge_graph_edges(article_id);

CREATE TABLE IF NOT EXISTS ai_feedback (
  id VARCHAR(64) PRIMARY KEY,
  chat_id VARCHAR(64) NOT NULL,
  model_response TEXT,
  user_correction TEXT NOT NULL,
  corrected_content TEXT NOT NULL,
  device_id VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','adopted'))
);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_status ON ai_feedback(status);
