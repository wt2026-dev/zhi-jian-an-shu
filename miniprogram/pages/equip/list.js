var { request } = require("../../utils/request.js");

function statusOf(e) {
  var m = { running: ["运行中", "#34D399"], warning: ["预警关注", "#FBBF24"], fault: ["故障待修", "#FB7185"], overhauling: ["检修中", "#60A5FA"], standby: ["停机备用", "#525252"], scrapped: ["报废", "#475569"] };
  return m[e.status] || [e.status, "#737373"];
}
function hColor(s) { return s >= 80 ? "#34D399" : s >= 60 ? "#FBBF24" : "#FB7185"; }

Page({
  data: { list: [], view: [], kw: "", loading: true },
  onLoad() { this.reload(); },
  reload() {
    var that = this;
    request("/api/v1/equipments").then(function (list) {
      var view = (list || []).map(function (e) {
        var st = statusOf(e);
        return Object.assign({}, e, { sText: st[0], sStyle: ui_badge(st[1]), hColor: hColor(e.healthScore) });
      });
      that.setData({ list: view, view: view, loading: false });
    }).catch(function () { that.setData({ loading: false }); });
  },
  onKw(e) {
    var kw = e.detail.value.toLowerCase();
    var view = this.data.list.filter(function (e) {
      return (e.name || "").toLowerCase().indexOf(kw) >= 0 || (e.code || "").toLowerCase().indexOf(kw) >= 0;
    });
    this.setData({ kw: kw, view: view });
  },
  goDetail(e) { wx.navigateTo({ url: "/pages/equip/detail?id=" + e.currentTarget.dataset.id }); },
});
function ui_badge(c) { return "color:" + c + ";background:" + c + "26;border:1rpx solid " + c + "88;"; }