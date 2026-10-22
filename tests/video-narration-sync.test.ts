/**
 * 口播/字幕时间轴同步守卫。
 *
 * 背景（用户实测反馈）：旧实现是"每段整体合成一条音频" + "字幕按行数平均切段时长"，
 * 两套时间轴互不相干。而口播比字幕多一句开场白"第N步，<步骤名>。"（它不进字幕，
 * 免得跟顶部标题重复），于是**声音一路领先字幕约一整行（约 3.7 秒）**。
 *
 * 现在改成：逐行合成 → 逐行量真实时长 → 用真实时长排字幕 enable 时段。
 * 这里锁的就是"字幕行的显示时段 == 该行语音的实际起止时间"这个不变量。
 */

import { describe, it, expect } from 'vitest';
import { planNarrationTimeline, utterancesOf, type NarrationSegment } from '../src/server/services/videoNarrationPlan';

/** 3 段，每段 18s；每段 = 开场白 + 3 行字幕。 */
function threeSegments(): NarrationSegment[] {
  return [1, 2, 3].map((no) => ({
    intro: `第${no}步，步骤名${no}。`,
    lines: [`第${no}段第一行`, `第${no}段第二行`, `第${no}段第三行`],
  }));
}

/** 每段：开场白 4s + 三行各 5s = 19s（略超 18s 段长 ⇒ 会触发提速）。 */
function durations(nSeg: number, intro = 4, line = 5): number[][] {
  return Array.from({ length: nSeg }, () => [intro, line, line, line]);
}

const TOTAL = 54; // 3 段 × 18s

describe('口播时间轴 utterancesOf', () => {
  it('开场白在前且不带字幕，随后是各行字幕', () => {
    const u = utterancesOf({ intro: '第1步，甲。', lines: ['A', 'B'] });
    expect(u.map((x) => x.text)).toEqual(['第1步，甲。', 'A', 'B']);
    expect(u[0].subtitle).toBeNull();
    expect(u[1].subtitle).toBe('A');
  });

  it('空白项被剔除（否则会合成出空音频）', () => {
    const u = utterancesOf({ intro: '   ', lines: ['', '  ', 'B'] });
    expect(u.map((x) => x.text)).toEqual(['B']);
  });

  it('字段缺失不抛异常', () => {
    expect(() => utterancesOf({} as NarrationSegment)).not.toThrow();
    expect(utterancesOf({} as NarrationSegment)).toEqual([]);
  });
});

describe('口播时间轴 planNarrationTimeline', () => {
  const segs = threeSegments();
  const plan = planNarrationTimeline(segs, durations(3), TOTAL);

  it('字幕条数 = 所有段的行数之和（开场白不产字幕）', () => {
    expect(plan.cues).toHaveLength(9);
  });

  it('开场白不产生字幕行（不与顶部标题重复）', () => {
    for (const c of plan.cues) expect(c.text).not.toMatch(/^第\d步，步骤名\d。$/);
  });

  // ===== 核心回归：旧的"声音领先字幕一整行" =====
  it('★ 第 1 行字幕在该行语音开始时才出现（不再从段首就开始）', () => {
    const u0 = utterancesOf(segs[0]);
    expect(u0[0].subtitle).toBeNull(); // 第 0 句是开场白
    // 第 1 句（= 第一条字幕）的起始时刻，必须等于开场白压缩后的时长
    const tempo = plan.tempos[0];
    expect(tempo).toBeGreaterThan(1); // 19s > 18s ⇒ 提速
    const introEff = 4 / tempo;
    expect(plan.cues[0].start).toBeCloseTo(introEff, 6);
    expect(plan.cues[0].start).toBeGreaterThan(2); // 旧实现这里是 0，就是错位的来源
    // 字幕起始必须与该行语音起始严格一致
    expect(plan.starts[1]).toBeCloseTo(plan.cues[0].start, 6);
  });

  it('每条字幕的起止都等于它自己那句语音的起止（音画同步的定义）', () => {
    // 把 utterances 展开成扁平下标，逐条比对
    const flat: { seg: number; k: number; subtitle: string | null }[] = [];
    segs.forEach((s, si) => utterancesOf(s).forEach((u, k) => flat.push({ seg: si, k, subtitle: u.subtitle })));
    const subIdx = flat.map((f, i) => (f.subtitle !== null ? i : -1)).filter((i) => i >= 0);
    expect(subIdx).toHaveLength(plan.cues.length);
    subIdx.forEach((fi, ci) => {
      const tempo = plan.tempos[fi];
      const dur = durations(3)[flat[fi].seg][flat[fi].k];
      expect(plan.cues[ci].start).toBeCloseTo(plan.starts[fi], 6);
      expect(plan.cues[ci].end - plan.cues[ci].start).toBeCloseTo(dur / tempo, 6);
    });
  });

  it('字幕时段单调、互不重叠（否则两行会同时压在画面上）', () => {
    for (let i = 1; i < plan.cues.length; i++) {
      expect(plan.cues[i].start).toBeGreaterThanOrEqual(plan.cues[i - 1].end - 1e-9);
    }
    for (const c of plan.cues) expect(c.end).toBeGreaterThan(c.start);
  });

  it('每段的字幕都落在本段区间内（不串到相邻段）', () => {
    const segLen = TOTAL / 3;
    plan.cues.forEach((c, i) => {
      const segIdx = Math.floor(i / 3);
      expect(c.start).toBeGreaterThanOrEqual(segIdx * segLen - 1e-6);
      expect(c.end).toBeLessThanOrEqual((segIdx + 1) * segLen + 1e-6);
    });
  });

  it('提速上限 1.5 倍（再快就不像人说话）', () => {
    // 每段语音 4+5*3=19s 自然长，段长 18s ⇒ 需要 1.056 倍，未触顶
    for (const t of plan.tempos) expect(t).toBeLessThanOrEqual(1.5);
    // 极端：每段语音 100s，段长 18s ⇒ 需求 5.56 倍，必须被夹到 1.5
    const extreme = planNarrationTimeline(segs, durations(3, 40, 20), TOTAL);
    for (const t of extreme.tempos) expect(t).toBeCloseTo(1.5, 6);
  });

  it('语音比段短时不提速，且段尾余量留给最后一行字幕', () => {
    // 每段 2+3*2=8s < 18s ⇒ 不变速
    const p = planNarrationTimeline(segs, durations(3, 2, 2), TOTAL);
    for (const t of p.tempos) expect(t).toBe(1);
    const segLen = TOTAL / 3;
    // 第 1 段最后一行字幕应延伸到段尾，避免提前消失
    expect(p.cues[2].end).toBeCloseTo(segLen, 6);
    // 第 2 段的第一行字幕从"本段段首 + 本段开场白时长"开始（不是从段首开始）
    expect(p.cues[3].start).toBeCloseTo(segLen + 2, 6);
  });

  it('starts/tempos 与展开后的句数一一对应', () => {
    const count = segs.reduce((a, s) => a + utterancesOf(s).length, 0);
    expect(plan.starts).toHaveLength(count);
    expect(plan.tempos).toHaveLength(count);
  });

  it('时长为 0 / 空输入时安全返回空计划（不产生 NaN 时间戳）', () => {
    expect(planNarrationTimeline([], [], 0)).toEqual({ starts: [], tempos: [], cues: [] });
    expect(planNarrationTimeline(segs, durations(3), 0).cues).toEqual([]);
    const noLines = planNarrationTimeline([{ intro: '第1步，甲。', lines: [] }], [[3]], 18);
    expect(noLines.cues).toEqual([]);
    expect(noLines.starts).toHaveLength(1);
  });

  it('某段只有步骤名（无字幕行）时，该段不产字幕但不影响其它段', () => {
    const mixed: NarrationSegment[] = [
      { intro: '第1步，甲。', lines: [] },
      { intro: '第2步，乙。', lines: ['乙行一', '乙行二'] },
    ];
    const p = planNarrationTimeline(mixed, [[3], [3, 4, 4]], 36);
    expect(p.cues).toHaveLength(2);
    // 第 2 段的字幕必须落在 18s 之后
    expect(p.cues[0].start).toBeGreaterThanOrEqual(18 - 1e-6);
  });

  it('自然时长缺失（0）不会产生 NaN / 负时段', () => {
    const p = planNarrationTimeline(segs, [[0, 0, 0, 0], [4, 5, 5, 5], [4, 5, 5, 5]], TOTAL);
    for (const c of p.cues) {
      expect(Number.isFinite(c.start)).toBe(true);
      expect(Number.isFinite(c.end)).toBe(true);
      expect(c.end).toBeGreaterThanOrEqual(c.start);
    }
  });
});
