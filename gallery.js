(function () {
  const COLLECTION_KEY = "sword-collection-v1";
  const STARTER = ["guan", "jian", "dadao"];
  const IMAGE_FALLBACK = { ji: "weaponsDatabase/fangtian_ji.webp" };

  const wall = document.getElementById("gallery-wall");
  const count = document.getElementById("gallery-count");
  const inspector = document.getElementById("inspector");
  const figure = document.getElementById("inspect-figure");
  const photo = document.getElementById("inspect-photo");
  const mask = document.getElementById("inspect-mask");
  const fallback = document.getElementById("inspect-fallback");
  const nameEl = document.getElementById("inspect-name");
  const stateEl = document.getElementById("inspect-state");
  const closeBtn = document.getElementById("inspect-close");
  const canvas = document.getElementById("pedestal");
  const ctx = canvas.getContext("2d");
  const slab = document.getElementById("inspect-slab");
  const slabCtx = slab.getContext("2d");
  const faceCanvas = document.createElement("canvas");
  const faceCtx = faceCanvas.getContext("2d");
  let contactRatio = 0.62;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const unlocks = loadUnlocks();
  const weapons = (window.WeaponStore ? WeaponStore.load() : []).map(entry);
  let openId = "";
  let returnFocus = null;
  let yaw = 18;
  let dragging = false;
  let lastX = 0;
  let resumeAt = 0;
  let raf = 0;
  let lastTime = 0;

  const bits = Array.from({ length: 26 }, (_, index) => ({
    a: (index / 26) * Math.PI * 2,
    spread: 0.62 + (index % 5) * 0.08,
    speed: 0.00055 + (index % 4) * 0.00022,
    size: index % 6 === 0 ? 2.4 : 1.3,
    gold: index % 3 === 0,
  }));

  function loadUnlocks() {
    try {
      const saved = JSON.parse(localStorage.getItem(COLLECTION_KEY) || "null");
      if (Array.isArray(saved)) return new Set(saved.filter((id) => typeof id === "string"));
    } catch (error) {
      /* keep the starter set */
    }
    localStorage.setItem(COLLECTION_KEY, JSON.stringify(STARTER));
    return new Set(STARTER);
  }

  function entry(weapon) {
    const custom = Boolean(weapon.imageData);
    return {
      id: weapon.id,
      name: weapon.name || "未命名",
      trait: weapon.trait || "",
      src: weapon.imageData || weapon.image || "",
      unlocked: custom || unlocks.has(weapon.id),
      artOk: false,
    };
  }

  function paintWall() {
    const owned = weapons.filter((weapon) => weapon.unlocked && weapon.artOk).length;
    count.textContent = "已入手 " + owned + " / " + weapons.length;
    wall.replaceChildren();
    weapons.forEach((weapon) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "relic " + (weapon.unlocked ? "unlocked" : "locked");
      button.dataset.id = weapon.id;
      button.setAttribute("aria-label", weapon.name + (weapon.unlocked ? "，已入手" : "，未入手"));

      const art = document.createElement("span");
      art.className = "relic-art";
      const image = document.createElement("img");
      image.alt = "";
      const silhouette = document.createElement("span");
      silhouette.className = "silhouette";
      const blade = document.createElement("span");
      blade.className = "fallback-blade";
      art.append(image, silhouette, blade);

      const title = document.createElement("span");
      title.className = "relic-name";
      title.textContent = weapon.name;
      const state = document.createElement("span");
      state.className = "relic-state";
      state.textContent = weapon.unlocked ? "已入手" : "未入手";
      button.append(art, title, state);
      button.addEventListener("click", () => openInspect(weapon, button));
      wall.appendChild(button);
      loadArt(weapon, image, silhouette, button);
    });
  }

  function loadArt(weapon, image, silhouette, button) {
    const probe = new Image();
    const sources = [weapon.src, IMAGE_FALLBACK[weapon.id]].filter(Boolean);
    let index = 0;
    probe.onload = () => {
      weapon.src = probe.src;
      weapon.image = probe;
      weapon.artOk = true;
      image.src = probe.src;
      silhouette.style.setProperty("--src", "url(\"" + probe.src.replace(/"/g, "\\\"") + "\")");
      image.hidden = !weapon.unlocked;
      silhouette.hidden = weapon.unlocked;
      if (weapon.unlocked) {
        const owned = weapons.filter((item) => item.unlocked && item.artOk).length;
        count.textContent = "已入手 " + owned + " / " + weapons.length;
      }
    };
    probe.onerror = () => {
      index += 1;
      if (index < sources.length) {
        probe.src = sources[index];
        return;
      }
      weapon.artOk = false;
      button.classList.add("no-art");
      image.hidden = true;
      silhouette.hidden = true;
    };
    if (weapon.unlocked) silhouette.hidden = true;
    else image.hidden = true;
    if (sources.length) probe.src = sources[0];
    else probe.onerror();
  }

  function showFigure(weapon) {
    const showPhoto = weapon.unlocked && weapon.artOk;
    const showMask = !showPhoto && weapon.artOk;
    photo.hidden = !showPhoto;
    mask.hidden = !showMask;
    fallback.hidden = showPhoto || showMask;
    if (showPhoto) photo.src = weapon.src;
    if (showMask) mask.style.setProperty("--src", "url(\"" + weapon.src.replace(/"/g, "\\\"") + "\")");
    photo.alt = weapon.name;
    nameEl.textContent = weapon.name;
    stateEl.textContent = showPhoto ? (weapon.trait || "已入手") : "未入手。金屬剪影，入手之後先見到原色。";
    figure.classList.toggle("locked", !showPhoto);
  }

  function openInspect(weapon, button) {
    openId = weapon.id;
    returnFocus = button;
    yaw = 18;
    showFigure(weapon);
    document.body.classList.add("is-inspect");
    inspector.setAttribute("aria-hidden", "false");
    closeBtn.focus();
    requestAnimationFrame(() => {
      resizeSurfaces();
      drawSlab();
      alignPedestal();
    });
    startLoop();
  }

  function closeInspect() {
    if (!openId) return;
    openId = "";
    document.body.classList.remove("is-inspect");
    inspector.setAttribute("aria-hidden", "true");
    stopLoop();
    if (returnFocus) returnFocus.focus();
  }

  function resizeSurfaces() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ped = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(ped.width * dpr));
    canvas.height = Math.max(1, Math.round((ped.width * 460) / 800 * dpr));
    const box = figure.getBoundingClientRect();
    const width = Math.max(1, Math.round(box.width * dpr));
    const height = Math.max(1, Math.round(box.height * dpr));
    if (slab.width !== width || slab.height !== height) {
      slab.width = width;
      slab.height = height;
      faceCanvas.width = width;
      faceCanvas.height = height;
    }
  }

  function traceEdges(image) {
    const w = 240;
    const h = Math.max(1, Math.round(image.naturalHeight * (w / image.naturalWidth)));
    const sample = document.createElement("canvas");
    sample.width = w;
    sample.height = h;
    const g = sample.getContext("2d", { willReadFrequently: true });
    g.drawImage(image, 0, 0, w, h);
    const data = g.getImageData(0, 0, w, h).data;
    const rows = [];
    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;
    for (let y = 0; y < h; y++) {
      let left = -1;
      let right = -1;
      for (let x = 0; x < w; x++) {
        const index = (y * w + x) * 4;
        if (data[index + 3] <= 28) continue;
        if (left < 0) left = x;
        right = x;
        if ((x + y) % 11 === 0) {
          red += data[index];
          green += data[index + 1];
          blue += data[index + 2];
          count += 1;
        }
      }
      if (left >= 0) rows.push({ y: (y + 0.5) / h, left: left / w, right: (right + 1) / w });
    }
    const tone = count
      ? { r: red / count, g: green / count, b: blue / count }
      : { r: 150, g: 150, b: 156 };
    return { rows, h, tone };
  }

  function mixTone(tone, spec) {
    const lit = Math.max(0, Math.min(1, spec));
    const shade = 0.22 + lit * 0.18;
    const r = Math.round(tone.r * shade + 255 * lit * 0.78);
    const g = Math.round(tone.g * shade + 248 * lit * 0.72);
    const b = Math.round(tone.b * shade + 230 * lit * 0.62);
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  function paintRim(rows, sampleH, centerX, top, drawW, drawH, face, shift, depthTone, specTone) {
    if (!rows.length) return;
    const band = drawH / Math.max(1, sampleH) + 0.8;
    rows.forEach((row) => {
      const y = top + row.y * drawH - band * 0.5;
      const fl = centerX + (row.left - 0.5) * drawW * face;
      const fr = centerX + (row.right - 0.5) * drawW * face;
      const faceL = Math.min(fl, fr);
      const faceR = Math.max(fl, fr);
      const spanL = Math.min(faceL, fl - shift, fr - shift);
      const spanR = Math.max(faceR, fl - shift, fr - shift);
      if (spanL < faceL - 0.4) fillBevel(spanL, faceL, y, band, true);
      if (spanR > faceR + 0.4) fillBevel(faceR, spanR, y, band, false);
    });

    function fillBevel(x0, x1, y, band, outerIsLeft) {
      const width = x1 - x0;
      const outer = width * 0.46;
      slabCtx.fillStyle = depthTone;
      slabCtx.fillRect(x0, y, width, band);
      slabCtx.fillStyle = specTone;
      slabCtx.fillRect(outerIsLeft ? x0 : x1 - outer, y, outer, Math.max(1, band * 0.72));
    }
  }

  function frameOf(edges) {
    let minX = 1;
    let maxX = 0;
    let minY = 1;
    let maxY = 0;
    edges.rows.forEach((row) => {
      minX = Math.min(minX, row.left);
      maxX = Math.max(maxX, row.right);
      minY = Math.min(minY, row.y);
      maxY = Math.max(maxY, row.y);
    });
    if (maxX <= minX || maxY <= minY) return null;
    return { minX, maxX, minY, maxY };
  }

  function blitFace(image, src, centerX, centerY, drawW, drawH, face, shiftX, shiftY, mode, spec) {
    const g = faceCtx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, faceCanvas.width, faceCanvas.height);
    g.translate(centerX + shiftX, centerY + shiftY);
    g.scale(face, 1);
    g.drawImage(image, src.x, src.y, src.w, src.h, -drawW / 2, -drawH / 2, drawW, drawH);
    if (mode !== "color") {
      g.globalCompositeOperation = "source-in";
      if (mode === "dark") g.fillStyle = "rgba(0, 0, 0, 0.62)";
      else if (mode === "metal") {
        const metal = g.createLinearGradient(-drawW / 2, -drawH / 2, drawW / 2, drawH / 2);
        metal.addColorStop(0, "#23262c");
        metal.addColorStop(0.42, "#8e949e");
        metal.addColorStop(0.55, "#e4e7ee");
        metal.addColorStop(1, "#14161a");
        g.fillStyle = metal;
      } else {
        const glide = drawW * (0.15 - Math.sin((yaw * Math.PI) / 180) * 0.28);
        const sheen = g.createLinearGradient(-drawW * 0.45 + glide, -drawH * 0.4, drawW * 0.5 + glide, drawH * 0.45);
        const alpha = 0.07 + spec * 0.5;
        sheen.addColorStop(0, "rgba(255, 255, 255, " + alpha.toFixed(3) + ")");
        sheen.addColorStop(0.32, "rgba(255, 246, 224, " + (alpha * 0.42).toFixed(3) + ")");
        sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
        g.fillStyle = sheen;
      }
      g.fillRect(-faceCanvas.width, -faceCanvas.height, faceCanvas.width * 2, faceCanvas.height * 2);
      g.globalCompositeOperation = "source-over";
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    slabCtx.drawImage(faceCanvas, 0, 0);
  }

  function drawSlab() {
    const weapon = weapons.find((item) => item.id === openId);
    const image = weapon && weapon.image;
    slabCtx.clearRect(0, 0, slab.width, slab.height);
    if (!image || !slab.width) return;
    if (!weapon.edges) weapon.edges = traceEdges(image);
    const edges = weapon.edges;
    const yawRad = (yaw * Math.PI) / 180;
    const face = Math.cos(yawRad);
    const side = Math.sin(yawRad);
    const frame = frameOf(edges);
    if (!frame) return;
    const dpr = slab.width / Math.max(1, figure.getBoundingClientRect().width);
    const depth = 16 * dpr;
    const pad = depth + 12 * dpr;
    const availW = Math.max(1, slab.width - pad * 2);
    const availH = Math.max(1, slab.height - pad * 2);
    const spanX = frame.maxX - frame.minX;
    const spanY = frame.maxY - frame.minY;
    const src = {
      x: frame.minX * image.naturalWidth,
      y: frame.minY * image.naturalHeight,
      w: Math.max(1, spanX * image.naturalWidth),
      h: Math.max(1, spanY * image.naturalHeight),
    };
    const aspect = src.w / src.h;
    let drawW = availW;
    let drawH = drawW / aspect;
    if (drawH > availH) {
      drawH = availH;
      drawW = drawH * aspect;
    }
    const mapped = edges.rows.map((row) => ({
      y: (row.y - frame.minY) / spanY,
      left: (row.left - frame.minX) / spanX,
      right: (row.right - frame.minX) / spanX,
    }));
    const centerX = slab.width / 2;
    const top = (slab.height - drawH) / 2;
    const centerY = top + drawH / 2;
    const spec = Math.pow(Math.abs(side), 1.35);
    const frontSpec = Math.pow(Math.max(0, Math.cos(yawRad)), 2.4);
    const tone = weapon.unlocked ? edges.tone : { r: 168, g: 174, b: 184 };
    const shift = side * depth;
    slabCtx.filter = "blur(" + Math.max(0.4, 0.55 * dpr).toFixed(2) + "px)";
    paintRim(mapped, Math.max(1, Math.round(edges.h * spanY)), centerX, top, drawW, drawH, face, shift, mixTone(tone, spec * 0.18), mixTone(tone, 0.28 + spec * 0.72));
    slabCtx.filter = "none";
    const mode = weapon.unlocked ? "color" : "metal";
    blitFace(image, src, centerX, centerY, drawW, drawH, face, -shift * 0.15, depth * 0.22, "dark");
    blitFace(image, src, centerX, centerY, drawW, drawH, face, 0, 0, mode);
    blitFace(image, src, centerX, centerY, drawW, drawH, face, 0, 0, "sheen", frontSpec);
    contactRatio = (top + drawH + depth * 0.22) / slab.height;
  }

  function alignPedestal() {
    const stage = document.querySelector(".inspect-stage").getBoundingClientRect();
    const box = slab.getBoundingClientRect();
    const sole = box.top + contactRatio * box.height;
    const ped = canvas.getBoundingClientRect();
    const ellipse = ped.height * 0.58;
    const ringTop = ped.height * 0.16;
    canvas.style.top = (sole - stage.top - ellipse + ringTop + 8) + "px";
    canvas.style.transform = "translate(-50%, 0)";
  }

  function drawPedestal(time, dt) {
    const width = canvas.width;
    const height = canvas.height;
    const cx = width / 2;
    const cy = height * 0.58;
    const yawRad = (yaw * Math.PI) / 180;
    const facing = Math.cos(yawRad);
    const turn = Math.sin(yawRad);
    const face = Math.abs(facing);
    const rx = width * (0.24 + face * 0.1);
    const ry = rx * 0.28;
    ctx.clearRect(0, 0, width, height);

    const well = ctx.createRadialGradient(cx, cy, rx * 0.2, cx, cy, rx * 1.05);
    well.addColorStop(0, "rgba(0, 0, 0, 0.28)");
    well.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = well;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    const shadowW = width * (0.12 + 0.3 * face);
    const shadowH = shadowW * (0.2 + 0.22 * Math.abs(turn));
    const lean = turn * shadowW * 0.34;
    ctx.save();
    ctx.translate(cx + turn * width * 0.045, cy + Math.abs(turn) * 4);
    ctx.transform(1, 0, turn * 0.42, 1, 0, 0);
    const cast = ctx.createRadialGradient(-lean * 0.15, 0, shadowW * 0.08, 0, 0, shadowW);
    cast.addColorStop(0, "rgba(0, 0, 0, 0.62)");
    cast.addColorStop(0.55, "rgba(0, 0, 0, 0.28)");
    cast.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = cast;
    ctx.beginPath();
    ctx.ellipse(0, 0, shadowW, shadowH, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "rgba(214, 206, 188, 0.38)";
    ctx.lineWidth = Math.max(1.5, width * 0.004);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.9, ry * 0.9, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    ctx.rotate(time * 0.0011);
    ctx.strokeStyle = "rgba(255, 232, 190, 0.72)";
    ctx.lineWidth = Math.max(2, width * 0.006);
    ctx.beginPath();
    ctx.arc(0, 0, rx * 0.9, -0.35, 0.85);
    ctx.stroke();
    ctx.restore();

    bits.forEach((bit) => {
      bit.a += bit.speed * dt;
      const orbit = bit.spread;
      const x = cx + Math.cos(bit.a) * rx * orbit;
      const y = cy + Math.sin(bit.a) * ry * orbit - (8 + Math.sin(bit.a * 2) * 10) * (width / 520);
      ctx.globalAlpha = 0.22 + 0.55 * (0.5 + 0.5 * Math.sin(bit.a * 1.7));
      ctx.fillStyle = bit.gold ? "rgb(255, 214, 150)" : "rgb(226, 232, 240)";
      ctx.beginPath();
      ctx.arc(x, y, bit.size * (width / 520), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function tick(time) {
    const dt = lastTime ? Math.min(34, time - lastTime) : 16;
    lastTime = time;
    if (!dragging && !reduced && time > resumeAt) yaw += dt * 0.018;
    figure.style.transform = "translateX(-50%)";
    drawSlab();
    drawPedestal(time, dt);
    raf = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (raf) return;
    lastTime = 0;
    raf = requestAnimationFrame(tick);
  }

  function stopLoop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  figure.addEventListener("pointerdown", (event) => {
    dragging = true;
    lastX = event.clientX;
    figure.setPointerCapture(event.pointerId);
  });
  figure.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    yaw += (event.clientX - lastX) * 0.55;
    lastX = event.clientX;
  });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    resumeAt = performance.now() + 900;
  }
  figure.addEventListener("pointerup", endDrag);
  figure.addEventListener("pointercancel", endDrag);

  closeBtn.addEventListener("click", closeInspect);
  inspector.addEventListener("click", (event) => {
    if (event.target === inspector || event.target.classList.contains("spotlight")) closeInspect();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeInspect();
  });
  window.addEventListener("resize", () => {
    if (!openId) return;
    resizeSurfaces();
    drawSlab();
    alignPedestal();
  });

  paintWall();
})();
