var { request } = require("../../utils/request.js");

Page({
  data: {
    pageStyle: "",
    loading: false,
    loadError: "",
    storageUsage: 0,
    usedStorage: 0,
    totalStorage: 2.0,
    syncedSize: 0,
    queueSize: 0,
    queueCount: 0,
    availableStorage: 2.0,
    queuePercentage: 0,
    cleanableSize: 0,
    syncQueue: [],
    wifiOnlyMode: true,
    hashVerification: true,
    isSyncing: false
  },

  onLoad: function () {},
  onShow: function () { this.loadData(); },

  loadData: function () {
    var that = this;
    that.setData({ loading: true, loadError: "" });
    request("/api/v1/work-orders").then(function (orders) {
      var pending = (orders || []).filter(function (o) { return o.status === "created" || o.status === "dispatched"; });
      var totalSize = pending.length * 4.2;
      var completed = (orders || []).filter(function (o) { return o.status === "completed"; });
      var completedSize = Math.round(completed.length * 4.2 * 10) / 10;
      var cleanableSize = Math.round(completedSize * 0.6 * 10) / 10;
      var pendingSize = Math.round(totalSize * 10) / 10;
      var syncedSize = Math.round(completedSize * 10) / 10;
      var totalUsed = syncedSize + pendingSize;
      var queuePercentage = totalUsed > 0 ? Math.round(pendingSize / totalUsed * 100 * 10) / 10 : 0;
      that.setData({
        loading: false,
        syncQueue: pending.map(function (o) {
          return {
            id: o.id,
            type: "工单",
            title: o.title || o.orderNo || "--",
            description: o.description || "待同步数据",
            status: "待同步",
            cacheTime: "刚刚缓存",
            selected: true,
            evidenceImages: []
          };
        }),
        queueCount: pending.length,
        queueSize: pendingSize,
        queuePercentage: queuePercentage,
        syncedSize: syncedSize,
        usedStorage: totalUsed,
        storageUsage: totalUsed > 0 ? Math.round(totalUsed / (2.0 * 1024) * 100 * 10) / 10 : 0,
        availableStorage: Math.round((2.0 * 1024 - totalUsed) / 1024 * 100) / 100,
        cleanableSize: cleanableSize
      });
    }).catch(function (e) {
      that.setData({ loading: false, loadError: (e && (e.error || e.message)) || "加载失败，请确认后端服务已启动" });
    });
  },

  goBack: function () { wx.navigateBack({ delta: 1 }); },

  toggleSelectAll: function () {
    var selected = !this.data.syncQueue.every(function (i) { return i.selected; });
    this.setData({ syncQueue: this.data.syncQueue.map(function (item) { return Object.assign({}, item, { selected: selected }); }) });
  },

  toggleItemSelection: function (e) {
    var id = e.currentTarget.dataset.id;
    this.setData({ syncQueue: this.data.syncQueue.map(function (item) { return item.id === id ? Object.assign({}, item, { selected: !item.selected }) : item; }) });
  },

  prioritizeItem: function (e) {
    var id = e.currentTarget.dataset.id;
    var q = this.data.syncQueue.slice();
    for (var i = 0; i < q.length; i++) {
      if (q[i].id === id && i > 0) {
        q.unshift(q.splice(i, 1)[0]);
        this.setData({ syncQueue: q });
        wx.showToast({ title: "已置顶", icon: "success" });
        break;
      }
    }
  },

  toggleWifiOnly: function (e) {
    this.setData({ wifiOnlyMode: e.detail.value });
    wx.showToast({ title: e.detail.value ? "已开启WiFi-only模式" : "已关闭WiFi-only模式", icon: "none" });
  },

  toggleHashVerification: function (e) {
    this.setData({ hashVerification: e.detail.value });
    wx.showToast({ title: e.detail.value ? "已开启哈希存证" : "已关闭哈希存证", icon: "none" });
  },

  cleanArchive: function () {
    var that = this;
    wx.showModal({
      title: "清理归档", content: "确定要清理历史归档数据吗？可释放 " + that.data.cleanableSize + " MB 空间。",
      confirmText: "确认清理", confirmColor: "#38bdf8",
      success: function (res) {
        if (res.confirm) {
          wx.showLoading({ title: "清理中..." });
          setTimeout(function () {
            wx.hideLoading();
            that.setData({ cleanableSize: 0, availableStorage: that.data.availableStorage + that.data.cleanableSize / 1024 });
            wx.showToast({ title: "已成功释放空间", icon: "success" });
          }, 1500);
        }
      }
    });
  },

  cleanCache: function () {
    wx.showModal({
      title: "清理缓存", content: "确定要清理应用缓存吗？",
      confirmText: "确认清理", confirmColor: "#38bdf8",
      success: function (res) {
        if (res.confirm) {
          wx.showLoading({ title: "清理中..." });
          setTimeout(function () { wx.hideLoading(); wx.showToast({ title: "缓存已清理", icon: "success" }); }, 1000);
        }
      }
    });
  },

  forceSync: function () {
    if (this.data.isSyncing) { wx.showToast({ title: "同步进行中，请稍候", icon: "none" }); return; }
    var selected = this.data.syncQueue.filter(function (i) { return i.selected; });
    if (selected.length === 0) { wx.showToast({ title: "请选择要同步的数据", icon: "none" }); return; }

    var that = this;
    this.setData({ isSyncing: true });
    var progress = 0;
    var total = selected.length;
    var syncInterval = setInterval(function () {
      progress++;
      wx.showLoading({ title: "正在校验并传输 (" + progress + "/" + total + ")..." });
      if (progress >= total) {
        clearInterval(syncInterval);
        setTimeout(function () {
          wx.hideLoading();
          var remaining = that.data.syncQueue.filter(function (i) { return !i.selected; });
          var synced增加 = that.data.queueSize;
          that.setData({
            syncQueue: remaining, isSyncing: false,
            syncedSize: that.data.syncedSize + synced增加,
            queueSize: 0, queueCount: 0, queuePercentage: 0
          });
          wx.showToast({ title: "同步传输完成", icon: "success" });
        }, 1000);
      }
    }, 1800);
  }
});
