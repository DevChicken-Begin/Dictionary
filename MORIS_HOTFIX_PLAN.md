# HOTFIX SPECIFICATION: Fix 5 Critical Bugs in Moris 3-Layer V2 Implementation
# Repository: PQVinh99-Glory/Dictionary

Read this hotfix specification carefully and fix all 5 issues in the codebase without using placeholders or breaking existing unit tests.

## BUG 1 (CRITICAL): Blank Canvas in `reindex-batch-v2` & Double Layer-1 Execution in `src/moris/vector/dinov2.worker.js`
- **Problem:**
  1. In `src/moris/vector/dinov2.worker.js` under `message.type === "reindex-batch-v2"`, the extractor callback creates an empty `new OffscreenCanvas(224, 224)` without rendering the image/pseudo-RGB channels onto it!
  2. In `enroll-signature-v2` and `search-v2`, `processLayer1Optical` is executed inside `moris-worker-pipeline.ts` AND executed a second time inside the `dinov2.worker.js` callback.
  3. `@huggingface/transformers` `extractor(canvas)` should be called with `{ pooling: "none" }` (with a fallback to `extractor(canvas)` if options throw) so it always outputs the full `[1, 257, 384]` patch sequence tensor.
- **Fix Required:**
  1. Update `Dinov2FeatureExtractor` signature in `src/moris/moris-worker-pipeline.ts` (and `.js`) to `export type Dinov2FeatureExtractor = (pseudoRgbTensor: Float32Array, opt: OpticalNormalizationResult) => Promise<any>;` and pass `(opt.pseudoRgbTensor, opt)` when calling `await extractor(opt.pseudoRgbTensor, opt)` inside `enrollSkuSignature`, `searchPartTop10`, and `reindexBatchSignatures`.
  2. In `src/moris/vector/dinov2.worker.js`, use `pseudoRgbTensorToCanvas(opt)` inside ALL THREE handlers (`enroll-signature-v2`, `search-v2`, and `reindex-batch-v2`) so `processLayer1Optical` is only run ONCE per image and `reindex-batch-v2` renders the actual 3-channel structural pseudo-RGB canvas!
  3. Call `await extractor(canvas, { pooling: "none" })` to guarantee `[1, 257, 384]` spatial patch output.

## BUG 2 (CRITICAL MATH): Corrupted Channel Indices in `synthesizePerspectiveCentroid` (`src/moris/moris-layer2-embedding.ts`)
- **Problem:**
  In `synthesizePerspectiveCentroid`, Perturbation 3 shifts feature channel index `(d + 7) % 384` and Perturbation 4 reverses feature channel index `dim - 1 - d`. Feature dimensions `0..383` in DINOv2 are semantic channels, NOT spatial coordinates! Permuting channel indices destroys cosine similarity.
- **Fix Required:**
  Update `synthesizePerspectiveCentroid(patchTokens: Float32Array, mask16x16: Float32Array, edge16x16: Float32Array): Float32Array` (and update its callers in `moris-worker-pipeline.ts` / `.js` and tests) so perturbations are computed by re-pooling `patchTokens` (`256 x 384`) over spatial weights on the `16x16` grid:
  - Perturbation 1 (Horizontal tilt foreshortening): Weight columns `c = 0..15` with a linear gradient `0.7 + 0.6 * (c / 15)` on `mask16x16` and re-run `computeHybridMaskedGemEmbedding`.
  - Perturbation 2 (Vertical tilt foreshortening): Weight rows `r = 0..15` with `0.7 + 0.6 * (r / 15)` on `mask16x16` and re-run `computeHybridMaskedGemEmbedding`.
  - Perturbation 3 (High-glare / Edge boost): Boost `edge16x16` weights by `Math.pow(edge16x16[i], 0.75)` and re-run `computeHybridMaskedGemEmbedding`.
  - Perturbation 4 (Boundary erosion simulation): Attenuate border patches where `mask16x16[i] < 0.65` by `0.35 * mask16x16[i]` and re-run `computeHybridMaskedGemEmbedding`.
  - Average the canonical embedding and the 4 spatially-perturbed embeddings, then L2-normalize to produce `perspectiveCentroid`.

## BUG 3 (GEOMETRIC INVARIANCE): Compute Oriented `aspectRatio` and `holeFeatures` AFTER PCA Rotation (`src/moris/moris-layer1-optical.ts`)
- **Problem:**
  In `segmentForegroundAndHoles`, `aspectRatio = bw / bh` is calculated on the unrotated axis-aligned bounding box before PCA rotation. A long part photographed at 45 degrees produces `aspectRatio ≈ 1.0` instead of its true oriented aspect ratio, causing Stage 2A `executeGeometricGate` to reject valid rotated parts.
- **Fix Required:**
  In `processLayer1Optical` (`src/moris/moris-layer1-optical.ts` and `.js`), ensure that `aspectRatio` (`majorAxisWidth / minorAxisHeight`), `solidity`, `holeCount`, and `holeFeatures` (`u, v, relArea`) returned in `OpticalNormalizationResult` are computed from the **PCA-rotated and 180-degree disambiguated canonical mask** (so `aspectRatio` and `(u, v)` hole coordinates are 100% invariant to any 0-360° camera rotation).

## BUG 4 (FRONTEND & WORKER INTEGRATION): Wire Moris V2 3-Layer Pipeline into `src/app.js` & Sync `dist/`
- **Problem:**
  `src/app.js` still only invokes the legacy v1 embedding path (`embedImageDinov2` / `embedImageDinov2Variants`), leaving `searchPartTop10V2` and `enrollSkuSignatureV2` unused during real user searches and part saves.
- **Fix Required:**
  1. Inspect `src/app.js` where Moris image search, camera scan, and SKU vector enrollment/deletion are handled.
  2. Integrate `enrollSkuSignatureV2(skuId, imageSource)` when saving/indexing a part's primary image so local IndexedDB v2 stays populated, and integrate `searchPartTop10V2(imageSource)` in the Moris visual search flow to boost/re-rank local and hybrid candidates using the 3-layer funnel (while gracefully falling back or merging with server results if local IndexedDB is not yet fully populated).
  3. Synchronize all updated files into `dist/src/...` and ensure both `.ts` and `.js` files are completely in sync.

## BUG 5 (VERIFICATION): Run All Tests & Compiler Checks
- Update unit tests in `tests/moris-*.test.ts` if any function signatures changed (such as `synthesizePerspectiveCentroid`), run the full test suite (`npm test` / `npx vitest run`) and `npx tsc --noEmit`, and ensure 100% of tests pass.