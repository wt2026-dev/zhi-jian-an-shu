export interface NewPartFormData {
  code: string;
  name: string;
  specification: string;
  category: string;
  unit: string;
  stock: number;
  safe_stock: number;
  price: number;
  location: string;
  compatible_models: string;
}

export const DEFAULT_PART_CATEGORIES = [
  '轴承传动',
  '密封密封件',
  '电气传感器',
  '滤芯过滤',
  '润滑流体',
  '标准紧固件',
] as const;
