var { request } = require("../../utils/request.js");
var DOT = { alert: "#FB7185", warning: "#FBBF24", success: "#34D399", info: "#22D3EE" };

Page({
  data: { list: [], unread: 0, loading: true },
  onShow() { if (wx.getStorageSync("token")) this.reload(); },
  onPullDownRefresh() { this.reload(function () { wx.stopPullDownRefresh(); }); },
  reload(done) {
    var that = this;
    request("/api/v1/notifications").then(function (list) {
      var view = (list || []).map(function (n) {
        return Object.assign({}, n, { dotColor: DOT[n.type] || "#22D3EE" });
      });
      that.setData({ list: view, unread: view.filter(function (n) { return !n.read; }).length, loading: false });
      if (done) done();
    }).catch(function () { that.setData({ list: [], loading: false }); if (done) done(); });
  },
  tapItem(e) {
    var i = Number(e.currentTarget.dataset.idx);
    var item = this.data.list[i];
    if (!item) return;
    var that = this;
    var doNav = function () {
      if (item.refType === "work_order" && item.refId) {
        wx.navigateTo({ url: "/pages/orders/detail?id=" + item.refId });
      } else if (item.refType === "inspection") {
        wx.navigateTo({ url: "/pages/inspect/list" });
      } else if (item.refType === "safety_permit") {
        wx.navigateTo({ url: "/pages/safety/list" });
      } else if (item.refType === "hazard") {
        wx.navigateTo({ url: "/pages/hazards/list" });
      } else if (item.refType === "knowledge") {
        wx.navigateTo({ url: "/pages/knowledge/knowledge" });
      }
    };
    if (!item.read) {
      request("/api/v1/notifications/" + item.id + "/read", { method: "PATCH" })
        .then(function () {
          that.reload();
          doNav();
        })
        .catch(function () { doNav(); });
    } else {
      doNav();
    }
  },
  markAll() {
    var that = this;
    request("/api/v1/notifications/read-all", { method: "POST" })
      .then(function () { that.reload(); })
      .catch(function () {});
  },
});