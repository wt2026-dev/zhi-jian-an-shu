// permitdoc.js - 电子作业票文档绘制（canvas 2D）
// 全部内容均来自后端接口返回的真实作业票对象，无任何 mock 数据

var PAD = 26;

function wrap(ctx, text, maxW) {
  var s = text == null || text === "" ? "-" : String(text);
  var out = [];
  var line = "";
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (line && ctx.measureText(line + ch).width > maxW) {
      out.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) out.push(line);
  return out.length ? out : ["-"];
}

// 生成确定性二维码占位矩阵（由票号哈希派生，纯展示用）
function qrMatrix(seedStr, size) {
  size = size || 13;
  var h = 2166136261;
  var s = String(seedStr || "PERMIT");
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  function rnd() {
    h ^= h << 13; h >>>= 0;
    h ^= h >> 17;
    h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  }
  var m = [];
  for (var r = 0; r < size; r++) {
    var row = [];
    for (var c = 0; c < size; c++) {
      var finder =
        (r < 3 && c < 3) || (r < 3 && c >= size - 3) || (r >= size - 3 && c < 3);
      row.push(finder ? 1 : rnd() > 0.52 ? 1 : 0);
    }
    m.push(row);
  }
  return m;
}

// 第一遍：排版并计算高度（ctx 仅用于 measureText）
function buildItems(ctx, W, doc) {
  var innerW = W - PAD * 2;
  var items = [];

  items.push({ t: "header", h: 104 });
  items.push({ t: "divider", h: 16 });
  items.push({ t: "section", h: 42, text: "一、作业信息" });
  (doc.fields || []).forEach(function (f) {
    ctx.font = "22px sans-serif";
    var lines = wrap(ctx, f.value, innerW - 160);
    items.push({ t: "kv", h: Math.max(34, lines.length * 28 + 8), label: f.label, lines: lines });
  });

  if (doc.gasTests && doc.gasTests.length) {
    items.push({ t: "divider", h: 16 });
    items.push({ t: "section", h: 42, text: "二、气体检测" });
    items.push({ t: "gashead", h: 36 });
    doc.gasTests.forEach(function (g) {
      items.push({
        t: "gas", h: 36,
        name: g.name, value: g.value, standard: g.standard, time: g.time, pass: g.pass,
      });
    });
  }

  if (doc.precautions && doc.precautions.length) {
    items.push({ t: "divider", h: 16 });
    items.push({ t: "section", h: 42, text: "三、安全措施" });
    doc.precautions.forEach(function (p, i) {
      ctx.font = "21px sans-serif";
      var lines = wrap(ctx, p, innerW - 46);
      items.push({ t: "check", h: Math.max(32, lines.length * 27 + 6), index: i + 1, lines: lines });
    });
  }

  items.push({ t: "divider", h: 16 });
  items.push({ t: "section", h: 42, text: "四、审批与签章" });
  (doc.signatures || []).forEach(function (sg) {
    items.push({ t: "sign", h: 118, sg: sg });
  });

  items.push({ t: "divider", h: 16 });
  items.push({ t: "footer", h: 132 });
  return items;
}

function totalHeight(items) {
  var h = 0;
  items.forEach(function (it) { h += it.h; });
  return h + PAD * 2;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawQr(ctx, matrix, x, y, cell) {
  if (!matrix) return;
  ctx.fillStyle = "#e5e5e5";
  for (var r = 0; r < matrix.length; r++) {
    for (var c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c]) ctx.fillRect(x + c * cell, y + r * cell, cell, cell);
    }
  }
}

// 第二遍：按排版结果绘制
function paint(ctx, W, H, items, doc, meta, matrix) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "#262626";
  ctx.lineWidth = 1;
  ctx.strokeRect(8, 8, W - 16, H - 16);

  ctx.fillStyle = "#111111";
  ctx.fillRect(PAD - 10, PAD - 10, W - (PAD - 10) * 2, H - (PAD - 10) * 2);

  var innerW = W - PAD * 2;
  var y = PAD;

  items.forEach(function (it) {
    if (it.t === "header") {
      // 票头：红色标题 + 票号 + 状态
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(PAD, y + 8, 8, 46);

      ctx.textAlign = "left";
      ctx.fillStyle = "#ef4444";
      ctx.font = "bold 34px sans-serif";
      ctx.fillText("安全作业票", PAD + 20, y + 44);

      ctx.fillStyle = "#737373";
      ctx.font = "18px sans-serif";
      ctx.fillText("工业设备智能检修与作业协同系统", PAD + 20, y + 72);

      ctx.textAlign = "right";
      ctx.fillStyle = "#a78bfa";
      ctx.font = "bold 22px sans-serif";
      ctx.fillText(doc.permitNo || "-", W - PAD, y + 34);

      ctx.fillStyle = "#737373";
      ctx.font = "18px sans-serif";
      ctx.fillText("状态: " + (doc.statusText || "-"), W - PAD, y + 60);
      ctx.fillText("风险: " + (doc.riskLevel || "-"), W - PAD, y + 84);
      ctx.textAlign = "left";
    } else if (it.t === "divider") {
      ctx.strokeStyle = "#262626";
      ctx.beginPath();
      ctx.moveTo(PAD, y + it.h / 2);
      ctx.lineTo(W - PAD, y + it.h / 2);
      ctx.stroke();
    } else if (it.t === "section") {
      ctx.fillStyle = "#22d3ee";
      ctx.fillRect(PAD, y + 10, 6, 20);
      ctx.fillStyle = "#e5e5e5";
      ctx.font = "bold 24px sans-serif";
      ctx.fillText(it.text, PAD + 16, y + 28);
    } else if (it.t === "kv") {
      ctx.fillStyle = "#737373";
      ctx.font = "20px sans-serif";
      ctx.fillText(it.label, PAD, y + 21);
      ctx.fillStyle = "#e5e5e5";
      ctx.font = "22px sans-serif";
      it.lines.forEach(function (ln, i) {
        ctx.fillText(ln, PAD + 150, y + 21 + i * 28);
      });
    } else if (it.t === "gashead") {
      ctx.fillStyle = "#1f1f1f";
      ctx.fillRect(PAD, y, innerW, 32);
      ctx.fillStyle = "#737373";
      ctx.font = "18px sans-serif";
      ctx.fillText("检测项", PAD + 10, y + 22);
      ctx.fillText("实测值", PAD + 170, y + 22);
      ctx.fillText("标准值", PAD + 280, y + 22);
      ctx.fillText("检测时间", PAD + 420, y + 22);
    } else if (it.t === "gas") {
      ctx.fillStyle = it.pass ? "#d4d4d4" : "#fb7185";
      ctx.font = "20px sans-serif";
      ctx.fillText(it.name, PAD + 10, y + 24);
      ctx.fillText(it.value, PAD + 170, y + 24);
      ctx.fillStyle = "#22d3ee";
      ctx.fillText(it.standard, PAD + 280, y + 24);
      ctx.fillStyle = "#737373";
      ctx.fillText(it.time, PAD + 420, y + 24);
    } else if (it.t === "check") {
      ctx.strokeStyle = "#34d399";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(PAD + 4, y + 14);
      ctx.lineTo(PAD + 11, y + 21);
      ctx.lineTo(PAD + 22, y + 6);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = "#d4d4d4";
      ctx.font = "21px sans-serif";
      it.lines.forEach(function (ln, i) {
        ctx.fillText(ln, PAD + 34, y + 20 + i * 27);
      });
    } else if (it.t === "sign") {
      var sg = it.sg;
      var boxH = 100;
      ctx.setLineDash(sg.signed ? [] : [6, 4]);
      ctx.strokeStyle = sg.signed ? "rgba(52,211,153,0.5)" : "#404040";
      roundRect(ctx, PAD, y + 8, innerW, boxH, 10);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "#737373";
      ctx.font = "19px sans-serif";
      ctx.fillText(sg.title, PAD + 14, y + 32);

      if (sg.signed) {
        ctx.fillStyle = "#34d399";
        ctx.font = "bold 26px sans-serif";
        ctx.fillText(sg.name || "已签署", PAD + 14, y + 66);
        ctx.fillStyle = "#737373";
        ctx.font = "18px sans-serif";
        ctx.fillText("签署时间: " + (sg.time || "-"), PAD + 14, y + 90);
        ctx.textAlign = "right";
        ctx.fillStyle = "#34d399";
        ctx.font = "bold 20px sans-serif";
        ctx.fillText("✅ 已签章", W - PAD - 14, y + 40);
        ctx.fillStyle = "#737373";
        ctx.font = "17px sans-serif";
        var cm = wrap(ctx, sg.comment || "（无审批意见）", 300)[0];
        ctx.fillText(cm, W - PAD - 14, y + 68);
        ctx.textAlign = "left";
      } else {
        ctx.fillStyle = "#525252";
        ctx.font = "22px sans-serif";
        ctx.fillText("待签署", PAD + 14, y + 66);
      }
    } else if (it.t === "footer") {
      ctx.strokeStyle = "#262626";
      ctx.beginPath();
      ctx.moveTo(PAD, y + 6);
      ctx.lineTo(W - PAD, y + 6);
      ctx.stroke();

      var qrSize = 96;
      drawQr(ctx, matrix, W - PAD - qrSize, y + 22, qrSize / (matrix ? matrix.length : 13));

      ctx.fillStyle = "#737373";
      ctx.font = "18px sans-serif";
      ctx.fillText("生成时间: " + (meta.generatedAt || "-"), PAD, y + 40);
      ctx.fillText("数据来源: 后端接口 GET /api/v1/safety-permits", PAD, y + 66);
      ctx.fillText("工业设备智能检修与作业协同系统 v2.0.0", PAD, y + 92);
      ctx.fillStyle = "#525252";
      ctx.font = "16px sans-serif";
      ctx.fillText("票号 " + (doc.permitNo || "-"), W - PAD - qrSize, y + 128);
    }
    y += it.h;
  });
}

module.exports = {
  wrap: wrap,
  qrMatrix: qrMatrix,
  buildItems: buildItems,
  totalHeight: totalHeight,
  paint: paint,
};
