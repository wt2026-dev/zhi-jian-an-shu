var { request } = require("../../utils/request.js");

Page({
  data: { loading: true, e: null, sText: "", sStyle: "", specEntries: [] },
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
        e: Object.assign({}, e, { maintenanceHistory: e.maintenanceHistory || [], telemetry: e.telemetry || {} }),
      });
    }).catch(function () { that.setData({ loading: false }); });
  },
});