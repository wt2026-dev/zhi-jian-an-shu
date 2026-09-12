var { request } = require("../../utils/request.js");
var ui = require("../../utils/ui.js");

function itemState(it) {
  var hasValue = it.recordedValue !== undefined && it.recordedValue !== null && it.recordedValue !== "";
  var abnormal = it.status === "abnormal" || it.isPass === false;
  var maxL = it.maxLimit !== undefined && it.maxLimit !== null ? it.maxLimit : it.maxVal;
  var minL = it.minLimit !== undefined && it.minLimit !== null ? it.minLimit : it.minVal;
  if (hasValue && (maxL !== undefined || minL !== undefined)) {
    var v = Number(it.recordedValue);
    if (!isNaN(v)) abnormal = (maxL !== undefined && v > maxL) || (minL !== undefined && v < minL);
  }
  return {
    abnormal: abnormal,
    stateText: abnormal ? "异常" : hasValue ? "合格" : "待点检",
    badgeStyle: ui.badge(abnormal ? "#FB7185" : hasValue ? "#34D399" : "#525252"),
    rangeText: maxL !== undefined && minL !== undefined ? minL + " ~ " + maxL : maxL !== undefined ? "≤ " + maxL : minL !== undefined ? "≥ " + minL : "",
  };
}

Page({
  data: { loading: true, task: null, items: [], aStyle: ui.badge("#FB7185"), scanResult: "", aiDraftOpen: false, aiLoading: false, aiDraft: null, aiPoint: null },
  onLoad(query) {
    this.id = query.id;
    var that = this;
    if (query.scannedCode) {
      that.setData({
        scanResult: "✅ 已扫码识别设备: " + decodeURIComponent(query.scannedCode)
      });
    }
    request("/api/v1/inspections/" + query.id).then(function (t) {
      var items = (t.items || []).map(function (it) {
        var st = itemState(it);
        return Object.assign({}, it, st, { input: it.recordedValue === undefined || it.recordedValue === null ? "" : String(it.recordedValue) });
      });
      that.setData({ loading: false, task: t, items: items });
    }).catch(function () { that.setData({ loading: false }); });
  },
  rebuild() {
    var items = this.data.items;
    var abnormal = 0, completed = 0;
    items.forEach(function (it) {
      var st = itemState(it);
      it.abnormal = st.abnormal; it.stateText = st.stateText; it.badgeStyle = st.badgeStyle;
      it.isPass = !st.abnormal; it.status = st.abnormal ? "abnormal" : "normal";
      if (st.abnormal) abnormal += 1;
      if (it.input !== "") completed += 1;
    });
    this.setData({ items: items, task: Object.assign({}, this.data.task, { completedPoints: completed, totalPoints: items.length, abnormalCount: abnormal }) });
    return { items: items, completedPoints: completed, abnormalCount: abnormal };
  },
  onValue(e) {
    var i = Number(e.currentTarget.dataset.idx);
    var items = this.data.items;
    items[i].input = e.detail.value;
    items[i].recordedValue = e.detail.value === "" ? undefined : Number(e.detail.value);
    var st = itemState(items[i]);
    items[i].abnormal = st.abnormal; items[i].stateText = st.stateText; items[i].badgeStyle = st.badgeStyle;
    this.setData({ items: items });
  },
  onNotes(e) {
    var i = Number(e.currentTarget.dataset.idx);
    var items = this.data.items;
    items[i].notes = e.detail.value;
    this.setData({ items: items });
  },
  submitPoint(e) {
    var i = Number(e.currentTarget.dataset.idx);
    if (this.data.items[i].input === "") { wx.showToast({ title: "请先录入实测值", icon: "none" }); return; }
    var body = this.rebuild();
    var that = this;
    request("/api/v1/inspections/" + this.id, { method: "PATCH", data: body })
      .then(function () { wx.showToast({ title: "打卡成功", icon: "success" }); })
      .catch(function () {});
  },
  scanCode() {
    var that = this;
    wx.scanCode({
      success(res) {
        var raw = (res.result || "").trim();
        var code = raw;
        try {
          if (raw.indexOf("?") !== -1 || raw.indexOf("http://") === 0 || raw.indexOf("https://") === 0) {
            var qIdx = raw.indexOf("?");
            if (qIdx !== -1) {
              var pairs = raw.substring(qIdx + 1).split("&");
              for (var i = 0; i < pairs.length; i++) {
                var p = pairs[i].split("=");
                if (p[0] === "equipmentId" || p[0] === "targetEquipmentId" || p[0] === "id") {
                  code = decodeURIComponent(p[1] || "");
                  break;
                }
              }
            }
          }
        } catch (_) {}
        try {
          if (raw.indexOf("{") === 0 && raw.lastIndexOf("}") === raw.length - 1) {
            var obj = JSON.parse(raw);
            if (obj.code || obj.id) code = obj.code || obj.id;
          }
        } catch (_) {}

        var target = code.toUpperCase();
        // Try to match scanned code to equipment in current task or system
        var hit = that.data.items.some(function (it) {
          return (it.equipmentCode && it.equipmentCode.toUpperCase() === target) ||
                 (it.equipmentId && it.equipmentId.toUpperCase() === target);
        });
        if (hit) {
          that.setData({ scanResult: "✅ 二维码核验成功：" + code });
          wx.showToast({ title: "设备核验成功", icon: "success" });
        } else {
          // Try to find equipment by code from all equipments
          request("/api/v1/equipments").then(function (eqs) {
            var matched = (eqs || []).find(function (eq) {
              return (eq.code && eq.code.toUpperCase() === target) ||
                     (eq.id && eq.id.toUpperCase() === target) ||
                     (eq.name && eq.name.toUpperCase().indexOf(target) !== -1);
            });
            if (matched) {
              that.setData({
                scanResult: "✅ 已扫码识别设备：" + matched.name + " (" + (matched.code || matched.id) + ")"
              });
              wx.showToast({ title: "已识别: " + matched.name, icon: "success", duration: 2000 });
            } else {
              that.setData({ scanResult: "⚠️ 扫码结果：" + code + "（未匹配系统设备，可在下方手动点检）" });
              wx.showToast({ title: "未匹配设备", icon: "none" });
            }
          }).catch(function () {
            that.setData({ scanResult: "⚠️ 扫码结果：" + code + "（未匹配当前任务测点）" });
          });
        }
      },
      fail: function (err) {
        if (err.errMsg && err.errMsg.indexOf("cancel") > -1) {
          // User cancelled scan, do nothing
        } else {
          wx.showToast({ title: "扫码失败：" + (err.errMsg || "未知错误"), icon: "none" });
        }
      }
    });
  },
  toOrder(e) {
    var it = this.data.items[Number(e.currentTarget.dataset.idx)];
    var user = wx.getStorageSync("user") || {};
    var that = this;
    request("/api/v1/work-orders", {
      method: "POST",
      timeout: 60000,
      data: {
        title: "【巡检异常】" + (it.equipmentName || this.data.task.workshop) + " " + (it.checkPoint || it.checkItem || ""),
        equipmentId: it.equipmentId || (this.data.task.id || ""),
        faultType: "机械振动",
        priority: "high",
        description: "巡检发现 " + (it.checkPoint || it.checkItem || "") + " 实测 " + it.recordedValue + (it.unit || "") + "，标准" + (it.standard || "") + "。备注：" + (it.notes || "无"),
        safetyRequirements: ["作业前实施现场停电上锁隔离", "穿戴劳保用品"],
        creator: (user.name || "巡检员") + "（巡检现场转单）",
        forceSubmit: true,
      },
    }).then(function (o) {
      wx.showModal({ title: "转单成功", content: "工单 " + (o.orderNo || "") + " 已创建", showCancel: false });
    }).catch(function () {});
  },
  aiDraft(e) {
    var it = this.data.items[Number(e.currentTarget.dataset.idx)];
    this.setData({ aiDraftOpen: true, aiLoading: true, aiPoint: it, aiDraft: null });
    var that = this;
    var eqId = it.equipmentId;
    request("/api/v1/equipments").then(function (eqs) {
      var eq = (eqs || []).find(function (x) { return x.id === eqId || x.name === it.equipmentName; }) || (eqs || [])[0];
      return request("/api/v1/ai/generate-work-order", {
        method: "POST", timeout: 90000,
        data: {
          equipmentId: eq ? eq.id : eqId,
          abnormalDescription: "巡检异常：" + (it.checkPoint || it.checkItem || "") + " 实测 " + it.recordedValue + (it.unit || "") + "（标准" + (it.standard || "") + "），备注 " + (it.notes || "无"),
          inspectionPointId: it.id,
          telemetrySnapshot: eq ? eq.telemetry : null,
        },
      });
    }).then(function (res) {
      if (res.success && res.draft) that.setData({ aiLoading: false, aiDraft: res.draft });
      else { that.setData({ aiLoading: false, aiDraftOpen: false }); wx.showModal({ title: "AI 生成失败", content: res.message || res.error || "", showCancel: false }); }
    }).catch(function (e) {
      that.setData({ aiLoading: false, aiDraftOpen: false });
      wx.showModal({ title: "AI 调用失败", content: (e && (e.message || e.error)) || "网络异常", showCancel: false });
    });
  },
  closeAi() { this.setData({ aiDraftOpen: false, aiDraft: null }); },
  confirmAiOrder() {
    var d = this.data.aiDraft, pt = this.data.aiPoint;
    if (!d || !pt) return;
    var user = wx.getStorageSync("user") || {};
    var that = this;
    request("/api/v1/work-orders", {
      method: "POST", timeout: 60000,
      data: {
        title: d.title, equipmentId: pt.equipmentId, faultType: "机械振动",
        priority: d.priority, description: d.description,
        safetyRequirements: d.suggestedSteps || [],
        creator: (user.name || "巡检员") + "（AI 辅助生成）", forceSubmit: true,
      },
    }).then(function () {
      that.setData({ aiDraftOpen: false, aiDraft: null });
      wx.showToast({ title: "工单已创建", icon: "success" });
    }).catch(function () {});
  },
});
