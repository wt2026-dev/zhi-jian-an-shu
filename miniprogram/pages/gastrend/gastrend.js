var { request } = require("../../utils/request.js");

Page({
  data: {
    loading: false,
    loadError: "",
    activeGas: "O2",
    countdown: "--:--:--",
    countdownLabel: "",
    currentRound: 5,
    records: [],
    gasData: {}
  },

  onLoad: function (options) {
    this._equipmentId = options.equipmentId || "";
    this.loadData();
    this.startCountdownTimer();
  },

  onUnload: function () {
    if (this._countdownTimer) clearInterval(this._countdownTimer);
  },

  loadData: function () {
    var that = this;
    that.setData({ loading: true, loadError: "" });
    var url = that._equipmentId ? "/api/v1/equipments/" + that._equipmentId + "/telemetry-history" : "/api/v1/equipments";
    request(url).then(function (res) {
      var data = res;
      if (Array.isArray(res)) data = res[0] || {};
      var points = data.points || data.dataPoints || [];
      var gasData = {
        O2: { value: String(points.length ? points[points.length - 1].o2 || 20.9 : 20.9), unit: "%", status: "达标" },
        LEL: { value: String(points.length ? points[points.length - 1].lel || 0 : 0), unit: "%", status: "安全" },
        CO: { value: String(points.length ? points[points.length - 1].co || 4 : 4), unit: "ppm", status: "达标" },
        H2S: { value: String(points.length ? points[points.length - 1].h2s || 0 : 0), unit: "ppm", status: "达标" }
      };
      var records = [];
      for (var i = 0; i < Math.min(points.length, 5); i++) {
        var pt = points[points.length - 1 - i] || {};
        records.push({
          round: i + 1,
          label: i === 0 ? "第" + (i + 1) + "轮(当前)" : "第" + (i + 1) + "轮",
          isCurrent: i === 0,
          time: pt.time || pt.timestamp || "--",
          status: "达标",
          personnel: pt.personnel || "--",
          samplingPoint: pt.samplingPoint || "--",
          instrument: pt.instrument || "--"
        });
      }
      that.setData({
        loading: false,
        gasData: gasData,
        records: records,
        currentRound: records.length || 1,
        dataPoints: points
      });
      that.drawTrendChart();
    }).catch(function (e) {
      that.setData({
        loading: false,
        loadError: (e && (e.error || e.message)) || "加载失败，请确认后端服务已启动",
        gasData: { O2: { value: "--", unit: "%", status: "未知" }, LEL: { value: "--", unit: "%", status: "未知" }, CO: { value: "--", unit: "ppm", status: "未知" }, H2S: { value: "--", unit: "ppm", status: "未知" } }
      });
    });
  },

  goBack: function () { wx.navigateBack({ delta: 1 }); },

  switchGas: function (e) { this.setData({ activeGas: e.currentTarget.dataset.gas }); },

  drawTrendChart: function () {
    var that = this;
    var dataPoints = that.data.dataPoints || [];
    if (!dataPoints.length) return;
    var query = wx.createSelectorQuery();
    query.select("#trendChart").boundingClientRect(function (rect) {
      if (!rect) return;
      var ctx = wx.createCanvasContext("trendChart", that);
      var w = rect.width, h = rect.height;
      var chartLeft = 60, chartRight = w - 20, chartTop = 20, chartBottom = h - 40;
      var chartW = chartRight - chartLeft, chartH = chartBottom - chartTop;
      var yMin = 19.0, yMax = 24.0;
      var toX = function (i) { return chartLeft + (i / (dataPoints.length - 1)) * chartW; };
      var toY = function (v) { return chartTop + chartH - ((v - yMin) / (yMax - yMin)) * chartH; };

      ctx.clearRect(0, 0, w, h);
      ctx.setStrokeStyle("#1a1a1a");
      ctx.setLineWidth(1);
      ctx.setLineDash([2, 3], 0);
      for (var i = 0; i < 4; i++) {
        var y = chartTop + (chartH / 4) * i;
        ctx.beginPath(); ctx.moveTo(chartLeft, y); ctx.lineTo(chartRight, y); ctx.stroke();
      }
      ctx.setLineDash([], 0);

      var safeTop = toY(23.5), safeBottom = toY(19.5);
      ctx.setFillStyle("rgba(34, 197, 94, 0.1)");
      ctx.fillRect(chartLeft, safeTop, chartW, safeBottom - safeTop);
      ctx.setStrokeStyle("rgba(255, 180, 171, 0.6)");
      ctx.setLineDash([3, 3], 0);
      ctx.beginPath(); ctx.moveTo(chartLeft, safeTop); ctx.lineTo(chartRight, safeTop); ctx.stroke();
      ctx.setFillStyle("rgba(255, 180, 171, 0.8)"); ctx.setFontSize(9);
      ctx.fillText("上限 23.5%", chartLeft + 6, safeTop - 4);
      ctx.beginPath(); ctx.moveTo(chartLeft, safeBottom); ctx.lineTo(chartRight, safeBottom); ctx.stroke();
      ctx.fillText("下限 19.5%", chartLeft + 6, safeBottom - 4);
      ctx.setLineDash([], 0);

      ctx.beginPath(); ctx.moveTo(toX(0), toY(dataPoints[0].value));
      for (var i = 1; i < dataPoints.length; i++) ctx.lineTo(toX(i), toY(dataPoints[i].value));
      ctx.lineTo(toX(dataPoints.length - 1), chartBottom); ctx.lineTo(toX(0), chartBottom); ctx.closePath();
      var grad = ctx.createLinearGradient(0, safeTop, 0, chartBottom);
      grad.addColorStop(0, "rgba(142, 213, 255, 0.25)"); grad.addColorStop(1, "rgba(142, 213, 255, 0.0)");
      ctx.setFillStyle(grad); ctx.fill();

      ctx.beginPath(); ctx.moveTo(toX(0), toY(dataPoints[0].value));
      for (var i = 1; i < dataPoints.length; i++) ctx.lineTo(toX(i), toY(dataPoints[i].value));
      ctx.setStrokeStyle("#8ed5ff"); ctx.setLineWidth(2.5); ctx.setLineCap("round"); ctx.setLineJoin("round"); ctx.stroke();

      for (var i = 0; i < dataPoints.length; i++) {
        var x = toX(i), y = toY(dataPoints[i].value);
        if (i === dataPoints.length - 1) {
          ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.setFillStyle("rgba(142, 213, 255, 0.2)"); ctx.fill();
          ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.setFillStyle("#38bdf8"); ctx.fill();
          ctx.setStrokeStyle("#ffffff"); ctx.setLineWidth(1.5); ctx.stroke();
          ctx.setFillStyle("#38bdf8"); ctx.fillRect(x - 26, y - 28, 52, 20);
          ctx.setFillStyle("#00354a"); ctx.setFontSize(10); ctx.setTextAlign("center");
          ctx.fillText(dataPoints[i].value.toFixed(1) + "%", x, y - 14);
        } else {
          ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.setFillStyle("#0b0e12"); ctx.fill();
          ctx.setStrokeStyle("#8ed5ff"); ctx.setLineWidth(2); ctx.stroke();
          ctx.setFillStyle("#bdc8d1"); ctx.setFontSize(9); ctx.setTextAlign("center");
          ctx.fillText(dataPoints[i].value.toFixed(1), x, y - 10);
        }
      }
      for (var i = 0; i < dataPoints.length; i++) {
        var x = toX(i);
        ctx.setFontSize(9); ctx.setTextAlign("center");
        if (i === dataPoints.length - 1) { ctx.setFillStyle("#8ed5ff"); ctx.font = "600 10px monospace"; }
        else { ctx.setFillStyle("#7e889b"); ctx.font = "10px monospace"; }
        ctx.fillText(dataPoints[i].time || "", x, chartBottom + 24);
      }
      ctx.draw();
    }).exec();
  },

  startCountdownTimer: function () {
    var that = this;
    if (this._countdownTimer) clearInterval(this._countdownTimer);
    var lastTime = null;
    var points = that.data.dataPoints || [];
    if (points.length > 0) {
      var lt = points[points.length - 1].time || points[points.length - 1].timestamp;
      if (lt) lastTime = new Date(lt.replace(/-/g, "/")).getTime();
    }
    if (!lastTime) {
      that.setData({ countdown: "--:--:--", countdownLabel: "无检测数据" });
      return;
    }
    var twoHours = 2 * 3600 * 1000;
    function update() {
      var now = Date.now();
      var remain = lastTime + twoHours - now;
      if (remain <= 0) {
        that.setData({ countdown: "00:00:00", countdownLabel: "待复测" });
        clearInterval(that._countdownTimer);
        return;
      }
      var h = Math.floor(remain / 3600000);
      var m = Math.floor((remain % 3600000) / 60000);
      var s = Math.floor((remain % 60000) / 1000);
      var pad = function (n) { return String(n).padStart(2, "0"); };
      that.setData({ countdown: pad(h) + ":" + pad(m) + ":" + pad(s), countdownLabel: "" });
    }
    update();
    that._countdownTimer = setInterval(update, 1000);
  },

  exportLedger: function () {
    var that = this;
    var gasData = that.data.gasData || {};
    var records = that.data.records || [];
    var points = that.data.dataPoints || [];
    wx.showLoading({ title: "生成台账..." });
    var sysInfo = wx.getSystemInfoSync();
    var dpr = sysInfo.pixelRatio || 2;
    var query = wx.createSelectorQuery();
    query.select("#exportCanvas").boundingClientRect(function (rect) {
      if (!rect) { wx.hideLoading(); wx.showToast({ title: "画布不可用", icon: "none" }); return; }
      var canvas = wx.createCanvasContext("exportCanvas", that);
      var w = rect.width;
      var h = rect.height;
      canvas.setFillStyle("#0a0a0a");
      canvas.fillRect(0, 0, w, h);
      var y = 30;
      var pad = 24;
      canvas.setFillStyle("#ef4444");
      canvas.fillRect(0, 0, w, 56);
      canvas.setFillStyle("#ffffff");
      canvas.setFontSize(22);
      canvas.setTextAlign("center");
      canvas.fillText("气体检测台账", w / 2, 38);
      canvas.setTextAlign("left");
      y = 80;
      canvas.setFillStyle("#22d3ee");
      canvas.setFontSize(14);
      canvas.fillText("设备: " + (that._equipmentId || "当前设备"), pad, y);
      y += 28;
      var gases = ["O2", "LEL", "CO", "H2S"];
      var units = { O2: "%", LEL: "%", CO: "ppm", H2S: "ppm" };
      for (var i = 0; i < gases.length; i++) {
        var g = gases[i];
        var d = gasData[g] || {};
        canvas.setFillStyle("#64748b");
        canvas.setFontSize(12);
        canvas.fillText(g + " (" + (units[g] || "") + ")", pad, y);
        canvas.setFillStyle("#e2e8f0");
        canvas.fillText(d.value || "--", pad + 120, y);
        y += 20;
      }
      y += 12;
      canvas.setFillStyle("#262626");
      canvas.fillRect(pad, y, w - pad * 2, 1);
      y += 16;
      canvas.setFillStyle("#e2e8f0");
      canvas.setFontSize(14);
      canvas.font = "bold 14px sans-serif";
      canvas.fillText("历史检测记录", pad, y);
      y += 8;
      canvas.font = "12px sans-serif";
      for (var j = 0; j < records.length; j++) {
        var r = records[j];
        y += 20;
        canvas.setFillStyle(r.isCurrent ? "#22d3ee" : "#94a3b8");
        canvas.fillText(r.label, pad, y);
        canvas.setFillStyle("#64748b");
        canvas.fillText(r.time || "--", pad + 100, y);
        canvas.fillText(r.samplingPoint || "--", pad + 220, y);
        canvas.fillText(r.instrument || "--", pad + 360, y);
      }
      y += 24;
      canvas.setFillStyle("#262626");
      canvas.fillRect(pad, y, w - pad * 2, 1);
      y += 16;
      canvas.setFillStyle("#475569");
      canvas.setFontSize(11);
      canvas.setTextAlign("center");
      var now = new Date();
      var ts = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0") + " " + String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
      canvas.fillText("导出时间: " + ts, w / 2, y);
      canvas.setTextAlign("left");
      canvas.draw(false, function () {
        wx.canvasToTempFilePath({
          canvasId: "exportCanvas",
          x: 0, y: 0, width: w * dpr, height: h * dpr,
          destWidth: w * dpr, destHeight: h * dpr,
          success: function (res) {
            wx.hideLoading();
            wx.saveImageToPhotosAlbum({
              filePath: res.tempFilePath,
              success: function () { wx.showToast({ title: "台账已保存到相册", icon: "success" }); },
              fail: function () { wx.showToast({ title: "保存失败，请授权相册权限", icon: "none" }); }
            });
          },
          fail: function () { wx.hideLoading(); wx.showToast({ title: "导出失败", icon: "none" }); }
        }, that);
      });
    }).exec();
  },

  startNextRound: function () {
    var that = this;
    wx.showModal({
      title: "发起复测", content: "确认发起第" + (that.data.currentRound + 1) + " 轮现场复测？",
      confirmText: "确认发起", confirmColor: "#38bdf8",
      success: function (res) {
        if (res.confirm) wx.showToast({ title: "已发起下轮复测", icon: "success" });
      }
    });
  },

  onChartTouch: function () {}
});
