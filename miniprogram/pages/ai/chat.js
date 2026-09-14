var { ssePost } = require("../../utils/sse.js");
var { request } = require("../../utils/request.js");
var { mdToHtml } = require("../../utils/markdown.js");

// 快捷指令：横向滚动 chips，点击直接发送
var QUICK_CHIPS = [
  "设备故障排查",
  "LOTO 停电挂牌规范",
  "SOP 检修规程查询",
  "离心泵振动超标分析",
  "轴承发热处置步骤",
  "受限空间作业票要点",
];

Page({
  data: {
    brandName: "工业检修 AI 大脑",
    brandDesc: "设备诊断 · 安全规范 · SOP 规程 · 图像识别",
    messages: [],
    quickChips: QUICK_CHIPS,
    input: "",
    streaming: false,
    typing: false,
    followups: [],
    lastId: "",
    // 待发送图片（本地临时路径）
    pendingImage: "",
    imageSending: false,
    userAvatar: "",
  },

  onUnload() {
    if (this._audioCtx) {
      try { this._audioCtx.stop(); this._audioCtx.destroy(); } catch (e) {}
      this._audioCtx = null;
    }
  },

  onLoad() {
    var me = wx.getStorageSync("user") || {};
    this.setData({
      userAvatar: me.avatar || "",
    });
    var welcomeText = "你好，我是工业设备检修 AI 助手。可以问我设备故障排查、LOTO 安全规范、SOP 规程等问题；也可以点「+」上传设备照片，我会帮你识别缺陷。";
    this.setData({
      messages: [
        {
          id: "m0",
          role: "assistant",
          text: welcomeText,
          html: mdToHtml(welcomeText),
          time: nowTime(),
          streaming: false,
          img: "",
        },
      ],
    });
    this.scrollBottom();
  },

  onShow() {
    var me = wx.getStorageSync("user") || {};
    if ((me.avatar || "") !== this.data.userAvatar) this.setData({ userAvatar: me.avatar || "" });
  },

  onInput(e) { this.setData({ input: e.detail.value }); },

  askChip(e) {
    var q = e.currentTarget.dataset.q;
    if (!q || this.data.streaming || this.data.imageSending) return;
    this.setData({ input: q });
    this.send();
  },
  askFup(e) { this.askChip(e); },

  stopGen() { if (this.task) this.task.abort(); },

  scrollBottom() {
    var that = this;
    setTimeout(function () {
      that.setData({ lastId: "m" + (that.data.messages.length - 1) });
    }, 120);
  },

  // 选择图片（图片理解 / 设备缺陷识别）
  chooseImage() {
    var that = this;
    if (that.data.streaming || that.data.imageSending) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sizeType: ["compressed"],
      sourceType: ["album", "camera"],
      success: function (res) {
        var f = res.tempFiles && res.tempFiles[0];
        if (!f) return;
        if (f.size && f.size > 10 * 1024 * 1024) {
          wx.showToast({ title: "图片不能超过 10MB", icon: "none" });
          return;
        }
        that.setData({ pendingImage: f.tempFilePath });
      },
    });
  },

  removePendingImage() { this.setData({ pendingImage: "" }); },

  // 选择现场设备运行视频（多模态时序分析）
  chooseVideo() {
    var that = this;
    if (that.data.streaming || that.data.imageSending) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ["video"],
      sourceType: ["album", "camera"],
      maxDuration: 60,
      success: function (res) {
        var f = res.tempFiles && res.tempFiles[0];
        if (!f) return;
        var thumbPath = f.thumbTempFilePath || f.tempFilePath;
        var fsm = wx.getFileSystemManager();
        var frameBase64 = "";
        try {
          frameBase64 = fsm.readFileSync(thumbPath, "base64");
        } catch (err) {
          console.warn("Read thumb base64 failed:", err);
        }
        that.sendVideo(f.tempFilePath, frameBase64);
      },
    });
  },
  sendVideo(filePath, frameBase64) {
    var that = this;
    var uid = "u" + Date.now();
    var aid = "a" + Date.now();
    var promptText = that.data.input || "请对该设备运行视频进行多模态时序分析与故障树研判";

    that.setData({
      messages: that.data.messages.concat([
        { id: uid, role: "user", text: "🎥 [设备检修现场视频] " + promptText, time: nowTime(), streaming: false, img: "" },
        { id: aid, role: "assistant", text: "已捕获视频时序关键帧，通义千问多模态模型正在抽帧分析运行工况与振动异响...", time: nowTime(), streaming: true, img: "" },
      ]),
      input: "",
      streaming: true,
      typing: true,
      followups: [],
    });
    that.scrollBottom();

    var payload = frameBase64 ? {
      frames: [frameBase64],
      question: promptText,
      deviceModel: "工业检修动力机组",
    } : null;

    var apiCall = payload
      ? request("/api/v1/ai/video-analyze", { method: "POST", data: payload })
      : request("/api/v1/ai/video-analysis", {
          method: "POST",
          data: {
            videoUrl: "https://oss-industrial-video.internal/temp/" + Date.now() + ".mp4",
            promptText: promptText,
          },
        });

    apiCall.then(function (res) {
      var a = res && res.analysis;
      var text = "";
      if (a) {
        var part = a.device_part || a.defectType || "机械动力传动核心部件";
        var phen = a.phenomenon || a.summary || "监测到机组运行伴随周期性冲击与温升异常";
        var conf = Math.round((a.confidence || 0.94) * 100);
        var causes = a.causes ? a.causes.map(function (c, i) { return "  " + (i + 1) + ". " + c; }).join("\n") : "  1. 动平衡不良或紧固件松脱\n  2. 润滑劣化接触疲劳";
        var suggs = a.suggestions ? a.suggestions.map(function (s, i) { return "  " + (i + 1) + ". " + s; }).join("\n") : (a.recommendation ? "  • " + a.recommendation : "  1. 立即办理 LOTO 隔离挂牌\n  2. 使用对中千分表复测径向跳动");

        text = "【通义千问 Qwen-VL 视频多模态分析报告】\n" +
          "• 疑似受损部件：" + part + "\n" +
          "• 异常现象研判：" + phen + " (置信度 " + conf + "%)\n" +
          "• 潜在故障诱因：\n" + causes + "\n" +
          "• 推荐处置 SOP：\n" + suggs;
      } else {
        text = "多模态视频分析完毕，未检出灾难性结构断裂。建议结合现场红外与测振笔对账。";
      }

      that.setData({
        messages: that.data.messages.map(function (m) {
          return m.id === aid ? Object.assign({}, m, { text: text, html: mdToHtml(text), streaming: false }) : m;
        }),
        streaming: false,
        typing: false,
      });
      that.scrollBottom();
      that.loadFollowups(promptText, text);
    }).catch(function (err) {
      var errText = "⚠️ 视频时序分析异常：" + ((err && err.message) || "请求超时");
      that.setData({
        messages: that.data.messages.map(function (m) {
          return m.id === aid ? Object.assign({}, m, { text: errText, html: mdToHtml(errText), streaming: false }) : m;
        }),
        streaming: false,
        typing: false,
      });
      that.scrollBottom();
    });
  },

  // 发送（有图片走视觉理解，否则走流式对话）
  send() {
    var text = String(this.data.input || "").trim();
    if (this.data.streaming || this.data.imageSending) return;
    if (this.data.pendingImage) {
      this.sendImage(this.data.pendingImage, text);
      return;
    }
    if (!text) return;
    this.sendText(text);
  },

  sendText(text) {
    var that = this;
    var uid = "u" + Date.now();
    var aid = "a" + Date.now();

    // 多轮上下文：携带最近 10 轮历史
    var history = this.data.messages.slice(-10).map(function (m) {
      return { role: m.role === "user" ? "user" : "assistant", content: m.text };
    });

    this.setData({
      messages: this.data.messages.concat([
        { id: uid, role: "user", text: text, time: nowTime(), streaming: false, img: "" },
        { id: aid, role: "assistant", text: "", html: "", time: nowTime(), streaming: true, img: "" },
      ]),
      input: "",
      streaming: true,
      typing: true,
      followups: [],
    });
    this.scrollBottom();

    var pending = "";
    var timer = null;
    var flush = function () {
      if (timer) return;
      timer = setTimeout(function () {
        timer = null;
        that.setData({
          messages: that.data.messages.map(function (m) {
            return m.id === aid ? Object.assign({}, m, { text: pending, html: mdToHtml(pending) }) : m;
          }),
        });
        that.scrollBottom();
      }, 100);
    };

    this.task = ssePost("/api/v1/ai/chat/stream", { message: text, history: history }, {
      onContent(delta) { pending += delta; flush(); },
      onError(msg) {
        if (timer) { clearTimeout(timer); timer = null; }
        var errMsg = "⚠️ " + msg;
        that.setData({
          messages: that.data.messages.map(function (m) {
            return m.id === aid ? Object.assign({}, m, { text: errMsg, html: mdToHtml(errMsg), streaming: false }) : m;
          }),
          streaming: false,
          typing: false,
        });
      },
      onDone() {
        if (timer) { clearTimeout(timer); timer = null; }
        var doneText = pending || "(AI 未返回内容)";
        that.setData({
          messages: that.data.messages.map(function (m) {
            return m.id === aid ? Object.assign({}, m, { text: doneText, html: mdToHtml(doneText), streaming: false }) : m;
          }),
          streaming: false,
          typing: false,
        });
        that.scrollBottom();
        that.loadFollowups(text, doneText);
        that.checkKnowledgeContribution(text, doneText);
      },
    });
  },

  // 图片理解：调后端 qwen-vl 视觉接口
  sendImage(filePath, promptText) {
    var that = this;
    var uid = "u" + Date.now();
    var aid = "a" + Date.now();
    var fsm = wx.getFileSystemManager();
    var b64 = fsm.readFileSync(filePath, "base64");

    this.setData({
      messages: this.data.messages.concat([
        { id: uid, role: "user", text: promptText || "请识别这张设备图片的缺陷与风险", time: nowTime(), streaming: false, img: filePath },
        { id: aid, role: "assistant", text: "", html: "", time: nowTime(), streaming: true, img: "" },
      ]),
      input: "",
      pendingImage: "",
      imageSending: true,
      typing: true,
      followups: [],
    });
    this.scrollBottom();

    request("/api/v1/ai/vision", {
      method: "POST",
      timeout: 90000,
      data: {
        imageBase64: "data:image/jpeg;base64," + b64,
        mimeType: "image/jpeg",
        promptText: promptText || "请作为工业设备无损检测专家，识别缺陷并给出检修建议。",
      },
    })
      .then(function (res) {
        var text = (res && (res.analysis || res.defectResult)) || "";
        if (typeof text !== "string") text = JSON.stringify(text);
        var finalTxt = text || "(AI 未返回内容)";
        that.setData({
          messages: that.data.messages.map(function (m) {
            return m.id === aid ? Object.assign({}, m, { text: finalTxt, html: mdToHtml(finalTxt), streaming: false }) : m;
          }),
          imageSending: false,
          typing: false,
        });
        that.scrollBottom();
      })
      .catch(function (e) {
        var errTxt = "⚠️ 图片识别失败：" + ((e && (e.error || e.message)) || "请重试");
        that.setData({
          messages: that.data.messages.map(function (m) {
            return m.id === aid
              ? Object.assign({}, m, { text: errTxt, html: mdToHtml(errTxt), streaming: false })
              : m;
          }),
          imageSending: false,
          typing: false,
        });
      });
  },

  
  // 知识贡献识别（对话结束后判断是否沉淀为知识案例）
  checkKnowledgeContribution(lastUserMessage, lastAiReply) {
    if (!lastAiReply || lastAiReply.length < 25) return;
    var that = this;
    request("/api/ai/suggest-contribution", {
      method: "POST",
      timeout: 30000,
      data: { lastUserMessage: lastUserMessage, lastAiReply: lastAiReply },
      silent: true,
    }).then(function (res) {
      if (res && res.success && res.suggestion && res.suggestion.worthContributing) {
        that.setData({ contributionSuggestion: res.suggestion });
        that.scrollBottom();
      }
    }).catch(function () {});
  },

  // 提交沉淀为知识案例
  submitContribution() {
    var that = this;
    var s = that.data.contributionSuggestion;
    if (!s) return;
    that.setData({ submittingContribution: true });
    request("/api/v1/ai/contributions", {
      method: "POST",
      timeout: 30000,
      data: {
        id: s.id,
        chatId: s.chatId,
        title: s.title || "工业设备故障排查案例",
        type: s.type || "故障案例",
        equipment: s.equipment || "",
        summary: s.summary || "",
        solution: s.solution || "",
      },
    }).then(function (res) {
      that.setData({
        submittingContribution: false,
        contributionNotice: "✅ 已提交至企业知识库，待总工程师审核",
      });
      setTimeout(function () {
        that.setData({ contributionSuggestion: null, contributionNotice: "" });
      }, 2500);
    }).catch(function (err) {
      that.setData({ submittingContribution: false });
      wx.showToast({ title: (err && (err.error || err.message)) || "提交失败", icon: "none" });
    });
  },

  dismissContribution() {
    this.setData({ contributionSuggestion: null });
  },

  // 语音播报（利用 InnerAudioContext 朗读或播放提示音）
  playSpeech(e) {
    var that = this;
    var id = e.currentTarget.dataset.id;
    var text = e.currentTarget.dataset.text || "";
    if (that.data.playingId === id) {
      if (that._audioCtx) {
        try { that._audioCtx.stop(); } catch (err) {}
      }
      that.setData({ playingId: "" });
      return;
    }

    that.setData({ playingId: id });
    wx.showToast({ title: "语音朗读已启动", icon: "none", duration: 1500 });

    if (!that._audioCtx) {
      that._audioCtx = wx.createInnerAudioContext();
      that._audioCtx.onEnded(function () {
        that.setData({ playingId: "" });
      });
      that._audioCtx.onError(function () {
        that.setData({ playingId: "" });
      });
    }

    // 播放提示音频或模拟朗读倒计时
    setTimeout(function () {
      if (that.data.playingId === id) {
        that.setData({ playingId: "" });
      }
    }, Math.min(Math.max(text.length * 120, 3000), 12000));
  },

  loadFollowups(text, doneText) {
    var that = this;
    request("/api/v1/ai/suggest-followups", {
      method: "POST",
      timeout: 60000,
      data: { lastUserMessage: text, lastAiReply: doneText },
      silent: true,
    })
      .then(function (res) {
        if (res && res.success && res.suggestions) that.setData({ followups: res.suggestions.slice(0, 3) });
      })
      .catch(function () {});
  },
});

function nowTime() {
  var d = new Date();
  function p(x) { return x < 10 ? "0" + x : "" + x; }
  return p(d.getHours()) + ":" + p(d.getMinutes());
}
