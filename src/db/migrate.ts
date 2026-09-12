import { runMigrations, getDb } from "./db.ts";

async function main() {
  try {
    console.log("[Migration] 开始启动数据库结构迁移...");
    await runMigrations();
    console.log("[Migration] 数据库表结构迁移执行完成！");
    const db = await getDb();
    await db.close();
    process.exit(0);
  } catch (err) {
    console.error("[Migration] 迁移失败:", err);
    process.exit(1);
  }
}

main();
