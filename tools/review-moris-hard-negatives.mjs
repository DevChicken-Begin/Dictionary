#!/usr/bin/env node
// Curator review CLI for Moris V6 hard-negative review queue.
// Safe, read/write local only, zero network, zero production mutation.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateHardNegativeCases } from '../evaluation/moris-v6/hardNegatives.js';

const QUEUE_FILE = 'evaluation/moris-v6/hard-negative-review-queue.json';

async function loadQueue() {
  const content = await readFile(QUEUE_FILE, 'utf8');
  return JSON.parse(content);
}

async function saveQueue(cases) {
  validateHardNegativeCases(cases);
  await writeFile(QUEUE_FILE, JSON.stringify(cases, null, 2) + '\n');
}

function parseArgs(args) {
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

function printSummary(cases) {
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

function listCases(cases, filterStatus) {
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

function inspectCase(cases, id) {
  const item = cases.find(c => c.id === id);
  if (!item) {
    console.error(`Case "${id}" not found in review queue.`);
    process.exit(1);
  }
  console.log(JSON.stringify(item, null, 2));
}

async function exportHtml(cases, outPath = 'evaluation/moris-v6/hard-negative-review-sheet.html') {
  const stats = validateHardNegativeCases(cases);
  const rows = cases.map((c, idx) => {
    const skus = c.sku_pair ? c.sku_pair.join(' vs ') : (c.review_assets?.[0]?.sku || 'unknown');
    const counts = c.proposed_counts ? `Proposed: ${c.proposed_counts.join(' vs ')}` : (c.observed_metadata ? `Observed: thumb=${c.observed_metadata.thumb}, front=${c.observed_metadata.front}` : 'N/A');
    const images = (c.review_assets || []).map(a => {
      const relPath = a.downloaded_front ? a.downloaded_front.path.replace('evaluation/moris-v6/', '') : null;
      const front = relPath ? `<div style="margin-top:4px"><img src="${relPath}" alt="${a.sku}" style="max-height:90px;max-width:140px;border-radius:4px;border:1px solid #cbd5e1;object-fit:contain;background:#fff;display:block;" onerror="this.style.display='none'"><span style="font-size:10px;color:#64748b">${(a.downloaded_front.bytes/1024).toFixed(1)} KB</span></div>` : '<div>No local front</div>';
      return `<div style="display:inline-block;margin-right:12px;vertical-align:top;"><strong>SKU ${a.sku}</strong>: ${front}</div>`;
    }).join('');
    const devQueries = (c.development_evidence?.queries || []).map(q => `Query ${q.query_id} (Rank: ${q.expected_rank || 'N/A'}, Top1: ${q.top1})`).join(', ') || 'None';
    return `
    <tr class="status-${c.status}">
      <td>${idx + 1}</td>
      <td><code>${c.id}</code></td>
      <td><span class="badge badge-${c.status}">${c.status}</span></td>
      <td>${skus}</td>
      <td>${counts}</td>
      <td>${images}</td>
      <td>${devQueries}</td>
      <td>${c.curator ? `${c.curator} (${c.reviewed_at})` : '<em>Unassigned</em>'}</td>
      <td>${c.expected_outcome || c.rejection_reason || '<em>Pending</em>'}</td>
    </tr>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Moris V6 Hard-Negative Review Queue</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 24px; background: #f8fafc; color: #1e293b; }
    h1 { margin-bottom: 8px; }
    .summary { display: flex; gap: 16px; margin-bottom: 24px; }
    .card { background: white; padding: 12px 20px; border-radius: 8px; border: 1px solid #e2e8f0; }
    .card .val { font-size: 24px; font-weight: bold; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; }
    th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
    th { background: #f1f5f9; font-weight: 600; }
    .badge { padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
    .badge-pending { background: #fef3c7; color: #92400e; }
    .badge-approved { background: #dcfce7; color: #166534; }
    .badge-rejected { background: #fee2e2; color: #991b1b; }
    code { font-family: ui-monospace, monospace; font-size: 11px; }
  </style>
</head>
<body>
  <h1>Moris V6 — Hard-Negative Review Queue</h1>
  <p>Local offline review sheet for domain curators. Review 57 cases against catalogue images in <code>evaluation/moris-v6/private/catalogue-front/</code>.</p>
  <div class="summary">
    <div class="card"><div>Total Cases</div><div class="val">${stats.cases}</div></div>
    <div class="card"><div>Approved</div><div class="val" style="color:#166534">${stats.approved}</div></div>
    <div class="card"><div>Rejected</div><div class="val" style="color:#991b1b">${stats.rejected || 0}</div></div>
    <div class="card"><div>Pending</div><div class="val" style="color:#92400e">${stats.pending}</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Case ID</th>
        <th>Status</th>
        <th>SKU</th>
        <th>Counts / Lead</th>
        <th>Images</th>
        <th>Dev Query</th>
        <th>Curator</th>
        <th>Decision / Reason</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;

  await writeFile(outPath, html, 'utf8');
  console.log(`Exported review sheet to ${outPath} (${Buffer.byteLength(html)} bytes).`);
}

async function recordReject(cases, id, curator, reason) {
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

async function recordApprove(cases, id, curator, outcome, beforeSha, afterSha) {
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
  } else if (flags['record-reject']) {
    await recordReject(cases, flags['id'], flags['curator'], flags['reason']);
  } else if (flags['record-approve']) {
    await recordApprove(cases, flags['id'], flags['curator'], flags['outcome'], flags['before-sha'], flags['after-sha']);
  } else {
    printSummary(cases);
  }
}

main().catch(err => {
  console.error('Review tool failed:', err);
  process.exit(1);
});
