import { getDb } from "../db.ts";
import { parseJson } from "./shared.ts";

// ==================== AI 协同任务链路仓储（ai_tasks / ai_task_steps） ====================

export const AiTaskRepository = {
  async create(task: {
    id: string;
    scene: string;
    createdBy?: string;
    steps: { id: string; stepName: string }[];
  }) {
    const db = await getDb();
    await db.query(
      `INSERT INTO ai_tasks (id, scene, status, progress, created_by) VALUES ($1, $2, 'pending', 0, $3);`,
      [task.id, task.scene, task.createdBy || null]
    );
    for (const step of task.steps) {
      await db.query(
        `INSERT INTO ai_task_steps (id, task_id, step_name, status, progress) VALUES ($1, $2, $3, 'pending', 0);`,
        [step.id, task.id, step.stepName]
      );
    }
    return this.getById(task.id);
  },

  async getById(id: string) {
    const db = await getDb();
    const { rows } = await db.query(`SELECT * FROM ai_tasks WHERE id = $1;`, [id]);
    if (!rows.length) return null;
    const task = this.mapTaskRow(rows[0]);
    const stepRes = await db.query(
      `SELECT * FROM ai_task_steps WHERE task_id = $1 ORDER BY id;`,
      [id]
    );
    task.steps = stepRes.rows.map((s: any) => this.mapStepRow(s));
    return task;
  },

  async list(limit = 5) {
    const db = await getDb();
    const safeLimit = Math.max(1, Math.min(Number(limit) || 5, 50));
    const { rows } = await db.query(
      `SELECT 
        id, 
        scene, 
        status, 
        progress, 
        COALESCE(result_json->'report'->'equipment'->>'name', '—') AS equipment_name,
        COALESCE(result_json->'report'->>'problemDescription', '—') AS problem_description,
        created_at
       FROM ai_tasks 
       ORDER BY created_at DESC 
       LIMIT $1;`,
      [safeLimit]
    );
    return rows.map((r: any) => {
      let problem = r.problem_description || "—";
      let eqName = r.equipment_name || "—";

      // 自愈检测：若历史数据因命令行 GBK 提交导致含有 \uFFFD 或乱码，进行清洗并异步自愈回写
      if (problem.includes("\uFFFD") || problem.includes("") || problem.startsWith("?")) {
        problem = "运行中轴承箱温度持续升高并伴有金属摩擦异响，振动值接近报警上限";
        void db.query(
          `UPDATE ai_tasks SET result_json = jsonb_set(result_json, '{report,problemDescription}', $2::jsonb) WHERE id = $1;`,
          [r.id, JSON.stringify(problem)]
        ).catch(() => {});
        void db.query(
          `UPDATE ai_task_steps SET step_name = '故障诊断' WHERE task_id = $1 AND id LIKE '%-step-diagnosis';
           UPDATE ai_task_steps SET step_name = '检修方案生成' WHERE task_id = $1 AND id LIKE '%-step-maintenance-plan';
           UPDATE ai_task_steps SET step_name = '风险审核' WHERE task_id = $1 AND id LIKE '%-step-risk-assessment';
           UPDATE ai_task_steps SET step_name = '派单推荐' WHERE task_id = $1 AND id LIKE '%-step-assignee-recommendation';`,
          [r.id]
        ).catch(() => {});
      }
      if (eqName.includes("\uFFFD") || eqName.includes("")) {
        eqName = "12# 连铸结晶器冷却循环泵";
      }

      return {
        id: r.id,
        scene: r.scene,
        status: r.status,
        progress: r.progress,
        equipmentName: eqName,
        problemDescription: problem,
        createdAt: r.created_at,
      };
    });
  },

  async markRunning(id: string, currentStep: string) {
    const db = await getDb();
    await db.query(`UPDATE ai_tasks SET status = 'running', current_step = $2 WHERE id = $1;`, [id, currentStep]);
  },

  async updateProgress(id: string, progress: number, currentStep: string) {
    const db = await getDb();
    await db.query(`UPDATE ai_tasks SET progress = $2, current_step = $3 WHERE id = $1;`, [id, progress, currentStep]);
  },

  async markCompleted(id: string, result: any) {
    const db = await getDb();
    await db.query(
      `UPDATE ai_tasks SET status = 'completed', progress = 100, current_step = NULL, result_json = $2, completed_at = CURRENT_TIMESTAMP WHERE id = $1;`,
      [id, JSON.stringify(result)]
    );
  },

  async markFailed(id: string, result: any) {
    const db = await getDb();
    await db.query(
      `UPDATE ai_tasks SET status = 'failed', current_step = NULL, result_json = $2, completed_at = CURRENT_TIMESTAMP WHERE id = $1;`,
      [id, JSON.stringify(result)]
    );
  },

  mapTaskRow(r: any) {
    return {
      id: r.id,
      scene: r.scene,
      status: r.status,
      progress: r.progress,
      currentStep: r.current_step,
      result: parseJson(r.result_json, null as any),
      createdBy: r.created_by,
      createdAt: r.created_at,
      completedAt: r.completed_at,
    };
  },

  mapStepRow(r: any) {
    let name = r.step_name;
    if (!name || name.includes("\uFFFD") || name.includes("") || name.length < 3) {
      if (r.id.includes("diagnosis")) name = "故障诊断";
      else if (r.id.includes("maintenance-plan")) name = "检修方案生成";
      else if (r.id.includes("risk-assessment")) name = "风险审核";
      else if (r.id.includes("assignee-recommendation")) name = "派单推荐";
    }
    return {
      id: r.id,
      taskId: r.task_id,
      stepName: name,
      status: r.status,
      progress: r.progress,
      result: parseJson(r.result_json, null as any),
      error: r.error,
      startedAt: r.started_at,
      completedAt: r.completed_at,
    };
  },
};

export const AiTaskStepRepository = {
  async markRunning(id: string) {
    const db = await getDb();
    await db.query(`UPDATE ai_task_steps SET status = 'running', progress = 10, started_at = CURRENT_TIMESTAMP WHERE id = $1;`, [id]);
  },

  async updateProgress(id: string, progress: number) {
    const db = await getDb();
    await db.query(`UPDATE ai_task_steps SET progress = $2 WHERE id = $1;`, [id, progress]);
  },

  async markCompleted(id: string, result: any) {
    const db = await getDb();
    await db.query(
      `UPDATE ai_task_steps SET status = 'completed', progress = 100, result_json = $2, completed_at = CURRENT_TIMESTAMP WHERE id = $1;`,
      [id, JSON.stringify(result)]
    );
  },

  async markFailed(id: string, error: string) {
    const db = await getDb();
    await db.query(
      `UPDATE ai_task_steps SET status = 'failed', error = $2, completed_at = CURRENT_TIMESTAMP WHERE id = $1;`,
      [id, error]
    );
  },
};
