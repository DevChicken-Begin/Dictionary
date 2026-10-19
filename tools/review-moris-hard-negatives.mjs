#!/usr/bin/env node
// Curator review CLI for Moris V6 hard-negative review queue.
// Safe, read/write local only, zero network to production database.
// Supports offline review via HTML sheet + local server on localhost:3333.
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { validateHardNegativeCases } from '../evaluation/moris-v6/hardNegatives.js';

export const QUEUE_FILE = 'evaluation/moris-v6/hard-negative-review-queue.json';
export const LABELS_FILE = 'evaluation/moris-v6/hard-negative-labels.json';
export const R2_PUBLIC_BASE = 'https://pub-fe997ecbd0714682b10cba684d175ac8.r2.dev';

export async function loadQueue(path = QUEUE_FILE) {
  const content = await readFile(path, 'utf8');
  return JSON.parse(content);
}

export async function saveQueue(cases, path = QUEUE_FILE) {
  validateHardNegativeCases(cases);
  await writeFile(path, JSON.stringify(cases, null, 2) + '\n');
}

export function parseArgs(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

export function printSummary(cases) {
  const stats = validateHardNegativeCases(cases);
  const tagBreakdown = {};
  for (const c of cases) {
    for (const t of c.tags || []) {
      tagBreakdown[t] = (tagBreakdown[t] || 0) + 1;
    }
  }
  const devLinked = cases.filter(c => c.development_evidence?.queries?.length).length;
  console.log('=== MORIS V6 HARD-NEGATIVE REVIEW QUEUE SUMMARY ===');
  console.log(`Total Cases:           ${stats.cases}`);
  console.log(`Approved:              ${stats.approved}`);
  console.log(`Rejected:              ${stats.rejected || 0}`);
  console.log(`Pending:               ${stats.pending}`);
  console.log(`Dev-Query Linked:      ${devLinked}`);
  console.log('Tag Breakdown:');
  for (const [tag, count] of Object.entries(tagBreakdown)) {
    console.log(`  - ${tag}: ${count}`);
  }
}

export function listCases(cases, filterStatus) {
  const filtered = filterStatus ? cases.filter(c => c.status === filterStatus) : cases;
  console.log(`Showing ${filtered.length} of ${cases.length} cases (filter: ${filterStatus || 'all'}):`);
  console.log('--------------------------------------------------------------------------------');
  for (const c of filtered) {
    const skus = c.sku_pair ? c.sku_pair.join(' vs ') : (c.review_assets?.[0]?.sku || 'unknown');
    const meta = c.proposed_counts ? `counts [${c.proposed_counts.join(', ')}]` : (c.observed_metadata ? `thumb:${c.observed_metadata.thumb} front:${c.observed_metadata.front}` : '');
    const dev = c.development_evidence?.queries?.length ? `[dev-query:${c.development_evidence.queries.length}]` : '';
    console.log(`[${c.status.toUpperCase().padEnd(8)}] ${c.id.padEnd(36)} SKU: ${skus.padEnd(25)} ${meta.padEnd(25)} ${dev}`);
  }
}

export function inspectCase(cases, id) {
  const item = cases.find(c => c.id === id);
  if (!item) {
    console.error(`Case "${id}" not found in review queue.`);
    process.exit(1);
  }
  console.log(JSON.stringify(item, null, 2));
}

export function buildReviewHtml(cases) {
  const stats = validateHardNegativeCases(cases);
  const rows = cases.map((c, idx) => {
    const skus = c.sku_pair ? c.sku_pair.join(' vs ') : (c.review_assets?.[0]?.sku || 'unknown');
    const counts = c.proposed_counts ? `Proposed: ${c.proposed_counts.join(' vs ')}` : (c.observed_metadata ? `Observed: thumb=${c.observed_metadata.thumb}, front=${c.observed_metadata.front}` : 'N/A');
    const images = (c.review_assets || []).map(a => {
      const frontAsset = (a.catalogue_assets || []).find(x => x.asset_type === 'front');
      const r2Url = frontAsset?.image_path ? `${R2_PUBLIC_BASE}/${frontAsset.image_path}` : '';
      const relPath = a.downloaded_front ? a.downloaded_front.path.replace('evaluation/moris-v6/', '') : '';
      const fallbackUrl = r2Url || relPath;
      const front = fallbackUrl ? `
        <div style="margin-top:6px">
          <a href="${fallbackUrl}" target="_blank" title="Xem ảnh gốc">
            <img src="${fallbackUrl}" alt="${a.sku}" loading="lazy" style="max-height:120px;max-width:180px;border-radius:6px;border:1px solid #cbd5e1;object-fit:contain;background:#fff;display:block;" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'160\\' height=\\'100\\'><rect width=\\'100%\\' height=\\'100%\\' fill=\\'%23f1f5f9\\'/><text x=\\'50%\\' y=\\'50%\\' font-size=\\'11\\' fill=\\'%2394a3b8\\' text-anchor=\\'middle\\' dominant-baseline=\\'middle\\'>Ảnh chưa tải</text></svg>'">
          </a>
          <span style="font-size:10px;color:#64748b;display:block;margin-top:2px;">${frontAsset?.image_path || (a.downloaded_front ? `${(a.downloaded_front.bytes/1024).toFixed(1)} KB` : '')}</span>
        </div>` : '<div>Chưa có ảnh</div>';
      return `<div style="display:inline-block;margin-right:16px;vertical-align:top;"><strong>SKU ${a.sku}</strong>: ${front}</div>`;
    }).join('');
    const devQueries = (c.development_evidence?.queries || []).map(q => `Query ${q.query_id} (Rank: ${q.expected_rank || 'N/A'}, Top1: ${q.top1})`).join(', ') || 'None';
    return `
    <tr class="status-${c.status}" id="row-${c.id}" data-id="${c.id}">
      <td style="font-weight:600;color:#64748b;">${idx + 1}</td>
      <td><code>${c.id}</code></td>
      <td><span class="badge badge-${c.status}" id="badge-${c.id}">${c.status}</span></td>
      <td style="font-weight:bold;color:#0f172a;">${skus}</td>
      <td style="font-size:11px;color:#475569;">${counts}</td>
      <td>${images}</td>
      <td style="font-size:11px;color:#64748b;">${devQueries}</td>
      <td style="min-width:210px;">
        <div class="action-buttons">
          <button type="button" class="btn btn-yes" onclick="setDecision('${c.id}', 'confusable')">🟢 Dễ nhầm</button>
          <button type="button" class="btn btn-no" onclick="setDecision('${c.id}', 'not_confusable')">🔴 Khác biệt</button>
          <button type="button" class="btn btn-skip" onclick="setDecision('${c.id}', 'skip')">⚪ Bỏ qua</button>
        </div>
        <input type="text" class="note-input" id="note-${c.id}" placeholder="Ghi chú (tùy chọn)" onchange="setNote('${c.id}', this.value)" style="margin-top:6px;width:100%;box-sizing:border-box;padding:4px 8px;font-size:12px;border:1px solid #cbd5e1;border-radius:4px;">
      </td>
    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>Moris V6 — Bảng Đánh Giá Cặp Linh Kiện Dễ Nhầm (Hard-Negative Review)</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; background: #f8fafc; color: #1e293b; }
    header { background: #0f172a; color: white; padding: 18px 24px; position: sticky; top: 0; z-index: 100; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
    .header-content { max-width: 1400px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
    h1 { margin: 0; font-size: 20px; font-weight: 700; }
    .subtitle { font-size: 13px; color: #94a3b8; margin-top: 4px; }
    .container { max-width: 1400px; margin: 24px auto; padding: 0 24px; }
    .summary { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
    .card { background: white; padding: 12px 20px; border-radius: 8px; border: 1px solid #e2e8f0; min-width: 140px; }
    .card .val { font-size: 24px; font-weight: bold; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    th, td { padding: 12px 14px; text-align: left; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: middle; }
    th { background: #f1f5f9; font-weight: 600; color: #475569; position: sticky; top: 76px; z-index: 10; }
    .badge { padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
    .badge-pending { background: #fef3c7; color: #92400e; }
    .badge-approved { background: #dcfce7; color: #166534; }
    .badge-rejected { background: #fee2e2; color: #991b1b; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #0284c7; }
    .action-buttons { display: flex; gap: 6px; }
    .btn { padding: 6px 10px; font-size: 12px; font-weight: 600; border-radius: 6px; cursor: pointer; border: 1px solid transparent; transition: all 0.15s ease; }
    .btn-yes { background: #ecfdf5; color: #065f46; border-color: #a7f3d0; }
    .btn-yes:hover, .btn-yes.active { background: #059669; color: white; border-color: #059669; }
    .btn-no { background: #fef2f2; color: #991b1b; border-color: #fecaca; }
    .btn-no:hover, .btn-no.active { background: #dc2626; color: white; border-color: #dc2626; }
    .btn-skip { background: #f1f5f9; color: #475569; border-color: #cbd5e1; }
    .btn-skip:hover, .btn-skip.active { background: #64748b; color: white; border-color: #64748b; }
    .btn-action { background: #2563eb; color: white; padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer; font-weight: 600; }
    .btn-action:hover { background: #1d4ed8; }
    .btn-danger { background: #ef4444; color: white; padding: 8px 14px; border-radius: 6px; border: none; cursor: pointer; font-weight: 600; }
    .btn-danger:hover { background: #dc2626; }
    .progress-box { display: flex; align-items: center; gap: 12px; }
    .progress-bar-container { width: 140px; height: 10px; background: #334155; border-radius: 5px; overflow: hidden; }
    .progress-bar-fill { height: 100%; width: 0%; background: #10b981; transition: width 0.2s ease; }
  </style>
</head>
<body>
  <header>
    <div class="header-content">
      <div>
        <h1>Moris V6 — Đánh Giá 57 Cặp Hard-Negative</h1>
        <div class="subtitle">Xem ảnh trực tiếp từ Cloudflare R2 • Đánh giá cặp dễ gây nhầm lẫn để kiểm chuẩn độ chính xác Moris AI</div>
      </div>
      <div class="progress-box">
        <div>
          <span style="font-size:12px;color:#94a3b8;">Tiến độ: </span>
          <strong id="prog-text" style="color:#10b981;">0 / ${cases.length}</strong>
          <div class="progress-bar-container">
            <div class="progress-bar-fill" id="prog-fill"></div>
          </div>
        </div>
        <button type="button" class="btn-action" onclick="exportLabelsJson()">📥 Tải file JSON</button>
        <button type="button" class="btn-action" id="btn-save-server" onclick="saveToServer()" style="display:none;background:#10b981;">💾 Lưu Server</button>
        <button type="button" class="btn-danger" onclick="resetReviews()" title="Xóa toàn bộ đánh giá đang nháp">🔄 Đặt lại</button>
      </div>
    </div>
  </header>
  <div class="container">
    <div class="summary">
      <div class="card"><div>Tổng số cặp cần duyệt</div><div class="val">${stats.cases}</div></div>
      <div class="card"><div>Đã duyệt là dễ nhầm</div><div class="val" id="stat-confusable" style="color:#166534">0</div></div>
      <div class="card"><div>Đã duyệt là khác biệt</div><div class="val" id="stat-not-confusable" style="color:#991b1b">0</div></div>
      <div class="card"><div>Bỏ qua / Chưa rõ</div><div class="val" id="stat-skipped" style="color:#64748b">0</div></div>
      <div class="card"><div>Còn lại chưa duyệt</div><div class="val" id="stat-pending" style="color:#92400e">${stats.cases}</div></div>
    </div>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Mã Case</th>
          <th>Trạng Thái</th>
          <th>Cặp SKU</th>
          <th>Mô Tả / Đặc Điểm</th>
          <th>Hình Ảnh Đối Chiếu (R2)</th>
          <th>Truy Vấn Dev</th>
          <th>Đánh Giá Của Bạn</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>

  <script>
    const STORAGE_KEY = 'moris_hard_negative_reviews_v1';
    let reviews = {};

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) reviews = JSON.parse(saved);
    } catch (e) {
      console.warn('Không đọc được localStorage:', e);
    }

    // Check if running on local server with /api/save
    fetch('/api/status').then(res => {
      if (res.ok) document.getElementById('btn-save-server').style.display = 'inline-block';
    }).catch(() => {});

    function updateUi() {
      const keys = Object.keys(reviews);
      let confusable = 0, notConfusable = 0, skipped = 0;
      for (const id in reviews) {
        const item = reviews[id];
        const row = document.getElementById('row-' + id);
        if (!row) continue;
        const btns = row.querySelectorAll('.btn');
        btns.forEach(b => b.classList.remove('active'));
        if (item.verdict === 'confusable') {
          confusable++;
          row.querySelector('.btn-yes')?.classList.add('active');
        } else if (item.verdict === 'not_confusable') {
          notConfusable++;
          row.querySelector('.btn-no')?.classList.add('active');
        } else if (item.verdict === 'skip') {
          skipped++;
          row.querySelector('.btn-skip')?.classList.add('active');
        }
        const noteInput = document.getElementById('note-' + id);
        if (noteInput && item.note) noteInput.value = item.note;
      }
      const reviewed = confusable + notConfusable + skipped;
      const total = ${cases.length};
      document.getElementById('prog-text').textContent = reviewed + ' / ' + total;
      document.getElementById('prog-fill').style.width = Math.round((reviewed / total) * 100) + '%';
      document.getElementById('stat-confusable').textContent = confusable;
      document.getElementById('stat-not-confusable').textContent = notConfusable;
      document.getElementById('stat-skipped').textContent = skipped;
      document.getElementById('stat-pending').textContent = Math.max(0, total - reviewed);
    }

    function setDecision(id, verdict) {
      if (!reviews[id]) reviews[id] = { id, reviewed_at: new Date().toISOString() };
      reviews[id].verdict = verdict;
      reviews[id].reviewed_at = new Date().toISOString();
      persist();
      updateUi();
    }

    function setNote(id, note) {
      if (!reviews[id]) reviews[id] = { id, verdict: 'skip', reviewed_at: new Date().toISOString() };
      reviews[id].note = note;
      persist();
    }

    function persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(reviews));
      } catch (e) {
        console.warn('Lỗi lưu localStorage:', e);
      }
    }

    function exportLabelsJson() {
      const list = Object.values(reviews);
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(list, null, 2));
      const a = document.createElement('a');
      a.setAttribute('href', dataStr);
      a.setAttribute('download', 'hard-negative-labels.json');
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    async function saveToServer() {
      const list = Object.values(reviews);
      try {
        const res = await fetch('/api/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(list)
        });
        if (res.ok) {
          alert('Đã lưu thành công ' + list.length + ' đánh giá vào server!');
        } else {
          alert('Lỗi lưu server: ' + (await res.text()));
        }
      } catch (e) {
        alert('Không kết nối được server: ' + e.message);
      }
    }

    function resetReviews() {
      if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ đánh giá đang nháp?')) return;
      reviews = {};
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    }

    updateUi();
  </script>
</body>
</html>`;
}

export async function exportHtml(cases, outPath = 'evaluation/moris-v6/hard-negative-review-sheet.html') {
  const html = buildReviewHtml(cases);
  await writeFile(outPath, html, 'utf8');
  console.log(`Exported review sheet to ${outPath} (${Buffer.byteLength(html)} bytes).`);
}

export async function applyLabels(cases, labelsPath = LABELS_FILE, curator = 'owner', savePath = null) {
  const raw = await readFile(labelsPath, 'utf8');
  const labels = JSON.parse(raw);
  const labelMap = new Map((Array.isArray(labels) ? labels : Object.values(labels)).map(l => [l.id, l]));

  let appliedRejects = 0;
  let appliedApprovals = 0;
  for (const c of cases) {
    const l = labelMap.get(c.id);
    if (!l) continue;
    if (l.verdict === 'not_confusable') {
      c.status = 'rejected';
      c.curator = l.curator || curator;
      c.reviewed_at = l.reviewed_at || new Date().toISOString();
      c.rejection_reason = l.note || 'Curator verified as not confusable';
      c.expected_outcome = null;
      appliedRejects++;
    } else if (l.verdict === 'confusable') {
      // Confusable pair noted by curator. Full approval requires snapshot hashes per gate protocol.
      c.review_notes = l.note || 'Curator noted as confusable hard negative';
      appliedApprovals++;
    }
  }

  if (savePath) {
    await saveQueue(cases, savePath);
    console.log(`Applied labels from ${labelsPath} to ${savePath}: ${appliedRejects} rejected, ${appliedApprovals} confusable pairs noted.`);
  } else {
    console.log(`Applied labels from ${labelsPath} in-memory: ${appliedRejects} rejected, ${appliedApprovals} confusable pairs noted.`);
  }
  return { appliedRejects, appliedApprovals };
}

export async function recordReject(cases, id, curator, reason) {
  if (!id || !curator || !reason) {
    console.error('Error: --id, --curator, and --reason are required for --record-reject.');
    process.exit(1);
  }
  const item = cases.find(c => c.id === id);
  if (!item) {
    console.error(`Case "${id}" not found.`);
    process.exit(1);
  }
  item.status = 'rejected';
  item.curator = curator;
  item.reviewed_at = new Date().toISOString();
  item.rejection_reason = reason;
  item.expected_outcome = null;
  await saveQueue(cases);
  console.log(`Successfully recorded rejection for ${id} by ${curator}.`);
}

export async function recordApprove(cases, id, curator, outcome, beforeSha, afterSha) {
  if (!id || !curator || !outcome || !beforeSha || !afterSha) {
    console.error('Error: --id, --curator, --outcome, --before-sha, and --after-sha are required for --record-approve.');
    process.exit(1);
  }
  const hex64 = /^[a-f0-9]{64}$/;
  if (!hex64.test(beforeSha) || !hex64.test(afterSha)) {
    console.error('Error: before-sha and after-sha must be valid 64-char hex SHA-256 strings.');
    process.exit(1);
  }
  const item = cases.find(c => c.id === id);
  if (!item) {
    console.error(`Case "${id}" not found.`);
    process.exit(1);
  }
  const images = (item.review_assets || []).map(a => ({
    sku: a.sku,
    sha256: a.downloaded_front?.sha256
  })).filter(img => img.sku && hex64.test(img.sha256 || ''));
  if (images.length < 2) {
    console.error(`Error: Case "${id}" does not have at least 2 verified image hashes in review_assets.`);
    process.exit(1);
  }
  item.status = 'approved';
  item.curator = curator;
  item.reviewed_at = new Date().toISOString();
  item.expected_outcome = outcome;
  item.images = images;
  item.before_snapshot_sha256 = beforeSha;
  item.after_snapshot_sha256 = afterSha;
  item.rejection_reason = undefined;
  await saveQueue(cases);
  console.log(`Successfully recorded approval for ${id} by ${curator}.`);
}

export async function startServer(cases, port = 3333) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = buildReviewHtml(cases);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', cases: cases.length }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/save') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const list = JSON.parse(body);
          await writeFile(LABELS_FILE, JSON.stringify(list, null, 2) + '\n');
          console.log(`Saved ${list.length} reviews to ${LABELS_FILE}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, saved: list.length }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }
    res.writeHead(404).end('Not found');
  });

  return new Promise((res, rej) => {
    server.listen(port, () => {
      console.log(`\n========================================================================`);
      console.log(`  MORIS V6 HARD-NEGATIVE REVIEW SERVER ĐANG CHẠY`);
      console.log(`  Địa chỉ: http://localhost:${port}`);
      console.log(`  Chủ dự án chỉ cần mở link trên trong trình duyệt để review trực quan.`);
      console.log(`========================================================================\n`);
      res(server);
    });
    server.on('error', rej);
  });
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const cases = await loadQueue();

  if (flags['inspect']) {
    inspectCase(cases, flags['inspect']);
  } else if (flags['list']) {
    listCases(cases, typeof flags['filter'] === 'string' ? flags['filter'] : null);
  } else if (flags['export-html']) {
    const out = typeof flags['export-html'] === 'string' ? flags['export-html'] : 'evaluation/moris-v6/hard-negative-review-sheet.html';
    await exportHtml(cases, out);
  } else if (flags['apply-labels']) {
    const path = typeof flags['apply-labels'] === 'string' ? flags['apply-labels'] : LABELS_FILE;
    await applyLabels(cases, path, typeof flags['curator'] === 'string' ? flags['curator'] : 'owner', QUEUE_FILE);
  } else if (flags['serve']) {
    const port = typeof flags['port'] === 'number' || typeof flags['port'] === 'string' ? Number(flags['port']) : 3333;
    await startServer(cases, port);
  } else if (flags['record-reject']) {
    await recordReject(cases, flags['id'], flags['curator'], flags['reason']);
  } else if (flags['record-approve']) {
    await recordApprove(cases, flags['id'], flags['curator'], flags['outcome'], flags['before-sha'], flags['after-sha']);
  } else {
    printSummary(cases);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.dirname, 'review-moris-hard-negatives.mjs')) {
  main().catch(err => {
    console.error('Review tool failed:', err);
    process.exit(1);
  });
}
