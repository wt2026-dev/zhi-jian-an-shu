// 重构说明：多厂区层级路由（Migration 025 配套）。只读查询，无写操作。
// 注意：/geo/summary 必须先于 /:id 注册，避免被参数路由吞掉。
import express from "express";
import { handleListFactories, handleFactoryGeoSummary, handleGetFactoryById } from "../controllers/factoryController.ts";

export function registerFactoryRoutes(app: express.Express) {
  app.get("/api/v1/factories", handleListFactories);
  app.get("/api/v1/factories/geo/summary", handleFactoryGeoSummary);
  app.get("/api/v1/factories/:id", handleGetFactoryById);
}
