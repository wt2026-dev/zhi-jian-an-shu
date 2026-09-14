var { request } = require("../../utils/request.js");

Page({
  data: {
    loading: true,
    loadError: "",
    nodes: [],
    edges: [],
    groupedNodes: {},
    selectedNode: null,
    extracting: false,
    extractMessage: "",
    equipmentFilter: "",
  },

  onLoad() { this.loadGraph(); },
  onPullDownRefresh() { this.loadGraph(function() { wx.stopPullDownRefresh(); }); },

  loadGraph(done) {
    var that = this;
    that.setData({ loading: true, loadError: "" });
    request("/api/v1/knowledge/graph").then(function(data) {
      var nodes = (data && data.nodes) || [];
      var edges = (data && data.edges) || [];
      var grouped = {};
      nodes.forEach(function(n) {
        var t = n.type || "其他";
        if (!grouped[t]) grouped[t] = [];
        grouped[t].push(n);
      });
      that.setData({ loading: false, nodes: nodes, edges: edges, groupedNodes: grouped });
      if (typeof done === "function") done();
    }).catch(function(e) {
      that.setData({ loading: false, loadError: (e && e.error) || "图谱数据加载失败" });
      if (typeof done === "function") done();
    });
  },

  selectNode(e) {
    var id = e.currentTarget.dataset.id;
    var node = this.data.nodes.find(function(n) { return n.id === id; });
    this.setData({ selectedNode: node || null });
  },

  closeDetail() { this.setData({ selectedNode: null }); },

  extractGraph() {
    var that = this;
    that.setData({ extracting: true, extractMessage: "正在抽取知识图谱..." });
    request("/api/v1/knowledge/graph/extract", { method: "POST" }).then(function(res) {
      that.setData({ extracting: false, extractMessage: "抽取完成！" });
      that.loadGraph();
      setTimeout(function() { that.setData({ extractMessage: "" }); }, 3000);
    }).catch(function(e) {
      that.setData({ extracting: false, extractMessage: "抽取失败: " + ((e && e.error) || "未知错误") });
      setTimeout(function() { that.setData({ extractMessage: "" }); }, 5000);
    });
  },
});
