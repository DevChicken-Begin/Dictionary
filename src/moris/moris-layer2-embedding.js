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
 *    skipping [CLS] token; pooled-only outputs fail closed.
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
 * - [1, 384] or [384] -> rejected: CLS cannot supply spatial patches
 */
export function extractDinov2Tokens(onnxOutput) {
    const data = onnxOutput?.data || onnxOutput;
    const dims = Array.isArray(onnxOutput?.dims) ? onnxOutput.dims : [];
    const dim = 384;
    const numPatches = 256;
    if (!data || !dims.length || dims.some(d => !Number.isInteger(d) || d <= 0) ||
        dims.reduce((a, b) => a * b, 1) !== data.length) {
        throw new Error("DINOv2 tensor shape/data mismatch.");
    }
    const raw = data instanceof Float32Array ? data : new Float32Array(data);
    if (raw.some(v => !Number.isFinite(v)))
        throw new Error("DINOv2 tensor non-finite.");
    const shape = dims.join(",");
    // Case 1: [1, 257, 384] or [257, 384] -> 257 tokens (CLS at 0, 256 patches at 1..256)
    if (shape === "1,257,384" || shape === "257,384") {
        const clsToken = new Float32Array(dim);
        clsToken.set(raw.subarray(0, dim));
        l2NormalizeVector(clsToken);
        const patchTokens = new Float32Array(numPatches * dim);
        patchTokens.set(raw.subarray(dim, (numPatches + 1) * dim));
        return { clsToken, patchTokens, isSpatial: true };
    }
    // Case 2: [256, 384] -> 256 patches directly
    if (shape === "256,384" || shape === "1,256,384") {
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
    throw new Error(`DINOv2 spatial tokens required; received [${dims}]. CLS fallback is disabled.`);
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
/**
 * Computes 384-dim Native Supabase Hybrid Vector:
 * - 384-dim Signed GeM (p = 3.0) on foreground patches (mask16x16 >= 0.15)
 * - 384-dim Edge-Detail Weighted Pooling (detailVec) using weight = mask16x16 * edge16x16
 * - Fused directly in 384-dim space: L2Normalize(0.55 * gemVec + 0.45 * detailVec)
 */
export function computeSupabase384HybridEmbedding(patchTokens, // 256 * 384
mask16x16, // 256
edge16x16 // 256
) {
    const dim = 384;
    const numPatches = 256;
    const pPower = 3.0;
    const invP = 1.0 / pPower;
    let sumFgW = 0;
    const fgWeights = new Float32Array(numPatches);
    for (let i = 0; i < numPatches; i++) {
        const m = mask16x16[i];
        if (m >= 0.15) {
            fgWeights[i] = m;
            sumFgW += m;
        }
    }
    if (sumFgW < 1e-4) {
        for (let i = 0; i < numPatches; i++) {
            fgWeights[i] = 1.0;
        }
        sumFgW = numPatches;
    }
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
    let sumEdgeW = 0;
    const edgeWeights = new Float32Array(numPatches);
    for (let i = 0; i < numPatches; i++) {
        const ew = mask16x16[i] * edge16x16[i];
        edgeWeights[i] = ew;
        sumEdgeW += ew;
    }
    if (sumEdgeW < 1e-4) {
        for (let i = 0; i < numPatches; i++) {
            edgeWeights[i] = fgWeights[i];
        }
        sumEdgeW = sumFgW;
    }
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
    const v384 = new Float32Array(dim);
    for (let d = 0; d < dim; d++) {
        v384[d] = 0.55 * gemVec[d] + 0.45 * detailVec[d];
    }
    return l2NormalizeVector(v384);
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
 * Synthesizes 4 geometric and optical perturbations by re-pooling patchTokens (256x384)
 * over modulated spatial weights on the 16x16 grid and computes the 768-dim centroid vector.
 */
export function synthesizePerspectiveCentroid(patchTokens, mask16x16, edge16x16) {
    // Canonical embedding
    const canonicalEmbedding = computeHybridMaskedGemEmbedding(patchTokens, mask16x16, edge16x16);
    // Perturbation 1 (Horizontal tilt foreshortening): Weight columns c = 0..15 with linear gradient 0.7 + 0.6 * (c / 15) on mask16x16
    const m1 = new Float32Array(256);
    for (let r = 0; r < 16; r++) {
        for (let c = 0; c < 16; c++) {
            const idx = r * 16 + c;
            const wCol = 0.7 + 0.6 * (c / 15);
            m1[idx] = mask16x16[idx] * wCol;
        }
    }
    const p1 = computeHybridMaskedGemEmbedding(patchTokens, m1, edge16x16);
    // Perturbation 2 (Vertical tilt foreshortening): Weight rows r = 0..15 with 0.7 + 0.6 * (r / 15) on mask16x16
    const m2 = new Float32Array(256);
    for (let r = 0; r < 16; r++) {
        const wRow = 0.7 + 0.6 * (r / 15);
        for (let c = 0; c < 16; c++) {
            const idx = r * 16 + c;
            m2[idx] = mask16x16[idx] * wRow;
        }
    }
    const p2 = computeHybridMaskedGemEmbedding(patchTokens, m2, edge16x16);
    // Perturbation 3 (High-glare / Edge boost): Boost edge16x16 weights by Math.pow(edge16x16[i], 0.75)
    const e3 = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
        e3[i] = Math.pow(edge16x16[i], 0.75);
    }
    const p3 = computeHybridMaskedGemEmbedding(patchTokens, mask16x16, e3);
    // Perturbation 4 (Boundary erosion simulation): Attenuate border patches where mask16x16[i] < 0.65 by 0.35 * mask16x16[i]
    const m4 = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
        m4[i] = mask16x16[i] < 0.65 ? 0.35 * mask16x16[i] : mask16x16[i];
    }
    const p4 = computeHybridMaskedGemEmbedding(patchTokens, m4, edge16x16);
    // Average canonical embedding and 4 spatially-perturbed embeddings, then L2-normalize
    const centroid = new Float32Array(768);
    for (let d = 0; d < 768; d++) {
        centroid[d] = canonicalEmbedding[d] + p1[d] + p2[d] + p3[d] + p4[d];
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
