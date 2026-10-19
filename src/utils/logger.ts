/**
 * 分级日志工具（前端 / 后端共用接口）。
 *
 * 设计目标（工业级可信可观测性）：
 * - 前端（浏览器）：轻量 console 包装，生产环境静默 debug/info/log，仅 warn/error 常驻。
 * - 后端（Node）：输出结构化 JSON 行（ts / level / traceId / msg / 业务字段）到 stdout，
 *   并**按大小轮转落盘**到 logs/app.log（运维可审计、可接入集中式日志）。
 * - 请求级 traceId：后端通过 AsyncLocalStorage 绑定，使一次请求内所有日志共享同一 traceId，
 *   便于跨服务 / 跨组件的链路追踪。前端无需 traceId。
 *
 * 实现注意：本模块被 Vite（浏览器）与 esbuild（Node，--packages=external）同时打包。
 * 因此对 fs / async_hooks 等 Node 内置模块一律使用**惰性动态 import + 运行时守卫**，
 * 浏览器永远不会执行该分支，Vite 也不会把 node: 内置模块打进浏览器包。
 */

// 是否为 Node 服务端环境（浏览器里 window 存在 → false）。
const isServer =
  typeof window === "undefined" && typeof process !== "undefined";

// 浏览器侧是否开发模式（Vite 注入 import.meta.env.DEV）。
const isBrowserDev =
  typeof import.meta !== "undefined"
    ? (import.meta as any)?.env?.DEV === true
    : false;

// ===================== Node 内置模块惰性加载（仅服务端） =====================
let _fs: typeof import("node:fs") | null = null;
let _path: typeof import("node:path") | null = null;
let _als: { run: <T>(store: any, fn: () => T) => T; getStore: () => any } | null = null;
let _modulesReady = false; // 仅标记 async_hooks 是否尝试过加载（ALS 可能仍为 null 若失败）
let _fileReady = false; // 文件 appender 是否已初始化（成功）
let _logFilePath: string | null = null;
let _fallbackTraceId: string | undefined; // ALS 不可用时的降级（单测/浏览器顺序执行场景）

// 轮转参数：单文件上限 5MB，保留最近 5 个备份。
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 5;

async function ensureServerModules(): Promise<void> {
  if (!isServer || _modulesReady) return;
  _modulesReady = true;
  try {
    const ah = await import(/* @vite-ignore */ "node:async_hooks");
    _als = new (ah as any).AsyncLocalStorage();
    _fs = await import(/* @vite-ignore */ "node:fs");
    _path = await import(/* @vite-ignore */ "node:path");
    initFileAppender();
  } catch {
    // 加载失败（极端环境）：静默降级为 console 输出，不影响主流程。
  }
}

// 模块加载即触发一次（fire-and-forget）。服务端进程启动后很快就绪；
// 若需严格保证（如 createApp 启动早期就写结构化日志），可 await ensureServerModules()。
void ensureServerModules();

function initFileAppender(): void {
  // 测试环境默认不落盘（避免污染测试工作树）；显式 LOG_TO_FILE=1 可强制开启。
  if (process.env.NODE_ENV === "test" && process.env.LOG_TO_FILE !== "1") {
    _fileReady = false;
    return;
  }
  if (!_fs || !_path) return;
  try {
    const dir = _path.join(process.cwd(), "logs");
    if (!_fs.existsSync(dir)) _fs.mkdirSync(dir, { recursive: true });
    _logFilePath = _path.join(dir, "app.log");
    _fileReady = true;
  } catch {
    _logFilePath = null;
    _fileReady = false;
  }
}

function rotateIfNeeded(): void {
  if (!_fs || !_logFilePath || !_fileReady) return;
  try {
    if (_fs.existsSync(_logFilePath) && _fs.statSync(_logFilePath).size > MAX_BYTES) {
      // app.log.4 → 丢弃；app.log.3 → app.log.4；…；app.log → app.log.1
      for (let i = MAX_FILES - 1; i >= 1; i--) {
        const src = i === 1 ? _logFilePath : `${_logFilePath}.${i - 1}`;
        const dst = `${_logFilePath}.${i}`;
        if (_fs.existsSync(src)) _fs.renameSync(src, dst);
      }
    }
  } catch {
    /* 轮转失败不阻塞主流程 */
  }
}

function appendToFile(line: string): void {
  if (!_fs || !_logFilePath || !_fileReady) return;
  try {
    rotateIfNeeded();
    _fs.appendFileSync(_logFilePath, line + "\n");
  } catch {
    /* 落盘失败不阻塞主流程 */
  }
}

// ===================== traceId（请求链路） =====================
/** 在 ALS 上下文内执行 fn，期间 getTraceId() 返回 id。浏览器 / ALS 未就绪时降级为模块变量。 */
export function runWithTraceId(id: string, fn: () => void): void {
  if (_als) {
    _als.run({ traceId: id }, fn);
    return;
  }
  const prev = _fallbackTraceId;
  _fallbackTraceId = id;
  try {
    fn();
  } finally {
    _fallbackTraceId = prev;
  }
}

/** 读取当前请求上下文的 traceId（无则返回 undefined）。 */
export function getTraceId(): string | undefined {
  if (_als) return _als.getStore()?.traceId;
  return _fallbackTraceId;
}

// ===================== 日志输出 =====================
type Level = "debug" | "info" | "log" | "warn" | "error";

function shouldLog(level: Level): boolean {
  if (isServer) {
    // 服务端：debug 仅开发环境；info/warn/error 常驻（工业可观测基线）。
    if (level === "debug") return process.env.NODE_ENV !== "production";
    return true;
  }
  // 浏览器：debug/info/log 仅开发环境；warn/error 常驻。
  if (level === "debug" || level === "info" || level === "log") return isBrowserDev;
  return true;
}

function consoleFallback(level: Level, args: unknown[]): void {
  const prefix =
    level === "debug"
      ? "[DEBUG]"
      : level === "info"
      ? "[INFO]"
      : level === "warn"
      ? "[WARN]"
      : level === "error"
      ? "[ERROR]"
      : "";
  (console as any)[level === "log" ? "log" : level](prefix, ...args);
}

// ===================== 敏感字段脱敏（G6，2026-10-19 试点加固） =====================
// 日志禁止落盘/进入采集管道的字段：密码、令牌、密钥、凭证类。
// 命中规则：键名包含 password/passwd/secret/token/authorization/apikey（大小写不敏感），
// 值一律替换为 [REDACTED]；嵌套对象与数组内的对象同样递归处理（限深 4 层防循环引用）。
const SENSITIVE_KEY_HINT = /(password|passwd|secret|token|authorization|apikey|api_key)/i;
const REDACTED = "[REDACTED]";
const REDACT_MAX_DEPTH = 4;

function redactMeta(meta: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth >= REDACT_MAX_DEPTH) return meta;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE_KEY_HINT.test(k)) {
      out[k] = REDACTED;
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? redactMeta(item as Record<string, unknown>, depth + 1)
          : item
      );
    } else if (v && typeof v === "object") {
      out[k] = redactMeta(v as Record<string, unknown>, depth + 1);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function emit(level: Level, args: unknown[]): void {
  // 解析首个参数：对象视为结构化字段（meta），字符串视为消息。
  let meta: Record<string, unknown> = {};
  let msg = "";
  if (args.length === 0) {
    // 无内容
  } else if (typeof args[0] === "object" && args[0] !== null) {
    meta = args[0] as Record<string, unknown>;
    msg = typeof args[1] === "string" ? (args[1] as string) : "";
  } else {
    msg = String(args[0]);
    if (args.length > 1 && typeof args[1] === "object" && args[1] !== null) {
      meta = args[1] as Record<string, unknown>;
    }
  }

  const traceId = getTraceId();
  if (traceId) meta = { ...meta, traceId };

  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...redactMeta(meta),
  };
  const line = JSON.stringify(entry);

  // stdout：结构化 JSON（便于容器 / 集中式日志采集）。
  (console as any)[level === "log" ? "log" : level](line);
  // 落盘：轮转文件（best-effort）。
  appendToFile(line);
}

function make(level: Level): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    if (!shouldLog(level)) return;
    if (isServer) {
      emit(level, args);
    } else {
      consoleFallback(level, args);
    }
  };
}

export const logger = {
  debug: make("debug"),
  info: make("info"),
  log: make("log"),
  warn: make("warn"),
  error: make("error"),
};

export default logger;

/** 供启动期主动等待 Node 模块就绪（确保最早的结构化日志也进入文件 / ALS）。 */
export { ensureServerModules };
