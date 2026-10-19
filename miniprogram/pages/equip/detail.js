var { request } = require("../../utils/request.js");

// 健康分口径：可空 number|null，未评估中性灰「未评估」，禁止 || 0 / 显示 0 分
function hColor(s) {
  if (typeof s !== "number") return "#94A3B8";
  return s >= 80 ? "#10B981" : s >= 60 ? "#F59E0B" : "#EF4444";
}
function hText(s) {
  if (typeof s !== "number") return "未评估";
  return s + "分";
}

Page({
  data: { loading: true, e: null, sText: "", sStyle: "", specEntries: [], hText: "未评估", hColor: "#94A3B8" },
  onLoad(query) {
    var that = this;
    request("/api/v1/equipments/" + query.id).then(function (e) {
      var m = { running: ["运行中", "#34D399"], warning: ["预警关注", "#FBBF24"], fault: ["故障待修", "#FB7185"], overhauling: ["检修中", "#60A5FA"], standby: ["停机备用", "#525252"] };
      var st = m[e.status] || [e.status, "#737373"];
      var specs = [];
      var sp = e.specs || {};
      for (var k in sp) specs.push({ k: k, v: sp[k] });
      that.setData({
        loading: false, sText: st[0],
        sStyle: "color:" + st[1] + ";background:" + st[1] + "26;border:1rpx solid " + st[1] + "88;",
        specEntries: specs,
        hText: hText(e.healthScore),
        hColor: hColor(e.healthScore),
        e: Object.assign({}, e, { maintenanceHistory: e.maintenanceHistory || [], telemetry: e.telemetry || {} }),
      });
    }).catch(function () { that.setData({ loading: false }); });
  },
});