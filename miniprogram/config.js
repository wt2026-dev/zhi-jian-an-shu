// 后端接口地址配置
// - 开发环境：微信开发者工具的模拟器与宿主机共享 loopback，使用 127.0.0.1 最稳；
//   如需真机调试，请把 LAN_IP 换成你电脑当前的局域网 IPv4（ipconfig 查看），
//   并在微信开发者工具的「详情 → 本地设置」里勾选「不校验合法域名 / web-view / TLS」。
// - 生产环境：必须使用已备案的 https 域名，并在微信小程序后台
//   「开发管理 → 开发设置 → 服务器域名」中把该域名加入 request 合法域名。
var IS_PROD = false; // 发布正式版前改为 true

// 内网穿透 https 地址（localtunnel 临时域名，重启后会变）
var TUNNEL_URL = "https://industrial-repair.loca.lt";

module.exports = {
  IS_PROD: IS_PROD,
  BASE_URL: TUNNEL_URL,
};
