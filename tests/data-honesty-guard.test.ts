/**
 * 数据诚实性守卫 —— 把「面板里的每个数字都来自真实数据」这条红线锁成可执行断言。
 *
 * 背景：这个项目的对外承诺是「绝不编造故障、缺测就写 —」。这类承诺最容易在两种地方破功，
 * 而两种都**看不出来**：
 *   1. 服务端为了"让页面好看"，用 `Math.random()` 合成一个看起来合理的业务值
 *      （温度 60~80、健康分 85、告警数 3 条……）。单看接口响应完全正常。
 *   2. 前端在拿不到数据时"补零"或画一条本地合成波形，页面照样有曲线。
 *
 * 现状是**干净的**（2026-10-17 全量核对）：
 *   · `src/server/**` + `src/db/**` 共 41 处 `Math.random()`，逐条核对全部用于生成
 *     `chat-xxx` / `wo-xxx` / `SP-xxxx` / `HZ-YYYYMMDD-xxx` 这类标识符；
 *   · `DeviceAnalysisPanel.tsx` 无 `Math.random()`、无 `|| 0` 补零，缺测统一走
 *     `formatReading()` 返回 `—`，且遥测只在 `telemetry.equipmentId === card.id` 时才用
 *     （防止串到上一台设备的数据）。
 * 但"现状干净"不等于"以后干净"，所以钉成不变量。
 *
 * 例外怎么加：确实需要随机的地方，在该行写 `// honesty-guard-allow: <理由>`。
 * 例外必须显式，不允许静默放过 —— 这条守卫的价值就在于"多出一处随机"一定会被看见。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/** 递归收集 .ts/.tsx 源文件（跳过测试与生成文件）。 */
function walk(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.generated.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

const rel = (abs: string) => path.relative(ROOT, abs).split(path.sep).join('/');

/**
 * 「这一行的随机数是不是只用来造标识符」的判据。
 *
 * 刻意用**很松的字符串包含**而不是精确 AST：这里要挡的是"凭空造业务数值"，
 * 误报一次只是让人补一行 allow 注释，漏报一次就是一次编造。宁可松。
 */
const ID_HINT = /Id|id|No|[Ff]ilename|[Ss]uffix/;

describe('数据诚实性守卫：服务端不得用随机数合成业务值', () => {
  const files = [...walk(path.join(ROOT, 'src/server')), ...walk(path.join(ROOT, 'src/db'))];

  it('每个 Math.random() 都必须落在"生成标识符"的那一行', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!line.includes('Math.random')) return;
        // 注释里提到 Math.random（例如解释"为什么不用它"）不算
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
        if (line.includes('honesty-guard-allow')) return;
        if (ID_HINT.test(line)) return;
        offenders.push(`${rel(file)}:${i + 1}  ${trimmed.slice(0, 100)}`);
      });
    }

    expect(
      offenders,
      `以下 Math.random() 不在"生成标识符"的上下文里，疑似在合成业务数值：\n${offenders.join('\n')}\n` +
        '如果确实需要，请在该行加 // honesty-guard-allow: <理由>',
    ).toEqual([]);
  });

  it('声称"不用 Math.random / 确定性"的文件必须真的没有', () => {
    // 这些文件的注释里明确写了"不用 Math.random，便于复现与单测"，
    // 一旦有人顺手加回来，注释就变成谎话 —— 而谎话比没有注释更糟。
    const deterministic = [
      'src/components/equipment3d/DeviceAnalysisPanel.tsx',
      'src/components/equipment3d/rand.ts',
      'src/components/campaign/campaignSteps.ts',
      'src/components/campaign/acts/ActRepair.tsx',
      'src/components/digital-human/EngineerModel.ts',
    ];

    const offenders: string[] = [];
    for (const relPath of deterministic) {
      const abs = path.join(ROOT, relPath);
      if (!fs.existsSync(abs)) continue; // 文件被删/改名不算违规
      const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!line.includes('Math.random')) return;
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
        offenders.push(`${relPath}:${i + 1}  ${trimmed.slice(0, 100)}`);
      });
    }

    expect(offenders, `这些文件声明了确定性，却出现了 Math.random：\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('数据诚实性守卫：设备分析面板不得本地合成曲线', () => {
  const panelPath = path.join(ROOT, 'src/components/equipment3d/DeviceAnalysisPanel.tsx');
  const src = fs.readFileSync(panelPath, 'utf8');

  it('遥测曲线来自后端接口，而不是本地合成', () => {
    expect(src).toContain('getTelemetryHistory');
  });

  it('缺测不补零：不允许对读数做 `|| 0` 兜底', () => {
    // 补零会把"没有采集到"伪装成"采到 0"，是最隐蔽的一种编造。
    // 正确做法是 formatReading() 返回 '—'。
    expect(src).not.toMatch(/\|\|\s*0\b/);
    expect(src).toContain('formatReading');
  });

  it('遥测必须校验 equipmentId，防止把上一台设备的曲线留在面板上', () => {
    expect(src).toMatch(/telemetry\??\.equipmentId\s*===\s*card\??\.id/);
  });
});
