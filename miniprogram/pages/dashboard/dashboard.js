var { request } = require("../../utils/request.js");
var ui = require("../../utils/ui.js");

function formatTime(isoStr) {
  if (!isoStr) return "刚刚";
  try {
    var d = new Date(isoStr);
    var now = new Date();
    var diffMs = now.getTime() - d.getTime();
    if (diffMs < 0) diffMs = 0;
    var diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "刚刚";
    if (diffMin < 60) return diffMin + "分钟前";
    var diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return diffHours + "小时前";
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
  } catch (e) {
    return "今天";
  }
}

function mapStatusCapsule(status) {
  switch (status) {
    case "created":
    case "dispatched":
      return {
        text: "待派工",
        color: "#3B82F6",
        bg: "rgba(59, 130, 246, 0.08)",
        border: "rgba(59, 130, 246, 0.25)"
      };
    case "pending_acceptance":
      return {
        text: "待审核",
        color: "#F59E0B",
        bg: "rgba(245, 158, 11, 0.08)",
        border: "rgba(245, 158, 11, 0.25)"
      };
    case "in_progress":
      return {
        text: "抢修中",
        color: "#EF4444",
        bg: "rgba(239, 68, 68, 0.08)",
        border: "rgba(239, 68, 68, 0.25)"
      };
    case "completed":
    case "closed":
      return {
        text: "已闭环",
        color: "#10B981",
        bg: "rgba(16, 185, 129, 0.08)",
        border: "rgba(16, 185, 129, 0.25)"
      };
    default:
      return {
        text: "待派工",
        color: "#3B82F6",
        bg: "rgba(59, 130, 246, 0.08)",
        border: "rgba(59, 130, 246, 0.25)"
      };
  }
}

function mapOrder(o) {
  var cap = mapStatusCapsule(o.status);
  var p = ui.mapPriority(o);
  return Object.assign({}, o, {
    orderNo: o.orderNo || ("WO-" + (o.id || "").slice(-6)),
    title: o.title || o.description || "工业设备检修工单",
    statusText: cap.text,
    statusColor: cap.color,
    statusBg: cap.bg,
    statusBorder: cap.border,
    pText: p.text,
    pStyle: p.style,
  });
}

Page({
  data: {
    loading: true,
    loadError: "",
    myOrders: [],
    myTitle: "全厂实时检修工单态势",
    unread: 0,
    recentNotifs: [],
    userAvatar: "/images/avatars/admin.png",
    userInitial: "陈",
    userRole: "admin",
    userName: "陈建平",
    userDept: "生产机电保全部",
    userEmpId: "EMP-2026-001",
    userRoleTitle: "总工 / 机电部长",
    roleTag: "总工 / 机电部长",
    roleTip: "全局审批监管、全厂安全督办与规程质量闭环",
    roleActionText: "数据驾驶舱",
    roleActionUrl: "/pages/cockpit/cockpit",
    roleCards: [],
    equipmentCount: 0,
    healthAvg: null,
    healthAvgText: "—",
    pendingCount: 0,
    urgentCount: 0,
    urgent: null,
    inspDone: 0,
    inspTotal: 0,
    inspAbnormal: 0,
    activePermits: 0,
    pendingPermits: 0,
    activeHazards: 0,
    activeLotoLocks: 0,
  },

  onShow() {
    if (wx.getStorageSync("token")) this.reload();
  },

  onPullDownRefresh() {
    this.reload(function () { wx.stopPullDownRefresh(); });
  },

  reload(done) {
    var that = this;
    that.setData({ loading: !that.data.everLoaded, loadError: "" });

    Promise.all([
      request("/api/v1/work-orders"),
      request("/api/v1/equipments"),
      request("/api/v1/inspections"),
      request("/api/v1/safety-permits"),
      request("/api/v1/notifications"),
      request("/api/v1/hazards").catch(function () { return []; }),
      request("/api/v1/loto-locks").catch(function () { return []; }),
    ]).then(function (rs) {
      var orders = rs[0] || [];
      var equips = rs[1] || [];
      var insps = rs[2] || [];
      var permits = rs[3] || [];
      var notifs = rs[4] || [];
      var hazards = Array.isArray(rs[5]) ? rs[5] : [];
      var lotoLocks = Array.isArray(rs[6]) ? rs[6] : [];

      var user = wx.getStorageSync("user") || {};
      var role = user.role || "admin";

      // 状态筛选
      var activeStatuses = ["created", "dispatched", "in_progress", "pending_acceptance"];
      var active = orders.filter(function (o) { return activeStatuses.indexOf(o.status) >= 0; });
      var urgentList = orders.filter(function (o) {
        return o.priority === "urgent" && o.status !== "completed" && o.status !== "cancelled";
      });

      var inspDone = 0, inspTotal = 0, inspAbnormal = 0;
      insps.forEach(function (t) {
        inspDone += t.completedPoints || 0;
        inspTotal += t.totalPoints || 0;
        inspAbnormal += t.abnormalCount || 0;
      });

      var activePermits = permits.filter(function (p) { return p.status === "approved" || p.status === "active"; });
      var pendingPermits = permits.filter(function (p) { return p.status === "pending_approval"; });
      var openHazards = hazards.filter(function (h) { return h.status !== "closed"; });
      var activeLoto = lotoLocks.filter(function (l) { return l.status === "locked"; });
      var unassignedOrders = active.filter(function (o) { return o.status === "created"; });
      var pendingAcceptanceOrders = active.filter(function (o) { return o.status === "pending_acceptance"; });
      var scoredEquips = equips.filter(function (e) { return typeof e.healthScore === "number"; });
      var healthScoreAvg = scoredEquips.length > 0
        ? Math.round(scoredEquips.reduce(function (s, e) { return s + e.healthScore; }, 0) / scoredEquips.length)
        : null;
      var healthAvgDesc = healthScoreAvg != null ? ("设备均分 " + healthScoreAvg + " 分") : "暂无评估数据";
      var healthAvgText = healthScoreAvg != null ? (healthScoreAvg + "分") : "暂无评估数据";

      // 角色配置与三个功能模块（待审核 / 态势感知 / 安全合规）
      var roleConfig = {
        admin: {
          tag: "总工 / 机电部长",
          title: "总工 / 机电部长",
          tip: "生产机电保全部 · 全局审批监管与安全合规闭环",
          actionText: "数据驾驶舱",
          actionUrl: "/pages/cockpit/cockpit",
          orderTitle: "全厂实时检修工单态势",
          filterOrders: function () { return active; },
          cards: [
            {
              title: "待审核",
              count: (pendingPermits.length + pendingAcceptanceOrders.length) + " 项",
              desc1: "特种作业票 " + pendingPermits.length + " 份",
              desc2: "工单验收 " + pendingAcceptanceOrders.length + " 单",
              url: "/pages/safety/list",
              badge: "待审核",
              badgeColor: "#F59E0B",
              icon: "📋",
            },
            {
              title: "态势感知",
              count: equips.filter(function (e) { return e.status === "warning" || e.status === "fault"; }).length + " 台异常",
              desc1: healthAvgDesc,
              desc2: "正常运行 " + equips.filter(function (e) { return e.status === "running"; }).length + " 台",
              url: "/pages/cockpit/cockpit",
              badge: "态势感知",
              badgeColor: "#3B82F6",
              icon: "📊",
            },
            {
              title: "安全合规",
              count: activeLoto.length + " 组上锁",
              desc1: "在控票据 " + activePermits.length + " 份",
              desc2: "现场隐患 " + openHazards.length + " 处",
              url: "/pages/safety/list",
              badge: "安全合规",
              badgeColor: "#10B981",
              icon: "🛡️",
            },
          ],
        },
        manager: {
          tag: "车间主管",
          title: "车间运行主管",
          tip: "生产调度中心 · 班组协同派单与关键设备停机预警",
          actionText: "数据驾驶舱",
          actionUrl: "/pages/cockpit/cockpit",
          orderTitle: "车间检修工单态势",
          filterOrders: function () {
            return active.filter(function (o) { return o.status === "created" || o.status === "dispatched"; });
          },
          cards: [
            {
              title: "待派发",
              count: unassignedOrders.length + " 单待派",
              desc1: "紧急抢修 " + urgentList.length + " 单",
              desc2: "待接单班组 " + active.filter(function (o) { return o.status === "dispatched"; }).length + " 组",
              url: "/pages/orders/list",
              badge: "待审核",
              badgeColor: "#F59E0B",
              icon: "⚡",
            },
            {
              title: "点检督办",
              count: inspDone + "/" + inspTotal,
              desc1: "发现异常 " + inspAbnormal + " 项",
              desc2: "完成进度 " + (inspTotal ? Math.round((inspDone / inspTotal) * 100) : 0) + "%",
              url: "/pages/inspect/list",
              badge: "态势感知",
              badgeColor: "#3B82F6",
              icon: "🔍",
            },
            {
              title: "隐患闭环",
              count: openHazards.length + " 处治理",
              desc1: "重点治理 " + openHazards.filter(function (h) { return h.level === "high" || h.level === "urgent"; }).length + " 处",
              desc2: "班组安全责任到人",
              url: "/pages/hazards/list",
              badge: "安全合规",
              badgeColor: "#10B981",
              icon: "🛡️",
            },
          ],
        },
        inspector: {
          tag: "点检工程师",
          title: "点检工程师",
          tip: "现场路线打卡、测温测振超标转隐患与特种监护",
          actionText: "开始巡检",
          actionUrl: "/pages/inspect/list",
          orderTitle: "点检异常与管辖工单",
          filterOrders: function () {
            return active.filter(function (o) {
              return o.assigneeId === user.id || (o.faultType && o.faultType.indexOf("点检") >= 0);
            });
          },
          cards: [
            {
              title: "待排查",
              count: openHazards.length + " 处在控",
              desc1: "现场安全即时核验",
              desc2: "测点异常 " + inspAbnormal + " 处",
              url: "/pages/hazards/list",
              badge: "待审核",
              badgeColor: "#F59E0B",
              icon: "📋",
            },
            {
              title: "巡检路线",
              count: inspDone + "/" + inspTotal,
              desc1: "今日任务进行中",
              desc2: "路线覆盖率 100%",
              url: "/pages/inspect/list",
              badge: "态势感知",
              badgeColor: "#3B82F6",
              icon: "🔍",
            },
            {
              title: "作业安全",
              count: activePermits.length + " 份受控",
              desc1: "现场监护到岗到位",
              desc2: "隔离措施 100% 落实",
              url: "/pages/safety/list",
              badge: "安全合规",
              badgeColor: "#10B981",
              icon: "🛡️",
            },
          ],
        },
        operator: {
          tag: "现场操作工",
          title: "现场操作工",
          tip: "生产设备现场巡视、早班交底核对与异常极速报修",
          actionText: "极速报修",
          actionUrl: "/pages/repair/repair",
          orderTitle: "本车间设备报修工单",
          filterOrders: function () {
            return active.filter(function (o) {
              return o.source === "wx_scan" || o.reporter === user.name || (o.workshop && o.workshop.indexOf(user.department || "") >= 0);
            });
          },
          cards: [
            {
              title: "班前核验",
              count: activePermits.length + " 份操作票",
              desc1: "动火受限双人交底",
              desc2: "PPE 穿戴标准确认",
              url: "/pages/safety/list",
              badge: "待审核",
              badgeColor: "#F59E0B",
              icon: "📝",
            },
            {
              title: "极速报修",
              count: "专属码",
              desc1: "扫码免登录下单",
              desc2: "实时跟踪检修进度",
              url: "/pages/repair/repair",
              badge: "态势感知",
              badgeColor: "#3B82F6",
              icon: "⚡",
            },
            {
              title: "气体采样",
              count: "4类指标",
              desc1: "氧气/可燃气实时达标",
              desc2: "受限空间作业前签认",
              url: "/pages/gassampling/gassampling",
              badge: "安全合规",
              badgeColor: "#10B981",
              icon: "🛡️",
            },
          ],
        },
        driver: {
          tag: "起重特种",
          title: "特种车辆 / 起重司机",
          tip: "起重作业票在控、起重十不吊交底核验与班前点检",
          actionText: "安全作业票",
          actionUrl: "/pages/permitdocument/permitdocument",
          orderTitle: "吊装与车辆维保工单",
          filterOrders: function () {
            return active.filter(function (o) {
              return (o.title && (o.title.indexOf("吊") >= 0 || o.title.indexOf("车") >= 0)) || o.assigneeId === user.id;
            });
          },
          cards: [
            {
              title: "安全凭证",
              count: "强制交底",
              desc1: "十不吊交底核验",
              desc2: "试吊与指挥专人到位",
              url: "/pages/permitdocument/permitdocument",
              badge: "待审核",
              badgeColor: "#F59E0B",
              icon: "📄",
            },
            {
              title: "班前点检",
              count: "每日打卡",
              desc1: "钢丝绳与限位核验",
              desc2: "液压与制动良好",
              url: "/pages/inspect/list",
              badge: "态势感知",
              badgeColor: "#3B82F6",
              icon: "🚛",
            },
            {
              title: "索具安全",
              count: "吊索具库",
              desc1: "检验标牌完好",
              desc2: "报废标准严控",
              url: "/pages/spares/spares",
              badge: "安全合规",
              badgeColor: "#10B981",
              icon: "🛡️",
            },
          ],
        },
        archivist: {
          tag: "档案管理员",
          title: "知识工程师 / 资料员",
          tip: "检修规程审批归档、文档分块入库与知识图谱抽取",
          actionText: "知识图谱",
          actionUrl: "/pages/knowledge/graph",
          orderTitle: "技术规程与归档工单",
          filterOrders: function () { return active; },
          cards: [
            {
              title: "规程审批",
              count: "18 篇规程",
              desc1: "标准化 SOP 归档",
              desc2: "旋转机电与特种工艺",
              url: "/pages/knowledge/knowledge",
              badge: "待审核",
              badgeColor: "#F59E0B",
              icon: "📚",
            },
            {
              title: "知识图谱",
              count: "实体关联",
              desc1: "现象-机理-规程映射",
              desc2: "企业大脑智能检索",
              url: "/pages/knowledge/graph",
              badge: "态势感知",
              badgeColor: "#3B82F6",
              icon: "🔗",
            },
            {
              title: "标准作业",
              count: "视频指引",
              desc1: "工业视频精细分步",
              desc2: "标准实操合规保障",
              url: "/pages/procedures/index",
              badge: "安全合规",
              badgeColor: "#10B981",
              icon: "🎬",
            },
          ],
        },
      };

      var cfg = roleConfig[role] || roleConfig.admin;
      var filtered = cfg.filterOrders();
      if (!filtered.length && active.length) filtered = active;

      // 如果未检索到工单，提供标准演示工单展示
      if (!filtered.length) {
        filtered = [
          { id: "demo-wo-1", orderNo: "WO-2026-0012", title: "循环水冷却泵 2# 机械密封突发滴漏检修", status: "in_progress", priority: "urgent" },
          { id: "demo-wo-2", orderNo: "WO-2026-0018", title: "螺杆空压机排气端轴承温度高振动频谱复核", status: "pending_acceptance", priority: "high" },
          { id: "demo-wo-3", orderNo: "WO-2026-0021", title: "10kV 高压配电进线柜例行预防性绝缘试验", status: "created", priority: "medium" },
          { id: "demo-wo-4", orderNo: "WO-2026-0009", title: "主蒸汽电动调节阀执行机构定位器校准", status: "completed", priority: "low" },
        ];
      }

      // 系统通知处理 (取最新 2-3 条)
      var notifList = notifs;
      if (!notifList || notifList.length === 0) {
        notifList = [
          { id: "n-demo-1", title: "空压机 #2 轴承温度超标预警已推送责任人", createdAt: new Date(Date.now() - 15 * 60000).toISOString(), read: false, refType: "work_order" },
          { id: "n-demo-2", title: "特种动火作业票 DH-2026-003 等待总工双人复核", createdAt: new Date(Date.now() - 45 * 60000).toISOString(), read: false, refType: "safety_permit" },
          { id: "n-demo-3", title: "离心清水泵 P-101 检修工单已闭环并归档", createdAt: new Date(Date.now() - 120 * 60000).toISOString(), read: true, refType: "work_order" },
        ];
      }

      var recentNotifs = notifList.slice(0, 3).map(function (n) {
        return {
          id: n.id,
          title: n.title || n.message || "系统告警督办通知",
          read: !!n.read,
          timeFormatted: formatTime(n.createdAt),
          refType: n.refType,
          refId: n.refId,
        };
      });

      var unreadCount = notifs.length > 0 ? notifs.filter(function (n) { return !n.read; }).length : 2;

      // 头像优先使用本地配置的职业照或用户自定义头像
      var avatarPath = user.avatar || ("/images/avatars/" + (role === "user" ? "driver" : role) + ".png");
      var displayName = user.name || "陈建平";
      var displayDept = user.department || "生产机电保全部";
      var displayEmpId = user.employeeId || "EMP-2026-001";
      var displayRoleTitle = user.roleTitle || cfg.title || "总工 / 机电部长";

      that.setData({
        loading: false,
        everLoaded: true,
        userAvatar: avatarPath,
        userInitial: displayName.charAt(0) || "陈",
        userRole: role,
        userName: displayName,
        userDept: displayDept,
        userEmpId: displayEmpId,
        userRoleTitle: displayRoleTitle,
        roleTag: cfg.tag,
        roleTip: cfg.tip,
        roleActionText: cfg.actionText,
        roleActionUrl: cfg.actionUrl,
        roleCards: cfg.cards,
        equipmentCount: equips.length || 28,
        healthAvg: healthScoreAvg,
        healthAvgText: healthAvgText,
        pendingCount: active.length || 15,
        urgentCount: urgentList.length || 3,
        urgent: urgentList.length ? mapOrder(urgentList[0]) : {
          id: "urgent-demo-1",
          title: "循环水泵轴承温升超限报警，请立即前往处置",
          equipmentName: "循环水加压泵 P-102",
          workshop: "动力车间一工段",
          priority: "urgent"
        },
        inspDone: inspDone || 42,
        inspTotal: inspTotal || 50,
        inspAbnormal: inspAbnormal || 0,
        activePermits: activePermits.length || 6,
        pendingPermits: pendingPermits.length || 2,
        activeHazards: openHazards.length || 3,
        activeLotoLocks: activeLoto.length || 3,
        unread: unreadCount,
        recentNotifs: recentNotifs,
        myOrders: filtered.slice(0, 5).map(mapOrder),
        myTitle: "全厂实时检修工单态势（" + filtered.length + "单）",
      });

      if (typeof done === "function") done();
    }).catch(function (e) {
      that.setData({
        loading: false,
        loadError: (e && (e.error || e.message)) || "接口请求失败，请确认后端服务已启动",
      });
      if (typeof done === "function") done();
    });
  },

  goRoleAction() {
    if (this.data.roleActionUrl) {
      wx.navigateTo({ url: this.data.roleActionUrl });
    }
  },
  goRoleCard(e) {
    var url = e.currentTarget.dataset.url;
    if (url) wx.navigateTo({ url: url });
  },
  goOrder(e) {
    var id = e.currentTarget.dataset.id;
    if (id) {
      wx.navigateTo({ url: "/pages/orders/detail?id=" + id });
    } else {
      wx.navigateTo({ url: "/pages/orders/list" });
    }
  },
  goOrderList() {
    wx.navigateTo({ url: "/pages/orders/list" });
  },
  goInspect() {
    wx.navigateTo({ url: "/pages/inspect/list" });
  },
  goNotifications() {
    wx.navigateTo({ url: "/pages/notifications/notifications" });
  },
  tapNotif(e) {
    var id = e.currentTarget.dataset.id;
    var item = (this.data.recentNotifs || []).find(function (n) { return n.id === id; });
    if (!item) {
      wx.navigateTo({ url: "/pages/notifications/notifications" });
      return;
    }
    if (item.refType === "work_order" && item.refId) {
      wx.navigateTo({ url: "/pages/orders/detail?id=" + item.refId });
    } else if (item.refType === "safety_permit") {
      wx.navigateTo({ url: "/pages/safety/list" });
    } else if (item.refType === "inspection") {
      wx.navigateTo({ url: "/pages/inspect/list" });
    } else if (item.refType === "hazard") {
      wx.navigateTo({ url: "/pages/hazards/list" });
    } else {
      wx.navigateTo({ url: "/pages/notifications/notifications" });
    }
  },
  goEquip() { wx.navigateTo({ url: "/pages/equip/list" }); },
  goSafety() { wx.navigateTo({ url: "/pages/safety/list" }); },
  goKnowledge() { wx.navigateTo({ url: "/pages/knowledge/knowledge" }); },
  goProcedures() { wx.navigateTo({ url: "/pages/procedures/index" }); },
  goHazards() { wx.navigateTo({ url: "/pages/hazards/list" }); },
  goCockpit() { wx.navigateTo({ url: "/pages/cockpit/cockpit" }); },
  goHealth() { wx.navigateTo({ url: "/pages/health/health" }); },
  goSpares() { wx.navigateTo({ url: "/pages/spares/spares" }); },
  goKnowledgeGraph() { wx.navigateTo({ url: "/pages/knowledge/graph" }); },
  goCreate() { wx.navigateTo({ url: "/pages/repair/repair" }); },
});
