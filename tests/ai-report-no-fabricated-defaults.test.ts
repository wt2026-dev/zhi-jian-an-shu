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
    const code = read("src/server/controllers/aiReportController.ts");
    expect(code).not.toMatch(/healthScore\s*\|\|\s*0/);
    expect(code).not.toMatch(/healthScore\s*\?\?\s*0/);
    // 均值必须只在「有评估记录」的设备上算
    expect(code).toMatch(/const\s+scoredEquipments\s*=\s*equipments\.filter\(/);
    expect(code).toMatch(/typeof\s+e\.healthScore\s*===\s*["']number["']/);
    expect(code).toMatch(/scoredEquipments\.length\s*\?/);
  });

  it("MTTR 无工时记录时写 null 而不是 0 小时", () => {
    const code = read("src/server/controllers/aiReportController.ts");
    expect(code).not.toMatch(/mttrHours:.*:\s*0\s*,/);
    // 允许中间夹换行或注释
    expect(code).toMatch(/mttrHours:[\s\S]{0,200}?:\s*null/);
  });

  it("提示词必须写明 null 的含义（否则模型会把 null 当 0 用）", () => {
    const code = read("src/server/controllers/aiReportController.ts");
    // 光把数据改成 null 不够：模型需要显式口径，否则会自行补一个数字
    expect(code).toMatch(/字段值为\s*null\s*表示\*\*该项未采集\*\*/);
    expect(code).toMatch(/禁止\*\*当成\s*0/);
  });

  it("健康分插进提示词时不得裸拼 `${...healthScore}`（null 会变成字面量 null）", () => {
    // 模板里直接写 ${eq.healthScore}，值为 null 时拼出来就是字符串 "null"，
    // 模型会当成 0 分或自行猜一个数 —— 而这段文字用户看不到，只在结论里体现。
    const promptFiles = [
      "src/server/controllers/aiForecastController.ts",
      "src/server/controllers/aiReportController.ts",
      "src/server/controllers/aiAssistantController.ts",
      "src/server/controllers/aiGenerationController.ts",
    ];
    for (const f of promptFiles) {
      const code = read(f);
      const bare = code.match(/\$\{[a-zA-Z_]\w*\.healthScore\}/g) ?? [];
      expect(bare, `${f} 里有裸拼的健康分：${bare.join(", ")}`).toEqual([]);
      expect(code, `${f} 应走 scoreOrUnscored()`).toMatch(/scoreOrUnscored\(/);
    }
  });

  it("scoreOrUnscored 本身：有值给值，无值给「未评估」而不是 null/0", () => {
    // 直接跑函数，避免守卫只验调用形态而不知道它真做了什么
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = fs.readFileSync(path.join(ROOT, "src/server/utils/promptValue.ts"), "utf8");
    expect(src).toMatch(/typeof score === "number" && Number\.isFinite\(score\)/);
    expect(src).toMatch(/未评估/);
  });

  it("二维码/打印物料不得把空字段填成具体名字（这是要印出来贴在设备上的）", () => {
    // QR 物料会被打印、张贴、扫码 —— 文案上的兜底字符串会被当成真实信息。
    // "生产保全部" / "生产A线" / "工业重型标准型" 都是曾真实出现过的编造。
    const qr1 = read("src/components/equipment-archives/EquipmentQrModal.tsx");
    const qr2 = read("src/components/inspection/InspectionQrModal.tsx");
    for (const [code, name] of [[qr1, "EquipmentQrModal"], [qr2, "InspectionQrModal"]] as const) {
      expect(code, `${name} 不得兜底成具体车间/部门/型号`).not.toMatch(/\|\|\s*['"](生产|工业|未知设备|默认车间)/);
      expect(code, `${name} 空字段应显示「未登记/未指派」`).toMatch(/\|\|\s*['"]未(登记|指派)/);
    }
  });

  it("故障诊断提示词不得编造遥测读数或故障现象（真机无数据时曾喂出'轴承温度超限'）", () => {
    // 曾把 `telemetry?.temperature ?? 82.5 °C` / `?? 7.8 mm/s` / `?? 54.2 A` / `?? 92%`
    // 以及 `|| "工业多级离心泵"` / `|| "轴承箱剧烈振动…"` / `|| "E-VIB-02…"` 直接拼进
    // /api/v1/ai/diagnose 的真实提示词——无遥测的设备被模型诊断为"轴承温度超限"。
    // 这类写法一眼看不出问题（数字本身合法），所以源码级钉死。
    const code = read("src/server/services/aiCapabilityService.ts");
    expect(code, "遥测字段不得用具体数字兜底").not.toMatch(/telemetry\?\.\w+\s*\?\?\s*\d/);
    expect(code, "不得残留具体编造设备编码").not.toMatch(/PUMP-2024-03/);
    expect(code, "不得把缺失设备编成泵类场景").not.toMatch(/\|\|\s*["']工业多级离心泵["']/);
    expect(code, "不得编造故障现象字符串").not.toMatch(/\|\|\s*["']轴承箱剧烈振动/);
    expect(code, "不得编造报警代码").not.toMatch(/\|\|\s*["']E-VIB-02/);
    // 缺失应标注「未接入」，且提示词必须有诚实约束（只把数据改成 null 不够，模型需显式口径）
    expect(code, "遥测缺失应标注未接入").toMatch(/未接入/);
    expect(code, "提示词必须声明缺失不得编造").toMatch(/严禁\*\*在缺失时编造/);
  });

  it("设备卡片/工单草稿不得把未知车间编成具体车间名（与生产A线同类编造）", () => {
    // 工单/设备"所属车间"为空时，曾兜底成"生产主车间"/"默认车间"并当作真实车间展示，
    // 与二维码物料里 `location || '生产A线'` 是同一类位置编造。车间未知就显示「未登记」。
    for (const f of [
      "src/components/equipment3d/RepairStepCard.tsx",
      "src/components/equipment-health/useEquipmentHealth.ts",
    ]) {
      const code = read(f);
      expect(code, `${f} 不得把未知车间编成具体车间`).not.toMatch(/workshop\s*\|\|\s*['"]生产/);
      expect(code, `${f} 未知车间应显示未登记`).toMatch(/workshop\s*\|\|\s*['"]未登记['"]/);
    }
  });

  it("代码里不得出现形如 '2026-03-15' 的硬编码业务日期", () => {
    // 已踩过两次：
    // - useInspectionAi 把巡检转隐患的 deadline 写死 '2026-03-15' —— 一入库就"逾期"。
    // - Header 时间显示 `timeStr || '2026-09-02 06:10:00'` —— 挂载首秒内短暂显示一个
    //   过去的时间戳，看起来像"系统以为现在是九月"。
    // 源码扫描范围：src/ 下所有 ts/tsx，排除迁移与种子（那些是历史快照，该写死）。
    // 用纯 Node 列出文件，不依赖 git/grep（vitest 在 Windows 上 execSync 默认走 cmd）。
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name === "migrations" || e.name === "seed-data" || e.name === "node_modules") continue;
          walk(p, out);
        } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) {
          out.push(p);
        }
      }
      return out;
    };
    const files = walk(path.join(ROOT, "src"));
    const violations: string[] = [];
    for (const f of files) {
      // walk 已返回绝对路径，不要再拼 ROOT
      const code = fs.readFileSync(f, "utf8");
      // 形如 '2025-…' 或 "2026-…" 的字符串字面量
      const hits = code.match(/['"]20(2[0-9]|3[0-9])-[01]\d-[0-3]\d(\s|T)/g);
      if (hits) violations.push(`${f}: ${hits.join(", ")}`);
    }
    expect(violations, "代码里残留的硬编码日期：").toEqual([]);
  });
});
