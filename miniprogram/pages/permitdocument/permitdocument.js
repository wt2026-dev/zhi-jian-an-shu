var { request } = require("../../utils/request.js");
var ui = require("../../utils/ui.js");

Page({
  data: {
    loading: true,
    loadError: "",
    permits: [],
    selectedId: "",
    permit: null,
    gasTests: [],
    precautions: [],
    checklist: []
  },

  onLoad: function (options) {
    var that = this;
    that.setData({ loading: true, loadError: "" });
    request("/api/v1/safety-permits").then(function (permits) {
      var list = permits || [];
      var selectedId = options.id || (list.length > 0 ? list[0].id : "");
      that.setData({ permits: list, selectedId: selectedId, loading: false });
      if (selectedId) that.loadPermit(selectedId);
    }).catch(function (e) {
      that.setData({
        loading: false,
        loadError: (e && (e.error || e.message)) || "加载失败，请确认后端服务已启动"
      });
    });
  },

  loadPermit: function (id) {
    var that = this;
    that.setData({ selectedId: id });
    request("/api/v1/safety-permits/" + id).then(function (p) {
      that.setData({
        permit: p,
        gasTests: p.gasTests || (p.gasTestResults ? [p.gasTestResults] : []),
        precautions: Array.isArray(p.precautions) ? p.precautions : [p.precautions],
        checklist: Array.isArray(p.safetyChecklist) ? p.safetyChecklist : []
      });
    }).catch(function () {});
  },

  onPermitChange: function (e) {
    var id = this.data.permits[e.detail.value].id;
    this.loadPermit(id);
  },

  goBack: function () { wx.navigateBack({ delta: 1 }); },

  onShareAppMessage: function () {
    var p = this.data.permit;
    return {
      title: "安全作业票 " + (p ? p.permitNo : ""),
      path: "/pages/permitdocument/permitdocument?id=" + this.data.selectedId
    };
  },

  saveToAlbum: function () {
    var that = this;
    var p = that.data.permit;
    if (!p) { wx.showToast({ title: "请先选择作业票", icon: "none" }); return; }
    wx.showLoading({ title: "生成文档中..." });
    var query = wx.createSelectorQuery();
    query.select("#permitCanvas").boundingClientRect(function (rect) {
      if (!rect) { wx.hideLoading(); wx.showToast({ title: "画布不可用", icon: "none" }); return; }
      var dpr = wx.getSystemInfoSync().pixelRatio || 2;
      var canvas = wx.createCanvasContext("permitCanvas", that);
      var w = rect.width;
      var h = rect.height;
      that.drawPermitDocument(canvas, w, h, p);
      canvas.draw(false, function () {
        wx.canvasToTempFilePath({
          canvasId: "permitCanvas",
          x: 0, y: 0, width: w * dpr, height: h * dpr,
          destWidth: w * dpr, destHeight: h * dpr,
          success: function (res) {
            wx.hideLoading();
            wx.saveImageToPhotosAlbum({
              filePath: res.tempFilePath,
              success: function () { wx.showToast({ title: "已保存到相册", icon: "success" }); },
              fail: function () {
                wx.showToast({ title: "保存失败，请授权相册权限", icon: "none" });
              }
            });
          },
          fail: function () { wx.hideLoading(); wx.showToast({ title: "导出失败", icon: "none" }); }
        }, that);
      });
    }).exec();
  },

  drawPermitDocument: function (ctx, w, h, p) {
    var bg = "#0a0a0a";
    var cardBg = "#141414";
    var border = "#262626";
    var text = "#e2e8f0";
    var muted = "#94a3b8";
    var accent = "#22d3ee";
    var red = "#ef4444";
    var green = "#22c55e";
    var y = 0;
    var pad = 24;
    var contentW = w - pad * 2;

    ctx.setFillStyle(bg);
    ctx.fillRect(0, 0, w, h);

    ctx.setFillStyle(red);
    ctx.fillRect(0, 0, w, 72);
    ctx.setFillStyle("#ffffff");
    ctx.setFontSize(28);
    ctx.setTextAlign("center");
    ctx.fillText("安 全 作 业 票", w / 2, 46);

    y = 88;
    ctx.setTextAlign("left");
    ctx.setFillStyle(accent);
    ctx.setFontSize(14);
    ctx.fillText("票号: " + (p.permitNo || "--"), pad, y);
    ctx.setFillStyle(muted);
    ctx.setFontSize(12);
    ctx.setTextAlign("right");
    ctx.fillText("类型: " + (p.permitType || "--"), w - pad, y);

    y += 28;
    ctx.setFillStyle(border);
    ctx.fillRect(pad, y, contentW, 1);
    y += 16;

    ctx.setFillStyle(text);
    ctx.setFontSize(16);
    ctx.font = "bold 16px sans-serif";
    ctx.fillText("作业信息", pad, y);
    y += 8;
    ctx.font = "14px sans-serif";

    var info = [
      ["作业内容", p.title || "--"],
      ["作业区域", (p.workshop || "") + " " + (p.location || "")],
      ["作业时间", (p.appliedAt || "--") + " ~ " + (p.validUntil || "--")],
      ["作业类型", p.permitType || "--"],
      ["申请人", p.applicant || "--"],
      ["作业人员", (p.personnel || []).join(", ") || "--"],
      ["风险等级", p.riskLevel || "--"],
      ["LOTO锁号", p.lotoNumber || "无"]
    ];
    for (var i = 0; i < info.length; i++) {
      y += 22;
      ctx.setFillStyle(muted);
      ctx.font = "12px sans-serif";
      ctx.fillText(info[i][0], pad, y);
      ctx.setFillStyle(text);
      ctx.fillText(info[i][1], pad + 100, y);
    }

    if (that.data.gasTests.length > 0 || p.gasTestResults) {
      y += 28;
      ctx.setFillStyle(border);
      ctx.fillRect(pad, y, contentW, 1);
      y += 16;
      ctx.setFillStyle(text);
      ctx.font = "bold 16px sans-serif";
      ctx.fillText("气体检测", pad, y);
      y += 8;
      ctx.font = "12px sans-serif";
      var g = p.gasTestResults || {};
      var gasInfo = [
        ["氧气 (O₂)", (g.oxygen != null ? g.oxygen + "%" : "--")],
        ["可燃气体", (g.combustible_gas != null ? g.combustible_gas + "%" : "--")],
        ["有毒气体", (g.toxic_gas != null ? g.toxic_gas + "ppm" : "--")],
        ["检测人", g.tester || "--"],
        ["检测时间", g.test_time || "--"]
      ];
      for (var j = 0; j < gasInfo.length; j++) {
        y += 22;
        ctx.setFillStyle(muted);
        ctx.fillText(gasInfo[j][0], pad, y);
        ctx.setFillStyle(text);
        ctx.fillText(gasInfo[j][1], pad + 100, y);
      }
    }

    if (that.data.precautions.length > 0) {
      y += 28;
      ctx.setFillStyle(border);
      ctx.fillRect(pad, y, contentW, 1);
      y += 16;
      ctx.setFillStyle(text);
      ctx.font = "bold 16px sans-serif";
      ctx.fillText("安全措施", pad, y);
      y += 8;
      ctx.font = "12px sans-serif";
      for (var k = 0; k < that.data.precautions.length; k++) {
        y += 20;
        ctx.setFillStyle(green);
        ctx.fillText("✓", pad, y);
        ctx.setFillStyle(muted);
        ctx.fillText(that.data.precautions[k], pad + 18, y);
      }
    }

    y += 28;
    ctx.setFillStyle(border);
    ctx.fillRect(pad, y, contentW, 1);
    y += 16;
    ctx.setFillStyle(text);
    ctx.font = "bold 16px sans-serif";
    ctx.fillText("审批与签章", pad, y);
    y += 8;
    ctx.font = "12px sans-serif";

    var ga = p.guardianApproval || {};
    var sa = p.supervisorApproval || {};
    var signNodes = [
      { label: "现场监护初审", data: ga },
      { label: "主管终审", data: sa }
    ];
    for (var n = 0; n < signNodes.length; n++) {
      var sn = signNodes[n];
      y += 24;
      ctx.setFillStyle(muted);
      ctx.fillText(sn.label, pad, y);
      if (sn.data && sn.data.signed) {
        ctx.setFillStyle(green);
        ctx.fillText("已签章 ✓ " + (sn.data.name || ""), pad + 120, y);
        ctx.setFillStyle(muted);
        ctx.font = "11px sans-serif";
        ctx.fillText(sn.data.signedAt || "", pad + 120, y + 16);
        if (sn.data.comment) {
          ctx.fillText("意见: " + sn.data.comment, pad + 120, y + 30);
        }
        ctx.font = "12px sans-serif";
      } else {
        ctx.setStrokeStyle("#475569");
        ctx.setLineDash([4, 4], 0);
        ctx.strokeRect(pad + 120, y - 12, 160, 28);
        ctx.setLineDash([], 0);
        ctx.setFillStyle("#475569");
        ctx.fillText("待签署", pad + 180, y + 4);
      }
    }

    if (p.closedAt) {
      y += 50;
      ctx.setFillStyle(border);
      ctx.fillRect(pad, y, contentW, 1);
      y += 16;
      ctx.setFillStyle(text);
      ctx.font = "bold 16px sans-serif";
      ctx.fillText("作业闭环", pad, y);
      y += 20;
      ctx.font = "12px sans-serif";
      ctx.setFillStyle(muted);
      ctx.fillText("关闭时间: " + (p.closedAt || "--"), pad, y);
      y += 18;
      ctx.fillText("关闭人: " + (p.closedBy || "--"), pad, y);
      if (p.closeRemark) {
        y += 18;
        ctx.fillText("说明: " + p.closeRemark, pad, y);
      }
    }

    y += 36;
    ctx.setFillStyle(border);
    ctx.fillRect(pad, y, contentW, 1);
    y += 16;
    ctx.setFillStyle("#475569");
    ctx.font = "11px sans-serif";
    ctx.setTextAlign("center");
    var now = new Date();
    var ts = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0") + " " + String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    ctx.fillText("文档生成时间: " + ts + " | 电子签章防伪验证", w / 2, y);
    ctx.setTextAlign("left");
  },

  retry: function () {
    this.onLoad({ id: this.data.selectedId });
  }
});
