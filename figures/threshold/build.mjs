// Figur interaktif "cara kerja threshold": mesin sortir token nasabah.
//
// Semua angka dibaca dari reports/threshold_table.json (hasil src/threshold_table.py):
// isi rak (jumlah nasabah per slot skor 0,01), tinggi tabung, dan readout.
//
//   node figures/threshold/build.mjs           -> docs/threshold/index.html + reports/threshold_figure.svg
//   node figures/threshold/build.mjs --audit   -> juga cek urutan gambar & tumpuan (kit/audit.mjs)
//
// kit/ adalah Anatomy (MIT, lihat LICENSE-anatomy).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as A from "./kit/audit.mjs";
import * as k from "./kit/iso-kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const { meta, rows, top } = JSON.parse(readFileSync(join(ROOT, "reports", "threshold_table.json"), "utf8"));

const DEFAULT_T = 0.5;
const CHOSEN = meta.chosen_threshold;
const T_MIN = rows[0].threshold;
const STEP_T = 0.01;

// Slot i berisi nasabah dengan skor di [t_i, t_i + 0,01); slot terakhir = skor >= 0,95.
const BINS = rows.map((row, i) => ({
  t: row.threshold,
  n: row.n_called - (rows[i + 1]?.n_called ?? 0),
  yes: row.tp - (rows[i + 1]?.tp ?? 0),
}));
if (rows[0].n_called !== meta.n_test || rows[0].tp !== meta.n_positive) throw new Error("ada skor di bawah ambang terendah: rak tidak memuat semua nasabah");
if (BINS.reduce((s, b) => s + b.n, 0) !== meta.n_test) throw new Error("jumlah slot tidak sama dengan n_test");

const WIDTH = 640;
const HEIGHT = 270;

const PITCH = 3.2;
const GAP = 0.8;
const X0 = -150;
const X1 = X0 + BINS.length * PITCH;
const xAt = (t) => X0 + Math.round((t - T_MIN) / STEP_T) * PITCH;
const X_LAST = xAt(rows[rows.length - 1].threshold);

const PLATE = { x: -174, y: -22, w: 418, d: 68, r: 8 };
const PLATE_H = 10;
const FOOT_H = 5;

const BED = { x: X0 - 6, y: -10, w: X1 - X0 + 11, d: 14, r: 1.6 };
const BED_TOP = 6;
const SLAT_Y = -8;
const SLAT_D = 10;
const SLAT_K = 0.55; // tinggi per nasabah di rak
const RAIL = { x: X0 - 14, y: 12, w: X_LAST - X0 + 28, d: 6, r: 1 };
const RULER = { x: X0 - 4, y: 22.5, w: X_LAST - X0 + 8, d: 6.5, r: 1 };
const PIN_Y = 34;

const CARRIAGE = { x: -8, y: 8, w: 16, d: 13, r: 2 };
const CARRIAGE_Z = 3;
const CARRIAGE_TOP = 9;
const POST_TOP = 63;

const COL_K = 0.031; // tinggi per nasabah di tabung
const COL_Z = 6;
const STACK_R = 9.5;
const PUCK_R = 12.5;
const POST_R = 1;
const POST_AT = 11.2;
const SEAM = 100; // garis tipis tiap 100 nasabah
const PLATFORM = { x: 166, y: -15, w: 66, d: 36, r: 4 };
const COLS = [
  { key: "call", x: 183, y: 3, cap: meta.n_test },
  { key: "pos", x: 215, y: 3, cap: meta.n_positive },
];
const capZ = (col) => COL_Z + col.cap * COL_K + 0.6;

const AZIMUTH = 69;
const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [X0, -10, POST_TOP + 2], [X_LAST, 4, POST_TOP + 2], ...COLS.flatMap((c) => [[c.x - PUCK_R, c.y, capZ(c) + 1.6], [c.x + PUCK_R, c.y, capZ(c) + 1.6]])],
  WIDTH,
  HEIGHT,
  { pad: 14, azimuth: AZIMUTH },
);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const plus = (plan, dx) => ({ ...plan, x: plan.x + dx });

// ---------------------------------------------------------------- scene
// Satu daftar item dalam urutan gambar (belakang ke depan). Halaman dan audit memakai daftar yang sama.

function stackSvg(K, P, cx, cy, z0, segments, seamStep, r) {
  let z = z0;
  let out = "";
  for (const seg of segments) {
    if (seg.h <= 0.05) continue;
    let inner = "";
    for (let s = z0 + seamStep; s < z + seg.h - 0.4; s += seamStep) if (s > z + 0.4) inner += K.lineSvg(K.sideArc(cx, cy, r, s, P, 40), { tone: "faint" });
    out += K.solidSvg(K.cylinder(cx, cy, r, z, seg.h, P, 48), { tone: seg.tone, className: seg.cls, inner });
    z += seg.h;
  }
  return out;
}

const segmentsOf = (key, row) =>
  key === "call"
    ? [{ h: row.tp * COL_K, cls: "tok-yes", tone: "hi" }, { h: row.fp * COL_K, cls: "tok-no", tone: "mid" }]
    : [{ h: row.tp * COL_K, cls: "tok-yes", tone: "hi" }, { h: row.fn * COL_K, cls: "tok-yes tok-miss", tone: "hi" }];

const rowAt = (t) => rows[Math.round((t - T_MIN) / STEP_T)];

function scene(t) {
  const items = [];
  const put = (name, svg, shapes, extra = {}) => items.push({ name, svg, shapes, ...extra });
  const row = rowAt(t);
  const xb = xAt(t);

  // Kaki dan pelat dasar.
  for (const [index, [x, y]] of byDepth(k.corners(PLATE, 22)).entries()) {
    put(`stand.foot${index}`, S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }) + S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }), [
      A.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, { name: `stand.flange${index}` }),
      A.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, { name: `stand.foot${index}` }),
    ]);
  }
  {
    const screws = k.corners(PLATE, 10);
    const svg =
      S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid" }) +
      L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }) +
      L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }) +
      D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 });
    put("plate", svg, [A.slab(PLATE, -PLATE_H, PLATE_H, { name: "plate" })]);
  }

  // Penggaris skor: tick tiap 0,01, tick besar tiap 0,05.
  {
    const ticks = k.topTicks(xAt(T_MIN), X_LAST, PITCH, 5, RULER.y + 0.8, 0.6, [2, 3.6], P);
    const svg =
      S(k.slabOf(RULER, 0, 0.6, P, 3), { tone: "lo", crease: "none" }) +
      L(ticks.minor, { tone: "lo" }) +
      L(ticks.major, { tone: "mid" }) +
      D([at([RULER.x + 2, RULER.y + 3.25, 0.6]), at([RULER.x + RULER.w - 2, RULER.y + 3.25, 0.6])], { size: 0.45 });
    put("ruler", svg, [A.slab(RULER, 0, 0.6, { name: "ruler" }, 3)]);
  }

  // Pelat label di depan tabung.
  {
    const plan = { x: 176, y: 27, w: 40, d: 11, r: 1.2 };
    const svg =
      S(k.slabOf(plan, 0, 0.8, P, 4), { tone: "mid" }) +
      L(k.planOutline(k.insetPlan(plan, 1.6), 0.8, P), { tone: "faint" }) +
      [[0.42, 0.62], [0.35, 0.8], [0.5, 0.55]].map(([y, w], index) => L(k.lineOnTop([plan.x + 5, plan.y + plan.d * (0.3 + index * 0.2)], [plan.x + 5 + (plan.w - 14) * w, plan.y + plan.d * (0.3 + index * 0.2)], 0.8, P), { tone: "lo", free: true })).join("") +
      D([at([plan.x + plan.w - 3, plan.y + 3, 0.8]), at([plan.x + plan.w - 3, plan.y + plan.d - 3, 0.8])], { size: 0.45 });
    put("label", svg, [A.slab(plan, 0, 0.8, { name: "label" }, 4)]);
  }

  // Piring token contoh: satu token gelap (potensial), satu terang (bukan).
  {
    const [cx, cy] = [-160, 35];
    put("dish", S(k.cylinder(cx, cy, 5, 0, 1.2, P, 40, 0.4), { tone: "mid" }) + L(k.ring(cx, cy, 4.2, 1.2, P, 40), { tone: "faint" }), [A.cylinder(cx, cy, 5, 0, 1.2, { name: "dish" })]);
    for (const [x, y, cls, tone] of byDepth([[cx - 1.9, cy - 0.6], [cx + 1.9, cy + 0.6]]).map(([x, y], i) => [x, y, i ? "tok-no" : "tok-yes", i ? "mid" : "hi"])) {
      put(`dish.${cls}`, S(k.cylinder(x, y, 1.6, 1.2, 1.1, P, 24), { tone, className: cls }), [A.cylinder(x, y, 1.6, 1.2, 1.1, { name: `dish.${cls}` })]);
    }
  }

  // Rel kereta ambang dan stopernya.
  {
    const stop = (x) => ({ x, y: RAIL.y - 2, w: 4, d: RAIL.d + 4, r: 1 });
    const stopSvg = (plan) => S(k.slabOf(plan, 0, 6, P, 3, 0.5), { tone: "mid" }) + D([at([plan.x + 2, plan.y + 2, 6]), at([plan.x + 2, plan.y + plan.d - 2, 6])], { size: 0.45 });
    const left = stop(RAIL.x - 4);
    const right = stop(RAIL.x + RAIL.w);
    put("rail.stop0", stopSvg(left), [A.slab(left, 0, 6, { name: "rail.stop0" }, 3)]);
    put(
      "rail",
      S(k.slabOf(RAIL, 0, 3, P, 3, 0.4), { tone: "mid" }) + D([RAIL.x + 6, RAIL.x + RAIL.w / 2, RAIL.x + RAIL.w - 6].map((x) => at([x, RAIL.y + RAIL.d / 2, 3])), { size: 0.4 }),
      [A.slab(RAIL, 0, 3, { name: "rail" }, 3)],
    );
    put("rail.stop1", stopSvg(right), [A.slab(right, 0, 6, { name: "rail.stop1" }, 3)]);
  }

  // Rak token: bangku, dinding belakang, blok ujung, 91 slot, bibir depan.
  {
    const svg = S(k.slabOf(BED, 0, BED_TOP, P, 4, 0.8), { tone: "mid" }) + D([BED.x + 3, BED.x + BED.w - 3].map((x) => at([x, BED.y + BED.d - 3.2, BED_TOP])), { size: 0.4 });
    put("rack.bed", svg, [A.slab(BED, 0, BED_TOP, { name: "rack.bed" }, 4)]);
    const wall = { x: BED.x + 1, y: BED.y, w: BED.w - 2, d: 1.4, r: 0.4 };
    put("rack.wall", S(k.slabOf(wall, BED_TOP, 3, P, 2), { tone: "mid" }), [A.slab(wall, BED_TOP, 3, { name: "rack.wall" }, 2)]);
  }
  const endBlock = (x) => ({ x, y: BED.y + 1.6, w: 3.6, d: 2.6 - BED.y - 1.6, r: 0.8 });
  const endSvg = (plan) => S(k.slabOf(plan, BED_TOP, 10, P, 3, 0.4), { tone: "mid" }) + D([at([plan.x + 1.8, plan.y + 2.4, BED_TOP + 10]), at([plan.x + 1.8, plan.y + plan.d - 2.4, BED_TOP + 10])], { size: 0.4 });
  const leftEnd = endBlock(X0 - 5);
  put("rack.end0", endSvg(leftEnd), [A.slab(leftEnd, BED_TOP, 10, { name: "rack.end0" }, 3)]);
  BINS.forEach((bin, index) => {
    const plan = { x: X0 + index * PITCH + GAP / 2, y: SLAT_Y, w: PITCH - GAP, d: SLAT_D, r: 0.3 };
    const hYes = bin.yes * SLAT_K;
    const hNo = (bin.n - bin.yes) * SLAT_K;
    let svg = "";
    const shapes = [];
    if (hYes > 0) {
      svg += S(k.slabOf(plan, BED_TOP, hYes, P, 2), { tone: "hi", className: "tok-yes" });
      shapes.push(A.slab(plan, BED_TOP, hYes, { name: `slot${index}.yes` }, 2));
    }
    if (hNo > 0) {
      svg += S(k.slabOf(plan, BED_TOP + hYes, hNo, P, 2), { tone: "mid", className: "tok-no" });
      shapes.push(A.slab(plan, BED_TOP + hYes, hNo, { name: `slot${index}.no` }, 2));
    }
    if (svg) put(`slot${index}`, svg, shapes, { slot: index, skip: bin.t < t });
  });
  const rightEnd = endBlock(X1 + 1);
  put("rack.end1", endSvg(rightEnd), [A.slab(rightEnd, BED_TOP, 10, { name: "rack.end1" }, 3)]);
  {
    const lip = { x: BED.x + 1, y: 2.6, w: BED.w - 2, d: 1.4, r: 0.4 };
    put("rack.lip", S(k.slabOf(lip, BED_TOP, 2.5, P, 2), { tone: "mid" }), [A.slab(lip, BED_TOP, 2.5, { name: "rack.lip" }, 2)]);
  }

  // Kereta ambang: lengan, tiang penanda + batang atas (lit), kereta, kenop, penunjuk.
  {
    const arm = { x: xb - 1.2, y: 2.6, w: 2.4, d: 8.4, r: 0.6 };
    const post = { x: xb - 0.5, y: 2.6, w: 1, d: 1.4, r: 0.3 };
    const bar = { x: xb - 0.7, y: SLAT_Y - 0.6, w: 1.4, d: 4 - SLAT_Y + 0.6, r: 0.5 };
    const car = plus(CARRIAGE, xb);
    const knob = [xb + 4.4, CARRIAGE.y + CARRIAGE.d - 4.2];
    const pointer = { x: xb - 1.4, y: CARRIAGE.y + CARRIAGE.d, w: 2.8, d: 5.6, r: 0.8 };
    const gate = (name, svg, shapes) => put(name, svg, shapes, { gate: true });
    gate(
      "gate.carriage",
      S(k.slabOf(car, CARRIAGE_Z, CARRIAGE_TOP - CARRIAGE_Z, P, 4, 0.6), { tone: "mid" }) +
        L(k.lineOnTop([car.x, car.y + 4], [car.x + car.w, car.y + 4], CARRIAGE_TOP, P), { tone: "faint" }) +
        D([[car.x + 2.6, car.y + 6.5], [car.x + car.w - 2.6, car.y + 6.5], [car.x + 2.6, car.y + car.d - 2.4]].map(([x, y]) => at([x, y, CARRIAGE_TOP])), { size: 0.45 }),
      [A.slab(car, CARRIAGE_Z, CARRIAGE_TOP - CARRIAGE_Z, { name: "gate.carriage" }, 4)],
    );
    gate("gate.arm", S(k.slabOf(arm, CARRIAGE_TOP, 2, P, 2, 0.3), { tone: "mid" }), [A.slab(arm, CARRIAGE_TOP, 2, { name: "gate.arm" }, 2)]);
    gate("gate.post", S(k.slabOf(post, CARRIAGE_TOP + 2, POST_TOP - CARRIAGE_TOP - 2, P, 2), { tone: "hi", lit: true }), [A.slab(post, CARRIAGE_TOP + 2, POST_TOP - CARRIAGE_TOP - 2, { name: "gate.post" }, 2)]);
    gate("gate.bar", S(k.slabOf(bar, POST_TOP, 1.8, P, 2, 0.3), { tone: "hi", lit: true }) + D([at([xb, bar.y + 1.2, POST_TOP + 1.8]), at([xb, 2.6 + 0.7, POST_TOP + 1.8])], { size: 0.4, tone: "lo" }), [A.slab(bar, POST_TOP, 1.8, { name: "gate.bar" }, 2)]);
    gate(
      "gate.knob",
      S(k.cylinder(knob[0], knob[1], 2.8, CARRIAGE_TOP, 4, P, 28), { tone: "mid" }) + L(k.knurl(knob[0], knob[1], 2.8, CARRIAGE_TOP, CARRIAGE_TOP + 4, 22, P), { tone: "lo" }) + D([at([knob[0], knob[1], CARRIAGE_TOP + 4])], { size: 0.5, tone: "hi" }),
      [A.cylinder(knob[0], knob[1], 2.8, CARRIAGE_TOP, 4, { name: "gate.knob" })],
    );
    gate(
      "gate.pointer",
      S(k.slabOf(pointer, 3.4, 0.8, P, 2), { tone: "mid" }) + L(k.lineOnTop([xb, pointer.y], [xb, pointer.y + pointer.d - 0.4], 4.2, P), { tone: "lit", free: "end" }).replace("<path", '<path style="stroke-width:1.1"'),
      [A.slab(pointer, 3.4, 0.8, { name: "gate.pointer" }, 2)],
    );
  }

  // Pasak penanda di skala: pendek = 0,5, tinggi dengan kerah = 0,56 (pilihan CV).
  {
    const x5 = xAt(DEFAULT_T);
    put("pin.default", S(k.cylinder(x5, PIN_Y, 1.8, 0, 4, P, 20), { tone: "mid" }) + D([at([x5, PIN_Y, 4])], { size: 0.5 }), [A.cylinder(x5, PIN_Y, 1.8, 0, 4, { name: "pin.default" })]);
    const xc = xAt(CHOSEN);
    put(
      "pin.chosen",
      S(k.cylinder(xc, PIN_Y, 2.8, 0, 1.4, P, 24), { tone: "mid" }) +
        S(k.cylinder(xc, PIN_Y, 1.8, 1.4, 6.4, P, 20), { tone: "hi" }) +
        L(k.ring(xc, PIN_Y, 0.8, 7.8, P, 12), { tone: "mid" }) +
        k.faceTextSvg(k.topMatrix([xc + 4.6, PIN_Y + 1.4], 0, P, "x"), CHOSEN.toFixed(2).replace(".", ","), { size: 3.6, tone: "mid" }),
      [A.cylinder(xc, PIN_Y, 2.8, 0, 1.4, { name: "pin.collar" }), A.cylinder(xc, PIN_Y, 1.8, 1.4, 6.4, { name: "pin.chosen" })],
    );
  }

  // Dua tabung koin di platform: "ditelepon" (penuh = semua nasabah) dan "semua potensial".
  put(
    "platform",
    S(k.slabOf(PLATFORM, 0, 4, P, 6, 0.8), { tone: "mid" }) + D(k.corners(PLATFORM, 4).map(([x, y]) => at([x, y, 4])), { size: 0.45 }),
    [A.slab(PLATFORM, 0, 4, { name: "platform" }, 6)],
  );
  for (const col of COLS) {
    const view = (AZIMUTH * Math.PI) / 180;
    const posts = [view, view + (2 * Math.PI) / 3, view - (2 * Math.PI) / 3].map((a) => [col.x + Math.cos(a) * POST_AT, col.y + Math.sin(a) * POST_AT]);
    const top = capZ(col);
    const postItem = ([x, y], index) => put(`${col.key}.post${index}`, S(k.cylinder(x, y, POST_R, COL_Z, top - COL_Z, P, 14), { tone: "mid", crease: "none" }), [A.cylinder(x, y, POST_R, COL_Z, top - COL_Z, { name: `${col.key}.post${index}` })]);
    put(`${col.key}.puck`, S(k.cylinder(col.x, col.y, PUCK_R, 4, 2, P, 64, 0.6), { tone: "mid" }) + L(k.ring(col.x, col.y, STACK_R + 0.6, COL_Z, P, 64), { tone: "faint" }), [A.cylinder(col.x, col.y, PUCK_R, 4, 2, { name: `${col.key}.puck` })]);
    byDepth(posts.slice(1)).forEach((p, index) => postItem(p, index + 1));
    const segments = segmentsOf(col.key, row);
    const shapes = [];
    let z = COL_Z;
    for (const seg of segments) {
      if (seg.h > 0.05) shapes.push(A.cylinder(col.x, col.y, STACK_R, z, seg.h, { name: `${col.key}.stack` }));
      z += seg.h;
    }
    put(`${col.key}.stack`, stackSvg(k, P, col.x, col.y, COL_Z, segments, SEAM * COL_K, STACK_R), shapes, { stack: col.key });
    postItem(posts[0], 0);
    put(
      `${col.key}.cap`,
      S(k.cylinder(col.x, col.y, PUCK_R, top, 1.6, P, 64, 0.5), { tone: "mid" }) + L(k.ring(col.x, col.y, 3, top + 1.6, P, 24), { tone: "lo" }) + D([at([col.x, col.y, top + 1.6])], { size: 0.5 }),
      [A.cylinder(col.x, col.y, PUCK_R, top, 1.6, { name: `${col.key}.cap` })],
    );
  }
  return items;
}

// ---------------------------------------------------------------- audit

function auditAt(t) {
  const R = A.recorder(P);
  scene(t).forEach((item, index) => R.put({ key: index, name: item.name, svg: item.svg, shapes: item.shapes.map(R.solid) }));
  const overlaps = A.overlapsOf(R.items, P, { states: [0] });
  R.settled = { items: R.items, overlaps, solved: { keys: R.items.map((item) => item.key), dropped: [], cycles: [], rules: 0 }, states: [0] };
  const result = A.audit(R, P, { frames: [], apart: false });
  const count = A.failures(result);
  console.log(`\n=== audit ambang ${t.toFixed(2)} ===\n${A.report(result)}\n${R.items.length} items · ${R.solids.length} solids · ${overlaps.pairs.length} overlaps · ${count ? `audit failed: ${count}` : "audit passed"}`);
  return count;
}

if (process.argv.includes("--audit")) {
  const failed = [T_MIN, 0.3, DEFAULT_T, CHOSEN, 0.7, rows[rows.length - 1].threshold].map(auditAt).reduce((a, b) => a + b, 0);
  console.log(failed ? `\naudit failed: ${failed} problems` : "\naudit passed (semua posisi)");
  if (failed) process.exitCode = 1;
}

// ---------------------------------------------------------------- page

const fmtPct = (x) => `${(x * 100).toFixed(1).replace(".", ",")}%`;
const fmtInt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const fmtT = (t) => t.toFixed(2).replace(".", ",");

const START = CHOSEN;
const startRow = rowAt(START);
const items = scene(START);
const slotSvg = items.filter((item) => item.slot !== undefined);
const body = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
let gateOpen = false;
for (const item of items) {
  if (item.gate && !gateOpen) {
    body.push(`<g data-part="gate">`);
    gateOpen = true;
  }
  if (!item.gate && gateOpen) {
    body.push(`</g>`);
    gateOpen = false;
  }
  if (item.name === "platform") body.push(`<path class="iso-halo" d="${k.haloOf(k.insetPlan(PLATFORM, 2), 0, 0.1, P)}" style="filter:blur(4px)"/>`);
  if (item.slot !== undefined) body.push(`<g data-slot="${item.slot}"${item.skip ? ' data-skip=""' : ""}>${item.svg}</g>`);
  else if (item.stack) body.push(`<g data-stack="${item.stack}">${item.svg}</g>`);
  else body.push(item.svg);
}

const LABEL = `Mesin sortir token. ${fmtInt(meta.n_test)} nasabah test set tersusun di ${BINS.length} slot menurut skor model (0,05 sampai 0,95 ke atas); token gelap adalah nasabah yang benar-benar deposit. Sebuah tiang penanda pada kereta menandai ambang: slot di kanan tiang ditelepon, slot di kiri dilewati. Tabung kiri menampung yang ditelepon, tabung kanan menampung semua nasabah potensial.`;

const svg = k.figureSvg({ width: WIDTH, height: HEIGHT, label: LABEL, body });

const EXTRA_CSS = `
.tok-yes{--anatomy-paper:#5c5c62;--anatomy-face:#5c5c62;--anatomy-top:#7a7a80;--anatomy-shade-0:#45454b;--anatomy-shade-1:#4e4e54;--anatomy-shade-2:#57575d;--anatomy-shade-3:#606066}
.iso[data-theme="dark"] .tok-yes{--anatomy-paper:#a8a8ac;--anatomy-face:#a8a8ac;--anatomy-top:#c4c4c8;--anatomy-shade-0:#8a8a8e;--anatomy-shade-1:#949498;--anatomy-shade-2:#9e9ea2;--anatomy-shade-3:#a8a8ac}
[data-slot]{transition:opacity .35s var(--anatomy-ease)}
[data-slot][data-skip]{opacity:.24}
.tok-miss{opacity:.24}
@media (prefers-reduced-motion:reduce){[data-slot]{transition:none}}
`;

const PAGE_CSS = `
.iso-stage{touch-action:pan-y;cursor:ew-resize;outline:none;border-radius:2px}
.iso-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.th-board{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:1px;margin:18px 0 0;background:var(--anatomy-faint);border:1px solid var(--anatomy-faint)}
.th-board>div{background:var(--anatomy-card);padding:8px 10px 9px;min-width:0}
.th-board span{display:block;color:var(--anatomy-muted);font-family:var(--anatomy-mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
.th-board b{display:block;color:var(--anatomy-strong);font-family:var(--anatomy-mono);font-size:15px;font-weight:500;font-variant-numeric:tabular-nums;white-space:nowrap;margin-top:3px}
.th-board i{display:block;color:var(--anatomy-muted);font-family:var(--anatomy-mono);font-size:10.5px;line-height:1.35;font-style:normal;margin-top:2px}
.iso-swatch[data-mark="yes"] path{fill:#5c5c62;stroke:var(--anatomy-hi)}
.iso-swatch[data-mark="no"] path{fill:var(--anatomy-card);stroke:var(--anatomy-mid)}
.iso-swatch[data-mark="skip"] path{fill:var(--anatomy-card);stroke:var(--anatomy-mid);opacity:.35}
.th-intro{color:var(--anatomy-text);margin:0 0 18px}
.th-intro h1{color:var(--anatomy-strong);font-size:20px;font-weight:600;margin:0 0 6px;letter-spacing:-.01em}
.th-intro p{margin:0}
.th-foot{margin-top:22px;color:var(--anatomy-muted);font-size:12.5px}
.th-foot a{color:var(--anatomy-text)}
@media (max-width:560px){.th-board{grid-template-columns:repeat(2,minmax(0,1fr))}.th-board>div:first-child{grid-column:1/-1}.iso-plate-corner[data-corner="title"]{display:none}}
`;

const tagOf = (t) => (Math.abs(t - CHOSEN) < 1e-9 ? "pilihan CV" : Math.abs(t - DEFAULT_T) < 1e-9 ? "default" : "");
const board = `<div class="th-board" aria-hidden="true">
<div><span>Threshold</span><b data-v="t">${fmtT(START)}</b><i data-v="tag">${tagOf(START) || "&nbsp;"}</i></div>
<div><span>Ditelepon</span><b data-v="n">${fmtInt(startRow.n_called)}</b><i data-v="pct">dari ${fmtInt(meta.n_test)} · ${fmtPct(startRow.pct_called)}</i></div>
<div><span>Precision</span><b data-v="p">${fmtPct(startRow.precision)}</b><i data-v="tpfp">${fmtInt(startRow.tp)} benar · ${fmtInt(startRow.fp)} salah</i></div>
<div><span>Recall</span><b data-v="r">${fmtPct(startRow.recall)}</b><i data-v="fn">${fmtInt(startRow.fn)} terlewat</i></div>
<div><span>Lift vs acak</span><b data-v="l">${startRow.lift.toFixed(2).replace(".", ",")}×</b><i>acak ≈ ${fmtPct(meta.base_rate)}</i></div>
</div>`;

const swatch = (mark) => `<svg class="iso-swatch" data-mark="${mark}" viewBox="0 0 16 10" aria-hidden="true">${mark === "line" ? `<path d="M1.5 5h13"/>` : `<path d="M2 4.5 8 1.5 14 4.5 14 6 8 9 2 6Z"/>`}</svg>`;
const keys = [
  ["yes", "Token gelap: nasabah potensial (benar-benar deposit)"],
  ["no", "Token terang: bukan potensial"],
  ["skip", "Pudar: skor di bawah ambang, dilewati"],
  ["lit", "Tiang penanda ambang dan penunjuk skala"],
];
const legendKeys = keys.map(([mark, label]) => `<span class="iso-key">${mark === "lit" ? swatch("line").replace('data-mark="line"', 'data-mark="lit"') : swatch(mark)}${label}</span>`).join("");
const caption = `Rak berisi ${fmtInt(meta.n_test)} nasabah test set, satu slot per selang skor 0,01; tinggi slot = jumlah nasabah dengan skor itu. Semua slot di kanan tiang ditelepon. Tabung kiri berisi yang ditelepon (penuh = semua ${fmtInt(meta.n_test)}); porsi gelapnya adalah precision. Tabung kanan berisi semua ${fmtInt(meta.n_positive)} nasabah potensial; porsi gelap padatnya adalah recall. Garis tipis pada tabung = tiap ${SEAM} nasabah. Pasak pendek di skala menandai ambang ${fmtT(DEFAULT_T)}, pasak tinggi ${fmtT(CHOSEN)}: ambang terendah yang memberi precision ≥ 80% pada cross-validation data train.`;

const plate = k
  .plateHtml({
    fig: "Fig 1",
    title: "Threshold lead scoring",
    hint: "Geser pointer · ← →",
    readout: `ambang ${fmtT(START)} · ${fmtInt(startRow.n_called)} ditelepon`,
    body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="Threshold: geser pointer atau tekan panah kiri/kanan (Shift = 0,05), Home/End ke ujung, 5 = 0,5, 6 = ${fmtT(CHOSEN)}" aria-valuemin="${T_MIN}" aria-valuemax="${rows[rows.length - 1].threshold}" aria-valuenow="${START}" aria-valuetext="">${svg}</div>${board}`,
  })
  .replace("</figure>", `<figcaption class="iso-legend"><span class="iso-keys">${legendKeys}</span><span class="iso-caption">${caption}</span></figcaption></figure>`);

const intro = `<header class="th-intro"><h1>Cara kerja threshold</h1><p>Model memberi tiap nasabah skor 0–1. Threshold menentukan siapa yang ditelepon: semua nasabah dengan skor di atas ambang. Menaikkan ambang berarti menelepon lebih sedikit nasabah dengan tebakan yang lebih tepat (precision naik), tetapi lebih banyak nasabah potensial yang terlewat (recall turun).</p></header>`;
const foot = `<p class="th-foot">Angka: test set ${fmtInt(meta.n_test)} nasabah, model ${meta.model}, ROC-AUC ${meta.roc_auc.toFixed(3).replace(".", ",")}, dari <a href="https://github.com/samuel-geraldo/bank-lead-scoring/blob/main/reports/threshold_table.json">reports/threshold_table.json</a>. Top 20% (ambang ${fmtT(top.threshold)}): precision ${fmtPct(top.precision)}, recall ${fmtPct(top.recall)}. Figur dibuat dengan kit Anatomy (MIT).</p>`;

const DATA = {
  P,
  rows: rows.map((row) => [row.threshold, row.n_called, row.pct_called, row.tp, row.fp, row.fn, row.precision, row.recall, row.lift]),
  nTest: meta.n_test,
  chosen: CHOSEN,
  fallback: DEFAULT_T,
  start: START,
  x0: X0,
  pitch: PITCH,
  slotY: 2,
  bedTop: BED_TOP,
  colK: COL_K,
  colZ: COL_Z,
  stackR: STACK_R,
  seam: SEAM * COL_K,
  cols: COLS.map((col) => [col.key, col.x, col.y]),
  bins: BINS.map((bin) => bin.t),
  tour: [CHOSEN, 0.3, DEFAULT_T, CHOSEN, 0.7, 0.85, CHOSEN],
};

const LIVE = `
const D = ${JSON.stringify(DATA)};
const P = D.P;
const K = { cylinder, solidSvg, lineSvg, sideArc };
const stackSvg = ${stackSvg.toString()};
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const gate = svg.querySelector('[data-part="gate"]');
const slots = [...svg.querySelectorAll("[data-slot]")].map((el) => [D.bins[+el.dataset.slot], el]);
const stacks = Object.fromEntries([...svg.querySelectorAll("[data-stack]")].map((el) => [el.dataset.stack, el]));
const readout = document.querySelector("[data-readout]");
const v = Object.fromEntries([...document.querySelectorAll("[data-v]")].map((el) => [el.dataset.v, el]));
const still = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const T0 = D.rows[0][0], T1 = D.rows[D.rows.length - 1][0];
const indexOf = (t) => clamp(Math.round((t - T0) / 0.01), 0, D.rows.length - 1);
const tOf = (i) => Math.round((T0 + i * 0.01) * 100) / 100;
const xOf = (i) => D.x0 + i * D.pitch;
const pct = (x) => (x * 100).toFixed(1).replace(".", ",") + "%";
const int = (n) => String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ".");
const thr = (t) => t.toFixed(2).replace(".", ",");
const tag = (t) => (Math.abs(t - D.chosen) < 1e-9 ? "pilihan CV" : Math.abs(t - D.fallback) < 1e-9 ? "default" : "\\u00a0");
const segmentsOf = (key, r) => key === "call"
  ? [{ h: r.tp * D.colK, cls: "tok-yes", tone: "hi" }, { h: r.fp * D.colK, cls: "tok-no", tone: "mid" }]
  : [{ h: r.tp * D.colK, cls: "tok-yes", tone: "hi" }, { h: r.fn * D.colK, cls: "tok-yes tok-miss", tone: "hi" }];
const rowOf = (i) => { const [t, n, share, tp, fp, fn, p, r, lift] = D.rows[i]; return { t, n, share, tp, fp, fn, p, r, lift }; };

const x0 = xOf(indexOf(D.start));
let target = indexOf(D.start), gx = x0, shown = -1;
const fill = { tp: 0, fp: 0, fn: 0 };
Object.assign(fill, rowOf(target));
let frame = 0, last = 0, clock = 0, visible = false, touring = !still.matches, idle = 0;

function say(i) {
  const r = rowOf(i);
  readout.textContent = "ambang " + thr(r.t) + " · " + int(r.n) + " ditelepon";
  v.t.textContent = thr(r.t); v.tag.textContent = tag(r.t);
  v.n.textContent = int(r.n); v.pct.textContent = "dari " + int(D.nTest) + " · " + pct(r.share);
  v.p.textContent = pct(r.p); v.tpfp.textContent = int(r.tp) + " benar · " + int(r.fp) + " salah";
  v.r.textContent = pct(r.r); v.fn.textContent = int(r.fn) + " terlewat";
  v.l.textContent = r.lift.toFixed(2).replace(".", ",") + "×";
  for (const [t, el] of slots) el.toggleAttribute("data-skip", t < r.t - 1e-9);
}
function describe() {
  const r = rowOf(target);
  stage.setAttribute("aria-valuenow", String(r.t));
  stage.setAttribute("aria-valuetext", "Ambang " + thr(r.t) + ": " + int(r.n) + " dari " + int(D.nTest) + " nasabah ditelepon, precision " + pct(r.p) + ", recall " + pct(r.r) + ", lift " + r.lift.toFixed(2).replace(".", ",") + " kali");
}
function drawStacks() {
  for (const [key, cx, cy] of D.cols) stacks[key].innerHTML = stackSvg(K, P, cx, cy, D.colZ, segmentsOf(key, fill), D.seam, D.stackR);
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const calm = still.matches;
  if (touring) { clock += dt; target = indexOf(D.tour[Math.floor(clock / 2.6) % D.tour.length]); }
  const goal = xOf(target);
  gx = calm ? goal : gx + (goal - gx) * (1 - Math.exp(-dt / 0.22));
  if (Math.abs(goal - gx) < 0.01) gx = goal;
  if (gx === x0) gate.removeAttribute("transform"); else gate.setAttribute("transform", translateAlong(P, [gx - x0, 0, 0]));
  const here = indexOf(T0 + (gx - D.x0) / D.pitch * 0.01);
  if (here !== shown) { shown = here; say(here); }
  const want = rowOf(here);
  let moving = gx !== goal;
  for (const key of ["tp", "fp", "fn"]) {
    const next = calm ? want[key] : fill[key] + (want[key] - fill[key]) * (1 - Math.exp(-dt / 0.2));
    fill[key] = Math.abs(want[key] - next) < 0.05 ? want[key] : next;
    if (fill[key] !== want[key]) moving = true;
  }
  drawStacks();
  frame = visible && (touring || moving) ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
const steer = (i) => {
  touring = false;
  target = clamp(i, 0, D.rows.length - 1);
  describe();
  clearTimeout(idle);
  idle = setTimeout(() => { if (!still.matches) { touring = true; clock = 0; run(); } }, 6000);
  run();
};
const sx = (i) => iso([xOf(i), D.slotY, D.bedTop], P)[0];
const point = (event) => {
  const box = svg.getBoundingClientRect();
  const x = (event.clientX - box.left) / box.width * svg.viewBox.baseVal.width;
  steer(Math.round((x - sx(0)) / (sx(D.rows.length - 1) - sx(0)) * (D.rows.length - 1)));
};
stage.addEventListener("pointermove", point);
stage.addEventListener("pointerdown", point);
stage.addEventListener("keydown", (event) => {
  const from = touring ? shown : target;
  const big = event.shiftKey ? 5 : 1;
  let to = null;
  if (event.key === "ArrowRight" || event.key === "ArrowUp") to = from + big;
  if (event.key === "ArrowLeft" || event.key === "ArrowDown") to = from - big;
  if (event.key === "Home") to = 0;
  if (event.key === "End") to = D.rows.length - 1;
  if (event.key === "5") to = indexOf(D.fallback);
  if (event.key === "6") to = indexOf(D.chosen);
  if (to === null) return;
  event.preventDefault();
  steer(to);
});
stage.addEventListener("focus", describe);
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
if (still.matches) touring = false;
say(target); describe();
`;

const stripExports = (file) => readFileSync(join(HERE, "kit", file), "utf8").replace(/^export /gm, "");
const html = k
  .pageHtml({ title: "Cara kerja threshold", theme: "light", body: intro + plate + foot, script: stripExports("iso-kit.mjs") + LIVE })
  .replace("</style>", `${EXTRA_CSS}${PAGE_CSS}</style>`)
  .replace('<html lang="en">', '<html lang="id">');

mkdirSync(join(ROOT, "docs", "threshold"), { recursive: true });
writeFileSync(join(ROOT, "docs", "threshold", "index.html"), html);

// SVG mandiri (tema terang) untuk README / unduhan: pose ambang pilihan, tanpa interaksi.
const standalone = k.figureSvg({ width: WIDTH, height: HEIGHT, label: LABEL, body, standalone: "light" }).replace("<svg ", `<svg width="${WIDTH * 2}" height="${HEIGHT * 2}" `).replace("</style>", `.iso-svg{background:var(--anatomy-card)}${EXTRA_CSS}</style>`);
writeFileSync(join(ROOT, "reports", "threshold_figure.svg"), standalone);
console.log(`wrote docs/threshold/index.html (${(html.length / 1024).toFixed(0)} KB), reports/threshold_figure.svg · ${items.length} items · ambang awal ${fmtT(START)}`);
