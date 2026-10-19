import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { EXPLODED_VIEW_FILES } from '../src/components/equipment3d/explodedViewFiles';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

describe('3D 拆解工作台 · 装饰刻度盘下线与纯净模式', () => {
  const htmlFiles = Object.values(EXPLODED_VIEW_FILES);

  it('1. 10 份 HTML 顶层均声明 setDecorRings，且 decorRingsOn 默认 false', () => {
    expect(htmlFiles).toHaveLength(10);

    for (const file of htmlFiles) {
      const src = read(path.join('public/exploded', file));

      // 声明了 decorRingsOn 变量且默认为 false
      expect(
        src,
        `${file} 必须声明 let decorRingsOn = false;`
      ).toMatch(/let\s+decorRingsOn\s*=\s*false;/);

      // 导出了 window.setDecorRings 函数
      expect(
        src,
        `${file} 必须暴露 window.setDecorRings`
      ).toMatch(/window\.setDecorRings\s*=\s*setDecorRings/);
    }
  });

  it('2. motor14 / cooling_pump 中 mainRadii 与 PolarGridHelper 仅在 buildDecorRings / withDial 分支出现', () => {
    const dialFiles = ['motor14_exploded.html', 'cooling_pump_exploded_v3.html'];

    for (const file of dialFiles) {
      const src = read(path.join('public/exploded', file));

      // mainRadii 存在但仅在 withDial 条件分支内声明/使用
      expect(src, `${file} 中应存在 mainRadii`).toContain('mainRadii');
      const mainRadiiMatches = src.match(/const mainRadii\s*=/g) || [];
      expect(mainRadiiMatches.length, `${file} 中 mainRadii 声明次数应为 1`).toBe(1);

      // 校验 mainRadii 处于 if (withDial) 块内
      const withDialIdx = src.indexOf('if (withDial)');
      const mainRadiiIdx = src.indexOf('const mainRadii');
      expect(withDialIdx, `${file} 必须存在 if (withDial)`).toBeGreaterThan(-1);
      expect(mainRadiiIdx, `${file} mainRadii 必须在 if (withDial) 之后`).toBeGreaterThan(withDialIdx);

      // PolarGridHelper 存在但仅在 buildDecorRings 函数内创建
      expect(src, `${file} 中应存在 PolarGridHelper`).toContain('PolarGridHelper');
      const polarMatches = src.match(/new THREE\.PolarGridHelper/g) || [];
      expect(polarMatches.length, `${file} 中 PolarGridHelper 实例化次数应为 1`).toBe(1);

      const buildDecorRingsIdx = src.indexOf('function buildDecorRings()');
      const polarGridIdx = src.indexOf('new THREE.PolarGridHelper');
      expect(buildDecorRingsIdx, `${file} 必须存在 function buildDecorRings()`).toBeGreaterThan(-1);
      expect(polarGridIdx, `${file} PolarGridHelper 必须在 buildDecorRings 内创建`).toBeGreaterThan(buildDecorRingsIdx);
    }
  });

  it('3. EquipmentScene.tsx 渲染 data-testid="equipment3d-layer-decor-rings-toggle" 与 "equipment3d-decor-rings-toggle"', () => {
    const src = read('src/components/equipment3d/EquipmentScene.tsx');

    // 视图设置图层控制内的「装饰刻度盘」开关
    expect(
      src,
      'EquipmentScene 视图设置图层面板应有 equipment3d-layer-decor-rings-toggle'
    ).toContain('equipment3d-layer-decor-rings-toggle');

    // 右侧折叠面板内的「装饰刻度盘」开关
    expect(
      src,
      'EquipmentScene 右侧抽屉面板应有 equipment3d-decor-rings-toggle'
    ).toContain('equipment3d-decor-rings-toggle');

    // 纯净模式退出的悬浮胶囊
    expect(
      src,
      'EquipmentScene 应挂载 CleanModePill 逃生口组件'
    ).toContain('<CleanModePill');
  });

  it('4. ExplodedViewStage.tsx 渲染 data-testid="equipment3d-exploded-clean-toggle"，且 body.host-clean-mode 样式包含 #right-sidebar 的 opacity:0', () => {
    const src = read('src/components/equipment3d/ExplodedViewStage.tsx');

    // 工具栏中进入纯净模式的按钮
    expect(
      src,
      'ExplodedViewStage 顶部工具栏应有 equipment3d-exploded-clean-toggle'
    ).toContain('data-testid="equipment3d-exploded-clean-toggle"');

    // 样式注入中包含 body.host-clean-mode 与 #right-sidebar 规则
    expect(
      src,
      'ExplodedViewStage 必须注入 body.host-clean-mode 规则'
    ).toContain('body.host-clean-mode');

    expect(
      src,
      'body.host-clean-mode 规则中必须选择 #right-sidebar'
    ).toContain('body.host-clean-mode #right-sidebar');

    // 包含 opacity: 0 样式规约
    const cleanModeStyleSlice = src.slice(
      src.indexOf('body.host-clean-mode #right-sidebar'),
      src.indexOf('/* 强制所有 BOM 滚动容器')
    );
    expect(
      cleanModeStyleSlice,
      'body.host-clean-mode 样式应使用 opacity: 0 而非 display: none'
    ).toContain('opacity: 0');
    expect(
      cleanModeStyleSlice,
      'body.host-clean-mode 样式应使用 pointer-events: none 避免阻挡鼠标'
    ).toContain('pointer-events: none');

    // 校验 showDecorRings 与 setDecorRings 通信
    expect(
      src,
      'ExplodedViewStage 必须调用 iframe 的 window.setDecorRings'
    ).toContain("win['setDecorRings']");
    expect(src).toContain('showDecorRings');
  });
});
