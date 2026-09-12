-- 011: 知识自进化贡献推荐表
CREATE TABLE IF NOT EXISTS ai_knowledge_contributions (
  id VARCHAR(64) PRIMARY KEY,
  chat_id VARCHAR(64),
  title TEXT,
  type VARCHAR(64),
  equipment VARCHAR(128),
  summary TEXT,
  solution TEXT,
  contributor VARCHAR(64),
  status VARCHAR(32) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_kc_status ON ai_knowledge_contributions(status);
