var { request } = require("../../utils/request.js");
var { mdToHtml } = require("../../utils/markdown.js");

Page({
  data: { kw: "", results: [], loading: false },
  onLoad() { this.doSearch(); },
  onKw(e) { this.setData({ kw: e.detail.value }); },
  doSearch() {
    var that = this, kw = this.data.kw.trim();
    that.setData({ loading: true });
    if (!kw) {
      request("/api/v1/knowledge").then(function (list) {
        that.setData({ results: (list || []).map(openable), loading: false });
      }).catch(function () { that.setData({ results: [], loading: false }); });
      return;
    }
    request("/api/v1/knowledge/search", { method: "POST", data: { query: kw, limit: 8 } })
      .then(function (res) {
        that.setData({ results: (res.results || []).map(function (r) { return openable(r.doc || r); }), loading: false });
      })
      .catch(function () {
        request("/api/v1/knowledge?search=" + encodeURIComponent(kw)).then(function (list) {
          that.setData({ results: (list || []).map(openable), loading: false });
        }).catch(function () { that.setData({ results: [], loading: false }); });
      });
  },
  toggle(e) {
    var i = Number(e.currentTarget.dataset.idx);
    var results = this.data.results;
    results[i].expanded = !results[i].expanded;
    this.setData({ results: results });
  },
});
function openable(a) {
  var content = a.content || "";
  return Object.assign({}, a, {
    expanded: false,
    content: content,
    html: mdToHtml(content),
    summary: a.summary || "",
    category: a.category || "规程",
  });
}