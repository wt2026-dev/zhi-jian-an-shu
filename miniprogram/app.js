App({
  globalData: { user: null },
  onLaunch() {
    const user = wx.getStorageSync("user");
    if (user) this.globalData.user = user;
  }
});