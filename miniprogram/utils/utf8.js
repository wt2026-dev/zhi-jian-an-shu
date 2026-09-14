// 增量 UTF-8 解码器：处理 SSE 分块中跨 chunk 的多字节字符
function createUtf8Decoder() {
  var leftover = new Uint8Array(0);
  function push(u8) {
    var all = new Uint8Array(leftover.length + u8.length);
    all.set(leftover); all.set(u8, leftover.length);
    var out = "";
    var i = 0;
    while (i < all.length) {
      var b = all[i], need = 0, cp = 0;
      if (b < 0x80) { need = 0; cp = b; }
      else if ((b & 0xE0) === 0xC0) { need = 1; cp = b & 0x1F; }
      else if ((b & 0xF0) === 0xE0) { need = 2; cp = b & 0x0F; }
      else if ((b & 0xF8) === 0xF0) { need = 3; cp = b & 0x07; }
      else { i += 1; out += "\uFFFD"; continue; }
      if (i + need >= all.length) break;
      var ok = true;
      for (var k = 1; k <= need; k++) {
        var c = all[i + k];
        if ((c & 0xC0) !== 0x80) { ok = false; break; }
        cp = (cp << 6) | (c & 0x3F);
      }
      if (!ok) { i += 1; out += "\uFFFD"; continue; }
      i += need + 1;
      if (cp > 0xFFFF) {
        cp -= 0x10000;
        out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
      } else {
        out += String.fromCharCode(cp);
      }
    }
    leftover = all.slice(i);
    return out;
  }
  return { push: push };
}
module.exports = { createUtf8Decoder };