var { request } = require("../../utils/request.js");

Page({
  data: {
    title: "",
    levels: [
      { id: "general", name: "一般隐患 (限期班组消缺)" },
      { id: "major", name: "重大隐患 (厂级重点督办)" }
    ],
    levelIndex: 0,
    categories: ["机械安全", "电气安全", "压力容器", "腐蚀渗漏", "消防安全", "高空作业"],
    categoryIndex: 0,
    equipments: [],
    eqIndex: 0,
    location: "",
    description: "",
    photoPath: "",
    submitting: false,
  },

  onLoad() {
    var that = this;
    request("/api/v1/equipments").then(function (res) {
      var list = Array.isArray(res) ? res : [];
      that.setData({ equipments: list });
    }).catch(function () {});
  },

  onInputTitle(e) { this.setData({ title: e.detail.value }); },
  onLevelChange(e) { this.setData({ levelIndex: parseInt(e.detail.value) || 0 }); },
  onCategoryChange(e) { this.setData({ categoryIndex: parseInt(e.detail.value) || 0 }); },
  onEqChange(e) { this.setData({ eqIndex: parseInt(e.detail.value) || 0 }); },
  onInputLocation(e) { this.setData({ location: e.detail.value }); },
  onInputDesc(e) { this.setData({ description: e.detail.value }); },

  choosePhoto() {
    var that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["camera", "album"],
      success: function (res) {
        var f = res.tempFiles && res.tempFiles[0];
        if (f) {
          that.setData({ photoPath: f.tempFilePath });
        }
      }
    });
  },

  submitHazard() {
    var d = this.data;
    if (!d.title.trim()) {
      wx.showToast({ title: "请填写隐患标题", icon: "none" });
      return;
    }
    if (!d.description.trim()) {
      wx.showToast({ title: "请描述现场征兆", icon: "none" });
      return;
    }

    var that = this;
    var user = wx.getStorageSync("user") || {};
    var selectedEq = d.equipments[d.eqIndex] || {};

    that.setData({ submitting: true });
    wx.showLoading({ title: "上报建档中..." });

    var postData = {
      code: "HAZ-" + Date.now().toString().slice(-6),
      title: d.title.trim(),
      level: d.levels[d.levelIndex].id,
      category: d.categories[d.categoryIndex],
      equipment_id: selectedEq.id || "",
      equipment_name: selectedEq.name || "公共机房设备",
      location: d.location.trim() || selectedEq.workshop || "车间",
      description: d.description.trim(),
      reported_by: user.name || "现场巡检员",
      deadline: d.levels[d.levelIndex].id === "major" ? "2026-03-11" : "2026-03-15",
    };

    if (d.photoPath) {
      try {
        var fsm = wx.getFileSystemManager();
        var b64 = fsm.readFileSync(d.photoPath, "base64");
        postData.photo = "data:image/jpeg;base64," + b64;
      } catch (e) {
        console.warn("Read hazard photo failed:", e);
      }
    }

    request("/api/v1/hazards", {
      method: "POST",
      data: postData
    }).then(function () {
      wx.hideLoading();
      wx.showToast({ title: "隐患已成功建档", icon: "success" });
      setTimeout(function () {
        wx.navigateBack();
      }, 1200);
    }).catch(function (err) {
      wx.hideLoading();
      that.setData({ submitting: false });
      wx.showToast({ title: (err && err.message) || "上报失败", icon: "none" });
    });
  }
});
