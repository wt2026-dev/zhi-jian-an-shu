var { request } = require("../../utils/request.js");
var ui = require("../../utils/ui.js");

Page({
  data: {
    cur: "all",
    tabs: [
      { k: "all", t: "全部" },
      { k: "dispatched", t: "待派单" },
      { k: "pending", t: "待接单" },
      { k: "in_progress", t: "检修中" },
      { k: "pending_acceptance", t: "待验收" },
      { k: "completed", t: "已归档" }
    ],
    list: [],
    allOrders: [],
    loading: false,
    loadError: ""
  },
  onShow() {
    this.loadData();
  },
  loadData() {
    var that = this;
    that.setData({ loading: true, loadError: "" });
    request("/api/v1/work-orders").then(function (orders) {
      var list = (orders || []).map(function (o) {
        var p = ui.mapPriority(o);
        var s = ui.mapStatus(o);
        return Object.assign({}, o, {
          pText: p.text, pStyle: p.style, sText: s.text, sStyle: s.style,
          assignee: o.assignee || "待分配",
          equipmentName: o.equipmentName || "--",
          workshop: o.workshop || "--",
          createdAt: o.createdAt || "--"
        });
      });
      that.setData({ allOrders: list, loading: false });
      that.filterList();
    }).catch(function (e) {
      that.setData({ loading: false, loadError: (e && (e.error || e.message)) || "加载失败，请确认后端服务已启动" });
    });
  },
  filterList() {
    var k = this.data.cur;
    var orders = this.data.allOrders;
    if (k === "all") {
      this.setData({ list: orders });
    } else {
      this.setData({ list: orders.filter(function (o) { return o.status === k; }) });
    }
  },
  onTab(e) {
    var k = e.currentTarget.dataset.k;
    this.setData({ cur: k });
    this.filterList();
  },
  goDetail(e) {
    var id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: "/pages/orders/detail?id=" + id });
  },
  goCreate() {
    wx.navigateTo({ url: "/pages/orders/create" });
  }
});
