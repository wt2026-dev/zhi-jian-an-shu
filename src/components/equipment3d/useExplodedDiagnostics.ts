/**
 * 拆解舞台的三路真实诊断（自 EquipmentScene.tsx 切出，2026-10-19）。
 *
 * 口径：三个请求全部以「当前打开的拆解设备」为唯一自变量，互不依赖，
 * 失败一律回落 null —— 拆解页照常打开、只是不出对应面板，**不造假**。
 * 切出来是为了让主组件只剩编排：这里不碰场景实例、不碰 3D 状态。
 */
import { useEffect, useState } from 'react';
import {
  explodedViewApi,
  type ExplodedFaultDiagnostics,
  type ExplodedPartLifeDiagnostics,
  type ExplodedPartInventoryDiagnostics,
} from '../../api';

/**
 * 故障定位（F4）：服务端把 equipment_telemetry 真实读数与真实阈值比对后返回
 * 超标指标 + 观察部位位号，舞台自动脉冲定位，侧边给故障详情与「创建维修工单」。
 *
 * 零件寿命预警（F5）：真实更换记录（完工单 parts_used）× 真实运行时钟
 * 算各位号已用/剩余寿命；舞台自动黄/暗红高亮到期零件。
 *
 * 备件库存联动（F6）：一次拉全 spare_parts 真实台账后按位号归属
 * （未命中如实"无备件记录"），侧边给库存四要素卡与低库存采购申请入口。
 */
export function useExplodedDiagnostics(deviceId: string | null): {
  faultInfo: ExplodedFaultDiagnostics | null;
  lifeInfo: ExplodedPartLifeDiagnostics | null;
  inventoryInfo: ExplodedPartInventoryDiagnostics | null;
} {
  const [faultInfo, setFaultInfo] = useState<ExplodedFaultDiagnostics | null>(null);
  const [lifeInfo, setLifeInfo] = useState<ExplodedPartLifeDiagnostics | null>(null);
  const [inventoryInfo, setInventoryInfo] = useState<ExplodedPartInventoryDiagnostics | null>(null);

  useEffect(() => {
    if (!deviceId) {
      setFaultInfo(null);
      return;
    }
    let cancelled = false;
    explodedViewApi
      .getFaultDiagnostics(deviceId)
      .then((diagnostics) => {
        if (!cancelled) setFaultInfo(diagnostics);
      })
      .catch(() => {
        // 诊断接口不可达 / 设备无台账：拆解页照常打开，只是不出故障面板（不造假）
        if (!cancelled) setFaultInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  useEffect(() => {
    if (!deviceId) {
      setLifeInfo(null);
      return;
    }
    let cancelled = false;
    explodedViewApi
      .getPartLifeDiagnostics(deviceId)
      .then((diagnostics) => {
        if (!cancelled) setLifeInfo(diagnostics);
      })
      .catch(() => {
        // 寿命接口不可达 / 设备无台账：拆解页照常打开，只是不出寿命面板（不造假）
        if (!cancelled) setLifeInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  useEffect(() => {
    let cancelled = false;
    if (!deviceId) {
      // 关闭拆解页时清诊断：微任务延迟一轮（避免 effect 内同步 setState 级联渲染）
      queueMicrotask(() => {
        if (!cancelled) setInventoryInfo(null);
      });
      return () => {
        cancelled = true;
      };
    }
    explodedViewApi
      .getPartInventory(deviceId)
      .then((diagnostics) => {
        if (!cancelled) setInventoryInfo(diagnostics);
      })
      .catch(() => {
        // 库存接口不可达 / 设备无台账：拆解页照常打开，只是不出库存面板（不造假）
        if (!cancelled) setInventoryInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  return { faultInfo, lifeInfo, inventoryInfo };
}
