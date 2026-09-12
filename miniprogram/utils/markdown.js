/**
 * miniprogram/utils/markdown.js
 * 轻量 Markdown -> HTML 转换器（适配微信小程序 <rich-text nodes="{{html}}" />）
 * 支持：
 * 1. ### / ## / # 标题
 * 2. **加粗**、*斜体*
 * 3. `行内代码`
 * 4. ```代码块
 * 5. > 引用
 * 6. - / * 无序列表，1. 有序列表
 * 7. | 表格 | 转 <table> 并提供横向滚动包裹容器
 * 8. \n 换行转 <br/>
 */

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mdToHtml(md) {
  if (!md) return '';
  if (typeof md !== 'string') md = String(md);

  // 1. 暂存代码块（避免代码块内部的 *、#、| 被后续逻辑误伤）
  var codeBlocks = [];
  var text = md.replace(/```([\s\S]*?)```/g, function (match, p1) {
    var placeholder = '@@@CODEBLOCK_' + codeBlocks.length + '@@@';
    var lines = p1.split('\n');
    var lang = '';
    var codeContent = p1;
    if (lines.length > 1 && /^[a-zA-Z0-9_-]+$/.test(lines[0].trim())) {
      lang = lines[0].trim();
      codeContent = lines.slice(1).join('\n');
    }
    var escapedCode = escapeHtml(codeContent.replace(/^\n+|\n+$/g, ''));
    var html = '<div style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;margin:8px 0;font-family:monospace;font-size:12px;overflow-x:auto;color:#0f172a;line-height:1.5;">' +
      (lang ? '<div style="font-size:10px;color:#64748b;margin-bottom:4px;text-transform:uppercase;font-weight:bold;">' + lang + '</div>' : '') +
      '<div style="margin:0;white-space:pre-wrap;word-break:break-all;font-family:monospace;">' + escapedCode + '</div>' +
      '</div>';
    codeBlocks.push(html);
    return placeholder;
  });

  // 2. 逐行处理行级结构（表格、标题、列表、引用）
  var lines = text.split(/\r?\n/);
  var outLines = [];
  var inTable = false;
  var tableRows = [];

  var flushTable = function () {
    if (!inTable) return;
    inTable = false;
    if (tableRows.length === 0) return;

    var headerRow = tableRows[0];
    var bodyRows = tableRows.slice(1);

    var tableHtml = '<div style="overflow-x:auto;margin:8px 0;max-width:100%;-webkit-overflow-scrolling:touch;">' +
      '<table style="border-collapse:collapse;min-width:100%;font-size:12px;border:1px solid #cbd5e1;background:#ffffff;">';

    if (headerRow) {
      tableHtml += '<thead style="background:#f8fafc;"><tr>';
      headerRow.forEach(function (cell) {
        tableHtml += '<th style="border:1px solid #cbd5e1;padding:6px 10px;font-weight:bold;color:#1e293b;text-align:left;white-space:nowrap;background:#f8fafc;">' + formatInline(cell) + '</th>';
      });
      tableHtml += '</tr></thead>';
    }

    if (bodyRows.length > 0) {
      tableHtml += '<tbody>';
      bodyRows.forEach(function (row, rIdx) {
        var bg = rIdx % 2 === 1 ? '#f8fafc' : '#ffffff';
        tableHtml += '<tr style="background:' + bg + ';">';
        row.forEach(function (cell) {
          tableHtml += '<td style="border:1px solid #cbd5e1;padding:6px 10px;color:#334155;word-break:break-word;">' + formatInline(cell) + '</td>';
        });
        tableHtml += '</tr>';
      });
      tableHtml += '</tbody>';
    }

    tableHtml += '</table></div>';
    outLines.push(tableHtml);
    tableRows = [];
  };

  for (var i = 0; i < lines.length; i++) {
    var rawLine = lines[i];
    var trimmed = rawLine.trim();

    // 检查表格行：形如 | col1 | col2 |
    if (/^\|(.+)\|$/.test(trimmed)) {
      // 检查是否是分割线，如 | --- | :---: |
      var isSeparator = /^\|(\s*:?-+:?\s*\|)+$/.test(trimmed);
      if (!isSeparator) {
        var cols = trimmed.slice(1, -1).split('|').map(function (c) { return c.trim(); });
        inTable = true;
        tableRows.push(cols);
      }
      continue;
    } else {
      if (inTable) {
        flushTable();
      }
    }

    // 处理代码块占位符行
    if (/^@@@CODEBLOCK_\d+@@@$/.test(trimmed)) {
      outLines.push(trimmed);
      continue;
    }

    // 标题
    if (/^#{1,6}\s+/.test(trimmed)) {
      var level = trimmed.match(/^(#{1,6})\s+/)[1].length;
      var titleText = trimmed.replace(/^#{1,6}\s+/, '');
      var fSize = level === 1 ? '16px' : (level === 2 ? '15px' : '14px');
      var color = level <= 2 ? '#0f172a' : '#1e293b';
      outLines.push('<div style="font-size:' + fSize + ';font-weight:bold;color:' + color + ';margin:10px 0 6px 0;line-height:1.4;">' + formatInline(titleText) + '</div>');
      continue;
    }

    // 引用：> 文本
    if (/^>\s+/.test(trimmed)) {
      var quoteText = trimmed.replace(/^>\s+/, '');
      outLines.push('<div style="border-left:4px solid #3b82f6;padding:4px 10px;margin:6px 0;background:#eff6ff;color:#1e40af;border-radius:0 6px 6px 0;font-size:12px;">' + formatInline(quoteText) + '</div>');
      continue;
    }

    // 无序列表：- 或 * 或 +
    if (/^[-*+]\s+/.test(trimmed)) {
      var liText = trimmed.replace(/^[-*+]\s+/, '');
      outLines.push('<div style="display:flex;align-items:flex-start;margin:3px 0;padding-left:4px;font-size:13px;line-height:1.6;">' +
        '<span style="display:inline-block;color:#3b82f6;margin-right:6px;font-size:14px;line-height:1.4;">•</span>' +
        '<span style="flex:1;">' + formatInline(liText) + '</span>' +
        '</div>');
      continue;
    }

    // 有序列表：1. 2.
    if (/^\d+\.\s+/.test(trimmed)) {
      var numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
      if (numMatch) {
        outLines.push('<div style="display:flex;align-items:flex-start;margin:3px 0;padding-left:4px;font-size:13px;line-height:1.6;">' +
          '<span style="display:inline-block;color:#3b82f6;font-weight:bold;margin-right:6px;min-width:18px;font-size:12px;font-family:monospace;">' + numMatch[1] + '.</span>' +
          '<span style="flex:1;">' + formatInline(numMatch[2]) + '</span>' +
          '</div>');
        continue;
      }
    }

    // 空行
    if (trimmed === '') {
      outLines.push('<div style="height:6px;"></div>');
      continue;
    }

    // 普通行
    outLines.push('<div style="margin:2px 0;line-height:1.6;font-size:13px;">' + formatInline(rawLine) + '</div>');
  }

  if (inTable) {
    flushTable();
  }

  var finalHtml = outLines.join('');

  // 3. 还原代码块
  finalHtml = finalHtml.replace(/@@@CODEBLOCK_(\d+)@@@/g, function (match, p1) {
    var idx = parseInt(p1, 10);
    return codeBlocks[idx] || '';
  });

  return finalHtml;
}

/** 行内样式替换：加粗、行内代码、斜体 */
function formatInline(str) {
  if (!str) return '';
  var res = escapeHtml(str);

  // 行内代码 `code`
  res = res.replace(/`([^`]+)`/g, '<span style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;padding:1px 5px;font-family:monospace;font-size:12px;color:#0284c7;">$1</span>');

  // **加粗**
  res = res.replace(/\*\*([^*]+)\*\*/g, '<strong style="font-weight:bold;color:#0f172a;">$1</strong>');

  // *斜体*
  res = res.replace(/\*([^*]+)\*/g, '<em style="font-style:italic;">$1</em>');

  return res;
}

module.exports = {
  mdToHtml: mdToHtml,
  escapeHtml: escapeHtml,
};
