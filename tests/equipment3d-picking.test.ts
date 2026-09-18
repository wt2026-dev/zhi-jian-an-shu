import { describe, expect, it, vi } from 'vitest';
import { EquipmentScene } from '../src/components/equipment3d/scene';

describe('isolated equipment picking', () => {
  it('excludes hidden devices even when their proxy is nearer the camera', () => {
    const hidden = { userData: { equipmentId: 'eq-101', slotIndex: 0 } };
    const focused = { userData: { equipmentId: 'eq-112', slotIndex: 11 } };
    const scene = Object.create(EquipmentScene.prototype);
    Object.assign(scene, {
      isolationId: 'eq-112',
      picks: [hidden, focused],
      renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } },
      ndc: { set: vi.fn() },
      camera: {},
      raycaster: {
        setFromCamera: vi.fn(),
        intersectObjects: (objects: unknown[]) => objects.map((object) => ({ object })),
      },
    });
    expect(scene.pick(400, 300)).toEqual({ id: 'eq-112', index: 11 });
  });
});
