// app.js
const { getToken, getUser } = require('./utils/auth.js');

App({
  globalData: {
    token: '',
    userInfo: null
  },
  onLaunch() {
    this.globalData.token = getToken();
    this.globalData.userInfo = getUser();
  }
});
