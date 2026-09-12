var { request } = require("../../utils/request.js");
var { mdToHtml } = require("../../utils/markdown.js");

var STATUS_MAP = {
  pending: { t: "待开始", s: "background:#64748b;color:#e5e5e5" },
  in_progress: { t: "进行中", s: "background:#22c55e;color:#0a0a0a" },
  completed: { t: "已完成", s: "background:#38bdf8;color:#0a0a0a" },
  abnormal: { t: "有异常", s: "background:#FB7185;color:#0a0a0a" }
};

Page({
  data: {
    tasks: [],
    loading: false,
    loadError: "",
    reportLoading: false,
    reportMeta: null,
    reportText: "",
    reportHtml: ""
  },
  onShow() {
    this.loadData();
  },
  loadData() {
    var that = this;
    that.setData({ loading: true, loadError: "" });
    request("/api/v1/inspections").then(function (list) {
      var tasks = (list || []).map(function (t) {
        var st = STATUS_MAP[t.status] || STATUS_MAP.pending;
        return {
          id: t.id,
          name: t.title || t.name || "巡检任务",
          area: t.workshop || t.route || t.area || "",
          time: t.scheduledDate || t.time || "",
          status: st.t,
          statusStyle: st.s,
          points: t.totalPoints || t.points || 0,
          completed: t.completedPoints || t.completed || 0,
          inspector: t.inspector || t.inspectorName || ""
        };
      });
      that.setData({ tasks: tasks, loading: false });
    }).catch(function (e) {
      that.setData({ loading: false, loadError: (e && (e.error || e.message)) || "加载失败，请确认后端服务已启动" });
    });
  },
  goDetail(e) {
    var id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: "/pages/inspect/detail?id=" + id });
  },

  // 微信原生扫码：扫设备铭牌二维码直达巡检表单
  scanInspect() {
    var that = this;
    wx.scanCode({
      scanType: ["qrCode", "barCode"],
      success(res) {
        var raw = (res.result || "").trim();
        if (!raw) {
          wx.showToast({ title: "未识别到设备码，可手动选择下方设备", icon: "none", duration: 2500 });
          return;
        }

        // 解析二维码：兼容裸设备编码、URL 参数及 JSON
        var eqCodeOrId = raw;
        try {
          if (raw.indexOf("?") !== -1 || raw.indexOf("http://") === 0 || raw.indexOf("https://") === 0) {
            var qIdx = raw.indexOf("?");
            if (qIdx !== -1) {
              var qStr = raw.substring(qIdx + 1);
              var pairs = qStr.split("&");
              for (var i = 0; i < pairs.length; i++) {
                var p = pairs[i].split("=");
                if (p[0] === "equipmentId" || p[0] === "targetEquipmentId" || p[0] === "id") {
                  eqCodeOrId = decodeURIComponent(p[1] || "");
                  break;
                }
              }
            }
          }
        } catch (_) {}

        try {
          if (raw.indexOf("{") === 0 && raw.lastIndexOf("}") === raw.length - 1) {
            var obj = JSON.parse(raw);
            if (obj.code || obj.id) eqCodeOrId = obj.code || obj.id;
          }
        } catch (_) {}

        var target = eqCodeOrId.toUpperCase();

        // 匹配系统设备
        request("/api/v1/equipments").then(function (eqs) {
          var matchedEq = (eqs || []).find(function (e) {
            return (e.code && e.code.toUpperCase() === target) ||
                   (e.id && e.id.toUpperCase() === target) ||
                   (e.name && e.name.toUpperCase().indexOf(target) !== -1);
          });

          if (!matchedEq) {
            wx.showToast({ title: "未识别到设备码，可手动选择下方设备", icon: "none", duration: 3000 });
            return;
          }

          var eqLabel = matchedEq.name + " (" + (matchedEq.code || matchedEq.id) + ")";
          wx.showToast({ title: "已扫码识别设备: " + eqLabel, icon: "success", duration: 2000 });

          // 寻找匹配的巡检任务
          var tasks = that.data.tasks || [];
          var matchedTask = tasks.find(function (t) {
            return (t.name && t.name.indexOf(matchedEq.name) !== -1) ||
                   (t.area && matchedEq.workshop && t.area.indexOf(matchedEq.workshop) !== -1);
          });

          setTimeout(function () {
            if (matchedTask) {
              wx.navigateTo({
                url: "/pages/inspect/detail?id=" + matchedTask.id + "&scannedCode=" + encodeURIComponent(matchedEq.code || matchedEq.id)
              });
            } else if (tasks.length > 0) {
              wx.navigateTo({
                url: "/pages/inspect/detail?id=" + tasks[0].id + "&scannedCode=" + encodeURIComponent(matchedEq.code || matchedEq.id)
              });
            } else {
              wx.showToast({ title: "已识别设备，当前无对应巡检任务", icon: "none" });
            }
          }, 800);
        }).catch(function () {
          wx.showToast({ title: "未识别到设备码，可手动选择下方设备", icon: "none", duration: 2500 });
        });
      },
      fail(err) {
        if (err && err.errMsg && err.errMsg.indexOf("cancel") !== -1) return;
        wx.showToast({ title: "未识别到设备码，可手动选择下方设备", icon: "none", duration: 2500 });
      }
    });
  },

  // AI 巡检报告：调用后端 /api/v1/ai/generate-report 生成近 7 天巡检总结
  genReport() {
    var that = this;
    if (that.data.reportLoading) return;
    var end = new Date();
    var start = new Date(end.getTime() - 7 * 24 * 3600 * 1000);
    var fmt = function (d) {
      var p = function (x) { return x < 10 ? "0" + x : "" + x; };
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    };

    that.setData({ reportLoading: true, reportMeta: null, reportText: "" });
    wx.showLoading({ title: "AI 生成中...", mask: true });

    request("/api/v1/ai/generate-report", {
      method: "POST",
      timeout: 90000,
      data: { reportType: "inspection", startDate: fmt(start), endDate: fmt(end) },
    })
      .then(function (res) {
        wx.hideLoading();
        var r = (res && res.report) || {};
        var text = r.markdown || r.content || r.summary || "";
        if (!text) text = typeof r === "string" ? r : JSON.stringify(r, null, 2);
        that.setData({
          reportLoading: false,
          reportText: text,
          reportHtml: mdToHtml(text),
          reportMeta: (res && res.meta) || { startDate: fmt(start), endDate: fmt(end) },
        });
      })
      .catch(function (e) {
        wx.hideLoading();
        that.setData({ reportLoading: false });
        wx.showToast({ title: (e && (e.error || e.message)) || "报告生成失败", icon: "none", duration: 2600 });
      });
  },

  closeReport() { this.setData({ reportMeta: null, reportText: "", reportHtml: "" }); },

  // 阻止弹层内部点击事件冒泡到遮罩层
  noop() {},

  copyReport() {
    var that = this;
    wx.setClipboardData({
      data: that.data.reportText,
      success: function () { wx.showToast({ title: "已复制报告", icon: "success" }); },
    });
  },

  onShareAppMessage() {
    return {
      title: this.data.reportText ? "AI 巡检总结报告" : "巡检作业",
      path: "/pages/inspect/list",
    };
  }
});
