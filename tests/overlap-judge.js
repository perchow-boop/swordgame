/**
 * Real blade overlap versus bounding-box overlap.
 * Run: node tests/overlap-judge.js
 */
const { makeSword, solidOverlap, footprintOverlap, TERRAINS } = require("./harness");

const wood = TERRAINS.wood;
const weapon = { id: "jian", name: "長劍", mass: 6.2, friction: 0.4 };
const NEED = 850 * 0.045;

function pair(ax, ay, aa, bx, by, ba) {
  const a = makeSword(weapon, wood, ax, ay, aa);
  const b = makeSword(weapon, wood, bx, by, ba);
  return { solid: solidOverlap(a, b), box: footprintOverlap(a, b) };
}

function check(name, pose, expectCover) {
  const covered = pose.solid > NEED;
  const ok = covered === expectCover;
  console.log((ok ? "過" : "唔過") + "  " + name + "  劍身 " + Math.round(pose.solid) + "  外框 " + Math.round(pose.box) + "  門檻 " + Math.round(NEED));
  return ok;
}

const cases = [
  check("完全疊住", pair(0, 0, 0, 0, 0, 0), true),
  check("隔開", pair(0, 0, 0, 400, 0, 0), false),
  check("平行擦身", pair(0, 0, 0, 0, 36, 0), false),
  check("斜向近放，外框交疊", pair(0, 0, 0.7, 0, 34, 0.7), false),
  check("正面交錯", pair(0, 0, 0.2, 0, 0, 1.2), true),
  check("淺角交錯", pair(0, 0, 0, 0, 0, 0.35), true),
];

const missed = cases.filter((ok) => !ok).length;
if (missed) {
  console.log("碰撞判定 " + missed + " 項唔啱");
  process.exit(1);
}
console.log("碰撞判定 " + cases.length + " 項都啱。外框交疊、劍身冇交，唔會宣判。");
