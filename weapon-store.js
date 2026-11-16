(function () {
  const KEY = "sword-weapons-v1";

  const DEFAULTS = [
    {
      id: "guan",
      name: "關刀",
      image: "weaponsDatabase/guandao.webp",
      mass: 16,
      friction: 0.96,
      scale: 1.08,
      price: "$6.0",
      tint: "#e31c23",
      value: 4,
      weight: 5,
      grip: 5,
      trait: "又重又黏枱，撞到都難推走，適合壓住對手。",
    },
    {
      id: "jian",
      name: "長劍",
      image: "weaponsDatabase/jian.webp",
      mass: 6.2,
      friction: 0.4,
      scale: 0.96,
      price: "$4.5",
      tint: "#3ec6ff",
      value: 2,
      weight: 2,
      grip: 2,
      trait: "彈射速度極快，適合快攻。",
    },
    {
      id: "ji",
      name: "方天畫戟",
      image: "weaponsDatabase/fangtian_ji.webp",
      mass: 16,
      friction: 0.72,
      scale: 1,
      price: "$10.0",
      tint: "#f0c14a",
      value: 5,
      weight: 4,
      grip: 4,
      statsRev: 3,
      trait: "戟頭分叉，擦中就帶埋對手轉。",
    },
    {
      id: "dadao",
      name: "大刀",
      image: "weaponsDatabase/dadao.webp",
      mass: 13.5,
      friction: 0.9,
      scale: 1.04,
      price: "$5.0",
      tint: "#e48aaa",
      value: 3,
      weight: 4,
      grip: 4,
      trait: "刀身厚實，貼住枱面就好難甩。",
    },
    {
      id: "snake",
      name: "蛇劍",
      image: "weaponsDatabase/snakesword.webp",
      mass: 7.4,
      friction: 0.48,
      scale: 1,
      price: "$7.0",
      tint: "#1f8a45",
      value: 5,
      weight: 3,
      grip: 3,
      trait: "身輕又滑，擦過就轉彎，適合刁鑽角度。",
    },
  ];

  function load() {
    let saved = [];
    try {
      saved = JSON.parse(localStorage.getItem(KEY) || "[]");
    } catch (error) {
      saved = [];
    }
    if (!Array.isArray(saved)) saved = [];
    const byId = {};
    saved.forEach((item) => {
      if (item && item.id) byId[item.id] = item;
    });
    const imageWebp = {
      "weaponsDatabase/guandao.png": "weaponsDatabase/guandao.webp",
      "weaponsDatabase/jian.png": "weaponsDatabase/jian.webp",
      "weaponsDatabase/fangtian_ji.png": "weaponsDatabase/fangtian_ji.webp",
      "weaponsDatabase/Dadao.png": "weaponsDatabase/dadao.webp",
      "weaponsDatabase/dadao.png": "weaponsDatabase/dadao.webp",
      "weaponsDatabase/snakesword.png": "weaponsDatabase/snakesword.webp",
      "weaponsDatabase/battle_axe.png": "weaponsDatabase/battle_axe.webp",
      "weaponsDatabase/half-moon _halberd.png": "weaponsDatabase/half-moon _halberd.webp",
    };
    const statKeys = ["mass", "price", "value", "weight", "grip", "image"];
    let upgraded = false;
    const merged = DEFAULTS.map((base) => {
      const savedItem = byId[base.id];
      const next = Object.assign({}, base, savedItem || {});
      if (savedItem && base.statsRev && (savedItem.statsRev || 0) < base.statsRev) {
        statKeys.forEach((key) => { next[key] = base[key]; });
        next.statsRev = base.statsRev;
        upgraded = true;
      }
      if (imageWebp[next.image]) {
        next.image = imageWebp[next.image];
        upgraded = true;
      }
      return next;
    });
    const extras = saved.filter((item) => item && item.id && !DEFAULTS.some((base) => base.id === item.id));
    const list = merged.concat(extras);
    if (upgraded) save(list);
    return list;
  }

  function save(list) {
    localStorage.setItem(KEY, JSON.stringify(list));
  }

  function reset() {
    localStorage.removeItem(KEY);
  }

  window.WeaponStore = { KEY, DEFAULTS, load, save, reset };
})();
