// 第三层 · 厂区俯瞰补细节：厂房屋顶悬浮标签（纯加法装饰模块）。
// 只读 FactoryOverview 的公开字段（placed/group），不侵入既有厂区构建逻辑；
// 标签标题 = 真实台账 workshop 名，副标题 = 由名称关键词派生的厂房类型
// （动力站房/仓库/生产车间/办公大楼），与对标视频 0:45/1:15 帧的屋顶标牌对应。
import * as THREE from "three";
import { makeTextSprite } from "./mapGeo";

export interface RoofLabelTarget {
  name: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

/** 由真实车间名派生厂房类型标签（关键词匹配，未命中归为生产车间） */
export function buildingTypeLabel(workshopName: string): string {
  if (/动力|公用|能源|配电|锅炉|水泵|风机/.test(workshopName)) return "动力站房";
  if (/仓库|包装|成品|原料|存储|库房/.test(workshopName)) return "仓库";
  if (/办公|综合|行政|管理/.test(workshopName)) return "办公大楼";
  return "生产车间";
}

export interface RoofLabelHost {
  placed: RoofLabelTarget[];
  group: THREE.Group;
}

/**
 * 给厂区每栋厂房挂屋顶文字精灵。返回清理函数；
 * FactoryOverview 重建（disposeFactory→buildFactory）后需重新调用。
 */
export function attachRoofLabels(factory: RoofLabelHost): () => void {
  const sprites: THREE.Sprite[] = [];
  for (const b of factory.placed) {
    if (!b.name) continue;
    const sprite = makeTextSprite(b.name, buildingTypeLabel(b.name), "#a5f3fc");
    sprite.position.set(b.x, b.h + 3.4, b.z);
    factory.group.add(sprite);
    sprites.push(sprite);
  }
  return () => {
    for (const s of sprites) {
      factory.group.remove(s);
      const mat = s.material as THREE.SpriteMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
    sprites.length = 0;
  };
}
