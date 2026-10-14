/**
 * moris-worker-pipeline.ts
 * ============================================================================
 * MORIS 3-LAYER COMPUTER VISION HARNESS — WORKER PIPELINE ORCHESTRATOR
 *
 * 100% Offline Web Worker Compatible.
 * Integrates:
 * - Layer 1: Optical Normalization, PCA alignment, CLAHE, Scharr, Chamfer, Pseudo-RGB Tensor.
 * - Layer 2: DINOv2 patch extraction, Hard Geometric Gate, Masked-GeM Pooling, Multi-Prototype Enrollment.
 * - Layer 3: 3x3 Spatial Patch Verification, Hole Chamfer, 16-Harmonic EFD, Z-score Fusion.
 * - IndexedDB: Persistent Signature V2 Storage & Retrieval for 850 SKUs.
 * ============================================================================
 */
import { processLayer1Optical } from "./moris-layer1-optical.js";
import { extractDinov2Tokens, downsampleTo16x16Grid, computeHybridMaskedGemEmbedding, extractTopKeyPatches, executeGeometricGate, synthesizePerspectiveCentroid, rankStage2Candidates } from "./moris-layer2-embedding.js";
import { computeEllipticFourierDescriptors, rerankLayer3Top10 } from "./moris-layer3-rerank.js";
import { saveSignature, saveSignaturesBatch, getAllSignatures } from "./moris-idb.js";
/**
 * Enrolls a new SKU part into the Moris v2 signature representation:
 * Runs Layer 1 -> DINOv2 -> Layer 2 -> Multi-prototype perturbation -> Layer 3 features.
 */
export async function enrollSkuSignature(skuId, rgba, width, height, extractor) {
    // Step 1: Layer 1 Optical Normalization
    const opt = processLayer1Optical(rgba, width, height);
    // Step 2: DINOv2 Feature Extraction on [1, 3, 224, 224] Pseudo-RGB Tensor
    const rawModelOutput = await extractor(opt.pseudoRgbTensor);
    const tokens = extractDinov2Tokens(rawModelOutput);
    // Step 3: Layer 2 Downsampling and Masked GeM Pooling
    const { mask16x16, edge16x16 } = downsampleTo16x16Grid(opt.fgMask, opt.scharrEdgeMap, 224, 16);
    const canonicalEmbedding = computeHybridMaskedGemEmbedding(tokens.patchTokens, mask16x16, edge16x16);
    const perspectiveCentroid = synthesizePerspectiveCentroid(canonicalEmbedding, mask16x16, edge16x16);
    const keyPatches = extractTopKeyPatches(tokens.patchTokens, mask16x16, edge16x16, 32);
    // Step 4: Layer 3 Elliptic Fourier Descriptors
    const efdCoefficients = computeEllipticFourierDescriptors(opt.outerContour, 16);
    const signature = {
        skuId,
        version: 2,
        aspectRatio: opt.aspectRatio,
        solidity: opt.solidity,
        holeCount: opt.holeCount,
        canonicalEmbedding,
        perspectiveCentroid,
        holeConstellation: opt.holeFeatures,
        efdCoefficients,
        keyPatches
    };
    // Persist to IndexedDB
    await saveSignature(signature);
    return signature;
}
/**
 * Full End-to-End Search Pipeline:
 * Query Image -> Layer 1 -> DINOv2 -> Layer 2 -> Gate -> Top 40 -> Layer 3 Rerank -> Top 10 SKUs.
 */
export async function searchPartTop10(rgba, width, height, extractor, cachedCandidates) {
    // 1. Layer 1 Optical Normalization
    const opt = processLayer1Optical(rgba, width, height);
    // 2. DINOv2 Feature Extraction
    const rawModelOutput = await extractor(opt.pseudoRgbTensor);
    const tokens = extractDinov2Tokens(rawModelOutput);
    // 3. Layer 2 Hybrid Query Vector & Key Patches
    const { mask16x16, edge16x16 } = downsampleTo16x16Grid(opt.fgMask, opt.scharrEdgeMap, 224, 16);
    const queryHybridVec = computeHybridMaskedGemEmbedding(tokens.patchTokens, mask16x16, edge16x16);
    const queryKeyPatches = extractTopKeyPatches(tokens.patchTokens, mask16x16, edge16x16, 32);
    const queryEfd = computeEllipticFourierDescriptors(opt.outerContour, 16);
    // 4. Candidate Retrieval (from provided pool or IndexedDB)
    const candidatePool = cachedCandidates && cachedCandidates.length > 0
        ? cachedCandidates
        : await getAllSignatures();
    // 5. Stage 2A Hard Geometric Gate
    const gateResult = executeGeometricGate({
        aspectRatio: opt.aspectRatio,
        solidity: opt.solidity,
        holeCount: opt.holeCount
    }, candidatePool);
    // 6. Stage 2B Hybrid Vector Ranking (Top 40)
    const stage2Ranked = rankStage2Candidates(queryHybridVec, gateResult.passed, 40);
    // 7. Stage 3 Topological & Spatial Patch Re-ranking (Top 40 -> Top 10)
    const rerankInputs = stage2Ranked.top40.map(item => ({
        candidate: item.candidate,
        sHybridVec: item.score
    }));
    const top10 = rerankLayer3Top10({
        keyPatches: queryKeyPatches,
        holeConstellation: opt.holeFeatures,
        efdCoefficients: queryEfd
    }, rerankInputs, 10);
    return {
        top10,
        opticalDiagnostics: opt.diagnostics,
        totalCandidates: candidatePool.length,
        gatePassedCount: gateResult.passed.length
    };
}
/**
 * Batch re-indexing utility for 850 SKUs.
 */
export async function reindexBatchSignatures(items, extractor, onProgress) {
    const errors = [];
    const signatures = [];
    const total = items.length;
    for (let i = 0; i < total; i++) {
        const item = items[i];
        try {
            const opt = processLayer1Optical(item.rgba, item.width, item.height);
            const rawModelOutput = await extractor(opt.pseudoRgbTensor);
            const tokens = extractDinov2Tokens(rawModelOutput);
            const { mask16x16, edge16x16 } = downsampleTo16x16Grid(opt.fgMask, opt.scharrEdgeMap, 224, 16);
            const canonicalEmbedding = computeHybridMaskedGemEmbedding(tokens.patchTokens, mask16x16, edge16x16);
            const perspectiveCentroid = synthesizePerspectiveCentroid(canonicalEmbedding, mask16x16, edge16x16);
            const keyPatches = extractTopKeyPatches(tokens.patchTokens, mask16x16, edge16x16, 32);
            const efdCoefficients = computeEllipticFourierDescriptors(opt.outerContour, 16);
            signatures.push({
                skuId: item.skuId,
                version: 2,
                aspectRatio: opt.aspectRatio,
                solidity: opt.solidity,
                holeCount: opt.holeCount,
                canonicalEmbedding,
                perspectiveCentroid,
                holeConstellation: opt.holeFeatures,
                efdCoefficients,
                keyPatches
            });
        }
        catch (err) {
            errors.push({
                skuId: item.skuId,
                error: err?.message || String(err)
            });
        }
        onProgress?.(i + 1, total);
    }
    if (signatures.length > 0) {
        await saveSignaturesBatch(signatures);
    }
    return {
        enrolled: signatures.length,
        errors
    };
}
