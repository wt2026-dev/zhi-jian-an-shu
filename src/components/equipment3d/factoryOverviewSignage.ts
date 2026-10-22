/**
 * 厂区总览 —— 分区产值标牌域（自 FactoryOverview 类机械切出，纯移动不改行为）。
 *
 * 内聚在此：分区产值标牌的构建（buildZoneSignage：canvas 绘制 + Sprite + 引线）、
 * 标牌绘制（paintZoneSign：产值 / 设备 / 异常 / 故障率 / 良品率 + 排名角标）、
 * 排名或指标变化时的批量重绘（repaintZoneSigns）。
 *
 * 类方法 → 自由函数：原 this 依赖（分区清单 / 分区视图 / 精灵回收表 / 引线表 /
 * 纹理回收表 / 排名口径）收拢为 ZoneSignageCtx，由宿主在调用点组装。
 */
import * as THREE from 'three';
import { RANK_LABEL, ZONE_SIGN_ANCHORS, type FactoryRankMetric, type FactoryZoneView, type ResolvedZone } from './factoryOverviewTypes';

export interface ZoneSignageCtx {
  group: THREE.Group;
  zonesResolved: ResolvedZone[];
  /** 分区视图（排名与指标读取口，宿主 refreshZoneViews 产出） */
  zoneViews: FactoryZoneView[];
  zoneSignSprites: THREE.Sprite[];
  zoneLeaders: THREE.Line[];
  ownedTextures: THREE.Texture[];
  rankMetric: FactoryRankMetric;
}

/** 绘制分区产值标牌（产值 / 设备 / 异常 / 故障率 / 良品率 + 排名角标）。 */
function paintZoneSign(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  zone: ResolvedZone,
  rank: number,
  zoneViews: ZoneSignageCtx['zoneViews'],
  rankMetric: FactoryRankMetric
): void {
  const view = zoneViews.find((v) => v.id === zone.id);
  const colorHex = zone.hex;

  ctx.clearRect(0, 0, W, H);
  // 面板
  ctx.fillStyle = 'rgba(6, 20, 36, 0.9)';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = colorHex;
  ctx.lineWidth = 5;
  ctx.shadowColor = colorHex;
  ctx.shadowBlur = 18;
  ctx.strokeRect(4, 4, W - 8, H - 8);
  ctx.shadowBlur = 0;

  // 左侧分区色条
  ctx.fillStyle = colorHex;
  ctx.fillRect(4, 4, 10, H - 8);

  ctx.textBaseline = 'middle';

  // —— 行 1：分区名 + 排名角标 ——
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e6f6ff';
  ctx.font = '700 54px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.fillText(zone.name, 36, 58);

  if (rank > 0) {
    const label = `#${rank}`;
    ctx.font = '700 38px monospace';
    const tw = ctx.measureText(label).width;
    const bw = tw + 26;
    const bx = W - 26 - bw;
    ctx.fillStyle = rank === 1 ? 'rgba(16,185,129,0.24)' : 'rgba(34,211,238,0.16)';
    ctx.fillRect(bx, 26, bw, 58);
    ctx.strokeStyle = rank === 1 ? '#10b981' : colorHex;
    ctx.lineWidth = 3;
    ctx.strokeRect(bx, 26, bw, 58);
    ctx.fillStyle = rank === 1 ? '#6ee7b7' : '#a5f3fc';
    ctx.fillText(label, bx + 13, 56);
  }

  // 分隔线
  ctx.fillStyle = 'rgba(34,211,238,0.35)';
  ctx.fillRect(36, 94, W - 72, 2);

  // —— 行 2：工业产值 ——
  ctx.textAlign = 'left';
  ctx.font = '500 24px "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(view?.estimated ? '工业产值(估算)' : '工业产值', 36, 128);

  ctx.textAlign = 'right';
  // 未接入就写未接入：这里原来兜底了一个按名次编的产值数字
  if (view && view.outputValue != null) {
    ctx.fillStyle = '#34d399';
    ctx.font = '700 46px "Microsoft YaHei", monospace';
    ctx.fillText(`${Math.round(view.outputValue).toLocaleString('zh-CN')} 万元`, W - 36, 130);
  } else {
    ctx.fillStyle = '#64748b';
    ctx.font = '500 30px "Microsoft YaHei", sans-serif';
    ctx.fillText('未接入', W - 36, 130);
  }

  // —— 行 3：设备 / 异常 / 故障率 ——
  ctx.textAlign = 'left';
  ctx.font = '500 23px "Microsoft YaHei", monospace';
  ctx.fillStyle = '#38bdf8';
  ctx.fillText(`设备 ${view ? view.deviceCount : '—'} 台`, 36, 178);

  ctx.fillStyle = view && view.abnormalCount && view.abnormalCount > 0 ? '#f87171' : '#94a3b8';
  ctx.fillText(`异常 ${view ? view.abnormalCount : '—'} 台`, 232, 178);

  const frVal = view && view.failureRate != null ? view.failureRate : 0;
  ctx.fillStyle = frVal > 0 ? '#fbbf24' : '#94a3b8';
  ctx.fillText(`故障率 ${frVal.toFixed(1)}%`, 438, 178);

  // —— 行 4：良品率 + 排名口径 ——
  // 同样去掉兜底：原来无良率数据时会算一个 99.2 − 故障率×0.4 的假数
  ctx.textAlign = 'left';
  if (view && view.yieldRate != null) {
    ctx.fillStyle = '#34d399';
    ctx.fillText(
      `良品率 ${view.yieldRate.toFixed(1)}%${view.estimated ? '(估算)' : ''}`,
      36,
      228
    );
  } else {
    ctx.fillStyle = '#64748b';
    ctx.fillText('良品率 未接入', 36, 228);
  }

  ctx.textAlign = 'right';
  ctx.font = '400 19px "Microsoft YaHei", sans-serif';
  ctx.fillStyle = 'rgba(148,163,184,0.85)';
  ctx.fillText(`排名口径 · ${RANK_LABEL[rankMetric]}`, W - 36, 228);
}

/** 分区产值标牌：canvas 绘制 + Sprite 挂载 + 引线。 */
export function buildZoneSignage(ctx: ZoneSignageCtx): void {
  const { group, zonesResolved, zoneViews, zoneSignSprites, zoneLeaders, ownedTextures, rankMetric } = ctx;
  if (typeof document === 'undefined') return;
  for (const zone of zonesResolved) {
    const zoneIndex = zonesResolved.indexOf(zone);
    const anchor = ZONE_SIGN_ANCHORS[zoneIndex % ZONE_SIGN_ANCHORS.length];
    const topY = Math.max(
      zone.buildings.length ? Math.max(...zone.buildings.map((b) => b.h)) : 12,
      12
    );
    const cx = (zone.minX + zone.maxX) / 2;
    const cz = (zone.minZ + zone.maxZ) / 2;
    const w = zone.maxX - zone.minX;
    const d = zone.maxZ - zone.minZ;
    // 锚点离开地块中心：横向到边角、纵向分带，三块牌子互成三角
    const ax = cx + anchor.fx * (w / 2);
    const az = cz + anchor.fz * (d / 2);
    const signY = topY + anchor.band;

    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 280;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) continue;
    // ⚠️ 名次必须从已结算的 zoneViews 取（构造函数里 refreshZoneViews 先于本方法）
    const rank = zoneViews.find((v) => v.id === zone.id)?.rank ?? 0;
    paintZoneSign(ctx2d, canvas.width, canvas.height, zone, rank, zoneViews, rankMetric);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    ownedTextures.push(tex);

    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0.94,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        // ⚠️ three r186 起 sizeAttenuation 语义被"扶正"了（见 sprite.glsl.js 的 #ifndef）：
        //    true（默认）→ 贴牌按**世界尺寸**渲染，远景下缩成亚像素，等于看不见；
        //    false       → 才按 scale *= -mvPosition.z 做透视补偿 → 恒定屏幕尺寸。
        // 厂区标牌要的是"远看也读得清"，所以必须显式关掉。
        sizeAttenuation: false,
      })
    );
    // Sprite scale ≈ 视口高度的比例（sizeAttenuation:false 下由透视补偿保证恒定）
    sp.scale.set(0.21, 0.21 * (280 / 720), 1);
    sp.position.set(ax, signY, az);
    sp.renderOrder = 32;
    sp.userData = { kind: 'zoneSign', zoneId: zone.id, canvas, ctx: ctx2d, tex };
    group.add(sp);
    zoneSignSprites.push(sp);

    // 引线：标牌锚点 → 分区地块中心（读感更像参考图里的"锚点 + 信息牌"）
    const leader = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(ax, signY - 5, az),
        new THREE.Vector3(cx, 0.3, cz),
      ]),
      new THREE.LineBasicMaterial({ color: zone.color, transparent: true, opacity: 0.35 })
    );
    group.add(leader);
    zoneLeaders.push(leader);
  }
}

/** 重绘所有分区标牌（排名 / 指标变化时调用）。 */
export function repaintZoneSigns(ctx: ZoneSignageCtx): void {
  const { zoneSignSprites, zonesResolved, zoneViews, rankMetric } = ctx;
  for (const sp of zoneSignSprites) {
    const ud = sp.userData as {
      zoneId: string;
      canvas: HTMLCanvasElement;
      ctx: CanvasRenderingContext2D;
      tex: THREE.CanvasTexture;
    };
    const zone = zonesResolved.find((z) => z.id === ud.zoneId);
    if (!zone) continue;
    const rank = zoneViews.find((v) => v.id === zone.id)?.rank ?? 0;
    paintZoneSign(ud.ctx, ud.canvas.width, ud.canvas.height, zone, rank, zoneViews, rankMetric);
    ud.tex.needsUpdate = true;
  }
}
