// 安全修复冒烟探针：在真实运行时核对三项修复是否生效（等价于对着起好的服务手工 curl 一遍）。
//
// 覆盖：
//   1. GET  /health/detail            —— ESM require("os") 崩溃已修（期望 200）
//   2. GET  /api/v1/auth/me           —— 不再回传 Bcrypt 散列 / 微信 openid
//   3. POST 任意写接口 + 站外 Origin   —— CSRF 绕过判据已收紧为「令牌验签通过」
//   4. POST /api/v1/xingyun/session   —— ESM require("crypto") 崩溃已修
//
// 用法（推荐 test 模式：内存数据库，进程内建表+播种，跑完即销毁，
//       既不受持久化 PGlite 偶发 WASM Aborted 影响，也不污染 ./data 目录）：
//   NODE_ENV=test npx tsx scripts/smoke-security-fixes.ts
//
// 注意：脚本会真实登录一次（使用种子账号 admin），请勿在生产环境运行。
import { createApp } from "../server.ts";
import { initDatabase } from "../src/db/db.ts";

// 内存模式下必须先建表 + 播种，否则 users 表不存在
await initDatabase();

const app = await createApp();
const server = app.listen(0);
await new Promise<void>((resolve) => server.once("listening", () => resolve()));
const port = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;

const out: Record<string, any> = {};

// 1) /health/detail —— 修复前：500 {"message":"require is not defined"}
try {
  const r = await fetch(`${base}/health/detail`);
  const b: any = await r.json();
  out.healthDetail = { status: r.status, status_field: b.status, systemTotalMb: b?.checks?.memory?.systemTotalMb };
} catch (e: any) {
  out.healthDetail = { error: String(e) };
}

// 2) 登录拿 token
let token = "";
try {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "Admin@2026#Demo" }),
  });
  const b: any = await r.json();
  token = b?.token || "";
  out.login = { status: r.status, hasToken: !!token };
} catch (e: any) {
  out.login = { error: String(e) };
}

// 3) /auth/me 泄露检查 —— 修复前：响应含 password(bcrypt) 与 wxOpenId
if (token) {
  const r = await fetch(`${base}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  const b: any = await r.json();
  out.authMe = {
    status: r.status,
    returnedKeys: Object.keys(b || {}).sort(),
    hasPassword: Object.prototype.hasOwnProperty.call(b || {}, "password"),
    hasWxOpenId: Object.prototype.hasOwnProperty.call(b || {}, "wxOpenId"),
    passwordLooksLikeBcrypt: typeof b?.password === "string" && b.password.startsWith("$2"),
  };
}

// 4) CSRF：伪造 Bearer 前缀 + 站外 Origin —— 修复前会被直接放行
try {
  const r = await fetch(`${base}/api/v1/__csrf_probe`, {
    method: "POST",
    headers: { Authorization: "Bearer not-a-real-token", Origin: "https://evil.example.com", "Content-Type": "application/json" },
    body: "{}",
  });
  const b: any = await r.json();
  out.csrfForgedBearer = { status: r.status, code: b?.code, note: "期望 403 CSRF_FORBIDDEN" };
} catch (e: any) {
  out.csrfForgedBearer = { error: String(e) };
}

// 5) CSRF：有效令牌 + 站外 Origin —— 应放行（随后由路由返回 404）
if (token) {
  const r = await fetch(`${base}/api/v1/__csrf_probe`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Origin: "https://evil.example.com", "Content-Type": "application/json" },
    body: "{}",
  });
  out.csrfValidBearer = { status: r.status, note: "期望非 403（已越过 CSRF）" };
}

// 6) /api/v1/xingyun/session —— 修复前：500 {"message":"require is not defined"}
if (token) {
  const r = await fetch(`${base}/api/v1/xingyun/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: "{}",
  });
  const b: any = await r.json();
  out.xingyunSession = { status: r.status, error_code: b?.error_code, message: b?.message || b?.error_reason };
}

console.log(JSON.stringify(out, null, 2));
server.close();
process.exit(0);
