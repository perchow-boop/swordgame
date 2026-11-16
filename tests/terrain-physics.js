/**
 * Floor friction and slide. Run: node tests/terrain-physics.js
 */
const {
  Engine,
  Body,
  Composite,
  Sleeping,
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

function slideOnce(terrain, rng) {
  const weapon = rng.pick(WEAPONS);
  const engine = createEngine();
  const body = makeSword(weapon, terrain, 280, rng.range(420, 660), rng.range(-0.2, 0.2));
  const speed = rng.range(6, TUNE.maxSpeed);
  const heading = rng.range(-0.35, 0.35);
  Body.setVelocity(body, { x: Math.cos(heading) * speed, y: Math.sin(heading) * speed });
  Body.setAngularVelocity(body, rng.range(-0.2, 0.2));
  Sleeping.set(body, false);
  Composite.add(engine.world, makeWalls(terrain).concat(body));

  let path = 0;
  let quiet = 0;
  let frame = 0;
  let blowup = false;
  let previous = { x: body.position.x, y: body.position.y };
  for (frame = 0; frame < MAX_FRAMES; frame += 1) {
    body.frictionAir = glideAir(speedOf(body), terrain);
    for (let step = 0; step < SUBSTEPS; step += 1) Engine.update(engine, STEP / SUBSTEPS);
    const velocity = body.velocity;
    if (!Number.isFinite(velocity.x) || !Number.isFinite(velocity.y) || speedOf(body) > TUNE.maxSpeed * 4) {
      blowup = true;
      break;
    }
    path += Math.hypot(body.position.x - previous.x, body.position.y - previous.y);
    previous = { x: body.position.x, y: body.position.y };
    const calm = speedOf(body) < 0.08 && Math.abs(body.angularVelocity) < 0.01;
    quiet = calm ? quiet + 1 : 0;
    if (quiet > 24 && frame > 30) break;
  }
  const endSpeed = speedOf(body);
  return {
    terrain: terrain.id,
    weapon: weapon.id,
    speed: Number(speed.toFixed(2)),
    frames: frame + 1,
    path: Number(path.toFixed(1)),
    endSpeed: Number((Number.isFinite(endSpeed) ? endSpeed : 9999).toFixed(3)),
    runaway: !blowup && frame + 1 >= MAX_FRAMES && endSpeed > 0.45,
    glued: !blowup && speed > 8 && path < 25,
    blowup,
  };
}

function mean(rows, key) {
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
}

function runTerrainPhysicsTest() {
  installZoneContacts();
  const rng = createRng(SEED);
  const order = ["terrazzo", "concrete", "wood"];
  const started = Date.now();
  const results = [];
  for (let i = 0; i < TRIALS; i += 1) {
    results.push(slideOnce(TERRAINS[order[i % order.length]], rng));
    if ((i + 1) % 250 === 0) process.stderr.write("場地 " + (i + 1) + " / " + TRIALS + "\n");
  }
  const issues = results.filter((row) => row.runaway || row.glued || row.blowup);
  const byTerrain = {};
  order.forEach((id) => {
    const group = results.filter((row) => row.terrain === id);
    byTerrain[id] = {
      count: group.length,
      failed: group.filter((row) => row.runaway || row.glued || row.blowup).length,
      frames: Math.round(mean(group, "frames")),
      path: Math.round(mean(group, "path")),
    };
  });
  const stoneOrder = byTerrain.concrete.path < byTerrain.terrazzo.path;
  return {
    elapsed: ((Date.now() - started) / 1000).toFixed(1),
    results,
    issues,
    byTerrain,
    stoneOrder,
    failed: issues.length > 0 || !stoneOrder,
  };
}

function printTerrainReport(report) {
  const kindName = { runaway: "停唔低", glued: "推唔郁", blowup: "速度崩潰" };
  console.log("場地摩擦同滑行");
  console.log("種子 " + SEED + " · " + TRIALS + " 場 · 用時 " + report.elapsed + " 秒");
  console.log("每場一把劍，沿枱面推出。場地輪換水磨石、水泥地、木桌。");
  console.log("");
  console.log("異常合計 " + report.issues.length + " / " + TRIALS);
  Object.keys(kindName).forEach((key) => {
    console.log("  " + kindName[key] + "  " + report.results.filter((row) => row[key]).length);
  });
  console.log("");
  console.log("按場地（異常 / 場數，平均幾多帧先停，平均滑行距離）");
  Object.keys(report.byTerrain).forEach((id) => {
    const row = report.byTerrain[id];
    console.log("  " + TERRAINS[id].name + "  " + row.failed + " / " + row.count + "  · 平均 " + row.frames + " 帧 · " + row.path + " px");
  });
  const stone = report.stoneOrder ? "水泥地滑行短過水磨石，摩擦排序符合設定。" : "水泥地冇短過水磨石，場地摩擦縮放可能失效。";
  console.log(stone);
  console.log("");
  console.log("樣本");
  report.issues.slice(0, 8).forEach((row) => {
    const tags = [row.runaway && "停唔低", row.glued && "推唔郁", row.blowup && "崩潰"].filter(Boolean).join("、");
    console.log("  " + TERRAINS[row.terrain].name + " · " + weaponName(row.weapon) + " · 初速 " + row.speed + " · 滑 " + row.path + " px · " + tags);
  });
  if (!report.issues.length) console.log("  （沒有）");
  console.log("");
  console.log("修正建議");
  if (report.issues.some((row) => row.runaway) || !report.stoneOrder) {
    console.log("  水磨石 baseFriction 0.65、水泥地 1.15。glideAir 的貼地分支要乘 terrainFrictionScale()，水磨石先會滑得更遠。若 540 帧後速度仍高過 0.45，把 stampZonePair 的 pair.restitution 上限夾到 0.62。");
  }
  if (report.issues.some((row) => row.glued)) {
    console.log("  初速高過 8 但幾乎冇郁，摩擦上限 1.35 乘場地縮放可能夾得太緊。水泥地縮放係 1.4375，上限要跟住放大，唔好夾死喺 1.35。");
  }
  if (report.issues.some((row) => row.blowup)) {
    console.log("  滑行途中速度超過 maxSpeed * 4。撞牆之後把速度夾回 tune.maxSpeed。");
  }
  if (!report.failed) {
    console.log("  三個場地都喺 9 秒內停低。水泥地平均滑行短過水磨石，木桌喺中間。而家的 baseFriction 同 groundRestitution 夠用。");
  }
}

if (require.main === module) {
  const report = runTerrainPhysicsTest();
  printTerrainReport(report);
  process.exit(report.failed ? 1 : 0);
}

module.exports = { runTerrainPhysicsTest, printTerrainReport };
