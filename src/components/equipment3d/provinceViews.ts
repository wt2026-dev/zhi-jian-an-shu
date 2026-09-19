// 城市 → 所属省轮廓视图映射（轮廓几何来自 mapData/provinceOutlines.ts，自动生成）。
// 取景中心/比例按省形状手工调校：等距投影下保证厂区点位落在轮廓内。
import {
  P440000_FILL,
  P440000_LINE,
  P320000_FILL,
  P320000_LINE,
  P510000_FILL,
  P510000_LINE,
  P420000_FILL,
  P420000_LINE,
} from "./mapData/provinceOutlines";

export type ProvinceCode = "440000" | "320000" | "510000" | "420000";

export const PROVINCE_CODE_BY_CITY: Record<string, ProvinceCode> = {
  广州: "440000",
  南京: "320000",
  成都: "510000",
  武汉: "420000",
};

export interface ProvinceView {
  center: [number, number];
  scale: number;
  fill: [number, number][][];
  line: [number, number][][];
}

export const PROVINCE_VIEW_BY_CODE: Record<ProvinceCode, ProvinceView> = {
  "440000": { center: [113.6, 23.4], scale: 2.4, fill: P440000_FILL, line: P440000_LINE },
  "320000": { center: [119.4, 32.9], scale: 2.6, fill: P320000_FILL, line: P320000_LINE },
  "510000": { center: [102.9, 30.6], scale: 1.15, fill: P510000_FILL, line: P510000_LINE },
  "420000": { center: [112.3, 31.0], scale: 2.4, fill: P420000_FILL, line: P420000_LINE },
};
