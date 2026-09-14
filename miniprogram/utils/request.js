const { BASE_URL } = require("../config.js");

// 最近一次成功请求的真实耗时（ms），供"我的"页展示网络延迟，无请求时为 0
var lastLatencyMs = 0;
var lastLatencyAt = 0;

function getToken() { return wx.getStorageSync("token") || ""; }

// 登录失效：仅清理登录态，保留离线缓存等业务数据
function gotoLogin() {
  wx.removeStorageSync("token");
  wx.removeStorageSync("user");
  wx.reLaunch({ url: "/pages/login/login" });
}

function toast(msg) {
  wx.showToast({ title: String(msg || "").slice(0, 40), icon: "none", duration: 2600 });
}

/**
 * 统一错误兜底
 * - 401 / token 失效：提示并跳转登录页
 * - HTTP 非 2xx：按后端 { code, error, message } 规范化后提示
 * - 网络异常 / 超时：友好中文提示
 * 页面调用方可省略 catch；需要自定义处理时传入 opts.silent = true 自行 catch。
 */
function normalizeError(resData, statusCode) {
  var d = resData || {};
  var msg = (d.code ? "[" + d.code + "] " : "") + (d.error || d.message || ("HTTP " + statusCode));
  return Object.assign({}, d, { error: msg, statusCode: statusCode });
}

function request(path, opts) {
  opts = opts || {};
  var start = Date.now();

  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE_URL + path,
      method: opts.method || "GET",
      data: opts.data,
      timeout: opts.timeout || 30000,
      enableChunked: !!opts.enableChunked,
      header: Object.assign(
        { "Content-Type": "application/json" },
        getToken() ? { Authorization: "Bearer " + getToken() } : {},
        opts.header || {}
      ),
      success(res) {
        // 1) 登录失效：统一跳登录页
        if (res.statusCode === 401) {
          toast("登录已失效，请重新登录");
          setTimeout(gotoLogin, 600);
          reject(Object.assign({ code: "UNAUTHORIZED", error: "登录已失效" }, res.data || {}));
          return;
        }
        // 2) 其它非 2xx：统一提示 + 规范化错误对象
        if (res.statusCode >= 400) {
          var err = normalizeError(res.data, res.statusCode);
          if (!opts.silent) toast(err.error);
          reject(err);
          return;
        }
        // 3) 成功：记录真实耗时
        lastLatencyMs = Date.now() - start;
        lastLatencyAt = Date.now();
        resolve(res.data);
      },
      fail(err) {
        var msg = "网络异常，请检查网络或服务器地址";
        if (err && err.errMsg && String(err.errMsg).indexOf("timeout") >= 0) msg = "请求超时，请稍后重试";
        if (!opts.silent) toast(msg);
        reject(Object.assign({}, err || {}, { error: msg }));
      },
    });
  });
}

// 上传图片（jpg）到服务器静态目录
function uploadImage(filePath) {
  const fsm = wx.getFileSystemManager();
  const b64 = fsm.readFileSync(filePath, "base64");
  return request("/api/v1/upload/image", {
    method: "POST",
    data: { imageBase64: "data:image/jpeg;base64," + b64, filename: "mp-" + Date.now() + ".jpg" },
    timeout: 60000,
  });
}

// 最近一次请求耗时（ms）；无请求记录返回 0
function getLastLatency() { return lastLatencyMs; }
function getLastLatencyAt() { return lastLatencyAt; }

module.exports = {
  request,
  uploadImage,
  getToken,
  gotoLogin,
  getLastLatency,
  getLastLatencyAt,
  BASE_URL,
};
