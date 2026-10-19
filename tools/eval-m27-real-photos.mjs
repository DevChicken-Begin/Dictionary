import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, basename, extname } from 'node:path';
import { decodePng } from './png-decode.mjs';
import {
  DEFAULT_SUBJECT_LOCK_THRESHOLDS,
  analyzeFrame,
  analyzeHoles,
  computeReadiness,
  laplacianVariance,
  maskIoU,
  toGray
} from '../src/moris/capture-subject-lock.js';

const DEFAULT_SKIP = ['3460370001'];
const Q4_CODES = new Set(['3446950001', '3446960001', '3440010001', '3889630101', '3400530401', '3462530001']);

const inputDir = resolve(process.argv[2] || 'image 2');
const outputPath = resolve(process.argv[3] || '/tmp/opencode/m27-real-photos.json');
const skipArg = process.argv.indexOf('--skip');
const skip = new Set(skipArg >= 0 ? String(process.argv[skipArg + 1] || '').split(',').filter(Boolean) : DEFAULT_SKIP);
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg >= 0 ? new Set(String(process.argv[onlyArg + 1] || '').split(',').filter(Boolean)) : null;
const labelsArg = process.argv.indexOf('--labels');
const labels = labelsArg >= 0
  ? new Map(JSON.parse(readFileSync(process.argv[labelsArg + 1], 'utf8')).map(row => [row.code, row]))
  : null;

if (!existsSync(inputDir)) {
  console.log(`eval-m27-real-photos: thư mục '${inputDir}' không tồn tại. Bỏ qua.`);
  process.exit(0);
}

const files = readdirSync(inputDir)
  .filter(f => /^[0-9]{10}\.png$/.test(f))
  .map(f => ({ code: basename(f, extname(f)), file: join(inputDir, f) }))
  .filter(item => !skip.has(item.code))
  .filter(item => !only || only.has(item.code))
  .sort((a, b) => a.code.localeCompare(b.code));

if (!files.length) {
  console.error('eval-m27-real-photos: không có ảnh phù hợp trong', inputDir);
  process.exit(1);
}

const t = DEFAULT_SUBJECT_LOCK_THRESHOLDS;
const ALPHA_CUT = 36;

function alphaStats(data) {
  let transparent = 0;
  const total = data.length / 4;
  for (let i = 3; i < data.length; i += 4) if (data[i] < ALPHA_CUT) transparent++;
  return transparent / total;
}

function alphaMask(data) {
  const mask = new Uint8Array(data.length / 4);
  for (let p = 0, i = 3; i < data.length; i += 4, p++) mask[p] = data[i] >= 128 ? 1 : 0;
  return mask;
}

function compositeWhite(data) {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < ALPHA_CUT) {
      out[i] = 255; out[i + 1] = 255; out[i + 2] = 255; out[i + 3] = 255;
    } else {
      out[i] = data[i]; out[i + 1] = data[i + 1]; out[i + 2] = data[i + 2]; out[i + 3] = 255;
    }
  }
  return out;
}

const results = [];
const failures = [];
const checkFails = { inFrame: 0, singleSubject: 0, stable: 0, lowSpecular: 0, sharp: 0 };
const startedAll = Date.now();

for (const item of files) {
  const started = Date.now();
  try {
    const decoded = decodePng(readFileSync(item.file));
    const { width, height } = decoded;
    const transparency = alphaStats(decoded.data);
    const isCutout = transparency > 0.05;
    const data = isCutout ? compositeWhite(decoded.data) : decoded.data;

    const frame = analyzeFrame({ data, width, height, extractHoles: true });
    const gray = toGray(data, width, height);
    const sharpness = laplacianVariance(gray, width, height);
    const readiness = computeReadiness({
      marginFrac: frame.stats.marginFrac,
      touchesBorder: frame.stats.touchesBorder,
      coverage: frame.stats.coverage,
      otherComponents: frame.stats.otherComponents,
      selectedSize: frame.stats.partPixels,
      specularRatio: frame.stats.specularRatio,
      stableCount: t.stableFrames,
      sharpness
    });
    for (const key of Object.keys(checkFails)) {
      if (!readiness.checks[key]) checkFails[key]++;
    }

    const row = {
      code: item.code,
      kind: isCutout ? 'cutout' : 'camera',
      width,
      height,
      transparency: Number(transparency.toFixed(4)),
      selected: Boolean(frame.selected),
      componentCount: frame.stats.componentCount,
      coverage: Number(frame.stats.coverage.toFixed(4)),
      marginFrac: Number(frame.stats.marginFrac.toFixed(4)),
      touchesBorder: frame.stats.touchesBorder,
      otherComponents: frame.stats.otherComponents.length,
      specularRatio: frame.stats.specularRatio,
      sharpness: Number(sharpness.toFixed(1)),
      ready: readiness.ready,
      checks: readiness.checks,
      holes: {
        total: frame.holes?.total || 0,
        counts: frame.holes?.counts || { circle: 0, square: 0, oval: 0, unknown: 0 }
      },
      ms: Date.now() - started
    };

    if (isCutout) {
      const gt = alphaMask(decoded.data);
      row.alphaMaskPixels = gt.reduce((a, b) => a + b, 0);
      row.alphaIou = Number(maskIoU(frame.mask, gt).toFixed(4));
      row.alphaHoles = analyzeHoles(gt, width, height);
      row.alphaHoles = { total: row.alphaHoles.total, counts: row.alphaHoles.counts };
    }

    if (labels?.has(item.code)) {
      const label = labels.get(item.code);
      const got = row.holes.counts;
      row.expected = { circle: label.circle || 0, square: label.square || 0, oval: label.oval || 0 };
      row.shapeErrors = {
        circle: got.circle - row.expected.circle,
        square: got.square - row.expected.square,
        oval: got.oval - row.expected.oval
      };
    }

    if (Q4_CODES.has(item.code)) {
      row.q4Holes = (frame.holes?.holes || []).map(h => ({
        shape: h.shape, area: h.area, x: h.cx, y: h.cy, fill: h.metrics?.fill, conf: h.confidence
      }));
    }

    results.push(row);
  } catch (error) {
    failures.push({ code: item.code, error: error?.message || String(error) });
  }
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const camera = results.filter(r => r.kind === 'camera');
const cutout = results.filter(r => r.kind === 'cutout');
const labeled = results.filter(r => r.expected);

function categorySummary(list) {
  if (!list.length) return null;
  return {
    count: list.length,
    selected: list.filter(r => r.selected).length,
    ready_static: list.filter(r => r.ready).length,
    coverage_median: Number(median(list.map(r => r.coverage)).toFixed(4)),
    holes_median: median(list.map(r => r.holes.total)),
    holes_total: list.reduce((a, r) => a + r.holes.total, 0)
  };
}

const labelSummary = labeled.length ? {
  codes: labeled.length,
  per_shape_abs_error: {
    circle: Number((labeled.reduce((a, r) => a + Math.abs(r.shapeErrors.circle), 0) / labeled.length).toFixed(2)),
    square: Number((labeled.reduce((a, r) => a + Math.abs(r.shapeErrors.square), 0) / labeled.length).toFixed(2)),
    oval: Number((labeled.reduce((a, r) => a + Math.abs(r.shapeErrors.oval), 0) / labeled.length).toFixed(2))
  },
  exact_shape_match: labeled.filter(r =>
    r.shapeErrors.circle === 0 && r.shapeErrors.square === 0 && r.shapeErrors.oval === 0
  ).length,
  rows: labeled.map(r => ({
    code: r.code,
    kind: r.kind,
    expected: r.expected,
    got: r.holes.counts,
    errors: r.shapeErrors
  }))
} : null;

const report = {
  harness: 'eval-m27-real-photos',
  subject_lock_version: 'subject_lock_v1',
  input_dir: inputDir,
  generated_at: new Date().toISOString(),
  thresholds: t,
  totals: {
    files_found: files.length,
    processed: results.length,
    failed: failures.length,
    camera: camera.length,
    cutout: cutout.length
  },
  camera_summary: categorySummary(camera),
  cutout_summary: cutout.length ? {
    ...categorySummary(cutout),
    alpha_iou_mean: Number((cutout.reduce((a, r) => a + r.alphaIou, 0) / cutout.length).toFixed(4)),
    alpha_iou_min: Math.min(...cutout.map(r => r.alphaIou)),
    alpha_holes_median: median(cutout.map(r => r.alphaHoles.total)),
    note: 'cutout: alpha là mask chính thức; holes của classifier bị trắng lỗ coi là specular'
  } : null,
  check_fail_counts: checkFails,
  label_summary: labelSummary,
  q4_pairs: results.filter(r => Q4_CODES.has(r.code)),
  failures,
  elapsed_ms: Date.now() - startedAll,
  results
};

writeFileSync(outputPath, JSON.stringify(report, null, 2));

const cam = report.camera_summary;
const cut = report.cutout_summary;
console.log(`[M27 real-photo] processed=${results.length} failed=${failures.length}`);
if (cam) console.log(`[camera] n=${cam.count} selected=${cam.selected} ready=${cam.ready_static} coverage_med=${cam.coverage_median} holes_med=${cam.holes_median} holes_total=${cam.holes_total}`);
if (cut) console.log(`[cutout] n=${cut.count} alphaIoU_mean=${cut.alpha_iou_mean} alphaIoU_min=${cut.alpha_iou_min} alphaHoles_med=${cut.alpha_holes_median}`);
console.log(`[check fails] ${JSON.stringify(checkFails)}`);
if (labelSummary) {
  console.log(`[labels] n=${labelSummary.codes} exact=${labelSummary.exact_shape_match} absErr circle/square/oval=${JSON.stringify(labelSummary.per_shape_abs_error)}`);
  for (const row of labelSummary.rows) {
    console.log(`  ${row.code} (${row.kind}) exp=${JSON.stringify(row.expected)} got=${JSON.stringify(row.got)} err=${JSON.stringify(row.errors)}`);
  }
}
for (const r of report.q4_pairs) {
  const sig = r.kind === 'cutout' ? r.alphaHoles : r.holes;
  console.log(`[Q4] ${r.code} (${r.kind}) holes=${sig.total} ${JSON.stringify(sig.counts)} alphaIou=${r.alphaIou ?? '-'} coverage=${r.coverage}`);
}
if (failures.length) console.log('[M27 real-photo] failures:', JSON.stringify(failures));
console.log(`[M27 real-photo] report: ${outputPath}`);
