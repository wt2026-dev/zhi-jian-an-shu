/**
 * 全局鉴权基线测试：/api/* 默认拒绝（401）+ 白名单放行 + 关键接口 RBAC 收口。
 * 背景：此前鉴权依赖各路由逐个挂 requireAuth，存在 15+ 漏挂写接口，
 * 攻击链：GET /auth/users 枚举 → POST /auth/switch-user 签发任意 JWT → GET /download-zip 拖源码。
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../server.ts";

let app: any;
let adminToken = "";
let techToken = "";

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await createApp();
  adminToken = (await request(app).post("/api/v1/auth/login").send({ username: "admin", password: "Admin@2026#Demo" })).body.token;
  techToken = (await request(app).post("/api/v1/auth/login").send({ username: "tech1", password: "Tech1@2026#Work" })).body.token;
  expect(adminToken).toBeTruthy();
  expect(techToken).toBeTruthy();
});

describe("全局鉴权基线：白名单外的接口匿名访问必须 401", () => {
  const anonymousMust401: [string, "get" | "post" | "delete"][] = [
    // 用户与认证（攻击链入口）
    ["get auth/users", "get"],
    ["post switch-user", "post"],
    ["post logout", "post"],
    ["get me", "get"],
    // 源码与审计（攻击链终点）
    ["get download-zip", "get"],
    ["get audit-logs", "get"],
    // 高危作业票与 LOTO
    ["get safety-permits", "get"],
    ["post safety-permits", "post"],
    ["post safety-permits approve", "post"],
    ["post safety-permits close", "post"],
    ["delete safety-permits", "delete"],
    ["get loto-locks", "get"],
    // 其他业务域代表接口
    ["get equipments", "get"],
    ["get work-orders", "get"],
    ["get notifications", "get"],
    ["get knowledge", "get"],
    ["get dispatch/technicians", "get"],
    ["get admin/ai-models", "get"],
    ["get ai/pipeline", "get"],
  ];

  for (const [name, method] of anonymousMust401) {
    it(`匿名 ${method.toUpperCase()} ${name} 应返回 401`, async () => {
      const res = await request(app)[method](pathFor(name));
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("UNAUTHORIZED");
    });
  }
});

function pathFor(name: string): string {
  switch (name) {
    case "get auth/users": return "/api/v1/auth/users";
    case "post switch-user": return "/api/v1/auth/switch-user";
    case "post logout": return "/api/v1/auth/logout";
    case "get me": return "/api/v1/auth/me";
    case "get download-zip": return "/api/download-zip";
    case "get audit-logs": return "/api/v1/audit-logs";
    case "get safety-permits": return "/api/v1/safety-permits";
    case "post safety-permits": return "/api/v1/safety-permits";
    case "post safety-permits approve": return "/api/v1/safety-permits/sp-0001/approve";
    case "post safety-permits close": return "/api/v1/safety-permits/sp-0001/close";
    case "delete safety-permits": return "/api/v1/safety-permits/sp-0001";
    case "get loto-locks": return "/api/v1/loto-locks";
    case "get equipments": return "/api/v1/equipments";
    case "get work-orders": return "/api/v1/work-orders";
    case "get notifications": return "/api/v1/notifications";
    case "get knowledge": return "/api/v1/knowledge-articles";
    case "get dispatch/technicians": return "/api/v1/dispatch/technicians";
    case "get admin/ai-models": return "/api/v1/admin/ai-models";
    case "get ai/pipeline": return "/api/v1/ai/pipeline";
    default: throw new Error("unknown path: " + name);
  }
}

describe("全局鉴权基线：关键接口 RBAC 收口", () => {
  it("switch-user：普通技师（tech1）调用应返回 403，admin 可用", async () => {
    const techRes = await request(app)
      .post("/api/v1/auth/switch-user")
      .set("Authorization", `Bearer ${techToken}`)
      .send({ username: "inspector" });
    expect(techRes.status).toBe(403);
    expect(techRes.body.code).toBe("RBAC_PERMISSION_DENIED");

    const adminRes = await request(app)
      .post("/api/v1/auth/switch-user")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ username: "tech1" });
    expect(adminRes.status).toBe(200);
    expect(adminRes.body).toHaveProperty("token");
  });

  it("switch-user：NODE_ENV=production 时应直接返回 404（接口下线）", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await request(app)
        .post("/api/v1/auth/switch-user")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ username: "tech1" });
      expect(res.status).toBe(404);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it("download-zip 与 audit-logs：技师访问应返回 403，admin 可访问", async () => {
    const zipRes = await request(app).get("/api/download-zip").set("Authorization", `Bearer ${techToken}`);
    expect(zipRes.status).toBe(403);
    const auditRes = await request(app).get("/api/v1/audit-logs").set("Authorization", `Bearer ${techToken}`);
    expect(auditRes.status).toBe(403);

    const zipAdmin = await request(app).get("/api/download-zip").set("Authorization", `Bearer ${adminToken}`);
    expect(zipAdmin.status).toBe(200);
    const auditAdmin = await request(app).get("/api/v1/audit-logs").set("Authorization", `Bearer ${adminToken}`);
    expect(auditAdmin.status).toBe(200);
  });

  it("safety-permits：技师可读列表，但删除应返回 403（仅 admin/manager）", async () => {
    const listRes = await request(app).get("/api/v1/safety-permits").set("Authorization", `Bearer ${techToken}`);
    expect(listRes.status).toBe(200);

    // 删除需用真实存在的票：控制器先做存在性校验（不存在 → 404），再做角色校验
    const listForDel = await request(app).get("/api/v1/safety-permits").set("Authorization", `Bearer ${techToken}`);
    const permitId = listForDel.body?.[0]?.id;
    expect(permitId).toBeTruthy();

    const delRes = await request(app)
      .delete(`/api/v1/safety-permits/${permitId}`)
      .set("Authorization", `Bearer ${techToken}`);
    expect(delRes.status).toBe(403);
    // 控制器级 RBAC（admin/manager 之外拒绝并写 PERMIT_DELETE/BLOCKED 审计）
    expect(delRes.body.code).toBe("RBAC_DELETE_FORBIDDEN");
  });
});

describe("全局鉴权基线：白名单路径匿名可达", () => {
  it("健康探针 /health /ready /api/health 匿名 200", async () => {
    expect((await request(app).get("/health")).status).toBe(200);
    expect((await request(app).get("/ready")).status).toBe(200);
    expect((await request(app).get("/api/health")).status).toBe(200);
  });

  it("OpenAPI 规范 /api-docs.json 匿名 200", async () => {
    const res = await request(app).get("/api-docs.json");
    expect(res.status).toBe(200);
  });

  it("登录接口匿名可用（正确凭据 200 签发 token）", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({ username: "admin", password: "Admin@2026#Demo" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
  });

  it("wx-login 匿名可达（缺 code 返回 400 而非 401）", async () => {
    const res = await request(app).post("/api/v1/auth/wx-login").send({});
    expect(res.status).toBe(400);
  });

  it("微信二维码 /api/v1/wechat/* 匿名可达（缺参数为 400 而非 401）", async () => {
    const res = await request(app).get("/api/v1/wechat/repair-qrcode");
    expect(res.status).not.toBe(401);
  });

  it("微信扫码报修 /api/v1/wx/repairs 匿名可达（空 body 返回 400 校验错误而非 401）", async () => {
    const res = await request(app).post("/api/v1/wx/repairs").send({});
    expect(res.status).toBe(400);
    expect(res.body.code).not.toBe("UNAUTHORIZED");
  });

  it("登录后携带有效 token 可访问业务接口（正向用例）", async () => {
    const res = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("username", "admin");
  });
});
