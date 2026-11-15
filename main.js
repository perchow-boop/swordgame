/* 膠劍仔大戰 — 課室枱面雙人輕彈。直接用瀏覽器打開 index.html。 */
(function () {
  if (!window.Matter) {
    document.body.insertAdjacentHTML(
      "afterbegin",
      '<p class="help">搵唔到 matter.min.js。請同 index.html 放喺同一個資料夾再重新打開。</p>'
    );
    return;
  }

  const { Engine, Bodies, Body, Events, Sleeping, Composite, Bounds } = Matter;

  const VIEW_W = 1920;
  const VIEW_H = 1080;
  const RIM = 64;
  const TABLE_YAW = Math.PI / 4;
  const tune = {
    tableAir: 0.1,
    flightAir: 0.015,
    skimSpeed: 7.2,
    skimAir: 0.012,
    swordFriction: 0.8,
    swordStatic: 1.05,
    wallFriction: 0.4,
    stackAir: 0.015,
    stackSlide: 0.035,
    overlapMin: 850,
    stackH: 18,
    maxDrag: 165,
    flickPower: 0.11,
    minSpeed: 2.2,
    maxSpeed: 18,
    chargeMs: 900,
    chargeSpeed: 1,
    spinCap: 0.16,
    zGravity: 0.52,
    restitution: 0.42,
    wallBounce: 0.34,
    hop: 0,
    hopScale: 0.04,
    quietNeed: 18,
    stableNeed: 10,
    turnNeed: 36,
  };
  const TUNE_BASE = Object.assign({}, tune);
  const TERRAINS = {
    wood: {
      id: "wood",
      name: "木桌",
      baseFriction: 0.8,
      groundRestitution: 0.34,
      image: "scenes/wooden _table.jpg",
      fallback: "#3d2618",
      blurb: "場地：木桌。手感跟返原本。",
    },
    terrazzo: {
      id: "terrazzo",
      name: "水磨石",
      baseFriction: 0.65,
      groundRestitution: 0.38,
      image: "scenes/terrazzo_floor.jpg",
      fallback: "#d7d2c8",
      blurb: "場地：水磨石。阻力低，滑得遠，撞落去較彈。",
    },
    concrete: {
      id: "concrete",
      name: "水泥地",
      baseFriction: 1.15,
      groundRestitution: 0.18,
      image: "scenes/cement_floor.jpg",
      fallback: "#8d8882",
      blurb: "場地：水泥地。阻力高，快停，撞落去沉實。",
    },
  };
  let terrain = TERRAINS.wood;
  const floorImages = {};
  const ZONE_MUL = {
    grip: { friction: 0.38, restitution: 0.62 },
    blade: { friction: 1, restitution: 1 },
    edge: { friction: 1.72, restitution: 0.38 },
  };
  const FORGE_ZONES = [
    ["grip", "forge-grip-friction", "forge-grip-bounce"],
    ["blade", "forge-blade-friction", "forge-blade-bounce"],
    ["edge", "forge-edge-friction", "forge-edge-bounce"],
  ];
  const WALL_CAT = 0x0001;
  const SWORD_CAT = 0x0002;
  const SUBSTEPS = 3;
  const STEP = 1000 / 60;

  const canvas = document.getElementById("arena");
  const ctx = canvas.getContext("2d");
  const intro = document.getElementById("intro");
  const resultBox = document.getElementById("result");
  const startBtn = document.getElementById("start-btn");
  const againBtn = document.getElementById("again-btn");
  const statusEl = document.getElementById("status");
  const scoreline = document.getElementById("scoreline");
  const helpBtn = document.getElementById("help-btn");
  const muteBtn = document.getElementById("mute-btn");
  const clearBtn = document.getElementById("clear-btn");
  const playPage = document.body.classList.contains("play-body");
  const touchLayout = playPage && window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  if (touchLayout) document.body.classList.add("is-touch");
  const pauseBox = document.getElementById("pause");

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const engine = Engine.create({
    enableSleeping: true,
    positionIterations: 10,
    velocityIterations: 8,
  });
  engine.gravity.y = 0;
  engine.gravity.x = 0;
  engine.gravity.scale = 0;
  installZoneContacts();

  const backdrop = document.createElement("canvas");

  const POINTS_TO_GAME = 3;
  const GAMES_TO_MATCH = 2;
  let started = false;
  let phase = "intro";
  let current = null;
  let matchOver = false;
  let drag = null;
  let lastLoser = null;
  let lastMover = null;
  let lastSlip = null;
  let controlMode = "flick";
  let forgeOpen = false;
  let matchMode = "duo";
  let roomCode = "";
  let onlineSeat = "";
  let onlineToken = "";
  let onlineAfter = 0;
  let onlineReady = true;
  let onlineDrafts = { p1: null, p2: null };
  let onlineWeapon = "pack";
  let onlineBus = null;
  let onlinePeer = null;
  let onlineOutbox = [];
  let onlinePeerAttempt = 0;
  let onlinePeerTimer = 0;
  let onlinePeerHideBound = false;
  let onlineGuestAttempt = 0;
  let onlineGuestTimer = 0;
  let onlineGuestEpoch = 0;
  let onlineGuestConn = null;
  let onlineGuestGiveUp = null;
  let onlineGuestFault = "";
  let onlineWait = false;
  let onlineWaitAt = 0;
  let onlineSawPeer = false;
  let onlineLastSent = "";
  let onlineLastPush = 0;
  let aiLevel = "normal";
  let cpuPlan = null;
  let fingerFlash = null;
  const fingerCharge = prepareFinger("images/hands/ready.png", "images/finger01.png");
  const fingerFlick = prepareFinger("images/hands/flick.png", "images/finger02.png");
  const fingerPoint = prepareFinger("images/finger03.png");
  const fingerSnap = prepareFinger("images/finger04.png");
  let shake = 0;
  let quietFrames = 0;
  let stuckCover = 0;
  let stableVerdict = null;
  let stableCount = 0;
  let acc = 0;
  let lastTime = 0;
  let audioCtx = null;
  let muted = false;
  let lastHitSfx = 0;
  const particles = [];
  const rings = [];

  const wallFilter = { category: WALL_CAT, mask: SWORD_CAT };
  const statics = [
    Bodies.rectangle(RIM - 40, VIEW_H / 2, 80, VIEW_H + 80, {
      isStatic: true,
      friction: tune.wallFriction,
      restitution: tune.wallBounce,
      label: "wall",
      collisionFilter: wallFilter,
    }),
    Bodies.rectangle(VIEW_W - RIM + 40, VIEW_H / 2, 80, VIEW_H + 80, {
      isStatic: true,
      friction: tune.wallFriction,
      restitution: tune.wallBounce,
      label: "wall",
      collisionFilter: wallFilter,
    }),
    Bodies.rectangle(VIEW_W / 2, RIM - 40, VIEW_W + 80, 80, {
      isStatic: true,
      friction: tune.wallFriction,
      restitution: tune.wallBounce,
      label: "wall",
      collisionFilter: wallFilter,
    }),
    Bodies.rectangle(VIEW_W / 2, VIEW_H - RIM + 40, VIEW_W + 80, 80, {
      isStatic: true,
      friction: tune.wallFriction,
      restitution: tune.wallBounce,
      label: "wall",
      collisionFilter: wallFilter,
    }),
  ];
  Composite.add(engine.world, statics);

  const weaponsDatabase = {
    guandao: {
      id: "guan",
      name: "關刀",
      image: "weaponsDatabase/guandao.png",
      mass: 16,
      friction: 0.96,
      scale: 1.08,
      price: "$6.0",
      tint: "#e31c23",
      parts: [
        { kind: "box", role: "shaft", thick: 1, x: -22, y: 0, w: 150, h: 12, chamfer: 3, fill: "#8d5a32" },
        { kind: "box", role: "spine", thick: 0.92, x: 82, y: -2, w: 86, h: 20, angle: -0.16, chamfer: 4, fill: "#d01218" },
        { kind: "box", role: "edge", thick: 0.28, x: 96, y: -16, w: 74, h: 8, angle: -0.3, chamfer: 2, fill: "#f6d5d6" },
        { kind: "box", role: "collar", thick: 0.7, x: 40, y: 4, w: 22, h: 18, chamfer: 3, fill: "#f0c14a" },
        { kind: "circle", role: "pommel", thick: 1, x: -108, y: 0, r: 8, fill: "#4a2c18" },
      ],
    },
    jian: {
      id: "jian",
      name: "長劍",
      image: "weaponsDatabase/jian.png",
      mass: 6.2,
      friction: 0.4,
      scale: 0.96,
      price: "$4.5",
      tint: "#3ec6ff",
      parts: [
        { kind: "box", role: "blade", thick: 0.4, x: 42, y: 0, w: 172, h: 14, chamfer: 4, fill: "#e7ebf0" },
        { kind: "box", role: "guard", thick: 0.75, x: -50, y: 0, w: 10, h: 36, chamfer: 2, fill: "#d4af37" },
        { kind: "box", role: "grip", thick: 1, x: -84, y: 0, w: 54, h: 12, chamfer: 4, fill: "#1f6b4a" },
        { kind: "circle", role: "pommel", thick: 1, x: -118, y: 0, r: 7, fill: "#d4af37" },
      ],
    },
    ji: {
      id: "ji",
      name: "方天畫戟",
      image: "weaponsDatabase/fangtian_ji.png",
      mass: 16,
      friction: 0.72,
      scale: 1,
      price: "$10.0",
      tint: "#f0c14a",
      parts: [
        { kind: "box", role: "shaft", thick: 1, x: -8, y: 0, w: 168, h: 12, chamfer: 3, fill: "#2c2c2c" },
        { kind: "box", role: "tip", thick: 0.42, x: 104, y: 0, w: 54, h: 14, chamfer: 4, fill: "#f0c14a" },
        { kind: "box", role: "horn", thick: 0.3, x: 66, y: -20, w: 50, h: 11, angle: -0.72, chamfer: 4, fill: "#f0c14a" },
        { kind: "box", role: "horn", thick: 0.3, x: 66, y: 20, w: 50, h: 11, angle: 0.72, chamfer: 4, fill: "#f0c14a" },
        { kind: "circle", role: "pommel", thick: 1, x: -106, y: 0, r: 8, fill: "#9f1d18" },
      ],
    },
    dadao: {
      id: "dadao",
      name: "大刀",
      image: "weaponsDatabase/Dadao.png",
      mass: 13.5,
      friction: 0.9,
      scale: 1.04,
      price: "$5.0",
      tint: "#e48aaa",
      parts: [
        { kind: "box", role: "spine", thick: 0.9, x: 24, y: 2, w: 140, h: 28, chamfer: 8, fill: "#e48aaa" },
        { kind: "box", role: "edge", thick: 0.32, x: 40, y: -16, w: 120, h: 10, chamfer: 3, fill: "#f6d5e4" },
        { kind: "box", role: "guard", thick: 0.75, x: -58, y: 0, w: 18, h: 34, chamfer: 3, fill: "#f3c4d4" },
        { kind: "box", role: "grip", thick: 1, x: -96, y: 0, w: 52, h: 14, chamfer: 5, fill: "#c46b8a" },
        { kind: "circle", role: "pommel", x: -128, y: 0, r: 9, fill: "#f3c4d4" },
      ],
    },
    snakesword: {
      id: "snake",
      name: "蛇劍",
      image: "weaponsDatabase/snakesword.png",
      mass: 7.4,
      friction: 0.48,
      scale: 1,
      price: "$7.0",
      tint: "#1f8a45",
      parts: [
        { kind: "box", role: "blade", thick: 0.45, x: 36, y: 0, w: 168, h: 16, chamfer: 4, fill: "#1f8a45" },
        { kind: "box", role: "wave", thick: 0.3, x: 20, y: -14, w: 70, h: 12, angle: -0.35, chamfer: 4, fill: "#39b86a" },
        { kind: "box", role: "wave", thick: 0.3, x: 48, y: 14, w: 70, h: 12, angle: 0.35, chamfer: 4, fill: "#167a38" },
        { kind: "box", role: "guard", thick: 0.75, x: -62, y: 0, w: 12, h: 34, chamfer: 2, fill: "#d8f5e2" },
        { kind: "box", role: "grip", thick: 1, x: -96, y: 0, w: 50, h: 12, chamfer: 4, fill: "#0e5c2c" },
        { kind: "circle", role: "pommel", x: -128, y: 0, r: 8, fill: "#d8f5e2" },
      ],
    },
  };

  function applyStoredWeapons() {
    if (!window.WeaponStore) return [];
    const extras = [];
    WeaponStore.load().forEach((item) => {
      const record = Object.keys(weaponsDatabase)
        .map((key) => weaponsDatabase[key])
        .find((weapon) => weapon.id === item.id);
      if (record) {
        record.name = item.name || record.name;
        record.mass = Number(item.mass);
        record.friction = Number(item.friction);
        record.scale = Number(item.scale) || record.scale;
        record.price = item.price || record.price;
        if (item.tint) record.tint = item.tint;
        if (item.imageData) record.image = item.imageData;
        return;
      }
      extras.push(item);
    });
    return extras;
  }

  const storedExtras = applyStoredWeapons();

  let weaponSerial = 1;

  const GUAN = weaponFromRecord(weaponsDatabase.guandao);
  const JIAN = weaponFromRecord(weaponsDatabase.jian);
  const JI = weaponFromRecord(weaponsDatabase.ji);
  const DADAO = weaponFromRecord(weaponsDatabase.dadao);
  const SNAKE = weaponFromRecord(weaponsDatabase.snakesword);

  const p1Catalog = ownCatalog([GUAN, JIAN, JI, DADAO, SNAKE]);
  const p2Catalog = ownCatalog([GUAN, JIAN, JI, DADAO, SNAKE]);
  const p1 = makePlayer("p1", "玩家一", "#c81d25", 420, 560, -0.04 + TABLE_YAW, p1Catalog, p1Catalog[0]);
  const p2 = makePlayer("p2", "玩家二", "#1d4fbf", 1500, 520, Math.PI + 0.04 + TABLE_YAW, p2Catalog, p2Catalog[0]);
  const players = [p1, p2];
  current = p1;

  bindUi();
  renderArmory(p1);
  renderArmory(p2);
  arm(p1, p1.weapon);
  arm(p2, p2.weapon);
  storedExtras.forEach((item) => {
    const record = {
      id: item.id,
      name: item.name || "新武器",
      image: item.imageData || item.image || "",
      mass: Number(item.mass) || 8,
      friction: Number(item.friction) || 0.7,
      scale: Number(item.scale) || 1,
      price: item.price || "自訂",
      tint: item.tint || "#8d6a3a",
      parts: [
        { kind: "box", role: "blade", x: 30, y: 0, w: 170, h: 18, chamfer: 4, fill: item.tint || "#cccccc" },
        { kind: "box", role: "grip", x: -80, y: 0, w: 48, h: 14, chamfer: 4, fill: "#5a331c" },
      ],
    };
    weaponsDatabase[record.id] = record;
    const weapon = weaponFromRecord(record);
    players.forEach((player) => player.catalog.push(cloneWeapon(weapon)));
  });
  if (storedExtras.length) {
    renderArmory(p1);
    renderArmory(p2);
  }
  const launch = new URLSearchParams(window.location.search);
  const launchMode = launch.get("mode");
  const drafted = launchMode === "cpu" ? draftIds() : [];
  let rolled = (launch.get("roll") || "").split(",").map((id) => id.trim()).filter(Boolean);
  if (launch.get("weapon") === "random") onlineWeapon = "random";
  const picked = launch.get("p1") || launch.get("p2");
  roomCode = (launch.get("room") || "").toUpperCase();
  onlineSeat = (launch.get("seat") || "").toLowerCase();
  if (launchMode === "online" && onlineSeat !== "p1" && onlineSeat !== "p2") onlineSeat = "p1";
  let onlineRedirecting = false;
  if (playPage && launchMode === "online" && onlineWeapon === "random" && rolled.length < 3) rolled = pickThreeWeaponIds();
  if (playPage && launchMode === "online" && onlineWeapon !== "random" && rolled.length < 3) {
    const savedDraw = draftIds();
    if (savedDraw.length >= 3) rolled = savedDraw.slice(0, 3);
  }
  if (playPage && launchMode === "online" && onlineWeapon !== "random" && rolled.length < 3) {
    onlineRedirecting = true;
    const back = new URLSearchParams();
    back.set("mode", "online");
    back.set("weapon", "pack");
    if (roomCode) back.set("room", roomCode);
    if (onlineSeat) back.set("seat", onlineSeat);
    const terrainId = launch.get("terrain") || "";
    if (terrainId) back.set("terrain", terrainId);
    try {
      sessionStorage.setItem("sword-play-v1", JSON.stringify({
        mode: "online",
        terrain: terrainId,
        ai: "",
        room: roomCode,
        seat: onlineSeat,
        weapon: "pack",
      }));
    } catch (error) {}
    window.location.replace("pack.html?" + back.toString());
  }
  if (rolled.length && launchMode === "online") {
    onlineDrafts[onlineSeat] = rolled.slice(0, 3);
    try {
      applySeatLoadout(onlineSeat === "p2" ? p2 : p1, onlineDrafts[onlineSeat]);
    } catch (error) {}
  } else if (rolled.length) applyDrawnLoadout(rolled);
  else if (launchMode === "cpu" && !picked) applyDrawnLoadout(drafted);
  if (!rolled.length && picked) {
    equipNamed(p1, launch.get("p1"));
    equipNamed(p2, launch.get("p2"));
  }
  loadWeaponsDatabase();
  paintBackdrop();
  if (launch.get("ai")) setAiLevel(launch.get("ai"));
  if (launch.get("terrain")) applyTerrain(launch.get("terrain"));
  if (launchMode === "online") onlineReady = false;
  syncHud();
  setStatus("撳「開波」，玩家一先射。");
  if (!onlineRedirecting && (launchMode === "cpu" || launchMode === "duo" || launchMode === "online")) {
    applyMatchMode(launchMode);
    startMatch();
    if (launchMode === "online") onlineBegin();
  } else if (!playPage) {
    startMatch();
  }
  paintPlayBrief();

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(paintBackdrop);
  }

  Events.on(engine, "beforeUpdate", () => {
    for (const player of players) {
      if (!player.body) continue;
      player.hitSpeed = player.body.speed;
      player.hitVelocity = { x: player.body.velocity.x, y: player.body.velocity.y };
    }
    if (!drag) return;
    const body = drag.player.body;
    Sleeping.set(body, false);
    Body.setPosition(body, drag.origin);
    Body.setAngle(body, drag.startAngle);
    Body.setVelocity(body, { x: 0, y: 0 });
    Body.setAngularVelocity(body, 0);
  });

  Events.on(engine, "afterUpdate", () => {
    if (phase !== "fly") return;
    for (const player of players) {
      const speed = player.body.speed;
      if (speed > tune.maxSpeed) {
        const scale = tune.maxSpeed / speed;
        Body.setVelocity(player.body, {
          x: player.body.velocity.x * scale,
          y: player.body.velocity.y * scale,
        });
      }
    }
  });

  Events.on(engine, "collisionStart", (event) => {
    let strongest = 0;
    let point = null;
    const kicked = new Map();
    for (const pair of event.pairs) {
      const rel = relativeSpeed(pair.bodyA, pair.bodyB);
      const support = pair.collision && pair.collision.supports && pair.collision.supports[0];
      const hitPoint = support || {
        x: (pair.bodyA.position.x + pair.bodyB.position.x) / 2,
        y: (pair.bodyA.position.y + pair.bodyB.position.y) / 2,
      };
      bumpFromHit(pair, hitPoint, kicked);
      if (rel < 2.4) continue;
      if (rel > strongest) {
        strongest = rel;
        point = hitPoint;
      }
    }
    if (!point) return;
    burst(point.x, point.y, strongest, "#f6e2b3");
    shake = Math.min(6, strongest * 0.28);
    playHit(strongest);
  });

  requestAnimationFrame(frame);

  function frame(now) {
    const dt = lastTime ? Math.min(34, now - lastTime) : STEP;
    lastTime = now;
    const paused = !intro.hidden || phase === "result" || (pauseBox && !pauseBox.hidden);
    if (!paused && !(onlineGuest() && onlineToken)) {
      fireCpuShot(now);
      stepWorld(dt);
      noteMotion();
      noteIdleCover();
    } else if (!paused && onlineGuest() && phase === "fly") {
      stepWorld(dt);
    } else {
      acc = 0;
    }
    if (onlineWait && phase !== "fly" && now - onlineWaitAt > 2500) onlineWait = false;
    if (onlineWait && now - onlineWaitAt > 15000) onlineWait = false;
    render(now);
    updateDesk();
    requestAnimationFrame(frame);
  }

  function render(now) {
    fitCanvas();
    ctx.drawImage(backdrop, 0, 0, VIEW_W, VIEW_H);
    ctx.save();
    if (!reducedMotion && shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      shake *= 0.84;
    } else {
      shake = 0;
    }

    const ordered = players.slice().sort((a, b) => paintKey(a) - paintKey(b));

    if (phase === "fly") {
      for (const player of players) {
        if (player.body.speed > 2.6 || player.altitude > 8) {
          player.trailTick += 1;
          if (player.trailTick % 2 === 0) {
            const vis = geoPos(player);
            player.trail.push({ x: vis.x, y: vis.y, angle: player.body.angle, life: 1 });
          }
        }
        player.trail.forEach((item) => {
          item.life -= 0.07;
        });
        player.trail = player.trail.filter((item) => item.life > 0).slice(-6);
      }
    }

    for (const player of players) {
      for (const ghost of player.trail) {
        ctx.save();
        ctx.translate(ghost.x, ghost.y);
        ctx.rotate(ghost.angle);
        ctx.globalAlpha = ghost.life * 0.18;
        drawWeapon(ctx, player.weapon);
        ctx.restore();
      }
    }

    for (const player of ordered) {
      drawShadow(player);
      drawSword(player);
    }
    if (forgeOpen) drawColliders();

    if (drag && controlMode === "charge") drag.power = chargePower(drag);
    if (drag) drawSling(drag);
    else if (cpuPlan) drawCpuAim();
    if (fingerFlash) {
      if (performance.now() > fingerFlash.until) fingerFlash = null;
      else drawHand(fingerFlash.sprite, fingerFlash.pose, 1, fingerFlash.facing);
    }
    for (const player of players) drawTag(player, now);

    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const bit = particles[i];
      bit.vy += 0.02;
      bit.x += bit.vx;
      bit.y += bit.vy;
      bit.life -= 0.025;
      if (bit.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.translate(bit.x, bit.y);
      ctx.rotate(bit.life * bit.spin);
      ctx.globalAlpha = Math.max(0, bit.life);
      ctx.fillStyle = bit.color;
      ctx.fillRect(-bit.size / 2, -bit.size / 2, bit.size, bit.size * 0.62);
      ctx.restore();
    }

    for (let i = rings.length - 1; i >= 0; i -= 1) {
      const ring = rings[i];
      ring.r += 1.3;
      ring.life -= 0.07;
      if (ring.life <= 0) {
        rings.splice(i, 1);
        continue;
      }
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255, 236, 190," + ring.life + ")";
      ctx.lineWidth = 2;
      ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function liftShift(lift) {
    const z = lift || 0;
    return { x: -z * 0.28, y: -z * 0.62 };
  }

  function paintKey(player) {
    let above = 0;
    let node = player;
    const seen = new Set();
    while (node && node.landedOn && !seen.has(node) && above < 4) {
      seen.add(node);
      above += 1;
      node = node.landedOn;
    }
    const front = player.body.position.y * 0.55 + player.body.position.x * 0.2;
    const other = player === p1 ? p2 : p1;
    const arrived = player === lastMover && other && other.body && swordsCover(player, other) ? 1200 : 0;
    return above * 4000 + player.altitude * 48 + arrived + front;
  }

  function visualPos(player) {
    const shift = liftShift(player.altitude);
    return {
      x: player.body.position.x + shift.x,
      y: player.body.position.y + shift.y,
    };
  }

  function geoPos(player) {
    const vis = visualPos(player);
    const com = player.weapon && player.weapon.com ? player.weapon.com : { x: 0, y: 0 };
    const angle = player.body.angle;
    const rx = com.x * Math.cos(angle) - com.y * Math.sin(angle);
    const ry = com.x * Math.sin(angle) + com.y * Math.cos(angle);
    return { x: vis.x - rx, y: vis.y - ry };
  }

  function drawShadow(player) {
    const lift = player.altitude || 0;
    const vis = geoPos(player);
    const ox = 3 + Math.min(3, lift * 0.04);
    const oy = 4 + Math.min(4, lift * 0.05);
    const alpha = Math.max(0.08, 0.24 - lift / 320);
    const blur = (1.2 + Math.min(1.2, lift * 0.03)).toFixed(1);
    ctx.save();
    ctx.translate(vis.x + ox, vis.y + oy);
    ctx.rotate(player.body.angle);
    ctx.globalAlpha = alpha;
    ctx.filter = "brightness(0) blur(" + blur + "px)";
    drawWeapon(ctx, player.weapon);
    ctx.restore();
  }

  function drawColliders() {
    ctx.save();
    ctx.lineWidth = 2;
    for (const player of players) {
      if (!player.body) continue;
      const specs = player.weapon ? player.weapon.parts : [];
      const shift = liftShift(player.altitude);
      childParts(player.body).forEach((part, index) => {
        const spec = specs[index] || {};
        const thick = partThick(spec);
        ctx.strokeStyle = thick < 0.4 ? "rgba(240, 193, 74, 0.95)" : thick > 0.8 ? "rgba(200, 32, 40, 0.9)" : "rgba(29, 79, 191, 0.9)";
        ctx.beginPath();
        const verts = part.vertices;
        ctx.moveTo(verts[0].x + shift.x, verts[0].y + shift.y);
        for (let i = 1; i < verts.length; i += 1) ctx.lineTo(verts[i].x + shift.x, verts[i].y + shift.y);
        ctx.closePath();
        ctx.stroke();
      });
      const cx = player.body.position.x + shift.x;
      const cy = player.body.position.y + shift.y;
      ctx.strokeStyle = "rgba(255, 250, 240, 0.95)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.moveTo(cx - 8, cy);
      ctx.lineTo(cx + 8, cy);
      ctx.moveTo(cx, cy - 8);
      ctx.lineTo(cx, cy + 8);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSword(player) {
    const vis = geoPos(player);
    ctx.save();
    ctx.translate(vis.x, vis.y);
    ctx.rotate(player.body.angle);
    drawWeapon(ctx, player.weapon);
    ctx.restore();
  }

  function drawTag(player, now) {
    if (phase === "result" || !player.body) return;
    const mine = phase === "aim" && player === current && !drag;
    const label = mine ? (isCpu(player) ? "瞄緊" : controlMode === "charge" ? "蓄力" : "彈我") : player.name;
    const vis = geoPos(player);
    const y = vis.y - player.weapon.hitHalf.y - 6 + (mine && !reducedMotion ? Math.sin(now / 220) * 3 : 0);
    const x = clamp(vis.x + (player.id === "p1" ? -28 : 28), 46, VIEW_W - 46);
    ctx.save();
    ctx.font = '700 15px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
    const width = ctx.measureText(label).width + 16;
    pathRoundRect(ctx, x - width / 2, y - 22, width, 22, 5);
    ctx.fillStyle = player.color;
    ctx.fill();
    ctx.fillStyle = "#fffaf0";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x, y - 11);
    ctx.restore();
  }

  function drawSling(state) {
    const impulse = controlMode === "charge" ? chargeImpulse(state) : flickImpulse(state);
    const origin = controlMode === "charge" ? state.anchor : state.origin;
    const finger = state.pos;
    const pose = arrowPose(origin, impulse);
    ctx.save();
    ctx.strokeStyle = "rgba(90, 48, 18, 0.4)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(finger.x, finger.y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (controlMode !== "charge") {
      const pointer = flickPointerPose(state);
      drawHand(fingerPoint, pointer, 1, "forward");
    }

    if (impulse.speed > 0.8) {
      const ang = pose.rot;
      ctx.strokeStyle = "rgba(194, 32, 36, 0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(pose.x, pose.y);
      ctx.stroke();
      ctx.fillStyle = "#c22024";
      ctx.beginPath();
      ctx.moveTo(pose.x, pose.y);
      ctx.lineTo(pose.x - Math.cos(ang - 0.42) * 14, pose.y - Math.sin(ang - 0.42) * 14);
      ctx.lineTo(pose.x - Math.cos(ang + 0.42) * 14, pose.y - Math.sin(ang + 0.42) * 14);
      ctx.closePath();
      ctx.fill();

      let x = origin.x;
      let y = origin.y;
      let px = impulse.x;
      let py = impulse.y;
      const pop = launchPop(impulse.speed);
      let z = pop.altitude;
      let zv = pop.zVel;
      let airborne = pop.airborne;
      ctx.fillStyle = "rgba(240, 193, 74, 0.9)";
      for (let i = 0; i < 48; i += 1) {
        const damp = 1 - glideAir(Math.hypot(px, py), airborne);
        px *= damp;
        py *= damp;
        x += px;
        y += py;
        if (airborne) {
          zv -= tune.zGravity;
          z += zv;
          if (z <= 0) {
            z = 0;
            zv = 0;
            airborne = false;
          }
        }
        if (i % 3 === 2) {
          ctx.beginPath();
          ctx.arc(x, y, airborne ? 3.4 : 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
        if (x < RIM || x > VIEW_W - RIM || y < RIM || y > VIEW_H - RIM) break;
        if (!airborne && Math.hypot(px, py) < 0.45) break;
      }
    }
    ctx.restore();

    if (controlMode === "charge") {
      const hand = chargeHandPose(state);
      drawHand(fingerCharge, hand, 1, "tail");
      if (!state.touchCharge) {
        drawPowerBar(hand.x - hand.backX * 24 + hand.backY * 58, hand.y - hand.backY * 24 - hand.backX * 58, impulse.power || 0);
      }
    } else if (impulse.speed > 0.8) {
      const pointer = flickPointerPose(state);
      ctx.save();
      ctx.font = '700 16px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
      ctx.fillStyle = "#7a1020";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(
        "力度 " + Math.round((impulse.speed / tune.maxSpeed) * 100) + "%",
        pointer.x - pointer.backX * 16 + pointer.backY * 78,
        pointer.y - pointer.backY * 16 - pointer.backX * 78
      );
      ctx.restore();
    }
    if (state.touchCharge) drawTouchChargeCue(state, impulse);
  }

  function drawTouchChargeCue(state, impulse) {
    const anchor = state.anchor;
    const dirX = impulse.dirX || Math.cos(state.startAngle);
    const dirY = impulse.dirY || Math.sin(state.startAngle);
    const power = impulse.power || 0;
    ctx.save();
    ctx.translate(anchor.x, anchor.y);
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
    glow.addColorStop(0, "rgba(255, 252, 230, 1)");
    glow.addColorStop(0.28, "rgba(255, 214, 48, 0.95)");
    glow.addColorStop(1, "rgba(255, 180, 20, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#fffaf0";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#1a1008";
    ctx.stroke();
    ctx.restore();

    const len = 88 + power * 168;
    const x0 = anchor.x + dirX * 20;
    const y0 = anchor.y + dirY * 20;
    const x1 = anchor.x + dirX * len;
    const y1 = anchor.y + dirY * len;
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1a1008";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.strokeStyle = "#ffe14a";
    ctx.lineWidth = 5;
    ctx.stroke();
    const ang = Math.atan2(dirY, dirX);
    ctx.fillStyle = "#ffe14a";
    ctx.strokeStyle = "#1a1008";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - Math.cos(ang - 0.45) * 22, y1 - Math.sin(ang - 0.45) * 22);
    ctx.lineTo(x1 - Math.cos(ang + 0.45) * 22, y1 - Math.sin(ang + 0.45) * 22);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    drawPowerBar(x1 + dirX * 48, y1 + dirY * 28, power);
  }

  function onDown(event) {
    if (event.button !== 0) return;
    if (!intro.hidden || phase !== "aim" || drag) return;
    if (isCpuTurn()) {
      setStatus("電腦瞄緊，等佢射完。");
      return;
    }
    if (matchMode === "online") {
      if (!onlineReady || onlineWait) {
        setStatus(onlineReady ? "出手已送到，等結果。" : "等對手都準備好先開波。");
        return;
      }
      if (!current || current.id !== onlineSeat) {
        setStatus("等" + (current ? current.name : "對手") + "射。");
        return;
      }
    }
    const point = canvasPoint(event);
    const chargingTouch = touchChargeEvent(event);
    const pad = chargingTouch ? touchHitPad() : null;
    const own = hits(current, point, pad);
    const other = players.find((player) => player !== current && hits(player, point, pad));
    if (!own) {
      if (other) setStatus("未輪到" + other.name + "。而家係" + current.name + "射。");
      return;
    }
    event.preventDefault();
    unlockAudio();
    if (playPage && current.weapon && isLostWeapon(current, weaponKey(current.weapon))) {
      setStatus("呢把劍報廢咗，揀另一把先出手。");
      return;
    }
    const body = current.body;
    const now = performance.now();
    let anchor = { x: point.x, y: point.y };
    if (chargingTouch) {
      const snapped = nearestSkeletonPoint(current, point);
      if (snapped) anchor = snapped;
    }
    drag = {
      player: current,
      pointerId: event.pointerId,
      origin: { x: body.position.x, y: body.position.y },
      anchor,
      pos: controlMode === "charge" ? { x: point.x, y: point.y } : { x: body.position.x, y: body.position.y },
      startAngle: body.angle,
      grab: { x: anchor.x - body.position.x, y: anchor.y - body.position.y },
      samples: [{ x: point.x, y: point.y, t: now }],
      power: 0,
      touchCharge: chargingTouch,
    };
    if (event.pointerType === "touch") {
      try { canvas.setPointerCapture(event.pointerId); } catch (error) { /* already captured */ }
    }
    setSwordMask(current, false);
    Sleeping.set(body, false);
    canvas.classList.add("grabbing");
  }

  function onMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) {
      updateCursor(event);
      return;
    }
    event.preventDefault();
    const point = canvasPoint(event);
    const base = controlMode === "charge" ? drag.anchor : drag.origin;
    let dx = point.x - base.x;
    let dy = point.y - base.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist > tune.maxDrag) {
      dx *= tune.maxDrag / dist;
      dy *= tune.maxDrag / dist;
    }
    drag.pos = { x: base.x + dx, y: base.y + dy };
    drag.samples.push({ x: point.x, y: point.y, t: performance.now() });
    if (drag.samples.length > 14) drag.samples.shift();
    drag.power = controlMode === "charge" ? chargePower(drag) : Math.min(1, flickImpulse(drag).speed / tune.maxSpeed);
    canvas.style.cursor = controlMode === "flick" ? "none" : "grabbing";
  }

  function recentSwipe(samples) {
    if (!samples || samples.length < 2) return null;
    const last = samples[samples.length - 1];
    let first = samples[0];
    for (let i = samples.length - 1; i >= 0; i -= 1) {
      if (last.t - samples[i].t <= 90) first = samples[i];
      else break;
    }
    const dt = last.t - first.t;
    if (dt < 16) return null;
    const x = ((last.x - first.x) / dt) * STEP;
    const y = ((last.y - first.y) / dt) * STEP;
    const speed = Math.hypot(x, y);
    if (speed < 0.4) return null;
    return { x, y, speed };
  }

  function flickImpulse(state) {
    const dx = state.pos.x - state.origin.x;
    const dy = state.pos.y - state.origin.y;
    const dist = Math.hypot(dx, dy);
    let dirX = dist > 1 ? dx / dist : 1;
    let dirY = dist > 1 ? dy / dist : 0;
    const swipe = recentSwipe(state.samples);
    const swipeSpeed = swipe ? swipe.speed : 0;
    if (swipe && swipeSpeed > 3) {
      const align = dirX * (swipe.x / swipeSpeed) + dirY * (swipe.y / swipeSpeed);
      if (align < 0.35) {
        dirX = swipe.x / swipeSpeed;
        dirY = swipe.y / swipeSpeed;
      }
    }
    const speed = Math.min(tune.maxSpeed, Math.max(dist * tune.flickPower, swipeSpeed * 0.62));
    return { x: dirX * speed, y: dirY * speed, speed, dirX, dirY, dist };
  }

  function flickSpin(state, vx, vy) {
    const bladeX = Math.cos(state.startAngle);
    const bladeY = Math.sin(state.startAngle);
    const across = bladeX * vy - bladeY * vx;
    const torque = state.grab.x * vy - state.grab.y * vx;
    let spin = across * 0.004 + torque * 0.00012;
    if (Math.abs(spin) < 0.03) {
      const side = bladeX * state.grab.y - bladeY * state.grab.x;
      const sign = side === 0 ? (across === 0 ? 1 : Math.sign(across)) : Math.sign(side);
      spin = sign * (0.032 + Math.hypot(vx, vy) * 0.0024);
    }
    return clamp(spin, -tune.spinCap, tune.spinCap);
  }

  function chargePower(state) {
    const leg = Math.max(80, tune.chargeMs / Math.max(0.2, tune.chargeSpeed));
    const phase = ((performance.now() - state.samples[0].t) / leg) % 2;
    return phase <= 1 ? phase : 2 - phase;
  }

  function chargeImpulse(state) {
    const power = chargePower(state);
    const dx = state.pos.x - state.anchor.x;
    const dy = state.pos.y - state.anchor.y;
    const dist = Math.hypot(dx, dy);
    let dirX = Math.cos(state.startAngle);
    let dirY = Math.sin(state.startAngle);
    if (dist > 12) {
      dirX = -dx / dist;
      dirY = -dy / dist;
    }
    const speed = power * tune.maxSpeed;
    return { x: dirX * speed, y: dirY * speed, speed, dirX, dirY, dist, power };
  }

  function chargeSpin(state, vx, vy, power) {
    const bladeX = Math.cos(state.startAngle);
    const bladeY = Math.sin(state.startAngle);
    const across = bladeX * vy - bladeY * vx;
    const side = bladeX * state.grab.y - bladeY * state.grab.x;
    const sign = Math.abs(across) > 0.4 ? Math.sign(across) : side === 0 ? 1 : Math.sign(side);
    return clamp(sign * (0.028 + power * 0.13), -tune.spinCap, tune.spinCap);
  }

  function arrowPose(origin, impulse) {
    const len = 34 + impulse.speed * 4;
    const dirX = impulse.dirX || 1;
    const dirY = impulse.dirY || 0;
    return {
      x: origin.x + dirX * len,
      y: origin.y + dirY * len,
      rot: Math.atan2(dirY, dirX),
      backX: dirX,
      backY: dirY,
    };
  }

  function chargeHandPose(state) {
    const impulse = chargeImpulse(state);
    const dirX = impulse.dirX || 1;
    const dirY = impulse.dirY || 0;
    return {
      x: state.anchor.x,
      y: state.anchor.y,
      rot: Math.atan2(dirY, dirX),
      backX: dirX,
      backY: dirY,
    };
  }

  function handPose(state) {
    return chargeHandPose(state);
  }

  function flickPointerPose(state) {
    const dx = state.pos.x - state.origin.x;
    const dy = state.pos.y - state.origin.y;
    const rot = Math.hypot(dx, dy) > 1 ? Math.atan2(dy, dx) : state.startAngle;
    return { x: state.pos.x, y: state.pos.y, rot, backX: Math.cos(rot), backY: Math.sin(rot) };
  }

  function drawHand(sprite, pose, alpha, facing) {
    if (!sprite || !sprite.ready) return;
    const height = 132;
    const width = height * (sprite.width / sprite.height);
    ctx.save();
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.rot + (facing === "forward" ? 0 : Math.PI));
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, 0, -height, width, height);
    ctx.restore();
  }

  function drawPowerBar(x, y, power) {
    const width = 86;
    const height = 12;
    const left = clamp(x - width / 2, 10, VIEW_W - width - 10);
    const top = clamp(y - height / 2, 18, VIEW_H - height - 10);
    const filled = Math.max(0, Math.min(1, power));
    ctx.save();
    pathRoundRect(ctx, left, top, width, height, 6);
    ctx.fillStyle = "rgba(42, 22, 15, 0.72)";
    ctx.fill();
    if (filled > 0.01) {
      pathRoundRect(ctx, left + 2, top + 2, Math.max(4, (width - 4) * filled), height - 4, 4);
      ctx.fillStyle = filled > 0.85 ? "#e31c23" : filled > 0.45 ? "#e07a14" : "#f0c14a";
      ctx.fill();
    }
    ctx.font = '700 13px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
    ctx.fillStyle = "#fffaf0";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("蓄力 " + Math.round(filled * 100) + "%", left + width / 2, top - 2);
    ctx.restore();
  }

  function prepareFinger(src, fallback) {
    const sheet = document.createElement("canvas");
    const image = new Image();
    image.onload = () => {
      sheet.width = image.naturalWidth;
      sheet.height = image.naturalHeight;
      const pen = sheet.getContext("2d");
      pen.drawImage(image, 0, 0);
      const frame = pen.getImageData(0, 0, sheet.width, sheet.height);
      const px = frame.data;
      for (let i = 0; i < px.length; i += 4) {
        const max = Math.max(px[i], px[i + 1], px[i + 2]);
        if (max < 26) px[i + 3] = 0;
        else if (max < 55) px[i + 3] = Math.round(((max - 26) / 29) * px[i + 3]);
      }
      pen.putImageData(frame, 0, 0);
      sheet.ready = true;
    };
    image.onerror = () => {
      if (fallback && image.src.indexOf(fallback) === -1) image.src = fallback;
    };
    image.src = src;
    return sheet;
  }

  function aimHint() {
    return controlMode === "charge"
      ? "撳實把劍向後拉蓄力（期間唔會郁），放手就按力度向反方向彈出。"
      : "水平慢推係貼枱「撥」；撳實快手甩開係「彈」。";
  }

  function onUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    releaseDrag();
  }

  function releaseDrag() {
    const state = drag;
    drag = null;
    canvas.classList.remove("grabbing");
    canvas.style.cursor = "";
    const body = state.player.body;
    const impulse = controlMode === "charge" ? chargeImpulse(state) : flickImpulse(state);
    const vx = impulse.x;
    const vy = impulse.y;
    const speed = impulse.speed;
    if (controlMode === "charge") {
      fingerFlash = { pose: handPose(state), until: performance.now() + 420, sprite: fingerFlick, facing: "tail" };
    } else {
      fingerFlash = { pose: flickPointerPose(state), until: performance.now() + 420, sprite: fingerSnap, facing: "forward" };
    }
    if (speed < tune.minSpeed) {
      Body.setPosition(body, state.origin);
      Body.setAngle(body, state.startAngle);
      Body.setVelocity(body, { x: 0, y: 0 });
      Body.setAngularVelocity(body, 0);
      state.player.altitude = 0;
      state.player.zVel = 0;
      state.player.airborne = false;
      state.player.landedOn = null;
      state.player.slide = null;
      setSwordMask(state.player, true);
      setStatus(controlMode === "charge" ? "蓄力條而家太低，等佢升高少少再放手。" : "力度唔夠，未彈到。再滑快少少。");
      return;
    }
    Body.setPosition(body, state.origin);
    Body.setAngle(body, state.startAngle);
    const spin = controlMode === "charge" ? chargeSpin(state, vx, vy, impulse.power || 0) : flickSpin(state, vx, vy);
    const stroke = controlMode === "charge" ? "flick" : strokeKind(state);
    launchSword(state.player, vx, vy, spin, stroke, false, state.anchor);
  }

  function stepWorld(dt) {
    stepAltitude();
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 5) {
      for (let i = 0; i < SUBSTEPS; i += 1) Engine.update(engine, STEP / SUBSTEPS);
      acc -= STEP;
      steps += 1;
    }
    if (acc > STEP) acc = 0;
  }

  function strokeKind(state) {
    const dx = state.pos.x - state.origin.x;
    const dy = state.pos.y - state.origin.y;
    const swipe = recentSwipe(state.samples);
    const snap = !!(swipe && swipe.speed >= 9.5);
    const flat = Math.abs(dy) <= Math.abs(dx) * 0.62 + 22;
    if (snap && (!flat || swipe.speed >= 13)) return "flick";
    return "swipe";
  }

  function launchPacket(player, vx, vy, spin, stroke, anchor) {
    const body = player.body;
    const point = anchor || body.position;
    return {
      type: "launch",
      seat: player.id,
      x: onlineRound(body.position.x),
      y: onlineRound(body.position.y),
      a: onlineRound(body.angle),
      px: onlineRound(point.x),
      py: onlineRound(point.y),
      vx: onlineRound(vx),
      vy: onlineRound(vy),
      spin: onlineRound(spin),
      stroke: stroke || "flick",
      weapon: catalogIndex(player, player.weapon),
    };
  }

  function launchSword(player, vx, vy, spin, stroke, remote, anchor) {
    if (playPage && (!player.weapon || isLostWeapon(player, weaponKey(player.weapon)))) {
      setStatus("揀把未報廢嘅劍先出手。");
      return;
    }
    if (!remote && (onlineHost() || onlineGuest())) onlinePush(launchPacket(player, vx, vy, spin, stroke, anchor));
    if (onlineGuest() && !remote) {
      onlineWait = true;
      onlineWaitAt = performance.now();
    }
    const body = player.body;
    const speed = Math.hypot(vx, vy);
    for (const other of players) {
      if (other.landedOn === player) {
        other.landedOn = null;
        other.slide = null;
        other.altitude = 0;
        other.zVel = 0;
        other.airborne = false;
      }
    }
    lastMover = player;
    const pop = stroke === "swipe" ? { altitude: 0, zVel: 0, airborne: false } : flickPop(speed);
    setSwordMask(player, !pop.airborne);
    Body.setVelocity(body, { x: vx, y: vy });
    Body.setAngularVelocity(body, spin);
    Sleeping.set(body, false);
    player.stroke = stroke || "flick";
    player.altitude = pop.altitude;
    player.zVel = pop.zVel;
    player.airborne = pop.airborne;
    player.landedOn = null;
    player.slide = null;
    body.frictionAir = player.stroke === "swipe" ? tableDrag(0.04) : glideAir(speed, pop.airborne);
    phase = "fly";
    quietFrames = 0;
    stuckCover = 0;
    stableVerdict = null;
    stableCount = 0;
    cpuPlan = null;
    for (const other of players) other.markX = undefined;
    player.trail = [];
    playLaunch();
    if (playPage) player.lockedId = weaponKey(player.weapon);
    setStatus(player.stroke === "swipe" ? "撥：貼住枱面推過去。" : "彈：出手離地，撞到會翻。");
    syncHud();
  }

  function isCpu(player) {
    return matchMode === "cpu" && player === p2;
  }

  function isCpuTurn() {
    return isCpu(current) && phase === "aim" && intro.hidden;
  }

  function flickPop(speed) {
    const pop = launchPop(speed);
    const zVel = Math.max(pop.zVel, 1.35 + Math.min(speed, tune.maxSpeed) * 0.08);
    return { altitude: Math.min(5, zVel * 0.4), zVel, airborne: true };
  }

  function launchPop(speed) {
    if (speed < tune.skimSpeed) return { altitude: 0, zVel: 0, airborne: false };
    const zVel = Math.max(0, tune.hop + (speed - tune.skimSpeed) * tune.hopScale);
    if (zVel < 0.8) return { altitude: 0, zVel: 0, airborne: false };
    return { altitude: Math.min(4, zVel * 0.35), zVel, airborne: true };
  }

  function terrainFrictionScale() {
    return terrain.baseFriction / TERRAINS.wood.baseFriction;
  }

  function terrainBounceScale() {
    return terrain.groundRestitution / TERRAINS.wood.groundRestitution;
  }

  function tableDrag(extra) {
    return Math.min(0.28, (tune.tableAir + (extra || 0)) * terrainFrictionScale());
  }

  function glideAir(speed, airborne) {
    if (airborne) return tune.flightAir;
    const scale = terrainFrictionScale();
    if (speed >= tune.skimSpeed) return tune.skimAir * scale;
    return tune.tableAir * scale;
  }

  function airRange(speed) {
    const base = 1000 / 60;
    let delta = base;
    let internal = null;
    let pos = 0;
    const pop = launchPop(speed);
    let alt = pop.altitude;
    let zv = pop.zVel;
    let airborne = pop.airborne;
    const step = (air) => {
      const t = base / 3;
      const scale = t / delta;
      const damp = 1 - air * (t / base);
      const moved = internal == null ? speed * (delta / base) * scale * damp : internal * scale * damp;
      internal = moved;
      delta = t;
      pos += Math.abs(moved);
      return Math.abs(moved);
    };
    for (let frame = 0; frame < 240; frame += 1) {
      if (airborne) {
        zv -= tune.zGravity;
        alt += zv;
        if (alt <= 0) {
          alt = 0;
          zv = 0;
          airborne = false;
        }
      }
      let frameSpeed = speed;
      for (let i = 0; i < 3; i += 1) frameSpeed = step(glideAir(internal == null ? speed : Math.abs(internal), airborne));
      if (!airborne && frameSpeed < 0.15) break;
    }
    return pos;
  }

  function speedForRange(distance) {
    const max = tune.maxSpeed;
    if (airRange(max) < distance) return max;
    let low = Math.min(max, tune.minSpeed + 0.6);
    let high = max;
    for (let i = 0; i < 12; i += 1) {
      const mid = (low + high) / 2;
      if (airRange(mid) < distance) low = mid;
      else high = mid;
    }
    return high;
  }

  const AI_PROFILES = {
    normal: {
      id: "normal",
      side: 150,
      along: 80,
      alongBase: 24,
      rangeDiv: 0.82,
      spinFromSide: 0.0009,
      spinNoise: 0.05,
    },
    hard: {
      id: "hard",
      angles: [-0.04, 0, 0.04],
      spinCap: 0.012,
      stackBias: [0.92, 1.05, 1.16],
      slamBias: [1.15, 1.32, 1.5],
    },
  };

  function planCpuShot() {
    const profile = AI_PROFILES.normal;
    const from = p2.body.position;
    const foe = p1.body.position;
    const dx = foe.x - from.x;
    const dy = foe.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;
    const side = (Math.random() - 0.5) * profile.side;
    const along = profile.alongBase + (Math.random() - 0.5) * profile.along;
    const tx = foe.x - ny * side + nx * along;
    const ty = foe.y + nx * side + ny * along;
    const aimDx = tx - from.x;
    const aimDy = ty - from.y;
    const aimDist = Math.hypot(aimDx, aimDy) || 1;
    const speed = speedForRange(aimDist / profile.rangeDiv);
    const spin = clamp(side * profile.spinFromSide + (Math.random() - 0.5) * profile.spinNoise, -tune.spinCap, tune.spinCap);
    return {
      vx: (aimDx / aimDist) * speed,
      vy: (aimDy / aimDist) * speed,
      spin,
      dirX: aimDx / aimDist,
      dirY: aimDy / aimDist,
      speed,
    };
  }

  function hardTactic() {
    const mass = (p2.weapon && p2.weapon.mass) || 8;
    const heavy = mass >= 11;
    const slick = terrain.baseFriction < 0.9;
    if (heavy && !slick) return "slam";
    return "stack";
  }

  function tableKeep(player) {
    const half = player.weapon && player.weapon.hitHalf ? player.weapon.hitHalf.x : 80;
    return RIM + Math.min(48, Math.max(24, half * 0.22));
  }

  function rimRoom(pos, angle) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const inset = RIM + 36;
    let room = Infinity;
    if (dx > 0.001) room = Math.min(room, (VIEW_W - inset - pos.x) / dx);
    if (dx < -0.001) room = Math.min(room, (inset - pos.x) / dx);
    if (dy > 0.001) room = Math.min(room, (VIEW_H - inset - pos.y) / dy);
    if (dy < -0.001) room = Math.min(room, (inset - pos.y) / dy);
    return room;
  }

  function proxySword(player, vx, vy, spin) {
    const half = player.weapon && player.weapon.hitHalf ? player.weapon.hitHalf : { x: 90, y: 18 };
    const friction = Math.min(1.25, gripOf(player.weapon) * terrainFrictionScale());
    const body = Bodies.rectangle(player.body.position.x, player.body.position.y, Math.max(36, half.x * 2), Math.max(14, Math.min(36, half.y * 2)), {
      angle: player.body.angle,
      friction,
      frictionStatic: Math.min(2.4, friction * 1.15),
      restitution: Math.min(0.5, tune.restitution * terrainBounceScale()),
      frictionAir: tune.tableAir,
      collisionFilter: { category: SWORD_CAT, mask: WALL_CAT | SWORD_CAT },
      slop: 0.04,
    });
    Body.setMass(body, (player.weapon && player.weapon.mass) || 8);
    Body.setVelocity(body, { x: vx, y: vy });
    Body.setAngularVelocity(body, spin || 0);
    return body;
  }

  function predictShot(vx, vy, spin, stroke) {
    const ghost = Engine.create({ enableSleeping: false, positionIterations: 8, velocityIterations: 6 });
    ghost.gravity.x = 0;
    ghost.gravity.y = 0;
    ghost.gravity.scale = 0;
    const walls = statics.map((wall) => Bodies.rectangle(
      wall.position.x,
      wall.position.y,
      wall.bounds.max.x - wall.bounds.min.x,
      wall.bounds.max.y - wall.bounds.min.y,
      {
        isStatic: true,
        friction: wall.friction,
        frictionStatic: wall.frictionStatic,
        restitution: wall.restitution,
        collisionFilter: { category: WALL_CAT, mask: SWORD_CAT },
      }
    ));
    const mine = proxySword(p2, vx, vy, spin);
    const foe = proxySword(p1, 0, 0, 0);
    Composite.add(ghost.world, walls.concat([mine, foe]));
    const inset = tableKeep(p2);
    const speed = Math.hypot(vx, vy);
    const pop = stroke === "swipe" ? { altitude: 0, zVel: 0, airborne: false } : flickPop(speed);
    let alt = pop.altitude;
    let zv = pop.zVel;
    let airborne = pop.airborne;
    let minDist = Infinity;
    let escaped = false;
    let restDist = null;
    const foeStart = { x: foe.position.x, y: foe.position.y };
    let foeMoved = 0;
    try {
      for (let frame = 0; frame < 96; frame += 1) {
        if (airborne) {
          zv -= tune.zGravity;
          alt += zv;
          if (alt <= 0) {
            alt = 0;
            zv = 0;
            airborne = false;
          }
        }
        mine.frictionAir = glideAir(mine.speed, airborne);
        foe.frictionAir = glideAir(foe.speed, false);
        for (let step = 0; step < SUBSTEPS; step += 1) Engine.update(ghost, STEP / SUBSTEPS);
        const pos = mine.position;
        if (pos.x < inset || pos.x > VIEW_W - inset || pos.y < inset || pos.y > VIEW_H - inset) {
          escaped = true;
          break;
        }
        const dist = Math.hypot(pos.x - foe.position.x, pos.y - foe.position.y);
        if (dist < minDist) minDist = dist;
        if (mine.speed < 0.35 && frame > 8) {
          restDist = dist;
          break;
        }
      }
    } catch (error) {
      escaped = true;
    } finally {
      if (restDist == null && !escaped) restDist = Math.hypot(mine.position.x - foe.position.x, mine.position.y - foe.position.y);
      foeMoved = Math.hypot(foe.position.x - foeStart.x, foe.position.y - foeStart.y);
      Composite.clear(ghost.world, false);
    }
    return { escaped, minDist, restDist, foeMoved };
  }

  function scoreStack(result) {
    if (result.escaped || result.restDist == null) return -1e9;
    return (140 - result.restDist) * 4 + (result.minDist < 96 ? 90 : 0);
  }

  function scoreSlam(result) {
    if (result.escaped || result.restDist == null) return -1e9;
    return (result.minDist < 84 ? 260 : Math.max(0, 100 - result.minDist)) + result.foeMoved * 2 + Math.max(0, 150 - result.restDist);
  }

  function hardFloor(dist, tactic) {
    const reach = dist > 700 ? 12 : dist > 360 ? 9.5 : dist > 160 ? 7 : 4.8;
    return tactic === "slam" ? Math.min(tune.maxSpeed, reach + 3) : reach;
  }

  function hardSpeed(dist, bias, tactic) {
    const room = rimRoom(p2.body.position, Math.atan2(p1.body.position.y - p2.body.position.y, p1.body.position.x - p2.body.position.x));
    const aimed = speedForRange(Math.min(dist * bias, Math.max(dist * 0.8, room * 0.88)));
    return Math.max(hardFloor(dist, tactic), Math.min(tune.maxSpeed, aimed));
  }

  function safeCpuShot(angle, dist, tactic) {
    const room = rimRoom(p2.body.position, angle);
    const speed = hardSpeed(Math.min(dist, room * 0.9), tactic === "slam" ? 1.2 : 1, tactic);
    return {
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      spin: 0,
      dirX: Math.cos(angle),
      dirY: Math.sin(angle),
      speed,
      stroke: "flick",
      tactic: tactic || "stack",
    };
  }

  function planHardCpuShot() {
    const tactic = hardTactic();
    const profile = AI_PROFILES.hard;
    const from = p2.body.position;
    const foe = p1.body.position;
    const base = Math.atan2(foe.y - from.y, foe.x - from.x);
    const dist = Math.hypot(foe.x - from.x, foe.y - from.y) || 1;
    const biases = tactic === "slam" ? profile.slamBias : profile.stackBias;
    const speeds = biases.map((bias) => hardSpeed(dist, bias, tactic));
    let best = null;
    profile.angles.forEach((offset) => {
      const angle = base + offset;
      speeds.forEach((used) => {
        const vx = Math.cos(angle) * used;
        const vy = Math.sin(angle) * used;
        const spin = clamp(offset * 0.2, -profile.spinCap, profile.spinCap);
        const result = predictShot(vx, vy, spin, "flick");
        const score = (tactic === "slam" ? scoreSlam(result) : scoreStack(result)) + used * 4;
        if (!best || score > best.score) {
          best = {
            vx,
            vy,
            spin,
            dirX: Math.cos(angle),
            dirY: Math.sin(angle),
            speed: used,
            stroke: "flick",
            tactic,
            score,
          };
        }
      });
    });
    if (!best || best.score < 0) return safeCpuShot(base, dist, tactic);
    return best;
  }

  function thinkCpu() {
    if (aiLevel === "hard") return planHardCpuShot();
    return planCpuShot();
  }

  function beginCpuTurn() {
    if (!p2.body || phase !== "aim" || !intro.hidden) return;
    if (playPage && !ensurePlayWeapon(p2)) return;
    cpuPlan = thinkCpu();
    cpuPlan.launchAt = performance.now() + (reducedMotion ? 420 : 900);
    if (aiLevel === "hard") {
      setStatus(cpuPlan.tactic === "slam"
        ? "電腦喺" + terrain.name + "預判好，準備大力撞。"
        : "電腦喺" + terrain.name + "預判好，準備疊上你把劍。");
      return;
    }
    setStatus("電腦瞄緊你把劍。");
  }

  function fireCpuShot(now) {
    if (!cpuPlan || !isCpuTurn() || now < cpuPlan.launchAt) return;
    const shot = cpuPlan;
    cpuPlan = null;
    launchSword(p2, shot.vx, shot.vy, shot.spin, shot.stroke);
  }

  function cpuStatusLine() {
    if (aiLevel === "hard") return "打電腦 · 困難：會預判落點，再決定撞定疊。";
    return "打電腦 · 普通：出手有誤差，適合休閒。";
  }

  function setAiLevel(level) {
    aiLevel = level === "hard" ? "hard" : "normal";
    document.querySelectorAll("[data-ai]").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.ai === aiLevel ? "true" : "false");
    });
    paintPlayBrief();
    if (isCpuTurn()) {
      beginCpuTurn();
      return;
    }
    if (matchMode === "cpu" && (!started || !intro.hidden)) setStatus(cpuStatusLine());
  }

  function drawCpuAim() {
    const origin = p2.body.position;
    const len = 34 + cpuPlan.speed * 4;
    const tipX = origin.x + cpuPlan.dirX * len;
    const tipY = origin.y + cpuPlan.dirY * len;
    const ang = Math.atan2(cpuPlan.dirY, cpuPlan.dirX);
    ctx.save();
    ctx.strokeStyle = "rgba(29, 79, 191, 0.85)";
    ctx.fillStyle = "#1d4fbf";
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - Math.cos(ang - 0.42) * 14, tipY - Math.sin(ang - 0.42) * 14);
    ctx.lineTo(tipX - Math.cos(ang + 0.42) * 14, tipY - Math.sin(ang + 0.42) * 14);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function onlineHost() {
    return playPage && matchMode === "online" && onlineSeat === "p1" && !!onlineToken;
  }

  function onlineGuest() {
    return playPage && matchMode === "online" && onlineSeat === "p2" && !!onlineToken;
  }

  function catalogIndex(player, weapon) {
    if (!weapon) return -1;
    return weaponList(player).findIndex((item) => weaponKey(item) === weaponKey(weapon));
  }

  function onlineRound(value) {
    return Math.round(value * 100) / 100;
  }

  function onlineEndpoint(path) {
    return new URL(path.replace(/^\//, ""), window.location.href).toString();
  }

  function onlinePush(message) {
    if (!onlineToken || !roomCode) return;
    if (onlineBus) {
      if (onlineBus.open) onlineBus.send(message);
      else onlineOutbox.push(message);
      return;
    }
    fetch(onlineEndpoint("api/online/send"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: roomCode, token: onlineToken, message: message }),
    }).catch(() => {
      setStatus("線上房 " + roomCode + " 傳唔到訊。");
    });
  }

  function onlineSetup() {
    return {
      type: "setup",
      terrain: terrain.id,
      p1: p1.catalog.map((weapon) => weapon.id),
      p2: p2.catalog.map((weapon) => weapon.id),
    };
  }

  function applyOnlineLoadout(ids1, ids2) {
    const build = (ids) => ids.map((id) => {
      const template = templateByType(id);
      return template ? cloneWeapon(template) : null;
    }).filter(Boolean);
    const left = build(ids1 || []);
    const right = build(ids2 || []);
    if (!left.length || !right.length) return;
    p1.catalog = left;
    p2.catalog = right;
    renderArmory(p1);
    renderArmory(p2);
    arm(p1, p1.catalog[0]);
    arm(p2, p2.catalog[0]);
  }

  function templateByType(id) {
    for (const player of players) {
      const found = player.catalog.find((weapon) => weapon.id === id);
      if (found) return found;
    }
    return null;
  }

  function swordsFromIds(ids) {
    return (ids || []).map((id) => {
      const template = templateByType(id);
      return template ? cloneWeapon(template) : null;
    }).filter(Boolean);
  }

  function applySeatLoadout(player, ids) {
    const drawn = swordsFromIds(ids);
    if (!drawn.length) return;
    player.catalog = drawn;
    renderArmory(player);
    arm(player, drawn[0]);
  }

  function rememberDraft(seat, ids) {
    if ((seat !== "p1" && seat !== "p2") || !Array.isArray(ids)) return;
    const clean = ids.map((id) => String(id)).filter(Boolean).slice(0, 3);
    if (clean.length < 3) return;
    onlineDrafts[seat] = clean;
    if (onlineGuest() && seat !== onlineSeat) applySeatLoadout(seat === "p2" ? p2 : p1, clean);
    if (onlineHost()) beginOnlineFight();
  }

  function beginOnlineFight() {
    if (!onlineHost() || onlineReady || !onlineDrafts.p1 || !onlineDrafts.p2) return;
    const left = swordsFromIds(onlineDrafts.p1);
    const right = swordsFromIds(onlineDrafts.p2);
    if (left.length < 3 || right.length < 3) return;
    p1.catalog = left;
    p2.catalog = right;
    renderArmory(p1);
    renderArmory(p2);
    arm(p1, left[0]);
    arm(p2, right[0]);
    onlineReady = true;
    onlinePush(onlineSetup());
    setStatus("兩邊都準備好。輪到" + current.name + "。");
    onlinePublish(true);
  }

  function defeatedIndexes(player) {
    return weaponList(player).map((weapon, index) => (isLostWeapon(player, weaponKey(weapon)) ? index : -1)).filter((index) => index >= 0);
  }

  function onlineSnapshot() {
    const pack = (player) => {
      const body = player.body;
      if (!body) return null;
      return {
        x: onlineRound(body.position.x),
        y: onlineRound(body.position.y),
        a: onlineRound(body.angle),
        vx: onlineRound(body.velocity.x),
        vy: onlineRound(body.velocity.y),
        av: onlineRound(body.angularVelocity),
        z: onlineRound(player.altitude),
        zv: onlineRound(player.zVel),
        air: player.airborne ? 1 : 0,
        on: player.landedOn ? player.landedOn.id : "",
      };
    };
    const lockedIndex = (player) => weaponList(player).findIndex((weapon) => weaponKey(weapon) === player.lockedId);
    return {
      type: "state",
      phase: phase,
      current: current ? current.id : "p1",
      matchOver: matchOver,
      scores: { p1s: p1.score, p2s: p2.score, p1p: p1.points, p2p: p2.points },
      equipped: { p1: catalogIndex(p1, p1.weapon), p2: catalogIndex(p2, p2.weapon) },
      defeated: { p1: defeatedIndexes(p1), p2: defeatedIndexes(p2) },
      locked: { p1: lockedIndex(p1), p2: lockedIndex(p2) },
      bodies: { p1: pack(p1), p2: pack(p2) },
      status: statusEl.textContent,
      result: resultBox.hidden ? null : {
        title: document.getElementById("result-title").textContent,
        detail: document.getElementById("result-detail").textContent,
        again: againBtn.textContent,
      },
    };
  }

  function onlinePublish(force) {
    if (!onlineHost()) return;
    const message = onlineSnapshot();
    const text = JSON.stringify(message);
    if (!force && text === onlineLastSent) return;
    onlineLastSent = text;
    onlineLastPush = performance.now();
    onlinePush(message);
  }

  function applyOnlineBody(player, data) {
    if (!data || !player.body) return;
    Body.setPosition(player.body, { x: data.x, y: data.y });
    Body.setAngle(player.body, data.a);
    Body.setVelocity(player.body, { x: data.vx, y: data.vy });
    Body.setAngularVelocity(player.body, data.av);
    player.altitude = data.z || 0;
    player.zVel = data.zv || 0;
    player.airborne = !!data.air;
    player.landedOn = data.on === "p1" ? p1 : data.on === "p2" ? p2 : null;
    Sleeping.set(player.body, phase !== "fly");
  }

  function applyOnlineEquip(player, index) {
    const weapon = weaponList(player)[index];
    if (!weapon || (player.weapon && weaponKey(player.weapon) === weaponKey(weapon))) return;
    if (phase === "aim") arm(player, weapon);
    else player.weapon = weapon;
  }

  function applyOnlineDefeated(player, indexes) {
    const list = weaponList(player);
    player.defeated = new Set((indexes || []).map((index) => list[index]).filter(Boolean).map(weaponKey));
  }

  function applyOnlineState(message) {
    phase = message.phase || "aim";
    current = message.current === "p2" ? p2 : p1;
    p1.score = message.scores.p1s;
    p2.score = message.scores.p2s;
    p1.points = message.scores.p1p;
    p2.points = message.scores.p2p;
    matchOver = !!message.matchOver;
    applyOnlineEquip(p1, message.equipped.p1);
    applyOnlineEquip(p2, message.equipped.p2);
    applyOnlineDefeated(p1, message.defeated.p1);
    applyOnlineDefeated(p2, message.defeated.p2);
    p1.lockedId = message.locked.p1 >= 0 ? weaponKey(weaponList(p1)[message.locked.p1]) : null;
    p2.lockedId = message.locked.p2 >= 0 ? weaponKey(weaponList(p2)[message.locked.p2]) : null;
    applyOnlineBody(p1, message.bodies.p1);
    applyOnlineBody(p2, message.bodies.p2);
    if (message.result) {
      if (resultBox.hidden) {
        document.getElementById("result-title").textContent = message.result.title;
        document.getElementById("result-detail").textContent = message.result.detail;
        againBtn.textContent = message.result.again;
        resultBox.hidden = false;
        paintResultActions(matchOver);
      }
    } else if (!resultBox.hidden) {
      resultBox.hidden = true;
    }
    if (message.status) setStatus(message.status);
    onlineWait = false;
    syncHud();
  }

  function applyRemoteLaunch(message) {
    const player = message.seat === "p1" ? p1 : message.seat === "p2" ? p2 : onlineHost() ? p2 : p1;
    if (!onlineToken || player.id === onlineSeat || phase !== "aim") return;
    const weapon = weaponList(player)[message.weapon];
    if (weapon && (!player.weapon || weaponKey(weapon) !== weaponKey(player.weapon))) arm(player, weapon);
    if (player.body && message.x != null) {
      Body.setPosition(player.body, { x: message.x, y: message.y });
      Body.setAngle(player.body, message.a || 0);
      Body.setVelocity(player.body, { x: 0, y: 0 });
      Body.setAngularVelocity(player.body, 0);
    }
    launchSword(player, message.vx || 0, message.vy || 0, message.spin || 0, message.stroke || "flick", true);
  }

  function onlineInbox(message) {
    if (!message || !message.type) return;
    if (message.type === "hello") {
      if (onlineHost()) beginOnlineFight();
      return;
    }
    if (message.type === "draft") {
      rememberDraft(message.seat, message.ids);
      return;
    }
    if (message.type === "setup" && onlineSeat === "p2") {
      if (message.terrain) applyTerrain(message.terrain);
      applyOnlineLoadout(message.p1, message.p2);
      onlineReady = true;
      setStatus("已連上房 " + roomCode + "。你係玩家二，等玩家一出手。");
      return;
    }
    if (message.type === "state" && onlineGuest()) {
      applyOnlineState(message);
      return;
    }
    if (message.type === "launch") {
      applyRemoteLaunch(message);
      return;
    }
    if (!onlineHost()) return;
    if (message.type === "select") {
      const weapon = weaponList(p2)[message.index];
      if (weapon) selectWeapon(p2, weapon, true);
      return;
    }
    if (message.type === "next" && phase === "result") {
      nextRound();
      return;
    }
    if (message.type === "reset" && current === p2 && phase === "aim") resetSword(p2, true);
  }

  function onlinePoll() {
    if (!onlineToken || onlineBus) return;
    fetch(onlineEndpoint("api/online/poll?room=" + encodeURIComponent(roomCode) + "&token=" + encodeURIComponent(onlineToken) + "&after=" + onlineAfter))
      .then((res) => {
        if (!res.ok) throw new Error("poll");
        return res.json();
      })
      .then((data) => {
        (data.messages || []).forEach((entry) => {
          onlineAfter = Math.max(onlineAfter, entry.n || 0);
          onlineInbox(entry.body);
        });
        if (data.peer) onlineSawPeer = true;
      })
      .catch(() => {
        setStatus("連唔上線上房 " + roomCode + "。請用遊戲伺服器再開頁。");
      })
      .finally(() => {
        window.setTimeout(onlinePoll, 180);
      });
  }

  function probeLocalRoom() {
    const attempt = fetch(onlineEndpoint("api/online/join"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: roomCode, seat: "no" }),
    }).then((res) => (res.headers.get("content-type") || "").toLowerCase().indexOf("json") >= 0).catch(() => false);
    const timeout = new Promise((resolve) => window.setTimeout(() => resolve(false), 2000));
    return Promise.race([attempt, timeout]);
  }

  function onlinePeerId(seat) {
    return "jj" + roomCode.toLowerCase() + seat;
  }

  function releasePeerConn(conn) {
    const peer = onlinePeer;
    if (!peer || !conn || !peer._connections || !conn.peer) return;
    const list = peer._connections.get(conn.peer);
    if (!list) return;
    const next = list.filter((item) => item !== conn);
    if (next.length) peer._connections.set(conn.peer, next);
    else peer._connections.delete(conn.peer);
  }

  const onlineStunServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  // 公開 TURN。要再加免費中繼，在這個陣列追加 { urls, username, credential }。
  const onlineTurnServers = [
    {
      urls: [
        "turn:eu-0.turn.peerjs.com:3478",
        "turn:us-0.turn.peerjs.com:3478",
      ],
      username: "peerjs",
      credential: "peerjsp",
    },
  ];

  function onlinePeerOptions() {
    return {
      config: {
        iceServers: onlineStunServers.concat(onlineTurnServers),
        sdpSemantics: "unified-plan",
      },
    };
  }

  function peerErrorText(err) {
    const kind = err && (err.type || err.name) ? String(err.type || err.name) : "unknown";
    let detail = err && err.message ? String(err.message) : "";
    if (detail === kind) detail = "";
    if (detail.indexOf(kind) === 0) detail = detail.slice(kind.length).trim();
    if (detail.length > 72) detail = detail.slice(0, 72);
    return detail ? kind + " " + detail : kind;
  }

  function loadPeerLibrary() {
    if (window.Peer) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "./lib/peerjs.min.js";
      script.onload = () => {
        if (window.Peer) resolve();
        else reject(new Error("load ./lib/peerjs.min.js"));
      };
      script.onerror = () => reject(new Error("load ./lib/peerjs.min.js"));
      document.head.appendChild(script);
    });
  }

  function bindOnlineBus(conn) {
    onlineBus = conn;
    conn.on("data", (data) => {
      if (data && typeof data === "object" && data.type) onlineInbox(data);
    });
    conn.on("open", () => {
      window.clearTimeout(onlineGuestTimer);
      onlineGuestTimer = 0;
      onlineGuestAttempt = 0;
      onlineGuestFault = "";
      onlineToken = onlinePeer && onlinePeer.id ? onlinePeer.id : onlinePeerId(onlineSeat);
      try {
        sessionStorage.setItem("sword-room-" + roomCode + "-" + onlineSeat, onlineToken);
      } catch (error) {}
      onlineOutbox.splice(0).forEach((message) => {
        try { conn.send(message); } catch (error) {}
      });
      if (onlineDrafts[onlineSeat]) onlinePush({ type: "draft", seat: onlineSeat, ids: onlineDrafts[onlineSeat] });
      onlinePush({ type: "hello", seat: onlineSeat });
      setStatus(onlineWeapon === "random" ? "已隨機派三種劍。等對手都準備好先開波。" : "你抽咗三包。等對手都準備好先開波。");
      if (onlineSeat === "p1") beginOnlineFight();
    });
    conn.on("error", (err) => {
      if (onlineGuestConn !== conn && onlineBus !== conn) return;
      setStatus("PeerJS：" + peerErrorText(err));
    });
    conn.on("close", () => {
      if (onlineBus === conn) onlineBus = null;
      if (onlineReady) setStatus("同對手斷咗線。請兩邊再入房。");
    });
  }

  function reviveOnlinePeer(peer, delay) {
    if (onlinePeer !== peer || onlinePeerAttempt >= 24 || onlinePeerTimer) return;
    onlinePeerAttempt += 1;
    onlinePeerTimer = window.setTimeout(() => {
      onlinePeerTimer = 0;
      if (onlinePeer !== peer) return;
      if (peer.destroyed) {
        if (!onlineToken) openOnlinePeer();
        return;
      }
      if (peer.disconnected) {
        try { peer.reconnect(); } catch (error) { openOnlinePeer(); }
      }
    }, delay);
  }

  function guestRetryDelay(err) {
    const kind = err && err.type;
    if (kind === "peer-unavailable" || kind === "connection-closed") return 1200;
    return 1800;
  }

  function scheduleGuestConnect(delay) {
    if (onlineToken || onlineSeat !== "p2") return;
    window.clearTimeout(onlineGuestTimer);
    onlineGuestTimer = window.setTimeout(() => {
      onlineGuestTimer = 0;
      connectGuest();
    }, delay);
  }

  function connectGuest() {
    const peer = onlinePeer;
    if (onlineToken || onlineSeat !== "p2") return;
    if (!peer || peer.destroyed) {
      if (!onlinePeerTimer) openOnlinePeer();
      return;
    }
    if (!peer.open) {
      scheduleGuestConnect(700);
      return;
    }
    window.clearTimeout(onlineGuestTimer);
    onlineGuestTimer = 0;
    const epoch = ++onlineGuestEpoch;
    onlineGuestAttempt += 1;
    const hostId = onlinePeerId("p1");
    setStatus("等房主 " + hostId + "。PeerJS：" + (onlineGuestFault || "peer-unavailable") + "。第 " + onlineGuestAttempt + " 次。");
    const conn = peer.connect(hostId, { reliable: true });
    if (!conn) {
      scheduleGuestConnect(1200);
      return;
    }
    onlineGuestConn = conn;
    let iceState = "";
    const current = () => epoch === onlineGuestEpoch && !onlineToken;
    const giveUp = (err, delay) => {
      if (!current()) return false;
      onlineGuestEpoch += 1;
      onlineGuestGiveUp = null;
      if (err) {
        onlineGuestFault = peerErrorText(err);
        setStatus("等房主 " + onlinePeerId("p1") + "。PeerJS：" + onlineGuestFault + "。第 " + onlineGuestAttempt + " 次。");
      }
      if (onlineGuestConn === conn) onlineGuestConn = null;
      if (onlineBus === conn) onlineBus = null;
      releasePeerConn(conn);
      try { conn.close(); } catch (error) {}
      scheduleGuestConnect(delay);
      return true;
    };
    onlineGuestGiveUp = giveUp;
    conn.on("error", (err) => giveUp(err, guestRetryDelay(err)));
    conn.on("iceStateChanged", (state) => {
      iceState = state;
      if (!current()) return;
      if (state === "failed") giveUp({ type: "webrtc", message: "ice-failed" }, 1600);
      else if (state === "checking" || state === "connected" || state === "completed") setStatus("PeerJS：ice " + state);
    });
    conn.on("close", () => {
      if (current()) giveUp({ type: "connection-closed" }, 1400);
    });
    window.setTimeout(() => {
      if (!current() || conn.open) return;
      if (iceState === "checking" || iceState === "connected" || iceState === "completed") return;
      giveUp({ type: "peer-unavailable", message: "no-answer " + onlinePeerId("p1") }, 400);
    }, 6000);
    window.setTimeout(() => {
      if (current() && !conn.open) giveUp({ type: "webrtc", message: "timeout" }, 900);
    }, 45000);
    bindOnlineBus(conn);
  }

  function openOnlinePeer() {
    if (onlineToken) return;
    const previous = onlinePeer;
    onlinePeer = null;
    onlineGuestGiveUp = null;
    if (previous && !previous.destroyed) {
      try { previous.destroy(); } catch (error) {}
    }
    const options = onlinePeerOptions();
    const peer = onlineSeat === "p1" ? new window.Peer(onlinePeerId("p1"), options) : new window.Peer(options);
    onlinePeer = peer;
    if (!onlinePeerHideBound) {
      onlinePeerHideBound = true;
      window.addEventListener("pagehide", () => {
        try { if (onlinePeer) onlinePeer.destroy(); } catch (error) {}
      });
    }
    peer.on("error", (err) => {
      if (onlinePeer !== peer) return;
      const kind = err && err.type;
      const text = peerErrorText(err);
      if (kind === "peer-unavailable") {
        onlineGuestFault = text;
        if (!(onlineGuestGiveUp && onlineGuestGiveUp(err, guestRetryDelay(err)))) scheduleGuestConnect(guestRetryDelay(err));
        return;
      }
      if (kind === "unavailable-id") {
        peer._swordFault = "unavailable-id";
        setStatus(onlineSeat === "p1"
          ? "PeerJS：unavailable-id。房主號 " + onlinePeerId("p1") + " 仍被佔用，稍後再掛。"
          : "PeerJS：unavailable-id");
        reviveOnlinePeer(peer, 3000);
        return;
      }
      peer._swordFault = text;
      setStatus("PeerJS：" + text);
      if (onlineToken) return;
      if (kind === "browser-incompatible" || kind === "invalid-id" || kind === "invalid-key" || kind === "ssl-unavailable") return;
      const wait = Math.min(1500 + onlinePeerAttempt * 700, 8000);
      reviveOnlinePeer(peer, wait);
    });
    peer.on("disconnected", () => {
      if (onlinePeer !== peer) return;
      if (!peer._swordFault) setStatus(onlineReady ? "PeerJS：disconnected。正在重連信令。" : "PeerJS：disconnected");
      reviveOnlinePeer(peer, 800);
    });
    peer.on("open", () => {
      if (onlinePeer !== peer) return;
      peer._swordFault = "";
      onlinePeerAttempt = 0;
      if (onlineSeat === "p1") {
        if (!peer._swordListening) {
          peer._swordListening = true;
          peer.on("connection", bindOnlineBus);
        }
        setStatus("房已開好。已連上 peerjs（" + peer.id + "）。等對手。");
        return;
      }
      setStatus("已連上 peerjs。正在搵房主 " + onlinePeerId("p1") + "。");
      connectGuest();
    });
  }

  function onlineBeginPeer() {
    setStatus("呢頁冇房間伺服器，改為瀏覽器直連。等對手。");
    loadPeerLibrary().then(() => {
      openOnlinePeer();
    }).catch((err) => {
      setStatus("PeerJS：" + (err && err.message ? err.message : "load ./lib/peerjs.min.js"));
    });
  }

  function onlineBeginHttp() {
    let saved = "";
    try {
      saved = sessionStorage.getItem("sword-room-" + roomCode + "-" + onlineSeat) || "";
    } catch (error) {}
    fetch(onlineEndpoint("api/online/join"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: roomCode, seat: onlineSeat, token: saved }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data: data })))
      .then((result) => {
        if (!result.ok) {
          setStatus(result.data && result.data.error === "taken" ? "呢個房號已經有人。請開新房。" : "入唔到房 " + roomCode + "。");
          return;
        }
        onlineToken = result.data.token;
        sessionStorage.setItem("sword-room-" + roomCode + "-" + onlineSeat, onlineToken);
        if (onlineDrafts[onlineSeat]) onlinePush({ type: "draft", seat: onlineSeat, ids: onlineDrafts[onlineSeat] });
        setStatus(onlineWeapon === "random" ? "已隨機派三種劍。等對手都準備好先開波。" : "你抽咗三包。等對手都準備好先開波。");
        onlinePush({ type: "hello", seat: onlineSeat });
        onlinePoll();
      })
      .catch(() => {
        onlineBeginPeer();
      });
  }

  function onlineBegin() {
    onlineReady = false;
    setStatus(onlineWeapon === "random" ? "已隨機派三種劍。正在入房。" : "你抽咗三包。正在入房。");
    let useHttp = false;
    probeLocalRoom().then((ok) => {
      if (!ok) return;
      useHttp = true;
      window.clearTimeout(onlineGuestTimer);
      window.clearTimeout(onlinePeerTimer);
      onlineGuestTimer = 0;
      onlinePeerTimer = 0;
      onlineGuestGiveUp = null;
      const peer = onlinePeer;
      onlinePeer = null;
      if (peer && !peer.destroyed) {
        try { peer.destroy(); } catch (error) {}
      }
      onlineBeginHttp();
    });
    loadPeerLibrary().then(() => {
      if (useHttp || onlineToken) return;
      if (!onlinePeer || onlinePeer.destroyed) openOnlinePeer();
    }).catch((err) => {
      if (!useHttp) setStatus("PeerJS：" + (err && err.message ? err.message : "load ./lib/peerjs.min.js"));
    });
  }

  function applyMatchMode(mode) {
    if (drag) {
      setStatus("放手先再轉對戰模式。");
      return;
    }
    matchMode = mode;
    cpuPlan = null;
    p2.name = mode === "cpu" ? "電腦" : "玩家二";
    const title = document.getElementById("title-p2");
    if (title) title.textContent = p2.name;
    const duoBtn = document.getElementById("match-duo");
    const cpuBtn = document.getElementById("match-cpu");
    if (duoBtn) duoBtn.setAttribute("aria-pressed", mode === "duo" ? "true" : "false");
    if (cpuBtn) cpuBtn.setAttribute("aria-pressed", mode === "cpu" ? "true" : "false");
    paintPlayBrief();
    syncHud();
    if (!started || !intro.hidden) {
      if (mode === "cpu") setStatus(cpuStatusLine());
      else if (mode === "online") setStatus("線上房 " + (roomCode || "----") + "。等對手入房。");
      else setStatus("雙人對戰：兩個人輪流射。");
      return;
    }
    if (phase === "aim" && isCpu(current)) beginCpuTurn();
    else if (phase === "aim") setStatus("輪到" + current.name + "。" + aimHint());
  }

  function updateCursor(event) {
    if (phase !== "aim" || !intro.hidden || drag) return;
    const rect = canvas.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!inside) return;
    canvas.style.cursor = isCpuTurn() ? "default" : hits(current, canvasPoint(event)) ? "grab" : "crosshair";
  }

  function claimSettledCover() {
    const upper = lastMover && lastMover.body ? lastMover : current;
    if (!upper || !upper.body || !p1.body || !p2.body) return;
    const lower = upper === p1 ? p2 : p1;
    if (!lower || !lower.body || upper === lower) return;
    if (upper.altitude > tune.stackH * 2 || lower.altitude > tune.stackH * 2) return;
    if (!swordsCover(upper, lower)) return;
    upper.landedOn = lower;
    upper.altitude = lower.altitude + contactLift(upper, lower);
    upper.zVel = 0;
    upper.airborne = false;
    upper.markZ = upper.altitude;
    trackSlide(upper, lower, solidOverlap(upper.body, lower.body));
    setSwordMask(upper, false);
    setSwordMask(lower, false);
  }

  function dampStuckCover() {
    if (!p1.body || !p2.body || !swordsCover(p1, p2)) {
      stuckCover = 0;
      return;
    }
    const busy = Math.max(p1.body.speed, p2.body.speed);
    const spin = Math.max(Math.abs(p1.body.angularVelocity), Math.abs(p2.body.angularVelocity));
    if (busy > 2.6 || spin > 0.12) {
      stuckCover = 0;
      return;
    }
    stuckCover += 1;
    if (stuckCover < 8) return;
    for (const player of players) {
      Body.setVelocity(player.body, { x: 0, y: 0 });
      Body.setAngularVelocity(player.body, 0);
      player.zVel = 0;
      player.airborne = false;
      if (player.altitude > tune.stackH * 2) player.altitude = tune.stackH;
      setSwordMask(player, false);
      player.markX = player.body.position.x;
      player.markY = player.body.position.y;
      player.markA = player.body.angle;
      player.markZ = player.altitude;
    }
    if (!p1.landedOn && !p2.landedOn) claimSettledCover();
  }

  function noteMotion() {
    if (phase !== "fly") return;
    dampStuckCover();
    let moving = false;
    for (const player of players) {
      const body = player.body;
      if (player.markX === undefined) {
        player.markX = body.position.x;
        player.markY = body.position.y;
        player.markA = body.angle;
        moving = true;
        continue;
      }
      const dx = body.position.x - player.markX;
      const dy = body.position.y - player.markY;
      const da = Math.atan2(Math.sin(body.angle - player.markA), Math.cos(body.angle - player.markA));
      const dz = player.altitude - (player.markZ || 0);
      if (Math.hypot(dx, dy) > 0.7 || Math.abs(da) > 0.025 || Math.abs(dz) > 0.35 || Math.abs(player.zVel) > 0.25) {
        moving = true;
      }
      player.markX = body.position.x;
      player.markY = body.position.y;
      player.markA = body.angle;
      player.markZ = player.altitude;
    }
    if (moving) {
      quietFrames = 0;
      stableVerdict = null;
      stableCount = 0;
      return;
    }
    quietFrames += 1;
    if (quietFrames < tune.quietNeed) return;
    if (!p1.landedOn && !p2.landedOn) claimSettledCover();
    const verdict = evaluate();
    if (verdict && verdict !== "tie") {
      if (stableVerdict === verdict) stableCount += 1;
      else {
        stableVerdict = verdict;
        stableCount = 1;
      }
      if (stableCount >= tune.stableNeed) winRound(verdict);
      return;
    }
    stableVerdict = null;
    stableCount = 0;
    if (quietFrames < tune.turnNeed) return;
    const next = current === p1 ? p2 : p1;
    setStatus(verdict === "tie" ? "兩把劍纏住，未分到勝負。換人再射。" : "未疊到。輪到" + next.name + "。");
    setTurn(next);
    if (onlineHost()) onlinePublish(true);
  }

  function noteIdleCover() {
    if (phase !== "aim" || drag) return;
    if (!p1.body || !p2.body) return;
    const spin = Math.max(Math.abs(p1.body.angularVelocity), Math.abs(p2.body.angularVelocity));
    if (p1.body.speed > 0.4 || p2.body.speed > 0.4 || spin > 0.05) return;
    if (!swordsCover(p1, p2)) return;
    if (!p1.landedOn && !p2.landedOn) claimSettledCover();
    const verdict = evaluate();
    if (verdict && verdict !== "tie") winRound(verdict);
  }

  function stepAltitude() {
    const order = players.slice().sort((a, b) => a.altitude - b.altitude);
    for (const player of order) {
      const other = player === p1 ? p2 : p1;
      if (drag && drag.player === player) {
        player.zVel = 0;
        player.altitude = 0;
        player.landedOn = null;
        player.slide = null;
        player.body.frictionAir = 0.2;
        continue;
      }
      player.zVel -= tune.zGravity;
      player.altitude += player.zVel;
      const overlap = other.body ? solidOverlap(player.body, other.body) : 0;
      const covering = overlap > coverNeed();
      const fallingOnto = player.airborne && covering && player.zVel <= 0 && player.altitude <= other.altitude + tune.stackH;
      const lift = contactLift(player, other);
      if (fallingOnto) {
        player.altitude = other.altitude + lift;
        player.zVel = 0;
        player.airborne = false;
        player.landedOn = other;
        trackSlide(player, other, overlap);
        setSwordMask(player, false);
        setSwordMask(other, false);
      } else if (player.landedOn && covering) {
        player.altitude = player.landedOn.altitude + contactLift(player, player.landedOn);
        player.zVel = 0;
        player.airborne = false;
        trackSlide(player, player.landedOn, overlap);
        setSwordMask(player, false);
        setSwordMask(player.landedOn, false);
      } else if (player.altitude <= 0) {
        if (player.landedOn && !covering) markSlip(player, player.landedOn, overlap);
        const impact = -player.zVel;
        player.altitude = 0;
        player.zVel = !covering && impact > 2.6 ? impact * 0.18 : 0;
        player.airborne = false;
        player.landedOn = null;
        player.slide = null;
        setSwordMask(player, !(covering && player.body.speed < 2.6));
      } else {
        if (player.landedOn && !covering) markSlip(player, player.landedOn, overlap);
        if (!covering) player.landedOn = null;
        setSwordMask(player, false);
      }
      const onTable = player.altitude <= 1 && Math.abs(player.zVel) < 0.35;
      const swipeDrag = tableDrag(0.04);
      player.body.frictionAir = player.landedOn
        ? tune.stackAir
        : player.stroke === "swipe" && onTable
          ? swipeDrag
          : glideAir(player.body.speed, !onTable);
      if (!onTable) Sleeping.set(player.body, false);
    }
  }

  function stackGrip(player, other, overlap) {
    const gap = Math.abs(Math.atan2(Math.sin(player.body.angle - other.body.angle), Math.cos(player.body.angle - other.body.angle)));
    const aligned = 1 - Math.min(1, gap / 1.15);
    const cover = Math.min(1, overlap / (tune.overlapMin * 2.4));
    return cover * (0.4 + 0.6 * aligned);
  }

  function trackSlide(player, other, overlap) {
    if (!player.slide || player.slide.lowerId !== other.id) {
      player.slide = { lowerId: other.id, dist: 0, peak: 0, rel: 0, overlap };
    }
    const relX = player.body.velocity.x - other.body.velocity.x;
    const relY = player.body.velocity.y - other.body.velocity.y;
    const rel = Math.hypot(relX, relY);
    const grip = stackGrip(player, other, overlap) * contactBite(player, other);
    const stick = tune.stackSlide > 0 && grip > 0.8 && rel < 0.18 + tune.swordStatic * 0.22;
    let keep = 1;
    if (stick) keep = 0;
    else if (tune.stackSlide > 0) {
      const damp = Math.min(0.12, Math.max(0.018, tune.stackSlide * (0.55 + grip)));
      keep = 1 - damp;
    }
    Body.setVelocity(player.body, {
      x: other.body.velocity.x + relX * keep,
      y: other.body.velocity.y + relY * keep,
    });
    const relAfter = rel * keep;
    player.slide.dist += relAfter;
    player.slide.peak = Math.max(player.slide.peak, rel);
    player.slide.rel = relAfter;
    player.slide.overlap = overlap;
  }

  function markSlip(player, other, overlap) {
    const slide = player.slide;
    lastSlip = {
      upper: player.name,
      lower: other ? other.name : "對手",
      dist: slide ? slide.dist : 0,
      peak: slide ? slide.peak : 0,
      overlap,
    };
    player.slide = null;
  }

  function applyMaterial() {
    const scale = terrainFrictionScale();
    const bounce = terrain.groundRestitution * (tune.wallBounce / TUNE_BASE.wallBounce);
    for (const wall of statics) {
      wall.friction = tune.wallFriction * scale;
      wall.frictionStatic = tune.wallFriction * scale;
      wall.restitution = bounce;
    }
    for (const player of players) {
      const body = player.body;
      if (!body) continue;
      paintBodyMaterials(player);
      body.frictionAir = player.landedOn ? tune.stackAir : glideAir(body.speed, player.altitude > 1);
    }
  }

  function bindDesk() {
    if (!document.getElementById("tune-table-air")) {
      applyMaterial();
      return;
    }
    const specs = [
      ["tune-table-air", "tableAir", 3],
      ["tune-flight-air", "flightAir", 3],
      ["tune-sword-friction", "swordFriction", 2],
      ["tune-sword-static", "swordStatic", 2],
      ["tune-wall-friction", "wallFriction", 2],
      ["tune-stack-air", "stackAir", 3],
      ["tune-stack-slide", "stackSlide", 3],
      ["tune-overlap", "overlapMin", 0],
      ["tune-stack-h", "stackH", 0],
      ["tune-max-drag", "maxDrag", 0],
      ["tune-flick-power", "flickPower", 2],
      ["tune-min-speed", "minSpeed", 1],
      ["tune-max-speed", "maxSpeed", 1],
      ["tune-charge-ms", "chargeMs", 0],
      ["tune-charge-speed", "chargeSpeed", 2],
      ["tune-spin-cap", "spinCap", 2],
      ["tune-z-gravity", "zGravity", 2],
      ["tune-restitution", "restitution", 2],
      ["tune-wall-bounce", "wallBounce", 2],
      ["tune-hop", "hop", 1],
      ["tune-hop-scale", "hopScale", 2],
      ["tune-quiet", "quietNeed", 0],
      ["tune-stable", "stableNeed", 0],
      ["tune-turn", "turnNeed", 0],
    ];
    const inputs = {};
    const paint = (id, key, digits) => {
      const input = inputs[key];
      tune[key] = Number(input.value);
      document.getElementById(id + "-val").textContent = digits ? tune[key].toFixed(digits) : String(Math.round(tune[key]));
    };
    for (const [id, key, digits] of specs) {
      const input = document.getElementById(id);
      inputs[key] = input;
      input.addEventListener("input", () => {
        paint(id, key, digits);
        applyMaterial();
      });
      paint(id, key, digits);
    }
    applyMaterial();
    const deskBody = document.getElementById("desk-body");
    const deskToggle = document.getElementById("desk-toggle");
    deskToggle.addEventListener("click", () => {
      const open = deskBody.hidden;
      deskBody.hidden = !open;
      deskToggle.textContent = open ? "收起" : "展開";
      deskToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.getElementById("desk-reset").addEventListener("click", () => {
      Object.assign(tune, TUNE_BASE);
      for (const [id, key, digits] of specs) {
        inputs[key].value = String(tune[key]);
        paint(id, key, digits);
      }
      applyMaterial();
    });
  }

  function updateDesk() {
    const deskBody = document.getElementById("desk-body");
    if (!deskBody || deskBody.hidden || !p1.body || !p2.body) return;
    const overlap = solidOverlap(p1.body, p2.body);
    const need = coverNeed();
    const rel = Math.hypot(p1.body.velocity.x - p2.body.velocity.x, p1.body.velocity.y - p2.body.velocity.y);
    const upper = p1.landedOn === p2 ? p1 : p2.landedOn === p1 ? p2 : null;
    document.getElementById("read-overlap").textContent = Math.round(overlap) + " / " + Math.round(need);
    document.getElementById("read-rel").textContent = rel.toFixed(2) + " px/帧";
    if (!upper) {
      document.getElementById("read-state").textContent = "未疊";
      document.getElementById("read-dist").textContent = "0 px";
      document.getElementById("read-margin").textContent = overlap > need ? "面積夠，但未疊穩" : "差 " + Math.round(need - overlap);
    } else {
      const slipping = rel > 0.45;
      document.getElementById("read-state").textContent = upper.name + "疊喺" + upper.landedOn.name + "上面" + (slipping ? "，滑緊" : "，穩陣");
      document.getElementById("read-dist").textContent = Math.round(upper.slide ? upper.slide.dist : 0) + " px";
      document.getElementById("read-margin").textContent = "仲剩 " + Math.round(overlap - need) + " 先滑落";
    }
    document.getElementById("read-p1").textContent = deskSwordLine(p1);
    document.getElementById("read-p2").textContent = deskSwordLine(p2);
    document.getElementById("read-slip").textContent = lastSlip
      ? lastSlip.upper + "由" + lastSlip.lower + "滑落 · 滑咗 " + Math.round(lastSlip.dist) + " px · 最快 " + lastSlip.peak.toFixed(2) + " · 重疊 " + Math.round(lastSlip.overlap)
      : "未滑過";
  }

  function deskSwordLine(player) {
    const where = player.landedOn ? "疊喺" + player.landedOn.name : player.altitude > 1 ? "飛緊" : "貼枱";
    return "速度 " + player.body.speed.toFixed(2) + " · 阻力 " + player.body.frictionAir.toFixed(3) + " · 摩擦 " + player.body.friction.toFixed(2) + " · 高 " + player.altitude.toFixed(1) + " · " + where;
  }

  function partThick(part) {
    return part && typeof part.thick === "number" ? part.thick : 0.7;
  }

  function contactLift(upper, lower) {
    if (!upper.body || !lower.body || !upper.weapon) return tune.stackH;
    const specs = upper.weapon.parts || [];
    let weight = 0;
    let thick = 0;
    for (const [index, up] of childParts(upper.body).entries()) {
      const spec = specs[index] || specs[0];
      for (const low of childParts(lower.body)) {
        const iw = Math.min(up.bounds.max.x, low.bounds.max.x) - Math.max(up.bounds.min.x, low.bounds.min.x);
        const ih = Math.min(up.bounds.max.y, low.bounds.max.y) - Math.max(up.bounds.min.y, low.bounds.min.y);
        if (iw <= 0 || ih <= 0) continue;
        const area = iw * ih;
        weight += area;
        thick += area * partThick(spec);
      }
    }
    const mean = weight ? thick / weight : 0.7;
    return tune.stackH * (0.42 + 0.75 * mean);
  }

  function contactBite(upper, lower) {
    if (!upper.weapon || !upper.body || !lower.body) return 1;
    const blade = zoneMaterial(upper.weapon, "blade").friction || 0.7;
    const specs = upper.weapon.parts || [];
    const ups = childParts(upper.body);
    let weight = 0;
    let sum = 0;
    for (let index = 0; index < ups.length; index += 1) {
      const up = ups[index];
      const friction = zoneMaterial(upper.weapon, zoneOf(specs[index] || {})).friction;
      for (const low of childParts(lower.body)) {
        const iw = Math.min(up.bounds.max.x, low.bounds.max.x) - Math.max(up.bounds.min.x, low.bounds.min.x);
        const ih = Math.min(up.bounds.max.y, low.bounds.max.y) - Math.max(up.bounds.min.y, low.bounds.min.y);
        if (iw <= 0 || ih <= 0) continue;
        const area = iw * ih;
        weight += area;
        sum += area * friction;
      }
    }
    if (!weight) return 1;
    return clamp(sum / weight / blade, 0.35, 1.85);
  }

  function coverNeed() {
    return tune.overlapMin * 0.045;
  }

  function clipQuad(subject, edgeA, edgeB) {
    const out = [];
    const ex = edgeB.x - edgeA.x;
    const ey = edgeB.y - edgeA.y;
    const inside = (point) => ex * (point.y - edgeA.y) - ey * (point.x - edgeA.x) >= -0.01;
    const hit = (from, to) => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const denom = ex * dy - ey * dx;
      if (Math.abs(denom) < 1e-6) return from;
      const t = (ex * (edgeA.y - from.y) - ey * (edgeA.x - from.x)) / denom;
      return { x: from.x + dx * t, y: from.y + dy * t };
    };
    for (let i = 0; i < subject.length; i += 1) {
      const current = subject[i];
      const previous = subject[(i + subject.length - 1) % subject.length];
      const nowIn = inside(current);
      const wasIn = inside(previous);
      if (nowIn) {
        if (!wasIn) out.push(hit(previous, current));
        out.push(current);
      } else if (wasIn) out.push(hit(previous, current));
    }
    return out;
  }

  function polygonArea(points) {
    let area = 0;
    for (let i = 0; i < points.length; i += 1) {
      const next = points[(i + 1) % points.length];
      area += points[i].x * next.y - next.x * points[i].y;
    }
    return Math.abs(area) * 0.5;
  }

  function solidOverlap(a, b) {
    let area = 0;
    for (const up of childParts(a)) {
      for (const low of childParts(b)) {
        if (up.bounds.max.x < low.bounds.min.x || low.bounds.max.x < up.bounds.min.x) continue;
        if (up.bounds.max.y < low.bounds.min.y || low.bounds.max.y < up.bounds.min.y) continue;
        let subject = up.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));
        const clip = low.vertices;
        let missed = false;
        for (let i = 0; i < clip.length; i += 1) {
          subject = clipQuad(subject, clip[i], clip[(i + 1) % clip.length]);
          if (subject.length < 3) {
            missed = true;
            break;
          }
        }
        if (!missed) area += polygonArea(subject);
      }
    }
    return area;
  }

  function swordsCover(upper, lower) {
    if (!upper.body || !lower.body) return false;
    return solidOverlap(upper.body, lower.body) > coverNeed();
  }

  function evaluate() {
    const aOnB = restsOn(p1, p2);
    const bOnA = restsOn(p2, p1);
    if (aOnB && bOnA) return "tie";
    if (aOnB) return p1;
    if (bOnA) return p2;
    return null;
  }

  function restsOn(upper, lower) {
    if (upper.landedOn !== lower) return false;
    if (Math.abs(upper.zVel) > 0.3) return false;
    if (!swordsCover(upper, lower)) return false;
    return upper.altitude + 1 >= contactLift(upper, lower);
  }

  function winRound(winner) {
    phase = "result";
    drag = null;
    const loser = winner === p1 ? p2 : p1;
    lastLoser = loser;
    const lostWeapon = loser.weapon;
    winner.points += 1;
    const tookGame = winner.points >= POINTS_TO_GAME;
    if (tookGame) {
      winner.score += 1;
      p1.points = 0;
      p2.points = 0;
    }
    matchOver = winner.score >= GAMES_TO_MATCH;
    let scrapped = null;
    if (playPage && lostWeapon) {
      scrapWeapon(loser);
      if (isLostWeapon(loser, weaponKey(lostWeapon))) {
        scrapped = lostWeapon;
        const next = availableWeapons(loser)[0];
        if (next) loser.weapon = next;
      }
      p1.lockedId = null;
      p2.lockedId = null;
    }
    const lostName = lostWeapon ? lostWeapon.name : "";
    const found = winner.loot.find((item) => item.name === lostName);
    if (found) found.count += 1;
    else winner.loot.push({ name: lostName, tint: lostWeapon ? lostWeapon.tint : winner.color, count: 1 });
    burst(winner.body.position.x, winner.body.position.y, 8, winner.color);
    for (let i = 0; i < 18; i += 1) {
      particles.push({
        x: winner.body.position.x,
        y: winner.body.position.y,
        vx: (Math.random() - 0.5) * 7,
        vy: -2.2 - Math.random() * 3.5,
        life: 1,
        color: i % 2 ? "#e31c23" : "#f0c14a",
        size: 4 + Math.random() * 3,
        spin: 4 + Math.random() * 4,
      });
    }
    const games = p1.score + " ： " + p2.score;
    if (matchOver) {
      const loot = winner.loot.length
        ? "戰利品：" + winner.loot.map((item) => (item.count > 1 ? item.name + "×" + item.count : item.name)).join("、") + "。"
        : "";
      document.getElementById("result-title").textContent = winner.name + "贏晒";
      document.getElementById("result-detail").textContent = "三局兩勝，先贏兩局。局數 " + games + "。" + loot;
      againBtn.textContent = "再嚟過";
      setStatus(winner.name + "贏晒！三局兩勝，先贏兩局。局數 " + games + "。");
    } else if (tookGame) {
      document.getElementById("result-title").textContent = winner.name + "贏咗呢一局";
      document.getElementById("result-detail").textContent = "呢局疊贏三次。局數 " + games + "。下一局可以再揀劍。";
      againBtn.textContent = "下一局";
      setStatus(winner.name + "贏咗呢一局。局數 " + games + "。");
    } else {
      document.getElementById("result-title").textContent = winner.name + " " + winner.points + " / 3";
      document.getElementById("result-detail").textContent = "疊咗喺" + loser.name + "上面。呢局要贏三次。";
      againBtn.textContent = "下一舖";
      if (playPage && scrapped) {
        setStatus(shelfLabel(weaponList(loser), scrapped) + "報廢咗。" + winner.name + "疊中 " + winner.points + " / 3。");
      } else {
        setStatus(winner.name + "疊中 " + winner.points + " / 3。");
      }
    }
    resultBox.hidden = false;
    paintResultActions(matchOver);
    playWin();
    syncHud();
    if (onlineHost()) onlinePublish(true);
  }

  function paintResultActions(finished) {
    if (!playPage) {
      againBtn.focus();
      return;
    }
    const replay = document.getElementById("replay-btn");
    const home = document.getElementById("home-btn");
    againBtn.hidden = !!finished;
    if (replay) replay.hidden = !!finished;
    if (home) home.hidden = false;
    const focusTarget = finished && home ? home : againBtn;
    focusTarget.focus();
  }

  function setTurn(player) {
    current = player;
    phase = "aim";
    quietFrames = 0;
    stuckCover = 0;
    stableVerdict = null;
    stableCount = 0;
    cpuPlan = null;
    syncHud();
    if (isCpu(player) && intro.hidden) beginCpuTurn();
  }

  function startMatch() {
    intro.hidden = true;
    started = true;
    startBtn.textContent = "繼續玩";
    unlockAudio();
    playUi();
    if (phase === "intro") {
      setTurn(p1);
      setStatus(matchMode === "cpu" ? "單人打電腦。輪到你。" + aimHint() : matchMode === "online" ? "線上房 " + (roomCode || "----") + "。等對手入房。" : "輪到" + current.name + "。" + aimHint());
      return;
    }
    syncHud();
    if (phase === "aim") setStatus("輪到" + current.name + "。" + aimHint());
  }

  function nextRound() {
    if (onlineGuest()) {
      onlinePush({ type: "next" });
      setStatus("等房主開下一舖。");
      return;
    }
    resultBox.hidden = true;
    const freshMatch = matchOver;
    if (freshMatch) {
      p1.score = 0;
      p2.score = 0;
      p1.points = 0;
      p2.points = 0;
      matchOver = false;
      if (playPage) {
        p1.defeated = new Set();
        p2.defeated = new Set();
      }
    }
    if (playPage) {
      p1.lockedId = null;
      p2.lockedId = null;
    }
    const newGame = !freshMatch && p1.points === 0 && p2.points === 0 && p1.score + p2.score > 0;
    if (playPage && newGame) {
      p1.defeated = new Set();
      p2.defeated = new Set();
    }
    arm(p1, p1.weapon);
    arm(p2, p2.weapon);
    setTurn(lastLoser || p1);
    playUi();
    const lead = freshMatch ? "新一場。武器庫重置。" : newGame ? "新一局。可以再揀劍。" : "新一舖。";
    if (newGame) {
      setStatus(lead + "輪到" + current.name + "。");
      if (onlineHost()) onlinePublish(true);
      return;
    }
    if (playPage && !freshMatch && current.weapon && isLostWeapon(current, weaponKey(current.weapon))) {
      setStatus(lead + current.name + "把劍報廢咗，揀另一把先射。");
      return;
    }
    setStatus(lead + current.name + (isCpu(current) ? "先射。" : "先射，試下贏返把劍。"));
    if (onlineHost()) onlinePublish(true);
  }

  function weaponKey(weapon) {
    return weapon ? weapon.uid || weapon.id : "";
  }

  function weaponList(player) {
    return player.catalog.concat(player.custom ? [player.custom] : []);
  }

  function shelfLabel(list, weapon) {
    const same = list.filter((item) => item.id === weapon.id);
    if (same.length < 2) return weapon.name;
    return weapon.name + " " + (same.indexOf(weapon) + 1);
  }

  function isLostWeapon(player, weaponId) {
    return !!(player.defeated && player.defeated.has(weaponId));
  }

  function scrapWeapon(player) {
    if (!player.defeated) player.defeated = new Set();
    if (!player.weapon) return;
    const key = weaponKey(player.weapon);
    const others = availableWeapons(player).some((weapon) => weaponKey(weapon) !== key);
    if (!others) return;
    player.defeated.add(key);
  }

  function availableWeapons(player) {
    const seen = new Set();
    return weaponList(player).filter((weapon) => {
      const key = weaponKey(weapon);
      if (!weapon || !key || seen.has(key) || isLostWeapon(player, key)) return false;
      seen.add(key);
      return true;
    });
  }

  function ensurePlayWeapon(player) {
    if (player.weapon && !isLostWeapon(player, weaponKey(player.weapon))) return true;
    const next = availableWeapons(player)[0];
    if (next) {
      arm(player, next);
      return true;
    }
    if (player.weapon && player.defeated) player.defeated.delete(weaponKey(player.weapon));
    return !!player.weapon;
  }

  function canPickWeapon(player) {
    if (!playPage) return canArm(player);
    if (matchMode === "online" && (!onlineReady || player.id !== onlineSeat)) return false;
    if (drag || phase === "fly" || phase === "result" || player.lockedId) return false;
    if (!started || phase === "intro") return !isCpu(player);
    if (isCpu(player)) return false;
    return player === current;
  }

  function canArm(player) {
    if (drag || phase === "fly" || phase === "result") return false;
    if (!started || phase === "intro") return true;
    if (isCpu(player)) return false;
    return player === current;
  }

  function selectWeapon(player, weapon, remote) {
    if (isLostWeapon(player, weaponKey(weapon))) {
      if (!remote) setStatus(shelfLabel(weaponList(player), weapon) + "報廢咗，唔可以再揀。");
      return false;
    }
    if (playPage && player.lockedId) {
      if (!remote) setStatus("呢舖已經出手，唔可以再換劍。");
      return false;
    }
    if (remote) {
      if (phase !== "aim" || current !== player) return false;
    } else if (matchMode === "online" && player.id !== onlineSeat) {
      setStatus("呢邊係對手嘅劍。");
      return false;
    } else if (!canPickWeapon(player)) {
      setStatus(phase === "fly" ? "劍未停，未可以換。" : "未輪到你換劍。");
      return false;
    }
    if (player.weapon && weaponKey(weapon) === weaponKey(player.weapon) && player.body) return true;
    arm(player, weapon);
    setStatus(player.name + "換上" + shelfLabel(weaponList(player), weapon) + "，劍擺返枱邊。");
    if (onlineGuest() && player.id === onlineSeat) {
      onlinePush({ type: "select", index: catalogIndex(player, weapon) });
    }
    if (onlineHost()) onlinePublish(true);
    if (player === current) syncForge();
    return true;
  }

  function resetSword(player, remote) {
    if (!remote && matchMode === "online" && player.id !== onlineSeat) {
      setStatus("未輪到你拾起把劍。");
      return;
    }
    if (!remote && !canArm(player)) {
      setStatus("未輪到你拾起把劍。");
      return;
    }
    if (!remote && onlineGuest()) onlinePush({ type: "reset" });
    arm(player, player.weapon);
    setStatus(player.name + "把劍擺返原位。");
    if (onlineHost()) onlinePublish(true);
  }

  function arm(player, weapon) {
    if (player.body) Composite.remove(engine.world, player.body);
    player.weapon = weapon;
    const body = createBody(weapon);
    player.body = body;
    Composite.add(engine.world, body);
    Body.setPosition(body, { x: player.homeX, y: player.homeY });
    Body.setAngle(body, player.homeAngle);
    Body.setVelocity(body, { x: 0, y: 0 });
    Body.setAngularVelocity(body, 0);
    player.altitude = 0;
    player.zVel = 0;
    player.airborne = false;
    player.landedOn = null;
    player.trail = [];
    setSwordMask(player, true);
    syncHud();
    if (forgeOpen && player === current) syncForge();
  }

  function loadPng(player, file) {
    if (!file) return;
    if (!canArm(player)) {
      setStatus("未輪到你換劍。");
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setStatus("圖太大，請用 6MB 以下嘅 PNG。");
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const weapon = weaponFromImage(file.name, image);
      player.custom = weapon;
      renderArmory(player);
      arm(player, weapon);
      setStatus(player.name + "換上自訂劍圖。劍尖請向右。");
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setStatus("讀唔到呢張圖，請用去背 PNG。");
    };
    image.src = url;
  }

  function clearCabinet() {
    for (const player of players) {
      player.score = 0;
      player.points = 0;
      player.loot = [];
      player.defeated = new Set();
      player.lockedId = null;
    }
    matchOver = false;
    syncHud();
    setStatus("櫃桶清乾淨，局數同呢局分數歸零。");
  }

  function syncHud() {
    const scoreP1 = document.getElementById("score-p1");
    const scoreP2 = document.getElementById("score-p2");
    const pointsP1 = document.getElementById("points-p1");
    const pointsP2 = document.getElementById("points-p2");
    if (scoreP1) scoreP1.textContent = String(p1.score);
    if (scoreP2) scoreP2.textContent = String(p2.score);
    if (pointsP1) pointsP1.textContent = String(p1.points);
    if (pointsP2) pointsP2.textContent = String(p2.points);
    const played = p1.score + p2.score;
    const showingFinished = matchOver || (phase === "result" && p1.points === 0 && p2.points === 0 && played > 0);
    const gameIndex = showingFinished ? played : Math.min(3, played + 1);
    scoreline.textContent = "第 " + gameIndex + " 局 · " + p1.name + " " + p1.points + " ： " + p2.points + " " + p2.name + " · 局數 " + p1.score + " ： " + p2.score;
    for (const player of players) {
      if (player.card) player.card.classList.toggle("active", started && phase !== "result" && player === current);
      const allowed = canArm(player);
      if (player.resetBtn) player.resetBtn.setAttribute("aria-disabled", allowed ? "false" : "true");
      if (player.uploadBtn) player.uploadBtn.setAttribute("aria-disabled", allowed ? "false" : "true");
      if (player.weaponHost) {
        player.weaponHost.querySelectorAll(".weapon").forEach((button) => {
          const lost = isLostWeapon(player, button.dataset.weapon);
          const locked = player.lockedId === button.dataset.weapon;
          const equipped = player.weapon && button.dataset.weapon === weaponKey(player.weapon);
          button.classList.toggle("is-lost", lost);
          button.classList.toggle("is-locked", locked && !lost);
          button.setAttribute("aria-disabled", !canPickWeapon(player) || lost ? "true" : "false");
          button.setAttribute("aria-pressed", equipped ? "true" : "false");
        });
      }
      if (player.lootHost) renderLoot(player);
    }
  }

  function renderLoot(player) {
    const host = player.lootHost;
    if (!host) return;
    host.replaceChildren();
    if (!player.loot.length) {
      host.textContent = "櫃桶仲係空";
      return;
    }
    for (const item of player.loot) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.style.borderColor = item.tint;
      chip.textContent = item.count > 1 ? item.name + " × " + item.count : item.name;
      host.appendChild(chip);
    }
  }

  function renderArmory(player) {
    const list = weaponList(player);
    player.weaponHost.replaceChildren();
    for (const weapon of list) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "weapon";
      button.dataset.weapon = weaponKey(weapon);
      const icon = document.createElement("canvas");
      icon.width = 86;
      icon.height = 32;
      icon.className = "wicon";
      const name = document.createElement("span");
      name.className = "wname";
      name.textContent = shelfLabel(list, weapon);
      button.append(icon, name);
      if (!playPage) {
        const price = document.createElement("span");
        price.className = "wprice";
        price.textContent = weapon.price;
        button.append(price);
      }
      drawWeaponFit(icon.getContext("2d"), weapon, 86, 32);
      player.weaponHost.appendChild(button);
    }
    syncHud();
  }

  function applyHitScale(weapon) {
    if (!weapon.baseParts) weapon.baseParts = weapon.parts.map((part) => ({ ...part }));
    const scale = weapon.hitScale || 1;
    weapon.parts = weapon.baseParts.map((part) => ({
      ...part,
      x: part.x * scale,
      y: part.y * scale,
      w: part.w == null ? part.w : part.w * scale,
      h: part.h == null ? part.h : part.h * scale,
      r: part.r == null ? part.r : part.r * scale,
    }));
  }

  function rebuildBody(player) {
    const prev = player.body;
    if (!prev || !player.weapon) return;
    const pos = { x: prev.position.x, y: prev.position.y };
    const angle = prev.angle;
    const vel = { x: prev.velocity.x, y: prev.velocity.y };
    const spin = prev.angularVelocity || 0;
    Composite.remove(engine.world, prev);
    const body = createBody(player.weapon);
    player.body = body;
    Composite.add(engine.world, body);
    Body.setPosition(body, pos);
    Body.setAngle(body, angle);
    Body.setVelocity(body, vel);
    Body.setAngularVelocity(body, spin);
    setSwordMask(player, !(player.airborne || player.altitude > 1));
  }

  function syncForge() {
    const weapon = current && current.weapon;
    const name = document.getElementById("forge-name");
    if (!weapon || !name) return;
    name.textContent = current.name + " · " + weapon.name;
    const mass = document.getElementById("forge-mass");
    const friction = document.getElementById("forge-friction");
    const hit = document.getElementById("forge-hit");
    mass.value = String(weapon.mass || 8);
    friction.value = String(weapon.friction || 0.7);
    hit.value = String(weapon.hitScale || 1);
    document.getElementById("forge-mass-val").textContent = Number(mass.value).toFixed(1);
    document.getElementById("forge-friction-val").textContent = Number(friction.value).toFixed(2);
    document.getElementById("forge-hit-val").textContent = Number(hit.value).toFixed(2);
    const com = document.getElementById("forge-com");
    if (com) com.textContent = comLabel(weapon);
    for (const [zone, frictionId, bounceId] of FORGE_ZONES) {
      const mat = zoneMaterial(weapon, zone);
      const frictionInput = document.getElementById(frictionId);
      const bounceInput = document.getElementById(bounceId);
      if (!frictionInput || !bounceInput) continue;
      frictionInput.value = String(mat.friction);
      bounceInput.value = String(mat.restitution);
      document.getElementById(frictionId + "-val").textContent = mat.friction.toFixed(2);
      document.getElementById(bounceId + "-val").textContent = mat.restitution.toFixed(2);
    }
  }

  function readZoneSliders(weapon) {
    const mul = ensureZoneMul(weapon);
    const baseF = Math.max(0.05, gripOf(weapon) * terrainFrictionScale());
    const baseR = Math.max(0.05, tune.restitution * terrainBounceScale());
    for (const [zone, frictionId, bounceId] of FORGE_ZONES) {
      const frictionInput = document.getElementById(frictionId);
      const bounceInput = document.getElementById(bounceId);
      if (!frictionInput || !bounceInput) continue;
      mul[zone] = {
        friction: Number(frictionInput.value) / baseF,
        restitution: Number(bounceInput.value) / baseR,
      };
      document.getElementById(frictionId + "-val").textContent = Number(frictionInput.value).toFixed(2);
      document.getElementById(bounceId + "-val").textContent = Number(bounceInput.value).toFixed(2);
    }
  }

  function bindForge() {
    const panel = document.getElementById("forge");
    const toggle = document.getElementById("forge-toggle");
    if (!panel || !toggle) return;
    const paint = () => {
      document.getElementById("forge-mass-val").textContent = Number(document.getElementById("forge-mass").value).toFixed(1);
      document.getElementById("forge-friction-val").textContent = Number(document.getElementById("forge-friction").value).toFixed(2);
      document.getElementById("forge-hit-val").textContent = Number(document.getElementById("forge-hit").value).toFixed(2);
    };
    const apply = (event) => {
      const weapon = current && current.weapon;
      if (!weapon) return;
      const id = event.target.id;
      if (id === "forge-mass" || id === "forge-hit") {
        weapon.mass = Number(document.getElementById("forge-mass").value);
        weapon.hitScale = Number(document.getElementById("forge-hit").value);
        paint();
        for (const player of players) {
          if (player.weapon && weaponKey(player.weapon) === weaponKey(weapon)) rebuildBody(player);
        }
        syncForge();
        return;
      }
      if (id === "forge-friction") {
        weapon.friction = Number(document.getElementById("forge-friction").value);
        paint();
        syncForge();
        for (const player of players) {
          if (player.weapon && weaponKey(player.weapon) === weaponKey(weapon)) paintBodyMaterials(player);
        }
        return;
      }
      readZoneSliders(weapon);
      for (const player of players) {
        if (player.weapon && weaponKey(player.weapon) === weaponKey(weapon)) paintBodyMaterials(player);
      }
    };
    toggle.addEventListener("click", () => {
      forgeOpen = panel.hidden;
      panel.hidden = !forgeOpen;
      toggle.setAttribute("aria-expanded", forgeOpen ? "true" : "false");
      toggle.textContent = forgeOpen ? "收起調校" : "武器調校";
      if (forgeOpen) syncForge();
    });
    const ids = ["forge-mass", "forge-friction", "forge-hit"];
    for (const [, frictionId, bounceId] of FORGE_ZONES) ids.push(frictionId, bounceId);
    for (const id of ids) {
      const input = document.getElementById(id);
      if (input) input.addEventListener("input", apply);
    }
  }

  function bindUi() {
    bindTouchShelf();
    bindDesk();
    bindForge();
    bindTerrain();
    canvas.addEventListener("pointerdown", onDown, { passive: false });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    startBtn.addEventListener("click", startMatch);
    againBtn.addEventListener("click", nextRound);
    if (helpBtn) {
      helpBtn.addEventListener("click", () => {
        if (pauseBox) pauseBox.hidden = true;
        intro.hidden = false;
        startBtn.textContent = started ? "繼續玩" : "開波";
      });
    }
    if (muteBtn) {
      muteBtn.addEventListener("click", () => {
        muted = !muted;
        muteBtn.textContent = muted ? "聲效：關" : "聲效：開";
        if (!muted) unlockAudio();
      });
    }
    if (clearBtn) clearBtn.addEventListener("click", clearCabinet);
    const flickBtn = document.getElementById("mode-flick");
    const chargeBtn = document.getElementById("mode-charge");
    if (flickBtn && chargeBtn) {
      const setControlMode = (mode) => {
        if (drag) {
          setStatus("放手先再轉發射方式。");
          return;
        }
        controlMode = mode;
        flickBtn.setAttribute("aria-pressed", mode === "flick" ? "true" : "false");
        chargeBtn.setAttribute("aria-pressed", mode === "charge" ? "true" : "false");
        if (phase === "aim" && intro.hidden) setStatus("輪到" + current.name + "。" + aimHint());
      };
      flickBtn.addEventListener("click", () => setControlMode("flick"));
      chargeBtn.addEventListener("click", () => setControlMode("charge"));
    }
    const duoBtn = document.getElementById("match-duo");
    const cpuBtn = document.getElementById("match-cpu");
    if (duoBtn) duoBtn.addEventListener("click", () => applyMatchMode("duo"));
    if (cpuBtn) cpuBtn.addEventListener("click", () => applyMatchMode("cpu"));
    document.querySelectorAll("[data-ai]").forEach((button) => {
      button.addEventListener("click", () => setAiLevel(button.dataset.ai));
    });
    const pauseBtn = document.getElementById("pause-btn");
    const resumeBtn = document.getElementById("resume-btn");
    const replayBtn = document.getElementById("replay-btn");
    if (pauseBtn && pauseBox) {
      pauseBtn.addEventListener("click", () => {
        pauseBox.hidden = false;
      });
    }
    if (resumeBtn && pauseBox) {
      resumeBtn.addEventListener("click", () => {
        pauseBox.hidden = true;
      });
    }
    if (replayBtn) {
      replayBtn.addEventListener("click", () => {
        window.location.reload();
      });
    }
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !pauseBox || !intro.hidden || phase === "result") return;
      pauseBox.hidden = !pauseBox.hidden;
    });
    for (const player of players) {
      if (player.weaponHost) {
        player.weaponHost.addEventListener("click", (event) => {
          const button = event.target.closest(".weapon");
          if (!button) return;
          const weapon = weaponList(player).find((item) => weaponKey(item) === button.dataset.weapon);
          if (weapon && selectWeapon(player, weapon)) collapseTouchShelf();
        });
      }
      if (player.resetBtn) player.resetBtn.addEventListener("click", () => resetSword(player));
      if (player.uploadBtn && player.fileInput) {
        player.uploadBtn.addEventListener("click", () => {
          if (!canArm(player)) {
            setStatus("未輪到你換劍。");
            return;
          }
          player.fileInput.click();
        });
        player.fileInput.addEventListener("change", () => {
          const file = player.fileInput.files && player.fileInput.files[0];
          player.fileInput.value = "";
          if (file) loadPng(player, file);
        });
      }
    }
  }

  function makePlayer(id, name, color, homeX, homeY, homeAngle, catalog, weapon) {
    return {
      id,
      name,
      color,
      homeX,
      homeY,
      homeAngle,
      catalog,
      weapon,
      custom: null,
      body: null,
      altitude: 0,
      zVel: 0,
      airborne: false,
      landedOn: null,
      score: 0,
      points: 0,
      loot: [],
      defeated: new Set(),
      lockedId: null,
      trail: [],
      trailTick: 0,
      card: document.getElementById("card-" + id),
      weaponHost: document.getElementById("weapons-" + id),
      lootHost: document.getElementById("loot-" + id),
      resetBtn: document.getElementById("reset-" + id),
      uploadBtn: document.getElementById("upload-" + id),
      fileInput: document.getElementById("file-" + id),
    };
  }

  function createBody(weapon) {
    applyHitScale(weapon);
    const weights = zoneWeights(weapon.parts);
    const friction = gripOf(weapon);
    const partBodies = weapon.parts.map((part) => {
      const zone = zoneOf(part);
      const mat = zoneMaterial(weapon, zone);
      const options = {
        friction: mat.friction,
        frictionStatic: mat.frictionStatic,
        restitution: mat.restitution,
        density: 0.0032 * (weights[zone] || 1),
        slop: partThick(part) < 0.4 ? 0.09 : 0.03,
        label: part.role || "sword-part",
        collisionFilter: { category: SWORD_CAT, mask: WALL_CAT | SWORD_CAT },
      };
      if (part.kind === "circle") return Bodies.circle(part.x, part.y, part.r, options);
      const radius = Math.min(part.chamfer || 0, part.w / 2 - 0.8, part.h / 2 - 0.8);
      if (radius > 1) options.chamfer = { radius };
      if (part.angle) options.angle = part.angle;
      return Bodies.rectangle(part.x, part.y, part.w, part.h, options);
    });
    const body = Body.create({
      parts: partBodies,
      frictionAir: tune.tableAir,
      friction,
      frictionStatic: tune.swordStatic,
      label: "sword",
      restitution: tune.restitution,
    });
    let inertia = 0;
    for (const part of body.parts.slice(1)) {
      const dx = part.position.x - body.position.x;
      const dy = part.position.y - body.position.y;
      inertia += part.inertia + part.mass * (dx * dx + dy * dy);
    }
    if (inertia > 0) Body.setInertia(body, inertia);
    weapon.com = { x: body.position.x, y: body.position.y };
    if (weapon.mass) Body.setMass(body, weapon.mass);
    const blade = zoneMaterial(weapon, "blade");
    body.friction = blade.friction;
    body.frictionStatic = blade.frictionStatic;
    body.restitution = blade.restitution;
    body.frictionAir = tune.tableAir;
    body.sleepThreshold = 22;
    setSwordMask({ body }, true);
    return body;
  }

  function gripOf(weapon) {
    const base = weapon && typeof weapon.friction === "number" ? weapon.friction : TUNE_BASE.swordFriction;
    return base * (tune.swordFriction / TUNE_BASE.swordFriction);
  }

  function zoneOf(part) {
    const role = (part && part.role) || "";
    if (role === "edge" || role === "horn" || role === "wave") return "edge";
    if (role === "grip" || role === "shaft" || role === "pommel" || role === "guard" || role === "collar") return "grip";
    if (role === "blade" || role === "spine" || role === "blunt" || role === "tip") return "blade";
    const thick = partThick(part);
    if (thick < 0.4) return "edge";
    if (thick > 0.85) return "grip";
    return "blade";
  }

  function ensureZoneMul(weapon) {
    if (!weapon.zoneMul) {
      weapon.zoneMul = {
        grip: { ...ZONE_MUL.grip },
        blade: { ...ZONE_MUL.blade },
        edge: { ...ZONE_MUL.edge },
      };
    }
    return weapon.zoneMul;
  }

  function zoneMaterial(weapon, zone) {
    const mul = (weapon && ensureZoneMul(weapon)[zone]) || ZONE_MUL.blade;
    const friction = clamp(gripOf(weapon) * mul.friction * terrainFrictionScale(), 0.02, 1.35 * Math.max(1, terrainFrictionScale()));
    const restitution = clamp(tune.restitution * mul.restitution * terrainBounceScale(), 0, 0.95);
    const frictionStatic = clamp(friction * (tune.swordStatic / Math.max(0.05, tune.swordFriction)), 0.05, 3.2);
    return { friction, restitution, frictionStatic };
  }

  function partArea(part) {
    return part.kind === "circle" ? Math.PI * part.r * part.r : Math.max(1, part.w * part.h);
  }

  function massCentre(parts, weightOf) {
    let mass = 0;
    let x = 0;
    let y = 0;
    for (const part of parts) {
      const m = partArea(part) * weightOf(part);
      mass += m;
      x += part.x * m;
      y += part.y * m;
    }
    if (!mass) return { x: 0, y: 0 };
    return { x: x / mass, y: y / mass };
  }

  function zoneWeights(parts) {
    const blades = parts.filter((part) => zoneOf(part) === "blade");
    const target = massCentre(blades.length ? blades : parts, () => 1);
    let chosen = { grip: 0.16, blade: 1, edge: 0.3 };
    for (let blade = 1; blade <= 16; blade += 0.5) {
      chosen = { grip: 0.16, blade, edge: 0.3 };
      const centre = massCentre(parts, (part) => chosen[zoneOf(part)] || 1);
      const dx = centre.x - target.x;
      const dy = centre.y - target.y;
      if (dx * dx + dy * dy <= 64) break;
    }
    return chosen;
  }

  function materialOfBody(body) {
    const parent = body.parent && body.parent !== body ? body.parent : body;
    const player = swordOwner(parent);
    if (!player || !player.weapon) {
      return {
        friction: body.friction,
        frictionStatic: body.frictionStatic,
        restitution: body.restitution,
      };
    }
    const index = parent.parts.indexOf(body) - 1;
    const spec = player.weapon.parts[index] || {};
    return zoneMaterial(player.weapon, zoneOf(spec));
  }

  function stampZonePair(pair) {
    const collision = pair.collision;
    if (!collision) return;
    const a = materialOfBody(collision.bodyA);
    const b = materialOfBody(collision.bodyB);
    pair.friction = Math.min(a.friction, b.friction);
    pair.frictionStatic = (a.frictionStatic + b.frictionStatic) / 2;
    pair.restitution = (a.restitution + b.restitution) / 2;
  }

  function installZoneContacts() {
    const pairs = Matter.Pairs;
    if (!pairs || !pairs.update || pairs.update.__zone) return;
    const original = pairs.update;
    const update = function (list, collisions, timestamp) {
      const result = original(list, collisions, timestamp);
      const active = list && list.list;
      if (active) {
        for (let i = 0; i < active.length; i += 1) stampZonePair(active[i]);
      }
      return result;
    };
    update.__zone = true;
    pairs.update = update;
  }

  function paintBodyMaterials(player) {
    const body = player.body;
    if (!body || !player.weapon) return;
    const blade = zoneMaterial(player.weapon, "blade");
    body.friction = blade.friction;
    body.frictionStatic = blade.frictionStatic;
    body.restitution = blade.restitution;
    const specs = player.weapon.parts || [];
    childParts(body).forEach((part, index) => {
      const mat = zoneMaterial(player.weapon, zoneOf(specs[index] || {}));
      part.friction = mat.friction;
      part.frictionStatic = mat.frictionStatic;
      part.restitution = mat.restitution;
    });
  }

  function comLabel(weapon) {
    const com = weapon.com || { x: 0, y: 0 };
    const px = Math.round(Math.hypot(com.x, com.y));
    if (px < 4) return "重心貼近幾何中心";
    return (com.x >= 0 ? "重心偏刃 " : "重心偏柄 ") + px + " px";
  }

  function setSwordMask(player, hitSwords) {
    const mask = hitSwords ? WALL_CAT | SWORD_CAT : WALL_CAT;
    const body = player.body;
    body.collisionFilter.category = SWORD_CAT;
    body.collisionFilter.mask = mask;
    body.parts.forEach((part) => {
      part.collisionFilter.category = SWORD_CAT;
      part.collisionFilter.mask = mask;
    });
  }

  function unionBounds(body) {
    const parts = body.parts.length > 1 ? body.parts.slice(1) : body.parts;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const part of parts) {
      Bounds.update(part.bounds, part.vertices, body.velocity);
      minX = Math.min(minX, part.bounds.min.x);
      minY = Math.min(minY, part.bounds.min.y);
      maxX = Math.max(maxX, part.bounds.max.x);
      maxY = Math.max(maxY, part.bounds.max.y);
    }
    return { minX, minY, maxX, maxY };
  }

  function hits(player, point, touchPad) {
    if (!player.body || !player.weapon) return false;
    const vis = geoPos(player);
    const dx = point.x - vis.x;
    const dy = point.y - vis.y;
    const angle = player.body.angle;
    const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
    const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
    const bounds = player.weapon.visualBounds;
    const pad = 16;
    const extraX = touchPad ? touchPad.x : 0;
    const extraY = touchPad ? touchPad.y : 0;
    if (
      bounds &&
      localX >= bounds.minX - pad - extraX &&
      localX <= bounds.maxX + pad + extraX &&
      localY >= bounds.minY - pad - extraY &&
      localY <= bounds.maxY + pad + extraY
    ) {
      return true;
    }
    const half = player.weapon.hitHalf;
    return !!half && Math.abs(localX) <= half.x + extraX && Math.abs(localY) <= half.y + extraY;
  }

  function touchChargeEvent(event) {
    if (controlMode !== "charge" || !event) return false;
    if (event.pointerType === "touch") return true;
    if (event.pointerType === "mouse" || event.pointerType === "pen") return false;
    return window.matchMedia("(pointer: coarse)").matches;
  }

  function touchHitPad() {
    const rect = canvas.getBoundingClientRect();
    const reach = 40;
    return {
      x: rect.width > 0 ? (reach * VIEW_W) / rect.width : reach,
      y: rect.height > 0 ? (reach * VIEW_H) / rect.height : reach,
    };
  }

  function nearestSkeletonPoint(player, point) {
    const parts = player.weapon && player.weapon.parts;
    if (!player.body || !parts || !parts.length) return null;
    const vis = geoPos(player);
    const angle = player.body.angle;
    const dx = point.x - vis.x;
    const dy = point.y - vis.y;
    const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
    const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
    let best = null;
    let bestDist = Infinity;
    for (const part of parts) {
      const hit = nearestOnPart(localX, localY, part);
      if (!hit || hit.dist >= bestDist) continue;
      bestDist = hit.dist;
      best = hit;
    }
    if (!best) return null;
    return {
      x: vis.x + best.x * Math.cos(angle) - best.y * Math.sin(angle),
      y: vis.y + best.x * Math.sin(angle) + best.y * Math.cos(angle),
    };
  }

  function nearestOnPart(localX, localY, part) {
    if (part.x == null || part.y == null) return null;
    const angle = part.angle || 0;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = localX - part.x;
    const dy = localY - part.y;
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    let cx = lx;
    let cy = ly;
    if (part.kind === "circle") {
      const radius = part.r || 0;
      const dist = Math.hypot(lx, ly);
      if (dist > radius && dist > 0) {
        cx = (lx / dist) * radius;
        cy = (ly / dist) * radius;
      }
    } else {
      const halfW = (part.w || 0) / 2;
      const halfH = (part.h || 0) / 2;
      cx = clamp(lx, -halfW, halfW);
      cy = clamp(ly, -halfH, halfH);
    }
    const x = part.x + cx * cos - cy * sin;
    const y = part.y + cx * sin + cy * cos;
    return { x, y, dist: Math.hypot(localX - x, localY - y) };
  }

  function collapseTouchShelf() {
    if (!playPage) return;
    document.body.classList.add("is-shelf-collapsed");
    const tab = document.getElementById("shelf-tab");
    if (tab) tab.setAttribute("aria-expanded", "false");
  }

  function bindTouchShelf() {
    if (!playPage) return;
    const tab = document.getElementById("shelf-tab");
    if (tab) {
      tab.addEventListener("click", () => {
        const open = document.body.classList.contains("is-shelf-collapsed");
        document.body.classList.toggle("is-shelf-collapsed", !open);
        tab.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }
    if (!document.body.classList.contains("is-touch")) return;
    document.querySelectorAll(".play-body .weapons").forEach(bindShelfScroll);
    canvas.addEventListener("touchstart", (event) => event.preventDefault(), { passive: false });
    document.addEventListener("selectstart", (event) => event.preventDefault());
    document.addEventListener("contextmenu", (event) => {
      if (event.target.closest && event.target.closest("input, textarea")) return;
      event.preventDefault();
    });
    document.addEventListener("touchmove", (event) => {
      if (event.target.closest && event.target.closest(".weapons")) return;
      event.preventDefault();
    }, { passive: false });
  }

  function bindShelfScroll(scroller) {
    let tracking = null;
    scroller.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse") return;
      tracking = { id: event.pointerId, y: event.clientY, top: scroller.scrollTop, moved: false };
    });
    scroller.addEventListener("pointermove", (event) => {
      if (!tracking || event.pointerId !== tracking.id) return;
      const dy = event.clientY - tracking.y;
      if (Math.abs(dy) > 8) tracking.moved = true;
      if (!tracking.moved) return;
      scroller.scrollTop = tracking.top - dy;
      event.preventDefault();
    }, { passive: false });
    const finish = (event) => {
      if (!tracking || event.pointerId !== tracking.id) return;
      if (tracking.moved) scroller.dataset.suppressClick = "1";
      tracking = null;
    };
    scroller.addEventListener("pointerup", finish);
    scroller.addEventListener("pointercancel", finish);
    scroller.addEventListener("click", (event) => {
      if (scroller.dataset.suppressClick !== "1") return;
      scroller.dataset.suppressClick = "";
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }

  function swordOwner(body) {
    let node = body;
    while (node) {
      const found = players.find((player) => player.body === node);
      if (found) return found;
      if (!node.parent || node.parent === node) break;
      node = node.parent;
    }
    return null;
  }

  function bumpFromHit(pair, support, kicked) {
    const roots = [pair.bodyA, pair.bodyB].map((body) => (body.parent && body.parent !== body ? body.parent : body));
    roots.forEach((root) => {
      const player = swordOwner(root);
      if (!player || player.landedOn || player.altitude > tune.stackH) return;
      const own = player.hitSpeed || 0;
      const gate = player.stroke === "swipe" ? 11 : 6.2;
      const gain = player.stroke === "swipe" ? 0.2 : 0.55;
      if (own < gate) return;
      const kick = Math.min(6.4, (own - gate) * gain);
      const prev = kicked.get(player) || 0;
      if (kick > prev && kick >= 1.1 && kick > player.zVel) {
        kicked.set(player, kick);
        player.zVel = kick;
        player.airborne = true;
        player.altitude = Math.max(player.altitude, 0.4);
        Sleeping.set(root, false);
      }
      const vx = player.hitVelocity ? player.hitVelocity.x : root.velocity.x;
      const vy = player.hitVelocity ? player.hitVelocity.y : root.velocity.y;
      const lever = (support.x - root.position.x) * vy - (support.y - root.position.y) * vx;
      const faceX = Math.cos(root.angle);
      const faceY = Math.sin(root.angle);
      const across = faceX * vy - faceY * vx;
      const twist = clamp((lever * 0.00032 + across * 0.0035) * (player.stroke === "flick" ? 1.25 : 0.65), -tune.spinCap * 0.9, tune.spinCap * 0.9);
      if (Math.abs(twist) > 0.012) {
        Body.setAngularVelocity(root, clamp((root.angularVelocity || 0) + twist, -tune.spinCap, tune.spinCap));
        Sleeping.set(root, false);
      }
    });
  }

  function relativeSpeed(a, b) {
    const pa = a.parent || a;
    const pb = b.parent || b;
    return Math.hypot(pa.velocity.x - pb.velocity.x, pa.velocity.y - pb.velocity.y);
  }

  function burst(x, y, speed, color) {
    const count = Math.min(10, 4 + Math.floor(speed));
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = 0.7 + Math.random() * 2.2;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity - 1.2,
        life: 1,
        color: Math.random() > 0.4 ? color : "#fff8ea",
        size: 3 + Math.random() * 2,
        spin: 3,
      });
    }
    rings.push({ x, y, r: 6, life: 0.9 });
    if (particles.length > 90) particles.splice(0, particles.length - 90);
  }

  function weaponFromRecord(record) {
    return finalizeWeapon({
      id: record.id,
      name: record.name,
      price: record.price,
      tint: record.tint,
      mass: record.mass,
      friction: record.friction,
      scale: record.scale,
      parts: record.parts,
    });
  }

  function loadWeaponsDatabase() {
    Object.keys(weaponsDatabase).forEach((key) => {
      const record = weaponsDatabase[key];
      const image = new Image();
      image.onload = () => {
        const weapon = weaponFromSprite(record, image);
        if (weapon) swapCatalogWeapon(weapon);
      };
      image.onerror = () => {};
      image.src = record.image;
    });
  }

  function pickThreeWeaponIds() {
    const pool = ["guan", "jian", "ji", "dadao", "snake"];
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const swap = Math.floor(Math.random() * (i + 1));
      const held = pool[i];
      pool[i] = pool[swap];
      pool[swap] = held;
    }
    return pool.slice(0, 3);
  }

  function draftIds() {
    try {
      const ids = JSON.parse(sessionStorage.getItem("sword-draft-v1") || "null");
      if (!Array.isArray(ids)) return [];
      return ids.map((id) => String(id)).filter(Boolean);
    } catch (error) {
      return [];
    }
  }

  function applyDrawnLoadout(ids) {
    if (!ids.length) return;
    const pool = [];
    const seen = new Set();
    players.forEach((player) => {
      player.catalog.forEach((weapon) => {
        if (seen.has(weapon.id)) return;
        seen.add(weapon.id);
        pool.push(weapon);
      });
    });
    const drawn = ids.map((id) => pool.find((weapon) => weapon.id === id)).filter(Boolean);
    if (!drawn.length) return;
    const give = () => drawn.map((weapon) => cloneWeapon(weapon));
    p1.catalog = give();
    p2.catalog = give();
    renderArmory(p1);
    renderArmory(p2);
    arm(p1, p1.catalog[p1.catalog.length - 1]);
    arm(p2, p2.catalog[p2.catalog.length - 1]);
  }

  function swapCatalogWeapon(next) {
    for (const player of players) {
      for (let i = 0; i < player.catalog.length; i += 1) {
        const prev = player.catalog[i];
        if (prev.id !== next.id) continue;
        const fresh = cloneWeapon(next);
        fresh.uid = prev.uid;
        player.catalog[i] = fresh;
        if (player.weapon && weaponKey(player.weapon) === prev.uid && !drag && phase !== "fly" && phase !== "result") {
          arm(player, fresh);
        }
      }
    }
    renderArmory(p1);
    renderArmory(p2);
  }

  function weaponFromSprite(record, image) {
    const probe = document.createElement("canvas");
    probe.width = image.naturalWidth;
    probe.height = image.naturalHeight;
    const pen = probe.getContext("2d");
    pen.drawImage(image, 0, 0);
    const pixels = pen.getImageData(0, 0, probe.width, probe.height).data;
    let minX = probe.width;
    let minY = probe.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < probe.height; y += 1) {
      for (let x = 0; x < probe.width; x += 1) {
        if (pixels[(y * probe.width + x) * 4 + 3] > 40) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX) return null;
    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;
    const long = 210 * (record.scale || 1);
    const aspect = cropW / Math.max(1, cropH);
    const drawW = aspect >= 1 ? long : Math.max(18, long * aspect);
    const drawH = aspect >= 1 ? Math.max(18, long / aspect) : long;
    const sheet = document.createElement("canvas");
    sheet.width = Math.max(2, Math.round(drawW));
    sheet.height = Math.max(2, Math.round(drawH));
    const sheetPen = sheet.getContext("2d");
    sheetPen.translate(sheet.width, 0);
    sheetPen.scale(-1, 1);
    sheetPen.drawImage(image, minX, minY, cropW, cropH, 0, 0, sheet.width, sheet.height);
    return finalizeWeapon({
      id: record.id,
      name: record.name,
      price: record.price,
      tint: record.tint,
      image: sheet,
      drawW: sheet.width,
      drawH: sheet.height,
      mass: record.mass,
      friction: record.friction,
      scale: record.scale,
      parts: opaqueStrips(sheet),
    });
  }

  function opaqueStrips(sheet) {
    const pen = sheet.getContext("2d");
    const pixels = pen.getImageData(0, 0, sheet.width, sheet.height).data;
    const strips = 8;
    const found = [];
    for (let strip = 0; strip < strips; strip += 1) {
      const x0 = Math.floor((strip * sheet.width) / strips);
      const x1 = Math.floor(((strip + 1) * sheet.width) / strips);
      let top = sheet.height;
      let bottom = -1;
      for (let x = x0; x < x1; x += 1) {
        for (let y = 0; y < sheet.height; y += 2) {
          if (pixels[(y * sheet.width + x) * 4 + 3] > 48) {
            if (y < top) top = y;
            if (y > bottom) bottom = y;
          }
        }
      }
      if (bottom < top) continue;
      found.push({
        along: (x0 + x1) / 2 / Math.max(1, sheet.width),
        span: (bottom - top + 1) / Math.max(1, sheet.height),
        boxW: Math.max(8, x1 - x0),
        fullH: Math.max(8, bottom - top + 1),
        midX: (x0 + x1) / 2 - sheet.width / 2,
        midY: (top + bottom) / 2 - sheet.height / 2,
      });
    }
    const maxSpan = found.reduce((max, strip) => Math.max(max, strip.span), 0);
    const headCut = Math.max(0.36, maxSpan * 0.72);
    const parts = [];
    let seenHead = false;
    for (const strip of found) {
      const bulky = strip.span >= headCut && strip.along > 0.2;
      if (bulky) seenHead = true;
      if (!seenHead || strip.along < 0.22) {
        parts.push({
          kind: "box",
          role: "grip",
          thick: 1,
          x: strip.midX,
          y: strip.midY,
          w: strip.boxW,
          h: strip.fullH,
          chamfer: 2,
          fill: "#cccccc",
        });
        continue;
      }
      if (bulky) {
        const edgeH = Math.max(6, strip.fullH * 0.28);
        const bladeH = Math.max(8, strip.fullH - edgeH);
        const towardTop = strip.midY < 0;
        parts.push({
          kind: "box",
          role: "spine",
          thick: 0.92,
          x: strip.midX,
          y: towardTop ? strip.midY + edgeH / 2 : strip.midY - edgeH / 2,
          w: strip.boxW,
          h: bladeH,
          chamfer: 2,
          fill: "#cccccc",
        });
        parts.push({
          kind: "box",
          role: "edge",
          thick: 0.28,
          x: strip.midX,
          y: towardTop ? strip.midY - bladeH / 2 : strip.midY + bladeH / 2,
          w: strip.boxW,
          h: edgeH,
          chamfer: 1,
          fill: "#cccccc",
        });
        continue;
      }
      const edge = strip.along > 0.72;
      parts.push({
        kind: "box",
        role: edge ? "edge" : "blade",
        thick: edge ? 0.3 : 0.55,
        x: strip.midX,
        y: strip.midY,
        w: strip.boxW,
        h: strip.fullH,
        chamfer: edge ? 1 : 2,
        fill: "#cccccc",
      });
    }
    return parts.length ? parts : [{ kind: "box", role: "blade", x: 0, y: 0, w: sheet.width, h: Math.max(18, sheet.height * 0.2), chamfer: 4, fill: "#cccccc" }];
  }

  function weaponFromImage(filename, image) {
    const maxLen = 230;
    const aspect = image.width / Math.max(1, image.height);
    let drawW;
    let drawH;
    if (aspect >= 1) {
      drawW = maxLen;
      drawH = Math.max(18, maxLen / aspect);
    } else {
      drawH = maxLen;
      drawW = Math.max(18, maxLen * aspect);
    }
    const name = filename.replace(/\.[^.]+$/, "").slice(0, 8) || "自訂劍";
    return finalizeWeapon({
      id: "png-" + Math.random().toString(36).slice(2, 8),
      name,
      price: "自攜",
      tint: "#8d6a3a",
      image,
      drawW,
      drawH,
      mass: 8,
      friction: 0.7,
      parts: [
        {
          kind: "box",
          role: "blade",
          x: 0,
          y: 0,
          w: drawW,
          h: Math.max(drawH, 22),
          chamfer: 6,
          fill: "#dddddd",
        },
      ],
    });
  }

  function finalizeWeapon(def) {
    const parts = def.parts.map((part) => ({ ...part }));
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (const part of parts) {
      const partArea = part.kind === "circle" ? Math.PI * part.r * part.r : part.w * part.h;
      area += partArea;
      cx += part.x * partArea;
      cy += part.y * partArea;
    }
    cx /= area;
    cy /= area;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const part of parts) {
      part.x -= cx;
      part.y -= cy;
      const angle = part.angle || 0;
      const halfW = (part.kind === "circle" ? part.r * 2 : part.w) / 2;
      const halfH = (part.kind === "circle" ? part.r * 2 : part.h) / 2;
      const reachX = Math.abs(halfW * Math.cos(angle)) + Math.abs(halfH * Math.sin(angle));
      const reachY = Math.abs(halfW * Math.sin(angle)) + Math.abs(halfH * Math.cos(angle));
      minX = Math.min(minX, part.x - reachX);
      maxX = Math.max(maxX, part.x + reachX);
      minY = Math.min(minY, part.y - reachY);
      maxY = Math.max(maxY, part.y + reachY);
    }
    const weapon = {
      ...def,
      uid: def.uid || "w" + weaponSerial++,
      parts,
      baseParts: parts.map((part) => ({ ...part })),
      hitScale: def.hitScale || 1,
      tint: def.tint || parts[0].fill,
      spriteOffset: def.image ? { x: -cx, y: -cy } : { x: 0, y: 0 },
      visualBounds: def.image
        ? {
            minX: -def.drawW / 2 - cx,
            maxX: def.drawW / 2 - cx,
            minY: -def.drawH / 2 - cy,
            maxY: def.drawH / 2 - cy,
          }
        : { minX, maxX, minY, maxY },
      hitHalf: {
        x: Math.max(Math.abs(minX), Math.abs(maxX)) + 18,
        y: Math.max(36, Math.max(Math.abs(minY), Math.abs(maxY)) + 16),
      },
    };
    return weapon;
  }

  function cloneWeapon(source) {
    const base = (source.baseParts || source.parts || []).map((part) => ({ ...part }));
    return {
      ...source,
      uid: "w" + weaponSerial++,
      parts: base.map((part) => ({ ...part })),
      baseParts: base.map((part) => ({ ...part })),
      spriteOffset: source.spriteOffset ? { ...source.spriteOffset } : { x: 0, y: 0 },
      visualBounds: source.visualBounds ? { ...source.visualBounds } : null,
      hitHalf: source.hitHalf ? { ...source.hitHalf } : null,
      hitScale: source.hitScale || 1,
    };
  }

  function ownCatalog(list) {
    return list.map((weapon) => cloneWeapon(weapon));
  }

  function drawWeapon(context, weapon) {
    if (weapon.image) {
      const ox = weapon.spriteOffset ? weapon.spriteOffset.x : 0;
      const oy = weapon.spriteOffset ? weapon.spriteOffset.y : 0;
      context.drawImage(weapon.image, ox - weapon.drawW / 2, oy - weapon.drawH / 2, weapon.drawW, weapon.drawH);
      return;
    }
    for (const part of weapon.parts) drawPart(context, part);
  }

  function drawPart(context, part) {
    context.save();
    context.translate(part.x, part.y);
    context.rotate(part.angle || 0);
    context.lineJoin = "round";
    context.lineWidth = 2.5;
    context.strokeStyle = "#2a140c";
    context.fillStyle = part.fill;
    if (part.kind === "circle") {
      context.beginPath();
      context.arc(0, 0, part.r, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = "rgba(255,255,255,0.5)";
      context.beginPath();
      context.arc(-part.r * 0.28, -part.r * 0.32, part.r * 0.28, 0, Math.PI * 2);
      context.fill();
    } else {
      const radius = Math.min(part.chamfer || 4, part.w / 2, part.h / 2);
      pathRoundRect(context, -part.w / 2, -part.h / 2, part.w, part.h, radius);
      context.fill();
      context.stroke();
      context.fillStyle = "rgba(255,255,255,0.38)";
      pathRoundRect(context, -part.w / 2 + 2, -part.h / 2 + 1.5, Math.max(2, part.w - 4), Math.max(2, part.h * 0.3), 2);
      context.fill();
      context.fillStyle = "rgba(0,0,0,0.1)";
      pathRoundRect(context, -part.w / 2 + 2, part.h / 2 - Math.max(2, part.h * 0.24), Math.max(2, part.w - 4), Math.max(2, part.h * 0.18), 2);
      context.fill();
    }
    context.restore();
  }

  function drawWeaponFit(context, weapon, width, height) {
    const bounds = weapon.visualBounds;
    const boundsW = bounds.maxX - bounds.minX || 1;
    const boundsH = bounds.maxY - bounds.minY || 1;
    const scale = Math.min((width - 8) / boundsW, (height - 4) / boundsH);
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(width / 2, height / 2);
    context.scale(scale, scale);
    context.translate(-(bounds.minX + bounds.maxX) / 2, -(bounds.minY + bounds.maxY) / 2);
    drawWeapon(context, weapon);
    context.restore();
  }

  function childParts(body) {
    return body.parts.length > 1 ? body.parts.slice(1) : body.parts;
  }

  function paintBackdrop() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    backdrop.width = Math.floor(VIEW_W * dpr);
    backdrop.height = Math.floor(VIEW_H * dpr);
    const b = backdrop.getContext("2d");
    b.setTransform(dpr, 0, 0, dpr, 0, 0);
    b.clearRect(0, 0, VIEW_W, VIEW_H);

    const face = b.createLinearGradient(0, 0, VIEW_W, VIEW_H);
    face.addColorStop(0, "#6b4630");
    face.addColorStop(0.38, "#3a2418");
    face.addColorStop(1, "#140c08");
    b.fillStyle = face;
    b.fillRect(0, 0, VIEW_W, VIEW_H);

    const lip = RIM;
    const topX = lip;
    const topY = lip;
    const topW = VIEW_W - lip * 2;
    const topH = VIEW_H - lip * 2;
    drawFloor(b, topX, topY, topW, topH);

    b.save();
    b.beginPath();
    b.rect(topX, topY, topW, topH);
    b.clip();
    const shadeTop = b.createLinearGradient(0, topY, 0, topY + 72);
    shadeTop.addColorStop(0, "rgba(8, 4, 2, 0.62)");
    shadeTop.addColorStop(1, "rgba(8, 4, 2, 0)");
    b.fillStyle = shadeTop;
    b.fillRect(topX, topY, topW, 72);
    const shadeLeft = b.createLinearGradient(topX, 0, topX + 54, 0);
    shadeLeft.addColorStop(0, "rgba(8, 4, 2, 0.4)");
    shadeLeft.addColorStop(1, "rgba(8, 4, 2, 0)");
    b.fillStyle = shadeLeft;
    b.fillRect(topX, topY, 54, topH);
    const shadeRight = b.createLinearGradient(topX + topW, 0, topX + topW - 36, 0);
    shadeRight.addColorStop(0, "rgba(8, 4, 2, 0.28)");
    shadeRight.addColorStop(1, "rgba(8, 4, 2, 0)");
    b.fillStyle = shadeRight;
    b.fillRect(topX + topW - 36, topY, 36, topH);
    b.restore();

    b.strokeStyle = "rgba(236, 204, 156, 0.32)";
    b.lineWidth = 2;
    b.strokeRect(topX + 1.5, topY + 1.5, topW - 3, topH - 3);
    b.strokeStyle = "rgba(12, 6, 3, 0.72)";
    b.lineWidth = 6;
    b.strokeRect(topX - 2, topY - 2, topW + 4, topH + 4);

    b.save();
    b.translate(topX + 78, topY + 64);
    b.rotate(-0.18);
    b.strokeStyle = "rgba(92, 28, 22, 0.45)";
    b.lineWidth = 2;
    b.beginPath();
    b.arc(0, 0, 22, 0, Math.PI * 2);
    b.stroke();
    b.font = '16px "Ma Shan Zheng", "KaiTi", serif';
    b.fillStyle = "rgba(120, 36, 28, 0.5)";
    b.textAlign = "center";
    b.textBaseline = "middle";
    b.fillText("吉利", 0, 1);
    b.restore();

    b.font = '20px "Ma Shan Zheng", "KaiTi", serif';
    b.fillStyle = "rgba(62, 28, 16, 0.42)";
    b.textAlign = "left";
    b.fillText("小明到此一遊", topX + 150, topY + 58);
  }

  function drawFloor(b, x, y, w, h) {
    const photo = terrain.image && floorImages[terrain.id];
    if (photo) {
      b.save();
      b.beginPath();
      b.rect(x, y, w, h);
      b.clip();
      const scale = Math.max(w / photo.width, h / photo.height);
      const dw = photo.width * scale;
      const dh = photo.height * scale;
      b.drawImage(photo, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      b.restore();
      return;
    }
    if (terrain.image) {
      b.fillStyle = terrain.fallback;
      b.fillRect(x, y, w, h);
      return;
    }
    drawAgedTop(b, x, y, w, h);
  }

  function loadFloors() {
    Object.keys(TERRAINS).forEach((id) => {
      const profile = TERRAINS[id];
      if (!profile.image) return;
      const image = new Image();
      image.onload = () => {
        floorImages[id] = image;
        if (terrain.id === id) paintBackdrop();
      };
      image.src = encodeURI(profile.image);
    });
  }

  function applyTerrain(id) {
    const next = TERRAINS[id];
    if (!next) return;
    terrain = next;
    Object.keys(TERRAINS).forEach((key) => {
      const button = document.getElementById("terrain-" + key);
      if (button) button.setAttribute("aria-pressed", key === id ? "true" : "false");
    });
    applyMaterial();
    paintBackdrop();
    if (forgeOpen) syncForge();
    paintPlayBrief();
    setStatus(intro.hidden ? terrain.blurb : terrain.blurb + " 撳「開波」就打。");
  }

  function paintPlayBrief() {
    const node = document.getElementById("play-brief");
    if (!node) return;
    const who = matchMode === "cpu" ? (aiLevel === "hard" ? "困難" : "普通") : matchMode === "online" ? "線上 " + (roomCode || "") + (onlineSeat === "p1" ? " · 玩家一" : onlineSeat === "p2" ? " · 玩家二" : "") : "雙人";
    node.textContent = terrain.name + " · " + who;
  }

  function weaponById(id) {
    if (!id) return null;
    for (const player of players) {
      const found = player.catalog.find((item) => item.id === id);
      if (found) return found;
    }
    return null;
  }

  function equipNamed(player, id) {
    if (!id) return;
    let weapon = player.catalog.find((item) => item.id === id && !isLostWeapon(player, weaponKey(item)));
    if (!weapon) weapon = player.catalog.find((item) => item.id === id);
    if (!weapon) {
      const template = weaponById(id);
      if (!template) return;
      weapon = cloneWeapon(template);
      player.catalog.push(weapon);
    }
    arm(player, weapon);
    renderArmory(player);
  }

  function bindTerrain() {
    Object.keys(TERRAINS).forEach((id) => {
      const button = document.getElementById("terrain-" + id);
      if (!button) return;
      button.addEventListener("click", () => applyTerrain(id));
    });
    loadFloors();
  }

  function drawAgedTop(b, x, y, w, h) {
    const noise = mulberry32(11);
    b.save();
    b.beginPath();
    b.rect(x, y, w, h);
    b.clip();
    b.translate(x + w / 2, y + h / 2);
    b.rotate(-Math.PI / 4);
    const span = Math.hypot(w, h) + 40;
    const boards = 16;
    const boardH = (span * 2) / boards;
    for (let i = 0; i < boards; i += 1) {
      const tone = 36 + Math.floor(noise() * 18);
      const yy = -span + i * boardH;
      b.fillStyle = "rgb(" + (tone + 24) + "," + (tone + 8) + "," + Math.max(8, Math.floor(tone * 0.42)) + ")";
      b.fillRect(-span, yy, span * 2, boardH + 1);
      b.strokeStyle = "rgba(18, 8, 4, 0.45)";
      b.beginPath();
      b.moveTo(-span, yy);
      b.lineTo(span, yy);
      b.stroke();
      for (let line = 0; line < 3; line += 1) {
        b.strokeStyle = "rgba(28, 12, 6, " + (0.16 + noise() * 0.16) + ")";
        b.beginPath();
        const gy = yy + 6 + line * (boardH / 4);
        b.moveTo(-span, gy);
        b.lineTo(span, gy + (noise() - 0.5) * 5);
        b.stroke();
      }
    }
    b.restore();

    b.save();
    b.beginPath();
    b.rect(x, y, w, h);
    b.clip();
    b.strokeStyle = "rgba(210, 170, 120, 0.05)";
    b.lineWidth = 1;
    for (let i = -h; i < w + h; i += 28) {
      b.beginPath();
      b.moveTo(x + i, y);
      b.lineTo(x + i - h, y + h);
      b.stroke();
    }
    const wear = mulberry32(27);
    for (let i = 0; i < 5; i += 1) {
      b.fillStyle = "rgba(18, 8, 4, " + (0.08 + wear() * 0.08) + ")";
      b.beginPath();
      b.ellipse(x + wear() * w, y + wear() * h, 30 + wear() * 70, 10 + wear() * 16, -0.6, 0, Math.PI * 2);
      b.fill();
    }
    b.restore();
  }

  function fitCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.floor(VIEW_W * dpr);
    const height = Math.floor(VIEW_H * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      paintBackdrop();
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * VIEW_W,
      y: ((event.clientY - rect.top) / rect.height) * VIEW_H,
    };
  }

  function pathRoundRect(context, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arcTo(x + w, y, x + w, y + h, radius);
    context.arcTo(x + w, y + h, x, y + h, radius);
    context.arcTo(x, y + h, x, y, radius);
    context.arcTo(x, y, x + w, y, radius);
    context.closePath();
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function mulberry32(seed) {
    let value = seed >>> 0;
    return function next() {
      value = (value + 0x6d2b79f5) >>> 0;
      let t = Math.imul(value ^ (value >>> 15), 1 | value);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function unlockAudio() {
    const context = audio();
    if (context && context.state === "suspended") context.resume();
  }

  function audio() {
    if (muted) return null;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      return audioCtx;
    } catch (error) {
      return null;
    }
  }

  function tone(freq, duration, type, volume, slide) {
    const context = audio();
    if (!context) return;
    const time = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slide), time + duration);
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start(time);
    osc.stop(time + duration + 0.02);
  }

  function playLaunch() {
    tone(260, 0.16, "triangle", 0.06, 70);
  }

  function playHit(speed) {
    const now = performance.now();
    if (now - lastHitSfx < 80) return;
    lastHitSfx = now;
    tone(140 + speed * 6, 0.07, "square", Math.min(0.05, 0.02 + speed * 0.003), 60);
  }

  function playUi() {
    tone(620, 0.05, "square", 0.03);
  }

  function playWin() {
    tone(523, 0.1, "square", 0.04);
    window.setTimeout(() => tone(659, 0.1, "square", 0.04), 110);
    window.setTimeout(() => tone(784, 0.18, "square", 0.045), 220);
  }

})();
