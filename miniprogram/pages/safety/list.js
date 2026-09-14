var { request } = require("../../utils/request.js");
var ui = require("../../utils/ui.js");

Page({
  data: {
    locks: [], list: [], loading: true,
    tabs: [ { k: "", t: "全部" }, { k: "pending_approval", t: "待审批" }, { k: "active", t: "作业中" }, { k: "closed", t: "已关闭" } ],
    cur: "",
  },
  onShow() { if (wx.getStorageSync("token")) this.reload(); },
  onPullDownRefresh() { this.reload(function () { wx.stopPullDownRefresh(); }); },
  onTab(e) { this.setData({ cur: e.currentTarget.dataset.k }); this.reload(); },
  reload() {
    var that = this;
    that.setData({ loading: that.data.list.length === 0 });
    request("/api/v1/loto-locks").then(function (locks) {
      that.setData({ locks: (locks || []).map(function (l) {
        var on = l.status === "locked";
        return Object.assign({}, l, { statusText: on ? "挂锁中" : "已解除", badgeStyle: ui.badge(on ? "#A78BFA" : "#525252") });
      }) });
    }).catch(function () {});
    request("/api/v1/safety-permits").then(function (list) {
      var view = (list || []).filter(function (p) { return !that.data.cur || p.status === that.data.cur; }).map(function (p) {
        var s = ui.PERMIT_STATUS[p.status] || { t: p.status, c: "#737373" };
        return Object.assign({}, p, { sText: s.t, sStyle: ui.badge(s.c) });
      });
      that.setData({ list: view, loading: false });
    }).catch(function () { that.setData({ list: [], loading: false }); });
  },
  goDetail(e) { wx.navigateTo({ url: "/pages/safety/detail?id=" + e.currentTarget.dataset.id }); },
});