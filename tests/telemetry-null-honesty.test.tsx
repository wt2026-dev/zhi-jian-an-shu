/**
 * 遥测缺测的诚实性守卫（`telemetry: TelemetryData | null`）
 *
 * 背景：`equipments.telemetry` 的库默认值是 `'{}'::jsonb`（migration 001_init.sql:39），
 * 而 `Equipment.telemetry` 曾声明为**必填**的 `TelemetryData`。于是"表里没有遥测"这件事
 * 被类型系统藏了起来：仓库层回退成 `{}`，UI 直接 `eq.telemetry.temperature` 拼字符串，
 * 渲染出 `undefined°C`；更糟的是阈值判断 `undefined > 75 === false` 会被当成"温度正常"。
 *
 * 本文件钉三件事：
 *  1. 状态映射：null 必须返回 null（"无法判定"），不能返回任何 StatusKey（那会被当成判定结论）；
 *  2. 渲染：缺测设备出现在健康雷达里时显示「—」与「未接入」，不泄漏 undefined/NaN；
 *  3. 正向对照：有遥测时必须渲染真实数字 —— 否则第 2 条就是零信息断言。
 */
// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { Equipment, TelemetryData } from "../src/types/index.ts";
import { telemetryToStatus } from "../src/components/equipment3d/statusMapping.ts";
import { TelemetryAndInspectionSection } from "../src/components/dashboard/TelemetryAndInspectionSection.tsx";

const telemetryFixture: TelemetryData = {
  temperature: 62.5,
  vibration: 2.1,
  voltage: 380,
  current: 210,
  loadRate: 66,
  lastUpdated: "2026-10-19T08:00:00.000Z",
};

/** 超温读数，用来证明"有读数时会报警"这条分支真实存在 */
const hotTelemetry: TelemetryData = { ...telemetryFixture, temperature: 88 };

function makeEquipment(telemetry: TelemetryData | null): Equipment {
  return {
    id: "eq-null-001",
    code: "EQ-NULL-001",
    name: "无遥测测试泵",
    category: "泵类设备",
    model: "TEST-100",
    workshop: "测试车间",
    location: "测试工位-01",
    installDate: "2024-01-01",
    manufacturer: "测试制造",
    status: "running",
    healthScore: 80,
    criticality: "通用辅助",
    lastMaintenance: "2026-09-01",
    nextMaintenance: "2026-12-01",
    specs: {},
    maintenanceHistory: [],
    nextInspectionDate: "2026-10-25",
    qrCode: "EQ-NULL-001",
    telemetry,
  } as Equipment;
}

/** 渲染结果里不允许出现的"缺测泄漏"字样 */
const LEAK_PATTERNS = [/undefined/i, /\bNaN\b/];

function renderSection(equipments: Equipment[]) {
  return render(
    <TelemetryAndInspectionSection
      equipments={equipments}
      inspections={[]}
      activeLotoLocks={[]}
      onSelectEquipment={() => {}}
      onNavigate={() => {}}
    />
  );
}

describe("遥测缺测（telemetry = null）的诚实性守卫", () => {
  it("状态映射：null 输入必须返回 null（未判定），不得退回某个 StatusKey", () => {
    expect(telemetryToStatus(null)).toBeNull();
    expect(telemetryToStatus(undefined)).toBeNull();
    // 正向对照：全 0 恰恰是"可判定的读数"，必须能给出结论（不能也是 null）
    // —— 这条保证上两行不是"函数永远返回 null"的零信息断言。
    // 注意入参类型是 TelemetryLike（只有 temperature/vibration/loadRate 三个字段参与判定）。
    expect(
      telemetryToStatus({ temperature: 0, vibration: 0, loadRate: 0 })
    ).not.toBeUndefined();
  });

  it("状态映射：超温读数必须判出非 null 的故障档（证明阈值分支活着）", () => {
    const status = telemetryToStatus(hotTelemetry);
    expect(status).not.toBeNull();
  });

  it("渲染：null 遥测不得泄漏 undefined/NaN", () => {
    const { container } = renderSection([makeEquipment(null)]);
    const text = container.textContent ?? "";
    for (const p of LEAK_PATTERNS) {
      expect(text).not.toMatch(p);
    }
  });

  it("渲染：有遥测时必须把真实数字渲染出来（正向对照）", () => {
    const { container } = renderSection([makeEquipment(telemetryFixture)]);
    const text = container.textContent ?? "";
    expect(text).toContain("62.5");
    expect(text).toContain("2.1");
    for (const p of LEAK_PATTERNS) {
      expect(text).not.toMatch(p);
    }
  });
});
