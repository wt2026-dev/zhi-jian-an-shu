var { request } = require("../../utils/request.js");

Page({
  data: {
    loading: false,
    loadError: "",
    permitId: "",
    h2sReading: { value: 0, unit: "ppm", threshold: 7.0, status: "正常", percentage: 0 },
    lelReading: 0,
    o2Reading: 0,
    coReading: 0,
    interlockStatus: [],
    systemInfo: {}
  },

  onLoad: function (options) {
    this._permitId = options.id || "";
    this.loadData();
    this.startGasReadingUpdate();
  },

  onUnload: function () {
    if (this.gasUpdateTimer) clearInterval(this.gasUpdateTimer);
  },

  loadData: function () {
    var that = this;
    that.setData({ loading: true, loadError: "" });
    request("/api/v1/safety-permits").then(function (permits) {
      var p = (permits || [])[0] || {};
      that.setData({
        loading: false,
        permitId: p.id || "",
        h2sReading: { value: p.h2sValue || 0, unit: "ppm", threshold: 7.0, status: (p.h2sValue || 0) > 7 ? "超标" : "正常", percentage: Math.round(((p.h2sValue || 0) - 7) / 7 * 100 * 10) / 10 },
        lelReading: p.lelValue || 0,
        o2Reading: p.o2Value || 20.9,
        coReading: p.coValue || 0,
        interlockStatus: p.interlockStatus || [
          { id: 1, name: "作业票熔断 · 门禁闭锁", status: "已强锁", type: "error" },
          { id: 2, name: "防爆离心风机全速强排", status: "已强开", type: "success" },
          { id: 3, name: "全域声光直报安环总控", status: "已联动", type: "success" }
        ],
        systemInfo: p.systemInfo || { plcNode: "--", securityHash: "--", verificationStatus: "校验正常" }
      });
    }).catch(function (e) {
      that.setData({ loading: false, loadError: (e && (e.error || e.message)) || "加载失败，请确认后端服务已启动" });
    });
  },

  startGasReadingUpdate: function () {
    var that = this;
    this.gasUpdateTimer = setInterval(function () {
      if (!that.data.permitId) return;
      request("/api/v1/safety-permits/" + that.data.permitId).then(function (p) {
        that.setData({
          "h2sReading.value": p.h2sValue || that.data.h2sReading.value,
          "h2sReading.percentage": Math.round(((p.h2sValue || 0) - 7) / 7 * 100 * 10) / 10,
          "h2sReading.status": (p.h2sValue || 0) > 7 ? "超标" : "正常",
          lelReading: p.lelValue || that.data.lelReading,
          o2Reading: p.o2Value || that.data.o2Reading,
          coReading: p.coValue || that.data.coReading
        });
      }).catch(function () {});
    }, 5000);
  },

  callDispatch: function () {
    wx.showModal({
      title: "呼叫安环调度",
      content: "确定要拨打安环调度中心电话吗？\n分机号: 8088",
      confirmText: "拨打",
      confirmColor: "#38bdf8",
      success: function (res) {
        if (res.confirm) {
          wx.makePhoneCall({
            phoneNumber: "8088",
            fail: function () { wx.showToast({ title: "拨打失败", icon: "none" }); }
          });
        }
      }
    });
  },

  confirmEvacuation: function () {
    var that = this;
    wx.showModal({
      title: "确认全员撤离",
      content: "此操作将确认全员撤离响应，系统将记录撤离确认时间。\n\n请确认所有人员已安全撤离！",
      confirmText: "确认撤离",
      confirmColor: "#ffb4ab",
      success: function (res) {
        if (res.confirm) {
          wx.showLoading({ title: "提交撤离确认..." });
          var url = that.data.permitId ? "/api/v1/safety-permits/" + that.data.permitId + "/close" : "/api/v1/safety-permits";
          request(url, { method: "POST", data: { closeRemark: "全员撤离确认" } }).then(function () {
            wx.hideLoading();
            wx.showModal({
              title: "撤离确认成功",
              content: "全员撤离确认已提交。\n\n确认时间: " + new Date().toLocaleString(),
              showCancel: false,
              confirmText: "我知道了",
              success: function () { wx.navigateBack({ delta: 1 }); }
            });
          }).catch(function () {
            wx.hideLoading();
            wx.showToast({ title: "提交失败，请重试", icon: "none" });
          });
        }
      }
    });
  }
});
