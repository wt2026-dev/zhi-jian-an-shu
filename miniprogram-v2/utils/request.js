/**
 * 真实后端请求层
 *
 * 后端：http://localhost:3000/api/v1（开发者工具模拟器与宿主机共享 loopback）
 * 真机联调：把 BASE_URL 换成电脑局域网 IPv4 或与 V1 一致的内网穿透 https 地址，
 * 并在微信开发者工具「详情 → 本地设置」勾选「不校验合法域名」。
 *
 * 响应兼容：当前后端 controller 多返回裸业务对象/数组；部分网关或后续版本可能返回
 * { code, success, data, message }。这里统一解包，页面只拿业务数据，不再自行判断包装层。
 */
const { getToken, clearSession, redirectToLogin } = require('./auth.js');

const CONFIG = {
  BASE_URL: 'http://localhost:3000/api/v1',
  TIMEOUT: 20000
};

function createError(message, extra) {
  const err = new Error(message || '请求失败');
  if (extra && typeof extra === 'object') {
    Object.keys(extra).forEach((key) => {
      err[key] = extra[key];
    });
  }
  return err;
}

function toast(message) {
  const title = String(message || '请求失败').slice(0, 40);
  wx.showToast({ title, icon: 'none', duration: 2600 });
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isWrapped(payload) {
  if (typeof payload.success === 'boolean') return true;
  // 业务实体本身也可能带 code（如设备编码），仅当 code 为数值且伴随 data/message 时才视为包装层
  if (!hasOwn(payload, 'code')) return false;
  const numeric = payload.code !== '' && Number.isFinite(Number(payload.code));
  return numeric && (hasOwn(payload, 'data') || typeof payload.message === 'string');
}

function unwrap(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && isWrapped(payload)) {
    if (payload.success === false) {
      throw createError(payload.message || payload.error || '业务处理失败', {
        code: payload.code,
        data: payload
      });
    }
    if (hasOwn(payload, 'code') && Number(payload.code) !== 200) {
      throw createError(payload.message || payload.error || '业务处理失败 (code=' + payload.code + ')', {
        code: payload.code,
        data: payload
      });
    }
    return hasOwn(payload, 'data') ? payload.data : payload;
  }
  return payload;
}

function normalizeHttpError(payload, statusCode) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const message =
    body.message ||
    body.error ||
    body.msg ||
    (statusCode === 403 ? '当前账号无此操作权限' : '服务响应异常 (HTTP ' + statusCode + ')');
  return createError(message, {
    statusCode,
    code: body.code || 'HTTP_' + statusCode,
    data: payload
  });
}

function request(options) {
  const opts = options || {};
  const token = getToken();
  const header = Object.assign({ 'content-type': 'application/json' }, opts.header || {});
  if (token) header.Authorization = 'Bearer ' + token;

  return new Promise((resolve, reject) => {
    wx.request({
      url: CONFIG.BASE_URL + opts.url,
      method: opts.method || 'GET',
      data: opts.data,
      header,
      timeout: opts.timeout || CONFIG.TIMEOUT,
      success(res) {
        if (res.statusCode === 401) {
          clearSession();
          toast('登录已失效，请重新登录');
          setTimeout(redirectToLogin, 600);
          reject(createError('登录已失效，请重新登录', { statusCode: 401, code: 'UNAUTHORIZED', data: res.data }));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = normalizeHttpError(res.data, res.statusCode);
          if (!opts.silent) toast(err.message);
          reject(err);
          return;
        }
        try {
          resolve(unwrap(res.data));
        } catch (err) {
          if (!opts.silent) toast(err.message);
          reject(err);
        }
      },
      fail(err) {
        const reason = (err && err.errMsg) || 'request:fail';
        const message =
          reason.indexOf('timeout') >= 0
            ? '请求超时，请检查后端服务'
            : '网络连接失败，请检查后端服务与请求地址';
        if (!opts.silent) toast(message);
        reject(createError(message, { errMsg: reason, url: CONFIG.BASE_URL + opts.url }));
      }
    });
  });
}

const api = {
  // 认证
  login: (data) => request({ url: '/auth/login', method: 'POST', data }),
  wxLogin: (code) => request({ url: '/auth/wx-login', method: 'POST', data: { code } }),
  logout: () => request({ url: '/auth/logout', method: 'POST', silent: true }),
  getMe: () => request({ url: '/auth/me' }),
  getUsers: () => request({ url: '/auth/users' }),

  // 工作台
  getCockpitMetrics: () => request({ url: '/cockpit/metrics' }),
  getAbnormalEquipments: (type) =>
    request({ url: '/cockpit/abnormal-equipments', data: { type: type || 'health' } }),

  // 工单
  getWorkOrderStats: () => request({ url: '/work-orders/stats' }),
  getWorkOrders: (params) => request({ url: '/work-orders', data: params || {} }),
  getWorkOrder: (id) => request({ url: '/work-orders/' + encodeURIComponent(id) }),
  getWorkOrderLogs: (id) => request({ url: '/work-orders/' + encodeURIComponent(id) + '/logs' }),
  createWorkOrder: (data) => request({ url: '/work-orders', method: 'POST', data }),
  dispatchWorkOrder: (id, data) =>
    request({ url: '/work-orders/' + encodeURIComponent(id) + '/dispatch', method: 'POST', data }),
  claimWorkOrder: (id, data) =>
    request({ url: '/work-orders/' + encodeURIComponent(id) + '/claim', method: 'POST', data }),
  completeWorkOrder: (id, data) =>
    request({ url: '/work-orders/' + encodeURIComponent(id) + '/complete', method: 'POST', data }),
  acceptWorkOrder: (id, data) =>
    request({ url: '/work-orders/' + encodeURIComponent(id) + '/accept', method: 'POST', data }),
  transitionWorkOrder: (id, data) =>
    request({ url: '/work-orders/' + encodeURIComponent(id) + '/transition', method: 'POST', data }),

  // 巡检与隐患
  getInspections: (params) => request({ url: '/inspections', data: params || {} }),
  getInspection: (id) => request({ url: '/inspections/' + encodeURIComponent(id) }),
  updateInspection: (id, data) =>
    request({ url: '/inspections/' + encodeURIComponent(id), method: 'PATCH', data }),
  createInspection: (data) => request({ url: '/inspections', method: 'POST', data }),
  createHazard: (data) => request({ url: '/hazards', method: 'POST', data }),
  getHazards: (params) => request({ url: '/hazards', data: params || {} }),

  // 设备 / 安全锁
  getEquipments: (params) => request({ url: '/equipments', data: params || {} }),
  getLotoLocks: (params) => request({ url: '/loto-locks', data: params || {} }),

  // AI 与知识库
  aiChat: (data) => request({ url: '/ai/chat', method: 'POST', data }),
  aiRagSearch: (data) => request({ url: '/ai/rag-search', method: 'POST', data }),
  aiVisionDetect: (data) => request({ url: '/ai/vision-defect-detect', method: 'POST', data, timeout: 60000 }),
  aiRootCauseAnalysis: (data) =>
    request({ url: '/ai/root-cause-analysis', method: 'POST', data, timeout: 60000 }),
  aiMaintenancePlan: (data) =>
    request({ url: '/ai/generate-maintenance-plan', method: 'POST', data, timeout: 60000 }),
  aiGenerateWorkOrder: (data) =>
    request({ url: '/ai/generate-work-order', method: 'POST', data, timeout: 60000 }),
  aiGenerateReport: (data) =>
    request({ url: '/ai/generate-report', method: 'POST', data, timeout: 60000 }),
  searchKnowledge: (data) => request({ url: '/knowledge/search', method: 'POST', data, timeout: 30000 }),
  getKnowledgeList: (params) => request({ url: '/knowledge', data: params || {} }),
  getKnowledgeGraph: (params) => request({ url: '/knowledge/graph', data: params || {} })
};

module.exports = {
  CONFIG,
  request,
  api
};
