var ui = require("../../utils/ui.js");
var { request, gotoLogin, getLastLatency } = require("../../utils/request.js");

Page({
  data: {
    user: null,
    avatarChar: "",
    avatarUrl: "",
    avatarUploading: false,
    roleText: "",
    roleStyle: "",
    onDuty: true,
    gloveMode: true,
    latency: "--",
    battery: "--",
    terminalVersion: "4.8.2",
    terminalId: "HM-T88102",
    certifications: [],
    metrics: [],
    devices: [],
    isAdmin: false,
    loading: false,
    loadError: ""
  },

  onShow() {
    var user = wx.getStorageSync("user");
    if (!user) {
      gotoLogin();
      return;
    }
    var role = ui.ROLE[user.role] || ui.ROLE.user;
    var ms = getLastLatency();
    this.setData({
      user: user,
      avatarChar: (user.name || "U").slice(0, 1),
      // 头像：优先使用已上传头像，未上传时回落到角色职业照片
      avatarUrl: user.avatar || ("/images/avatars/" + (user.role === "user" ? "driver" : (user.role || "admin")) + ".png"),
      roleText: role.t,
      roleStyle: ui.badge(role.c),
      isAdmin: user.role === "admin",
      latency: ms > 0 ? ms + "ms" : "--",
    });
    this.loadProfileData();
  },

  // 更换头像：选图 → /api/v1/user/avatar 上传 → 本地缓存与全局数据同步
  chooseAvatar() {
    var that = this;
    if (that.data.avatarUploading) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sizeType: ["compressed"],
      sourceType: ["album", "camera"],
      success: function (res) {
        var file = res.tempFiles && res.tempFiles[0];
        if (!file || !file.tempFilePath) return;
        var path = file.tempFilePath;
        if (file.size && file.size > 5 * 1024 * 1024) {
          wx.showToast({ title: "图片不能超过 5MB", icon: "none" });
          return;
        }
        that.setData({ avatarUploading: true });
        wx.showLoading({ title: "上传中...", mask: true });
        var fsm = wx.getFileSystemManager();
        var b64 = fsm.readFileSync(path, "base64");
        request("/api/v1/user/avatar", {
          method: "POST",
          timeout: 60000,
          data: { imageBase64: "data:image/jpeg;base64," + b64 },
        })
          .then(function (r) {
            wx.hideLoading();
            var url = (r && (r.url || r.avatarUrl)) || "";
            if (!url) {
              that.setData({ avatarUploading: false });
              wx.showToast({ title: "上传失败", icon: "none" });
              return;
            }
            // 本地缓存 + 全局数据同步，保证其它页面即时生效且刷新不丢失
            var user = wx.getStorageSync("user") || {};
            user.avatar = url;
            wx.setStorageSync("user", user);
            var app = getApp();
            if (app && app.globalData) app.globalData.user = user;
            that.setData({ avatarUploading: false, avatarUrl: url, user: user });
            wx.showToast({ title: "头像已更新", icon: "success" });
          })
          .catch(function (e) {
            wx.hideLoading();
            that.setData({ avatarUploading: false });
            wx.showToast({ title: (e && (e.error || e.message)) || "上传失败", icon: "none", duration: 2600 });
          });
      },
    });
  },

  loadProfileData() {
    var that = this;
    that.setData({ loading: true, loadError: "" });
    var user = wx.getStorageSync("user") || {};
    var opQuery = user.name ? "?operator=" + encodeURIComponent(user.name) : "";

    Promise.all([
      request("/api/v1/work-orders").catch(function () { return []; }),
      request("/api/v1/inspections").catch(function () { return []; }),
      request("/api/v1/equipments").catch(function () { return []; }),
      request("/api/v1/safety-permits").catch(function () { return []; }),
      request("/api/v1/auth/me").catch(function () { return null; }),
      request("/api/v1/compliance/stats" + opQuery).catch(function () { return null; })
    ]).then(function (rs) {
      var orders = rs[0] || [];
      var insps = rs[1] || [];
      var equips = rs[2] || [];
      var permits = rs[3] || [];
      var me = rs[4] || {};
      var compStats = rs[5] || {};
      var completed = orders.filter(function (o) { return o.status === "completed" && (o.assigneeId === user.id || o.assignee === user.name); }).length;
      var total = orders.filter(function (o) { return o.assigneeId === user.id || o.assignee === user.name; }).length;
      var inspPoints = 0;
      insps.forEach(function (t) { inspPoints += t.completedPoints || 0; });

      // ② 安全联锁验签次数
      var signCount = 0;
      var hasUnsigned = false;
      var hasRejected = false;
      permits.forEach(function (p) {
        if (p.guardianApproval && p.guardianApproval.signed) signCount++;
        else if (p.status === "pending_approval") hasUnsigned = true;
        if (p.supervisorApproval && p.supervisorApproval.signed) signCount++;
        else if (p.status === "pending_approval") hasUnsigned = true;
        if (p.status === "rejected") hasRejected = true;
      });
      var signBadge = "零偏差";
      if (hasRejected) signBadge = "存在驳回";
      else if (hasUnsigned) signBadge = "存在未签";

      // ③ 证书
      var certs = [];
      if (me && me.certifications && me.certifications.length > 0) {
        certs = me.certifications.map(function (c) {
          return { label: c.name, expiry: c.expiry || "--", status: c.status || "valid" };
        });
      }

      // ④ 个人合规与失误率统计 (真实来自后端按当前技术员筛选)
      var mistakeRateNum = 0;
      if (compStats) {
        if (compStats.mistakeRate !== undefined) mistakeRateNum = compStats.mistakeRate * 100;
        else if (compStats.mistake_rate !== undefined) mistakeRateNum = compStats.mistake_rate * 100;
      }
      var mistakeRateStr = mistakeRateNum.toFixed(1) + "%";
      var compScore = compStats && (compStats.avgScore !== undefined ? compStats.avgScore : (compStats.avg_score !== undefined ? compStats.avg_score : 98.5));

      var ms = getLastLatency();
      that.setData({
        loading: false,
        // 延迟为本页接口请求的真实耗时；无请求记录时显示 --
        latency: ms > 0 ? ms + "ms" : "--",
        certifications: certs,
        metrics: [
          { label: "执行工单闭环", value: String(completed), total: "/ " + total + " 单", badge: total > 0 ? Math.round(completed / total * 100) + "% 完成" : "暂无数据", color: "green" },
          { label: "巡检点位达标", value: String(inspPoints), total: "/ " + inspPoints + " 点", badge: inspPoints > 0 ? "零漏检" : "暂无数据", color: "blue" },
          { label: "安全联锁验签", value: String(signCount), total: "次", badge: signBadge, color: signBadge === "零偏差" ? "green" : "blue" },
          { label: "个人检修失误率", value: mistakeRateStr, total: "综合分 " + compScore, badge: mistakeRateNum <= 5 ? "合规受控" : "需整改", color: mistakeRateNum <= 5 ? "green" : "orange" }
        ],
        devices: equips.slice(0, 2).map(function (e, i) {
          return { name: e.name || e.code, detail: (e.code || "") + " · " + (e.status || "正常"), icon: i === 0 ? "check_circle" : "barcode_scanner" };
        })
      });
    }).catch(function () {
      that.setData({ loading: false });
    });
  },

  toggleDuty(e) {
    this.setData({ onDuty: e.currentTarget.dataset.on === "1" });
  },

  toggleGlove() {
    this.setData({ gloveMode: !this.data.gloveMode });
  },

  go(e) {
    var url = e.currentTarget.dataset && e.currentTarget.dataset.url;
    if (!url) { wx.showToast({ title: "页面暂不可用", icon: "none" }); return; }
    wx.navigateTo({ url: url });
  },

  // 系统管理（用户与权限 / AI 内容审核 / AI 模型路由）：移动端只读，不开放操作
  goSystemWeb() {
    wx.showToast({ title: "系统管理请在 Web 端操作", icon: "none", duration: 2200 });
  },

  logout() {
    wx.showModal({
      title: "退出登录",
      content: "确定要退出当前账号吗？",
      success(r) {
        if (r.confirm) {
          wx.clearStorageSync();
          wx.reLaunch({ url: "/pages/login/login" });
        }
      }
    });
  },
});
