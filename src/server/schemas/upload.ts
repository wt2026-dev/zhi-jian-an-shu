// 重构说明：本模块自 server.ts 拆出，仅承载 Zod 输入校验 Schema，逻辑保持原样。
import { z } from "zod";

export const videoUploadSchema = z.object({
  videoBase64: z.string().min(10, { message: "视频 Base64 数据不能为空" }),
  filename: z.string().optional(),
});

export const imageUploadSchema = z.object({
  imageBase64: z.string().min(1, { message: "缺少图片文件数据 (imageBase64)" }),
  filename: z.string().optional(),
  capturedAt: z.string().optional(), // 现场拍摄时间戳 (ISO 8601 或毫秒)
  captureDevice: z.string().optional(), // 现场防爆采集终端/手机型号
  location: z.string().optional(), // 经纬度或工位坐标
});
