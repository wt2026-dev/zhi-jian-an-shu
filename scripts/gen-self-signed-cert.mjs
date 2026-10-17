#!/usr/bin/env node
/**
 * 生成自签 TLS 证书，让部署在裸 IP 上的服务能给 Godot Web 导出提供安全上下文。
 *
 *   node scripts/gen-self-signed-cert.mjs --host 49.233.145.33 [--host demo.internal] [--days 825]
 *
 * 产物默认落在 certs/（已在 .gitignore 内，私钥绝不入库）：certs/<first-host>.key / .crt
 * 生成后给服务端进程设：
 *   TLS_KEY_PATH=certs/49.233.145.33.key  TLS_CERT_PATH=certs/49.233.145.33.crt
 * 并删掉 DISABLE_HSTS=1（见 src/server/index.ts 的 TLS 注释）。
 *
 * 自签证书浏览器会先报"连接不是私密连接"，点"高级 → 继续访问"后即可，
 * 一旦页面变成 https:// 来源，window.isSecureContext 即为 true。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const hosts = [];
  let days = 825;
  let outDir = "certs";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--host" || a === "-h") hosts.push(argv[++i]);
    else if (a === "--days") days = Number(argv[++i]);
    else if (a === "--out") outDir = argv[++i];
    else throw new Error(`未知参数：${a}（用法见文件头注释）`);
  }
  if (!hosts.length) throw new Error("至少要用 --host 给一个 IP 或域名（SAN 里没有的地址浏览器一律拒绝）");
  return { hosts, days, outDir };
}

const isIp = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) || s.includes(":");

function opensslVersion() {
  try {
    return execFileSync("openssl", ["version"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("未找到 openssl。Windows 可用 Git-Bash 自带版本，Linux 服务器：apt-get install -y openssl");
  }
}

const { hosts, days, outDir } = parseArgs(process.argv.slice(2));
console.log(opensslVersion());

const san = hosts.map((h) => `${isIp(h) ? "IP" : "DNS"}:${h}`).join(",");
const base = hosts[0].replace(/[^\w.-]/g, "_");
fs.mkdirSync(outDir, { recursive: true });
const keyPath = path.join(outDir, `${base}.key`);
const crtPath = path.join(outDir, `${base}.crt`);

execFileSync(
  "openssl",
  [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", keyPath, "-out", crtPath, "-days", String(days),
    "-subj", `/CN=${hosts[0]}`,
    // -addext 需要 openssl ≥1.1.1；SAN 缺失时新版 Chrome 直接判 ERR_CERT_COMMON_NAME_INVALID
    "-addext", `subjectAltName=${san}`,
    "-addext", "basicConstraints=critical,CA:FALSE",
    "-addext", "keyUsage=critical,digitalSignature,keyEncipherment",
    "-addext", "extendedKeyUsage=serverAuth",
  ],
  { stdio: ["ignore", "ignore", "inherit"] }
);
fs.chmodSync(keyPath, 0o600);

console.log(`\n证书已生成：`);
console.log(`  ${crtPath}`);
console.log(`  ${keyPath}  (0600)`);
console.log(`  SAN: ${san} ｜ 有效期 ${days} 天`);
console.log(`\n服务端启用（两个变量必须成对，且不要再设 DISABLE_HSTS=1）：`);
console.log(`  TLS_CERT_PATH=${crtPath}`);
console.log(`  TLS_KEY_PATH=${keyPath}`);
console.log(`\n验证：curl -k https://<host>:3000/health 应返回 200 JSON`);
