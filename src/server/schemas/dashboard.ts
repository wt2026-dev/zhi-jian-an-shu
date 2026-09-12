// 重构说明：驾驶舱异常下钻接口的输入校验 Schema。
import { z } from "zod";

// GET /api/v1/cockpit/abnormal-equipments?type=health|order|inspection|hazard
export const cockpitAbnormalQuerySchema = z.object({
  type: z.enum(["health", "order", "inspection", "hazard"], {
    message: "type 必填，可选值：health | order | inspection | hazard",
  }),
});
