var { request } = require("../../utils/request.js");

// AI 推荐故障类型关键词映射（用于把 AI 结论落到既有故障类型枚举上）
var FAULT_KEYWORDS = [
  ["振动", "机械振动"],
  ["异响", "机械振动"],
  ["轴承", "轴承过热"],
  ["过热", "轴承过热"],
  ["温度", "轴承过热"],
  ["电气", "电气短路"],
  ["短路", "电气短路"],
  ["绝缘", "电气短路"],
  ["电机", "电气短路"],
  ["密封", "密封泄漏"],
  ["泄漏", "密封泄漏"],
  ["渗漏", "密封泄漏"],
  ["磨损", "结构磨损"],
  ["点蚀", "结构磨损"],
  ["裂纹", "结构磨损"],
  ["控制", "控制系统异常"],
  ["信号", "控制系统异常"],
  ["PLC", "控制系统异常"],
  ["润滑", "定期润滑维保"],
  ["保养", "定期润滑维保"],
  ["换油", "定期润滑维保"],
];

Page({
  data: {
    eqs: [], eqNames: [], eqIdx: 0,
    faultTypes: ["机械振动", "轴承过热", "电气短路", "密封泄漏", "结构磨损", "控制系统异常", "定期润滑维保"],
    faultIdx: 0,
    priorities: ["urgent", "high", "medium", "low"],
    priTexts: ["紧急", "高", "中", "低"],
    priIdx: 1,
    desc: "", safety: "穿戴劳保鞋与安全帽\n实施 LOTO 停电挂牌",
    submitting: false, dup: null,
    aiLoading: false, aiDraft: null,
  },

  onLoad() {
    var that = this;
    request("/api/v1/equipments").then(function (list) {
      that.setData({ eqs: list || [], eqNames: (list || []).map(function (e) { return e.name + "（" + e.code + "）"; }) });
    }).catch(function () {});
  },

  onEq(e) { this.setData({ eqIdx: Number(e.detail.value) }); },
  onFault(e) { this.setData({ faultIdx: Number(e.detail.value) }); },
  onPri(e) { this.setData({ priIdx: Number(e.detail.value) }); },
  onDesc(e) { this.setData({ desc: e.detail.value }); },
  onSafety(e) { this.setData({ safety: e.detail.value }); },

  submit() {
    var d = this.data;
    if (!d.eqs[d.eqIdx]) { wx.showToast({ title: "请选择设备", icon: "none" }); return; }
    if (!String(d.desc || "").trim()) { wx.showToast({ title: "请填写故障描述", icon: "none" }); return; }
    this._submit(false);
  },

  forceSubmit() { this._submit(true); },

  _submit(force) {
    var that = this, d = this.data;
    if (d.submitting) return;

    // ✅ Bug 修复：原实现引用了未定义变量 eq（该变量只存在于 submit() 作用域），
    // 导致 ReferenceError 使"提交中..."卡死。这里统一从 data 中取当前选中设备。
    var eq = d.eqs[d.eqIdx];
    if (!eq) { wx.showToast({ title: "请选择设备", icon: "none" }); return; }
    if (!String(d.desc || "").trim()) { wx.showToast({ title: "请填写故障描述", icon: "none" }); return; }

    var user = wx.getStorageSync("user") || {};
    this.setData({ submitting: true, dup: null });

    request("/api/v1/work-orders", {
      method: "POST",
      timeout: 60000,
      data: {
        title: "【" + d.priTexts[d.priIdx] + "】" + eq.name + " " + d.faultTypes[d.faultIdx],
        equipmentId: eq.id,
        faultType: d.faultTypes[d.faultIdx],
        priority: d.priorities[d.priIdx],
        description: d.desc,
        safetyRequirements: String(d.safety || "").split("\n").filter(function (l) { return l.trim(); }),
        creator: (user.name || "小程序用户") + "（" + (user.roleTitle || "移动端") + "）",
        forceSubmit: force,
      },
    }).then(function () {
      wx.showToast({ title: "提交成功", icon: "success" });
      setTimeout(function () {
        // 工单列表是 tabBar 页面，用 switchTab 跳转并刷新列表
        wx.switchTab({ url: "/pages/orders/list" });
      }, 800);
    }).catch(function (e) {
      that.setData({ submitting: false });
      if (e && e.code === "DUPLICATE_WORK_ORDER") {
        that.setData({ dup: e });
        return;
      }
      // 其它失败：明确提示，绝不停留在"提交中..."
      wx.showToast({
        title: (e && (e.error || e.message)) || "提交失败，请重试",
        icon: "none",
        duration: 2600,
      });
    });
  },

  // AI 智能诊断：依据设备 + 故障现象，生成工单草稿（故障类型/优先级/处置建议/备件/工时）
  aiDiagnose() {
    var that = this, d = this.data;
    var eq = d.eqs[d.eqIdx];
    if (!eq) { wx.showToast({ title: "请先选择设备", icon: "none" }); return; }
    if (!String(d.desc || "").trim()) { wx.showToast({ title: "请先描述故障现象", icon: "none" }); return; }
    if (d.aiLoading) return;

    this.setData({ aiLoading: true, aiDraft: null });
    wx.showLoading({ title: "AI 诊断中...", mask: true });

    request("/api/v1/ai/generate-work-order", {
      method: "POST",
      timeout: 60000,
      data: { equipmentId: eq.id, abnormalDescription: d.desc, telemetrySnapshot: eq.telemetry || {} },
    }).then(function (res) {
      wx.hideLoading();
      var draft = (res && res.draft) || null;
      if (!draft) { wx.showToast({ title: "AI 未返回诊断结果", icon: "none" }); that.setData({ aiLoading: false }); return; }

      var PRI_TEXT = { urgent: "紧急", high: "高", medium: "中", low: "低" };
      var steps = draft.suggestedSteps || [];
      var next = {
        aiLoading: false,
        aiDraft: draft,
        aiPriorityText: PRI_TEXT[draft.priority] || draft.priority || "-",
        aiPriorityReason: draft.priorityReason || "",
        aiSteps: steps,
        aiParts: draft.spareParts || [],
        aiHours: draft.estimatedHours || 0,
      };

      // 回填优先级
      var pi = d.priorities.indexOf(draft.priority);
      if (pi >= 0) next.priIdx = pi;

      // 回填故障类型（标题/描述关键词匹配）
      var text = (draft.title || "") + " " + (draft.description || "");
      for (var i = 0; i < FAULT_KEYWORDS.length; i++) {
        if (text.indexOf(FAULT_KEYWORDS[i][0]) >= 0) {
          var fi = d.faultTypes.indexOf(FAULT_KEYWORDS[i][1]);
          if (fi >= 0) { next.faultIdx = fi; break; }
        }
      }

      // 回填描述：AI 描述 + 建议步骤
      if (draft.description) {
        next.desc = draft.description + (steps.length ? "\n\n建议处置步骤：\n" + steps.map(function (s, i) { return (i + 1) + ". " + s; }).join("\n") : "");
      }

      that.setData(next);
      wx.showToast({ title: "已按 AI 建议填充", icon: "success" });
    }).catch(function (e) {
      wx.hideLoading();
      that.setData({ aiLoading: false });
      wx.showToast({ title: (e && (e.error || e.message)) || "AI 诊断失败", icon: "none", duration: 2600 });
    });
  },
});
