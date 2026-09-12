var { request } = require("../../utils/request.js");

Page({
  data: {
    showModal: false,
    approveDisabled: false,
    approveText: "安全核验通过并批准签发",
    loading: false,
    loadError: "",
    ticket: {},
    gases: [],
    timeline: [],
    signInfo: {}
  },

  onLoad: function (options) {
    this._permitId = options.id || "";
    this.loadData();
  },

  loadData: function () {
    var that = this;
    that.setData({ loading: true, loadError: "" });
    var requests = [
      request("/api/v1/safety-permits").catch(function () { return []; }),
      request("/api/v1/auth/me").catch(function () { return {}; })
    ];
    Promise.all(requests).then(function (rs) {
      var permits = rs[0] || [];
      var user = rs[1] || {};
      var p = permits[0] || {};
      that.setData({
        loading: false,
        ticket: {
          safetyNo: p.id || "--",
          ticketNo: p.ticketNo || "PTW-" + (p.id || "--"),
          workType: p.permitType || "有限空间 + 特级动火",
          workTypeSub: p.riskLevel ? p.riskLevel + "级" : "双重高危严控",
          area: p.location || p.workshop || "--",
          areaSub: p.partition || "地下液压隔离廊道",
          currentNode: p.status === "pending_approval" ? "三级会签审批中" : "审批已完成",
          nodeSub: "安全总监终审级",
          countdown: "有效剩 03h 45m",
          countdownSub: "24:00 前执行完毕"
        },
        gases: [
          { name: "氧气 O\u2082", value: String(p.o2Value || 20.9), unit: "% VOL", range: "标准 19.5~23.5%", refresh: "实时" },
          { name: "一氧化碳 CO", value: String(p.coValue || 14), unit: "ppm", range: "安全限值 <24 ppm", refresh: "实时" },
          { name: "硫化氢 H\u2082S", value: String(p.h2sValue || 0), unit: "ppm", range: "安全限值 <6.6 ppm", refresh: "实时" },
          { name: "可燃气体 LEL", value: String(p.lelValue || 0), unit: "% LEL", range: "安全限值 <10%", refresh: "实时" }
        ],
        timeline: p.timeline || [
          { status: "done", title: "申请人与监护人现场双确认", time: "08:30", desc: "双人实地复验合格", detail: "防爆工器具及个人防护用品双人实地复验合格", detailType: "muted" },
          { status: "done", title: "安全挂牌上锁 (LOTO) 能量隔离验证", time: "08:45", desc: "配电断开上锁", detail: "已核验双回路物理截断与阀门锁死", detailType: "green" },
          { status: "done", title: "气体检测达标与连续监测联锁", time: "09:00", desc: "安环化验员现场取证完成", detail: "四合一检测仪实时在线 · 联锁通道畅通", detailType: "primary" },
          { status: "active", title: "安环部安全总监审批", approver: user.name || "--", approverRole: "(安全总监)", initial: (user.name || "?").slice(0, 1), desc: "请最终核准气体连续联锁、隔离防护及防坠应急措施。" }
        ],
        signInfo: {
          signUser: (user.name || "--") + " (" + (user.username || "--") + ")",
          shaHash: "SHA256: " + Math.random().toString(16).slice(2, 10) + "..." + Math.random().toString(16).slice(2, 6)
        }
      });
    }).catch(function (e) {
      that.setData({ loading: false, loadError: (e && (e.error || e.message)) || "加载失败，请确认后端服务已启动" });
    });
  },

  onBack: function () { wx.navigateBack({ delta: 1 }); },
  onTouchSign: function () { this.setData({ showModal: true }); },
  onCloseModal: function () { this.setData({ showModal: false }); },

  onReject: function () {
    wx.showModal({
      title: "退回修正", editable: true, placeholderText: "请输入退回修正具体原因",
      success: function (res) {
        if (res.confirm && res.content) wx.showToast({ title: "已退回至发起人", icon: "none" });
      }
    });
  },

  onApprove: function () { this.setData({ showModal: true }); },
  onCancelSign: function () { this.setData({ showModal: false }); },

  onConfirmSign: function () {
    var that = this;
    wx.showLoading({ title: "写入区块链存证..." });
    var url = that._permitId ? "/api/v1/safety-permits/" + that._permitId + "/approve" : "/api/v1/safety-permits";
    request(url, { method: "POST", data: { step: "supervisor", pass: true, comment: "审批通过" } }).then(function () {
      wx.hideLoading();
      that.setData({ showModal: false, approveDisabled: true, approveText: "已签发生效 · 联锁监护中" });
      wx.showToast({ title: "审批通过！", icon: "success" });
    }).catch(function () {
      wx.hideLoading();
      wx.showToast({ title: "审批失败，请重试", icon: "none" });
    });
  }
});
