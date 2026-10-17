import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getById: vi.fn(), getAll: vi.fn(), getHistoryInWindow: vi.fn(),
  getDb: vi.fn(), query: vi.fn(),
}));
vi.mock('../src/db/db.ts', () => ({ getDb: mocks.getDb }));
vi.mock('../src/db/repositories/index.ts', () => ({
  EquipmentRepository: { getById: mocks.getById, getAll: mocks.getAll },
  TelemetryRepository: { getHistoryInWindow: mocks.getHistoryInWindow },
}));
vi.mock('../src/server/services/auditService.ts', () => ({ addAuditLog: vi.fn(), pushNotification: vi.fn() }));
vi.mock('../src/server/services/dispatchService.ts', () => ({ computeEquipmentCoords: vi.fn() }));
vi.mock('../src/db/repositories/dispatchRepository.ts', () => ({ DispatchRepository: {} }));

import { handleGetEquipmentTelemetryHistory } from '../src/server/controllers/equipmentController.ts';
import { TelemetryRepository } from '../src/db/repositories/telemetryRepository.ts';

const equipment = { id: 'eq-exact', code: 'EQ-9', name: 'Persisted device', status: 'running', healthScore: 83 };
const metadata = { equipmentId: equipment.id, equipmentCode: equipment.code, equipmentName: equipment.name, status: equipment.status, healthScore: equipment.healthScore };
async function call(hours?: unknown, id = equipment.id, omitQuery = false) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  await handleGetEquipmentTelemetryHistory({ params: { id }, ...(omitQuery ? {} : { query: { hours } }) }, res);
  return res;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getById.mockResolvedValue(equipment);
  mocks.getHistoryInWindow.mockResolvedValue([]);
  mocks.getDb.mockResolvedValue({ query: mocks.query });
  mocks.query.mockResolvedValue({ rows: [] });
});

describe('equipment telemetry history controller (repositories mocked, no database)', () => {
  it('returns only exact persisted points and preserves response metadata', async () => {
    const points = [{ timestamp: '12:37', fullTime: '2026-09-17T12:37:00Z', temperature: 0, vibration: null, current: 12.3 }];
    mocks.getHistoryInWindow.mockResolvedValue(points);
    const res = await call('48');
    expect(mocks.getById).toHaveBeenCalledExactlyOnceWith('eq-exact');
    expect(mocks.getAll).not.toHaveBeenCalled();
    expect(mocks.getHistoryInWindow).toHaveBeenCalledExactlyOnceWith('eq-exact', 48);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledExactlyOnceWith({ ...metadata, points });
    expect(res.json.mock.calls[0][0].points).toBe(points);
  });

  it('returns points [] without generating samples when persisted history is empty', async () => {
    const res = await call();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledExactlyOnceWith({ ...metadata, points: [] });
  });

  it('returns 404 for an unknown ID without reading another device', async () => {
    mocks.getById.mockResolvedValue(null);
    const res = await call('48', 'unknown');
    expect(mocks.getById).toHaveBeenCalledExactlyOnceWith('unknown');
    expect(mocks.getAll).not.toHaveBeenCalled();
    expect(mocks.getHistoryInWindow).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledExactlyOnceWith(404);
    expect(res.json).toHaveBeenCalledExactlyOnceWith({ error: '设备未找到' });
  });

  it.each(['equipment', 'telemetry'])('returns 500 on %s repository failure, never successful fabricated history', async (source) => {
    (source === 'equipment' ? mocks.getById : mocks.getHistoryInWindow).mockRejectedValue(new Error('read failed'));
    const res = await call();
    expect(res.status).toHaveBeenCalledExactlyOnceWith(500);
    expect(res.json).toHaveBeenCalledExactlyOnceWith({ error: '获取设备遥测历史失败: read failed' });
    expect(mocks.getAll).not.toHaveBeenCalled();
    if (source === 'equipment') expect(mocks.getHistoryInWindow).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, 24], ['invalid', 24], ['Infinity', 24], ['NaN', 24],
    ['48', 48], ['48.9', 48], ['72', 72], ['100', 72], ['0', 1],
    ['-10', 1], ['0.5', 1], ['', 1], [null, 1], [['24', '48'], 24],
  ])('preserves hours coercion/clamp for %j -> %i', async (input, expected) => {
    await call(input);
    expect(mocks.getHistoryInWindow).toHaveBeenCalledExactlyOnceWith(equipment.id, expected);
  });

  it('defaults to 24 hours when query is absent', async () => {
    await call(undefined, equipment.id, true);
    expect(mocks.getHistoryInWindow).toHaveBeenCalledExactlyOnceWith(equipment.id, 24);
  });
});

describe('telemetry repository time-window read (database adapter mocked)', () => {
  it('uses a parameterized actual 48h window, excludes future samples and returns ascending records without LIMIT', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      recorded_at: `sample-${i}`, recorded_at_dt: `2026-09-17T12:${String(i).padStart(2, '0')}:00Z`,
      temperature: '0', vibration: '1.25', current: '12.30', voltage: null,
      pressure: null, load_rate: '42.5', rpm: null,
    }));
    mocks.query.mockResolvedValue({ rows });
    const points = await TelemetryRepository.getHistoryInWindow('eq-exact', 48);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(params).toEqual(['eq-exact', 48]);
    expect(sql).toContain('equipment_id = $1');
    expect(sql).toContain("recorded_at_dt >= CURRENT_TIMESTAMP - ($2::double precision * INTERVAL '1 hour')");
    expect(sql).toContain('recorded_at_dt <= CURRENT_TIMESTAMP');
    expect(sql).toContain('ORDER BY recorded_at_dt ASC');
    expect(sql).not.toMatch(/LIMIT/i);
    expect(points).toHaveLength(60);
    expect(points[0]).toEqual({ timestamp: 'sample-0', fullTime: rows[0].recorded_at_dt, temperature: 0, vibration: 1.25, current: 12.3, voltage: null, pressure: null, loadRate: 42.5, rpm: null });
    expect(points[59].timestamp).toBe('sample-59');
  });

  it('returns [] for no matching records', async () => {
    expect(await TelemetryRepository.getHistoryInWindow('eq-exact', 48)).toEqual([]);
  });

  it('propagates database errors instead of manufacturing history', async () => {
    mocks.query.mockRejectedValue(new Error('query failed'));
    await expect(TelemetryRepository.getHistoryInWindow('eq-exact', 48)).rejects.toThrow('query failed');
  });

  it('leaves shared getHistory callers on their original last-N-records semantics', async () => {
    await TelemetryRepository.getHistory('eq-exact', 72);
    expect(mocks.query).toHaveBeenCalledExactlyOnceWith(
      'SELECT * FROM equipment_telemetry WHERE equipment_id = $1 ORDER BY recorded_at_dt DESC LIMIT $2;',
      ['eq-exact', 72],
    );
  });
});
