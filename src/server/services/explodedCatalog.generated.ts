/**
 * ⚠️ 本文件由 scripts/extract-exploded-catalog.mjs 自动生成 —— 不要手改。
 * 数据来源：public/exploded/*.html（10 份拆解页脚本里的真实零件数组），
 * 位号/名称/规格/材质与拆解页 BOM 完全一致，仅作服务端"工单文本 ↔ 位号"匹配用。
 * 重新生成：node scripts/extract-exploded-catalog.mjs
 */

/** 拆解页 BOM 中的一条零件记录（全部字段来自拆解页自身的零件数组原文）。 */
export interface ExplodedCatalogPart {
  /** 位号（拆解页零件 id，如 P01 / C01），与 BOM 行 data-part-id 一致 */
  posNo: string;
  name: string;
  category?: string;
  spec?: string;
  material?: string;
}

export const EXPLODED_CATALOG_BY_FILE: Record<string, ExplodedCatalogPart[]> = {
  "compressor2_exploded.html": [
    {
      "posNo": "BOM-01",
      "name": "重型工字钢公共底座",
      "category": "底座与减震",
      "material": "Q355B 结构钢"
    },
    {
      "posNo": "BOM-02",
      "name": "主机端抗震橡胶减震器组",
      "category": "底座与减震",
      "material": "丁腈合成橡胶+45#钢"
    },
    {
      "posNo": "BOM-03",
      "name": "电机端复合弹簧减震垫组",
      "category": "底座与减震",
      "material": "60Si2Mn 弹簧钢+氯丁胶"
    },
    {
      "posNo": "BOM-04",
      "name": "双螺杆主机下半气缸体",
      "category": "机壳与水冷套",
      "material": "QT500-7 球墨铸铁"
    },
    {
      "posNo": "BOM-05",
      "name": "双螺杆主机上半气缸水冷套盖",
      "category": "机壳与水冷套",
      "material": "QT500-7 球墨铸铁"
    },
    {
      "posNo": "BOM-06",
      "name": "进气端低压轴承座端盖",
      "category": "机壳与水冷套",
      "material": "HT300 高强灰铸铁"
    },
    {
      "posNo": "BOM-07",
      "name": "排气端高压轴承座体",
      "category": "机壳与水冷套",
      "material": "QT600-3 球墨铸铁"
    },
    {
      "posNo": "BOM-08",
      "name": "同步齿轮箱前端密封罩壳",
      "category": "机壳与水冷套",
      "material": "ZL104 铸造铝合金"
    },
    {
      "posNo": "BOM-09",
      "name": "阳转子（主动四叶螺旋轴）",
      "category": "双螺杆转子",
      "material": "42CrMo4+PEEK涂层"
    },
    {
      "posNo": "BOM-10",
      "name": "阴转子（从动六齿螺旋轴）",
      "category": "双螺杆转子",
      "material": "42CrMo4+PTFE涂层"
    },
    {
      "posNo": "BOM-11",
      "name": "主动轴高精度斜齿同步齿轮",
      "category": "轴承与同步齿轮",
      "material": "20CrMnTi 渗碳淬火"
    },
    {
      "posNo": "BOM-12",
      "name": "从动轴高精度斜齿同步齿轮",
      "category": "轴承与同步齿轮",
      "material": "20CrMnTi 渗碳淬火"
    },
    {
      "posNo": "BOM-13",
      "name": "进气端圆柱滚子轴承组 (NU214)",
      "category": "轴承与同步齿轮",
      "material": "GCr15 轴承钢+黄铜保持架"
    },
    {
      "posNo": "BOM-14",
      "name": "排气端四点接触推力球轴承组 (QJ312)",
      "category": "轴承与同步齿轮",
      "material": "GCr15SiMn+机削铜保持架"
    },
    {
      "posNo": "BOM-15",
      "name": "轴承轴向精密锁紧圆螺母组件",
      "category": "轴承与同步齿轮",
      "material": "40Cr 调质合金钢"
    },
    {
      "posNo": "BOM-16",
      "name": "不锈钢多级迷宫式气封环组",
      "category": "无油气封轴封",
      "material": "316L 不锈钢+哈氏合金齿"
    },
    {
      "posNo": "BOM-17",
      "name": "浮动碳环隔离控油密封组件",
      "category": "无油气封轴封",
      "material": "浸锑特种石墨+304不锈钢"
    },
    {
      "posNo": "BOM-18",
      "name": "DN150 顶置进气法兰与蝶式调节阀",
      "category": "进排气法兰",
      "material": "304 不锈钢锻件"
    },
    {
      "posNo": "BOM-19",
      "name": "高精密进气消音过滤器总成",
      "category": "进排气法兰",
      "material": "纳米覆膜滤芯+碳钢壳体"
    },
    {
      "posNo": "BOM-20",
      "name": "DN100 高压排气法兰与止回阀座",
      "category": "进排气法兰",
      "material": "316Ti 耐热不锈钢"
    },
    {
      "posNo": "BOM-21",
      "name": "不锈钢波纹膨胀节与排气管段",
      "category": "进排气法兰",
      "material": "SUS321 多层液压波纹管"
    },
    {
      "posNo": "BOM-22",
      "name": "高弹性膜片联轴器（主机侧半联轴节）",
      "category": "电机与联轴器",
      "material": "42CrMo 高强合金钢"
    },
    {
      "posNo": "BOM-23",
      "name": "不锈钢叠片挠性膜片组与中间轴套",
      "category": "电机与联轴器",
      "material": "301 高弹不锈钢叠片组"
    },
    {
      "posNo": "BOM-24",
      "name": "高弹性膜片联轴器（电机侧半联轴节）",
      "category": "电机与联轴器",
      "material": "42CrMo 高强合金钢"
    },
    {
      "posNo": "BOM-25",
      "name": "联轴器钟形铝合金连接过渡罩筒",
      "category": "电机与联轴器",
      "material": "ADC12 压铸铝合金"
    },
    {
      "posNo": "BOM-26",
      "name": "160kW 永磁变频驱动电机散热机座",
      "category": "电机与联轴器",
      "material": "HT250 铸铁+紫铜绕组"
    },
    {
      "posNo": "BOM-27",
      "name": "永磁电机钕铁硼转子与主轴总成",
      "category": "电机与联轴器",
      "material": "35WW270硅钢+N48SH钕铁硼"
    },
    {
      "posNo": "BOM-28",
      "name": "电机后端独立冷却风机与导风罩",
      "category": "电机与联轴器",
      "material": "冷轧钢板冲压+铝合金叶轮"
    }
  ],
  "compressor_exploded.html": [
    {
      "posNo": "P01",
      "name": "进气喇叭口与导流锥罩",
      "category": "进气与前轴承",
      "spec": "Ø760×240mm / 流线锥面",
      "material": "QT400 球墨铸铁 (工业橙涂装)"
    },
    {
      "posNo": "P02",
      "name": "可调进气导叶机构 (IGV)",
      "category": "进气与前轴承",
      "spec": "Ø680×110mm / 12片可调钢叶",
      "material": "2Cr13 不锈钢 + 联动齿圈"
    },
    {
      "posNo": "P03",
      "name": "前端进气端盖与密封腔",
      "category": "进气与前轴承",
      "spec": "Ø1120×210mm / 止口法兰",
      "material": "HT300 高强灰铸铁 (工业橙)"
    },
    {
      "posNo": "P04",
      "name": "氟橡胶O型大密封圈与气封组",
      "category": "进气与前轴承",
      "spec": "Ø1040×8.6mm + 碳环密封",
      "material": "Viton 氟橡胶 + 浸锑石墨"
    },
    {
      "posNo": "P05",
      "name": "金斯伯雷可倾瓦推力轴承",
      "category": "进气与前轴承",
      "spec": "Ø340×95mm / 8块巴氏合金瓦",
      "material": "GCr15 轴承钢 + 锡基巴氏合金"
    },
    {
      "posNo": "P06",
      "name": "前端可倾瓦径向滑动轴承",
      "category": "进气与前轴承",
      "spec": "Ø180×Ø290×110mm / 5瓦结构",
      "material": "20CrMnTi + 铜基巴氏合金内衬"
    },
    {
      "posNo": "P07",
      "name": "级间铝硅合金迷宫气封套",
      "category": "叶轮与扩压内件",
      "spec": "Ø280×160mm / 多道尖齿梳齿",
      "material": "ZL108 耐磨铝硅合金 + 铜环"
    },
    {
      "posNo": "P08",
      "name": "一级三元流后弯闭式离心叶轮",
      "category": "叶轮与扩压内件",
      "spec": "Ø540×115mm / 16片空间扭曲叶",
      "material": "TC4 航空锻造钛合金"
    },
    {
      "posNo": "P09",
      "name": "一级无叶/叶片扩压器与回流器",
      "category": "叶轮与扩压内件",
      "spec": "Ø920×140mm / 18片铜合金导叶",
      "material": "ZCuSn10Pb1 铸造锡青铜 + 铸钢体"
    },
    {
      "posNo": "P10",
      "name": "二级三元流中压离心叶轮",
      "category": "叶轮与扩压内件",
      "spec": "Ø480×98mm / 16片后弯叶片",
      "material": "17-4PH 沉淀硬化不锈钢"
    },
    {
      "posNo": "P11",
      "name": "二级精密扩压器与级间回流隔板",
      "category": "叶轮与扩压内件",
      "spec": "Ø900×135mm / 20片导流叶",
      "material": "2Cr13 不锈钢 + 铜导叶环"
    },
    {
      "posNo": "P12",
      "name": "三级高压闭式离心叶轮与平衡盘",
      "category": "叶轮与扩压内件",
      "spec": "Ø420×82mm + Ø360阶梯平衡盘",
      "material": "17-4PH 不锈钢 + 42CrMo 平衡鼓"
    },
    {
      "posNo": "P13",
      "name": "水平剖分式上机壳 (带散热肋与吊耳)",
      "category": "机壳与齿轮箱",
      "spec": "Ø1180×1950mm / 14道散热肋",
      "material": "HT300 高强灰铸铁 (工业橙涂装)"
    },
    {
      "posNo": "P14",
      "name": "水平剖分式下机壳与重型支脚底座",
      "category": "机壳与齿轮箱",
      "spec": "Ø1180×1950mm / 四角加强筋支座",
      "material": "HT300 高强灰铸铁 + Q345B 底座"
    },
    {
      "posNo": "P15",
      "name": "中分面高强度双头螺栓与螺母组",
      "category": "机壳与齿轮箱",
      "spec": "M36×260mm (10.9级) × 24套",
      "material": "35CrMoA 合金结构钢 (发黑发亮)"
    },
    {
      "posNo": "P16",
      "name": "高速阶梯主轴与小齿轮轴总成",
      "category": "叶轮与扩压内件",
      "spec": "Ø160×2850mm / 22齿斜齿小轮",
      "material": "34CrNiMo6 真空重熔合金锻钢"
    },
    {
      "posNo": "P17",
      "name": "大模数高精度斜齿增速大齿轮",
      "category": "齿轮与联轴器",
      "spec": "Ø740×150mm / Z=93 渗碳磨齿",
      "material": "18CrNiMo7-6 渗碳淬火硬齿面"
    },
    {
      "posNo": "P18",
      "name": "后端高压蜗壳与齿轮箱复合端盖",
      "category": "机壳与齿轮箱",
      "spec": "Ø1120×280mm / 蜗舌出气道",
      "material": "QT500-7 球墨铸铁 (工业橙涂装)"
    },
    {
      "posNo": "P19",
      "name": "后端精密圆柱滚子轴承与油封",
      "category": "齿轮与联轴器",
      "spec": "NU232-E-M1 (Ø160×Ø290×48mm)",
      "material": "GCr15 电渣重熔轴承钢 + 黄铜保持架"
    },
    {
      "posNo": "P20",
      "name": "挠性叠片膜片联轴器与护罩总成",
      "category": "齿轮与联轴器",
      "spec": "Ø460×380mm / 304不锈钢膜片组",
      "material": "42CrMo 锻钢半联轴节 + 301叠片"
    },
    {
      "posNo": "P21",
      "name": "级间不锈钢冷却盘管与进回水歧管",
      "category": "冷却管路与辅件",
      "spec": "DN65 无缝管路 + 翅片换热管束",
      "material": "316L 奥氏体不锈钢 + 铜法兰接头"
    },
    {
      "posNo": "P22",
      "name": "高压稀油润滑分配器与黄铜油嘴组",
      "category": "冷却管路与辅件",
      "spec": "6路分配块 + G3/8\" 黄铜喷油嘴",
      "material": "H62 精车黄铜 + 304不锈钢引油管"
    },
    {
      "posNo": "P23",
      "name": "顶置防爆仪控接线盒与气密引入套管",
      "category": "冷却管路与辅件",
      "spec": "520×440×360mm (Exd II CT4)",
      "material": "压铸铝合金箱体 + 陶瓷高压穿墙套管"
    },
    {
      "posNo": "P24",
      "name": "蚀刻不锈钢设备铭牌与视窗油标组件",
      "category": "冷却管路与辅件",
      "spec": "320×180×4mm 铭牌 + Ø110钢化油镜",
      "material": "304 拉丝不锈钢 + 激光蚀刻 + 铜油窗"
    }
  ],
  "cooling_pump_exploded_v3.html": [
    {
      "posNo": "P-01",
      "name": "泵体蜗壳",
      "category": "泵本体",
      "spec": "DN250×DN200 · PN16 螺旋蜗壳",
      "material": "ZG06Cr13Ni4Mo 双相不锈钢"
    },
    {
      "posNo": "P-02",
      "name": "泵盖 (后盖)",
      "category": "泵本体",
      "spec": "Ø410 H7/h6 · 径向加强筋承压盖",
      "material": "ZG06Cr13Ni4Mo 不锈钢"
    },
    {
      "posNo": "P-03",
      "name": "闭式离心叶轮",
      "category": "泵本体",
      "spec": "Ø385mm · 6枚三维扭曲叶片 · G2.5",
      "material": "CF8M (316) 精密铸造不锈钢"
    },
    {
      "posNo": "P-04",
      "name": "叶轮口环 (密封环)",
      "category": "泵本体",
      "spec": "Ø210×Ø192×36mm · 间隙 0.22mm",
      "material": "1Cr13 堆焊司太立合金"
    },
    {
      "posNo": "P-05",
      "name": "叶轮锁紧螺母与平键",
      "category": "泵本体",
      "spec": "M36×2 左旋球面导流螺母 + 平键",
      "material": "06Cr19Ni10 (304) + 45#钢"
    },
    {
      "posNo": "P-06",
      "name": "主泵轴",
      "category": "泵本体",
      "spec": "L=780mm · 阶梯轴径 Ø65/Ø60/Ø48",
      "material": "42CrMo 合金结构钢 (氮化)"
    },
    {
      "posNo": "P-07",
      "name": "陶瓷涂层轴套",
      "category": "泵本体",
      "spec": "Ø75×Ø60×115mm · HRC62 镜面",
      "material": "2Cr13 喷涂氧化铬陶瓷"
    },
    {
      "posNo": "P-08",
      "name": "集装式机械密封",
      "category": "泵本体",
      "spec": "Ø75mm 平衡型集装式 · 耐压 2.5MPa",
      "material": "碳化硅(SiC)/石墨/哈氏合金"
    },
    {
      "posNo": "P-09",
      "name": "机械密封压盖",
      "category": "泵本体",
      "spec": "Ø195mm · 带 API Plan 11 冲洗口",
      "material": "06Cr19Ni10 (304) 锻造不锈钢"
    },
    {
      "posNo": "P-10",
      "name": "轴承箱悬架体",
      "category": "泵本体",
      "spec": "重型稀油润滑悬架 · 储油量 3.5L",
      "material": "HT250 高强度灰铸铁"
    },
    {
      "posNo": "P-11",
      "name": "前轴承 (圆柱滚子)",
      "category": "泵本体",
      "spec": "NU312 ECM · Ø60×Ø130×31mm · P6",
      "material": "GCr15 轴承钢 + 黄铜实体保持架"
    },
    {
      "posNo": "P-12",
      "name": "后轴承 (角接触球轴承组)",
      "category": "泵本体",
      "spec": "7312 BECBM × 2 · 40°接触角",
      "material": "GCr15 轴承钢 (背对背DB配对)"
    },
    {
      "posNo": "P-13",
      "name": "轴承前后端盖与迷宫油封",
      "category": "泵本体",
      "spec": "Ø165mm 法兰压盖 · 非接触迷宫封",
      "material": "HT200 灰铸铁 + 锡青铜迷宫环"
    },
    {
      "posNo": "P-14",
      "name": "弹性柱销联轴器与护罩",
      "category": "泵本体",
      "spec": "HL5 标准型 · 公称扭矩 2500 N·m",
      "material": "45# 锻钢发黑 + 安全防护罩"
    },
    {
      "posNo": "P-15",
      "name": "联轴器螺栓与尼龙柱销",
      "category": "泵本体",
      "spec": "8×M16 铰制孔螺栓 + Ø32 尼龙柱销",
      "material": "40Cr 合金钢 + MC尼龙弹性套"
    },
    {
      "posNo": "P-16",
      "name": "宝蓝型钢公共底座与基座",
      "category": "泵本体",
      "spec": "2150×820×260mm · 工业宝蓝重防腐",
      "material": "Q235B 槽钢焊接底座 + C35 混凝土"
    },
    {
      "posNo": "P-17",
      "name": "地脚螺栓与紧固螺栓组",
      "category": "泵本体",
      "spec": "8×M24×500 地脚螺栓 + 8×M20 螺栓",
      "material": "Q345B 热浸镀锌 (8.8级高强件)"
    },
    {
      "posNo": "M-01",
      "name": "电机机座 (高密散热筋)",
      "category": "电机",
      "spec": "YE3-315M-4 · H=315mm · IP55",
      "material": "HT250 灰铸铁 (银白聚氨酯漆)"
    },
    {
      "posNo": "M-02",
      "name": "电机前端盖 (驱动端盖)",
      "category": "电机",
      "spec": "Ø580mm · 6319轴承室 · 带注油嘴",
      "material": "HT250 灰铸铁"
    },
    {
      "posNo": "M-03",
      "name": "电机后端盖 (非驱动端)",
      "category": "电机",
      "spec": "Ø580mm · 6319轴承室 · 带风罩耳",
      "material": "HT250 灰铸铁"
    },
    {
      "posNo": "M-04",
      "name": "定子铁芯与紫铜绕组",
      "category": "电机",
      "spec": "380V/660V △/Y · VPI真空浸漆",
      "material": "DW470 硅钢片 + F级无氧紫铜线"
    },
    {
      "posNo": "M-05",
      "name": "鼠笼转子铁芯与转轴",
      "category": "电机",
      "spec": "斜槽铸铝转子 · 轴伸 Ø80×170mm",
      "material": "DW470 硅钢片 + 铸铝导条 + 45#轴"
    },
    {
      "posNo": "M-06",
      "name": "电机离心散热风扇",
      "category": "电机",
      "spec": "Ø460mm · 9叶片后倾式低噪叶轮",
      "material": "ZL102 高强铸造铝合金"
    },
    {
      "posNo": "M-07",
      "name": "电机风扇风罩",
      "category": "电机",
      "spec": "Ø590×340mm · 旋压导流罩壳",
      "material": "SPCC 冷轧钢板 + 蜂窝进风网"
    },
    {
      "posNo": "M-08",
      "name": "高压防爆接线盒",
      "category": "电机",
      "spec": "6柱铜接线桩 · 双M63电缆格兰头",
      "material": "ZL104 压铸铝合金 (IP55)"
    },
    {
      "posNo": "A-01",
      "name": "进口变径短管与防振拉杆",
      "category": "附属",
      "spec": "DN250 PN16 法兰短管 + 12×M24螺栓",
      "material": "06Cr19Ni10 (304) + 黄铜整流圈"
    },
    {
      "posNo": "A-02",
      "name": "出口主立管组件",
      "category": "附属",
      "spec": "Ø219×8mm 立管 · 上下 DN200 法兰",
      "material": "06Cr19Ni10 (304) 无缝不锈钢管"
    },
    {
      "posNo": "A-03",
      "name": "对夹式止回阀与法兰副",
      "category": "附属",
      "spec": "H76W-16P DN200 · 8根长穿心螺栓",
      "material": "CF8 (304) 阀体 + 双瓣旋启阀板"
    },
    {
      "posNo": "A-04",
      "name": "出口隔离闸阀 (带明杆)",
      "category": "附属",
      "spec": "Z41W-16P DN200 · 顶部黄铜阀杆护套",
      "material": "WCB/304 阀体 + 2Cr13 金色明杆"
    },
    {
      "posNo": "A-05",
      "name": "耐震压力表与引压管总成",
      "category": "附属",
      "spec": "Y-150BF (0~1.6 MPa) + 针型考克阀",
      "material": "304 不锈钢表壳 + 铜机芯 + Ø18引压管"
    },
    {
      "posNo": "A-06",
      "name": "金属缠绕密封垫片组",
      "category": "附属",
      "spec": "HG/T 20610 DN250/DN200 PN16",
      "material": "304 不锈钢V形带 + 柔性石墨"
    },
    {
      "posNo": "A-07",
      "name": "设备铭牌与转向标牌",
      "category": "附属",
      "spec": "160×100×1.5mm 铭牌 + 转向箭头牌",
      "material": "304 拉丝不锈钢 (激光蚀刻)"
    },
    {
      "posNo": "A-08",
      "name": "圆锥定位销与双头螺柱组",
      "category": "附属",
      "spec": "2×Ø12×60 定位销 + 12×M20 螺柱",
      "material": "35CrMoA 高强合金钢 (8.8级)"
    },
    {
      "posNo": "A-09",
      "name": "黄铜油标 (视油窗)",
      "category": "附属",
      "spec": "G3/4\" 螺纹接口 · 红白标准油位线",
      "material": "H62 黄铜六角体 + 钢化硼硅玻璃"
    },
    {
      "posNo": "A-10",
      "name": "锻钢起重吊环组",
      "category": "附属",
      "spec": "DIN 580 M24 重型吊环 · 1.8t/只",
      "material": "20# 优质碳素锻钢 (镀锌防腐)"
    }
  ],
  "gearbox3_exploded.html": [
    {
      "posNo": "BOM-01",
      "name": "重型轧机减速箱抗冲击铸钢底座与侧翼支座",
      "category": "上下剖分箱体",
      "material": "ZG310-570 铸钢整体退火"
    },
    {
      "posNo": "BOM-02",
      "name": "一级行星段下半水平剖分圆筒箱体",
      "category": "上下剖分箱体",
      "material": "QT600-3 高强球墨铸铁"
    },
    {
      "posNo": "BOM-03",
      "name": "一级行星段上半水平剖分圆筒箱盖",
      "category": "上下剖分箱体",
      "material": "QT600-3 高强球墨铸铁"
    },
    {
      "posNo": "BOM-04",
      "name": "二级重载段下半水平剖分箱体",
      "category": "上下剖分箱体",
      "material": "ZG270-500 重型铸钢"
    },
    {
      "posNo": "BOM-05",
      "name": "二级重载段上半水平剖分箱盖",
      "category": "上下剖分箱体",
      "material": "ZG270-500 重型铸钢"
    },
    {
      "posNo": "BOM-06",
      "name": "箱体顶部窥视检视孔盖与防爆呼吸器总成",
      "category": "上下剖分箱体",
      "material": "304 不锈钢+钢化视镜"
    },
    {
      "posNo": "BOM-07",
      "name": "高速输入端精密轴承座法兰端盖",
      "category": "上下剖分箱体",
      "material": "QT500-7 球墨铸铁"
    },
    {
      "posNo": "BOM-08",
      "name": "重载输出端轧辊侧法兰密封端盖",
      "category": "上下剖分箱体",
      "material": "ZG310-570 锻造合金钢"
    },
    {
      "posNo": "BOM-09",
      "name": "高速段合金锻钢渐开线花键输入主轴",
      "category": "输入与输出轴系",
      "material": "42CrMo4 调质+离子渗氮"
    },
    {
      "posNo": "BOM-10",
      "name": "输入端鼓形齿联轴器主动半联轴节",
      "category": "输入与输出轴系",
      "material": "42CrMo 锻钢齿面高频淬火"
    },
    {
      "posNo": "BOM-11",
      "name": "轧机主传动扁头/花键大扭矩输出主轴",
      "category": "输入与输出轴系",
      "material": "34CrNi3MoV 电渣重熔锻钢"
    },
    {
      "posNo": "BOM-12",
      "name": "输出端重型锻钢法兰联轴节与液压锁紧盘",
      "category": "输入与输出轴系",
      "material": "42CrMoA 高强锻钢"
    },
    {
      "posNo": "BOM-13",
      "name": "一级高速渗碳淬火太阳轮（Z=19）",
      "category": "太阳轮与行星轮",
      "material": "18CrNiMo7-6 渗碳HRC61"
    },
    {
      "posNo": "BOM-14",
      "name": "一级太阳轮球面渐开线花键浮动联接套",
      "category": "太阳轮与行星轮",
      "material": "20CrMnTi 渗碳淬火"
    },
    {
      "posNo": "BOM-15",
      "name": "二级重载大模数渗碳磨齿太阳轮（Z=23）",
      "category": "太阳轮与行星轮",
      "material": "18CrNiMo7-6 渗碳HRC60"
    },
    {
      "posNo": "BOM-16",
      "name": "太阳轮轴向球面青铜止推垫圈与定位卡环组",
      "category": "太阳轮与行星轮",
      "material": "ZCuSn10Pb1 锡青铜+65Mn"
    },
    {
      "posNo": "BOM-17",
      "name": "一级 1# 硬齿面修形行星轮（0°相位 Z=35）",
      "category": "太阳轮与行星轮",
      "material": "18CrNiMo7-6 渗碳磨齿"
    },
    {
      "posNo": "BOM-18",
      "name": "一级 2# 硬齿面修形行星轮（120°相位 Z=35）",
      "category": "太阳轮与行星轮",
      "material": "18CrNiMo7-6 渗碳磨齿"
    },
    {
      "posNo": "BOM-19",
      "name": "一级 3# 硬齿面修形行星轮（240°相位 Z=35）",
      "category": "太阳轮与行星轮",
      "material": "18CrNiMo7-6 渗碳磨齿"
    },
    {
      "posNo": "BOM-20",
      "name": "一级行星轮表面渗氮空心芯轴组（3×均布销轴）",
      "category": "太阳轮与行星轮",
      "material": "38CrMoAlA 离子渗氮"
    },
    {
      "posNo": "BOM-21",
      "name": "二级 1# 重载宽齿面行星轮（0°相位 Z=31）",
      "category": "太阳轮与行星轮",
      "material": "20Cr2Ni4A 深层渗碳淬火"
    },
    {
      "posNo": "BOM-22",
      "name": "二级 2# 重载宽齿面行星轮（90°相位 Z=31）",
      "category": "太阳轮与行星轮",
      "material": "20Cr2Ni4A 深层渗碳淬火"
    },
    {
      "posNo": "BOM-23",
      "name": "二级 3# 重载宽齿面行星轮（180°相位 Z=31）",
      "category": "太阳轮与行星轮",
      "material": "20Cr2Ni4A 深层渗碳淬火"
    },
    {
      "posNo": "BOM-24",
      "name": "二级 4# 重载宽齿面行星轮（270°相位 Z=31）",
      "category": "太阳轮与行星轮",
      "material": "20Cr2Ni4A 深层渗碳淬火"
    },
    {
      "posNo": "BOM-25",
      "name": "一级固定式深层离子渗氮内齿圈（Z=89）",
      "category": "内齿圈与行星架",
      "material": "42CrMo4 调质+深层渗氮"
    },
    {
      "posNo": "BOM-26",
      "name": "二级重载高抗冲内齿圈齿套（Z=85）",
      "category": "内齿圈与行星架",
      "material": "35CrMoV 锻造渗氮钢"
    },
    {
      "posNo": "BOM-27",
      "name": "一级双壁整体锻钢浮动行星架",
      "category": "内齿圈与行星架",
      "material": "35CrMo 整体模锻调质"
    },
    {
      "posNo": "BOM-28",
      "name": "二级特大型双壁球铁重载输出行星架",
      "category": "内齿圈与行星架",
      "material": "QT700-2 高强珠光体球铁"
    },
    {
      "posNo": "BOM-29",
      "name": "高速输入轴配对圆锥滚子轴承组 (32322 P5)",
      "category": "重载轴承系统",
      "material": "GCr15 真空脱气轴承钢"
    },
    {
      "posNo": "BOM-30",
      "name": "一/二级行星轮满装圆柱滚子轴承组 (NCF2228)",
      "category": "重载轴承系统",
      "material": "GCr15SiMn 电渣重熔轴承钢"
    },
    {
      "posNo": "BOM-31",
      "name": "输出主轴特大型双列调心滚子轴承组 (24156)",
      "category": "重载轴承系统",
      "material": "GCr15SiMn+机削黄铜保持架"
    },
    {
      "posNo": "BOM-32",
      "name": "输入端双唇氟橡胶高压旋转轴封与甩油环",
      "category": "密封与紧固螺栓",
      "material": "FKM 氟橡胶+304不锈钢"
    },
    {
      "posNo": "BOM-33",
      "name": "输出端轧机防氧化铁皮多道迷宫密封总成",
      "category": "密封与紧固螺栓",
      "material": "40Cr 调质钢+PTFE耐水唇封"
    },
    {
      "posNo": "BOM-34",
      "name": "上下箱体中分面 12.9 级高强铰制孔螺栓组 (M42×24)",
      "category": "密封与紧固螺栓",
      "material": "42CrMoA 12.9级特氟龙防锈"
    }
  ],
  "gearbox_exploded.html": [
    {
      "posNo": "BOM-01",
      "name": "重型抗扭刚性公共底盘座",
      "category": "上下剖分箱体",
      "material": "Q355D 厚板焊接退火"
    },
    {
      "posNo": "BOM-02",
      "name": "减速机下半剖分箱体（带油池与加强筋）",
      "category": "上下剖分箱体",
      "material": "ZG270-500 铸钢 / QT500"
    },
    {
      "posNo": "BOM-03",
      "name": "减速机上半剖分箱盖（带吊耳与轴承拱座）",
      "category": "上下剖分箱体",
      "material": "ZG270-500 重型铸钢"
    },
    {
      "posNo": "BOM-04",
      "name": "箱体顶部高压喷油观察窗盖板总成",
      "category": "上下剖分箱体",
      "material": "Q235B+钢化耐油视镜"
    },
    {
      "posNo": "BOM-05",
      "name": "输入端高刚性法兰轴承端盖",
      "category": "上下剖分箱体",
      "material": "QT500-7 球墨铸铁"
    },
    {
      "posNo": "BOM-06",
      "name": "输出端重载卷筒侧法兰密封端盖",
      "category": "上下剖分箱体",
      "material": "QT600-3 高强球铁"
    },
    {
      "posNo": "BOM-07",
      "name": "高速合金锻钢渐开线花键输入主轴",
      "category": "输入与输出主轴",
      "material": "42CrMo4 调质+氮化"
    },
    {
      "posNo": "BOM-08",
      "name": "输入端鼓形齿联轴器刚性半联轴节",
      "category": "输入与输出主轴",
      "material": "42CrMo 锻钢高频淬火"
    },
    {
      "posNo": "BOM-09",
      "name": "一级渗碳淬火磨齿太阳轮（Z=21）",
      "category": "太阳轮与行星轮系",
      "material": "18CrNiMo7-6 渗碳HRC60"
    },
    {
      "posNo": "BOM-10",
      "name": "太阳轮径向浮动定位卡簧与球面止推环",
      "category": "太阳轮与行星轮系",
      "material": "65Mn 弹簧钢+锡青铜"
    },
    {
      "posNo": "BOM-11",
      "name": "1# 硬齿面修形行星轮（0°相位 Z=36）",
      "category": "太阳轮与行星轮系",
      "material": "18CrNiMo7-6 渗碳磨齿"
    },
    {
      "posNo": "BOM-12",
      "name": "2# 硬齿面修形行星轮（120°相位 Z=36）",
      "category": "太阳轮与行星轮系",
      "material": "18CrNiMo7-6 渗碳磨齿"
    },
    {
      "posNo": "BOM-13",
      "name": "3# 硬齿面修形行星轮（240°相位 Z=36）",
      "category": "太阳轮与行星轮系",
      "material": "18CrNiMo7-6 渗碳磨齿"
    },
    {
      "posNo": "BOM-14",
      "name": "二级重载差动斜齿行星轮组（4×均布轮）",
      "category": "太阳轮与行星轮系",
      "material": "20Cr2Ni4A 渗碳淬火"
    },
    {
      "posNo": "BOM-15",
      "name": "1# 表面渗氮精密行星轮芯轴（带内油道）",
      "category": "太阳轮与行星轮系",
      "material": "38CrMoAlA 离子渗氮"
    },
    {
      "posNo": "BOM-16",
      "name": "2# 表面渗氮精密行星轮芯轴（带内油道）",
      "category": "太阳轮与行星轮系",
      "material": "38CrMoAlA 离子渗氮"
    },
    {
      "posNo": "BOM-17",
      "name": "3# 表面渗氮精密行星轮芯轴（带内油道）",
      "category": "太阳轮与行星轮系",
      "material": "38CrMoAlA 离子渗氮"
    },
    {
      "posNo": "BOM-18",
      "name": "行星轮高承载满装圆柱滚子轴承组 (NCF)",
      "category": "重载轴承系统",
      "material": "GCr15SiMn 电渣重熔钢"
    },
    {
      "posNo": "BOM-19",
      "name": "一级固定式深层离子渗氮内齿圈（Z=93）",
      "category": "内齿圈与行星架",
      "material": "42CrMo4 调质+深层渗氮"
    },
    {
      "posNo": "BOM-20",
      "name": "二级重载内齿圈齿套（Z=108 带外花键）",
      "category": "内齿圈与行星架",
      "material": "35CrMoV 渗氮钢"
    },
    {
      "posNo": "BOM-21",
      "name": "双壁整体球墨铸铁重载行星架本体",
      "category": "内齿圈与行星架",
      "material": "QT700-2 珠光体球铁"
    },
    {
      "posNo": "BOM-22",
      "name": "行星架前侧均载浮动齿式联接盘",
      "category": "内齿圈与行星架",
      "material": "40CrNiMoA 锻钢"
    },
    {
      "posNo": "BOM-23",
      "name": "二级重载内花键输出太阳轮联接套",
      "category": "输入与输出主轴",
      "material": "18CrNiMo7-6 渗碳钢"
    },
    {
      "posNo": "BOM-24",
      "name": "卷取机主传动大扭矩空心输出主轴",
      "category": "输入与输出主轴",
      "material": "34CrNiMo6 大型锻钢"
    },
    {
      "posNo": "BOM-25",
      "name": "输出端重型法兰盘与液压胀紧套锁紧组件",
      "category": "输入与输出主轴",
      "material": "42CrMo 高强锻钢"
    },
    {
      "posNo": "BOM-26",
      "name": "输入轴双列圆锥滚子轴承组 (32224 P5)",
      "category": "重载轴承系统",
      "material": "GCr15 真空脱气轴承钢"
    },
    {
      "posNo": "BOM-27",
      "name": "行星架前支承大型调心滚子轴承 (24038)",
      "category": "重载轴承系统",
      "material": "GCr15SiMn+机削黄铜架"
    },
    {
      "posNo": "BOM-28",
      "name": "输出主轴特大型双列调心滚子轴承 (24148)",
      "category": "重载轴承系统",
      "material": "GCr15SiMn 渗碳轴承钢"
    },
    {
      "posNo": "BOM-29",
      "name": "输入端氟橡胶双唇骨架油封与迷宫环组",
      "category": "密封与紧固螺栓",
      "material": "FKM 氟橡胶+304不锈钢"
    },
    {
      "posNo": "BOM-30",
      "name": "输出端重载高压迷宫防尘油封总成",
      "category": "密封与紧固螺栓",
      "material": "40Cr+PTFE 复合密封圈"
    },
    {
      "posNo": "BOM-31",
      "name": "箱体中分面 12.9 级高强铰制孔螺栓副 (M36×16)",
      "category": "密封与紧固螺栓",
      "material": "42CrMoA 12.9级达克罗"
    },
    {
      "posNo": "BOM-32",
      "name": "强制循环喷油润滑分配管汇与法兰组件",
      "category": "密封与紧固螺栓",
      "material": "316L 不锈钢无缝管路"
    }
  ],
  "machining_center_exploded.html": [
    {
      "posNo": "POS-01",
      "name": "重型铸铁床身底座",
      "spec": "HT300 4200×2400×550mm",
      "material": "HT300高强度孕育铸铁"
    },
    {
      "posNo": "POS-02",
      "name": "X轴重载滚柱直线导轨副",
      "spec": "INA RUE65-E-L 4000mm",
      "material": "GCr15轴承钢高频淬火"
    },
    {
      "posNo": "POS-03",
      "name": "精密T型槽工作台",
      "spec": "2500×1600mm (7槽 22H7)",
      "material": "HT300 表面高频淬火研磨"
    },
    {
      "posNo": "POS-04",
      "name": "龙门双立柱框架",
      "spec": "箱型双立柱 跨距1900mm",
      "material": "HT300 蜂巢式筋板铸造"
    },
    {
      "posNo": "POS-05",
      "name": "龙门横梁与Y轴导轨总成",
      "spec": "阶梯式横梁 L=2650mm",
      "material": "HT300 + 三线轨支撑"
    },
    {
      "posNo": "POS-06",
      "name": "Y/Z轴十字滑鞍与滑枕总成",
      "spec": "方滑枕 □420×420mm 行程900",
      "material": "球墨铸铁 QT600-3"
    },
    {
      "posNo": "POS-07",
      "name": "五轴联动万能铣头",
      "spec": "HSK-A63 / A/C双摆头 24000rpm",
      "material": "合金钢渗碳淬火 + 陶瓷轴承"
    },
    {
      "posNo": "POS-08",
      "name": "Y轴横梁伺服驱动电机总成",
      "spec": "SIEMENS 1FT7 28Nm + 行星减速机",
      "material": "航空铝壳体 / 稀土永磁"
    },
    {
      "posNo": "POS-09",
      "name": "后置液压冷切与电气控制柜",
      "spec": "IP54 双百叶散热电气柜",
      "material": "2.5mm冷轧钢板 工业蓝涂装"
    },
    {
      "posNo": "POS-10",
      "name": "左侧移动式透明视窗防护门",
      "spec": "折弯钣金舱门 + 防爆夹胶视窗",
      "material": "SPCC冷轧板喷塑 + 12mm聚碳酸酯"
    },
    {
      "posNo": "POS-11",
      "name": "右侧移动式透明视窗防护门",
      "spec": "折弯钣金舱门 + 防爆夹胶视窗",
      "material": "SPCC冷轧板喷塑 + 12mm聚碳酸酯"
    },
    {
      "posNo": "POS-12",
      "name": "悬臂式CNC数控操作台",
      "spec": "SIEMENS SINUMERIK ONE 22寸屏",
      "material": "压铸铝操作箱 + 旋转悬臂支座"
    }
  ],
  "motor14_exploded.html": [
    {
      "posNo": "M-01",
      "name": "轴伸半联轴器与端面压板",
      "category": "轴承密封",
      "spec": "内孔 Ø75 H7 · 外径 Ø210 · 8孔柱销盘",
      "material": "45# 优质碳素锻钢 (调质+发黑)"
    },
    {
      "posNo": "M-02",
      "name": "主轴伸平键与防尘甩油环",
      "category": "轴承密封",
      "spec": "GB/T 1096 A型平键 20×12×140 + Ø95甩油环",
      "material": "45# 精拉钢平键 + ZCuSn10Pb1 锡青铜"
    },
    {
      "posNo": "M-03",
      "name": "前轴承外盖 (驱动端外压盖)",
      "category": "轴承密封",
      "spec": "外径 Ø235mm · 带自动排脂腔与6×M10螺栓",
      "material": "HT250 灰铸铁"
    },
    {
      "posNo": "M-04",
      "name": "前迷宫油封与轴电流接地碳刷环",
      "category": "轴承密封",
      "spec": "Ø85×Ø115×18mm · 360°环形导电微纤维刷",
      "material": "PTFE碳纤维复合 + 导电微纤维接地环"
    },
    {
      "posNo": "M-05",
      "name": "电机前端盖 (驱动端端盖)",
      "category": "机壳端盖",
      "spec": "外径 Ø550mm · 止口 H7/h6 · 8道放射加强筋",
      "material": "HT250 高强度灰铸铁"
    },
    {
      "posNo": "M-06",
      "name": "前轴承 (圆柱滚子轴承 NU317)",
      "category": "轴承密封",
      "spec": "NU317 ECM/C3 · Ø85×Ø180×41mm · P6级",
      "material": "GCr15 高碳铬轴承钢 + 黄铜实体保持架"
    },
    {
      "posNo": "M-07",
      "name": "前轴承内盖 (驱动端内挡盖)",
      "category": "轴承密封",
      "spec": "外径 Ø235mm · 带内迷宫挡油环槽",
      "material": "HT250 灰铸铁"
    },
    {
      "posNo": "M-08",
      "name": "前后端盖紧固螺栓组",
      "category": "机壳端盖",
      "spec": "16×M16×65 六角头螺栓 + 重型弹簧垫圈",
      "material": "35CrMoA 高强合金钢 (8.8级发黑)"
    },
    {
      "posNo": "M-09",
      "name": "高密散热片铸铁机座",
      "category": "机壳端盖",
      "spec": "YVF2-280M · 中心高 H=280mm · 32道纵向散热片",
      "material": "HT250 高导热灰铸铁 (重防腐工业涂装)"
    },
    {
      "posNo": "M-10",
      "name": "定子铁芯 (冷轧硅钢片叠压铁芯)",
      "category": "定转子核心",
      "spec": "外径 Ø440×内径 Ø290×长 380mm · 48槽",
      "material": "50W470 低损耗无取向冷轧硅钢片"
    },
    {
      "posNo": "M-11",
      "name": "定子变频耐电晕紫铜绕组",
      "category": "定转子核心",
      "spec": "380V △接 · 5~100Hz宽频 · VPI真空浸漆 · PT100",
      "material": "H级聚酰亚胺耐电晕无氧紫铜漆包线"
    },
    {
      "posNo": "M-12",
      "name": "转子铁芯与斜槽铸铝鼠笼导条",
      "category": "定转子核心",
      "spec": "外径 Ø287×长 380mm · 斜槽度 1个定子齿距",
      "material": "50W470 硅钢片 + 99.7%高纯离心铸铝导条"
    },
    {
      "posNo": "M-13",
      "name": "变频电机阶梯转子主轴",
      "category": "定转子核心",
      "spec": "总长 1120mm · 轴伸 Ø75m6 · 滚花热套铁芯位",
      "material": "42CrMo 合金结构钢 (调质+外圆精磨)"
    },
    {
      "posNo": "M-14",
      "name": "后轴承内盖 (非驱动端内盖)",
      "category": "轴承密封",
      "spec": "外径 Ø235mm · 绝缘端盖配合孔",
      "material": "HT250 灰铸铁"
    },
    {
      "posNo": "M-15",
      "name": "后电绝缘深沟球轴承 (6317/VL0241)",
      "category": "轴承密封",
      "spec": "6317 M/C3VL0241 · 耐击穿电压 ≥3000V DC",
      "material": "GCr15 轴承钢 + 外圈 Al2O3 等离子陶瓷绝缘层"
    },
    {
      "posNo": "M-16",
      "name": "轴承波形弹簧垫圈与轴用挡圈",
      "category": "轴承密封",
      "spec": "Ø178×Ø152×1.8mm 三峰波形弹簧 + GB894挡圈",
      "material": "65Mn 弹簧钢 (淬火回火发蓝)"
    },
    {
      "posNo": "M-17",
      "name": "电机后端盖 (非驱动端端盖)",
      "category": "机壳端盖",
      "spec": "外径 Ø550mm · 带4组风扇罩安装支耳与导风锥面",
      "material": "HT250 高强度灰铸铁"
    },
    {
      "posNo": "M-18",
      "name": "后轴承外盖与氟橡胶旋转油封",
      "category": "轴承密封",
      "spec": "外径 Ø235mm + TC 80×110×12 耐高温氟胶油封",
      "material": "HT250 灰铸铁 + FKM 氟橡胶双唇骨架油封"
    },
    {
      "posNo": "M-19",
      "name": "增量式光电旋转编码器组件",
      "category": "定转子核心",
      "spec": "HTL/TTL 1024 PPR · IP66 · 带防转弹性支臂",
      "material": "压铸铝抗干扰屏蔽壳 + 不锈钢波纹管联轴器"
    },
    {
      "posNo": "M-20",
      "name": "六叶宽弦独立强冷风扇 (复刻原图)",
      "category": "风冷与接线",
      "spec": "Ø470mm · 6枚宽弦大倾角轴流叶片 · 中心轮毂 Ø115",
      "material": "ZL104 高强铸造铝合金 (数控动平衡)"
    },
    {
      "posNo": "M-21",
      "name": "圆筒形导流风扇罩壳 (复刻原图)",
      "category": "风冷与接线",
      "spec": "外径 Ø560×长 360mm · 双层翻边导流圆筒",
      "material": "SPCC 冷轧钢板旋压成形 (深灰金属漆)"
    },
    {
      "posNo": "M-22",
      "name": "十字钢筋折弯钩头防护网罩 (复刻原图)",
      "category": "风冷与接线",
      "spec": "4横×4纵正交钢筋格栅 · 外缘 90°折弯挂钩锁紧",
      "material": "304 不锈钢冷拔钢丝 (Ø8mm 交叉点焊)"
    },
    {
      "posNo": "M-23",
      "name": "顶部高压变频接线盒壳体与盒盖",
      "category": "风冷与接线",
      "spec": "320×280×190mm · 电磁屏蔽密封腔 + 双进线口",
      "material": "ZL104 压铸铝合金 (IP55) + 双M50防爆格兰头"
    },
    {
      "posNo": "M-24",
      "name": "六柱高频瓷绝缘紫铜接线端子排",
      "category": "风冷与接线",
      "spec": "U1/V1/W1-W2/U2/V2 六柱 M12 铜桩 + △连接铜排",
      "material": "95氧化铝高频绝缘瓷 + T2紫铜导电螺柱/连片"
    },
    {
      "posNo": "M-25",
      "name": "重型型钢滑轨底座、铭牌与吊环组",
      "category": "机壳端盖",
      "spec": "1150×760×160mm 滑轨底座 + DIN580 M24 吊环×2",
      "material": "Q345B 宝蓝槽钢底座 + 304激光铭牌 + 20#锻钢吊环"
    },
    {
      "posNo": "M-26",
      "name": "地脚螺栓、张紧顶丝与铜接地桩组",
      "category": "机壳端盖",
      "spec": "8×M24地脚螺栓 + 2×M20导轨顶丝 + 铜编织接地桩",
      "material": "Q345B 热浸镀锌 (8.8级) + T2紫铜接地端子"
    }
  ],
  "motor_exploded.html": [
    {
      "posNo": "P01",
      "name": "前端定位法兰盘",
      "category": "轴承与法兰",
      "spec": "Ø980 × 115 mm",
      "material": "45# 锻钢 / 银边倒角"
    },
    {
      "posNo": "P02",
      "name": "前端盖鼓筒",
      "category": "轴承与法兰",
      "spec": "Ø1360 × 320 mm",
      "material": "HT250 灰铸铁"
    },
    {
      "posNo": "P03",
      "name": "前精密滚柱轴承",
      "category": "轴承与法兰",
      "spec": "Ø160 × Ø290 × 80 mm",
      "material": "GCr15 轴承钢 / 黄铜保持架"
    },
    {
      "posNo": "P04",
      "name": "顶部高压接线盒",
      "category": "高压电气",
      "spec": "680 × 560 × 450 mm",
      "material": "Q235B 钢板焊制 / IP55"
    },
    {
      "posNo": "P05",
      "name": "顶部双层冷却护罩",
      "category": "外壳与散热",
      "spec": "1650 × 1120 × 160 mm",
      "material": "冷轧钢板 / 深灰耐候涂层"
    },
    {
      "posNo": "P06",
      "name": "定子机座与散热片",
      "category": "外壳与散热",
      "spec": "Ø1420 × 2150 mm (28片散热筋)",
      "material": "HT250 灰铸铁 / 工业蓝灰涂装"
    },
    {
      "posNo": "P07",
      "name": "高压定子铁芯与绕组",
      "category": "电磁核心",
      "spec": "外径 Ø1180 / 内径 Ø780 mm",
      "material": "DW470 硅钢片 / 无氧紫铜线圈"
    },
    {
      "posNo": "P08",
      "name": "笼型转子与主轴",
      "category": "电磁核心",
      "spec": "总长 3120 mm / 轴颈 Ø160 mm",
      "material": "42CrMo 锻造合金钢 / 紫铜导条"
    },
    {
      "posNo": "P09",
      "name": "后精密深沟球轴承",
      "category": "轴承与法兰",
      "spec": "Ø160 × Ø290 × 48 mm",
      "material": "GCr15 轴承钢 / 绝缘涂层"
    },
    {
      "posNo": "P10",
      "name": "后端盖与散热风扇",
      "category": "外壳与散热",
      "spec": "Ø1320 × 260 mm (12叶片)",
      "material": "HT250 灰铸铁 / 铝合金叶轮"
    },
    {
      "posNo": "P11",
      "name": "后端导流散热风罩",
      "category": "外壳与散热",
      "spec": "Ø1380 × 460 mm",
      "material": "Q235 冷压钢板 / 蓝灰涂装"
    },
    {
      "posNo": "P12",
      "name": "重型安装底板台架",
      "category": "外壳与散热",
      "spec": "2600 × 2200 × 120 mm",
      "material": "Q345B 低合金高强钢板"
    }
  ],
  "pump_exploded.html": [
    {
      "posNo": "P01",
      "name": "重型铸铁公用泵座底座",
      "category": "底座与紧固螺栓",
      "spec": "2150×780×220mm / 带集水盘",
      "material": "HT250 高强灰铸铁 (深灰重工涂装)"
    },
    {
      "posNo": "P02",
      "name": "地脚螺栓、双螺母与调平垫铁组",
      "category": "底座与紧固螺栓",
      "spec": "M30×650mm (8.8级) × 8套",
      "material": "35CrMoA 合金结构钢 + 淬硬垫铁"
    },
    {
      "posNo": "P03",
      "name": "挠性叠片膜片联轴器总成",
      "category": "联轴器与轴承系统",
      "spec": "Ø260×280mm / 304不锈钢膜片",
      "material": "42CrMo 锻造合金钢 + 304叠片组"
    },
    {
      "posNo": "P04",
      "name": "联轴器高强铰制孔螺栓与螺母组",
      "category": "底座与紧固螺栓",
      "spec": "M20×90mm (10.9级) × 12套",
      "material": "40Cr 调质合金钢 (发黑防松)"
    },
    {
      "posNo": "P05",
      "name": "前轴承箱端盖与黄铜迷宫甩油环",
      "category": "联轴器与轴承系统",
      "spec": "Ø280×65mm / 复合迷宫齿",
      "material": "HT300 铸铁端盖 + H62黄铜油封"
    },
    {
      "posNo": "P06",
      "name": "前滑动轴承 (驱动端巴氏合金剖分瓦)",
      "category": "联轴器与轴承系统",
      "spec": "Ø90×Ø160×110mm / 上下对开瓦",
      "material": "20钢瓦背 + ZChSnSb11-6 巴氏合金"
    },
    {
      "posNo": "P07",
      "name": "前轴承箱体 (驱动端水冷式轴承座)",
      "category": "联轴器与轴承系统",
      "spec": "Ø340×260mm / 360°环形托架",
      "material": "HT300 高强灰铸铁 (工业橙涂装)"
    },
    {
      "posNo": "P08",
      "name": "轴承润滑黄铜油嘴组与恒位油杯",
      "category": "联轴器与轴承系统",
      "spec": "G3/8\" 黄铜喷油嘴×8 + 玻璃油杯",
      "material": "H62 精车黄铜 + 硼硅玻璃油窗"
    },
    {
      "posNo": "P09",
      "name": "前机械密封压盖与急冷冲洗接头",
      "category": "机封与轴套平衡",
      "spec": "Ø230×48mm / API Plan 23 接口",
      "material": "316L 奥氏体不锈钢 + 黄铜管咀"
    },
    {
      "posNo": "P10",
      "name": "前端集装式高压机械密封组件",
      "category": "机封与轴套平衡",
      "spec": "Ø110×85mm / 碳化硅对磨副",
      "material": "SiC 碳化硅 + 哈氏合金弹簧 + 铜套"
    },
    {
      "posNo": "P11",
      "name": "前轴套与止退锁紧圆螺母组件",
      "category": "机封与轴套平衡",
      "spec": "Ø105×130mm + M80开槽圆螺母",
      "material": "2Cr13 氮化硬化不锈钢 + 铜垫圈"
    },
    {
      "posNo": "P12",
      "name": "进水段高压壳体 (带垂直吸入口)",
      "category": "进出水与中段壳体",
      "spec": "Ø560×280mm / DN150 PN64法兰",
      "material": "ZG230-450 铸钢 (工业橙重工涂装)"
    },
    {
      "posNo": "P13",
      "name": "顶部高压排气阀总成 (针型阀与手轮)",
      "category": "阀门与铭牌辅件",
      "spec": "DN20 PN160 锻造针型排气阀",
      "material": "316L 不锈钢阀体 + 铜阀杆 + 红手轮"
    },
    {
      "posNo": "P14",
      "name": "底部高压放水阀总成 (多级排污阀组)",
      "category": "阀门与铭牌辅件",
      "spec": "DN25 PN160 高压排污截止阀歧管",
      "material": "A105 锻钢阀体 + H62黄铜阀座"
    },
    {
      "posNo": "P15",
      "name": "激光蚀刻不锈钢泵铭牌与压力表组",
      "category": "阀门与铭牌辅件",
      "spec": "260×150×3mm 铭牌 + 耐震压力表",
      "material": "304 拉丝不锈钢 + 铜铆钉 + 铜表座"
    },
    {
      "posNo": "P16",
      "name": "首级抗汽蚀高铬不锈钢闭式叶轮 (第1级)",
      "category": "多级叶轮与导叶",
      "spec": "Ø265×68mm / 7片三维扭曲叶片",
      "material": "ZG06Cr13Ni4Mo 马氏体不锈钢"
    },
    {
      "posNo": "P17",
      "name": "一级导叶与回流器组件 (第1级)",
      "category": "多级叶轮与导叶",
      "spec": "Ø395×78mm / 8道螺旋扩压流道",
      "material": "ZCuSn10Pb1 铸造锡青铜 + 不锈钢盘"
    },
    {
      "posNo": "P18",
      "name": "一级中间段高压壳体 (第1节中段)",
      "category": "进出水与中段壳体",
      "spec": "Ø460×115mm / 止口精密配合",
      "material": "ZG230-450 锻造碳钢 (工业橙涂装)"
    },
    {
      "posNo": "P19",
      "name": "二级次级不锈钢高压叶轮 (第2级)",
      "category": "多级叶轮与导叶",
      "spec": "Ø260×62mm / 7片后弯闭式叶片",
      "material": "06Cr13Ni4Mo 高强不锈钢精铸"
    },
    {
      "posNo": "P20",
      "name": "二级导叶与回流器组件 (第2级)",
      "category": "多级叶轮与导叶",
      "spec": "Ø395×78mm / 8片青铜正反导叶",
      "material": "ZCuSn10Pb1 铸造锡青铜 + 2Cr13盘"
    },
    {
      "posNo": "P21",
      "name": "二级中间段高压壳体 (第2节中段)",
      "category": "进出水与中段壳体",
      "spec": "Ø460×115mm / 耐压 18MPa",
      "material": "ZG230-450 锻造碳钢 (工业橙涂装)"
    },
    {
      "posNo": "P22",
      "name": "三级次级不锈钢高压叶轮 (第3级)",
      "category": "多级叶轮与导叶",
      "spec": "Ø260×62mm / 7片后弯闭式叶片",
      "material": "06Cr13Ni4Mo 高强不锈钢精铸"
    },
    {
      "posNo": "P23",
      "name": "三级导叶与回流器组件 (第3级)",
      "category": "多级叶轮与导叶",
      "spec": "Ø395×78mm / 8流道扩压回流盘",
      "material": "ZCuSn10Pb1 铸造锡青铜 + 2Cr13盘"
    },
    {
      "posNo": "P24",
      "name": "三级中间段高压壳体 (第3节中段)",
      "category": "进出水与中段壳体",
      "spec": "Ø460×115mm / 带测压与放水孔",
      "material": "ZG230-450 锻造碳钢 (工业橙涂装)"
    },
    {
      "posNo": "P25",
      "name": "四级末级不锈钢高压叶轮 (第4级)",
      "category": "多级叶轮与导叶",
      "spec": "Ø260×62mm / 末级高压闭式叶轮",
      "material": "06Cr13Ni4Mo 高强马氏体不锈钢"
    },
    {
      "posNo": "P26",
      "name": "末级导叶与出水扩压环 (第4级)",
      "category": "多级叶轮与导叶",
      "spec": "Ø405×72mm / 10叶环形扩压器",
      "material": "ZCuSn10Pb1 铸造锡青铜 (金色精车)"
    },
    {
      "posNo": "P27",
      "name": "级间缠绕密封垫片、铜口环与定位销组",
      "category": "机封与轴套平衡",
      "spec": "Ø410缠绕垫×4 + 铜口环×4 + 定位销×8",
      "material": "316L/石墨缠绕垫 + 锡青铜 + Viton氟胶"
    },
    {
      "posNo": "P28",
      "name": "级间青铜轴套与节流衬套组 (3套)",
      "category": "机封与轴套平衡",
      "spec": "Ø95×76mm × 3件套阶梯定位套",
      "material": "ZCuSn10Pb1 离心铸造高耐磨锡青铜"
    },
    {
      "posNo": "P29",
      "name": "多级阶梯精密长泵轴与平键组",
      "category": "多级叶轮与导叶",
      "spec": "Ø95×2480mm / 7段阶梯 + 6条平键",
      "material": "42CrMoA 真空重熔合金锻钢 (镜面磨削)"
    },
    {
      "posNo": "P30",
      "name": "出水段超高压壳体 (带垂直出水法兰)",
      "category": "进出水与中段壳体",
      "spec": "Ø580×310mm / DN125 PN160加厚法兰",
      "material": "ZG230-450 厚壁铸钢 (工业橙重工涂装)"
    },
    {
      "posNo": "P31",
      "name": "平衡环与青铜平衡套组件",
      "category": "机封与轴套平衡",
      "spec": "Ø275×55mm 平衡环 + Ø115青铜套",
      "material": "ZCuSn10Pb1 锡青铜 + Cr15Mo3高铬铸铁"
    },
    {
      "posNo": "P32",
      "name": "阶梯平衡盘与平衡压紧螺母组件",
      "category": "机封与轴套平衡",
      "spec": "Ø280×62mm 渗氮平衡盘 + 锁紧螺母",
      "material": "2Cr13 锻造马氏体不锈钢 (表面离子氮化)"
    },
    {
      "posNo": "P33",
      "name": "后端机械密封组件与密封压盖",
      "category": "机封与轴套平衡",
      "spec": "Ø220×75mm / 平衡腔集装机封+压盖",
      "material": "316L 不锈钢压盖 + SiC动静环 + 铜衬套"
    },
    {
      "posNo": "P34",
      "name": "后滑动轴承 (非驱动端巴氏合金剖分瓦)",
      "category": "联轴器与轴承系统",
      "spec": "Ø85×Ø150×105mm / 对开式圆瓦",
      "material": "20钢瓦背 + ZChSnSb11-6 锡基巴氏合金"
    },
    {
      "posNo": "P35",
      "name": "后轴承箱体与尾端封闭端盖",
      "category": "联轴器与轴承系统",
      "spec": "Ø330×250mm / 水冷夹套+呼吸器",
      "material": "HT300 高强铸铁 (工业橙) + 钢化油镜"
    },
    {
      "posNo": "P36",
      "name": "穿杠拉紧长螺栓与重型双螺母组 (12根)",
      "category": "底座与紧固螺栓",
      "spec": "M42×1950mm (10.9级) × 12根环绕穿杠",
      "material": "40CrNiMoA 超高强合金钢 + 48枚六角螺母"
    }
  ],
  "robot_exploded_v2.html": [
    {
      "posNo": "IR005-A01",
      "name": "安装底板",
      "category": "结构铸件",
      "material": "S45C 调质结构钢 (发黑防锈)"
    },
    {
      "posNo": "IR005-A02",
      "name": "地脚螺栓",
      "category": "紧固与密封",
      "material": "SCM435 合金钢 (12.9级镀镍)"
    },
    {
      "posNo": "IR005-A03",
      "name": "基座框架",
      "category": "结构铸件",
      "material": "ZL101A-T6 航空铸造铝合金"
    },
    {
      "posNo": "IR005-A04",
      "name": "底部驱动电路板",
      "category": "电子与执行器",
      "material": "FR-4 四层沉金玻纤板 + 贴片IC"
    },
    {
      "posNo": "IR005-A05",
      "name": "J1轴电机/减速器",
      "category": "传动与电机",
      "material": "40CrMo 柔轮钢 + 紫铜绕组 + 轴承钢"
    },
    {
      "posNo": "IR005-A06",
      "name": "J1密封环与螺栓",
      "category": "紧固与密封",
      "material": "丁腈橡胶 (NBR) + 304不锈钢螺丝"
    },
    {
      "posNo": "IR005-A07",
      "name": "腰座",
      "category": "结构铸件",
      "material": "A356-T6 铸铝合金 + 深灰阳极氧化盖"
    },
    {
      "posNo": "IR005-A08",
      "name": "J2轴关节",
      "category": "传动与电机",
      "material": "轴承钢 + 紫铜线圈 + 深灰铝端盖"
    },
    {
      "posNo": "IR005-A09",
      "name": "大臂",
      "category": "结构铸件",
      "material": "6061-T6 精密锻造铝合金 (亮银白喷涂)"
    },
    {
      "posNo": "IR005-A10",
      "name": "J3轴",
      "category": "传动与电机",
      "material": "特种合金钢 + 紫铜定子 + 铝散热壳"
    },
    {
      "posNo": "IR005-A11",
      "name": "小臂",
      "category": "结构铸件",
      "material": "A356 轻量化铸铝 + 内部谐波传动轴"
    },
    {
      "posNo": "IR005-A12",
      "name": "腕部",
      "category": "传动与电机",
      "material": "7075 航空铝 + 精密交叉滚子轴承"
    },
    {
      "posNo": "IR005-A13",
      "name": "六维力传感器与法兰",
      "category": "电子与执行器",
      "material": "17-4PH 沉淀硬化不锈钢 + 应变片电桥"
    },
    {
      "posNo": "IR005-A14",
      "name": "夹爪",
      "category": "电子与执行器",
      "material": "硬质阳极氧化铝缸体 + S7工具钢夹指"
    }
  ]
};
