var { request } = require("../../utils/request.js");
var ui = require("../../utils/ui.js");

Page({
  data: { loading: true, p: null, sText: "", sStyle: "", precautions: [],
          canApprove: false, step: "guardian", comment: "", canClose: false, closeRemark: "" },
  onLoad(query) { this.id = query.id; this.user = wx.getStorageSync("user") || {}; this.load(); },
  load() {
    var that = this;
    that.setData({ loading: true });
    request("/api/v1/safety-permits/" + that.id).then(function (p) {
      var s = ui.PERMIT_STATUS[p.status] || { t: p.status, c: "#737373" };
      var role = that.user.role || "";
      var step = p.guardianApproval && p.guardianApproval.signed ? "supervisor" : "guardian";
      var canApprove = p.status === "pending_approval" && ["inspector", "admin", "manager"].indexOf(role) >= 0;
      that.setData({
        loading: false, p: p, sText: s.t, sStyle: ui.badge(s.c),
        precautions: Array.isArray(p.precautions) ? p.precautions : [p.precautions],
        canApprove: canApprove, step: step,
        canClose: (p.status === "approved" || p.status === "active") && ["admin", "manager", "inspector"].indexOf(role) >= 0,
      });
    }).catch(function () { that.setData({ loading: false }); });
  },
  onComment(e) { this.setData({ comment: e.detail.value }); },
  onCloseRemark(e) { this.setData({ closeRemark: e.detail.value }); },
  doApprove(e) {
    var pass = e.currentTarget.dataset.pass === "true";
    var that = this;
    request("/api/v1/safety-permits/" + this.id + "/approve", {
      method: "POST", timeout: 60000,
      data: { step: this.data.step, pass: pass, comment: this.data.comment || (pass ? "现场安全条件核验合格" : "安全条件不达标") },
    }).then(function () { wx.showToast({ title: pass ? "签署通过" : "已驳回", icon: "success" }); that.load(); })
      .catch(function () {});
  },
  doClose() {
    var that = this;
    request("/api/v1/safety-permits/" + this.id + "/close", { method: "POST", data: { closeRemark: this.data.closeRemark || "作业完毕，工完料净场地清" } })
      .then(function () { wx.showToast({ title: "已关闭", icon: "success" }); that.load(); })
      .catch(function () {});
  },
});
