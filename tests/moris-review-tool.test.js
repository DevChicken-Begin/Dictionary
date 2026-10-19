import { describe, it, expect } from 'vitest';
import { buildReviewHtml, parseArgs, applyLabels } from '../tools/review-moris-hard-negatives.mjs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('moris hard-negative review tool', () => {
  const sampleCases = [
    {
      id: 'test-case-1',
      source_kind: 'catalogue',
      status: 'pending',
      tags: ['test'],
      sku_pair: ['3405030101', '3427740001'],
      review_assets: [
        {
          sku: '3405030101',
          record_id: 'rec-1',
          catalogue_assets: [
            { asset_type: 'front', image_path: 'front/3405030101/test.webp' }
          ]
        },
        {
          sku: '3427740001',
          record_id: 'rec-2',
          catalogue_assets: [
            { asset_type: 'front', image_path: 'front/3427740001/test2.webp' }
          ]
        }
      ]
    }
  ];

  it('buildReviewHtml generates interactive HTML with R2 URLs and action buttons', () => {
    const html = buildReviewHtml(sampleCases);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('https://pub-fe997ecbd0714682b10cba684d175ac8.r2.dev/front/3405030101/test.webp');
    expect(html).toContain('https://pub-fe997ecbd0714682b10cba684d175ac8.r2.dev/front/3427740001/test2.webp');
    expect(html).toContain('setDecision');
    expect(html).toContain('exportLabelsJson');
    expect(html).toContain('test-case-1');
  });

  it('parseArgs correctly handles flags with and without values', () => {
    const flags = parseArgs(['--export-html', 'out.html', '--serve', '--port', '4000']);
    expect(flags['export-html']).toBe('out.html');
    expect(flags['serve']).toBe(true);
    expect(flags['port']).toBe('4000');
  });

  it('applyLabels applies rejected verdicts and notes to review queue', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'moris-review-test-'));
    const queuePath = join(tempDir, 'queue.json');
    const labelsPath = join(tempDir, 'labels.json');

    const cases = JSON.parse(JSON.stringify(sampleCases));
    await writeFile(queuePath, JSON.stringify(cases, null, 2));

    const labels = [
      {
        id: 'test-case-1',
        verdict: 'not_confusable',
        note: 'Đặc điểm hoàn toàn khác nhau',
        curator: 'test_curator',
        reviewed_at: '2026-10-19T08:00:00Z'
      }
    ];
    await writeFile(labelsPath, JSON.stringify(labels, null, 2));

    const result = await applyLabels(cases, labelsPath, 'test_curator', queuePath);
    expect(result.appliedRejects).toBe(1);
    expect(cases[0].status).toBe('rejected');
    expect(cases[0].curator).toBe('test_curator');
    expect(cases[0].rejection_reason).toBe('Đặc điểm hoàn toàn khác nhau');

    await rm(tempDir, { recursive: true, force: true });
  });
});
