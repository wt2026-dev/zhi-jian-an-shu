var { request } = require("../../utils/request.js");

Page({
  data: {
    loading: true,
    loadError: "",
    parts: [],
    filteredParts: [],
    searchTerm: "",
    onlyLowStock: false,
    categories: ["全部"],
    categoryIndex: 0,
  },

  onLoad() { this.loadParts(); },
  onPullDownRefresh() { this.loadParts(function() { wx.stopPullDownRefresh(); }); },

  loadParts(done) {
    var that = this;
    that.setData({ loading: true, loadError: "" });
    request("/api/v1/spare-parts").then(function(list) {
      var parts = list || [];
      var cats = ["全部"].concat(Array.from(new Set(parts.map(function(p) { return p.category; }).filter(Boolean))));
      that.setData({
        loading: false,
        parts: parts,
        categories: cats,
      });
      that.applyFilter();
      if (typeof done === "function") done();
    }).catch(function(e) {
      that.setData({ loading: false, loadError: (e && e.error) || "加载失败" });
      if (typeof done === "function") done();
    });
  },

  onSearch(e) { this.setData({ searchTerm: e.detail.value }); this.applyFilter(); },
  onCategoryChange(e) { this.setData({ categoryIndex: Number(e.detail.value) }); this.applyFilter(); },
  toggleLowStock() { this.setData({ onlyLowStock: !this.data.onlyLowStock }); this.applyFilter(); },

  applyFilter() {
    var that = this;
    var cat = that.data.categories[that.data.categoryIndex];
    var term = that.data.searchTerm.toLowerCase();
    var filtered = that.data.parts.filter(function(p) {
      var matchCat = cat === "全部" || p.category === cat;
      var matchTerm = !term || (p.name && p.name.toLowerCase().indexOf(term) >= 0) || (p.code && p.code.toLowerCase().indexOf(term) >= 0) || (p.specification && p.specification.toLowerCase().indexOf(term) >= 0);
      var matchLow = !that.data.onlyLowStock || p.stock <= p.safe_stock;
      return matchCat && matchTerm && matchLow;
    });
    that.setData({ filteredParts: filtered });
  },
});
