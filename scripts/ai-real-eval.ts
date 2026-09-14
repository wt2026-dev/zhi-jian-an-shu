/**
 * AI 真实模型效果评测脚本（调用已运行的容器 API）。
 *
 * 用法：npx tsx scripts/ai-real-eval.ts
 *
 * 前置条件：
 *   - Docker 容器 industrial-maintenance-app 已运行（docker compose up -d）
 *   - .env 中 DASHSCOPE_API_KEY 已配置（容器已注入）
 *
 * 评测内容：
 *   A. 设备故障诊断（15 条）—— 真实调用 qwen-plus
 *   B. 视觉缺陷识别（4 张）—— 真实调用 qwen-vl-max
 */
import fs from "fs";
import path from "path";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const OUTPUT_DIR = path.resolve("scratch/ai-real-eval-output");
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ==================== HTTP 工具函数 ====================
async function api(method: string, url: string, body?: any, token?: string): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const opts: RequestInit = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${url}`, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function login(): Promise<string> {
  const { status, data } = await api("POST", "/api/v1/auth/login", { username: "admin", password: "Admin@2026#Demo" });
  if (status !== 200 || !data.token) {
    console.error("[ai-real-eval] 登录失败:", JSON.stringify(data));
    process.exit(1);
  }
  return data.token;
}

// ==================== 诊断样本 ====================
interface DiagSample {
  id: string;
  equipmentName: string;
  symptoms: string;
  expectKeywords: string[];
}

const DIAG_SAMPLES: DiagSample[] = [
  { id: "diag_01", equipmentName: "轧机行星减速箱", symptoms: "输入轴剧烈振动超标，伴随高频金属摩擦异响", expectKeywords: ["减速机", "齿轮", "润滑"] },
  { id: "diag_02", equipmentName: "离心给水泵", symptoms: "前轴承箱油温异常偏高，端面机械密封微量滴漏", expectKeywords: ["机械密封", "轴承"] },
  { id: "diag_03", equipmentName: "无油空压机", symptoms: "空气滤清器差压超标，末级油气分离器需要维护", expectKeywords: ["滤清器", "油气分离"] },
  { id: "diag_04", equipmentName: "冷轧卷取机减速机", symptoms: "高速轴油温高报警，齿面周期性敲击异响", expectKeywords: ["齿面", "润滑", "减速机"] },
  { id: "diag_05", equipmentName: "结晶器冷却循环泵电机", symptoms: "三相电流不平衡，泵体机封大量渗水", expectKeywords: ["电流不平衡", "机封"] },
  { id: "diag_06", equipmentName: "六轴搬运机器人", symptoms: "J3 轴重复定位精度漂移，减速机异响", expectKeywords: ["定位精度", "减速机"] },
  { id: "diag_07", equipmentName: "高压锅炉给水泵", symptoms: "平衡盘磨损，轴向窜动量超标", expectKeywords: ["平衡盘", "轴向窜动"] },
  { id: "diag_08", equipmentName: "离心空压机", symptoms: "级间冷却器结垢，排气温度高，流量衰减", expectKeywords: ["冷却器", "排气温度"] },
  { id: "diag_09", equipmentName: "五轴龙门加工中心", symptoms: "主轴温升超标，刀具夹紧力不足报警", expectKeywords: ["主轴", "温升", "夹紧"] },
  { id: "diag_10", equipmentName: "板式换热器", symptoms: "二次侧进出口压差异常升高，换热效率下降", expectKeywords: ["压差", "结垢", "换热"] },
  { id: "diag_11", equipmentName: "环冷机余热回收热管换热器", symptoms: "换热效率衰减，翅片积灰", expectKeywords: ["翅片", "积灰", "换热"] },
  { id: "diag_12", equipmentName: "烧结主抽风机同步电动机", symptoms: "驱动端轴瓦温度偏高，冷却水流量不足", expectKeywords: ["轴瓦", "冷却"] },
  { id: "diag_13", equipmentName: "螺杆制冷压缩机", symptoms: "油压差开关误动作，频繁停机", expectKeywords: ["油压差", "开关"] },
  { id: "diag_14", equipmentName: "高压循环水主电机", symptoms: "驱动端轴承温度偏高，需要补脂作业", expectKeywords: ["轴承", "润滑脂"] },
  { id: "diag_15", equipmentName: "码垛机器人", symptoms: "真空抓具吸盘老化，频繁掉箱", expectKeywords: ["吸盘", "真空"] },
];

// ==================== 视觉样本 ====================
interface VisionSample {
  id: string;
  filename: string;
  equipmentType: string;
}

const VISION_SAMPLES: VisionSample[] = [
  { id: "vision_01", filename: "equipment_defect_gearbox_02.png", equipmentType: "旋转机电设备" },
  { id: "vision_02", filename: "equipment_defect_pump_01.png", equipmentType: "旋转机电设备" },
  { id: "vision_03", filename: "equipment_thermal_motor_03.png", equipmentType: "旋转机电设备" },
  { id: "vision_04", filename: "equipment_vibration_check_04.png", equipmentType: "旋转机电设备" },
];

// ==================== 主逻辑 ====================
interface EvalResult {
  id: string;
  category: string;
  name: string;
  pass: boolean;
  detail: string;
  rawOutput: any;
}

const allResults: EvalResult[] = [];

function record(r: EvalResult) {
  allResults.push(r);
  console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.id} ${r.name} — ${r.detail}`);
}

// 1. 登录
console.log(`[ai-real-eval] 连接 ${BASE_URL}`);
const token = await login();
console.log("[ai-real-eval] 登录成功，开始真实模型评测\n");

// ==================== A. 诊断评测（15 条） ====================
console.log("=== A. 设备故障诊断（qwen-plus 真实调用，15 条） ===\n");

for (const s of DIAG_SAMPLES) {
  const start = Date.now();
  const { status, data } = await api("POST", "/api/v1/ai/diagnose", {
    equipmentName: s.equipmentName,
    category: "旋转设备",
    symptoms: s.symptoms,
  }, token);
  const elapsed = Date.now() - start;

  // 保存原始响应
  fs.writeFileSync(path.join(OUTPUT_DIR, `${s.id}.json`), JSON.stringify({ sample: s, status, elapsedMs: elapsed, response: data }, null, 2));

  // 判定
  const success = data?.success === true;
  const notDegraded = data?.degraded !== true;
  const diag = data?.diagnosis || data || {};
  const allText = JSON.stringify(diag);
  const hasKeywords = s.expectKeywords.some((kw) => allText.includes(kw));
  const summary = diag.summary || "";
  const causes = diag.probableCauses || [];
  const actions = diag.recommendedActions || [];
  const safety = diag.safetyPrecautions || [];
  const fieldsComplete = summary.length > 10 && causes.length > 0 && actions.length > 0 && safety.length > 0;

  const pass = success && notDegraded && hasKeywords && fieldsComplete;
  const detail = pass
    ? `成功+非降级+关键词命中+字段完整 (${elapsed}ms)`
    : `success=${success} degraded=${data?.degraded} keywords=${hasKeywords} fields=${fieldsComplete} (${elapsed}ms)`;

  record({ id: s.id, category: "诊断", name: s.equipmentName, pass, detail, rawOutput: data });
}

// ==================== B. 视觉评测（4 张） ====================
console.log("\n=== B. 视觉缺陷识别（qwen-vl-max 真实调用，4 张） ===\n");

for (const s of VISION_SAMPLES) {
  const imgPath = path.join("dist", "uploads", s.filename);
  if (!fs.existsSync(imgPath)) {
    record({ id: s.id, category: "视觉", name: s.filename, pass: false, detail: `图片不存在: ${imgPath}`, rawOutput: null });
    continue;
  }

  const imgBuf = fs.readFileSync(imgPath);
  const base64 = imgBuf.toString("base64");
  const imageBase64 = `data:image/png;base64,${base64}`;

  const start = Date.now();
  const { status, data } = await api("POST", "/api/v1/ai/vision-defect-detect", {
    imageBase64,
    equipmentType: s.equipmentType,
  }, token);
  const elapsed = Date.now() - start;

  // 保存原始响应（图片 base64 太大，不存入输出）
  fs.writeFileSync(path.join(OUTPUT_DIR, `${s.id}.json`), JSON.stringify({ sample: { ...s, imageBase64: "(omitted)" }, status, elapsedMs: elapsed, response: data }, null, 2));

  // 判定
  const success = data?.success === true;
  const notDegraded = data?.degraded !== true;
  const defectResult = data?.defectResult || data?.result || {};
  const confidence = defectResult.confidence;
  const validConfidence = typeof confidence === "number" && confidence >= 0 && confidence <= 1;
  const summary = data?.summary || defectResult.summary || "";
  const hasSummary = summary.length > 5;

  const pass = success && notDegraded && validConfidence && hasSummary;
  const detail = pass
    ? `成功+非降级+confidence=${confidence}+summary非空 (${elapsed}ms)`
    : `success=${success} degraded=${data?.degraded} confidence=${confidence} summary=${hasSummary} (${elapsed}ms)`;

  record({ id: s.id, category: "视觉", name: s.filename, pass, detail, rawOutput: data });
}

// ==================== 汇总 ====================
const total = allResults.length;
const passed = allResults.filter((r) => r.pass).length;
const byCategory: Record<string, { total: number; passed: number }> = {};
for (const r of allResults) {
  byCategory[r.category] = byCategory[r.category] || { total: 0, passed: 0 };
  byCategory[r.category].total += 1;
  if (r.pass) byCategory[r.category].passed += 1;
}

console.log("\n================ AI 真实模型评测结果 ================");
for (const [cat, v] of Object.entries(byCategory)) {
  console.log(`  ${cat}: ${v.passed}/${v.total} 通过`);
}
console.log(`  总计: ${passed}/${total} 通过（通过率 ${((passed / total) * 100).toFixed(1)}%）`);
console.log("  模式: 真实 DashScope Key + qwen-plus / qwen-vl-max");
console.log("====================================================");

// JSON 输出
const summary = {
  date: new Date().toISOString(),
  baseUrl: BASE_URL,
  mode: "real-dashscope",
  model: { diagnosis: "qwen-plus", vision: "qwen-vl-max" },
  total,
  passed,
  passRate: Number(((passed / total) * 100).toFixed(1)),
  byCategory,
  results: allResults.map((r) => ({ id: r.id, category: r.category, name: r.name, pass: r.pass, detail: r.detail })),
};
console.log("\n" + JSON.stringify(summary, null, 2));

process.exit(0);
