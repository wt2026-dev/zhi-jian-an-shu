import * as THREE from 'three';
import type { Hall, DeviceSlot } from './hall';
import { type EquipmentBuild } from './equipment';
import { STATUS_META, type StatusKey } from './equipmentStatus';

export interface SceneMinimapState {
  canvas: HTMLCanvasElement | null;
  context: CanvasRenderingContext2D | null;
  hall: Hall | null;
  slots: DeviceSlot[];
  slotStatus: StatusKey[];
  equipment: EquipmentBuild | null;
  selectedId: string | null;
  camera: THREE.PerspectiveCamera;
  direction: THREE.Vector3;
}

/** Draw the top-down equipment and camera overlay independently from the scene engine. */
export function drawSceneMinimap(state: SceneMinimapState): void {
  const { canvas, context: ctx, hall } = state;
  if (!canvas || !ctx) return;
  const w = canvas.clientWidth || 176;
  const h = canvas.clientHeight || 132;
  if (w <= 0 || h <= 0) return;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
  ctx.fillRect(0, 0, w, h);
  if (!hall) return;

  const pad = 7;
  const halfX = Math.max(1, hall.bounds.halfX);
  const halfZ = Math.max(1, hall.bounds.halfZ);
  const scale = Math.min((w - pad * 2) / (halfX * 2), (h - pad * 2) / (halfZ * 2));
  const cx = w / 2;
  const cy = h / 2;
  const px = (x: number) => cx + x * scale;
  const py = (z: number) => cy + z * scale;

  const x0 = px(-halfX);
  const y0 = py(-halfZ);
  const rw = halfX * 2 * scale;
  const rh = halfZ * 2 * scale;
  ctx.fillStyle = 'rgba(148, 163, 184, 0.14)';
  ctx.fillRect(x0, y0, rw, rh);
  ctx.strokeStyle = 'rgba(203, 213, 225, 0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, rw - 1, rh - 1);

  for (let i = 0; i < state.slots.length; i++) {
    const slot = state.slots[i];
    const meta = STATUS_META[state.slotStatus[i] || 'nodata'] || STATUS_META.nodata;
    ctx.beginPath();
    ctx.arc(px(slot.x), py(slot.z), Math.max(2.4, slot.radius * scale * 0.85), 0, Math.PI * 2);
    ctx.fillStyle = `#${meta.colour.toString(16).padStart(6, '0')}`;
    ctx.fill();
    if (meta.alert) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  if (state.selectedId && state.equipment) {
    const idx = state.equipment.indexById.get(state.selectedId);
    const slot = typeof idx === 'number' ? state.slots[idx] : undefined;
    if (slot) {
      ctx.beginPath();
      ctx.arc(px(slot.x), py(slot.z), Math.max(4.5, slot.radius * scale * 1.5), 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }

  const { camera, direction } = state;
  camera.getWorldDirection(direction);
  const cxp = px(camera.position.x);
  const cyp = py(camera.position.z);
  const len = Math.hypot(direction.x, direction.z) || 1;
  const ux = direction.x / len;
  const uz = direction.z / len;
  const fovHalf = ((camera.fov * Math.PI) / 180) * 0.5;
  const coneLen = Math.min(w, h) * 0.42;
  ctx.strokeStyle = 'rgba(96, 165, 250, 0.5)';
  ctx.lineWidth = 1;
  for (const sign of [-1, 1]) {
    const a = Math.atan2(uz, ux) + sign * fovHalf;
    ctx.beginPath();
    ctx.moveTo(cxp, cyp);
    ctx.lineTo(cxp + Math.cos(a) * coneLen, cyp + Math.sin(a) * coneLen);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cxp, cyp, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#60a5fa';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cxp, cyp);
  ctx.lineTo(cxp + ux * coneLen * 0.55, cyp + uz * coneLen * 0.55);
  ctx.stroke();
  ctx.fillStyle = 'rgba(226, 232, 240, 0.75)';
  ctx.font = '9px system-ui, sans-serif';
  ctx.fillText('俯视 · 真实状态', 7, h - 5);
}
