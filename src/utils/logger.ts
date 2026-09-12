import pino from "pino";

var isTest = process.env.NODE_ENV === "test";
var level = process.env.LOG_LEVEL || (isTest ? "silent" : "info");

// 注意：使用 pino.transport 时 options 会被序列化到 worker 线程，
// 不能包含自定义函数（formatters/serializers），否则日志会被静默丢弃。
var baseOptions = {
  level: level,
  timestamp: pino.stdTimeFunctions.isoTime,
};

var loggerInstance: pino.Logger;
if (isTest) {
  loggerInstance = pino(Object.assign({}, baseOptions, { level: "silent" }));
} else {
  // 控制台 + logs/app.log 按日轮转(保留 30 天) + logs/error.log 错误单独归档
  var transport = pino.transport({
    targets: [
      {
        target: "pino-roll",
        level: "info",
        options: { file: "logs/app.log", frequency: "daily", mkdir: true, limit: { count: 30 } },
      },
      {
        target: "pino-roll",
        level: "error",
        options: { file: "logs/error.log", frequency: "daily", mkdir: true, limit: { count: 30 } },
      },
      { target: "pino/file", level: level, options: { destination: 1 } },
    ],
  });
  loggerInstance = pino(baseOptions, transport);
}

export var logger = loggerInstance;
