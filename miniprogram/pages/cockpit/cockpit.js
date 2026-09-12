var { request } = require("../../utils/request.js");

Page({
  data: {
    loading: true,
    loadError: "",
    equipmentCount: 0,
    workOrderCompleteRate: 0,
    inspectionCompleteRate: 0,
    pendingHazards: 0,
    aiCallCount: 0,
    activeWorkOrders: 0,
    urgentOrders: 0,
    runningEquipments: 0,
    warningEquipments: 0,
    faultEquipments: 0,
    totalInspections: 0,
    completedInspections: 0,
    abnormalInspections: 0,
    activePermits: 0,
    lowStockParts: 0,
    recentOrders: [],
    equipStatusList: [],
  },

  onLoad() { this.loadData(); },
  onPullDownRefresh() { this.loadData(function() { wx.stopPullDownRefresh(); }); },

  loadData(done) {
    var that = this;
    that.setData({ loading: true, loadError: "" });
    Promise.all([
      request("/api/v1/equipments"),
      request("/api/v1/work-orders"),
      request("/api/v1/inspections"),
      request("/api/v1/safety-permits"),
      request("/api/v1/hazards"),
      request("/api/v1/spare-parts"),
    ]).then(function(rs) {
      var equips = rs[0] || [];
      var orders = rs[1] || [];
      var insps = rs[2] || [];
      var permits = rs[3] || [];
      var hazards = rs[4] || [];
      var spares = rs[5] || [];

      var activeStatuses = ["created", "dispatched", "in_progress", "pending_acceptance"];
      var activeOrders = orders.filter(function(o) { return activeStatuses.indexOf(o.status) >= 0; });
      var completedOrders = orders.filter(function(o) { return o.status === "completed"; });
      var urgentOrders = orders.filter(function(o) { return o.priority === "urgent" && o.status !== "completed" && o.status !== "cancelled"; });

      var inspDone = 0, inspTotal = 0, inspAbnormal = 0;
      insps.forEach(function(t) {
        inspDone += t.completedPoints || 0;
        inspTotal += t.totalPoints || 0;
        inspAbnormal += t.abnormalCount || 0;
      });

      var running = equips.filter(function(e) { return e.status === "running"; }).length;
      var warning = equips.filter(function(e) { return e.status === "warning"; }).length;
      var fault = equips.filter(function(e) { return e.status === "fault" || e.status === "overhauling"; }).length;

      var pendingHazardCount = hazards.filter(function(h) { return h.status !== "closed"; }).length;
      var lowStock = spares.filter(function(p) { return p.stock <= p.safe_stock; }).length;

      that.setData({
        loading: false,
        equipmentCount: equips.length,
        runningEquipments: running,
        warningEquipments: warning,
        faultEquipments: fault,
        activeWorkOrders: activeOrders.length,
        urgentOrders: urgentOrders.length,
        workOrderCompleteRate: orders.length > 0 ? Math.round(completedOrders.length / orders.length * 100) : 0,
        totalInspections: inspTotal,
        completedInspections: inspDone,
        abnormalInspections: inspAbnormal,
        inspectionCompleteRate: inspTotal > 0 ? Math.round(inspDone / inspTotal * 100) : 0,
        activePermits: permits.filter(function(p) { return p.status === "approved" || p.status === "active"; }).length,
        pendingHazards: pendingHazardCount,
        lowStockParts: lowStock,
        aiCallCount: 0,
        recentOrders: orders.slice(0, 5).map(function(o) {
          var statusMap = { created: "待派工", dispatched: "待接单", in_progress: "检修中", pending_acceptance: "待验收", completed: "已归档", cancelled: "已取消" };
          var colorMap = { created: "#94A3B8", dispatched: "#3b82f6", in_progress: "#F59E0B", pending_acceptance: "#8B5CF6", completed: "#10b981", cancelled: "#CBD5E1" };
          return Object.assign({}, o, {
            statusText: statusMap[o.status] || o.status,
            statusColor: colorMap[o.status] || "#94A3B8"
          });
        }),
      });
      if (typeof done === "function") done();
    }).catch(function(e) {
      that.setData({ loading: false, loadError: (e && (e.error || e.message)) || "数据加载失败" });
      if (typeof done === "function") done();
    });
  },

  goOrders() { wx.navigateTo({ url: "/pages/orders/list" }); },
  goEquip() { wx.navigateTo({ url: "/pages/equip/list" }); },
  goHazards() { wx.navigateTo({ url: "/pages/hazards/list" }); },
  goHealth() { wx.navigateTo({ url: "/pages/health/health" }); },
  goOrder(e) { wx.navigateTo({ url: "/pages/orders/detail?id=" + e.currentTarget.dataset.id }); },
});