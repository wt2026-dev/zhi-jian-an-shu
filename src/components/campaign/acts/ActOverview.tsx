/**
 * 第 1 幕 · 工厂运转 —— 3D 工厂俯瞰 + 真实台账看板 + 数字人师傅讲解。
 *
 * 对应项目功能：数字孪生大屏、设备监测。
 *
 * 玩法：看板上的在线率/健康分/告警数全部由 `factoryBoardOf` 从真实台账算出来，
 * 玩家要按这些读数点出"最该修的那台"。答案就是第 2 幕要报警的设备
 * （同一个 `pickIncident`），所以这一幕不是随机问答，而是在教玩家读真实口径。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppData } from '../../../context/AppDataContext';
import type { Equipment } from '../../../types';
import { buildHuntSpots, worstSpot } from '../../game/levelPlay';
import { speakChinese, cancelSpeech } from '../../digital-human/speech';
import { factoryBoardOf, pickIncident, type ActOutcome } from '../campaignModel';
import { useActClock } from '../useActClock';
import type { ActProps } from '../actContract';
import { ActFooter, DataRow, Missing, Panel } from '../CampaignPanels';

/** 看板只列"最该看一眼"的台子：按健康分升序，缺失健康分的排最后 */
function shortlist(equipments: Equipment[]): Equipment[] {
  return [...equipments]
    .sort((a, b) => (a.healthScore ?? 101) - (b.healthScore ?? 101) || a.id.localeCompare(b.id))
    .slice(0, 6);
}

export function ActOverview(props: ActProps) {
  const { stage, stations, finish, countMistake } = props;
  const { equipments } = useAppData();
  const elapsed = useActClock();
  const [attempts, setAttempts] = useState(0);
  const [hit, setHit] = useState(false);
  const [pickedName, setPickedName] = useState<string | null>(null);

  const answer = useMemo(() => pickIncident(equipments), [equipments]);
  const board = useMemo(() => factoryBoardOf(equipments), [equipments]);
  const list = useMemo(() => shortlist(equipments), [equipments]);

  const narrate = useCallback(() => {
    const lines = [
      `欢迎到岗，${board.total} 台在册设备归你管。`,
      `当前在线率 ${board.onlineRate === null ? '暂无数据' : `${board.onlineRate}%`}，`,
      `平均健康分 ${board.avgHealth === null ? '暂无数据' : `${board.avgHealth} 分`}，`,
      `预警 ${board.warning} 台，故障 ${board.fault} 台。`,
      answer ? `从看板上找出最该修的那台，点它。` : `台账里没有异常设备，直接进下一幕。`,
    ].join('');
    void speakChinese(lines, { gender: 'male', maxChars: 220 });
  }, [board, answer]);

  useEffect(() => {
    stage.setMood('idle');
    narrate();
    return () => cancelSpeech();
    // 只在进幕时讲一次：board/answer 由台账决定，重讲只会打断玩家
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolve = useCallback(
    (id: string) => {
      const eq = equipments.find((e) => e.id === id);
      if (!eq) return;
      setPickedName(eq.name);
      if (!answer) return;
      const ok = id === answer.equipment.id;
      setAttempts((n) => n + 1);
      if (ok) {
        setHit(true);
        stage.setMood('celebrate');
        stage.dive(id);
        void speakChinese(`就是它，${eq.name}。${answer.brief}`, { gender: 'male', maxChars: 120 });
      } else {
        stage.setMood('regret');
        countMistake();
        void speakChinese(`${eq.name} 的读数还在阈值内，再看看告警栏。`, { gender: 'male', maxChars: 80 });
      }
    },
    [answer, countMistake, equipments, stage]
  );

  // 3D 点位与看板行共用同一判定；命中后取消订阅，点错不再扣失误
  useEffect(() => {
    stage.onPick(hit ? null : resolve);
    return () => stage.onPick(null);
  }, [hit, resolve, stage]);

  const next = () => {
    const seconds = elapsed();
    const outcome: ActOutcome = {
      actId: 'overview',
      // 没有异常设备时这一幕没有可判定的操作，按通过计
      firstTryRate: !answer || attempts === 0 ? 1 : attempts === 1 ? 1 : Math.max(0.3, 1 / attempts),
      mistakes: Math.max(0, attempts - (hit ? 1 : 0)),
      seconds,
    };
    stage.setMood('idle');
    finish(outcome);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Panel title="全厂看板 · 来自设备台账" accent="cyan" right={<span className="text-[10px] text-slate-500">真实数据，无模拟量</span>}>
        <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-3">
          <DataRow label="在册设备" value={`${board.total} 台`} />
          <DataRow label="运行中" value={`${board.running} 台`} tone="good" />
          <DataRow label="在线率" value={board.onlineRate === null ? <Missing /> : `${board.onlineRate}%`} tone={board.onlineRate !== null && board.onlineRate < 70 ? 'warn' : 'default'} />
          <DataRow label="预警" value={`${board.warning} 台`} tone={board.warning ? 'warn' : 'default'} />
          <DataRow label="故障" value={`${board.fault} 台`} tone={board.fault ? 'bad' : 'default'} />
          <DataRow label="平均健康分" value={board.avgHealth === null ? <Missing /> : board.avgHealth} />
        </div>
      </Panel>

      <Panel
        title="重点关注台账（按健康分升序）"
        accent="amber"
        className="min-h-0 flex-1 overflow-y-auto"
        right={pickedName ? <span className="text-[10px] text-cyan-300">已选：{pickedName}</span> : <span className="text-[10px] text-slate-500">点行或点 3D 点位</span>}
      >
        <ul className="space-y-1.5">
          {list.map((eq) => {
            const spots = buildHuntSpots(eq);
            const worst = worstSpot(spots);
            const selected = pickedName === eq.name;
            return (
              <li key={eq.id}>
                <button
                  type="button"
                  onClick={() => !hit && resolve(eq.id)}
                  disabled={hit}
                  className={`w-full rounded-md border px-2 py-1.5 text-left transition-colors ${
                    selected ? 'border-cyan-400/60 bg-cyan-400/12' : 'border-white/10 bg-white/2 hover:border-cyan-400/35'
                  } ${hit ? 'cursor-default' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-semibold text-slate-100">
                      {eq.name}
                      <span className="ml-1.5 font-normal text-slate-500">{eq.code}</span>
                    </span>
                    <span className="hud-tabular-nums shrink-0 text-[11px] font-bold text-amber-300">
                      {typeof eq.healthScore === 'number' ? `${eq.healthScore} 分` : <Missing text="无健康分" />}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
                    <span>{eq.workshop || eq.location || '未登记位置'}</span>
                    <span className="text-slate-600">·</span>
                    <span>状态 {String(eq.status)}</span>
                    <span className="text-slate-600">·</span>
                    {worst ? (
                      <span className="text-rose-300">
                        {worst.label} {worst.reading}
                      </span>
                    ) : (
                      <span className="text-emerald-300/80">各测点读数在阈值内</span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>

      <ActFooter
        hint={
          hit
            ? `已锁定 ${answer?.equipment.name ?? ''}，下一步生成报修工单。`
            : answer
              ? '读看板：健康分最低、测点读数超限的那台就是目标。点位共 ' + stations.length + ' 个。'
              : '台账当前无异常设备，可直接进入下一幕。'
        }
        primary={{ text: hit || !answer ? '进入第 2 幕 · 故障来袭' : '跳过观察', onClick: next }}
      />
    </div>
  );
}
