import React from 'react';

/**
 * 轻量级 Markdown 渲染组件 (自实现，零新增依赖)
 * 支持：标题 (#/##/###)、加粗 **x**、斜体 *x*、行内代码 `x`、
 *       无序/有序列表、表格、代码块 ```、引用 >、分隔线 ---、链接 [text](url)
 * 专为 AI 检修回复设计，深色工业风样式。
 */

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // 依序匹配：链接、加粗、斜体、行内代码
  const pattern = /(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const k = `${keyPrefix}-i${i++}`;
    if (match[1]) {
      nodes.push(
        <a key={k} href={match[3]} target="_blank" rel="noreferrer" className="text-cyan-400 underline hover:text-cyan-300">
          {match[2]}
        </a>
      );
    } else if (match[4]) {
      nodes.push(<strong key={k} className="font-bold text-slate-100">{match[5]}</strong>);
    } else if (match[6]) {
      nodes.push(<em key={k} className="italic">{match[7]}</em>);
    } else if (match[8]) {
      nodes.push(<code key={k} className="px-1 py-0.5 rounded bg-slate-950 text-amber-300 font-mono text-[11px]">{match[9]}</code>);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export const Markdown: React.FC<{ content: string; className?: string }> = ({ content, className = '' }) => {
  const lines = (content || '').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  const inline = (t: string) => renderInline(t, `b${key}`);

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    if (line.trim().startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push(
        <pre key={key++} className="my-2 p-3 rounded-lg bg-slate-950 border border-slate-800 overflow-x-auto">
          <code className="font-mono text-[11px] text-emerald-300 leading-relaxed">{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // 表格
    if (line.trim().startsWith('|') && lines[i + 1]?.includes('---')) {
      const header = line.trim().split('|').map((c) => c.trim()).filter(Boolean);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i].trim().split('|').map((c) => c.trim()).filter((c, idx, arr) => !(idx === 0 && c === '') && !(idx === arr.length - 1 && c === '')));
        i++;
      }
      blocks.push(
        <div key={key++} className="my-2 overflow-x-auto">
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th key={hi} className="border border-slate-700 bg-slate-900 px-2 py-1.5 text-cyan-300 font-semibold text-left">{inline(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className="border border-slate-800 px-2 py-1.5 text-slate-300">{inline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // 标题
    const headingMatch = line.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const cls = level === 1
        ? 'text-sm font-bold text-slate-100 mt-3 mb-1.5'
        : level === 2
        ? 'text-xs font-bold text-cyan-300 mt-3 mb-1.5'
        : 'text-xs font-semibold text-slate-100 mt-2 mb-1';
      blocks.push(<div key={key++} className={cls}>{inline(headingMatch[2])}</div>);
      i++;
      continue;
    }

    // 分隔线
    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={key++} className="my-2.5 border-slate-700/70" />);
      i++;
      continue;
    }

    // 引用
    if (line.trim().startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote key={key++} className="my-2 pl-3 py-1.5 border-l-2 border-amber-500/60 bg-amber-950/20 rounded-r text-[11px] text-amber-200/90 space-y-1">
          {quoteLines.map((q, qi) => <p key={qi}>{inline(q)}</p>)}
        </blockquote>
      );
      continue;
    }

    // 无序列表 (含 emoji 开头的列表项)
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={key++} className="my-1.5 space-y-1 text-xs text-slate-300">
          {items.map((item, ii) => (
            <li key={ii} className="flex items-start space-x-1.5">
              <span className="text-cyan-400 mt-0.5 shrink-0">•</span>
              <span>{inline(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // 有序列表
    if (/^\s*\d+[.、)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.、)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.、)]\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={key++} className="my-1.5 space-y-1 text-xs text-slate-300">
          {items.map((item, ii) => (
            <li key={ii} className="flex items-start space-x-1.5">
              <span className="text-cyan-400 font-mono text-[11px] mt-0.5 shrink-0">{ii + 1}.</span>
              <span>{inline(item)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // 空行
    if (!line.trim()) {
      i++;
      continue;
    }

    // 普通段落 (连续非空行合并)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4}\s|\s*[-*•]\s|\s*\d+[.、)]\s|\||>|```|---)/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="my-1 text-xs text-slate-300 leading-relaxed">{inline(paraLines.join('\n').replace(/\n/g, ' '))}</p>
    );
  }

  return <div className={`markdown-body ${className}`}>{blocks}</div>;
};
