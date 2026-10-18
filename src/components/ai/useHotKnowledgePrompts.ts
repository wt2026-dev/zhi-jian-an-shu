import { useState, useEffect } from 'react';
import { knowledgeApi } from '../../api';

interface HotKnowledgeItem {
  id?: string;
  title: string;
}

export function useHotKnowledgePrompts() {
  const [hotPrompts, setHotPrompts] = useState<{ title: string; question: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await knowledgeApi.list();
        if (!cancelled && Array.isArray(list) && list.length > 0) {
          const picked = [...list].sort(() => Math.random() - 0.5).slice(0, 4);
          setHotPrompts(
            picked.map((k: HotKnowledgeItem) => ({
              title: k.title,
              question: `请结合《${k.title}》规程要点，说明其在现场检修中如何应用？`,
            }))
          );
        }
      } catch {
        // 知识库拉取失败时不展示热点推荐 (不使用硬编码兜底)
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return hotPrompts;
}
