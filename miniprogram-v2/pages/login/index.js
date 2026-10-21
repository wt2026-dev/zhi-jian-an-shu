// pages/login/index.js
const { api } = require('../../utils/request.js');
const { saveSession, getToken } = require('../../utils/auth.js');

// 与 src/db/seed.ts 的演示账号一致；仅用于开发者工具快速填充，可手动改写
const DEMO_ACCOUNTS = [
  { username: 'admin', label: '总工 / 机电部长', password: 'Admin@2026#Demo' },
  { username: 'manager', label: '车间安全总监 / 维保主管', password: 'Manager@2026#Safe' },
  { username: 'tech1', label: '机电检修高级技师', password: 'Tech1@2026#Work' },
  { username: 'inspector', label: '点检工程师 / 安全监护', password: 'Inspect@2026#Check' },
  { username: 'operator', label: '现场操作工', password: 'Operator@2026#Line' }
];

Page({
  data: {
    username: '',
    password: '',
    loading: false,
    wxLoading: false,
    errorMsg: '',
    demoAccounts: DEMO_ACCOUNTS
  },

  onLoad() {
    if (getToken()) {
      wx.switchTab({ url: '/pages/workbench/index' });
    }
  },

  handleUserInput(e) {
    this.setData({ username: e.detail.value, errorMsg: '' });
  },

  handlePasswordInput(e) {
    this.setData({ password: e.detail.value, errorMsg: '' });
  },

  handleSelectDemo(e) {
    const username = e.currentTarget.dataset.username;
    const account = DEMO_ACCOUNTS.filter((item) => item.username === username)[0];
    if (!account) return;
    this.setData({
      username: account.username,
      password: account.password,
      errorMsg: ''
    });
  },

  async handleLogin() {
    const username = (this.data.username || '').trim();
    const password = this.data.password || '';
    if (!username || !password) {
      this.setData({ errorMsg: '请输入登录账号与密码' });
      return;
    }
    if (this.data.loading) return;

    this.setData({ loading: true, errorMsg: '' });
    try {
      const res = await api.login({ username, password });
      if (!res || !res.token) {
        this.setData({ loading: false, errorMsg: '登录失败：后端未返回 token' });
        return;
      }
      saveSession(res.token, res.user || { username });
      wx.switchTab({ url: '/pages/workbench/index' });
    } catch (err) {
      this.setData({
        loading: false,
        errorMsg: (err && err.message) || '登录失败，请确认后端服务已启动'
      });
    }
  },

  handleWxLogin() {
    if (this.data.wxLoading || this.data.loading) return;
    this.setData({ wxLoading: true, errorMsg: '' });
    wx.login({
      timeout: 10000,
      success: (loginRes) => {
        if (!loginRes.code) {
          this.setData({ wxLoading: false, errorMsg: 'wx.login 未返回 code' });
          return;
        }
        api
          .wxLogin(loginRes.code)
          .then((res) => {
            if (!res || !res.token) {
              this.setData({ wxLoading: false, errorMsg: '微信登录失败：后端未返回 token' });
              return;
            }
            saveSession(res.token, res.user || {});
            if (res.devMode) {
              wx.showToast({ title: '开发态降级登录', icon: 'none' });
            }
            wx.switchTab({ url: '/pages/workbench/index' });
          })
          .catch((err) => {
            this.setData({
              wxLoading: false,
              errorMsg: (err && err.message) || '微信登录失败，请确认后端已配置微信凭证'
            });
          });
      },
      fail() {
        this.setData({ wxLoading: false, errorMsg: 'wx.login 调用失败，请检查网络' });
      }
    });
  }
});
