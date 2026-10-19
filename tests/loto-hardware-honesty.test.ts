/**
 * LOTO 锁具「硬件遥测」字段的诚实性守卫。
 *
 * 背景：`loto_locks` 表里**没有** hardware_type / battery_level / beam_state /
 * last_heartbeat 这四列，系统也没有蓝牙/NFC 锁具的接入通路。
 * 旧实现却在 mapRow 里凭空生成：
 *
 *   batteryLevel: r.battery_level ?? (r.status === "locked" ? 94 : 88)
 *   hardwareType: r.hardware_type || (r.id?.includes("2") ? "BLE_NFC_SMART_PADLOCK" : ...)
 *   lastHeartbeat: r.last_heartbeat || r.locked_at || new Date().toISOString()
 *
 * 三个问题叠在一起：数字看起来完全真实（94% 电量）、按 id 是否含 "2" 猜硬件型号、
 * 用当前时间伪造心跳。谁也想不到这是编的。
 *
 * 这类"兜底默认值"最不容易被测试抓到，因为接口确实返回了合法数字。
 * 所以这里直接钉源码：这四行必须是字面量 null。
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "src/db/repositories/lotoLockRepository.ts"), "utf8");
/** 必须先剥掉注释：注释里为了说明而引用了旧的坏代码，直接扫原文会自己打自己 */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("LOTO 硬件字段不得编造", () => {
  it("四个硬件字段一律返回 null（表里没有这些列，也没有接入通路）", () => {
    expect(CODE).toMatch(/hardwareType:\s*null/);
    expect(CODE).toMatch(/batteryLevel:\s*null/);
    expect(CODE).toMatch(/beamState:\s*null/);
    expect(CODE).toMatch(/lastHeartbeat:\s*null/);
  });

  it("不得按锁状态推算电量、按 id 猜硬件型号、用当前时间伪造心跳", () => {
    // 这三个都是「看起来像遥测、实际是凭空生成」的写法
    expect(CODE).not.toMatch(/battery_level\s*\?\?/);
    expect(CODE).not.toMatch(/status\s*===\s*["']locked["']\s*\?\s*\d/);
    expect(CODE).not.toMatch(/id\??\.includes\(\s*["']2["']\s*\)/);
    expect(CODE).not.toMatch(/lastHeartbeat:.*new Date\(\)/);
  });

  it("迁移文件里确实没有这四列（守卫的前提成立）", () => {
    const migDir = path.join(ROOT, "src/db/migrations");
    const all = fs
      .readdirSync(migDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => fs.readFileSync(path.join(migDir, f), "utf8"))
      .join("\n");
    // 若将来真的加了这些列，本守卫应当同步升级为"有列就如实读列"
    expect(all).not.toMatch(/battery_level|hardware_type|beam_state|last_heartbeat/);
  });
});
