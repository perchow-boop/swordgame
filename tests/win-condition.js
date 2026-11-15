/**
 * Stack picture versus the win judge. Run: node tests/win-condition.js
 */
const {
  Engine,
  Body,
  Composite,
  Sleeping,
  TRIALS,
  SUBSTEPS,
  STEP,
  SEED,
  TERRAINS,
  WEAPONS,
  RULES,
  createRng,
  installZoneContacts,
  makeWalls,
  makeSword,
  setSwordMask,
  speedOf,
  footprintOverlap,
  weaponName,
  createEngine,
} = require("./harness");

const LIFT = RULES.stackH * (0.42 + 0.75 * 0.7);
const HOLD = RULES.quietNeed + RULES.stableNeed;
const WOOD = TERRAINS.wood;

function fresh(name) {
  return {
    name,
    score: 0,
    points: 0,
    altitude: 0,
    zVel: 0,
    airborne: false,
    landedOn: null,
    body: null,
    weapon: null,
  };
}

function award(state, winner) {
  const loser = winner === state.p1 ? state.p2 : state.p1;
  winner.points += 1;
  const tookGame = winner.points >= RULES.pointsToGame;
  if (tookGame) {
    winner.score += 1;
    state.p1.points = 0;
    state.p2.points = 0;
  }
  state.matchOver = winner.score >= RULES.gamesToMatch;
  state.phase = "result";
  state.winner = winner;
  state.loser = loser;
  state.tookGame = tookGame;
}

function probeSeries() {
  const state = { p1: fresh("玩家一"), p2: fresh("玩家二"), matchOver: false, phase: "aim" };
  for (let i = 0; i < 3; i += 1) award(state, state.p1);
  const game = state.p1.score === 1 && state.p2.score === 0 && state.p1.points === 0 && state.p2.points === 0 && !state.matchOver;
  for (let i = 0; i < 3; i += 1) award(state, state.p1);
  const match = state.p1.score === 2 && state.p1.points === 0 && state.p2.points === 0 && state.matchOver;
  return game && match;
}

function restsOn(upper, lower) {
  if (upper.landedOn !== lower) return false;
  if (upper.altitude < RULES.stackH * 0.75) return false;
  if (Math.abs(upper.zVel) > 0.3) return false;
  return footprintOverlap(upper.body, lower.body) > RULES.overlapMin;
}

function evaluate(p1, p2) {
  const aOnB = restsOn(p1, p2);
  const bOnA = restsOn(p2, p1);
  if (aOnB && bOnA) return "tie";
  if (aOnB) return p1;
  if (bOnA) return p2;
  return null;
}

function canvasStacked(upper, lower) {
  if (!upper.body || !lower.body) return false;
  const overlap = footprintOverlap(upper.body, lower.body);
  const still = speedOf(upper.body) < 0.7 && speedOf(lower.body) < 0.7 && Math.abs(upper.zVel) <= 0.3;
  return overlap > RULES.overlapMin && upper.altitude >= RULES.stackH * 0.75 && still;
}

function refreshMask(player) {
  const hitSwords = !(player.airborne || player.altitude > 1 || player.landedOn);
  setSwordMask(player.body, hitSwords);
}

function stepAltitude(p1, p2) {
  const order = [p1, p2].slice().sort((a, b) => a.altitude - b.altitude);
  for (const player of order) {
    const other = player === p1 ? p2 : p1;
    player.zVel -= RULES.zGravity;
    player.altitude += player.zVel;
    const covering = footprintOverlap(player.body, other.body) > RULES.overlapMin;
    const fallingOnto = player.airborne && covering && player.zVel <= 0 && player.altitude <= other.altitude + RULES.stackH;
    if (fallingOnto) {
      player.altitude = other.altitude + LIFT;
      player.zVel = 0;
      player.airborne = false;
      player.landedOn = other;
    } else if (player.landedOn && covering) {
      player.altitude = player.landedOn.altitude + LIFT;
      player.zVel = 0;
      player.airborne = false;
    } else if (player.altitude <= 0) {
      player.altitude = 0;
      player.zVel = 0;
      player.airborne = false;
      player.landedOn = null;
    } else if (!covering) {
      player.landedOn = null;
    }
    player.body.frictionAir = player.landedOn ? RULES.stackAir : 0.1;
    if (player.altitude > 1) Sleeping.set(player.body, false);
    refreshMask(player);
  }
}

function claimSettledCover(state) {
  const upper = state.current;
  const lower = upper === state.p1 ? state.p2 : state.p1;
  if (!upper || !upper.body || !lower.body) return;
  if (upper.airborne || lower.airborne) return;
  if (upper.altitude > 1 || lower.altitude > 1) return;
  if (footprintOverlap(upper.body, lower.body) <= RULES.overlapMin) return;
  upper.landedOn = lower;
  upper.altitude = lower.altitude + LIFT;
  upper.zVel = 0;
  upper.airborne = false;
  upper.markZ = upper.altitude;
}

function noteMotion(state) {
  const players = [state.p1, state.p2];
  let moving = false;
  for (const player of players) {
    const body = player.body;
    if (player.markX === undefined) {
      player.markX = body.position.x;
      player.markY = body.position.y;
      player.markA = body.angle;
      player.markZ = player.altitude;
      moving = true;
      continue;
    }
    const dx = body.position.x - player.markX;
    const dy = body.position.y - player.markY;
    const da = Math.atan2(Math.sin(body.angle - player.markA), Math.cos(body.angle - player.markA));
    const dz = player.altitude - (player.markZ || 0);
    if (Math.hypot(dx, dy) > 0.7 || Math.abs(da) > 0.025 || Math.abs(dz) > 0.35 || Math.abs(player.zVel) > 0.25) moving = true;
    player.markX = body.position.x;
    player.markY = body.position.y;
    player.markA = body.angle;
    player.markZ = player.altitude;
  }
  if (moving) {
    state.quiet = 0;
    state.stableVerdict = null;
    state.stableCount = 0;
    return;
  }
  state.quiet += 1;
  if (state.quiet < RULES.quietNeed) return;
  if (!state.p1.landedOn && !state.p2.landedOn) claimSettledCover(state);
  const verdict = evaluate(state.p1, state.p2);
  if (verdict && verdict !== "tie") {
    if (state.stableVerdict === verdict) state.stableCount += 1;
    else {
      state.stableVerdict = verdict;
      state.stableCount = 1;
    }
    if (state.stableCount >= RULES.stableNeed) award(state, verdict);
    return;
  }
  state.stableVerdict = null;
  state.stableCount = 0;
}

function placeOverlap(lower, upper, minArea, maxArea) {
  let area = 0;
  for (let step = 0; step < 90; step += 1) {
    Body.setPosition(upper, { x: lower.position.x + step * 4, y: lower.position.y });
    Body.setAngle(upper, lower.angle + 0.08);
    Body.setVelocity(upper, { x: 0, y: 0 });
    Body.setAngularVelocity(upper, 0);
    area = footprintOverlap(upper, lower);
    if (area <= maxArea && area >= minArea) return area;
    if (area < minArea) break;
  }
  return area;
}

function poseOf(rng) {
  const roll = rng.rand();
  if (roll < 0.45) return "settled";
  if (roll < 0.6) return "drop";
  if (roll < 0.72) return "short";
  if (roll < 0.84) return "low";
  if (roll < 0.94) return "sliding";
  return "tie";
}

function judgeOnce(kind, rng) {
  const engine = createEngine();
  const lowerWeapon = rng.pick(WEAPONS);
  let upperWeapon = rng.pick(WEAPONS);
  if (upperWeapon.id === lowerWeapon.id) upperWeapon = WEAPONS[(WEAPONS.indexOf(lowerWeapon) + 1) % WEAPONS.length];
  const lowerBody = makeSword(lowerWeapon, WOOD, 900, 540, rng.range(-0.4, 0.4));
  const upperBody = makeSword(upperWeapon, WOOD, 900, 540, 0);
  const wantShort = kind === "short";
  const overlap = placeOverlap(lowerBody, upperBody, wantShort ? 120 : 1400, wantShort ? 700 : 20000);
  Composite.add(engine.world, makeWalls(WOOD).concat([lowerBody, upperBody]));

  const p1 = fresh("玩家一");
  const p2 = fresh("玩家二");
  p1.weapon = upperWeapon;
  p2.weapon = lowerWeapon;
  p1.body = upperBody;
  p2.body = lowerBody;
  p2.altitude = 0;
  p2.zVel = 0;
  if (kind === "drop") {
    p1.airborne = true;
    p1.altitude = RULES.stackH + 22;
    p1.zVel = 0;
  } else if (kind === "low") {
    p1.landedOn = null;
    p1.altitude = 0;
    p1.zVel = 0;
    p1.airborne = false;
  } else if (kind === "tie") {
    p1.landedOn = p2;
    p2.landedOn = p1;
    p1.altitude = LIFT;
    p2.altitude = LIFT;
    p1.zVel = 0;
    p2.zVel = 0;
  } else {
    p1.landedOn = p2;
    p1.altitude = LIFT;
    p1.zVel = 0;
  }
  refreshMask(p1);
  refreshMask(p2);

  const state = {
    p1,
    p2,
    current: p1,
    phase: "aim",
    matchOver: false,
    quiet: 0,
    stableVerdict: null,
    stableCount: 0,
  };
  let pictured = 0;
  let maxPictured = 0;
  const expectWin = kind === "settled" || kind === "drop" || kind === "low";
  for (let frame = 0; frame < 160 && state.phase !== "result"; frame += 1) {
    if (kind === "sliding") {
      Body.setVelocity(p1.body, { x: 2.4, y: 0.2 });
      Sleeping.set(p1.body, false);
    }
    if (kind !== "low") {
      for (let step = 0; step < SUBSTEPS; step += 1) Engine.update(engine, STEP / SUBSTEPS);
    }
    stepAltitude(p1, p2);
    noteMotion(state);
    const shown = canvasStacked(p1, p2) || canvasStacked(p2, p1);
    pictured = shown ? pictured + 1 : 0;
    maxPictured = Math.max(maxPictured, pictured);
  }
  const awarded = state.phase === "result";
  const winnerIsUpper = state.winner === p1;
  return {
    kind,
    weapons: [upperWeapon.id, lowerWeapon.id],
    overlap: Math.round(overlap),
    awarded,
    winnerIsUpper,
    points: p1.points,
    loserPoints: p2.points,
    maxPictured,
    shownNotJudged: expectWin && !awarded && maxPictured >= HOLD,
    slipped: expectWin && !awarded && maxPictured < HOLD,
    falseWin: !expectWin && kind !== "tie" && awarded,
    wrongWinner: expectWin && awarded && !winnerIsUpper,
    tieScored: kind === "tie" && awarded,
    scoreMiss: expectWin && awarded && winnerIsUpper && p1.points !== 1,
  };
}

function runWinConditionTest() {
  installZoneContacts();
  const rng = createRng(SEED + 3);
  const started = Date.now();
  const seriesOk = probeSeries();
  const results = [];
  for (let i = 0; i < TRIALS; i += 1) {
    results.push(judgeOnce(poseOf(rng), rng));
    if ((i + 1) % 250 === 0) process.stderr.write("勝負 " + (i + 1) + " / " + TRIALS + "\n");
  }
  const count = (key) => results.filter((row) => row[key]).length;
  const bugs = {
    shownNotJudged: count("shownNotJudged"),
    falseWin: count("falseWin"),
    wrongWinner: count("wrongWinner"),
    tieScored: count("tieScored"),
    scoreMiss: count("scoreMiss"),
    slipped: count("slipped"),
  };
  const logic = bugs.shownNotJudged + bugs.falseWin + bugs.wrongWinner + bugs.tieScored + bugs.scoreMiss + (seriesOk ? 0 : 1);
  return {
    elapsed: ((Date.now() - started) / 1000).toFixed(1),
    results,
    bugs,
    seriesOk,
    failed: logic > 0 || bugs.slipped > 0,
  };
}

function printWinReport(report) {
  const results = report.results;
  const bugs = report.bugs;
  const poseName = { settled: "疊穩", drop: "落下疊", short: "重疊唔夠", low: "貼枱重疊", sliding: "未停", tie: "打和" };
  console.log("疊羅漢勝負判定");
  console.log("種子 " + (SEED + 3) + " · " + TRIALS + " 場 · 用時 " + report.elapsed + " 秒");
  console.log("靜止 " + RULES.quietNeed + " 帧，再連續 " + RULES.stableNeed + " 帧同一判定，先至算贏。重疊要大過 " + RULES.overlapMin + "，高度要到 " + (RULES.stackH * 0.75).toFixed(1) + "。");
  console.log("");
  console.log("三局兩勝腳本：" + (report.seriesOk ? "玩家一連贏六舖，局數 2、呢局 0、贏晒。通過。" : "局數冇跟三舖一局、兩局結束。"));
  console.log("");
  console.log("邏輯");
  console.log("  畫面疊好但冇宣判  " + bugs.shownNotJudged);
  console.log("  未疊到卻當贏  " + bugs.falseWin);
  console.log("  贏咗下面嗰把  " + bugs.wrongWinner);
  console.log("  打和卻加分  " + bugs.tieScored);
  console.log("  宣判咗但分數冇加  " + bugs.scoreMiss);
  console.log("穩定");
  console.log("  疊好之後未夠靜止窗就散  " + bugs.slipped);
  console.log("");
  console.log("按擺法");
  Object.keys(poseName).forEach((kind) => {
    const group = results.filter((row) => row.kind === kind);
    const badRows = group.filter((row) => row.shownNotJudged || row.falseWin || row.wrongWinner || row.tieScored || row.scoreMiss || row.slipped);
    console.log("  " + poseName[kind] + "  " + badRows.length + " / " + group.length);
  });
  console.log("");
  console.log("樣本");
  const samples = results.filter((row) => row.shownNotJudged || row.falseWin || row.wrongWinner || row.tieScored || row.scoreMiss || row.slipped).slice(0, 8);
  samples.forEach((row) => {
    const tags = [row.shownNotJudged && "畫面成功但判定失敗", row.falseWin && "誤判贏", row.wrongWinner && "贏錯人", row.tieScored && "打和加分", row.scoreMiss && "冇加分", row.slipped && "未穩"].filter(Boolean).join("、");
    console.log("  " + poseName[row.kind] + " · " + row.weapons.map(weaponName).join(" 疊 ") + " · 重疊 " + row.overlap + " · 畫面連續 " + row.maxPictured + " 帧 · " + tags);
  });
  if (!samples.length) console.log("  （沒有）");
  console.log("");
  console.log("修正建議");
  if (bugs.shownNotJudged) {
    console.log("  restsOn 要求 upper.landedOn 一定係下面嗰把。畫面重疊大過 overlapMin、高度到 stackH * 0.75、兩邊速度低過 0.7，仍然可以因為 landedOn 空咗而唔宣判。stepAltitude 喺 covering 而且 zVel <= 0 時要補返 landedOn。");
  }
  if (bugs.falseWin || bugs.wrongWinner) {
    console.log("  evaluate 喺高度低過 stackH * 0.75、重疊細過 850，或者劍仲郁緊時唔可以返回贏家。noteMotion 要等 quietNeed 同 stableNeed 兩關都過。");
  }
  if (bugs.tieScored) {
    console.log("  兩把同時 restsOn 對方要返回 tie，winRound 唔可以加分。");
  }
  if (bugs.scoreMiss || !report.seriesOk) {
    console.log("  贏一舖 points += 1。到 3 先 score += 1，兩邊 points 歸 0。score 到 2 先 matchOver。呢局分數唔好同局數撈埋。");
  }
  if (bugs.slipped) {
    console.log("  疊住之後 setSwordMask(player, false)，劍同劍唔好再撞。stackAir 維持 0.015。如果重疊喺靜止窗之前跌穿 " + RULES.overlapMin + "，就當未疊穩，唔好宣判。");
  }
  if (!report.failed) {
    console.log("  畫面連續疊穩超過 " + HOLD + " 帧的場，包括貼枱交叉但重疊夠，判定都有加一舖。重疊唔夠、未停、打和都冇加分。三局兩勝的六舖腳本同 main.js 一致。");
  }
}

if (require.main === module) {
  const report = runWinConditionTest();
  printWinReport(report);
  process.exit(report.failed ? 1 : 0);
}

module.exports = { runWinConditionTest, printWinReport };
