var { request } = require("../../utils/request.js");

Page({
  data: {
    loading: true,
    procedures: [],
    filteredProcedures: [],
    equipTypes: ["全部机组", "泵类设备", "压缩机", "传动减速机", "大型电机", "工业机器人", "换热容器"],
    equipTypeIndex: 0,
    levels: ["全部等级", "A级大修", "B级中修", "C级小修", "常规检修", "高危特级"],
    levelIndex: 0,
    checkedMap: {}, // key: procId + '_' + stepIdx
    activeProcId: null
  },

  onLoad() {
    this.loadProcedures();
  },

  onPullDownRefresh() {
    var that = this;
    this.loadProcedures(function () {
      wx.stopPullDownRefresh();
    });
  },

  onEquipTypeChange(e) {
    this.setData({ equipTypeIndex: Number(e.detail.value) });
    this.applyFilter();
  },

  onLevelChange(e) {
    this.setData({ levelIndex: Number(e.detail.value) });
    this.applyFilter();
  },

  applyFilter() {
    var that = this;
    var eType = that.data.equipTypes[that.data.equipTypeIndex];
    var lvl = that.data.levels[that.data.levelIndex];

    var filtered = (that.data.procedures || []).filter(function (p) {
      var matchesEquip = eType === "全部机组" ||
        (p.equipment_type && p.equipment_type.indexOf(eType) !== -1) ||
        (p.equipmentType && p.equipmentType.indexOf(eType) !== -1);

      var matchesLvl = lvl === "全部等级" ||
        (p.level && p.level.indexOf(lvl) !== -1) ||
        (p.maintenanceLevel && p.maintenanceLevel.indexOf(lvl) !== -1);

      return matchesEquip && matchesLvl;
    });

    that.setData({ filteredProcedures: filtered });
  },

  loadProcedures(done) {
    var that = this;
    that.setData({ loading: true });
    request("/api/v1/procedures")
      .then(function (res) {
        var list = Array.isArray(res) ? res : (res && res.data) || [];
        if (list.length === 0) {
          // 若 procedures 表为空则从 knowledge 自动抽取结构化规程
          return request("/api/v1/knowledge").then(function (kList) {
            var converted = (kList || []).slice(0, 8).map(function (k, idx) {
              return {
                id: k.id || "proc-" + (idx + 1),
                title: k.title,
                category: k.category || "标准作业",
                level: idx % 2 === 0 ? "高危特级" : "常规检修",
                summary: k.summary || "按照工业标准检修手册执行检修消缺与合规对账",
                equipment_type: k.targetEquipment || k.equipment_type || "泵类设备",
                steps: [
                  { title: "停机隔离与MCC配电柜 380V LOTO 挂牌上锁", safetyNote: "断开断路器并挂「禁止合闸有人工作」警示牌", tools: "万用表、绝缘手套、安全锁具" },
                  { title: "现场管路介质排空与残压释放检测", safetyNote: "佩戴防化手套与防护面罩，确认表压归零", tools: "压力表校验仪、盲板" },
                  { title: "关键构件拆卸与游隙千分表激光对中测量", safetyNote: "记录轴向窜动量与径向跳动数值，偏差<0.05mm", tools: "激光对中仪、扭矩扳手" },
                  { title: "备件装配、润滑油脂加注与试车自检", safetyNote: "手动盘车无卡阻后申请拆锁送电，空载试车30min", tools: "润滑脂加注枪、振动测振笔" },
                ]
              };
            });
            that.setData({ loading: false, procedures: converted });
            that.applyFilter();
            if (typeof done === "function") done();
          });
        }
        that.setData({ loading: false, procedures: list });
        that.applyFilter();
        if (typeof done === "function") done();
      })
      .catch(function (err) {
        console.warn("Load procedures fallback:", err);
        that.setData({ loading: false });
        if (typeof done === "function") done();
      });
  },

  toggleStep(e) {
    var procid = e.currentTarget.dataset.procid;
    var sidx = e.currentTarget.dataset.sidx;
    var key = procid + "_" + sidx;
    var checkedMap = Object.assign({}, this.data.checkedMap);
    checkedMap[key] = !checkedMap[key];
    this.setData({ checkedMap: checkedMap, activeProcId: procid });
  },

  finishWork(e) {
    var procId = e.currentTarget.dataset.id;
    var proc = (this.data.procedures || []).find(function (p) { return p.id === procId; });
    if (!proc) return;

    var totalSteps = (proc.steps || []).length;
    var completedCount = 0;
    for (var i = 0; i < totalSteps; i++) {
      if (this.data.checkedMap[procId + "_" + i]) {
        completedCount++;
      }
    }

    if (completedCount < totalSteps) {
      wx.showModal({
        title: "合规步骤未完成",
        content: "当前规程共 " + totalSteps + " 个关键节点，已打卡 " + completedCount + " 项。请逐项确认执行安全隔离与工艺标准后，再行完工打卡。",
        showCancel: false,
        confirmColor: "#f59e0b"
      });
      return;
    }

    wx.showModal({
      title: "规程执行达标",
      content: "恭喜！全部 " + totalSteps + " 项标准作业与 LOTO 安全隔离要求均已逐项核验合规通过，作业得分: 100 分！",
      showCancel: false,
      confirmColor: "#10b981"
    });
  },

  generateVideo(e) {
    var procId = e.currentTarget.dataset.id;
    var proc = (this.data.procedures || []).find(function (p) { return p.id === procId; });
    if (!proc) return;
    wx.showLoading({ title: "正在生成视频脚本..." });
    request("/api/v1/procedures/" + procId + "/generate-video", { method: "POST" }).then(function (res) {
      wx.hideLoading();
      if (res && res.taskId) {
        wx.showToast({ title: "视频生成中，请稍后查看", icon: "none", duration: 3000 });
        var pollCount = 0;
        var timer = setInterval(function () {
          pollCount++;
          request("/api/v1/procedures/video-status?taskId=" + res.taskId).then(function (status) {
            if (status && status.status === "completed" && status.videoUrl) {
              clearInterval(timer);
              wx.navigateTo({ url: "/pages/procedures/video?videoUrl=" + encodeURIComponent(status.videoUrl) });
            } else if (pollCount > 60 || (status && status.status === "failed")) {
              clearInterval(timer);
              wx.showToast({ title: status.status === "failed" ? "视频生成失败" : "生成超时", icon: "none" });
            }
          }).catch(function () {
            if (pollCount > 60) { clearInterval(timer); wx.showToast({ title: "查询超时", icon: "none" }); }
          });
        }, 5000);
      } else {
        wx.showToast({ title: res.message || "视频生成已提交", icon: "none" });
      }
    }).catch(function (err) {
      wx.hideLoading();
      wx.showToast({ title: (err && err.error) || "视频生成失败", icon: "none" });
    });
  },
});
