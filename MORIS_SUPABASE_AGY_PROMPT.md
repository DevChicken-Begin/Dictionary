# TASK PROMPT FOR AGY CLI (GEMINI 3.8 FLASH)

Read `MORIS_SUPABASE_UNIFIED_PLAN.md` in the root of this repository and execute the unified upgrade across Layer 1, Layer 2, Layer 3, `featureMatcher.js`, and `src/app.js`.

## STRICT RULES
1. **Zero Placeholders / Pure TypedArray Math:** Do not write `// TODO` or mock functions. Keep all `.ts`, `.js`, and `dist/` files 100% synchronized.
2. **384-Dim Supabase Native & Mobile Safari Safe:** Do NOT use heavy models or require IndexedDB for search in `src/app.js`. All embeddings sent to Supabase `catalogue_image_vectors` MUST be L2-normalized 384-dimensional vectors (`DIMENSION = 384`).

## STEP-BY-STEP EXECUTION
1. **Step 1 — Upgrade Layer 1 (`src/moris/moris-layer1-optical.ts` & `.js`):**
   - Implement Dual-Mode segmentation in `segmentForegroundAndHoles`: cleanly handle R2 transparent/black-cutout images (never turning dark 3D embossed shadows into fake holes) AND live camera bright-background photos.
   - Lower `minHoleArea` to `0.04%` of foreground area (`Math.max(8, Math.round(fgArea * 0.0004))`) so small locating holes (44px-80px) are preserved.
   - Implement `classifyHoleSizes1D` (1D Log-Area K-Means/Otsu split) to classify holes into `bigHoleCount` and `smallHoleCount`, and include `{ x, y, u, v, area, radius, isBig }` in `holeFeatures`.
   - Fix 180-degree PCA disambiguation so it only performs true 2D in-plane 180-degree rotation (`flipH` and `flipV` applied together when `dx < 0`), never a single-axis mirror flip.
   - Compute `aspectRatio` as `Math.max(cW, cH) / Math.max(1, Math.min(cW, cH))` (`>= 1.0`) so it matches the existing Supabase `aspect_ratio` convention (`3.0 - 10.2`).

2. **Step 2 — Upgrade Layer 2 & Worker to Native 384D Supabase Probes (`src/moris/moris-layer2-embedding.ts`, `.js`, `src/moris/vector/dinov2.worker.js`, `src/moris/vector/browserDinov2.js`):**
   - Add `computeSupabase384HybridEmbedding(patchTokens, mask16x16, edge16x16)` returning a 384-dim L2-normalized vector (`0.55 * gemVec + 0.45 * detailVec`).
   - Add `computeReliefInvertedOptical(opt)` in Worker to generate the second 384D probe (`canon_gray_v2`) by inverting internal CLAHE relief (`1.0 - claheLuminance`) to handle convex-to-concave face flips.
   - Update `embedImageDinov2Variants` in `browserDinov2.js` (and a new worker handler `embed-variants-v2` in `dinov2.worker.js`) so that calling `embedImageDinov2Variants` runs the Layer 1 + Layer 2 384D pipeline inside the Web Worker (with fallback to `imageCanonicalizer` in headless test environments if needed) and returns `probes` (`canon_rgb_v2`, `canon_gray_v2`) plus full `geometry`: `{ hole_count, big_hole_count, small_hole_count, aspect_ratio, solidity, hole_centroids }`.

3. **Step 3 — Upgrade Flexible & Commutative Feature Matcher (`functions/_lib/moris/v5/retrieval/featureMatcher.js` & `src/app.js`):**
   - Implement `parseIdentifyingFeaturesAST(text)` to extract `{ totalHoles, bigHoles, smallHoles, numberedFeatures, keywords }` with strict digit boundaries (`(?<!\d)\d+(?!\d)` so `2` never matches `22`).
   - Support order-independent matching (`"5 lỗ tròn 2 lỗ nhỏ + 3 lỗ to"` == `"5 lỗ tròn 3 lỗ to + 2 lỗ nhỏ"` == `"2 nhỏ 3 to"`), implicit hole total inference (`big + small = total`), partial hole filtering, and perceptual tolerance (`+/- 1` between big/small holes when total holes match).
   - Export and use this flexible matcher in both backend (`functions/_lib/moris/v5/retrieval/featureMatcher.js`) and frontend catalogue filter (`src/app.js`).

4. **Step 4 — Upgrade Layer 3 Cross-Modal Geometric Reranker (`src/moris/retrieval/geometricReranker.js` & `functions/_lib/moris/v5/retrieval/geometricReranker.js`):**
   - In `scoreCandidateGeometry`, parse the candidate's `identifying_features` text to extract `{ totalHoles, bigHoles, smallHoles }`.
   - If the candidate DB row has `hole_count === 0` (legacy corrupted `front` rows) while its `identifying_features` text specifies holes, automatically use the text's hole counts so the candidate is not falsely penalized!
   - Incorporate `big_hole_count` and `small_hole_count` matching (between Query image geometry and Candidate geometry + `identifying_features` text) alongside mirror-invariant centroid matching (`x <-> 1-x`, `y <-> 1-y`) and aspect ratio similarity.
   - Clean up `src/app.js` so it relies directly on the unified Supabase vector + Cross-Modal Layer 3 flow without IndexedDB split-brain issues.

5. **Step 5 — Sync `dist/` and Verify All Tests:**
   - Copy all updated files to `dist/src/...`.
   - Add unit tests in `tests/moris-features-filter.test.js` and `tests/moris-reranker.test.js` covering reversed hole order (`"5 lỗ tròn 2 lỗ nhỏ + 3 lỗ to"`), strict number boundaries (`2` vs `22`), 1D big/small hole clustering, and cross-modal recovery when DB `hole_count` is `0`.
   - Run `npx vitest run` and `npx --no-install tsc --noEmit` until 100% of tests pass.