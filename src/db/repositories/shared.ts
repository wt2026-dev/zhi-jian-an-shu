import { getDb } from "../db.ts";

export function parseJson<T>(val: any, fallback: T): T {
  if (val === null || val === undefined) return fallback;
  if (typeof val === "object") return val as T;
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export class VersionConflictError extends Error {
  code = "VERSION_CONFLICT";
  currentVersion?: number;
  expectedVersion?: number;

  constructor(message = "数据已被其他操作修改，请刷新后重试", currentVersion?: number, expectedVersion?: number) {
    super(message);
    this.name = "VersionConflictError";
    this.currentVersion = currentVersion;
    this.expectedVersion = expectedVersion;
    Object.setPrototypeOf(this, VersionConflictError.prototype);
  }
}

