// @vitest-environment jsdom
import React, { StrictMode, useState } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { TwinScene3D, type Anchor3D } from '../../src/components/digital-twin/TwinScene3D';

const rendererMocks = vi.hoisted(() => ({
  instances: [] as Array<{ render: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>,
}));

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return {
    ...actual,
    WebGLRenderer: class {
      shadowMap = { enabled: false, type: 0 };
      setSize = vi.fn();
      setPixelRatio = vi.fn();
      dispose = vi.fn();
      render = vi.fn((scene: THREE.Scene, camera: THREE.Camera) => {
        scene.updateMatrixWorld();
        camera.updateMatrixWorld();
      });
      constructor() { rendererMocks.instances.push(this); }
    },
  };
});

const anchors: Anchor3D[] = [{ id: 'eq-1', worldPos: [2, 2, -4], label: '设备1' }];
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

function advanceFrames(count: number) {
  for (let i = 0; i < count; i++) {
    act(() => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(i * 16));
    });
  }
}

function currentScene(): THREE.Scene {
  return rendererMocks.instances[0].render.mock.lastCall![0];
}

beforeEach(() => {
  rendererMocks.instances.length = 0;
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(450);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('数字孪生场景生命周期', () => {
  it('投影驱动父组件重渲染时保留画布、渲染器和镜头', () => {
    const projected = vi.fn();
    function Dashboard() {
      const [screen, setScreen] = useState<unknown[]>([]);
      return <div data-projection-count={screen.length}>
        <TwinScene3D
          anchors={anchors.map((anchor) => ({ ...anchor }))}
          onAnchorProject={(value) => { projected(value); setScreen(value); }}
        />
      </div>;
    }
    const { container } = render(<Dashboard />);
    const canvas = container.querySelector('canvas');
    advanceFrames(1);
    const renderer = rendererMocks.instances[0];
    const camera = renderer.render.mock.lastCall![1] as THREE.Camera;
    advanceFrames(39);
    expect(projected).toHaveBeenCalledTimes(4);
    expect(rendererMocks.instances).toHaveLength(1);
    expect(renderer.dispose).not.toHaveBeenCalled();
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
    expect(container.querySelector('canvas')).toBe(canvas);
    expect(renderer.render.mock.lastCall![1]).toBe(camera);
    expect(frames.size).toBe(1);
  });

  it('锚点增删和坐标更新只更新标记，不重建场景', () => {
    const { rerender } = render(<TwinScene3D anchors={anchors} />);
    advanceFrames(1);
    const scene = currentScene();
    const original = scene.children.find((child) => child.userData.anchorId === 'eq-1') as THREE.Sprite;
    const dispose = vi.spyOn(original.material, 'dispose');
    rerender(<TwinScene3D anchors={[
      { ...anchors[0], worldPos: [5, 3, 2] },
      { id: 'eq-2', worldPos: [0, 1, 0], label: '设备2' },
    ]} />);
    advanceFrames(1);
    expect(currentScene()).toBe(scene);
    expect(original.position.toArray()).toEqual([5, 3, 2]);
    expect(scene.children.filter((child) => child instanceof THREE.Sprite)).toHaveLength(2);
    expect(dispose).not.toHaveBeenCalled();
    rerender(<TwinScene3D anchors={[]} />);
    advanceFrames(1);
    expect(rendererMocks.instances).toHaveLength(1);
    expect(scene.children.filter((child) => child instanceof THREE.Sprite)).toHaveLength(0);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('替换投影回调后使用新回调，省略锚点也不重建场景', () => {
    const oldCallback = vi.fn();
    const newCallback = vi.fn();
    const { rerender } = render(<TwinScene3D anchors={anchors} onAnchorProject={oldCallback} />);
    advanceFrames(10);
    rerender(<TwinScene3D anchors={anchors} onAnchorProject={newCallback} />);
    advanceFrames(10);
    expect(oldCallback).toHaveBeenCalledTimes(1);
    expect(newCallback).toHaveBeenCalledTimes(1);
    rerender(<TwinScene3D />);
    rerender(<TwinScene3D className="updated" />);
    expect(rendererMocks.instances).toHaveLength(1);
  });

  it('StrictMode 重挂载后只有一个画布和动画循环，卸载释放资源', () => {
    const { container, unmount } = render(<StrictMode><TwinScene3D anchors={anchors} /></StrictMode>);
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
    expect(frames.size).toBe(1);
    advanceFrames(1);
    const renderer = rendererMocks.instances[rendererMocks.instances.length - 1];
    const scene = renderer.render.mock.lastCall![0] as THREE.Scene;
    const points = scene.children.find((child) => child instanceof THREE.Points) as THREE.Points;
    const sprite = scene.children.find((child) => child instanceof THREE.Sprite) as THREE.Sprite;
    const geometryDispose = vi.spyOn(points.geometry, 'dispose');
    const materialDispose = vi.spyOn(sprite.material, 'dispose');
    unmount();
    expect(frames.size).toBe(0);
    expect(container.querySelector('canvas')).toBeNull();
    rendererMocks.instances.forEach((instance) => expect(instance.dispose).toHaveBeenCalledTimes(1));
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
  });
});
