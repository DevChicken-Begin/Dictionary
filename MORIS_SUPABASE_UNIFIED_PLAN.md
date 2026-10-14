# MORIS UNIFIED 3-LAYER SUPABASE & SEMANTIC-GEOMETRIC UPGRADE PLAN
# Repository: PQVinh99-Glory/Dictionary
# Target: Mobile PWA (iOS Safari Safe), 384D Supabase pgvector, Dual-Mode Segmentation & Flexible Feature Search

## 1. ARCHITECTURAL OBJECTIVES
1. **Single Source of Truth on Supabase (384-Dim):** Remove reliance on client-side IndexedDB (`moris-idb`) for production search. Keep `DINOv2-small` (`384-dim`, WASM q8/fp16) for mobile Safari stability and fuse `Masked-GeM (384D)` + `Edge-Detail (384D)` directly into normalized **384-dimensional vectors** stored in Supabase `catalogue_image_vectors`.
2. **Dual-Mode Layer 1 Segmentation & Small-Hole Preservation:**
   - **R2 Catalogue Images (`alphaAware = true`):** Transparent WebP images (or black-background converted images) where alpha channel or zero-RGB border cleanly defines the mask without false holes inside dark 3D embossed shadows.
   - **Live Camera / Gallery Photos (`alphaAware = false`):** Raw photos taken on a bright surface under the steel part. Suppress perimeter drop-shadows and detect enclosed holes by comparing local cavity luminance against the bright background and local gradient rings.
   - **Small-Hole Threshold & Big/Small Hole Clustering:** Lower minimum hole area to `0.04%` of foreground area (`Math.max(8, Math.round(fgArea * 0.0004))`) so small locating holes (e.g., 44px-79px on long brackets) are never lost. Automatically cluster detected holes into `big_hole_count` and `small_hole_count` using 1D Log-Area K-Means (Otsu split).
3. **3D Embossed Surface Flip Invariance (Convex <-> Concave Relief):**
   - In Layer 1 PCA alignment, only apply pure 2D in-plane rotation (`0 deg` or `180 deg` where both `flipH` and `flipV` are toggled together).
   - In Layer 2 variant generation (`embedImageDinov2Variants`), generate two 384D probes for Supabase:
     - `canon_rgb_v2`: 384D Masked-GeM + Edge-Detail vector from the 3-channel structural pseudo-RGB (`[CLAHE_L, Scharr_Edge, Chamfer_Distance]`).
     - `canon_gray_v2`: 384D Relief-Inverted & Mirror-Blended vector (where internal luminance relief is inverted around steel mean luminance `L' = 2 * mean_L - L` to simulate flipping a convex embossed face into a concave recessed face).
4. **Order-Independent & Perceptual Feature Search (`featureMatcher.js` + SQL):**
   - Parse Vietnamese `identifying_features` and user search queries (e.g., `"5 lỗ tròn 4 lỗ to + 1 lỗ nhỏ"` or reversed `"1 lỗ nhỏ 4 lỗ to 5 lỗ tròn"`) into a canonical AST: `{ totalHoles, bigHoles, smallHoles, holeShapes, structuralTags }`.
   - Enforce strict number boundaries (`(?<!\d)N(?!\d)`) so searching `2` never matches `12` or `22`.
   - Support commutative order (`A + B == B + A`), implicit total inference (`"3 lỗ to 2 lỗ nhỏ"` implies `totalHoles = 5`), and optional perceptual tolerance (`+/- 1` shift between big and small holes when total hole count matches).
5. **Cross-Modal Layer 3 Re-ranking (`geometricReranker.js`):**
   - Fuse Vector Similarity + Hole Constellation Chamfer Distance (with mirror invariance so both Left/Right sibling parts enter Top 10) + Aspect Ratio + **Cross-Modal Big/Small Hole verification** against the candidate's text `identifying_features` (automatically recovering any DB row where `hole_count` was accidentally saved as `0`).

---

## 2. DETAILED MODULE SPECIFICATIONS

### MODULE A: `src/moris/moris-layer1-optical.ts` (and `.js`)
1. **Dual-Mode Foreground & Hole Segmentation (`segmentForegroundAndHoles`):**
   - Detect if image has transparent background (`alphaFg > total * 0.01`) OR pure black cutout background (`borderLuma < 8 && borderSpread < 5`).
   - **If Cutout/R2 Mode:** Foreground is `alpha >= 36` (or `luma >= 10` for black-matte cutouts). Internal holes are enclosed cavities with `alpha < 36` (or `luma < 8`). Do NOT cut dark metal shadow regions (`luma >= 10`) into fake holes.
   - **If Live Camera Bright-Background Mode:** Background is bright (`bgLuma > 110`). Compute adaptive shadow-tolerant threshold so soft drop-shadows next to the steel edge are excluded from foreground, and internal holes are verified if cavity mean luminance is `>= bgLuma * 0.55` or `>= localMetalLuma * 1.35`.
   - Set `minHoleArea = Math.max(8, Math.round(fgArea * 0.0004))` (and `>= 2` pixels on the `224x224` canonical mask) so small holes down to 0.04% area are preserved.
2. **Automatic Big vs. Small Hole Clustering (`classifyHoleSizes1D`):**
   - Given hole areas sorted descending `A[0..N-1]`:
   - If `N === 0`, return `{ totalHoles: 0, bigHoles: 0, smallHoles: 0 }`.
   - If `N === 1` or `A[0] / A[N - 1] < 1.45`, all holes are similar in size (`bigHoles = N, smallHoles = 0`).
   - Otherwise, apply 1D K-Means / Otsu variance minimization on `ln(A[i])` across split index `k = 1..N-1` to partition holes into `bigHoles = k` and `smallHoles = N - k`.
   - Attach `isBig: boolean` and `radius: number` (`sqrt(area / PI) / max(bw, bh)`) to each hole in `holeFeatures` so format matches Supabase `hole_centroids` (`{ x, y, area, radius, is_big }`).
3. **Strict In-Plane 180-Degree Canonical Alignment:**
   - After rotating by `-theta` (PCA horizontal axis), resolve 180-degree in-plane ambiguity by checking the weighted hole/detail centroid relative to foreground centroid (`dx = x_detail - x_fg`). If `dx < 0`, rotate 180 degrees in-plane by flipping BOTH X and Y (`flipH = true` AND `flipV = true` simultaneously).

### MODULE B: `src/moris/moris-layer2-embedding.ts` (and `.js`) & `src/moris/vector/dinov2.worker.js`
1. **384-Dim Hybrid Masked-GeM + Edge-Detail Vector (`computeSupabase384HybridEmbedding`):**
   - From DINOv2 `256 x 384` patch tokens, compute L2-normalized `gemVec` (384D, Signed GeM `p = 3.0` on foreground patches) and L2-normalized `detailVec` (384D, weighted by `mask16x16 * edge16x16`).
   - Fuse directly in 384-dimensional space:
     `v384 = l2NormalizeVector(0.55 * gemVec + 0.45 * detailVec)` (384 floats).
2. **Relief-Inverted Back-Face Probe (`computeReliefInverted384Embedding`):**
   - Construct a relief-inverted structural pseudo-RGB where Channel 0 CLAHE luminance inside `fgMask` is inverted around foreground mean (`1.0 - claheLuminance[i]`), horizontally mirrored, and pooled via `computeSupabase384HybridEmbedding` to produce the second 384D probe (`canon_gray_v2`).
3. **Upgrade `embedImageDinov2Variants` in `src/moris/vector/browserDinov2.js`:**
   - Route `embedImageDinov2Variants` through the Worker's Layer 1 + Layer 2 384D pipeline so every vector saved to or queried against Supabase `catalogue_image_vectors` uses the new 3-Layer architecture and returns enriched `geometry`:
     `{ hole_count, big_hole_count, small_hole_count, aspect_ratio, solidity, hole_centroids, efd_coefficients }`.

### MODULE C: `functions/_lib/moris/v5/retrieval/featureMatcher.js`
1. **Structured Hole & Feature AST Parser (`parseIdentifyingFeaturesAST`):**
   - Parse any Vietnamese feature string into:
     - `totalHoles`: number | null (e.g., `"5 lỗ tròn"`, `"8 lỗ"` -> `5`, `8`)
     - `bigHoles`: number | null (e.g., `"4 lỗ to"`, `"4 to"`, `"4 lỗ tròn to"` -> `4`)
     - `smallHoles`: number | null (e.g., `"1 lỗ nhỏ"`, `"1 nhỏ"`, `"1 lỗ tròn nhỏ"` -> `1`)
     - `otherNumberedPairs`: array of `{ count, noun }` with strict digit boundary `(?<!\d)\d+(?!\d)`
     - `keywords`: normalized structural phrases (`"uốn cong"`, `"dập nổi"`, `"lỗ vuông"`, `"lỗ bầu dục"`, `"vát góc"`, etc.)
   - **Auto-Inference Rule:** If a query or description specifies `bigHoles` and `smallHoles` (e.g., `"3 lỗ to + 2 lỗ nhỏ"` or `"2 lỗ nhỏ 3 lỗ to"`) without stating `totalHoles`, infer `totalHoles = bigHoles + smallHoles`. Conversely, if `totalHoles` and one subset (`bigHoles` or `smallHoles`) are given, infer the other (`smallHoles = totalHoles - bigHoles`).
2. **Flexible & Commutative Matching (`matchFeatureQueryFlexible`):**
   - Order-independent matching: `"5 lỗ tròn 2 lỗ nhỏ + 3 lỗ to"` matches `"5 lỗ tròn 3 lỗ to + 2 lỗ nhỏ"` with score `1.0` (`exact_match`).
   - Partial constraint matching: Query `"5 lỗ tròn"` matches any SKU with `totalHoles === 5`. Query `"5 lỗ tròn 1 lỗ nhỏ"` matches SKUs with `totalHoles === 5 && smallHoles === 1`.
   - Perceptual tolerance tier: If `totalHoles` matches exactly AND `Math.abs(q.bigHoles - db.bigHoles) === 1` (human eye borderline big/small judgment), return `{ matched: true, tier: 'perceptual_tolerance', score: 0.85 }` so candidates are ranked right after exact `1.0` matches.
   - Strict rejection of wrong numbers: Searching `2 lỗ` NEVER matches `12 lỗ` or `22 lỗ`.

### MODULE D: `src/moris/retrieval/geometricReranker.js` & `functions/_lib/moris/v5/retrieval/geometricReranker.js`
1. **Cross-Modal Geometry + Text Verification (`scoreCandidateGeometry`):**
   - Parse the candidate's `identifying_features` text using `parseIdentifyingFeaturesAST`.
   - If the candidate's DB vector row has missing/corrupted geometry (`hole_count === 0` and `aspect_ratio === 1.0`, as found in 72 legacy `front` rows), automatically backfill `expectedHoles`, `expectedBig`, and `expectedSmall` from the parsed `identifying_features` text!
   - Compute `s_holes` by combining:
     - Total hole count & big/small hole count agreement (against both DB geometry and parsed `identifying_features` text).
     - Symmetric Chamfer / Centroid distance in `[0, 1]` coordinates with mirror invariance (`x <-> 1 - x` and `y <-> 1 - y`) so both Left and Right sibling SKUs score high into the Top 10.
   - Compute `s_ratio` using oriented aspect ratio invariance (`Math.max(w/h, h/w)`).
   - Fuse final score in `[0, 1]` range:
     `final_score = 0.45 * S_vec + 0.40 * S_holes_and_text_bridge + 0.15 * S_ratio`.