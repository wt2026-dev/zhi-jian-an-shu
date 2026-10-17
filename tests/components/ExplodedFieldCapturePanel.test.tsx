// @vitest-environment jsdom
/**
 * 零件档案的现场采集入口：测量录入 + 现场照片。
 *
 * 关注点全在"不造假"上：
 *   · 科目与限值只读服务端下发的真实点检标准，没有标准就不给录；
 *   · 合格性是服务端算的，前端只负责把 ok=false 标成超标；
 *   · 照片必须拿到 /uploads/ 的真实落盘地址才关联，外链/伪造地址直接拒；
 *   · 未过 LOTO 时一切录入不可用，并被服务端 403 顶回弹窗。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ExplodedFieldCapturePanel } from '../../src/components/equipment3d/ExplodedFieldCapturePanel';
import { aiApi, fieldOpsApi, ApiError } from '../../src/api';
import type { FieldSessionData } from '../../src/api';

vi.mock('../../src/api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../src/api');
  return {
    ...actual,
    fieldOpsApi: {
      getSession: vi.fn(),
      confirmLoto: vi.fn(),
      recordStep: vi.fn(),
      addMeasurement: vi.fn(),
      addPartPhoto: vi.fn(),
    },
    aiApi: { uploadImage: vi.fn() },
  };
});

const mockedApi = fieldOpsApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const mockedUpload = aiApi.uploadImage as unknown as ReturnType<typeof vi.fn>;

const VIB_ITEM = {
  key: '输入侧高速轴垂直向振动 (RMS)',
  checkPoint: '输入侧高速轴垂直向振动 (RMS)',
  standard: '≤ 4.5 mm/s (齿轮箱报警阈值)',
  method: '振动巡测',
  unit: 'mm/s',
  minLimit: 0,
  maxLimit: 4.5,
};

const ORDER = {
  id: 'wo-20240902-001',
  orderNo: 'WO-20260902-101',
  title: '3# 轧机行星减速箱抢修',
  description: '',
  faultType: '机械振动',
  priority: 'urgent',
  status: 'in_progress',
  statusLabel: '检修中',
  createdAt: null,
  assignee: null,
  completedAt: null,
};

function sessionOf(overrides: Partial<FieldSessionData> = {}): FieldSessionData {
  return {
    deviceId: 'eq-103',
    order: ORDER,
    canOperate: true,
    blockedReason: null,
    lotoItems: [],
    loto: {
      confirmedAt: '2026-10-17T02:10:00.000Z',
      by: { name: '张建国' },
      items: [],
    },
    steps: [],
    progress: { total: 0, done: 0, skipped: 0, issue: 0, remaining: 0, current: null },
    measurements: [],
    partPhotos: [],
    events: [],
    measurementItems: [VIB_ITEM],
    autoCompleted: null,
    version: 3,
    dataNote: '',
    ...overrides,
  } as unknown as FieldSessionData;
}

/** jsdom 没有真的 canvas：这里给出最小的 2d 上下文桩，只够走通压缩分支 */
function stubCanvasPipeline() {
  const ctx = { drawImage: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,QUJD');
  class FakeImage {
    naturalWidth = 120;
    naturalHeight = 80;
    onload: (() => void) | null = null;
    set src(_v: string) {
      setTimeout(() => this.onload?.(), 0);
    }
  }
  vi.stubGlobal('Image', FakeImage as unknown as typeof HTMLImageElement);
  if (!('createObjectURL' in URL)) {
    // jsdom 的 URL 上这两个静态方法可能整个缺失（各版本行为不一），
    // 类型上也就没有可 spyOn 的签名 —— 这里按组件实际用法补一份最小形状。
    const urlBag = URL as unknown as { createObjectURL: () => string; revokeObjectURL: (u: string) => void };
    vi.spyOn(urlBag, 'createObjectURL').mockReturnValue('blob:fake');
    vi.spyOn(urlBag, 'revokeObjectURL').mockReturnValue(undefined);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('现场采集面板（真实标准，不编造区间）', () => {
  it('没选中零件时不摆录入表单', () => {
    render(<ExplodedFieldCapturePanel session={sessionOf()} posNo={null} onSessionChange={vi.fn()} onRequestLoto={vi.fn()} />);
    expect(screen.getByTestId('equipment3d-field-capture-panel').textContent).toContain('请先在 3D 模型或「零件清单」里选中');
    expect(screen.queryByTestId('equipment3d-field-measure-select')).toBeNull();
  });

  it('设备在真实点检系统里没有测点 → 拒绝提供录入，不编造允许区间', () => {
    render(
      <ExplodedFieldCapturePanel session={sessionOf({ measurementItems: [] })} posNo="BOM-07" onSessionChange={vi.fn()} onRequestLoto={vi.fn()} />
    );
    expect(screen.getByTestId('equipment3d-field-measure-no-standard').textContent).toContain('不编造允许区间');
    expect(screen.queryByTestId('equipment3d-field-measure-input')).toBeNull();
  });

  it('选科目 → 显示真实标准与区间；没填值不许提交；提交走服务端并回传会话', async () => {
    const after = sessionOf({
      measurements: [
        { id: 'fm-1', posNo: 'BOM-07', checkPoint: VIB_ITEM.checkPoint, standard: VIB_ITEM.standard, unit: 'mm/s', minLimit: 0, maxLimit: 4.5, value: 3.2, ok: true, by: { name: '张建国' }, at: '2026-10-17T02:30:00.000Z' },
      ],
    });
    mockedApi.addMeasurement.mockResolvedValueOnce(after);
    const onSessionChange = vi.fn();
    render(<ExplodedFieldCapturePanel session={sessionOf()} posNo="BOM-07" partName="高速输入端精密轴承座法兰端盖" onSessionChange={onSessionChange} onRequestLoto={vi.fn()} />);

    expect((screen.getByTestId('equipment3d-field-measure-submit') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('equipment3d-field-measure-select'), { target: { value: VIB_ITEM.key } });
    expect(screen.getByTestId('equipment3d-field-measure-standard').textContent).toContain('≤ 4.5 mm/s');
    expect(screen.getByTestId('equipment3d-field-measure-standard').textContent).toContain('标准区间 0 ~ 4.5 mm/s');
    expect((screen.getByTestId('equipment3d-field-measure-submit') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByTestId('equipment3d-field-measure-input'), { target: { value: '3.2' } });
    expect((screen.getByTestId('equipment3d-field-measure-submit') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('equipment3d-field-measure-submit'));
    await waitFor(() =>
      expect(mockedApi.addMeasurement).toHaveBeenCalledWith('wo-20240902-001', { posNo: 'BOM-07', checkPoint: VIB_ITEM.key, value: 3.2 })
    );
    await waitFor(() => expect(onSessionChange).toHaveBeenCalledWith(after));
  });

  it('服务端判定超标（ok=false）才标红，前端不自己比大小', () => {
    render(
      <ExplodedFieldCapturePanel
        session={sessionOf({
          measurements: [
            { id: 'fm-2', posNo: 'BOM-07', checkPoint: VIB_ITEM.checkPoint, standard: VIB_ITEM.standard, unit: 'mm/s', minLimit: 0, maxLimit: 4.5, value: 7.4, ok: false, by: { name: '张建国' }, at: '2026-10-17T02:31:00.000Z' },
            { id: 'fm-3', posNo: 'BOM-07', checkPoint: '稀油站供油压力与油位', standard: null, unit: null, minLimit: null, maxLimit: null, value: 0.34, ok: null, by: { name: '张建国' }, at: '2026-10-17T02:32:00.000Z' },
          ],
        })}
        posNo="BOM-07"
        onSessionChange={vi.fn()}
        onRequestLoto={vi.fn()}
      />
    );
    expect(screen.getByTestId(`equipment3d-field-measure-row-${VIB_ITEM.checkPoint}`).textContent).toContain('⚠ 超出标准区间');
    expect(screen.getByTestId('equipment3d-field-measure-row-稀油站供油压力与油位').textContent).toContain('无限值仅留痕');
  });

  it('照片必须落进 /uploads/ 才关联零件；外链一律拒绝并且不打后端', async () => {
    stubCanvasPipeline();
    mockedUpload.mockResolvedValueOnce({ url: 'https://cdn.example.com/leak.jpg', filename: 'leak.jpg' });
    const onSessionChange = vi.fn();
    render(<ExplodedFieldCapturePanel session={sessionOf()} posNo="BOM-07" onSessionChange={onSessionChange} onRequestLoto={vi.fn()} />);

    const file = new File(['fake-jpeg'], '现场照片.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByTestId('equipment3d-field-photo-input'), { target: { files: [file] } });
    await waitFor(() => expect(mockedUpload).toHaveBeenCalledTimes(1));
    expect(mockedApi.addPartPhoto).not.toHaveBeenCalled();
    const box = await screen.findByTestId('equipment3d-field-capture-error');
    expect(String(box.textContent)).toContain('/uploads/');
  });

  it('真实上传成功后按位号关联，留痕人/时间由服务端回包提供', async () => {
    stubCanvasPipeline();
    mockedUpload.mockResolvedValueOnce({ url: '/uploads/field-bom07.jpg', filename: 'field-bom07.jpg', size: 20480 });
    const after = sessionOf({
      partPhotos: [{ id: 'fp-1', posNo: 'BOM-07', url: '/uploads/field-bom07.jpg', filename: 'field-bom07.jpg', size: 20480, by: { name: '张建国' }, at: '2026-10-17T02:33:00.000Z' }],
    });
    mockedApi.addPartPhoto.mockResolvedValueOnce(after);
    const onSessionChange = vi.fn();
    const view = render(<ExplodedFieldCapturePanel session={sessionOf()} posNo="BOM-07" onSessionChange={onSessionChange} onRequestLoto={vi.fn()} />);

    const file = new File(['fake-jpeg'], '现场照片.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByTestId('equipment3d-field-photo-input'), { target: { files: [file] } });
    await waitFor(() =>
      expect(mockedApi.addPartPhoto).toHaveBeenCalledWith('wo-20240902-001', {
        posNo: 'BOM-07',
        url: '/uploads/field-bom07.jpg',
        filename: 'field-bom07.jpg',
        size: 20480,
      })
    );
    await waitFor(() => expect(onSessionChange).toHaveBeenCalledWith(after));
    // 宿主把服务端回包重新灌进来以后，照片才出现在该零件档案里（面板不自己拼列表）
    expect(screen.queryByTestId('equipment3d-field-photo-empty')).toBeTruthy();
    view.rerender(
      <ExplodedFieldCapturePanel session={after} posNo="BOM-07" onSessionChange={onSessionChange} onRequestLoto={vi.fn()} />
    );
    expect(screen.getByTestId('equipment3d-field-photo-row-/uploads/field-bom07.jpg')).toBeTruthy();
  });

  it('未过 LOTO：录入全部锁死，点闸门按钮请求安全确认', () => {
    const onRequestLoto = vi.fn();
    render(
      <ExplodedFieldCapturePanel
        session={sessionOf({ loto: null })}
        posNo="BOM-07"
        onSessionChange={vi.fn()}
        onRequestLoto={onRequestLoto}
      />
    );
    expect((screen.getByTestId('equipment3d-field-measure-submit') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('equipment3d-field-photo-pick') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('equipment3d-field-capture-loto'));
    expect(onRequestLoto).toHaveBeenCalledTimes(1);
    expect(mockedApi.addMeasurement).not.toHaveBeenCalled();
  });

  it('服务端 403 兜底：即便前端状态过期，被拦下也会重新打开 LOTO 弹窗', async () => {
    mockedApi.addMeasurement.mockRejectedValueOnce(new ApiError(403, { error: '安全确认未完成', message: '安全确认未完成', code: 'FIELD_LOTO_REQUIRED' }));
    const onRequestLoto = vi.fn();
    render(<ExplodedFieldCapturePanel session={sessionOf()} posNo="BOM-07" onSessionChange={vi.fn()} onRequestLoto={onRequestLoto} />);
    fireEvent.change(screen.getByTestId('equipment3d-field-measure-select'), { target: { value: VIB_ITEM.key } });
    fireEvent.change(screen.getByTestId('equipment3d-field-measure-input'), { target: { value: '3.2' } });
    fireEvent.click(screen.getByTestId('equipment3d-field-measure-submit'));
    await waitFor(() => expect(onRequestLoto).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('equipment3d-field-capture-error').textContent).toContain('安全确认未完成');
  });
});
