/**
 * Headless tests stay in three scripts. This file only picks one.
 *   node physics-stress.js terrain
 *   node physics-stress.js combat
 *   node physics-stress.js win
 */
const arg = process.argv[2];
const table = {
  terrain: "./tests/terrain-physics.js",
  combat: "./tests/weapon-combat.js",
  win: "./tests/win-condition.js",
};

if (!table[arg]) {
  console.log("三個測試分開跑：");
  console.log("  node physics-stress.js terrain    場地摩擦同滑行，1000 場");
  console.log("  node physics-stress.js combat     武器互撞，1000 場");
  console.log("  node physics-stress.js win        疊羅漢勝負判定，1000 場");
  process.exit(arg ? 1 : 0);
}

const suite = require(table[arg]);
const runners = {
  terrain: ["runTerrainPhysicsTest", "printTerrainReport"],
  combat: ["runWeaponCombatTest", "printCombatReport"],
  win: ["runWinConditionTest", "printWinReport"],
};
const [runName, printName] = runners[arg];
const report = suite[runName]();
suite[printName](report);
process.exit(report.failed ? 1 : 0);
