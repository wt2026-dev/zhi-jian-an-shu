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
        var isScored = typeof e.healthScore === "number";
        var score = isScored ? e.healthScore : null;
        var statusColor = !isScored ? "#94A3B8" : score >= 80 ? "#10B981" : score >= 60 ? "#F59E0B" : "#EF4444";
        var statusText = !isScored ? "未评估" : score >= 80 ? "良好" : score >= 60 ? "注意" : "异常";
        var scoreText = isScored ? score + "分" : "未评估";
        return Object.assign({}, e, {
          isScored: isScored,
          scoreText: scoreText,
          statusColor: statusColor,
          statusText: statusText
        });
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
