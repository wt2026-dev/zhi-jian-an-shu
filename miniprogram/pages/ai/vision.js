var { request } = require("../../utils/request.js");
var ui = require("../../utils/ui.js");

Page({
  data: {
    imgPath: "",
    loading: false,
    result: null,
    error: "",
    sevStyle: "",
    similarCases: [],
    loadingCases: false,
    casesLoaded: false,
  },

  choose() {
    var that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success(r) {
        var fp = r.tempFiles[0].tempFilePath;
        that.setData({
          imgPath: fp,
          loading: true,
          result: null,
          error: "",
          similarCases: [],
          casesLoaded: false,
        });
        var fsm = wx.getFileSystemManager();
        var b64 = fsm.readFileSync(fp, "base64");
        request("/api/v1/ai/vision-defect-detect", {
          method: "POST",
          timeout: 90000,
          data: {
            imageBase64: "data:image/jpeg;base64," + b64,
            equipmentType: "旋转机电设备",
          },
        })
          .then(function (res) {
            if (res.success && res.defectResult) {
              var dr = res.defectResult;
              var c = dr.severity === "严重" ? "#EF4444" : dr.severity === "较大" ? "#F59E0B" : "#10B981";
              that.setData({
                loading: false,
                result: dr,
                sevStyle: ui.badge(c),
              });
              // 自动预拉取相似知识库案例
              that.loadSimilarCases(dr.defectType || "机械检修");
            } else {
              that.setData({ loading: false, error: res.message || res.error || "识别失败" });
            }
          })
          .catch(function (e) {
            that.setData({ loading: false, error: (e && (e.message || e.error)) || "调用失败" });
          });
      },
    });
  },

  loadSimilarCases(keyword) {
    var that = this;
    that.setData({ loadingCases: true });
    var kw = keyword || (that.data.result && that.data.result.defectType) || "机械";
    request("/api/v1/knowledge/search?keyword=" + encodeURIComponent(kw), { silent: true })
      .then(function (res) {
        var list = Array.isArray(res) ? res : (res && res.data) || [];
        that.setData({
          loadingCases: false,
          casesLoaded: true,
          similarCases: list.slice(0, 4),
        });
      })
      .catch(function () {
        that.setData({ loadingCases: false, casesLoaded: true, similarCases: [] });
      });
  },

  goKnowledgeDetail(e) {
    var id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: "/pages/knowledge/knowledge?id=" + (id || "") });
  },

  goRepair() {
    var dr = this.data.result;
    var desc = dr ? "【AI视觉质检报修】" + dr.defectType + "：" + dr.summary : "";
    wx.navigateTo({
      url: "/pages/repair/repair?desc=" + encodeURIComponent(desc),
    });
  },
});
