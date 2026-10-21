// 真实枚举值 → 中文标签，以及所有列表共用的时间/数值格式化
const PRIORITY_LABELS = {
  urgent: '紧急',
  high: '高',
  medium: '中',
  low: '低'
};

const STATUS_LABELS = {
  created: '待派单',
  dispatched: '待接单',
  in_progress: '检修中',
  pending_acceptance: '待验收',
  completed: '已归档',
  cancelled: '已取消'
};

const INSPECTION_STATUS_LABELS = {
  pending: '待开始',
  in_progress: '进行中',
  completed: '已完成',
  cancelled: '已取消'
};

const INSPECTION_ITEM_STATUS_LABELS = {
  pending: '待检',
  normal: '正常',
  abnormal: '异常'
};

const EQUIPMENT_STATUS_LABELS = {
  running: '运行中',
  normal: '正常',
  standby: '备用',
  warning: '预警',
  fault: '故障',
  critical: '严重',
  overhauling: '检修中',
  offline: '离线'
};

const ROLE_LABELS = {
  admin: '总工 / 机电部长',
  manager: '车间安全总监 / 维保主管',
  technician: '机电检修技师',
  inspector: '点检工程师 / 安全监护',
  operator: '现场操作工',
  archivist: '技术档案管理员'
};

const PERMISSION_LABELS = {
  all: '全部权限',
  dispatch: '派单',
  safety_final_approval: '安全终审',
  work_order_audit: '工单审核',
  delete_permit: '删除作业票',
  claim_order: '接单',
  complete_order: '完工上报',
  safety_apply: '作业申请',
  inspect_task: '巡检任务',
  hazard_report: '隐患上报'
};

const SEVERITY_LABELS = {
  high: '高危',
  medium: '一般'
};

const HAZARD_LEVEL_LABELS = {
  major: '重大',
  general: '一般'
};

const HAZARD_STATUS_LABELS = {
  pending: '待整改',
  rectifying: '整改中',
  verifying: '待复核',
  closed: '已闭环'
};

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  let text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const d = new Date(text);
    return isNaN(d.getTime()) ? null : d;
  }
  const normalized = text.replace(/\//g, '-').replace(' ', 'T');
  const d = new Date(normalized);
  if (!isNaN(d.getTime())) return d;
  return null;
}

function formatDateTime(value) {
  const d = parseDate(value);
  if (!d) return value ? String(value) : '—';
  return (
    d.getFullYear() +
    '-' + pad2(d.getMonth() + 1) +
    '-' + pad2(d.getDate()) +
    ' ' + pad2(d.getHours()) +
    ':' + pad2(d.getMinutes())
  );
}

function formatDate(value) {
  const d = parseDate(value);
  if (!d) return value ? String(value) : '—';
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function todayKeys() {
  const d = new Date();
  return {
    iso: d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()),
    slash: d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate())
  };
}

function isToday(value) {
  if (!value) return false;
  const text = String(value);
  const keys = todayKeys();
  return text.indexOf(keys.iso) === 0 || text.indexOf(keys.slash) === 0;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return isFinite(n) ? n : null;
}

function formatNumber(value, fallback) {
  if (typeof value === 'number' && isFinite(value)) return value;
  if (value !== null && value !== undefined && value !== '' && isFinite(Number(value))) return Number(value);
  return fallback === undefined ? '—' : fallback;
}

function formatPercent(value) {
  const n = toNumberOrNull(value);
  if (n === null) return '—';
  return (Math.round(n * 10) / 10) + '%';
}

function progressWidth(completed, total) {
  const c = toNumberOrNull(completed);
  const t = toNumberOrNull(total);
  if (c === null || t === null || t <= 0) return 0;
  const rate = Math.max(0, Math.min(100, (c / t) * 100));
  return Math.round(rate * 10) / 10;
}

function healthText(score) {
  if (typeof score !== 'number' || !isFinite(score)) return '未评估';
  return String(Math.round(score));
}

function healthLevel(score) {
  if (typeof score !== 'number' || !isFinite(score)) return '未评估';
  if (score >= 90) return '优秀';
  if (score >= 75) return '良好';
  if (score >= 60) return '需关注';
  return '预警';
}

function priorityLabel(value) {
  return PRIORITY_LABELS[value] || (value ? String(value) : '未定级');
}

function statusLabel(value) {
  return STATUS_LABELS[value] || (value ? String(value) : '未知状态');
}

function inspectionStatusLabel(value) {
  return INSPECTION_STATUS_LABELS[value] || (value ? String(value) : '未知状态');
}

function inspectionItemStatusLabel(value) {
  return INSPECTION_ITEM_STATUS_LABELS[value] || (value ? String(value) : '待检');
}

function equipmentStatusLabel(value) {
  return EQUIPMENT_STATUS_LABELS[value] || (value ? String(value) : '未评估');
}

function roleLabel(user) {
  if (!user) return '未登录';
  return user.roleTitle || ROLE_LABELS[user.role] || user.role || '现场人员';
}

function permissionLabel(value) {
  return PERMISSION_LABELS[value] || value;
}

function severityLabel(value) {
  return SEVERITY_LABELS[value] || (value ? String(value) : '一般');
}

function hazardLevelLabel(value) {
  return HAZARD_LEVEL_LABELS[value] || (value ? String(value) : '一般');
}

function hazardStatusLabel(value) {
  return HAZARD_STATUS_LABELS[value] || (value ? String(value) : '待整改');
}

module.exports = {
  PRIORITY_LABELS,
  STATUS_LABELS,
  INSPECTION_STATUS_LABELS,
  EQUIPMENT_STATUS_LABELS,
  ROLE_LABELS,
  parseDate,
  formatDateTime,
  formatDate,
  isToday,
  toNumberOrNull,
  formatNumber,
  formatPercent,
  progressWidth,
  healthText,
  healthLevel,
  priorityLabel,
  statusLabel,
  inspectionStatusLabel,
  inspectionItemStatusLabel,
  equipmentStatusLabel,
  roleLabel,
  permissionLabel,
  severityLabel,
  hazardLevelLabel,
  hazardStatusLabel
};
