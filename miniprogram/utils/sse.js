var { BASE_URL, getToken } = require("./request.js");
var { createUtf8Decoder } = require("./utf8.js");

// SSE 流式请求（微信小程序分块传输）
// onContent(增量文本) / onError(错误信息) / onDone(完整文本)
function ssePost(path, data, handlers) {
  var decoder = createUtf8Decoder();
  var buf = "";
  var full = "";
  var doneFired = false;
  var task = wx.request({
    url: BASE_URL + path,
    method: "POST",
    data: data,
    timeout: 120000,
    enableChunked: true,
    header: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + getToken(),
    },
    success() {
      if (!doneFired) { doneFired = true; handlers.onDone(full); }
    },
    fail(err) {
      if (!doneFired) { doneFired = true; handlers.onError(err.errMsg || "网络异常"); }
    },
  });
  task.onChunkReceived(function (res) {
    var u8 = new Uint8Array(res.data);
    buf += decoder.push(u8);
    var parts = buf.split("\n\n");
    buf = parts.pop() || "";
    for (var i = 0; i < parts.length; i++) {
      var line = parts[i].trim();
      if (line.indexOf("data:") !== 0) continue;
      var payload = line.slice(5).trim();
      if (payload === "[DONE]") {
        if (!doneFired) { doneFired = true; handlers.onDone(full); }
        return;
      }
      try {
        var j = JSON.parse(payload);
        if (j.content) { full += j.content; handlers.onContent(j.content); }
        if (j.error) { if (!doneFired) { doneFired = true; handlers.onError(j.error); } }
      } catch (e) { /* 忽略无法解析的帧 */ }
    }
  });
  return task;
}
module.exports = { ssePost };