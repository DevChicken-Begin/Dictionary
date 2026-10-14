import {
  enrollSkuSignature,
  searchPartTop10,
  reindexBatchSignatures
} from "../moris-worker-pipeline.js";

import {
  processLayer1Optical
} from "../moris-layer1-optical.js";

import {
  getAllSignatures,
  getSignatureBySku,
  saveSignature,
  saveSignaturesBatch,
  deleteSignature,
  clearAllSignatures,
  countSignatures,
  serializeSignature,
  deserializeSignature
} from "../moris-idb.js";

const TRANSFORMERS_CDN =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

const MODEL_ID = "onnx-community/dinov2-small";
const MODEL_REVISION = "ef1fb10";
const DIMENSION = 384;

let extractorPromise = null;
let runtimeInfo = null;

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

function l2Normalize(values) {
  let sum = 0;
  for (const value of values) {
    const n = Number(value);
    sum += n * n;
  }
  const norm = Math.sqrt(sum) || 1;
  return Array.from(values, value => Number(value) / norm);
}

function tensorToClsVector(output) {
  const data = output?.data;
  const dims = Array.isArray(output?.dims) ? output.dims : [];

  if (!data || !Number.isFinite(Number(data.length))) {
    throw new Error("DINOv2 không trả Tensor hợp lệ.");
  }

  const lastDim = Number(dims.at(-1) || 0);

  if (lastDim !== DIMENSION) {
    throw new Error(
      `Sai dimension DINOv2: expected=${DIMENSION}, dims=${JSON.stringify(dims)}`
    );
  }

  // [384]
  if (dims.length === 1 && dims[0] === DIMENSION) {
    return l2Normalize(data);
  }

  // [1, 384]
  if (dims.length === 2 && dims[1] === DIMENSION) {
    return l2Normalize(data.slice(0, DIMENSION));
  }

  // [1, tokens, 384] -> CLS token is token 0.
  if (dims.length === 3 && dims[2] === DIMENSION) {
    return l2Normalize(data.slice(0, DIMENSION));
  }

  // Defensive fallback: first 384 values are the CLS embedding
  if (data.length >= DIMENSION) {
    return l2Normalize(data.slice(0, DIMENSION));
  }

  throw new Error(`Không đọc được CLS embedding từ dims=${JSON.stringify(dims)}.`);
}

async function createExtractor() {
  const { pipeline } = await import(TRANSFORMERS_CDN);

  const progress_callback = progress => {
    post("progress", { progress });
  };

  const isMobile = /android|iphone|ipad|ipod|mobile/i.test(self.navigator?.userAgent || "");
  const webgpuSupported = !isMobile && !!self.navigator?.gpu;

  if (webgpuSupported) {
    try {
      const webgpuPromise = pipeline(
        "image-feature-extraction",
        MODEL_ID,
        {
          revision: MODEL_REVISION,
          device: "webgpu",
          dtype: "fp16",
          progress_callback
        }
      );
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("WebGPU timeout sau 10s")), 10000)
      );

      const extractor = await Promise.race([webgpuPromise, timeoutPromise]);

      runtimeInfo = {
        device: "webgpu",
        dtype: "fp16",
        model: MODEL_ID,
        revision: MODEL_REVISION
      };

      return extractor;
    } catch (error) {
      post("runtime-warning", {
        message: `WebGPU không khả dụng (${error?.message || error}); chuyển sang WASM q8.`
      });
    }
  }

  const extractor = await pipeline(
    "image-feature-extraction",
    MODEL_ID,
    {
      revision: MODEL_REVISION,
      device: "wasm",
      dtype: "q8",
      progress_callback
    }
  );

  runtimeInfo = {
    device: "wasm",
    dtype: "q8",
    model: MODEL_ID,
    revision: MODEL_REVISION
  };

  return extractor;
}

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = createExtractor();
  }

  try {
    return await extractorPromise;
  } catch (error) {
    extractorPromise = null;
    runtimeInfo = null;
    throw error;
  }
}

async function resolveImageRgba(input) {
  if (input?.rgba && input?.width && input?.height) {
    return {
      rgba: input.rgba instanceof Uint8ClampedArray ? input.rgba : new Uint8ClampedArray(input.rgba),
      width: Number(input.width),
      height: Number(input.height)
    };
  }

  const s = String(input || "");
  let blob;
  if (s.startsWith("data:")) {
    const comma = s.indexOf(",");
    const byteString = atob(s.slice(comma + 1));
    const mimeMatch = s.slice(0, comma).match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
    const u8 = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      u8[i] = byteString.charCodeAt(i);
    }
    blob = new Blob([u8], { type: mime });
  } else {
    const res = await fetch(s);
    blob = await res.blob();
  }

  const bitmap = await createImageBitmap(blob);
  const w = bitmap.width;
  const h = bitmap.height;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const imgData = ctx.getImageData(0, 0, w, h);
  if (typeof bitmap.close === "function") {
    try { bitmap.close(); } catch {}
  }
  return { rgba: imgData.data, width: w, height: h };
}

function pseudoRgbTensorToCanvas(opt) {
  const canvas = new OffscreenCanvas(224, 224);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const imgData = ctx.createImageData(224, 224);
  const d = imgData.data;
  const ch0 = opt.claheLuminance;
  const ch1 = opt.scharrEdgeMap;
  const ch2 = opt.chamferDistMap;

  for (let i = 0; i < 224 * 224; i++) {
    const idx = i * 4;
    d[idx] = Math.round(ch0[i] * 255);
    d[idx + 1] = Math.round(ch1[i] * 255);
    d[idx + 2] = Math.round(ch2[i] * 255);
    d[idx + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

async function extractFeaturesWithFallback(extractor, canvas) {
  try {
    return await extractor(canvas, { pooling: "none" });
  } catch {
    return await extractor(canvas);
  }
}

self.onmessage = async event => {
  const message = event?.data || {};
  const requestId = String(message.requestId || "");

  try {
    // -----------------------------------------------------------------------
    // Message Type: init (v1 & v2 compatible)
    // -----------------------------------------------------------------------
    if (message.type === "init") {
      await getExtractor();
      post("result", {
        requestId,
        result: {
          ready: true,
          runtime: runtimeInfo
        }
      });
      return;
    }

    // -----------------------------------------------------------------------
    // Message Type: embed (v1 backward compatibility)
    // -----------------------------------------------------------------------
    if (message.type === "embed") {
      const image = String(message.image || "");
      if (!image) throw new Error("Thiếu ảnh để tạo vector.");

      const extractor = await getExtractor();
      const output = await extractor(image);
      const embedding = tensorToClsVector(output);

      if (embedding.length !== DIMENSION) {
        throw new Error(`Embedding sai dimension: ${embedding.length}.`);
      }

      post("result", {
        requestId,
        result: {
          embedding,
          runtime: runtimeInfo
        }
      });
      return;
    }

    // -----------------------------------------------------------------------
    // Message Type: layer1 (Process raw image with Layer 1 Optical Normalization)
    // -----------------------------------------------------------------------
    if (message.type === "layer1") {
      const img = await resolveImageRgba(message.image);
      const opt = processLayer1Optical(img.rgba, img.width, img.height);

      post("result", {
        requestId,
        result: {
          aspectRatio: opt.aspectRatio,
          solidity: opt.solidity,
          holeCount: opt.holeCount,
          holeFeatures: opt.holeFeatures,
          diagnostics: opt.diagnostics
        }
      });
      return;
    }

    // -----------------------------------------------------------------------
    // Message Type: enroll-signature-v2 (Enroll SKU into IndexedDB v2)
    // -----------------------------------------------------------------------
    if (message.type === "enroll-signature-v2") {
      const skuId = String(message.skuId || "");
      if (!skuId) throw new Error("Thiếu skuId để đăng ký linh kiện.");

      const img = await resolveImageRgba(message.image);
      const extractor = await getExtractor();

      const signature = await enrollSkuSignature(
        skuId,
        img.rgba,
        img.width,
        img.height,
        async (pseudoTensor, opt) => {
          const canvas = pseudoRgbTensorToCanvas(opt);
          return await extractFeaturesWithFallback(extractor, canvas);
        }
      );

      post("result", {
        requestId,
        result: {
          enrolled: true,
          skuId: signature.skuId,
          version: signature.version,
          aspectRatio: signature.aspectRatio,
          solidity: signature.solidity,
          holeCount: signature.holeCount
        }
      });
      return;
    }

    // -----------------------------------------------------------------------
    // Message Type: search-v2 (Full 3-Layer Search: Funnel 850 -> Top 10)
    // -----------------------------------------------------------------------
    if (message.type === "search-v2") {
      const img = await resolveImageRgba(message.image);
      const extractor = await getExtractor();

      const searchResult = await searchPartTop10(
        img.rgba,
        img.width,
        img.height,
        async (pseudoTensor, opt) => {
          const canvas = pseudoRgbTensorToCanvas(opt);
          return await extractFeaturesWithFallback(extractor, canvas);
        },
        message.candidates // Optional pre-fetched candidate pool
      );

      post("result", {
        requestId,
        result: {
          top10: searchResult.top10.map(r => ({
            skuId: r.skuId,
            rank: r.rank,
            finalScore: r.finalScore,
            sHybridVec: r.sHybridVec,
            sSpatialPatch: r.sSpatialPatch,
            dHoleGraph: r.dHoleGraph,
            dEfd: r.dEfd,
            zScores: r.zScores
          })),
          diagnostics: searchResult.opticalDiagnostics,
          totalCandidates: searchResult.totalCandidates,
          gatePassedCount: searchResult.gatePassedCount
        }
      });
      return;
    }

    // -----------------------------------------------------------------------
    // Message Type: reindex-batch-v2 (Batch re-index utility)
    // -----------------------------------------------------------------------
    if (message.type === "reindex-batch-v2") {
      const items = Array.isArray(message.items) ? message.items : [];
      const extractor = await getExtractor();

      const preparedItems = [];
      for (const item of items) {
        const img = await resolveImageRgba(item.image);
        preparedItems.push({
          skuId: item.skuId,
          rgba: img.rgba,
          width: img.width,
          height: img.height
        });
      }

      const reindexResult = await reindexBatchSignatures(
        preparedItems,
        async (pseudoTensor, opt) => {
          const canvas = pseudoRgbTensorToCanvas(opt);
          return await extractFeaturesWithFallback(extractor, canvas);
        },
        (processed, total) => {
          post("progress", { progress: { processed, total } });
        }
      );

      post("result", {
        requestId,
        result: reindexResult
      });
      return;
    }

    // -----------------------------------------------------------------------
    // Message Type: idb operations
    // -----------------------------------------------------------------------
    if (message.type === "delete-signature") {
      const skuId = String(message.skuId || "");
      if (skuId) await deleteSignature(skuId);
      post("result", { requestId, result: { deleted: true } });
      return;
    }

    if (message.type === "count-signatures") {
      const count = await countSignatures();
      post("result", { requestId, result: { count } });
      return;
    }

    if (message.type === "clear-signatures") {
      await clearAllSignatures();
      post("result", { requestId, result: { cleared: true } });
      return;
    }

    throw new Error(`Worker message type không hỗ trợ: ${message.type}`);
  } catch (error) {
    post("error", {
      requestId,
      error: {
        name: error?.name || "Error",
        message: error?.message || String(error)
      }
    });
  }
};
