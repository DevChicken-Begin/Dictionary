/**
 * moris-layer3-rerank.ts
 * ============================================================================
 * MORIS 3-LAYER COMPUTER VISION HARNESS — LAYER 3: TOPOLOGICAL & SPATIAL RERANK
 * 
 * 100% Offline Web Worker & Node.js Compatible (Pure TypedArray & Buffer Math).
 * Zero DOM Canvas dependencies.
 * 
 * Key Algorithms Implemented:
 * 1. Dense Spatial Patch Verification (S_SpatialPatch):
 *    Top-32 key patches from Query matched against Candidate patches in a 3x3
 *    neighborhood (r + dr, c + dc) on the 16x16 grid, weighted by saliency.
 * 2. Hole-Constellation Symmetric Chamfer Distance (D_HoleGraph):
 *    Bi-directional nearest-neighbor distance in normalized (u, v, relArea) space
 *    with mirror reflection invariance and heavy hole existence mismatch penalty.
 * 3. 16-Harmonic Elliptic Fourier Descriptors (D_EFD):
 *    Exact Kuhl & Giardina (1982) contour decomposition, normalized for scale,
 *    rotation, and starting-point invariance.
 * 4. Z-Score Standardization Fusion & Final Top-10 Ranking:
 *    FinalScore = 0.35 * Z(S_HybridVec) + 0.30 * Z(S_SpatialPatch)
 *               - 0.20 * Z(D_HoleGraph) - 0.15 * Z(D_EFD)
 * ============================================================================
 */

import { HoleFeature, Point2D } from "./moris-layer1-optical.js";
import { MorisPartSignature, SpatialKeyPatch, dotProduct } from "./moris-layer2-embedding.js";

export interface Layer3CandidateInput {
  candidate: MorisPartSignature;
  sHybridVec: number; // Score from Layer 2B
}

export interface RankedMorisPart {
  skuId: string;
  rank: number;
  finalScore: number;
  sHybridVec: number;
  sSpatialPatch: number;
  dHoleGraph: number;
  dEfd: number;
  zScores: {
    zHybrid: number;
    zSpatial: number;
    zHole: number;
    zEfd: number;
  };
  candidate: MorisPartSignature;
}

// ---------------------------------------------------------------------------
// 1. 16-HARMONIC ELLIPTIC FOURIER DESCRIPTORS (EFD)
// ---------------------------------------------------------------------------

/**
 * Computes the first 16 normalized Elliptic Fourier harmonic amplitudes
 * from an ordered closed 2D boundary contour according to Kuhl & Giardina (1982).
 * Returns a 16-element Float32Array where index 0 is harmonic 1 (normalized to 1.0).
 */
export function computeEllipticFourierDescriptors(
  contour: Point2D[],
  numHarmonics = 16
): Float32Array {
  const efd = new Float32Array(numHarmonics);
  const k = contour.length;

  if (k < 4) {
    // Degenerate contour fallback: uniform baseline
    efd[0] = 1.0;
    return efd;
  }

  // Calculate segment lengths and cumulative perimeter
  const dx = new Float64Array(k);
  const dy = new Float64Array(k);
  const dt = new Float64Array(k);
  const t = new Float64Array(k + 1);

  let totalT = 0;
  for (let p = 0; p < k; p++) {
    const nextP = (p + 1) % k;
    const stepX = contour[nextP].x - contour[p].x;
    const stepY = contour[nextP].y - contour[p].y;
    const stepT = Math.hypot(stepX, stepY);
    const validDt = stepT > 1e-5 ? stepT : 1e-5;

    dx[p] = stepX;
    dy[p] = stepY;
    dt[p] = validDt;
    totalT += validDt;
    t[p + 1] = totalT;
  }

  if (totalT < 1e-4) {
    efd[0] = 1.0;
    return efd;
  }

  const twoPiOverT = (2 * Math.PI) / totalT;
  const amplitudes = new Float64Array(numHarmonics);

  for (let n = 1; n <= numHarmonics; n++) {
    let an = 0;
    let bn = 0;
    let cn = 0;
    let dn = 0;

    const nOmega = n * twoPiOverT;

    for (let p = 0; p < k; p++) {
      const tPrev = t[p];
      const tCur = t[p + 1];
      const dXOverDt = dx[p] / dt[p];
      const dYOverDt = dy[p] / dt[p];

      const cosPrev = Math.cos(nOmega * tPrev);
      const cosCur = Math.cos(nOmega * tCur);
      const sinPrev = Math.sin(nOmega * tPrev);
      const sinCur = Math.sin(nOmega * tCur);

      const dCos = cosCur - cosPrev;
      const dSin = sinCur - sinPrev;

      an += dXOverDt * dCos;
      bn += dXOverDt * dSin;
      cn += dYOverDt * dCos;
      dn += dYOverDt * dSin;
    }

    const factor = totalT / (2 * Math.PI * Math.PI * n * n);
    an *= factor;
    bn *= factor;
    cn *= factor;
    dn *= factor;

    // Harmonic ellipse power / amplitude
    amplitudes[n - 1] = Math.sqrt(an * an + bn * bn + cn * cn + dn * dn);
  }

  // Scale normalization: normalize all harmonics by the fundamental (first harmonic)
  const e1 = amplitudes[0] > 1e-6 ? amplitudes[0] : 1.0;
  for (let n = 0; n < numHarmonics; n++) {
    efd[n] = Number((amplitudes[n] / e1).toFixed(6));
  }

  return efd;
}

/**
 * Computes Euclidean distance between two 16-harmonic EFD vectors.
 */
export function computeEfdDistance(efdQ: Float32Array, efdC: Float32Array): number {
  const len = Math.min(efdQ.length, efdC.length);
  let sumSq = 0;
  for (let i = 0; i < len; i++) {
    const diff = efdQ[i] - efdC[i];
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq);
}

// ---------------------------------------------------------------------------
// 2. DENSE SPATIAL PATCH VERIFICATION (3x3 NEIGHBORHOOD MATCHING)
// ---------------------------------------------------------------------------

/**
 * Builds a fast lookup table for candidate patches on 16x16 grid (256 slots).
 */
function buildPatchGridLookup(patches: SpatialKeyPatch[]): (SpatialKeyPatch | null)[] {
  const table = new Array<SpatialKeyPatch | null>(256).fill(null);
  for (const p of patches) {
    if (p.gridIdx >= 0 && p.gridIdx < 256) {
      table[p.gridIdx] = p;
    }
  }
  return table;
}

/**
 * Computes S_SpatialPatch:
 * For each Query key patch at (r, c), finds maximum cosine similarity in candidate's
 * 3x3 spatial window (r + dr, c + dc) with dr, dc in {-1, 0, 1}.
 * Aggregates weighted average by query patch saliency.
 */
export function computeSpatialPatchSimilarity(
  queryPatches: SpatialKeyPatch[],
  candidatePatches: SpatialKeyPatch[]
): number {
  if (!queryPatches.length || !candidatePatches.length) {
    return 0.5; // Neutral fallback if flat surfaces without salient patches
  }

  const candLookup = buildPatchGridLookup(candidatePatches);

  let totalSim = 0;
  let totalWeight = 0;

  for (const qp of queryPatches) {
    const qr = Math.floor(qp.gridIdx / 16);
    const qc = qp.gridIdx % 16;
    let maxSim = -1.0;

    // Search 3x3 neighborhood in candidate
    for (let dr = -1; dr <= 1; dr++) {
      const cr = qr + dr;
      if (cr < 0 || cr >= 16) continue;

      for (let dc = -1; dc <= 1; dc++) {
        const cc = qc + dc;
        if (cc < 0 || cc >= 16) continue;

        const candPatch = candLookup[cr * 16 + cc];
        if (candPatch) {
          const sim = dotProduct(qp.vec, candPatch.vec);
          if (sim > maxSim) maxSim = sim;
        }
      }
    }

    // If no candidate patch fell into the 3x3 window, clamp to 0
    const clampedSim = Math.max(0, maxSim);
    totalSim += qp.weight * clampedSim;
    totalWeight += qp.weight;
  }

  return totalWeight > 0 ? totalSim / totalWeight : 0.5;
}

// ---------------------------------------------------------------------------
// 3. HOLE-CONSTELLATION CHAMFER DISTANCE (D_HoleGraph)
// ---------------------------------------------------------------------------

function holeDistance(h1: HoleFeature, h2: HoleFeature): number {
  const du = h1.u - h2.u;
  const dv = h1.v - h2.v;
  const dArea = h1.relArea - h2.relArea;
  return Math.sqrt(du * du + dv * dv + 0.5 * dArea * dArea);
}

function oneWayChamfer(src: HoleFeature[], dst: HoleFeature[]): number {
  let sum = 0;
  for (const s of src) {
    let minD = 1e6;
    for (const d of dst) {
      const dist = holeDistance(s, d);
      if (dist < minD) minD = dist;
    }
    sum += minD;
  }
  return sum / src.length;
}

/**
 * Computes Symmetric Chamfer Distance between two hole sets with mirror reflection invariance.
 * Adds explicit penalty if one part has holes and the other has none.
 */
export function computeHoleConstellationChamferDistance(
  qHoles: HoleFeature[],
  cHoles: HoleFeature[]
): number {
  const nQ = qHoles.length;
  const nC = cHoles.length;

  // Both have zero holes -> perfect topological match
  if (nQ === 0 && nC === 0) {
    return 0.0;
  }

  // One has holes and the other has none -> explicit heavy topological penalty
  if (nQ === 0 || nC === 0) {
    return 1.0 + 0.25 * Math.max(nQ, nC);
  }

  // Scenario 1: Direct alignment
  const fwdDirect = oneWayChamfer(qHoles, cHoles);
  const bwdDirect = oneWayChamfer(cHoles, qHoles);
  const distDirect = 0.5 * (fwdDirect + bwdDirect);

  // Scenario 2: Mirror reflection invariance (u' = -u for flipped parts)
  const qMirrored: HoleFeature[] = qHoles.map(h => ({
    ...h,
    u: -h.u
  }));
  const fwdMirror = oneWayChamfer(qMirrored, cHoles);
  const bwdMirror = oneWayChamfer(cHoles, qMirrored);
  const distMirror = 0.5 * (fwdMirror + bwdMirror);

  // Additional penalty for count difference
  const countPenalty = Math.abs(nQ - nC) * 0.15;

  return Math.min(distDirect, distMirror) + countPenalty;
}

// ---------------------------------------------------------------------------
// 4. Z-SCORE FUSION & TOP-10 FINAL RANKING
// ---------------------------------------------------------------------------

export interface RerankQueryInput {
  keyPatches: SpatialKeyPatch[];
  holeConstellation: HoleFeature[];
  efdCoefficients: Float32Array;
}

/**
 * Executes Layer 3 Topological & Spatial Patch Re-ranking:
 * Standardizes S_HybridVec, S_SpatialPatch, D_HoleGraph, and D_EFD across candidates via Z-score,
 * fuses into FinalScore, and returns the sorted Top 10 SKUs.
 */
export function rerankLayer3Top10(
  query: RerankQueryInput,
  candidatePool: Layer3CandidateInput[],
  topK = 10
): RankedMorisPart[] {
  const n = candidatePool.length;
  if (n === 0) return [];

  // Compute raw metrics for each candidate
  const rawHybrid = new Float64Array(n);
  const rawSpatial = new Float64Array(n);
  const rawHole = new Float64Array(n);
  const rawEfd = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const item = candidatePool[i];
    rawHybrid[i] = item.sHybridVec;
    rawSpatial[i] = computeSpatialPatchSimilarity(query.keyPatches, item.candidate.keyPatches);
    rawHole[i] = computeHoleConstellationChamferDistance(query.holeConstellation, item.candidate.holeConstellation);
    rawEfd[i] = computeEfdDistance(query.efdCoefficients, item.candidate.efdCoefficients);
  }

  // Calculate mean and std for each metric
  const stats = (arr: Float64Array) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += arr[i];
    const mean = sum / n;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const d = arr[i] - mean;
      sumSq += d * d;
    }
    const std = Math.sqrt(sumSq / n) || 1e-5;
    return { mean, std };
  };

  const hybridStats = stats(rawHybrid);
  const spatialStats = stats(rawSpatial);
  const holeStats = stats(rawHole);
  const efdStats = stats(rawEfd);

  // Compute Z-scores and FinalScore
  const scoredParts: RankedMorisPart[] = [];

  for (let i = 0; i < n; i++) {
    const item = candidatePool[i];

    const zHybrid = (rawHybrid[i] - hybridStats.mean) / hybridStats.std;
    const zSpatial = (rawSpatial[i] - spatialStats.mean) / spatialStats.std;
    const zHole = (rawHole[i] - holeStats.mean) / holeStats.std;
    const zEfd = (rawEfd[i] - efdStats.mean) / efdStats.std;

    // Specified formula:
    // FinalScore = 0.35 * Z(S_HybridVec) + 0.30 * Z(S_SpatialPatch) - 0.20 * Z(D_HoleGraph) - 0.15 * Z(D_EFD)
    const finalScore = Number((
      0.35 * zHybrid +
      0.30 * zSpatial -
      0.20 * zHole -
      0.15 * zEfd
    ).toFixed(5));

    scoredParts.push({
      skuId: item.candidate.skuId,
      rank: 0,
      finalScore,
      sHybridVec: Number(rawHybrid[i].toFixed(4)),
      sSpatialPatch: Number(rawSpatial[i].toFixed(4)),
      dHoleGraph: Number(rawHole[i].toFixed(4)),
      dEfd: Number(rawEfd[i].toFixed(4)),
      zScores: {
        zHybrid: Number(zHybrid.toFixed(3)),
        zSpatial: Number(zSpatial.toFixed(3)),
        zHole: Number(zHole.toFixed(3)),
        zEfd: Number(zEfd.toFixed(3))
      },
      candidate: item.candidate
    });
  }

  // Sort descending by FinalScore
  scoredParts.sort((a, b) => b.finalScore - a.finalScore);

  // Assign ranks 1..TopK
  const topResults = scoredParts.slice(0, topK);
  for (let r = 0; r < topResults.length; r++) {
    topResults[r].rank = r + 1;
  }

  return topResults;
}
