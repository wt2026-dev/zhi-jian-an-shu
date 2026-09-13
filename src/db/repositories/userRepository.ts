import { getDb } from "../db.ts";
import { parseJson } from "./shared.ts";

export const UserRepository = {
  async getAllUsers() {
    const db = await getDb();
    const { rows } = await db.query(`SELECT * FROM users ORDER BY id ASC;`);
    return rows.map((r: any) => ({
      id: r.id,
      username: r.username,
      password: r.password,
      name: r.name,
      role: r.role,
      roleTitle: r.role_title,
      department: r.department,
      phone: r.phone,
      email: r.email,
      permissions: parseJson(r.permissions, []),
      certifications: parseJson(r.certifications, []),
      avatar: r.avatar || "",
      wxOpenId: r.wx_open_id || "",
      status: r.status || "active",
    }));
  },

  async getUserById(id: string) {
    const db = await getDb();
    const { rows } = await db.query(`SELECT * FROM users WHERE id = $1 LIMIT 1;`, [id]);
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      username: r.username,
      password: r.password,
      name: r.name,
      role: r.role,
      roleTitle: r.role_title,
      department: r.department,
      phone: r.phone,
      email: r.email,
      permissions: parseJson(r.permissions, []),
      certifications: parseJson(r.certifications, []),
      avatar: r.avatar || "",
      wxOpenId: r.wx_open_id || "",
      status: r.status || "active",
    };
  },

  async getUserByUsername(username: string) {
    const db = await getDb();
    const { rows } = await db.query(`SELECT * FROM users WHERE username = $1 LIMIT 1;`, [username]);
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      username: r.username,
      password: r.password,
      name: r.name,
      role: r.role,
      roleTitle: r.role_title,
      department: r.department,
      phone: r.phone,
      email: r.email,
      permissions: parseJson(r.permissions, []),
      certifications: parseJson(r.certifications, []),
      avatar: r.avatar || "",
      wxOpenId: r.wx_open_id || "",
      status: r.status || "active",
    };
  },

  async create(user: {
    id?: string;
    username: string;
    password: string;
    name: string;
    role: string;
    roleTitle?: string;
    department?: string;
    phone?: string;
    email?: string;
    permissions?: string[];
  }) {
    const db = await getDb();
    const id = user.id || `u-${Date.now()}`;
    await db.query(
      `INSERT INTO users (id, username, password, name, role, role_title, department, phone, email, permissions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO NOTHING;`,
      [
        id,
        user.username,
        user.password,
        user.name,
        user.role,
        user.roleTitle || user.role,
        user.department || "未指定",
        user.phone || null,
        user.email || null,
        JSON.stringify(user.permissions || []),
      ]
    );
    const { rows } = await db.query(`SELECT * FROM users WHERE id = $1 LIMIT 1;`, [id]);
    const r = rows[0];
    return r
      ? {
          id: r.id,
          username: r.username,
          name: r.name,
          role: r.role,
          roleTitle: r.role_title,
          department: r.department,
          phone: r.phone,
          email: r.email,
          permissions: parseJson(r.permissions, []),
          status: r.status || "active",
        }
      : null;
  },

  async updateStatus(id: string, status: string) {
    const db = await getDb();
    await db.query(`UPDATE users SET status = $1 WHERE id = $2;`, [status, id]);
    return this.getUserById(id);
  },
};
