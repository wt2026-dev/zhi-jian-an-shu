var { request } = require("../../utils/request.js");
// 演示环境快捷登录口令（仅本地开发用，上线前请移除 fill 方法与 DEMO_PASSWORD）
var DEMO_PASSWORD = "password123";
var app = getApp();

Page({
  data: { username: "", password: "", loading: false, wxLoading: false, errorMsg: "" },

  onLoad() {
    if (wx.getStorageSync("token")) wx.reLaunch({ url: "/pages/dashboard/dashboard" });
  },

  onUser(e) { this.setData({ username: e.detail.value, errorMsg: "" }); },
  onPwd(e) { this.setData({ password: e.detail.value, errorMsg: "" }); },

  // 快捷登录（演示环境）：点击账号芯片自动填充，上线前请删除
  fill(e) {
    this.setData({ username: e.currentTarget.dataset.u, password: DEMO_PASSWORD, errorMsg: "" });
  },

  // 登录成功后统一保存登录态并进入首页
  saveAndGo(res) {
    if (!res || !res.token) {
      this.setData({ loading: false, wxLoading: false, errorMsg: "登录失败：后端未返回 token" });
      return;
    }
    wx.setStorageSync("token", res.token);
    wx.setStorageSync("user", res.user || {});
    if (app) app.globalData.user = res.user || {};
    wx.reLaunch({ url: "/pages/dashboard/dashboard" });
  },

  // 微信一键登录：wx.login 取 code → 后端 code2session 换 openid → 绑定工号账号签发 JWT
  wxLogin() {
    var that = this;
    if (that.data.wxLoading || that.data.loading) return;
    that.setData({ wxLoading: true, errorMsg: "" });

    wx.login({
      timeout: 10000,
      success: function (lr) {
        if (!lr.code) {
          that.setData({ wxLoading: false, errorMsg: "wx.login 获取 code 失败，请重试" });
          return;
        }
        request("/api/v1/auth/wx-login", {
          method: "POST",
          timeout: 30000,
          data: { code: lr.code },
        })
          .then(function (res) {
            if (res && res.devMode) {
              // 后端未配置 WECHAT_APP_ID/WECHAT_APP_SECRET：开发态降级，提示使用者
              wx.showToast({ title: "开发态降级登录", icon: "none" });
            }
            that.saveAndGo(res);
          })
          .catch(function (e) {
            that.setData({
              wxLoading: false,
              errorMsg: (e && (e.error || e.message)) || "微信登录失败",
            });
          });
      },
      fail: function () {
        that.setData({ wxLoading: false, errorMsg: "wx.login 调用失败，请检查网络" });
      },
    });
  },

  // 账号密码登录（Web 端同源接口）
  doLogin() {
    var u = this.data.username.trim(), p = this.data.password.trim();
    if (!u || !p || this.data.loading) return;
    this.setData({ loading: true, errorMsg: "" });
    var that = this;
    request("/api/v1/auth/login", { method: "POST", data: { username: u, password: p } })
      .then(function (res) { that.saveAndGo(res); })
      .catch(function (e) {
        var msg = (e && (e.error || e.message)) || "登录失败，请确认后端服务已启动";
        that.setData({ loading: false, errorMsg: msg });
      });
  },
});
