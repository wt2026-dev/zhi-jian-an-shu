var { request } = require("../../utils/request.js");

Page({
  data: {
    loading: true,
    statusTab: "all",
    allHazards: [],
    hazards: [],
    majorCount: 0,
    pendingCount: 0,
    totalCount: 0,
  },

  onShow() {
    this.loadHazards();
  },

  onPullDownRefresh() {
    this.loadHazards(function () {
      wx.stopPullDownRefresh();
    });
  },

  setTab(e) {
    var tab = e.currentTarget.dataset.tab;
    this.setData({ statusTab: tab });
    this.filterHazards();
  },

  loadHazards(done) {
    var that = this;
    that.setData({ loading: true });
    request("/api/v1/hazards")
      .then(function (res) {
        var list = Array.isArray(res) ? res : (res && res.data) || [];
        var majorCount = list.filter(function (h) { return h.level === "major" && h.status !== "closed"; }).length;
        var pendingCount = list.filter(function (h) { return h.status === "pending"; }).length;

        that.setData({
          loading: false,
          allHazards: list,
          majorCount: majorCount,
          pendingCount: pendingCount,
          totalCount: list.length,
        });
        that.filterHazards();
        if (typeof done === "function") done();
      })
      .catch(function (err) {
        console.warn("Load hazards error:", err);
        that.setData({ loading: false });
        if (typeof done === "function") done();
      });
  },

  filterHazards() {
    var tab = this.data.statusTab;
    var list = this.data.allHazards;
    var filtered = list;
    if (tab !== "all") {
      filtered = list.filter(function (h) { return h.status === tab; });
    }

    // 重大隐患置顶
    filtered.sort(function (a, b) {
      if (a.level === "major" && b.level !== "major") return -1;
      if (a.level !== "major" && b.level === "major") return 1;
      return 0;
    });

    var mapped = filtered.map(function (h) {
      var sText = "待整改", sClass = "badge-pending";
      if (h.status === "rectifying") { sText = "整改中"; sClass = "badge-rectifying"; }
      else if (h.status === "verifying") { sText = "待复核"; sClass = "badge-verifying"; }
      else if (h.status === "closed") { sText = "已销号"; sClass = "badge-closed"; }
      return Object.assign({}, h, { statusText: sText, statusBadgeClass: sClass });
    });

    this.setData({ hazards: mapped });
  },

  goCreate() {
    wx.navigateTo({ url: "/pages/hazards/create" });
  },

  quickAssign(e) {
    var id = e.currentTarget.dataset.id;
    var title = e.currentTarget.dataset.title;
    var that = this;
    wx.showModal({
      title: "下发整改工单",
      content: "确认针对「" + title + "」一键下发抢修工单并指派主修技师？",
      success: function (r) {
        if (r.confirm) {
          wx.showLoading({ title: "下发中..." });
          request("/api/v1/hazards/" + id + "/assign", {
            method: "POST",
            data: { deadline: "2026-03-12", dispatch_note: "小程序移动端一键下发紧急整改" }
          }).then(function () {
            wx.hideLoading();
            wx.showToast({ title: "工单已下发并派工", icon: "success" });
            that.loadHazards();
          }).catch(function (e) {
            wx.hideLoading();
            wx.showToast({ title: (e && e.message) || "下发失败", icon: "none" });
          });
        }
      }
    });
  },

  quickClose(e) {
    var id = e.currentTarget.dataset.id;
    var that = this;
    var user = wx.getStorageSync("user") || {};
    wx.showModal({
      title: "隐患复核销号",
      content: "确认现场消缺已合格，准予闭环销号？",
      success: function (r) {
        if (r.confirm) {
          wx.showLoading({ title: "销号中..." });
          request("/api/v1/hazards/" + id + "/verify", {
            method: "POST",
            data: { verifier: user.name || "移动端技术员", comment: "移动端现场检查合格，符合闭环销号标准", passed: true }
          }).then(function () {
            wx.hideLoading();
            wx.showToast({ title: "已成功复核闭环", icon: "success" });
            that.loadHazards();
          }).catch(function (e) {
            wx.hideLoading();
            wx.showToast({ title: (e && e.message) || "销号失败", icon: "none" });
          });
        }
      }
    });
  }
});
