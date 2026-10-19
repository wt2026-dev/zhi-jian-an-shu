/**
 * 备件安全库存的「回退值」不得伪装成一条真实阈值。
 *
 * 背景：`spare_parts.safe_stock` 是 `NOT NULL DEFAULT 5`，正常查询总能取到值，
 * 所以读取路径上的 `?? 5` 是**死分支**。但只要它真的被走到（查询漏列、
 * 字段改名、视图裁剪列），系统就会凭空多出一条「5 件安全线」，
 * 而低库存告警是 `stock <= safe_stock` —— 一条编造的阈值会让告警
 * 凭空出现或凭空消失，且看起来完全正常。
 *
 * 同理 `create()` 里 `Number(item.safe_stock ?? 5)` 也踩了同一个坑的另一面：
 * 显式传 5 会**覆盖**库里的 DEFAULT 5，让"默认"在应用层和库层各存一份，
 * 以后改库默认值时这里不会跟着变。未填就传 null，让库统一决定。
 *
 * 断言方式：直接扫源码字面量。这类"值看起来合法"的缺陷，
 * 行为测试抓不到（接口确实返回了数字），只能钉写法。
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) =>
  fs.readFileSync(path.join(ROOT, p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const SPARE = read("src/db/repositories/sparePartsRepository.ts");
const HISTORY = read("src/db/repositories/partHistoryRepository.ts");

describe("备件安全库存回退值", () => {
  it("读取路径不得回退成 5（那会伪造一条真实阈值）", () => {
    expect(SPARE).not.toMatch(/safe_stock\s*\?\?\s*5\b/);
    expect(HISTORY).not.toMatch(/safe_stock\s*\?\?\s*5\b/);
  });

  it("读取路径按 0 回退，与 stock/price 同口径", () => {
    expect(SPARE).toMatch(/safe_stock:\s*Number\(r\.safe_stock\s*\?\?\s*0\)/);
    expect(SPARE).toMatch(/safeStock:\s*Number\(r\.safe_stock\s*\?\?\s*0\)/);
    expect(HISTORY).toMatch(/safeStock:\s*Number\(r\.safe_stock\s*\?\?\s*0\)/);
  });

  it("create() 未填安全库存时传 null，交给库里的 DEFAULT 决定", () => {
    expect(SPARE).toMatch(/item\.safe_stock\s*\?\?\s*null/);
    // 不得写成 `?? 5` / `?? 0`：前者与库默认值重复一份，后者把"未填"伪装成"安全线为 0"
    expect(SPARE).not.toMatch(/item\.safe_stock\s*\?\?\s*\d/);
  });

  it("守卫前提仍然成立：建表语句里 safe_stock 是 NOT NULL DEFAULT 5", () => {
    // 若哪天这条前提变了（例如允许 NULL），上面的推理和注释都要重写
    const ddl = fs.readFileSync(
      path.join(ROOT, "src/db/migrations/009_spare_parts_and_hazards.sql"),
      "utf8"
    );
    expect(ddl).toMatch(/safe_stock\s+INTEGER\s+NOT NULL\s+DEFAULT\s+5/);
  });
});
