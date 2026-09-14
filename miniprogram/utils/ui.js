var PRIORITY = {
  urgent: { t: "紧急", c: "#FB7185" },
  high: { t: "高", c: "#FBBF24" },
  medium: { t: "中", c: "#60A5FA" },
  low: { t: "低", c: "#737373" },
};
var WO_STATUS = {
  created: { t: "待派工", c: "#737373" },
  dispatched: { t: "待接单", c: "#60A5FA" },
  in_progress: { t: "检修中", c: "#FBBF24" },
  pending_acceptance: { t: "待验收", c: "#A78BFA" },
  completed: { t: "已归档", c: "#34D399" },
  cancelled: { t: "已取消", c: "#525252" },
};
var PERMIT_STATUS = {
  pending_approval: { t: "待审批", c: "#FBBF24" },
  approved: { t: "已批准", c: "#34D399" },
  active: { t: "作业中", c: "#34D399" },
  closed: { t: "已闭环", c: "#525252" },
  rejected: { t: "已驳回", c: "#FB7185" },
};
var ROLE = {
  admin: { t: "管理员/总工", c: "#FB7185" },
  manager: { t: "安全总监", c: "#A78BFA" },
  technician: { t: "维修技师", c: "#FBBF24" },
  inspector: { t: "巡检主管", c: "#22D3EE" },
  operator: { t: "操作员", c: "#34D399" },
  archivist: { t: "档案管理员", c: "#60A5FA" },
  user: { t: "普通用户", c: "#737373" },
};
function badge(color) {
  return "color:" + color + ";background:" + color + "26;border:1rpx solid " + color + "88;";
}
function mapPriority(o) {
  var p = PRIORITY[o.priority] || PRIORITY.medium;
  return { text: p.t, style: badge(p.c) };
}
function mapStatus(o) {
  var s = WO_STATUS[o.status] || { t: o.status, c: "#737373" };
  return { text: s.t, style: badge(s.c) };
}
module.exports = { PRIORITY: PRIORITY, WO_STATUS: WO_STATUS, PERMIT_STATUS: PERMIT_STATUS, ROLE: ROLE, badge: badge, mapPriority: mapPriority, mapStatus: mapStatus };
