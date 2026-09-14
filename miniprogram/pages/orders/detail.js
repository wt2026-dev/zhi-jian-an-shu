var { request, uploadImage } = require("../../utils/request.js");
var ui = require("../../utils/ui.js");

Page({
  data: {
    loading: true, order: null,
    stages: ["创建", "派单", "接单", "完工", "验收"],
    stageIdx: -1, pText: "", pStyle: "", sText: "", sStyle: "",
    showDispatch: false, showClaim: false, showComplete: false, showAccept: false,
    techNames: [], techIdx: 0, techs: [], estHours: "3.5", rec: null, recLoading: false, altText: "",
    cause: "", steps: "", workHours: "2", parts: "", photos: [],
    score: 4, comment: "",
  },
  onLoad(query) { this.id = query.id; this.user = wx.getStorageSync("user") || {}; this.load(); },
  load() {
    var that = this;
    that.setData({ loading: true });
    request("/api/v1/work-orders/" + that.id).then(function (o) {
      var p = ui.mapPriority(o), s = ui.mapStatus(o);
      var stages = ["created", "dispatched", "in_progress", "pending_acceptance", "completed"];
      var role = that.user.role || "";
      var d = {
        loading: false, order: o,
        pText: p.text, pStyle: p.style, sText: s.text, sStyle: s.style,
        stageIdx: stages.indexOf(o.status),
        showDispatch: o.status === "created" && (role === "admin" || role === "manager"),
        showClaim: o.status === "dispatched" && (role === "technician" || role === "admin"),
        showComplete: o.status === "in_progress" && (role === "technician" || role === "admin"),
        showAccept: o.status === "pending_acceptance" && (role === "admin" || role === "manager" || role === "inspector"),
      };
      if (d.showDispatch) {
        request("/api/v1/auth/users").then(function (users) {
          var techs = (users || []).filter(function (u) { return u.role === "technician" || u.role === "manager"; });
          d.techs = techs;
          d.techNames = techs.map(function (u) { return u.name + "（" + u.roleTitle + "）"; });
          that.setData(d);
        }).catch(function () { that.setData(d); });
      } else {
        that.setData(d);
      }
    }).catch(function (e) {
      that.setData({ loading: false, order: null });
      wx.showToast({ title: (e && e.error) || "加载失败", icon: "none" });
    });
  },
  aiRecommend() {
    var that = this;
    this.setData({ recLoading: true });
    request("/api/v1/ai/recommend-assignee", {
      method: "POST",
      data: {
        equipmentId: this.data.order.equipmentId,
        faultDescription: this.data.order.description || this.data.order.title,
        priority: this.data.order.priority,
      },
      timeout: 90000,
    }).then(function (res) {
      if (res.success && res.recommendation) {
        var alts = (res.recommendation.alternatives || []).map(function (a) { return a.name; }).join("、");
        that.setData({ rec: res.recommendation, altText: alts || "无", recLoading: false });
      } else {
        that.setData({ recLoading: false });
        wx.showModal({ title: "AI 推荐失败", content: res.message || res.error || "未知错误", showCancel: false });
      }
    }).catch(function (e) {
      that.setData({ recLoading: false });
      wx.showModal({ title: "AI 调用失败", content: (e && (e.message || e.error)) || "网络异常", showCancel: false });
    });
  },
  applyRec() {
    var rec = this.data.rec;
    if (!rec || !rec.recommended) return;
    var idx = -1;
    this.data.techs.forEach(function (t, i) { if (t.id === rec.recommended.id) idx = i; });
    this.setData({ techIdx: idx >= 0 ? idx : 0, estHours: String(rec.estimatedHours || this.data.estHours) });
    wx.showToast({ title: "已采纳 AI 推荐", icon: "success" });
  },
  onTechPick(e) { this.setData({ techIdx: Number(e.detail.value) }); },
  onHours(e) { this.setData({ estHours: e.detail.value }); },
  doDispatch() {
    var t = this.data.techs[this.data.techIdx];
    if (!t) { wx.showToast({ title: "请选择技师", icon: "none" }); return; }
    var that = this;
    request("/api/v1/work-orders/" + this.id + "/dispatch", {
      method: "POST",
      data: { assigneeId: t.id, assigneeName: t.name + "（" + t.roleTitle + "）", dispatcher: this.user.name, estimatedHours: Number(this.data.estHours) || 2 },
    }).then(function () { wx.showToast({ title: "派发成功", icon: "success" }); that.load(); })
      .catch(function () {});
  },
  doClaim() {
    var that = this;
    request("/api/v1/work-orders/" + this.id + "/claim", { method: "POST", data: { operatorName: this.user.name } })
      .then(function () { wx.showToast({ title: "接单成功", icon: "success" }); that.load(); })
      .catch(function () {});
  },
  onCause(e) { this.setData({ cause: e.detail.value }); },
  onSteps(e) { this.setData({ steps: e.detail.value }); },
  onParts(e) { this.setData({ parts: e.detail.value }); },
  addPhoto() {
    var that = this;
    wx.chooseMedia({ count: 3 - that.data.photos.length, mediaType: ["image"], success(r) {
      var files = r.tempFiles || [];
      var seq = function (i) {
        if (i >= files.length) return;
        uploadImage(files[i].tempFilePath).then(function (res) {
          var photos = that.data.photos.concat([res.url]);
          that.setData({ photos: photos });
          seq(i + 1);
        }).catch(function () { seq(i + 1); });
      };
      seq(0);
    } });
  },
  doComplete() {
    var d = this.data;
    if (!d.cause.trim() || !d.steps.trim()) { wx.showToast({ title: "请填写原因分析与处理步骤", icon: "none" }); return; }
    var partsUsed = d.parts.split("\n").filter(function (l) { return l.trim(); }).map(function (l) {
      var seg = l.trim().split(/\s+/);
      return { name: seg[0], qty: Number(seg[1]) || 1, spec: "", unit: "件" };
    });
    var that = this;
    request("/api/v1/work-orders/" + this.id + "/complete", {
      method: "POST",
      data: {
        causeAnalysis: d.cause, resolutionSteps: d.steps,
        partsUsed: partsUsed, workHours: Number(d.workHours) || 1,
        completionPhotos: d.photos, operatorName: this.user.name,
      },
      timeout: 60000,
    }).then(function () { wx.showToast({ title: "完工上报成功", icon: "success" }); that.load(); })
      .catch(function () {});
  },
  onScore(e) { this.setData({ score: e.detail.value }); },
  onComment(e) { this.setData({ comment: e.detail.value }); },
  doAccept(e) {
    var pass = e.currentTarget.dataset.pass === "true";
    var that = this;
    request("/api/v1/work-orders/" + this.id + "/accept", {
      method: "POST",
      data: { inspectorName: this.user.name, pass: pass, score: Number(this.data.score), comment: this.data.comment },
    }).then(function () { wx.showToast({ title: pass ? "验收通过" : "已驳回", icon: "success" }); that.load(); })
      .catch(function () {});
  },
});