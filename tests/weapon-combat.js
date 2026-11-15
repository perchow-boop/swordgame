/**
 * Weapon against weapon. Run: node tests/weapon-combat.js
 */
const {
  Matter,
  Engine,
  Body,
  Composite,
  Sleeping,
  VIEW_W,
  VIEW_H,
  RIM,
  TRIALS,
  MAX_FRAMES,
  SUBSTEPS,
  STEP,
  SEED,
  TUNE,
  TERRAINS,
  WEAPONS,
  createRng,
  glideAir,
  installZoneContacts,
  makeWalls,
  makeSword,
  speedOf,
  weaponName,
  createEngine,
} = require("./harness");

const { Events } = Matter;

function boundsOverlap(a, b) {
  const width = Math.min(a.bounds.max.x, b.bounds.max.x) - Math.max(a.bounds.min.x, b.bounds.min.x);
  const height = Math.min(a.bounds.max.y, b.bounds.max.y) - Math.max(a.bounds.min.y, b.bounds.min.y);
  if (width <= 0 || height <= 0) return 0;
  return width * height;
}

function escaped(body) {
  const bounds = body.bounds;
  return bounds.max.x < RIM || bounds.min.x > VIEW_W - RIM || bounds.max.y < RIM || bounds.min.y > VIEW_H - RIM;
}

function tunneled(body) {
  const parts = body.parts && body.parts.length > 1 ? body.parts.slice(1) : [body];
  for (const part of parts) {
    for (const vertex of part.vertices) {
      if (vertex.x < -20 || vertex.x > VIEW_W + 20 || vertex.y < -20 || vertex.y > VIEW_H + 20) return true;
    }
  }
  return false;
}

function pickDistinct(rng, count) {
  const pool = WEAPONS.slice();
  const chosen = [];
  while (chosen.length < count && pool.length) {
    const index = Math.floor(rng.rand() * pool.length);
    chosen.push(pool.splice(index, 1)[0]);
  }
  return chosen;
}

function scenarioKind(rng) {
  const roll = rng.rand();
  if (roll < 0.4) return "clash";
  if (roll < 0.7) return "shear";
  if (roll < 0.9) return "push";
  return "stack";
}

function throwSword(body, vx, vy, spin) {
  Body.setVelocity(body, { x: vx, y: vy });
  Body.setAngularVelocity(body, spin);
  Sleeping.set(body, false);
  return { speed: Math.hypot(vx, vy), angle: Math.atan2(vy, vx) };
}

function spawnDuel(terrain, kind, rng) {
  const weapons = pickDistinct(rng, kind === "stack" ? 3 : 2);
  const centerY = rng.range(460, 620);
  let layout = [];
  if (kind === "clash") {
    const speedA = rng.range(8, TUNE.maxSpeed);
    const speedB = rng.range(8, TUNE.maxSpeed);
    const yA = centerY + rng.range(-10, 10);
    const yB = yA + rng.range(-8, 8);
    const meet = 800 / Math.max(1, speedA + speedB);
    layout = [
      { weapon: weapons[0], x: 560, y: yA, vx: speedA, vy: (yB - yA) / meet, spin: rng.range(-0.45, 0.45), face: 0 },
      { weapon: weapons[1], x: 1360, y: yB, vx: -speedB, vy: (yA - yB) / meet, spin: rng.range(-0.45, 0.45), face: Math.PI },
    ];
  } else if (kind === "shear") {
    const speedA = rng.range(6, TUNE.maxSpeed);
    const speedB = rng.range(6, TUNE.maxSpeed);
    const gap = rng.range(8, 28);
    layout = [
      { weapon: weapons[0], x: 600, y: centerY - gap, vx: speedA, vy: rng.range(-1.5, 1.5), spin: rng.range(-0.5, 0.5), face: rng.range(-0.9, 0.9) },
      { weapon: weapons[1], x: 1320, y: centerY + gap, vx: -speedB, vy: rng.range(-1.5, 1.5), spin: rng.range(-0.5, 0.5), face: Math.PI + rng.range(-0.9, 0.9) },
    ];
  } else if (kind === "push") {
    const speedA = rng.range(TUNE.minSpeed, 8);
    const speedB = rng.range(TUNE.minSpeed, 8);
    layout = [
      { weapon: weapons[0], x: 700, y: centerY, vx: speedA, vy: rng.range(-0.6, 0.6), spin: rng.range(-0.2, 0.2), face: rng.range(-0.4, 0.4) },
      { weapon: weapons[1], x: 1220, y: centerY + rng.range(-8, 8), vx: -speedB, vy: rng.range(-0.6, 0.6), spin: rng.range(-0.2, 0.2), face: Math.PI + rng.range(-0.4, 0.4) },
    ];
  } else {
    layout = weapons.map((weapon, index) => ({
      weapon,
      x: 960 + (index - 1) * 34,
      y: centerY + (index - 1) * 22,
      vx: (1 - index) * rng.range(1.2, 4.5),
      vy: rng.range(-1.2, 1.2),
      spin: rng.range(-0.35, 0.35),
      face: index * 0.7 + rng.range(-0.3, 0.3),
    }));
  }
  return layout.map((item) => {
    const body = makeSword(item.weapon, terrain, item.x, item.y, item.face);
    const shot = throwSword(body, item.vx, item.vy, item.spin);
    return { body, weapon: item.weapon, shot };
  });
}

function closingSpeed(a, b) {
  const dx = b.position.x - a.position.x;
  const dy = b.position.y - a.position.y;
  const dist = Math.hypot(dx, dy) || 1;
  const rvx = a.velocity.x - b.velocity.x;
  const rvy = a.velocity.y - b.velocity.y;
  return (rvx * dx + rvy * dy) / dist;
}

function exploded(body) {
  const velocity = body.velocity;
  const position = body.position;
  if (!Number.isFinite(velocity.x) || !Number.isFinite(velocity.y) || !Number.isFinite(body.angularVelocity)) return true;
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(body.angle)) return true;
  if (speedOf(body) > TUNE.maxSpeed * 4) return true;
  return Math.abs(body.angularVelocity) > 1.2;
}

function pairDistance(a, b) {
  return Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
}

function simulate(terrain, kind, rng) {
  const engine = createEngine();
  const fighters = spawnDuel(terrain, kind, rng);
  const bodies = fighters.map((fighter) => fighter.body);
  Composite.add(engine.world, makeWalls(terrain).concat(bodies));
  let swordHits = 0;
  Events.on(engine, "collisionStart", (event) => {
    for (const pair of event.pairs) {
      const parentA = pair.bodyA.parent || pair.bodyA;
      const parentB = pair.bodyB.parent || pair.bodyB;
      if (parentA !== parentB && parentA.label === "sword" && parentB.label === "sword") swordHits += 1;
    }
  });

  const flags = { clip: false, sticky: false, jitter: false, explode: false, wall: false };
  const flips = bodies.map(() => []);
  const last = bodies.map((body) => ({ x: body.position.x, y: body.position.y }));
  let clipFrames = 0;
  let stuckFrames = 0;
  let quiet = 0;
  let nudged = false;
  let nudgeDist = 0;
  let nudgeFrame = 0;
  let frame = 0;

  for (frame = 0; frame < MAX_FRAMES; frame += 1) {
    for (const body of bodies) body.frictionAir = glideAir(speedOf(body), terrain);
    for (let step = 0; step < SUBSTEPS; step += 1) Engine.update(engine, STEP / SUBSTEPS);
    if (bodies.some(exploded)) {
      flags.explode = true;
      break;
    }
    if (!flags.wall && bodies.some((body) => escaped(body) || tunneled(body))) flags.wall = true;

    let deepest = Infinity;
    let tightest = null;
    for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) {
        const dist = pairDistance(bodies[i], bodies[j]);
        if (dist < deepest) {
          deepest = dist;
          tightest = [bodies[i], bodies[j]];
        }
      }
    }
    const overlap = tightest ? boundsOverlap(tightest[0], tightest[1]) : 0;
    const closing = tightest ? closingSpeed(tightest[0], tightest[1]) : 0;
    const busy = Math.max.apply(null, bodies.map(speedOf));
    if (deepest < 30 && closing > 2.5 && busy > 8) clipFrames += 1;
    else clipFrames = 0;
    if (clipFrames >= 3) flags.clip = true;

    const slow = bodies.every((body) => speedOf(body) < 0.9);
    if (slow && overlap > 400 && frame > 20) {
      bodies.forEach((body, index) => {
        const dx = body.position.x - last[index].x;
        const dy = body.position.y - last[index].y;
        const flip = last[index].ready && dx * last[index].dx + dy * last[index].dy < 0 && Math.hypot(dx, dy) > 0.35;
        flips[index].push(flip ? 1 : 0);
        if (flips[index].length > 30) flips[index].shift();
        last[index] = { x: body.position.x, y: body.position.y, dx, dy, ready: true };
      });
      if (flips.some((list) => list.reduce((sum, bit) => sum + bit, 0) >= 10)) flags.jitter = true;
    }

    if (deepest < 20 && overlap > 1000 && busy < 0.35) stuckFrames += 1;
    else if (deepest > 48) stuckFrames = 0;
    if (stuckFrames > 70) flags.sticky = true;
    if (!nudged && stuckFrames > 24 && tightest) {
      nudged = true;
      nudgeFrame = frame;
      nudgeDist = deepest;
      const dx = tightest[1].position.x - tightest[0].position.x;
      const dy = tightest[1].position.y - tightest[0].position.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len;
      const ny = dy / len;
      tightest.forEach((body, index) => {
        const sign = index === 0 ? -1 : 1;
        Body.setVelocity(body, { x: body.velocity.x + nx * sign * 1.6, y: body.velocity.y + ny * sign * 1.6 });
        Sleeping.set(body, false);
      });
    }
    if (nudged && frame > nudgeFrame + 36 && deepest < nudgeDist + 6 && deepest < 20) flags.sticky = true;

    const calm = bodies.every((body) => speedOf(body) < 0.08 && Math.abs(body.angularVelocity) < 0.01);
    quiet = calm ? quiet + 1 : 0;
    if (quiet > 24 && frame > 30 && !flags.clip && !flags.explode) break;
  }

  const endSpeed = Math.max.apply(null, bodies.map(speedOf));
  return {
    terrain: terrain.id,
    kind,
    weapons: fighters.map((fighter) => fighter.weapon.id),
    speed: fighters.map((fighter) => Number(fighter.shot.speed.toFixed(2))),
    frames: frame + 1,
    endSpeed: Number((Number.isFinite(endSpeed) ? endSpeed : 9999).toFixed(3)),
    hits: swordHits,
    clip: flags.clip,
    sticky: flags.sticky,
    jitter: flags.jitter,
    explode: flags.explode,
    wall: flags.wall,
  };
}

function bad(row) {
  return row.clip || row.sticky || row.jitter || row.explode || row.wall;
}

function tally(rows, key) {
  const counts = {};
  rows.forEach((row) => {
    counts[key(row)] = (counts[key(row)] || 0) + 1;
  });
  return Object.keys(counts)
    .map((name) => ({ name, count: counts[name] }))
    .sort((a, b) => b.count - a.count);
}

function suggestions(issues) {
  const lines = [];
  if (issues.some((row) => row.clip)) {
    lines.push("武器穿模：main.js 的 SUBSTEPS 而家係 3，Matter 0.19 沒有連續碰撞。兩劍相對速度可以去到 36。把 SUBSTEPS 提到 6，並在 stampZonePair 之後如果 pair 的相對速度沿法線仍大於 8，就沿法線再分開 4px。");
  }
  if (issues.some((row) => row.sticky)) {
    lines.push("黏死：薄刃 slop 係 0.09，靜摩擦上限 3.2。交疊之後推唔開，就把 edge 的 slop 降到 0.04，並在 stepAltitude 裡當兩劍中心距離細過 20 而且速度低過 0.3，沿分開方向各加 1.6 的速度。");
  }
  if (issues.some((row) => row.jitter)) {
    lines.push("疊劍抖：Engine 的 positionIterations 係 10。慢過 0.9 仍來回跳，就把 positionIterations 提到 14，速度低過 0.15 而且重疊夠時直接 Body.setVelocity 為 0，並讓 Sleeping.set 進入睡眠。");
  }
  if (issues.some((row) => row.explode)) {
    lines.push("速度崩潰：碰撞後沒有速度上限。在 collisionStart 之後如果速度超過 tune.maxSpeed * 1.5，或出現 NaN，就把速度夾回 maxSpeed，角速度夾到 0.8。");
  }
  if (issues.some((row) => row.wall)) {
    lines.push("飛出邊界：牆厚 80。武器中心越過內牆，就把 tune.maxSpeed 再夾一次，牆厚加到 120。");
  }
  if (!lines.length) {
    lines.push("對劈、交錯、互推同三劍疊，在速度 18 之內沒有穿過去、沒有黏死、沒有靜止後亂抖，也沒有速度變成無限大。SUBSTEPS = 3、劍身彈力 0.42、薄刃 slop 0.09 撐得住。");
  }
  return lines;
}

function runWeaponCombatTest() {
  installZoneContacts();
  const rng = createRng(SEED);
  const started = Date.now();
  const names = Object.keys(TERRAINS);
  const results = [];
  for (let i = 0; i < TRIALS; i += 1) {
    results.push(simulate(TERRAINS[names[i % names.length]], scenarioKind(rng), rng));
    if ((i + 1) % 250 === 0) process.stderr.write("對決 " + (i + 1) + " / " + TRIALS + "\n");
  }
  const issues = results.filter(bad);
  return {
    elapsed: ((Date.now() - started) / 1000).toFixed(1),
    results,
    issues,
    failed: issues.length > 0,
  };
}

function printCombatReport(report) {
  const results = report.results;
  const issues = report.issues;
  const byKind = {
    clip: results.filter((row) => row.clip).length,
    sticky: results.filter((row) => row.sticky).length,
    jitter: results.filter((row) => row.jitter).length,
    explode: results.filter((row) => row.explode).length,
    wall: results.filter((row) => row.wall).length,
  };
  const kindName = { clip: "高速穿模", sticky: "黏死", jitter: "疊劍抖動", explode: "速度崩潰", wall: "飛出邊界" };
  const ranked = Object.keys(byKind).map((key) => ({ name: kindName[key], count: byKind[key] })).sort((a, b) => b.count - a.count);
  const contacted = results.filter((row) => row.hits > 0).length;
  const sceneName = { clash: "對劈", shear: "交錯", push: "互推", stack: "三劍疊" };

  console.log("武器互撞");
  console.log("種子 " + SEED + " · " + TRIALS + " 場 · 用時 " + report.elapsed + " 秒");
  console.log("場景係對劈、交錯、互推、三劍疊。速度最高 " + TUNE.maxSpeed + "。");
  console.log("實際打中對方 " + contacted + " / " + TRIALS + " 場。");
  console.log("");
  console.log("異常合計 " + issues.length + " / " + TRIALS);
  ranked.forEach((item) => console.log("  " + item.name + "  " + item.count));
  console.log("發生率最高：" + (ranked[0].count ? ranked[0].name + " " + ranked[0].count : "沒有"));
  console.log("");
  console.log("按場景");
  tally(results, (row) => row.kind).forEach((item) => {
    const failed = results.filter((row) => row.kind === item.name && bad(row)).length;
    console.log("  " + (sceneName[item.name] || item.name) + "  " + failed + " / " + item.count);
  });
  console.log("出事最多的武器組合");
  tally(issues, (row) => row.weapons.map(weaponName).slice().sort().join(" ＋ ")).slice(0, 8).forEach((item) => console.log("  " + item.name + "  " + item.count));
  if (!issues.length) console.log("  （沒有）");
  console.log("");
  console.log("樣本");
  issues.slice(0, 8).forEach((row) => {
    const tags = [row.clip && "穿模", row.sticky && "黏死", row.jitter && "抖動", row.explode && "崩潰", row.wall && "出界"].filter(Boolean).join("、");
    console.log("  " + (sceneName[row.kind] || row.kind) + " · " + TERRAINS[row.terrain].name + " · " + row.weapons.map(weaponName).join(" vs ") + " · 速度 " + row.speed.join("/") + " · " + tags);
  });
  if (!issues.length) console.log("  （沒有）");
  console.log("");
  console.log("修正建議");
  suggestions(issues).forEach((line) => console.log("  " + line));
}

if (require.main === module) {
  const report = runWeaponCombatTest();
  printCombatReport(report);
  process.exit(report.failed ? 1 : 0);
}

module.exports = { runWeaponCombatTest, printCombatReport };
