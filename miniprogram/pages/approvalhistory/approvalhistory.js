var { request } = require("../../utils/request.js");
var ui = require("../../utils/ui.js");

Page({
  data: {
    loading: true,
    loadError: "",
    records: []
  },

  onLoad: function () {
    this.loadData();
  },

  loadData: function () {
    var that = this;
    that.setData({ loading: true, loadError: "" });
    var user = wx.getStorageSync("user") || {};
    var userName = user.name || "";
    request("/api/v1/safety-permits").then(function (permits) {
      var records = [];
      (permits || []).forEach(function (p) {
        var nodes = [];
        if (p.guardianApproval && p.guardianApproval.name === userName) {
          nodes.push({
            node: "现场监护初审",
            name: p.guardianApproval.name,
            role: p.guardianApproval.role || "",
            signedAt: p.guardianApproval.signedAt || "",
            comment: p.guardianApproval.comment || "",
            signed: !!p.guardianApproval.signed
          });
        }
        if (p.supervisorApproval && p.supervisorApproval.name === userName) {
          nodes.push({
            node: "主管终审",
            name: p.supervisorApproval.name,
            role: p.supervisorApproval.role || "",
            signedAt: p.supervisorApproval.signedAt || "",
            comment: p.supervisorApproval.comment || "",
            signed: !!p.supervisorApproval.signed
          });
        }
        if (p.status === "closed" && p.closedBy === userName) {
          nodes.push({
            node: "作业闭环",
            name: p.closedBy,
            role: "",
            signedAt: p.closedAt || "",
            comment: p.closeRemark || "",
            signed: true
          });
        }
        nodes.forEach(function (n) {
          records.push({
            id: p.id,
            permitNo: p.permitNo || "",
            title: p.title || "",
            workshop: p.workshop || "",
            node: n.node,
            approver: n.name,
            role: n.role,
            signedAt: n.signedAt,
            comment: n.comment,
            signed: n.signed
          });
        });
      });
      records.sort(function (a, b) {
        return (b.signedAt || "").localeCompare(a.signedAt || "");
      });
      that.setData({ loading: false, records: records });
    }).catch(function (e) {
      that.setData({
        loading: false,
        loadError: (e && (e.error || e.message)) || "加载失败，请确认后端服务已启动"
      });
    });
  },

  goBack: function () { wx.navigateBack({ delta: 1 }); },

  goToDetail: function (e) {
    var id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: "/pages/safety/detail?id=" + id });
  },

  retry: function () { this.loadData(); }
});
