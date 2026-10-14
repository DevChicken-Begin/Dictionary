# MORIS 3-LAYER ARCHITECTURE UPGRADE SPECIFICATION & EXECUTION PLAN
# Project: PQVinh99-Glory/Dictionary
# Objective: Accurate Top-10 Retrieval from 850 Stamped Steel SKUs (Offline Web Worker)

## 1. PROBLEM STATEMENT & ARCHITECTURAL GOAL
The current image retrieval pipeline suffers from high false-positive rates across 850 stamped steel part SKUs due to:
1. Monochrome dark-gray/black steel surfaces with strong specular glare and workshop shadows.
2. DINOv2 global `[CLS]` token dilution where 95% flat metal surface drowns out <5% critical structural differences (punched holes, embossed ribs, step bends).
3. In-plane camera rotation (0-360 deg), 180-deg flip ambiguity, and 3D perspective tilt.
4. Cold-start enrollment bias when registering a new SKU from a single unnormalized image.

This specification upgrades the "Moris" 3-Layer Harness into an Illumination-Invariant & Spatial-Topological Funnel (850 SKUs -> ~200 Gate -> Top 40 Vector -> Top 10 Re-ranked).

---

## 2. CORE DATA CONTRACT (TypeScript Schema v2)

All Web Workers and IndexedDB stores MUST implement and enforce the following data structures:

    export interface HoleFeature {
      u: number;       // Normalized X coordinate relative to canonical bounding box [-0.5, 0.5]
      v: number;       // Normalized Y coordinate relative to canonical bounding box [-0.5, 0.5]
      relArea: number; // sqrt(holeArea / partForegroundArea)
    }

    export interface SpatialKeyPatch {
      gridIdx: number;   // Patch index in 16x16 grid (0..255)
      weight: number;    // Edge/relief saliency weight [0..1]
      vec: Float32Array; // L2-normalized 384-dim patch vector
    }

    export interface MorisPartSignature {
      skuId: string;
      version: 2;
      // Layer 2A: Hard Geometric Gate Metrics
      aspectRatio: number; // MajorAxisLength / MinorAxisWidth
      solidity: number;    // ForegroundArea / ConvexHullArea
      holeCount: number;   // Count of internal holes with area > 0.8% of part area
      // Layer 2B: Multi-Prototype 768-dim Hybrid Embeddings (384 GeM + 384 Edge Detail)
      canonicalEmbedding: Float32Array;  // 768-dim L2-normalized vector at 0-deg canonical pose
      perspectiveCentroid: Float32Array; // 768-dim L2-normalized centroid of synthetic augmentations
      // Layer 3: Differential Re-ranking Features
      holeConstellation: HoleFeature[];
      efdCoefficients: Float32Array;     // 16 normalized Elliptic Fourier Descriptor harmonics
      keyPatches: SpatialKeyPatch[];     // Top-32 high-gradient patch vectors on the 16x16 grid
    }

---

## 3. LAYER 1: OPTICAL NORMALIZATION & CANONICAL POSE ALIGNMENT
Target Module: `moris-layer1-optical.ts`

### 3.1. Foreground Segmentation & Internal Hole Isolation
- Separate the outer background from internal punched holes using border-seeded flood fill (Connected Components) on the binary mask.
- Define `fgMask` (1 = metal body, 0 = background/holes) and `holeMasks` (connected background components completely enclosed inside the outer contour with area > 0.8% of `fgMask` area).
- Compute `aspectRatio`, `solidity` (ForegroundArea / ConvexHullArea), and `holeCount`.

### 3.2. Canonical Pose Alignment (PCA + 180-Degree Disambiguation)
- Compute 2D spatial central moments (mu20, mu02, mu11) on `fgMask` pixels to find the principal axis angle:
  `theta = 0.5 * Math.atan2(2 * mu11, mu20 - mu02)`
- Rotate both image and mask by `-theta` so the major axis is strictly horizontal (0 degrees).
- Crop tightly around the rotated bounding box with a 6% padding margin and resize to `224 x 224`.
- **180-Degree Flip Fix:** Calculate foreground centroid `(x_fg, y_fg)` and hole/high-gradient centroid `(x_detail, y_detail)`. Enforce deterministic orientation such that `dx = x_detail - x_fg >= 0` and `dy = y_detail - y_fg >= 0` by applying horizontal and/or vertical flips when negative.

### 3.3. 3-Channel Structural Pseudo-RGB Tensor `[1, 3, 224, 224]`
Replace raw RGB image input to DINOv2 with a synthesized 3-channel structural tensor masked by `fgMask`:
- **Channel 0 (Specular-Clamped CLAHE Luminance):** Convert RGB to CIE LAB Luminance `L`. Clamp specular glare spikes above the 98th foreground percentile, apply a 3x3 median filter, and run CLAHE (`8x8` tiles, `clipLimit = 2.5`) to bring out 3D embossed ribs without lighting bias.
- **Channel 1 (Scharr Structural Gradient):** Compute 3x3 Scharr gradient magnitude `sqrt(Gx^2 + Gy^2)` on Channel 0, normalized to `[0, 1]`.
- **Channel 2 (Euclidean / Chamfer Distance Transform):** Compute a two-pass Chamfer (3, 4) or exact Euclidean Distance Transform on `fgMask` (distance from every metal pixel to the nearest outer boundary or internal hole edge), normalized by max distance to `[0, 1]`.
- Apply standard ImageNet normalization (`mean = [0.485, 0.456, 0.406]`, `std = [0.229, 0.224, 0.225]`).

---

## 4. LAYER 2: COARSE GEOMETRIC GATE & HYBRID MASKED-GeM RETRIEVAL
Target Module: `moris-layer2-embedding.ts`

### 4.1. Stage 2A - Hard Geometric Gate (850 -> ~200 SKUs)
- Filter candidate SKU `C` against Query `Q` using tolerances:
  1. `Math.abs(AR_Q - AR_C) / Math.max(AR_Q, AR_C) <= 0.22`
  2. `Math.abs(Solidity_Q - Solidity_C) <= 0.12`
  3. `Math.abs(HoleCount_Q - HoleCount_C) <= 1`
- Fallback: If fewer than 40 candidates pass, widen tolerances by 1.5x and retain top 60 by geometric similarity.

### 4.2. Stage 2B - Foreground-Masked GeM + Edge Detail Pooling (768-dim)
- Extract the `16 x 16 = 256` patch tokens (`Float32Array[256 * 384]`) from `DINOv2-small` ONNX output (skipping index 0 `[CLS]` token).
- Downsample `fgMask` and `scharrEdgeMap` from `224x224` to `16x16` grids (`mask16x16` and `edge16x16`).
- Compute **Signed Generalized Mean Pooling (GeM, p = 3.0)** across foreground patches (`mask16x16[i] >= 0.15`):
  - For each dimension `d` in `0..383`: accumulate `fgW * Math.sign(val) * Math.pow(Math.max(Math.abs(val), 1e-6), 3.0)`, divide by `sum(fgW)`, and apply signed cube root.
- Compute **Edge-Detail Weighted Pooling (`detailVec`, 384-dim)** using weight `w_edge = mask16x16[i] * edge16x16[i]`.
- L2-normalize `gemVec` and `detailVec` independently, then combine into a 768-dim vector:
  `hybridVec = L2Normalize([0.6 * gemVec, 0.4 * detailVec])`

### 4.3. Multi-Prototype Cold-Start Enrollment
- When enrolling a new SKU into IndexedDB, synthesize 4 in-memory geometric/optical perturbations (X/Y perspective foreshortening +/-12 deg, CLAHE clip shift, 1px morphological erosion/dilation) and average their embeddings into `perspectiveCentroid`.
- Candidate similarity score:
  `S_HybridVec(Q, C) = Math.max(dot(v_Q, C.canonicalEmbedding), dot(v_Q, C.perspectiveCentroid))`
- Select Top 40 SKUs for Layer 3.

---

## 5. LAYER 3: TOPOLOGICAL & SPATIAL PATCH RE-RANKING (TOP 40 -> TOP 10)
Target Module: `moris-layer3-rerank.ts`

1. **Dense Spatial Patch Verification (`S_SpatialPatch`):**
   - Select Top-32 patches with highest `edge16x16` weights in Query `Q`.
   - For each query key patch at grid `(r, c)`, compute maximum cosine similarity within a `3x3` window `(r + dr, c + dc)` where `dr, dc in {-1, 0, 1}` in Candidate `C`.
   - Aggregate weighted average by patch saliency weight.

2. **Hole-Constellation Chamfer Distance (`D_HoleGraph`):**
   - Compute symmetric Chamfer Distance between Query hole list `H_Q` and Candidate hole list `H_C` in normalized `(u, v, relArea)` coordinates.
   - Add an explicit penalty if one part has holes and the other has none.

3. **Elliptic Fourier Descriptors (`D_EFD`):**
   - Trace the outer boundary contour of `fgMask`, compute the first 16 Elliptic Fourier harmonic descriptors normalized for scale and starting point, and compute Euclidean distance between `Q` and `C`.

4. **Z-Score Fusion & Final Ranking:**
   - Standardize `S_HybridVec`, `S_SpatialPatch`, `D_HoleGraph`, and `D_EFD` across the 40 candidates using Z-score `(x - mean) / (std + 1e-6)`.
   - Compute final score:
     `FinalScore = 0.35 * Z(S_HybridVec) + 0.30 * Z(S_SpatialPatch) - 0.20 * Z(D_HoleGraph) - 0.15 * Z(D_EFD)`
   - Return the sorted Top 10 SKUs with detailed sub-scores.

---

## 6. STEP-BY-STEP IMPLEMENTATION MILESTONES
- **Step 1 (`moris-layer1-optical.ts`):** Implement segmentation, PCA + 180-deg canonical alignment, CLAHE, Scharr gradient, Chamfer Distance Transform, and `buildStructuralPseudoRGBTensor`.
- **Step 2 (`moris-layer2-embedding.ts`):** Implement ONNX patch token extraction, 768-dim Masked-GeM + Edge pooling, Hard Geometric Gate, and Multi-Prototype Cold-Start generator.
- **Step 3 (`moris-layer3-rerank.ts`):** Implement 3x3 neighborhood spatial patch matcher, Hole-Constellation Chamfer distance, 16-harmonic EFD, and Z-Score Fusion ranker.
- **Step 4 (Worker & IndexedDB Integration):** Wire Layers 1-3 into the Moris Web Worker and IndexedDB storage manager, add a batch re-indexing utility for the 850 SKUs, and verify zero TypeScript build errors.