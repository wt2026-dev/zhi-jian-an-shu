/**
 * 「数值兜底」在 AI 提示词与设备卡片上的诚实性守卫。
 *
 * 本轮清掉的三类，共同点是**兜底值本身是个真实数字**，所以既不像占位符那么扎眼，
 * 也不会让任何断言失败：
 *
 *   1. `{healthScore || 92}%` —— 设备健康分为 0 或未评估时显示 **92%**。
 *      出现在扫码巡检弹窗和报修开单弹窗两处。
 *   2. `healthScore || 0` 参与均值 —— 未评估设备被当成 0 分，把全厂均值往下拽，
 *      更糟的是这段统计**原样进 AI 报告提示词**，模型会照着 0 写"设备状况堪忧"。
 *   3. MTTR 无工时记录时写 `0` —— 0 小时意味着"秒修"，比"未采集"更误导。
 *
 * 断言方式：源码级。这类缺陷的行为测试很难写到位（要造一堆 null 设备再看文案），
 * 而写法一旦回退就是编造，所以直接钉源码字面量。
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) =>
  fs.readFileSync(path.join(ROOT, p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("健康分/工时不得用编造默认值兜底", () => {
  it("设备卡片不得出现 `healthScore || 92` 这类假默认分", () => {
    for (const f of [
      "src/components/inspection/InspectionQrModal.tsx",
      "src/components/workorders/WorkOrderCreateModal.tsx",
    ]) {
      const code = read(f);
      expect(code, `${f} 不得回退成固定分数`).not.toMatch(/healthScore\s*\|\|\s*\d+/);
      expect(code, `${f} 未评估应显示「—」`).toMatch(/typeof\s+\w+\??\.healthScore\s*===\s*['"]number['"]/);
    }
  });

  it("AI 报告统计里健康分不得按 0 参与计算", () => {
    const code = read("src/server/controllers/aiForecastController.ts");
    expect(code).not.toMatch(/healthScore\s*\|\|\s*0/);
    expect(code).not.toMatch(/healthScore\s*\?\?\s*0/);
    // 均值必须只在「有评估记录」的设备上算
    expect(code).toMatch(/const\s+scoredEquipments\s*=\s*equipments\.filter\(/);
    expect(code).toMatch(/typeof\s+e\.healthScore\s*===\s*["']number["']/);
    expect(code).toMatch(/scoredEquipments\.length\s*\?/);
  });

  it("MTTR 无工时记录时写 null 而不是 0 小时", () => {
    const code = read("src/server/controllers/aiForecastController.ts");
    expect(code).not.toMatch(/mttrHours:.*:\s*0\s*,/);
    // 允许中间夹换行或注释
    expect(code).toMatch(/mttrHours:[\s\S]{0,200}?:\s*null/);
  });

  it("提示词必须写明 null 的含义（否则模型会把 null 当 0 用）", () => {
    const code = read("src/server/controllers/aiForecastController.ts");
    // 光把数据改成 null 不够：模型需要显式口径，否则会自行补一个数字
    expect(code).toMatch(/字段值为\s*null\s*表示\*\*该项未采集\*\*/);
    expect(code).toMatch(/禁止\*\*当成\s*0/);
  });
});
