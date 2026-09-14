import { getDb } from "../db.ts";
import { parseJson, VersionConflictError } from "./shared.ts";

export const SafetyPermitRepository = {
  async getAll(filters?: { riskLevel?: string; status?: string; workshop?: string; search?: string }) {
    const db = await getDb();
    let sql = `SELECT * FROM safety_permits WHERE 1=1`;
    const params: any[] = [];

    if (filters?.riskLevel && filters.riskLevel !== "all") {
      params.push(filters.riskLevel);
      sql += ` AND risk_level = $${params.length}`;
    }
    if (filters?.status && filters.status !== "all") {
      params.push(filters.status);
      sql += ` AND status = $${params.length}`;
    }
    if (filters?.workshop && filters.workshop !== "all") {
      params.push(filters.workshop);
      sql += ` AND workshop = $${params.length}`;
    }
    if (filters?.search) {
      params.push(`%${filters.search}%`);
      sql += ` AND (title ILIKE $${params.length} OR permit_no ILIKE $${params.length} OR equipment_name ILIKE $${params.length} OR applicant ILIKE $${params.length})`;
    }

    sql += ` ORDER BY created_at DESC, id DESC;`;
    const { rows } = await db.query(sql, params);
    return rows.map(mapSafetyPermitRow);
  },

  async getById(id: string) {
    const db = await getDb();
    const { rows } = await db.query(`SELECT * FROM safety_permits WHERE id = $1 LIMIT 1;`, [id]);
    if (!rows[0]) return null;
    return mapSafetyPermitRow(rows[0]);
  },

  async create(permit: any) {
    const db = await getDb();
    await db.query(
      `INSERT INTO safety_permits (id, permit_no, permit_type, risk_level, title, equipment_id, equipment_name, workshop, location, applicant, applicant_dept, applied_at, valid_until, status, precautions, loto_number, hazards, safety_checklist, gas_test_results, guardian_approval, supervisor_approval, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22);`,
      [
        permit.id,
        permit.permitNo,
        permit.permitType,
        permit.riskLevel,
        permit.title,
        permit.equipmentId || null,
        permit.equipmentName || null,
        permit.workshop || null,
        permit.location || null,
        permit.applicant,
        permit.applicantDept || null,
        permit.appliedAt,
        permit.validUntil,
        permit.status,
        JSON.stringify(permit.precautions || []),
        permit.lotoNumber || null,
        JSON.stringify(permit.hazards || []),
        JSON.stringify(permit.safetyChecklist || []),
        permit.gasTestResults ? JSON.stringify(permit.gasTestResults) : null,
        permit.guardianApproval ? JSON.stringify(permit.guardianApproval) : null,
        permit.supervisorApproval ? JSON.stringify(permit.supervisorApproval) : null,
        permit.version || 1,
      ]
    );
    return this.getById(permit.id);
  },

  async update(id: string, updates: Partial<any>, expectedVersion?: number) {
    const current = await this.getById(id);
    if (!current) return null;

    const targetVersion = expectedVersion !== undefined ? expectedVersion : updates.version;

    if (targetVersion !== undefined && current.version !== targetVersion) {
      throw new VersionConflictError("安全作业票已被其他操作修改，请刷新后重试", current.version, targetVersion);
    }

    const merged = { ...current, ...updates };
    const nextVersion = (current.version || 1) + 1;

    const db = await getDb();
    if (targetVersion !== undefined) {
      const { rowCount } = await db.query(
        `UPDATE safety_permits SET
           title = $1,
           risk_level = $2,
           status = $3,
           precautions = $4,
           loto_number = $5,
           hazards = $6,
           safety_checklist = $7,
           gas_test_results = $8,
           guardian_approval = $9,
           supervisor_approval = $10,
           closed_at = $11,
           closed_by = $12,
           close_remark = $13,
           version = $14,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $15 AND version = $16;`,
        [
          merged.title,
          merged.riskLevel,
          merged.status,
          JSON.stringify(merged.precautions || []),
          merged.lotoNumber || null,
          JSON.stringify(merged.hazards || []),
          JSON.stringify(merged.safetyChecklist || []),
          merged.gasTestResults ? JSON.stringify(merged.gasTestResults) : null,
          merged.guardianApproval ? JSON.stringify(merged.guardianApproval) : null,
          merged.supervisorApproval ? JSON.stringify(merged.supervisorApproval) : null,
          merged.closedAt || null,
          merged.closedBy || null,
          merged.closeRemark || null,
          nextVersion,
          id,
          targetVersion,
        ]
      );
      if (rowCount === 0) {
        const fresh = await this.getById(id);
        throw new VersionConflictError("安全作业票已被其他操作修改，请刷新后重试", fresh?.version, targetVersion);
      }
    } else {
      await db.query(
        `UPDATE safety_permits SET
           title = $1,
           risk_level = $2,
           status = $3,
           precautions = $4,
           loto_number = $5,
           hazards = $6,
           safety_checklist = $7,
           gas_test_results = $8,
           guardian_approval = $9,
           supervisor_approval = $10,
           closed_at = $11,
           closed_by = $12,
           close_remark = $13,
           version = $14,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $15;`,
        [
          merged.title,
          merged.riskLevel,
          merged.status,
          JSON.stringify(merged.precautions || []),
          merged.lotoNumber || null,
          JSON.stringify(merged.hazards || []),
          JSON.stringify(merged.safetyChecklist || []),
          merged.gasTestResults ? JSON.stringify(merged.gasTestResults) : null,
          merged.guardianApproval ? JSON.stringify(merged.guardianApproval) : null,
          merged.supervisorApproval ? JSON.stringify(merged.supervisorApproval) : null,
          merged.closedAt || null,
          merged.closedBy || null,
          merged.closeRemark || null,
          nextVersion,
          id,
        ]
      );
    }
    return this.getById(id);
  },

  async delete(id: string) {
    const db = await getDb();
    const { rowCount } = await db.query(`DELETE FROM safety_permits WHERE id = $1;`, [id]);
    return rowCount > 0;
  },
};

function mapSafetyPermitRow(r: any) {
  return {
    id: r.id,
    permitNo: r.permit_no,
    permitType: r.permit_type,
    riskLevel: r.risk_level,
    title: r.title,
    equipmentId: r.equipment_id,
    equipmentName: r.equipment_name,
    workshop: r.workshop,
    location: r.location,
    applicant: r.applicant,
    applicantDept: r.applicant_dept,
    appliedAt: r.applied_at,
    validUntil: r.valid_until,
    status: r.status,
    precautions: parseJson(r.precautions, []),
    lotoNumber: r.loto_number,
    hazards: parseJson(r.hazards, []),
    safetyChecklist: parseJson(r.safety_checklist, []),
    gasTestResults: parseJson(r.gas_test_results, null),
    guardianApproval: parseJson(r.guardian_approval, null),
    supervisorApproval: parseJson(r.supervisor_approval, null) || parseJson(r.supervisorapproval, null) || parseJson(r.supervisorApproval, null),
    closedAt: r.closed_at,
    closedBy: r.closed_by,
    closeRemark: r.close_remark,
    version: r.version,
  };
}
