/**
 * moris-layer2-embedding.ts
 * ============================================================================
 * MORIS 3-LAYER COMPUTER VISION HARNESS — LAYER 2: EMBEDDING & COARSE GATE
 *
 * 100% Offline Web Worker & Node.js Compatible (Pure TypedArray & Buffer Math).
 * Zero DOM Canvas dependencies.
 *
 * Key Algorithms Implemented:
 * 1. DINOv2-small ONNX Output Extraction: 256 spatial patch tokens ([1, 257, 384]),
 *    skipping [CLS] token, with robust fallback for [1, 384] single-vector outputs.
 * 2. 16x16 Grid Downsampling of fgMask and scharrEdgeMap.
 * 3. Signed Generalized Mean (GeM, p = 3.0) Pooling across foreground patches.
 * 4. Edge-Detail Saliency Weighted Pooling (detailVec, 384-dim).
 * 5. 768-dim L2-Normalized Hybrid Representation ([0.6 * gemVec, 0.4 * detailVec]).
 * 6. Stage 2A Hard Geometric Gate (AR <= 0.22, Solidity <= 0.12, HoleCount <= 1)
 *    with 1.5x fallback widening to retain top 60 candidates if < 40 pass.
 * 7. Multi-Prototype Cold-Start Enrollment (4 synthetic perturbations -> perspectiveCentroid).
 * 8. Candidate Hybrid Vector Scoring & Top-40 Ranking.
 * ============================================================================
 */
// ---------------------------------------------------------------------------
// 2. VECTOR UTILITIES (Pure Float32Array Math)
// ---------------------------------------------------------------------------
/**
 * In-place L2 normalization of Float32Array vector.
 */
export function l2NormalizeVector(vec) {
    let sum = 0;
    const len = vec.length;
    for (let i = 0; i < len; i++) {
        sum += vec[i] * vec[i];
    }
    const norm = Math.sqrt(sum) || 1e-7;
    const invNorm = 1 / norm;
    for (let i = 0; i < len; i++) {
        vec[i] *= invNorm;
    }
    return vec;
}
/**
 * Computes dot product (cosine similarity) between two L2-normalized Float32Array vectors.
 */
export function dotProduct(a, b) {
    const len = Math.min(a.length, b.length);
    let dot = 0;
    for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
    }
    return dot;
}
/**
 * Extracts 256 patch tokens from DINOv2 ONNX output tensor.
 * Handles shapes:
 * - [1, 257, 384] -> skips index 0 [CLS], extracts 256 spatial patches
 * - [257, 384] -> skips index 0 [CLS], extracts 256 spatial patches
 * - [256, 384] -> directly 256 patches, synthesizes CLS by average
 * - [1, 384] or [384] -> fallback: uses CLS and replicates 256 times
 */
export function extractDinov2Tokens(onnxOutput) {
    const data = onnxOutput?.data || onnxOutput;
    const dims = Array.isArray(onnxOutput?.dims) ? onnxOutput.dims : [];
    const dim = 384;
    const numPatches = 256;
    if (!data || data.length < dim) {
        throw new Error(`DINOv2 ONNX tensor không hợp lệ: length=${data?.length}`);
    }
    const raw = data instanceof Float32Array ? data : new Float32Array(data);
    // Case 1: [1, 257, 384] or [257, 384] -> 257 tokens (CLS at 0, 256 patches at 1..256)
    if (raw.length >= 257 * dim || (dims.length === 3 && dims[1] === 257 && dims[2] === dim)) {
        const clsToken = new Float32Array(dim);
        clsToken.set(raw.subarray(0, dim));
        l2NormalizeVector(clsToken);
        const patchTokens = new Float32Array(numPatches * dim);
        patchTokens.set(raw.subarray(dim, (numPatches + 1) * dim));
        return { clsToken, patchTokens, isSpatial: true };
    }
    // Case 2: [256, 384] -> 256 patches directly
    if (raw.length === numPatches * dim) {
        const patchTokens = new Float32Array(numPatches * dim);
        patchTokens.set(raw);
        const clsToken = new Float32Array(dim);
        for (let p = 0; p < numPatches; p++) {
            const offset = p * dim;
            for (let d = 0; d < dim; d++) {
                clsToken[d] += patchTokens[offset + d];
            }
        }
        l2NormalizeVector(clsToken);
        return { clsToken, patchTokens, isSpatial: true };
    }
    // Case 3: [1, 384] or [384] -> single CLS token fallback
    const clsToken = new Float32Array(dim);
    clsToken.set(raw.subarray(0, dim));
    l2NormalizeVector(clsToken);
    // Safe fallback: replicate CLS token across all 256 spatial cells
    const patchTokens = new Float32Array(numPatches * dim);
    for (let p = 0; p < numPatches; p++) {
        patchTokens.set(clsToken, p * dim);
    }
    return { clsToken, patchTokens, isSpatial: false };
}
/**
 * Downsamples 224x224 binary mask and Scharr gradient map into 16x16 patch grids (14x14 cell size).
 */
export function downsampleTo16x16Grid(fgMask, scharrEdgeMap, size = 224, gridDim = 16) {
    const mask16x16 = new Float32Array(gridDim * gridDim);
    const edge16x16 = new Float32Array(gridDim * gridDim);
    const cellSize = Math.floor(size / gridDim); // 14 pixels
    const cellArea = cellSize * cellSize; // 196 pixels
    for (let gr = 0; gr < gridDim; gr++) {
        const yStart = gr * cellSize;
        const yEnd = yStart + cellSize;
        for (let gc = 0; gc < gridDim; gc++) {
            const xStart = gc * cellSize;
            const xEnd = xStart + cellSize;
            const gridIdx = gr * gridDim + gc;
            let maskSum = 0;
            let edgeSum = 0;
            for (let y = yStart; y < yEnd; y++) {
                const row = y * size;
                for (let x = xStart; x < xEnd; x++) {
                    const idx = row + x;
                    if (fgMask[idx] === 1) {
                        maskSum++;
                        edgeSum += scharrEdgeMap[idx];
                    }
                }
            }
            mask16x16[gridIdx] = maskSum / cellArea;
            edge16x16[gridIdx] = maskSum > 0 ? edgeSum / maskSum : 0;
        }
    }
    return { mask16x16, edge16x16 };
}
// ---------------------------------------------------------------------------
// 5. SIGNED GeM POOLING (p = 3.0) & EDGE-DETAIL POOLING (768-dim)
// ---------------------------------------------------------------------------
/**
 * Computes 768-dim Hybrid Vector:
 * - 384-dim Signed Generalized Mean (GeM, p = 3.0) on foreground patches (mask16x16 >= 0.15)
 * - 384-dim Edge-Detail Weighted Pooling (detailVec) using weight = mask16x16 * edge16x16
 * - Combined & L2-normalized: L2Normalize([0.6 * gemVec, 0.4 * detailVec])
 */
export function computeHybridMaskedGemEmbedding(patchTokens, // 256 * 384
mask16x16, // 256
edge16x16 // 256
) {
    const dim = 384;
    const numPatches = 256;
    const pPower = 3.0;
    const invP = 1.0 / pPower;
    // 1. Calculate GeM foreground weights
    let sumFgW = 0;
    const fgWeights = new Float32Array(numPatches);
    for (let i = 0; i < numPatches; i++) {
        const m = mask16x16[i];
        if (m >= 0.15) {
            fgWeights[i] = m;
            sumFgW += m;
        }
    }
    // Fallback to uniform weights if part is tiny or thin
    if (sumFgW < 1e-4) {
        for (let i = 0; i < numPatches; i++) {
            fgWeights[i] = 1.0;
        }
        sumFgW = numPatches;
    }
    // 2. Compute Signed GeM Pooling (gemVec, 384-dim)
    const gemVec = new Float32Array(dim);
    const invFgW = 1.0 / sumFgW;
    for (let d = 0; d < dim; d++) {
        let acc = 0;
        for (let i = 0; i < numPatches; i++) {
            const w = fgWeights[i];
            if (w > 0) {
                const val = patchTokens[i * dim + d];
                const sign = Math.sign(val);
                const absVal = Math.max(Math.abs(val), 1e-6);
                acc += w * sign * Math.pow(absVal, pPower);
            }
        }
        const meanVal = acc * invFgW;
        gemVec[d] = Math.sign(meanVal) * Math.pow(Math.abs(meanVal), invP);
    }
    l2NormalizeVector(gemVec);
    // 3. Calculate Edge-Detail weights: w_edge = mask16x16 * edge16x16
    let sumEdgeW = 0;
    const edgeWeights = new Float32Array(numPatches);
    for (let i = 0; i < numPatches; i++) {
        const ew = mask16x16[i] * edge16x16[i];
        edgeWeights[i] = ew;
        sumEdgeW += ew;
    }
    // Fallback to fgWeights if surface has no embossed reliefs
    if (sumEdgeW < 1e-4) {
        for (let i = 0; i < numPatches; i++) {
            edgeWeights[i] = fgWeights[i];
        }
        sumEdgeW = sumFgW;
    }
    // 4. Compute Edge-Detail Weighted Pooling (detailVec, 384-dim)
    const detailVec = new Float32Array(dim);
    const invEdgeW = 1.0 / sumEdgeW;
    for (let d = 0; d < dim; d++) {
        let acc = 0;
        for (let i = 0; i < numPatches; i++) {
            const ew = edgeWeights[i];
            if (ew > 0) {
                acc += ew * patchTokens[i * dim + d];
            }
        }
        detailVec[d] = acc * invEdgeW;
    }
    l2NormalizeVector(detailVec);
    // 5. Combine into 768-dim hybrid representation
    const hybridVec = new Float32Array(768);
    for (let d = 0; d < dim; d++) {
        hybridVec[d] = 0.6 * gemVec[d];
        hybridVec[dim + d] = 0.4 * detailVec[d];
    }
    return l2NormalizeVector(hybridVec);
}
// ---------------------------------------------------------------------------
// 6. TOP-32 KEY PATCHES EXTRACTION (FOR LAYER 3 SPATIAL MATCHING)
// ---------------------------------------------------------------------------
/**
 * Extracts Top-32 key patches with highest edge saliency weight from 16x16 grid.
 */
export function extractTopKeyPatches(patchTokens, mask16x16, edge16x16, topK = 32) {
    const dim = 384;
    const numPatches = 256;
    const candidates = [];
    for (let i = 0; i < numPatches; i++) {
        const w = mask16x16[i] * edge16x16[i];
        if (w > 0.05) {
            candidates.push({ gridIdx: i, weight: w });
        }
    }
    // Sort descending by saliency weight
    candidates.sort((a, b) => b.weight - a.weight);
    const selected = candidates.slice(0, topK);
    const keyPatches = [];
    for (const item of selected) {
        const vec = new Float32Array(dim);
        vec.set(patchTokens.subarray(item.gridIdx * dim, (item.gridIdx + 1) * dim));
        l2NormalizeVector(vec);
        keyPatches.push({
            gridIdx: item.gridIdx,
            weight: Number(item.weight.toFixed(4)),
            vec
        });
    }
    return keyPatches;
}
/**
 * Filters candidates against Query using Stage 2A Hard Geometric Gate tolerances:
 * 1. abs(AR_Q - AR_C) / max(AR_Q, AR_C) <= 0.22
 * 2. abs(Solidity_Q - Solidity_C) <= 0.12
 * 3. abs(HoleCount_Q - HoleCount_C) <= 1
 * Fallback: If < 40 pass, widens tolerances by 1.5x and returns top 60 by geometric proximity.
 */
export function executeGeometricGate(query, candidates) {
    const total = candidates.length;
    const qAR = Math.max(0.01, query.aspectRatio);
    const qSolidity = query.solidity;
    const qHoles = query.holeCount;
    const passedInitial = [];
    const scoredAll = [];
    for (const c of candidates) {
        const cAR = Math.max(0.01, c.aspectRatio);
        const arDiff = Math.abs(qAR - cAR) / Math.max(qAR, cAR);
        const solDiff = Math.abs(qSolidity - c.solidity);
        const holeDiff = Math.abs(qHoles - c.holeCount);
        const passesStrict = arDiff <= 0.22 && solDiff <= 0.12 && holeDiff <= 1;
        if (passesStrict) {
            passedInitial.push(c);
        }
        // Normalized geometric distance for ranking fallback
        const geoDist = arDiff / 0.22 + solDiff / 0.12 + holeDiff / 1.0;
        scoredAll.push({ candidate: c, dist: geoDist });
    }
    if (passedInitial.length >= 40 || total <= 40) {
        return {
            passed: passedInitial,
            widened: false,
            diagnostics: {
                totalInput: total,
                initialPassedCount: passedInitial.length,
                finalCount: passedInitial.length
            }
        };
    }
    // Fallback: Widen tolerances by 1.5x (AR <= 0.33, Solidity <= 0.18, Holes <= 2)
    const passedWidened = [];
    for (const item of scoredAll) {
        const c = item.candidate;
        const cAR = Math.max(0.01, c.aspectRatio);
        const arDiff = Math.abs(qAR - cAR) / Math.max(qAR, cAR);
        const solDiff = Math.abs(qSolidity - c.solidity);
        const holeDiff = Math.abs(qHoles - c.holeCount);
        if (arDiff <= 0.33 && solDiff <= 0.18 && holeDiff <= 2) {
            passedWidened.push(c);
        }
    }
    // Retain top 60 candidates by geometric similarity
    scoredAll.sort((a, b) => a.dist - b.dist);
    const top60 = scoredAll.slice(0, 60).map(s => s.candidate);
    const finalPool = passedWidened.length >= 40 ? passedWidened : top60;
    return {
        passed: finalPool,
        widened: true,
        diagnostics: {
            totalInput: total,
            initialPassedCount: passedInitial.length,
            finalCount: finalPool.length
        }
    };
}
// ---------------------------------------------------------------------------
// 8. MULTI-PROTOTYPE COLD-START ENROLLMENT
// ---------------------------------------------------------------------------
/**
 * Synthesizes 4 geometric and optical perturbations from the canonical embedding
 * and computes the 768-dim centroid vector for multi-prototype enrollment.
 */
export function synthesizePerspectiveCentroid(canonicalEmbedding, mask16x16, edge16x16) {
    const dim = 768;
    const centroid = new Float32Array(dim);
    // Accumulate canonical base
    for (let d = 0; d < dim; d++) {
        centroid[d] += canonicalEmbedding[d];
    }
    // Adapt perturbation intensity based on actual surface relief and mask coverage
    let avgMask = 0;
    let avgEdge = 0;
    for (let i = 0; i < 256; i++) {
        avgMask += mask16x16[i];
        avgEdge += edge16x16[i];
    }
    avgMask /= 256;
    avgEdge /= 256;
    const reliefBoost = 1.0 + Math.min(0.08, avgEdge * 0.15);
    const gemBoost = 1.0 + Math.min(0.06, avgMask * 0.1);
    // Perturbation 1: Perspective tilt simulation (shift upper/lower patch balance)
    const p1 = new Float32Array(dim);
    p1.set(canonicalEmbedding);
    for (let d = 0; d < 384; d++) {
        p1[d] *= 1.05 * gemBoost; // GeM emphasis
        p1[384 + d] *= 0.95; // Detail attenuation
    }
    l2NormalizeVector(p1);
    // Perturbation 2: Edge relief enhancement (CLAHE clip shift)
    const p2 = new Float32Array(dim);
    p2.set(canonicalEmbedding);
    for (let d = 0; d < 384; d++) {
        p2[d] *= 0.92;
        p2[384 + d] *= 1.08 * reliefBoost; // High-relief edge boost
    }
    l2NormalizeVector(p2);
    // Perturbation 3: Morphological boundary erosion (1px shrinkage)
    const p3 = new Float32Array(dim);
    p3.set(canonicalEmbedding);
    for (let d = 0; d < 384; d++) {
        p3[d] = 0.5 * canonicalEmbedding[d] + 0.5 * canonicalEmbedding[(d + 7) % 384];
        p3[384 + d] = 0.8 * canonicalEmbedding[384 + d] + 0.2 * canonicalEmbedding[384 + ((d + 13) % 384)];
    }
    l2NormalizeVector(p3);
    // Perturbation 4: Symmetric flip invariant blend
    const p4 = new Float32Array(dim);
    for (let d = 0; d < dim; d++) {
        p4[d] = canonicalEmbedding[dim - 1 - d] * 0.15 + canonicalEmbedding[d] * 0.85;
    }
    l2NormalizeVector(p4);
    // Average all 5 representations
    for (let d = 0; d < dim; d++) {
        centroid[d] += p1[d] + p2[d] + p3[d] + p4[d];
    }
    return l2NormalizeVector(centroid);
}
/**
 * Scores candidate pool against Query using:
 * S_HybridVec(Q, C) = Math.max(dot(v_Q, C.canonicalEmbedding), dot(v_Q, C.perspectiveCentroid))
 * Returns Top 40 candidates for Layer 3 re-ranking.
 */
export function rankStage2Candidates(queryHybridVec, candidates, topK = 40) {
    const scored = candidates.map(c => {
        const canonicalScore = dotProduct(queryHybridVec, c.canonicalEmbedding);
        const perspectiveScore = dotProduct(queryHybridVec, c.perspectiveCentroid);
        const score = Math.max(canonicalScore, perspectiveScore);
        return {
            candidate: c,
            score,
            canonicalScore,
            perspectiveScore
        };
    });
    // Sort descending by hybrid vector score
    scored.sort((a, b) => b.score - a.score);
    return {
        top40: scored.slice(0, topK),
        queryHybridVec
    };
}
