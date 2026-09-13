var { request } = require("../../utils/request.js");

Page({
  data: {
    loading: true,
    loadError: "",
    equipments: [],
    selectedEq: null,
    telemetry: [],
    loadingTelemetry: false,
    trendData: [],
  },

  onLoad() { this.loadEquipments(); },
  onPullDownRefresh() { this.loadEquipments(function() { wx.stopPullDownRefresh(); }); },

  loadEquipments(done) {
    var that = this;
    that.setData({ loading: true, loadError: "" });
    request("/api/v1/equipments").then(function(list) {
      var equips = (list || []).map(function(e) {
        var score = e.healthScore || 0;
        var statusColor = score >= 80 ? "#10b981" : score >= 60 ? "#F59E0B" : "#EF4444";
        var statusText = score >= 80 ? "良好" : score >= 60 ? "注意" : "异常";
        return Object.assign({}, e, { scoreText: score + "分", statusColor: statusColor, statusText: statusText });
      });
      that.setData({ loading: false, equipments: equips });
      if (equips.length > 0) that.selectEquipment({ currentTarget: { dataset: { id: equips[0].id } } });
      if (typeof done === "function") done();
    }).catch(function(e) {
      that.setData({ loading: false, loadError: (e && e.error) || "加载失败" });
      if (typeof done === "function") done();
    });
  },

  selectEquipment(e) {
    var that = this;
    var id = e.currentTarget.dataset.id;
    var eq = that.data.equipments.find(function(x) { return x.id === id; });
    if (!eq) return;
    that.setData({ selectedEq: eq, loadingTelemetry: true });
    request("/api/v1/equipments/" + id + "/telemetry-history").then(function(data) {
      var list = Array.isArray(data) ? data : (data && data.points) || [];
      that.setData({ telemetry: list.slice(0, 20), loadingTelemetry: false });
    }).catch(function() {
      that.setData({ loadingTelemetry: false, telemetry: [] });
    });
  },
});
