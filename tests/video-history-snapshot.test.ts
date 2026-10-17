/**
 * 守卫：`procedure_videos` 快照 / 自愈（src/db/videoHistorySnapshot.ts）。
 *
 * 为什么值得一条守卫：这条链路是"视频历史会不会再次凭空消失"的唯一防线，
 * 而它的失效方式**非常安静** —— 快照没写、回填没生效，界面上只是历史列表空了，
 * 没有任何报错。2026-09-18 就是因为 PGlite 数据目录被非正常终止弄坏后重建，
 * 而 procedure_videos 不在 seed-data 里，历史被静默清空。
 *
 * ⚠️ 本模块**会写文件**，所以每个用例都必须把快照路径指到临时目录；
 * 模块内还有一道保险丝：测试环境下未指定 VIDEO_HISTORY_SNAPSHOT_PATH 时直接跳过读写。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 必须在 import 被测模块**之前**设好：路径是惰性求值的，但保险丝看的是 process.env
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'video-snapshot-test-'));
process.env.VIDEO_HISTORY_SNAPSHOT_PATH = path.join(TMP_DIR, 'snapshot.json');

const { writeVideoHistorySnapshot, healVideoHistoryFromSnapshot, getVideoHistorySnapshotPath } =
  await import('../src/db/videoHistorySnapshot.ts');
const { getDb, initDatabase } = await import('../src/db/db.ts');

const SNAP = getVideoHistorySnapshotPath();

async function db() {
  return getDb();
}

/** 造一条真实存在的规程，回填时外键才有得指 */
async function ensureProcedure(id: string) {
  const d = await db();
  await d.query(
    `INSERT INTO maintenance_procedures (id, title, equipment_type, maintenance_level, steps)
     VALUES ($1, $2, 'motor', 'daily', '[]'::jsonb)
     ON CONFLICT (id) DO NOTHING;`,
    [id, `测试规程 ${id}`]
  );
}

async function clearVideos() {
  const d = await db();
  await d.query(`DELETE FROM procedure_videos;`);
}

beforeAll(async () => {
  await initDatabase();
  // 内存 PGlite：每个测试文件独立，这里只需保证基线干净
  await clearVideos();
}, 60000);

afterEach(async () => {
  // 用例之间必须把表清干净：否则上一条留下的 pvid-test-1 会让下一条的主键插入撞车，
  // 报出来的"duplicate key"看着像被测代码的 bug，其实是用例互相污染。
  await clearVideos();
  try {
    fs.rmSync(SNAP, { force: true });
  } catch {}
});

describe('procedure_videos 快照 / 自愈', () => {
  it('快照路径来自 VIDEO_HISTORY_SNAPSHOT_PATH，没有落到仓库里的真快照上', () => {
    expect(SNAP).toBe(path.join(TMP_DIR, 'snapshot.json'));
    expect(SNAP).not.toContain(path.join('data', 'video-history-snapshot.json'));
  });

  it('表为空时不写快照（不能用空表把唯一的好状态刷掉）', async () => {
    await clearVideos();
    const n = await writeVideoHistorySnapshot();
    expect(n).toBe(0);
    expect(fs.existsSync(SNAP)).toBe(false);
  });

  it('表非空时写快照，且内容可被完整读回', async () => {
    await ensureProcedure('proc-snap-a');
    const d = await db();
    await d.query(
      `INSERT INTO procedure_videos (id, procedure_id, task_id, status, video_url, prompt, error)
       VALUES ('pvid-test-1','proc-snap-a','full-1700000000001','completed',
               '/uploads/full-videos/full-1700000000001.mp4','p',NULL);`
    );

    const n = await writeVideoHistorySnapshot();
    expect(n).toBe(1);

    const payload = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
    expect(payload.count).toBe(1);
    expect(payload.rows).toHaveLength(1);
    expect(payload.rows[0].task_id).toBe('full-1700000000001');
    expect(payload.rows[0].video_url).toBe('/uploads/full-videos/full-1700000000001.mp4');
    expect(payload.rows[0].status).toBe('completed');
    // 快照必须覆盖全部列，否则回填会丢字段
    for (const c of [
      'id', 'procedure_id', 'task_id', 'status', 'video_url', 'prompt',
      'error', 'progress_pct', 'internal_status', 'created_at', 'updated_at',
    ]) {
      expect(payload.rows[0]).toHaveProperty(c);
    }
  });

  it('表为空 + 有快照 → 回填（这正是"库被重建后历史消失"的修复路径）', async () => {
    await ensureProcedure('proc-snap-a');
    const d = await db();
    await d.query(
      `INSERT INTO procedure_videos (id, procedure_id, task_id, status, video_url)
       VALUES ('pvid-test-1','proc-snap-a','full-1700000000001','completed',
               '/uploads/full-videos/full-1700000000001.mp4');`
    );
    await writeVideoHistorySnapshot();

    // 模拟"库被重建"：表被清空，快照还在
    await clearVideos();
    const restored = await healVideoHistoryFromSnapshot();

    expect(restored).toBe(1);
    const { rows } = await d.query<any>(`SELECT * FROM procedure_videos;`);
    expect(rows).toHaveLength(1);
    expect(rows[0].task_id).toBe('full-1700000000001');
    expect(rows[0].video_url).toBe('/uploads/full-videos/full-1700000000001.mp4');
  });

  it('回填是幂等的：再跑一次不会插重复', async () => {
    await ensureProcedure('proc-snap-a');
    const d = await db();
    await d.query(
      `INSERT INTO procedure_videos (id, procedure_id, task_id, status)
       VALUES ('pvid-test-1','proc-snap-a','full-1700000000001','completed');`
    );
    await writeVideoHistorySnapshot();
    await clearVideos();

    expect(await healVideoHistoryFromSnapshot()).toBe(1);
    expect(await healVideoHistoryFromSnapshot()).toBe(0); // 表已非空
    const { rows } = await d.query<any>(`SELECT COUNT(*)::int AS c FROM procedure_videos;`);
    expect(rows[0].c).toBe(1);
  });

  it('表非空时绝不回填（不能把用户删掉的历史又塞回去）', async () => {
    await ensureProcedure('proc-snap-a');
    const d = await db();
    await d.query(
      `INSERT INTO procedure_videos (id, procedure_id, task_id, status)
       VALUES ('pvid-test-1','proc-snap-a','full-1700000000001','completed');`
    );
    await writeVideoHistorySnapshot();

    // 表里换成另一条（模拟用户自己产生的新数据）
    await clearVideos();
    await d.query(
      `INSERT INTO procedure_videos (id, procedure_id, task_id, status)
       VALUES ('pvid-test-2','proc-snap-a','full-1700000000002','failed');`
    );

    expect(await healVideoHistoryFromSnapshot()).toBe(0);
    const { rows } = await d.query<any>(`SELECT id FROM procedure_videos;`);
    expect(rows.map((r) => r.id)).toEqual(['pvid-test-2']);
  });

  it('规程已不存在的行跳过，不硬插（外键会炸，也会造出指向不存在规程的历史）', async () => {
    await ensureProcedure('proc-snap-a');
    const d = await db();
    await d.query(
      `INSERT INTO procedure_videos (id, procedure_id, task_id, status)
       VALUES ('pvid-ok','proc-snap-a','full-1700000000001','completed');`
    );
    await writeVideoHistorySnapshot();

    // 手工往快照里塞一条指向不存在规程的行（直接插库会被外键拦住，只能从快照侧构造）
    const payload = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
    payload.rows.push({
      id: 'pvid-orphan',
      procedure_id: 'proc-does-not-exist',
      task_id: 'full-1700000000002',
      status: 'completed',
    });
    payload.count = payload.rows.length;
    fs.writeFileSync(SNAP, JSON.stringify(payload), 'utf8');

    await clearVideos();
    const restored = await healVideoHistoryFromSnapshot();

    expect(restored).toBe(1);
    const { rows } = await d.query<any>(`SELECT id FROM procedure_videos;`);
    expect(rows.map((r) => r.id)).toEqual(['pvid-ok']);
  });

  it('快照文件缺失时安全返回 0（首次安装、没生成过视频的情况）', async () => {
    await clearVideos();
    fs.rmSync(SNAP, { force: true });
    expect(await healVideoHistoryFromSnapshot()).toBe(0);
  });

  it('快照文件损坏时不抛异常，只是放弃回填（不能因为一个 json 起不来服务）', async () => {
    await clearVideos();
    fs.mkdirSync(path.dirname(SNAP), { recursive: true });
    fs.writeFileSync(SNAP, '{ 这不是合法 json', 'utf8');
    expect(await healVideoHistoryFromSnapshot()).toBe(0);
  });
});
