#!/usr/bin/env node
/**
 * 遥测模拟采集器 —— 演示"摄入入口可用"的最小可运行示例。
 *
 * 用法：
 *   npx tsx scripts/telemetry-simulator.ts [设备ID] [点数] [间隔秒]
 *   默认：eq-101，12 点，间隔 0（一次性批量）
 *
 *   env：BASE_URL（默认 http://localhost:3000）
 *        INGEST_USER / INGEST_PASS（默认 manager / Manager@2026#Safe，仅本地演示）
 *
 * 行为：登录获取 JWT → 按 sin 曲线 + 伪随机生成"模拟采集"读数 →
 *       POST /api/v1/telemetry/ingest（source=mqtt-simulator）。
 *
 * ⚠️ 诚实性声明：本脚本输出的是模拟采集数据，不是产线实测读数；
 *   落库后与种子仿真数据同表，UI 与文档不得据此表述为"实测数据"
 *   （见 src/db/repositories/telemetryRepository.ts 文件头声明）。
 */
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const USER = process.env.INGEST_USER || "manager";
const PASS = process.env.INGEST_PASS || "Manager@2026#Safe";

const EQUIPMENT_ID = process.argv[2] || "eq-101";
const POINTS = Number(process.argv[3] || 12);
const INTERVAL_MS = Number(process.argv[4] || 0) * 1000;

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function generatePoint(i: number, now: number) {
  const hourOfDay = new Date(now).getHours();
  const daily = Math.sin((hourOfDay / 24) * Math.PI * 2);
  const noise = pseudoRandom(now + i * 7.1);
  return {
    equipmentId: EQUIPMENT_ID,
    recordedAtDt: new Date(now).toISOString(),
    temperature: Number((61 + 3 * daily + (noise - 0.5) * 2).toFixed(1)),
    vibration: Number((2.1 + 0.4 * daily + (noise - 0.5) * 0.3).toFixed(2)),
    current: Number((52 + 6 * daily + (noise - 0.5) * 3).toFixed(1)),
    voltage: 380,
    pressure: Number((0.86 + 0.03 * daily).toFixed(2)),
    loadRate: Number(Math.min(100, Math.max(0, 72 + 8 * daily + (noise - 0.5) * 4)).toFixed(1)),
    rpm: Math.round(1498 + 10 * daily),
  };
}

async function main() {
  const loginRes = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!loginRes.ok) {
    console.error(`[simulator] 登录失败（${loginRes.status}）：${await loginRes.text()}`);
    process.exit(1);
  }
  const { token } = (await loginRes.json()) as { token: string };

  for (let i = 0; i < POINTS; i++) {
    const point = generatePoint(i, Date.now() - (POINTS - 1 - i) * 60_000);
    const res = await fetch(`${BASE_URL}/api/v1/telemetry/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ source: "mqtt-simulator", points: [point] }),
    });
    const body = (await res.json()) as { ingested?: number; error?: string; code?: string };
    if (!res.ok) {
      console.error(`[simulator] 第 ${i + 1} 点摄入失败（${res.status}）：${body.error || JSON.stringify(body)}`);
      process.exit(1);
    }
    console.log(
      `[simulator] 已摄入 ${body.ingested} 点 @ ${point.recordedAtDt}  temp=${point.temperature} vib=${point.vibration} load=${point.loadRate}`
    );
    if (INTERVAL_MS > 0 && i < POINTS - 1) await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  console.log(`[simulator] 完成：${EQUIPMENT_ID} 共 ${POINTS} 点模拟遥测已通过摄入接口落库。`);
}

main().catch((err) => {
  console.error("[simulator] 执行异常:", err);
  process.exit(1);
});
