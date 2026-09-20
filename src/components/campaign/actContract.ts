/**
 * 七幕之间的接口约定 —— 幕组件只认这里的 props 和 `finish()`，
 * 幕序推进、总计时、结算全部由 `CampaignView` 负责。
 *
 * 放在单独文件里的原因：`CampaignView` 要 import 各幕组件，各幕又要 import
 * `ActProps`；类型循环虽然编译期无害，但把约定抽出来能让"某一幕"独立看懂
 * 自己能拿到什么、必须交回什么。
 */
import type { ComponentType } from 'react';
import type { AiMaintenancePlan } from '../../api';
import type { MaintenanceProcedure, UserProfile } from '../../types';
import type { CharacterMood } from '../game/gameCharacter';
import type { FaultSpotSpec, GameScene, StationSpec } from '../game/gameScene';
import type { AiDiagnosis } from '../equipment3d/aiDiagnosis';
import type { ActId, ActOutcome, IncidentPick } from './campaignModel';

/**
 * 一次主线贯穿七幕的业务上下文。
 *
 * 全部字段都可能为 null：**接口没调通就是没调通**，幕组件要如实显示"未获取"，
 * 不得填占位数据把下一幕撑过去。
 */
export interface RunContext {
  incident: IncidentPick | null;
  /** 第 2 幕真实建单（或复用的在处理工单） */
  workOrderId: string | null;
  orderNo: string | null;
  /** 第 3 幕 AI 诊断结论 */
  diagnosis: AiDiagnosis | null;
  diagnosisDegraded: boolean;
  /** 第 4 幕 AI 方案 + 派工结果 */
  plan: AiMaintenancePlan | null;
  planDegraded: boolean;
  assigneeId: string | null;
  assigneeName: string | null;
  /** 第 5 幕命中的真实规程与登记的 LOTO 锁 */
  procedure: MaintenanceProcedure | null;
  lotoLockNo: string | null;
  /** 第 5 幕办理的作业票：第 7 幕完工后要注销，票不结掉该设备下次开不了工 */
  permitId: string | null;
  permitNo: string | null;
  /** 第 5 幕实际用掉的备件（领料流水已写入） */
  partsUsed: Array<{ name: string; quantity: number }>;
  /** 第 6 幕 AI 视觉质检 */
  qcImageUrl: string | null;
  qcVerdict: string | null;
  qcPass: boolean | null;
  /** 第 7 幕沉淀的知识贡献 */
  contributionTitle: string | null;
}

export const EMPTY_RUN: RunContext = {
  incident: null,
  workOrderId: null,
  orderNo: null,
  diagnosis: null,
  diagnosisDegraded: false,
  plan: null,
  planDegraded: false,
  assigneeId: null,
  assigneeName: null,
  procedure: null,
  lotoLockNo: null,
  permitId: null,
  permitNo: null,
  partsUsed: [],
  qcImageUrl: null,
  qcVerdict: null,
  qcPass: null,
  contributionTitle: null,
};

/**
 * 3D 舞台由壳持有、七幕共用（切幕不重建 WebGL，否则每次要重新加载 GLB，
 * 相机也会跳回总览）。幕组件通过它下指令。
 */
export interface StageBridge {
  /** null = 回到工厂俯瞰 */
  setFocused(id: string | null): void;
  setFaultSpots(spots: FaultSpotSpec[] | null): void;
  setMood(mood: CharacterMood): void;
  /** 相机俯冲到指定点位（贴到设备跟前） */
  dive(id: string): void;
  /** WebGL 不可用时为 null，幕组件必须能在没有 3D 的情况下走完流程 */
  scene: () => GameScene | null;
  /**
   * 订阅 3D 点位点击（同一时刻只有当前幕在监听，传 null 取消）。
   * 舞台由壳持有，所以点位回调只能由壳转发，不能让各幕各自绑事件。
   */
  onPick(handler: ((id: string) => void) | null): void;
}

export interface ActProps {
  actId: ActId;
  run: RunContext;
  /** 前面各幕已交回的成绩（第 7 幕的复盘与工时统计要用；不含本幕自己） */
  outcomes: ActOutcome[];
  stage: StageBridge;
  stations: StationSpec[];
  currentUser: UserProfile | null;
  /** 交回本幕成绩；patch 会合并进 RunContext 供后续幕使用 */
  finish: (outcome: ActOutcome, patch?: Partial<RunContext>) => void;
  /** 记一次失误（不结束本幕，用于逐步操作） */
  countMistake: () => void;
}

export type ActComponent = ComponentType<ActProps>;
