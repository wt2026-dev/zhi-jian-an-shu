// 登录态读写与小程序的统一跳转入口
const TOKEN_KEY = 'token';
const USER_KEY = 'user';

let redirecting = false;

function getToken() {
  return wx.getStorageSync(TOKEN_KEY) || '';
}

function getUser() {
  return wx.getStorageSync(USER_KEY) || null;
}

function saveSession(token, user) {
  if (token) wx.setStorageSync(TOKEN_KEY, token);
  if (user) wx.setStorageSync(USER_KEY, user);
  const app = getApp();
  if (app && app.globalData) {
    app.globalData.token = token || '';
    app.globalData.userInfo = user || null;
  }
}

function clearSession() {
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync(USER_KEY);
  const app = getApp();
  if (app && app.globalData) {
    app.globalData.token = '';
    app.globalData.userInfo = null;
  }
}

function redirectToLogin() {
  if (redirecting) return;
  redirecting = true;
  wx.reLaunch({
    url: '/pages/login/index',
    complete() {
      setTimeout(() => {
        redirecting = false;
      }, 800);
    }
  });
}

function ensureLogin() {
  if (getToken()) return true;
  redirectToLogin();
  return false;
}

function isRole() {
  const user = getUser() || {};
  const roles = Array.prototype.slice.call(arguments);
  return roles.indexOf(user.role) >= 0;
}

module.exports = {
  TOKEN_KEY,
  USER_KEY,
  getToken,
  getUser,
  saveSession,
  clearSession,
  redirectToLogin,
  ensureLogin,
  isRole
};
