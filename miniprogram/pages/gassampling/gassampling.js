var { request } = require("../../utils/request.js");

Page({
  data: {
    loading: false,
    loadError: "",
    currentDepth: 2,
    completedDepth: 2,
    samplingStatus: [true, true, false],
    gasReadings: {
      o2: { value: 20.9, unit: "% VOL", status: "合格", min: 19.5, max: 23.5 },
      lel: { value: 0, unit: "% LEL", status: "合格", min: 0, max: 1.0 },
      co: { value: 4, unit: "ppm", status: "合格", min: 0, max: 20 },
      h2s: { value: 0.0, unit: "ppm", status: "合格", min: 0, max: 7 }
    },
    countdown: "00:24:15",
    countdownSeconds: 1455,
    ticketInfo: {},
    assayer: {},
    deviceInfo: {},
    photoList: [],
    submitting: false
  },

  onLoad: function (options) {
    this._permitId = options.id || "";
    this.loadData();
    this.startCountdown();
    this.startGasUpdate();
  },

  onUnload: function () {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    if (this.gasUpdateTimer) clearInterval(this.gasUpdateTimer);
  },

  loadData: function () {
    var that = this;
    that.setData({ loading: true, loadError: "" });
    var requests = [
      request("/api/v1/safety-permits").catch(function () { return []; }),
      request("/api/v1/auth/me").catch(function () { return {}; })
    ];
    Promise.all(requests).then(function (rs) {
      var permits = rs[0] || [];
      var user = rs[1] || {};
      var p = permits[0] || {};
      that.setData({
        loading: false,
        ticketInfo: {
          id: p.id || "--",
          type: p.permitType || "有限空间 + 动火",
          area: p.location || p.workshop || "--",
          partition: p.partition || "02B",
          volume: p.volume || "128m³",
          depth: p.depth || "5.2m"
        },
        assayer: {
          name: user.name || "--",
          initial: (user.name || "?").slice(0, 1),
          role: user.roleTitle || "安环专职化验员",
          employeeId: user.username || "--",
          certNo: user.certNo || "--"
        },
        deviceInfo: {
          name: "RAE-Guard 四合一检测仪",
          battery: 88,
          probeId: "检测仪-8041",
          probeType: "蓝牙泵吸式",
          calibrationDays: 42,
          lastSync: "5s 前"
        }
      });
    }).catch(function () {
      that.setData({ loading: false, loadError: "加载失败，请确认后端服务已启动" });
    });
  },

  goBack: function () { wx.navigateBack({ delta: 1 }); },

  selectDepth: function (e) {
    this.setData({ currentDepth: parseInt(e.currentTarget.dataset.depth) });
  },

  startCountdown: function () {
    var that = this;
    this.countdownTimer = setInterval(function () {
      var seconds = that.data.countdownSeconds;
      if (seconds > 0) {
        seconds--;
        var h = Math.floor(seconds / 3600);
        var m = Math.floor((seconds % 3600) / 60);
        var s = seconds % 60;
        that.setData({
          countdownSeconds: seconds,
          countdown: (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s
        });
      } else {
        clearInterval(that.countdownTimer);
        wx.showToast({ title: "采样已超时，请重新采样", icon: "none", duration: 3000 });
      }
    }, 1000);
  },

  startGasUpdate: function () {
    var that = this;
    this.gasUpdateTimer = setInterval(function () {
      var gasReadings = JSON.parse(JSON.stringify(that.data.gasReadings));
      var keys = Object.keys(gasReadings);
      for (var i = 0; i < keys.length; i++) {
        var gas = keys[i];
        var r = gasReadings[gas];
        var v = r.value + (Math.random() - 0.5) * 0.2;
        if (v < 0) v = 0;
        var status = "合格";
        if (gas === "o2") { if (v < r.min || v > r.max) status = "不合格"; }
        else { if (v > r.max) status = "不合格"; }
        gasReadings[gas] = { value: Math.round(v * 10) / 10, unit: r.unit, status: status, min: r.min, max: r.max };
      }
      that.setData({ gasReadings: gasReadings });
    }, 5000);
  },

  adjustValue: function (e) {
    var gas = e.currentTarget.dataset.gas;
    var delta = parseFloat(e.currentTarget.dataset.delta);
    var gasReadings = JSON.parse(JSON.stringify(this.data.gasReadings));
    var r = gasReadings[gas];
    var v = r.value + delta;
    if (v < 0) v = 0;
    var status = "合格";
    if (gas === "o2") { if (v < r.min || v > r.max) status = "不合格"; }
    else { if (v > r.max) status = "不合格"; }
    gasReadings[gas] = { value: Math.round(v * 10) / 10, unit: r.unit, status: status, min: r.min, max: r.max };
    this.setData({ gasReadings: gasReadings });
  },

  triggerResync: function () {
    wx.showToast({ title: "正在重测校准...", icon: "loading", duration: 1000 });
  },

  choosePhoto: function () {
    var that = this;
    wx.chooseMedia({
      count: 1, mediaType: ["image"], sourceType: ["camera"],
      success: function (res) {
        var list = that.data.photoList.slice();
        list.push({ path: res.tempFiles[0].tempFilePath, time: that.formatTime(new Date()), verified: true });
        that.setData({ photoList: list });
      }
    });
  },

  formatTime: function (date) {
    var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
  },

  submitReport: function () {
    if (this.data.submitting) return;
    var that = this;
    wx.showModal({
      title: "确认提交",
      content: "确定要签署并提交采样分析报告吗？",
      confirmText: "确认提交",
      confirmColor: "#38bdf8",
      success: function (res) {
        if (res.confirm) {
          that.setData({ submitting: true });
          request("/api/v1/inspections", {
            method: "POST",
            data: { title: "气体采样报告", type: "gas_sampling", items: that.data.gasReadings }
          }).then(function () {
            that.setData({ submitting: false });
            wx.showToast({ title: "采样报告已生效并流转", icon: "success", duration: 2000 });
          }).catch(function () {
            that.setData({ submitting: false });
            wx.showToast({ title: "提交失败，请重试", icon: "none" });
          });
        }
      }
    });
  }
});
