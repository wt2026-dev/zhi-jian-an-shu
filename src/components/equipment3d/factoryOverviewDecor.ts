// 第三层 · 厂区俯瞰补细节：厂房屋顶悬浮标签（纯加法装饰模块）。
// 只读 FactoryOverview 的公开字段（placed/group），不侵入既有厂区构建逻辑；
// 标签标题 = 真实台账 workshop 名，副标题 = 该栋厂房的**外观类型**（直接取
// 厂区已解析出的 role，不再另写一套关键词判断，避免出现第二套口径），
// 与对标视频 0:45/1:15 帧的屋顶标牌对应。
import * as THREE from "three";
import { makeTextSprite } from "./mapGeo";
import { roleLabel, roleOfWorkshop, type BuildingType, type FactoryRole } from "./factoryBuildingTypes";
import { roofRise } from "./factoryBuildingDetails";

export interface RoofLabelTarget {
  name: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** 厂区已解析的外观类型；缺省时退回按车间名判定（合成测试数据用） */
  type?: BuildingType;
}

export interface RoofLabelHost {
  placed: RoofLabelTarget[];
  group: THREE.Group;
}

/** 副标题口径唯一来源：有已解析的 role 用它，没有才按车间名现判。 */
export function buildingTypeLabel(b: Pick<RoofLabelTarget, "name" | "type">): string {
  const role: FactoryRole = b.type?.role ?? roleOfWorkshop(b.name);
  return roleLabel(role);
}

/** 标牌锚点：坡/锯齿/四坡顶会把剪影抬高，标签要跟到屋脊之上，否则埋进屋顶。 */
function labelHeight(b: RoofLabelTarget): number {
  if (!b.type) return b.h + 3.4;
  const rise = roofRise(b.type, { w: b.w, h: b.h, d: b.d, facingSign: 1 });
  return b.h + rise + 3.4;
}

/**
 * 给厂区每栋厂房挂屋顶文字精灵。返回清理函数；
 * FactoryOverview 重建（disposeFactory→buildFactory）后需重新调用。
 */
export function attachRoofLabels(factory: RoofLabelHost): () => void {
  const sprites: THREE.Sprite[] = [];
  for (const b of factory.placed) {
    if (!b.name) continue;
    const sprite = makeTextSprite(b.name, buildingTypeLabel(b), "#a5f3fc");
    sprite.position.set(b.x, labelHeight(b), b.z);
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
