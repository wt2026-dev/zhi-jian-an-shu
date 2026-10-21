/**
 * 优雅退出时的自动留底（2026-10-20）
 *
 * 为什么挂在退出、而不是 `npm run dev` 之前：
 * 实测（scratch/pglockprobe.mjs）对已被某实例持有的 PGlite 目录再 `new PGlite()` 并**不会**
 * 报错——第二个实例打开成功，还会改写 postmaster.pid。也就是说"目录被持有会 fail-fast"这个
 * 前提是假的，而 PGlite 又不提供可用的持有者判据（postmaster.pid 首行是 wasm 内的 `-42`，
 * 不是宿主 PID；对 pg_control / pg_wal 做 rename-self 探针在持有状态下照样成功）。
 * 所以启动前备份会在"已有实例在跑"时双开活库。退出路径则相反：db.close() 之后我们就是最后
 * 一个持有者且已经松手，此刻重新打开目录做 dumpDataDir 是唯一天然安全的一致性快照时机。
 *
 * 失败一律只记日志、不抛出：留底没成功不该把关闭流程卡住或让进程带非零码退出。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { logger } from "../../utils/logger.ts";
import { getPgliteActiveDir } from "../../db/db.ts";
import { PGlite, dumpPgliteToBuffer, verifySnapshotDb } from "./backupService.ts";

const PREFIX = "pglite-snapshot";

function stampNow(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/**
 * 解包 + 重开 + 关键表校验。返回 null 表示快照不可用。
 * 备份文件先复制进临时工作目录再用相对名解包：Git-Bash 的 tar 会把 "D:\..." 里的冒号
 * 当成 host:path（报 Cannot connect to D:），相对路径 + cwd 才是跨 shell 稳的写法。
 */
async function verifySnapshotFile(snapshotPath: string): Promise<{ ok: boolean; users: number } | null> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "pglite-shutdown-verify-"));
  let db: PGlite | null = null;
  try {
    const staged = path.basename(snapshotPath) + ".verify";
    fs.copyFileSync(snapshotPath, path.join(workDir, staged));
    fs.mkdirSync(path.join(workDir, "data"), { recursive: true });
    execFileSync("tar", ["-xzf", staged, "-C", "data"], { cwd: workDir, stdio: "ignore" });
    db = new PGlite(path.join(workDir, "data"));
    await db.waitReady;
    const result = await verifySnapshotDb(db);
    const users = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM users;");
    return { ok: result.ok, users: Number(users.rows[0]?.n ?? 0) };
  } catch (e) {
    logger.warn("[Shutdown][snapshot] 解包/重开失败:", e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    await db?.close().catch(() => undefined);
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/** 只清自己的产物（pglite-snapshot-*.tar.gz），不碰手工热拷贝与容器卷备份。 */
function prune(backupDir: string, keepN: number) {
  if (keepN <= 0) return;
  const files = fs
    .readdirSync(backupDir)
    .filter((f) => new RegExp(`^${PREFIX}-.*\\.tar\\.gz$`).test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(backupDir, f)).mtimeMs }))
    // mtime 相同（同一次写入落在同一时钟刻度）时按文件名倒序兜底：
    // 文件名本身是 ISO 时间戳，阅读顺序=新旧顺序；否则清理谁取决于目录枚举顺序。
    .sort((a, b) => b.t - a.t || b.f.localeCompare(a.f));
  for (const { f } of files.slice(keepN)) {
    fs.rmSync(path.join(backupDir, f), { force: true });
    logger.info(`[Shutdown][snapshot] 已删除过期留底: ${f}`);
  }
}

/**
 * 关闭路径专用：把当前活跃 PGlite 目录导出为一致性快照并校验。
 * dataDir/backupDir 可注入（测试与迁移演练用），默认取运行时活跃目录与 <cwd>/backups。
 * @returns 成功时返回快照路径；跳过（非 PGlite 磁盘模式）或失败时返回 null。
 */
export async function writeShutdownSnapshot(opts: {
  dataDir?: string | null;
  backupDir?: string;
  keepN?: number;
} = {}): Promise<string | null> {
  const dataDir = opts.dataDir !== undefined ? opts.dataDir : getPgliteActiveDir();
  if (!dataDir) {
    logger.info("[Shutdown][snapshot] 非 PGlite 磁盘模式（postgres/内存库），跳过留底");
    return null;
  }
  const backupDir = opts.backupDir || path.join(process.cwd(), "backups");
  const keepN = opts.keepN ?? Number(process.env.SHUTDOWN_SNAPSHOT_KEEP_N || 7);
  fs.mkdirSync(backupDir, { recursive: true });
  const finalPath = path.join(backupDir, `${PREFIX}-${stampNow()}.tar.gz`);
  const tmpPath = `${finalPath}.tmp`;
  const t0 = Date.now();

  try {
    const buf = await dumpPgliteToBuffer(dataDir);
    fs.writeFileSync(tmpPath, buf);
    const check = await verifySnapshotFile(tmpPath);
    if (!check || !check.ok) {
      fs.rmSync(tmpPath, { force: true });
      logger.warn(`[Shutdown][snapshot] 校验未通过，已丢弃 ${path.basename(finalPath)}（未删除任何既有留底）`);
      return null;
    }
    fs.renameSync(tmpPath, finalPath);
    logger.info(
      `[Shutdown][snapshot] 留底完成: ${path.basename(finalPath)} ` +
        `(${(buf.length / 1024 / 1024).toFixed(1)} MB, users=${check.users}, 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s)`
    );
    // 空库（例如刚 fallback 出来的新目录）不触发清理，免得把真正有数据的旧底挤掉
    if (check.users > 0) prune(backupDir, keepN);
    else logger.warn("[Shutdown][snapshot] users=0，本次不执行保留清理（保留全部旧底）");
    return finalPath;
  } catch (e) {
    fs.rmSync(tmpPath, { force: true });
    logger.warn("[Shutdown][snapshot] 留底失败（不影响退出）:", e instanceof Error ? e.message : String(e));
    return null;
  }
}
