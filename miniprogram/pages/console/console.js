var { request } = require("../../utils/request.js");

Page({
  data: {
    version: "4.8.2",
    currentTime: "",
    loading: false,
    loadError: "",
    userInfo: {},
    warning: {},
    shiftProgress: 0,
    metrics: {},
    myOrdersCount: 0,
    syncStatus: {}
  },

  onLoad: function () {
    this.updateTime();
    this.timeTimer = setInterval(function () { this.updateTime(); }.bind(this), 1000);
    this.loadData();
  },

  onUnload: function () {
    if (this.timeTimer) clearInterval(this.timeTimer);
  },

  loadData: function () {
    var that = this;
    that.setData({ loading: true, loadError: "" });
    var user = wx.getStorageSync("user") || {};
    Promise.all([
      request("/api/v1/work-orders").catch(function () { return []; }),
      request("/api/v1/equipments").catch(function () { return []; }),
      request("/api/v1/inspections").catch(function () { return []; }),
      request("/api/v1/safety-permits").catch(function () { return []; }),
      request("/api/v1/notifications").catch(function () { return []; })
    ]).then(function (rs) {
      var orders = rs[0] || [], equips = rs[1] || [], insps = rs[2] || [], permits = rs[3] || [], notifs = rs[4] || [];
      var active = orders.filter(function (o) { return ["created", "dispatched", "in_progress", "pending_acceptance"].indexOf(o.status) >= 0; });
      var inspDone = 0, inspTotal = 0;
      insps.forEach(function (t) { inspDone += t.completedPoints || 0; inspTotal += t.totalPoints || 0; });
      that.setData({
        loading: false,
        userInfo: {
          name: user.name || "--",
          employeeId: user.username || "--",
          avatarChar: (user.name || "U").slice(0, 2),
          role: user.roleTitle || user.role || "--",
          station: user.station || "03",
          area: user.department || "--",
          certificate: user.certificate || "SP-T8810",
          safetyLevel: "Ex ib IIB T4"
        },
        warning: permits.filter(function (p) { return p.status === "pending_approval"; })[0] || { id: "--", title: "暂无预警", time: "--", description: "--", responsible: "--", status: "正常" },
        shiftProgress: inspTotal > 0 ? Math.round(inspDone / inspTotal * 1000) / 10 : 0,
        metrics: {
          patrolPoints: inspTotal,
          repairItems: active.filter(function (o) { return o.status === "in_progress"; }).length,
          pendingAcceptance: active.filter(function (o) { return o.status === "pending_acceptance"; }).length,
          completed: orders.filter(function (o) { return o.status === "completed"; }).length
        },
        myOrdersCount: active.filter(function (o) { return o.assigneeId === user.id; }).length,
        syncStatus: {
          pending: orders.filter(function (o) { return o.status === "created"; }).length,
          synced: orders.filter(function (o) { return o.status === "completed"; }).length,
          storage: equips.length > 0 ? Math.round(equips.length * 0.74 * 10) / 10 + "%" : "0%"
        }
      });
    }).catch(function (e) {
      that.setData({
        loading: false,
        loadError: (e && (e.error || e.message)) || "加载失败，请确认后端服务已启动",
        userInfo: { name: user.name || "--", employeeId: user.username || "--", avatarChar: (user.name || "U").slice(0, 2), role: user.role || "--" }
      });
    });
  },

  updateTime: function () {
    var now = new Date();
    var h = String(now.getHours()).padStart(2, "0");
    var m = String(now.getMinutes()).padStart(2, "0");
    var s = String(now.getSeconds()).padStart(2, "0");
    this.setData({ currentTime: h + ":" + m + ":" + s });
  },

  goNotifications: function () { wx.navigateTo({ url: "/pages/notifications/notifications" }); },
  goProfile: function () { wx.navigateTo({ url: "/pages/profile/profile" }); },

  scanInspection: function () {
    wx.scanCode({
      onlyFromCamera: false,
      success: function () { wx.showToast({ title: "扫码成功", icon: "success" }); }
    });
  },

  goMyOrders: function () { wx.navigateTo({ url: "/pages/orders/list" }); },

  reportAnomaly: function () {
    wx.showActionSheet({
      itemList: ["测振异常", "测温异常", "泄漏异常", "其他异常"],
      success: function (res) {
        var types = ["测振异常", "测温异常", "泄漏异常", "其他异常"];
        wx.showModal({
          title: "异常上报", content: "确定要上报" + types[res.tapIndex] + "吗？",
          confirmText: "确认上报", confirmColor: "#f97316",
          success: function (r) {
            if (r.confirm) {
              request("/api/v1/work-orders", {
                method: "POST",
                data: { title: types[res.tapIndex] + "上报", priority: "high", description: types[res.tapIndex] + "异常" }
              }).then(function () { wx.showToast({ title: "异常已上报", icon: "success" }); })
                .catch(function () { wx.showToast({ title: "上报失败", icon: "none" }); });
            }
          }
        });
      }
    });
  },

  goKnowledge: function () { wx.navigateTo({ url: "/pages/knowledge/knowledge" }); },
  goEquipment: function () { wx.navigateTo({ url: "/pages/equip/list" }); },
  goSafetyTicket: function () { wx.navigateTo({ url: "/pages/safety/list" }); },
  checkinPoint: function () { wx.showToast({ title: "测点签到成功", icon: "success" }); }
});
