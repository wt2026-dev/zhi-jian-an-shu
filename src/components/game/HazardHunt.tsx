// 「检修闯关」第二模式：隐患找茬。
// 程序化 SVG 车间场景（泵房/配电/管线区），每场景 3 处隐患点，玩家点击找出；
// 隐患类型复用项目隐患闭环的真实类型口径（未挂牌 LOTO/防护缺失/油污泄漏/超温/异响/跑冒滴漏）。
// 计分：找对 +20、点错 -5；每场景限时 90 秒。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface HazardSpotDef {
  x: number;
  y: number;
  type: string;
  desc: string;
}

interface SceneTemplate {
  id: string;
  name: string;
  spots: HazardSpotDef[];
  art: React.ReactNode;
}

const VIEW_W = 800;
const VIEW_H = 420;
const HIT_R = 36;

/* ---------- 场景素材（SVG 手绘，深色工业风） ---------- */

const GRID = (
  <g stroke="rgba(56,189,248,0.10)" strokeWidth="1">
    {Array.from({ length: 16 }, (_, i) => (
      <line key={`v${i}`} x1={i * 50} y1={0} x2={i * 50} y2={VIEW_H} />
    ))}
    {Array.from({ length: 9 }, (_, i) => (
      <line key={`h${i}`} x1={0} y1={i * 50} x2={VIEW_W} y2={i * 50} />
    ))}
  </g>
);

function Pump(x: number, y: number, key: string) {
  return (
    <g key={key}>
      <rect x={x} y={y + 34} width={120} height={16} fill="#1e3a5f" stroke="#22d3ee" strokeOpacity={0.4} />
      <rect x={x + 8} y={y + 6} width={58} height={30} rx={4} fill="#16283f" stroke="#22d3ee" strokeOpacity={0.5} />
      <circle cx={x + 96} cy={y + 21} r={22} fill="#12283f" stroke="#22d3ee" strokeOpacity={0.5} strokeWidth={2} />
      <circle cx={x + 96} cy={y + 21} r={7} fill="#0b1220" stroke="#67e8f9" strokeOpacity={0.7} />
      <rect x={x - 40} y={y + 14} width={44} height={12} fill="#1b3150" stroke="#22d3ee" strokeOpacity={0.35} />
    </g>
  );
}

function Cabinet(x: number, y: number, key: string, w = 70, h = 130) {
  return (
    <g key={key}>
      <rect x={x} y={y} width={w} height={h} rx={3} fill="#16283f" stroke="#22d3ee" strokeOpacity={0.5} />
      <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} stroke="#22d3ee" strokeOpacity={0.3} />
      <rect x={x + 10} y={y + 14} width={w - 20} height={22} fill="#0b1220" stroke="#67e8f9" strokeOpacity={0.35} />
      <circle cx={x + w / 4} cy={y + h - 18} r={4} fill="#fbbf24" fillOpacity={0.8} />
      <circle cx={x + (3 * w) / 4} cy={y + h - 18} r={4} fill="#34d399" fillOpacity={0.8} />
    </g>
  );
}

function Tank(x: number, y: number, key: string) {
  return (
    <g key={key}>
      <rect x={x} y={y} width={90} height={110} rx={8} fill="#16283f" stroke="#22d3ee" strokeOpacity={0.5} />
      <ellipse cx={x + 45} cy={y} rx={45} ry={12} fill="#1b3150" stroke="#22d3ee" strokeOpacity={0.5} />
      <rect x={x + 36} y={y - 16} width={18} height={16} fill="#1b3150" stroke="#22d3ee" strokeOpacity={0.4} />
    </g>
  );
}

function Pipe(x1: number, y1: number, x2: number, y2: number, key: string) {
  return (
    <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#2a4a73" strokeWidth={10} strokeLinecap="round" />
  );
}

function Flange(x: number, y: number, key: string) {
  return (
    <rect key={key} x={x - 6} y={y - 12} width={12} height={24} rx={2} fill="#1b3150" stroke="#67e8f9" strokeOpacity={0.6} />
  );
}

const SCENE_TEMPLATES: SceneTemplate[] = [
  {
    id: 'pump-room',
    name: '泵房区',
    spots: [
      { x: 150, y: 95, type: '防护缺失', desc: '左侧泵联轴器处防护罩缺失' },
      { x: 370, y: 150, type: '跑冒滴漏', desc: '泵出口法兰连接处渗漏' },
      { x: 560, y: 60, type: '异响', desc: '右侧泵轴承部位异响（振动超标）' },
      { x: 660, y: 120, type: '油污泄漏', desc: '泵基地面油污未清理' },
      { x: 260, y: 300, type: '未挂牌LOTO', desc: '检修阀门未挂 LOTO 警示牌' },
    ],
    art: (
      <g>
        {GRID}
        {Pump(90, 60, 'p1')}
        {Pump(440, 30, 'p2')}
        {Tank(600, 60, 't1')}
        {Pipe(148, 100, 440, 70, 'pl1')}
        {Pipe(370, 160, 620, 130, 'pl2')}
        {Flange(365, 160, 'f1')}
        {Flange(250, 88, 'f2')}
        <rect x={200} y={280} width={130} height={60} rx={4} fill="#16283f" stroke="#22d3ee" strokeOpacity={0.4} />
        <text x={232} y={316} fill="#67e8f9" fontSize={13} fillOpacity={0.8}>检修阀</text>
        {Cabinet(690, 240, 'c1', 62, 110)}
      </g>
    ),
  },
  {
    id: 'electrical',
    name: '配电区',
    spots: [
      { x: 200, y: 120, type: '未挂牌LOTO', desc: '配电柜检修作业未挂牌上锁' },
      { x: 420, y: 90, type: '防护缺失', desc: '柜内裸露接线端子防护盖板缺失' },
      { x: 640, y: 200, type: '跑冒滴漏', desc: '柜顶渗水，电气设备受潮风险' },
      { x: 330, y: 260, type: '油污泄漏', desc: '地面油污靠近电气设备，易引发事故' },
      { x: 560, y: 300, type: '异响', desc: '柜内冷却风扇异响' },
    ],
    art: (
      <g>
        {GRID}
        {Cabinet(140, 60, 'c1')}
        {Cabinet(370, 40, 'c2', 90, 140)}
        {Cabinet(600, 130, 'c3')}
        {Pipe(120, 260, 680, 260, 'pl1')}
        <rect x={280} y={230} width={110} height={56} rx={4} fill="#16283f" stroke="#22d3ee" strokeOpacity={0.4} />
        <text x={300} y={264} fill="#67e8f9" fontSize={13} fillOpacity={0.8}>临时工具箱</text>
        <path d="M 620 190 l 14 24 h -28 z" fill="#fbbf24" fillOpacity={0.75} />
      </g>
    ),
  },
  {
    id: 'pipeline',
    name: '管线区',
    spots: [
      { x: 230, y: 110, type: '跑冒滴漏', desc: '管线法兰面滴漏' },
      { x: 470, y: 70, type: '防护缺失', desc: '管道保温层破损缺失' },
      { x: 620, y: 180, type: '超温', desc: '管段温度异常升高（超温）' },
      { x: 350, y: 250, type: '油污泄漏', desc: '阀门检修后残油未清理' },
      { x: 130, y: 220, type: '未挂牌LOTO', desc: '管线作业未办理作业票与挂牌' },
    ],
    art: (
      <g>
        {GRID}
        {Pipe(60, 120, 740, 120, 'pl1')}
        {Pipe(60, 210, 740, 210, 'pl2')}
        {Flange(230, 120, 'f1')}
        {Flange(470, 210, 'f2')}
        {Flange(620, 210, 'f3')}
        {Tank(90, 260, 't1')}
        <rect x={560} y={150} width={130} height={20} rx={4} fill="#1b3150" stroke="#fbbf24" strokeOpacity={0.5} />
        <text x={575} y={165} fill="#fbbf24" fontSize={12} fillOpacity={0.85}>高温管段</text>
      </g>
    ),
  },
];

const HAZARD_ICON: Record<string, string> = {
  未挂牌LOTO: '🔒',
  防护缺失: '⚠️',
  油污泄漏: '🛢',
  超温: '🌡',
  异响: '📢',
  跑冒滴漏: '💧',
};

/* ---------- 会话逻辑 ---------- */

interface RoundPlan {
  template: SceneTemplate;
  spots: HazardSpotDef[];
}

export interface HuntResult {
  score: number;
  found: number;
  missed: { scene: string; type: string; desc: string }[];
  wrongClicks: number;
  accuracyPct: number;
  timeSec: number;
}

function planRounds(): RoundPlan[] {
  const shuffled = [...SCENE_TEMPLATES].sort(() => Math.random() - 0.5);
  return [0, 1, 2, 0, 1].map((ti, i) => {
    const tpl = shuffled[ti % shuffled.length];
    const spots = [...tpl.spots].sort(() => Math.random() - 0.5).slice(0, 3);
    return { template: tpl, spots, ...(i < 0 ? {} : {}) };
  });
}

export function HazardHunt({ onFinish, onQuit }: { onFinish: (result: HuntResult) => void; onQuit: () => void }) {
  const rounds = useMemo(() => planRounds(), []);
  const [roundIdx, setRoundIdx] = useState(0);
  const [foundIdx, setFoundIdx] = useState<number[]>([]);
  const [score, setScore] = useState(0);
  const [wrongClicks, setWrongClicks] = useState(0);
  const [missed, setMissed] = useState<{ scene: string; type: string; desc: string }[]>([]);
  const [secondsLeft, setSecondsLeft] = useState(90);
  const [flash, setFlash] = useState<{ x: number; y: number; ok: boolean } | null>(null);
  const startedAt = useRef(Date.now());
  const svgRef = useRef<SVGSVGElement | null>(null);
  const round = rounds[roundIdx];

  const finishRound = useCallback(
    (missedNow: { scene: string; type: string; desc: string }[]) => {
      const allMissed = [...missed, ...missedNow];
      if (roundIdx + 1 >= rounds.length) {
        const total = rounds.length * 3;
        const found = total - allMissed.length;
        onFinish({
          score,
          found,
          missed: allMissed,
          wrongClicks,
          accuracyPct: total > 0 ? Math.round((found / total) * 100) : 0,
          timeSec: Math.round((Date.now() - startedAt.current) / 1000),
        });
        return;
      }
      setMissed(allMissed);
      setFoundIdx([]);
      setSecondsLeft(90);
      setRoundIdx(roundIdx + 1);
    },
    [missed, onFinish, roundIdx, rounds.length, rounds, score, wrongClicks]
  );

  // 场景倒计时：归零视为超时，未找到项计入漏找
  useEffect(() => {
    if (secondsLeft <= 0) {
      finishRound(round.spots.filter((_, i) => !foundIdx.includes(i)).map((s) => ({ scene: round.template.name, type: s.type, desc: s.desc })));
      return;
    }
    const timer = window.setTimeout(() => setSecondsLeft((v) => v - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [secondsLeft, finishRound, round, foundIdx]);

  const onCanvasClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * VIEW_W;
    const y = ((e.clientY - rect.top) / rect.height) * VIEW_H;
    const hitIdx = round.spots.findIndex(
      (s, i) => !foundIdx.includes(i) && Math.hypot(s.x - x, s.y - y) <= HIT_R
    );
    if (hitIdx >= 0) {
      setFoundIdx([...foundIdx, hitIdx]);
      setScore((v) => v + 20);
      setFlash({ x: round.spots[hitIdx].x, y: round.spots[hitIdx].y, ok: true });
      if (foundIdx.length + 1 >= round.spots.length) {
        window.setTimeout(() => finishRound([]), 600);
      }
    } else {
      setWrongClicks((v) => v + 1);
      setScore((v) => v - 5);
      setFlash({ x, y, ok: false });
    }
    window.setTimeout(() => setFlash(null), 700);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cyan-400/25 bg-[rgba(8,15,30,0.72)] px-3 py-2 backdrop-blur">
        <div className="text-sm font-semibold text-cyan-100">
          隐患找茬 · <span className="text-slate-300">{round.template.name}</span>
          <span className="ml-2 text-[11px] text-slate-400">场景 {roundIdx + 1} / {rounds.length} · 已找对 {foundIdx.length} / {round.spots.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`hud-tabular-nums rounded-md border px-2.5 py-1 text-sm font-bold ${secondsLeft <= 10 ? 'animate-pulse border-rose-400/60 bg-rose-400/10 text-rose-300' : 'border-cyan-400/30 bg-cyan-400/5 text-cyan-200'}`}>
            ⏱ {secondsLeft}s
          </div>
          <div className="hud-tabular-nums rounded-md border border-amber-400/30 bg-amber-400/5 px-2.5 py-1 text-sm font-bold text-amber-300">{score} 分</div>
          <button onClick={onQuit} className="rounded-md border border-white/15 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-300 hover:bg-white/[0.08]">
            退出
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-cyan-400/20 bg-[rgba(6,13,26,0.8)] p-2">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="h-auto w-full cursor-crosshair select-none"
          onClick={onCanvasClick}
        >
          {round.template.art}
          {/* 已找到的隐患标记 */}
          {round.spots.map((s, i) =>
            foundIdx.includes(i) ? (
              <g key={`f${i}`} pointerEvents="none">
                <circle cx={s.x} cy={s.y} r={HIT_R - 8} fill="rgba(52,211,153,0.16)" stroke="#34d399" strokeDasharray="4 3" />
                <text x={s.x} y={s.y + 5} textAnchor="middle" fontSize={16}>{HAZARD_ICON[s.type] ?? '⚠'}</text>
                <text x={s.x} y={s.y + HIT_R + 4} textAnchor="middle" fontSize={12} fill="#34d399">{s.type}</text>
              </g>
            ) : null
          )}
          {/* 点击反馈 */}
          {flash && (
            <g pointerEvents="none">
              <circle cx={flash.x} cy={flash.y} r={14} fill="none" stroke={flash.ok ? '#34d399' : '#f87171'} strokeWidth={3} className="animate-ping" />
            </g>
          )}
        </svg>
      </div>
      <div className="text-center text-[11px] text-slate-500">点击画面中的隐患位置 · 找对 +20 分 / 点错 -5 分 · 场景限时 90 秒</div>
    </div>
  );
}
