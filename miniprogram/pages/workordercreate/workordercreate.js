var { request } = require("../../utils/request.js");

Page({
  data: {
    loading: false,
    loadError: "",
    progress: 25,
    currentStep: 1,
    workOrder: {},
    workArea: {},
    personnel: {},
    completedChecks: 0,
    safetyChecks: [],
    approvalFlow: {},
    equipmentList: []
  },

  onLoad: function (options) {
    this._workOrderId = options.workOrderId || "";
    this.loadData();
  },

  loadData: function () {
    var that = this;
    that.setData({ loading: true, loadError: "" });
    var requests = [
      request("/api/v1/equipments").catch(function () { return []; }),
      request("/api/v1/auth/me").catch(function () { return {}; })
    ];
    if (that._workOrderId) {
      requests.push(request("/api/v1/work-orders/" + that._workOrderId).catch(function () { return {}; }));
    }
    Promise.all(requests).then(function (rs) {
      var equips = rs[0] || [];
      var user = rs[1] || {};
      var wo = rs[2] || {};
      that.setData({
        loading: false,
        equipmentList: equips,
        workOrder: wo.id ? { id: wo.id, title: wo.title || "--" } : { id: "--", title: "请选择关联工单" },
        workArea: {
          location: wo.location || wo.workshop || "--",
          partition: wo.partition || "作业分区-02B",
          duration: wo.estimatedHours || 8.0,
          startTime: wo.startTime || "--",
          endTime: wo.endTime || "--",
          headcount: wo.headcount || 3
        },
        personnel: {
          leader: { name: user.name || "--", title: user.roleTitle || "主检技师", id: user.username || "--" },
          guardian: { name: "--", license: "--" }
        },
        safetyChecks: wo.safetyChecks || [
          { id: 1, name: "抽堵盲板及能量物料硬隔离", status: "待确认", code: "挂牌上锁 (LOTO) 待确认" },
          { id: 2, name: "机械强制连续送风通风", status: "待确认", code: "置换排风运行待确认" },
          { id: 3, name: "四合一便携式气体分析仪联锁", status: "待配置", code: "蓝牙气体检测仪待绑定" },
          { id: 4, name: "救援三脚架、速差自控器及自救呼吸器", status: "待核验", code: "进出口旁放置待核验" }
        ],
        completedChecks: (wo.safetyChecks || []).filter(function (c) { return c.status !== "待确认"; }).length || 0,
        approvalFlow: wo.approvalFlow || {
          node1: { person: user.name || "--", role: "现场检修负责人", status: "当前环节" },
          node2: { person: "--", role: "专职安全监护人", status: "待前置完成" },
          node3: { person: "--", role: "车间主任", status: "待前置完成" },
          node4: { person: "--", role: "安环部安全总监", status: "终审许可" }
        }
      });
    }).catch(function (e) {
      that.setData({ loading: false, loadError: (e && (e.error || e.message)) || "加载失败，请确认后端服务已启动" });
    });
  },

  goBack: function () { wx.navigateBack({ delta: 1 }); },

  saveAsTemplate: function () {
    var that = this;
    wx.showModal({
      title: "保存预案模板", content: "确定要将当前作业票保存为预案模板吗？",
      confirmText: "保存", confirmColor: "#38bdf8",
      success: function (res) {
        if (res.confirm) {
          wx.showLoading({ title: "保存中..." });
          request("/api/v1/knowledge", {
            method: "POST",
            data: { title: "作业票模板-" + (that.data.workOrder.title || ""), category: "template", content: JSON.stringify(that.data) }
          }).then(function () {
            wx.hideLoading();
            wx.showToast({ title: "模板保存成功", icon: "success" });
          }).catch(function () {
            wx.hideLoading();
            wx.showToast({ title: "保存失败", icon: "none" });
          });
        }
      }
    });
  },

  goNextStep: function () {
    var that = this;
    var nextStep = this.data.currentStep + 1;
    if (nextStep > 4) {
      wx.showModal({
        title: "提交审批", content: "确定要提交作业票进入审批流程吗？",
        confirmText: "确认提交", confirmColor: "#22c55e",
        success: function (res) {
          if (res.confirm) that.submitWorkOrder();
        }
      });
      return;
    }
    this.setData({ currentStep: nextStep, progress: nextStep * 25 });
    wx.showToast({ title: "步骤 " + nextStep + "/4", icon: "none" });
  },

  validateCurrentStep: function () {
    if (this.data.currentStep === 1 && !this.data.workOrder.id) {
      wx.showToast({ title: "请选择关联工单", icon: "none" });
      return false;
    }
    return true;
  },

  submitWorkOrder: function () {
    var that = this;
    wx.showLoading({ title: "提交中..." });
    request("/api/v1/work-orders", {
      method: "POST",
      data: {
        title: that.data.workOrder.title || "新建作业票",
        description: JSON.stringify(that.data.workArea),
        priority: "high",
        equipmentId: that.data.workOrder.id !== "--" ? that.data.workOrder.id : undefined
      }
    }).then(function () {
      wx.hideLoading();
      wx.showModal({
        title: "提交成功", content: "作业票已成功提交，等待审批。",
        showCancel: false, confirmText: "返回工作台",
        success: function () { wx.navigateBack({ delta: 2 }); }
      });
    }).catch(function () {
      wx.hideLoading();
      wx.showToast({ title: "提交失败，请重试", icon: "none" });
    });
  }
});
