/**
 * Shared headless table for the three sword tests.
 * Each test builds its own random stream and does not run the others.
 */
const path = require("path");
const Matter = require(path.join(__dirname, "..", "matter.min.js"));

const { Engine, Bodies, Body, Composite, Sleeping } = Matter;

const VIEW_W = 1920;
const VIEW_H = 1080;
const RIM = 64;
const TRIALS = 1000;
const MAX_FRAMES = 540;
const SUBSTEPS = 3;
const STEP = 1000 / 60;
const SEED = 20261114;

const TUNE = {
  tableAir: 0.1,
  skimAir: 0.012,
  skimSpeed: 7.2,
  swordStatic: 1.05,
  swordFriction: 0.8,
  wallFriction: 0.4,
  restitution: 0.42,
  minSpeed: 2.2,
  maxSpeed: 18,
  spinCap: 0.16,
};

const RULES = {
  overlapMin: 850,
  stackH: 18,
  quietNeed: 18,
  stableNeed: 10,
  turnNeed: 36,
  zGravity: 0.52,
  stackAir: 0.015,
  pointsToGame: 3,
  gamesToMatch: 2,
};

const TERRAINS = {
  wood: { id: "wood", name: "木桌", baseFriction: 0.8, groundRestitution: 0.34 },
  terrazzo: { id: "terrazzo", name: "水磨石", baseFriction: 0.65, groundRestitution: 0.38 },
  concrete: { id: "concrete", name: "水泥地", baseFriction: 1.15, groundRestitution: 0.18 },
};
const WOOD = TERRAINS.wood;
const ZONE_MUL = { grip: 0.38, blade: 1, edge: 1.72 };
const ZONE_BOUNCE = { grip: 0.62, blade: 1, edge: 0.38 };

const WEAPONS = [
  { id: "guan", name: "關刀", mass: 16, friction: 0.96 },
  { id: "jian", name: "長劍", mass: 6.2, friction: 0.4 },
  { id: "ji", name: "方天畫戟", mass: 11, friction: 0.72 },
  { id: "dadao", name: "大刀", mass: 13.5, friction: 0.9 },
  { id: "snake", name: "蛇劍", mass: 7.4, friction: 0.48 },
  { id: "plastic", name: "膠劍", mass: 8, friction: 0.8 },
];

const WALL_CAT = 0x0001;
const SWORD_CAT = 0x0002;

function mulberry32(seed) {
  let state = seed >>> 0;
  return function rand() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createRng(seed) {
  const rand = mulberry32(seed);
  return {
    rand,
    pick(list) {
      return list[Math.floor(rand() * list.length)];
    },
    range(min, max) {
      return min + (max - min) * rand();
    },
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function terrainScale(terrain) {
  return terrain.baseFriction / WOOD.baseFriction;
}

function bounceScale(terrain) {
  return terrain.groundRestitution / WOOD.groundRestitution;
}

function glideAir(speed, terrain) {
  const scale = terrainScale(terrain);
  if (speed >= TUNE.skimSpeed) return TUNE.skimAir * scale;
  return TUNE.tableAir * scale;
}

function zoneMaterial(weapon, zone, terrain) {
  const scale = terrainScale(terrain);
  const friction = clamp(weapon.friction * ZONE_MUL[zone] * scale, 0.02, 1.35 * Math.max(1, scale));
  const restitution = clamp(TUNE.restitution * ZONE_BOUNCE[zone] * bounceScale(terrain), 0, 0.95);
  const frictionStatic = clamp(friction * (TUNE.swordStatic / TUNE.swordFriction), 0.05, 3.2);
  return { friction, restitution, frictionStatic };
}

function installZoneContacts() {
  const pairs = Matter.Pairs;
  if (!pairs || !pairs.update || pairs.update.__zone) return;
  const original = pairs.update;
  const update = function (list, collisions, timestamp) {
    const result = original(list, collisions, timestamp);
    const active = list && list.list;
    if (!active) return result;
    for (let i = 0; i < active.length; i += 1) {
      const pair = active[i];
      const collision = pair.collision;
      if (!collision) continue;
      const a = collision.bodyA;
      const b = collision.bodyB;
      pair.friction = Math.min(a.friction, b.friction);
      pair.frictionStatic = (a.frictionStatic + b.frictionStatic) / 2;
      pair.restitution = (a.restitution + b.restitution) / 2;
    }
    return result;
  };
  update.__zone = true;
  pairs.update = update;
}

function makeWalls(terrain) {
  const scale = terrainScale(terrain);
  const friction = TUNE.wallFriction * scale;
  const restitution = terrain.groundRestitution;
  const filter = { category: WALL_CAT, mask: SWORD_CAT };
  const spec = { isStatic: true, friction, frictionStatic: friction, restitution, label: "wall", collisionFilter: filter };
  return [
    Bodies.rectangle(RIM - 40, VIEW_H / 2, 80, VIEW_H + 80, spec),
    Bodies.rectangle(VIEW_W - RIM + 40, VIEW_H / 2, 80, VIEW_H + 80, spec),
    Bodies.rectangle(VIEW_W / 2, RIM - 40, VIEW_W + 80, 80, spec),
    Bodies.rectangle(VIEW_W / 2, VIEW_H - RIM + 40, VIEW_W + 80, 80, spec),
  ];
}

function makeSword(weapon, terrain, x, y, angle) {
  const specs = [
    { zone: "grip", x: -78, y: 0, w: 58, h: 16 },
    { zone: "blade", x: 18, y: 0, w: 128, h: 18 },
    { zone: "edge", x: 18, y: -9, w: 128, h: 6 },
  ];
  const parts = specs.map((part) => {
    const mat = zoneMaterial(weapon, part.zone, terrain);
    return Bodies.rectangle(part.x, part.y, part.w, part.h, {
      friction: mat.friction,
      frictionStatic: mat.frictionStatic,
      restitution: mat.restitution,
      density: 0.0032,
      slop: part.zone === "edge" ? 0.09 : 0.03,
      label: part.zone,
      collisionFilter: { category: SWORD_CAT, mask: WALL_CAT | SWORD_CAT },
    });
  });
  const blade = zoneMaterial(weapon, "blade", terrain);
  const body = Body.create({
    parts,
    friction: blade.friction,
    frictionStatic: blade.frictionStatic,
    restitution: blade.restitution,
    frictionAir: glideAir(0, terrain),
    label: "sword",
    sleepThreshold: 22,
  });
  Body.setMass(body, weapon.mass);
  const filter = { category: SWORD_CAT, mask: WALL_CAT | SWORD_CAT };
  body.collisionFilter.category = filter.category;
  body.collisionFilter.mask = filter.mask;
  body.parts.forEach((part) => {
    part.collisionFilter.category = filter.category;
    part.collisionFilter.mask = filter.mask;
  });
  Body.setPosition(body, { x, y });
  Body.setAngle(body, angle);
  body.plugin = { weapon: weapon.id };
  return body;
}

function setSwordMask(body, hitSwords) {
  const mask = hitSwords ? WALL_CAT | SWORD_CAT : WALL_CAT;
  body.collisionFilter.category = SWORD_CAT;
  body.collisionFilter.mask = mask;
  body.parts.forEach((part) => {
    part.collisionFilter.category = SWORD_CAT;
    part.collisionFilter.mask = mask;
  });
}

function speedOf(body) {
  return Math.hypot(body.velocity.x, body.velocity.y);
}

function childParts(body) {
  return body.parts && body.parts.length > 1 ? body.parts.slice(1) : [body];
}

function footprintOverlap(a, b) {
  let area = 0;
  for (const up of childParts(a)) {
    for (const low of childParts(b)) {
      const width = Math.min(up.bounds.max.x, low.bounds.max.x) - Math.max(up.bounds.min.x, low.bounds.min.x);
      const height = Math.min(up.bounds.max.y, low.bounds.max.y) - Math.max(up.bounds.min.y, low.bounds.min.y);
      if (width > 0 && height > 0) area += width * height;
    }
  }
  return area;
}

function clipConvex(subject, edgeA, edgeB) {
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
        subject = clipConvex(subject, clip[i], clip[(i + 1) % clip.length]);
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

function weaponName(id) {
  const found = WEAPONS.find((weapon) => weapon.id === id);
  return found ? found.name : id;
}

function createEngine() {
  const engine = Engine.create({ enableSleeping: true, positionIterations: 10, velocityIterations: 8 });
  engine.gravity.x = 0;
  engine.gravity.y = 0;
  engine.gravity.scale = 0;
  return engine;
}

module.exports = {
  Matter,
  Engine,
  Bodies,
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
  RULES,
  TERRAINS,
  WEAPONS,
  WALL_CAT,
  SWORD_CAT,
  createRng,
  clamp,
  terrainScale,
  glideAir,
  installZoneContacts,
  makeWalls,
  makeSword,
  setSwordMask,
  speedOf,
  childParts,
  footprintOverlap,
  solidOverlap,
  weaponName,
  createEngine,
};
