export const R2_ORPHAN_BUCKET = 'catalogue-images';

// 77 object legacy prefix `parts/` được chủ dự án quyết định giữ lại sau purge 2026-10-17.
export const R2_ORPHAN_KEEP_PREFIXES = Object.freeze(['parts/']);

export const R2_ORPHAN_LIMITS = Object.freeze({
  maxTargets: 500,
  maxBytes: 20 * 1024 * 1024
});

export function buildKeyTypeSummary(keys) {
  const byType = {};
  for (const key of keys) {
    const type = String(key || '').split('/')[0] || 'unknown';
    byType[type] = (byType[type] || 0) + 1;
  }
  return byType;
}

export function selectR2OrphanTargets(objects, referenced, keepPrefixes = R2_ORPHAN_KEEP_PREFIXES) {
  const orphans = [];
  const kept = [];
  const targets = [];
  for (const object of objects) {
    if (referenced.has(object.key)) continue;
    orphans.push(object);
    if (keepPrefixes.some(prefix => object.key.startsWith(prefix))) {
      kept.push(object);
    } else {
      targets.push(object);
    }
  }
  return { orphans, kept, targets };
}
