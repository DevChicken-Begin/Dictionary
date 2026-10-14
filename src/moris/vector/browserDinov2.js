import { canonicalizeImageVariants } from "./imageCanonicalizer.js";

const WORKER_URL = new URL("./dinov2.worker.js", import.meta.url);

export const MORIS_DINOV2_PROFILE = Object.freeze({"model": "onnx-community/dinov2-small", "model_version": "ef1fb10", "preprocess_version": "kim_canon_v2", "profile": "cls_l2_v1", "dimension": 384});

let worker = null;
let sequence = 0;
const pending = new Map();
const progressListeners = new Set();

function ensureWorker() {
  if (worker) return worker;

  worker = new Worker(WORKER_URL, {type:"module"});

  worker.onmessage = event => {
    const message = event?.data || {};

    if (message.type === "progress") {
      for (const listener of progressListeners) {
        try { listener(message.progress || {}); } catch {}
      }
      return;
    }

    if (message.type === "runtime-warning") {
      console.warn("Moris DINOv2:", message.message || "");
      return;
    }

    const entry = pending.get(String(message.requestId || ""));
    if (!entry) return;

    if (message.type === "result") {
      pending.delete(String(message.requestId));
      entry.resolve(message.result);
      return;
    }

    if (message.type === "error") {
      pending.delete(String(message.requestId));
      const error = new Error(
        message?.error?.message || "DINOv2 worker lỗi."
      );
      error.name = message?.error?.name || "Error";
      entry.reject(error);
    }
  };

  worker.onerror = event => {
    const error = new Error(
      event?.message || "DINOv2 worker bị dừng bất thường."
    );

    for (const entry of pending.values()) {
      entry.reject(error);
    }
    pending.clear();

    try { worker.terminate(); } catch {}
    worker = null;
  };

  return worker;
}

function request(type, payload={}) {
  const currentWorker = ensureWorker();
  const requestId = `kimv55_${Date.now()}_${++sequence}`;

  return new Promise((resolve,reject) => {
    pending.set(requestId, {resolve,reject});
    currentWorker.postMessage({type,requestId,...payload});
  });
}

export function onDinov2Progress(listener) {
  if (typeof listener !== "function") return () => {};
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

export async function initDinov2() {
  return request("init");
}

export async function embedImageDinov2(image) {
  const result = await request("embed", {image:String(image || "")});

  if (
    !Array.isArray(result?.embedding) ||
    result.embedding.length !== MORIS_DINOV2_PROFILE.dimension
  ) {
    throw new Error("DINOv2 embedding không đúng 384 chiều.");
  }

  return {
    embedding: result.embedding,
    profile: MORIS_DINOV2_PROFILE,
    runtime: result.runtime || null
  };
}

export function disposeDinov2() {
  if (worker) {
    try { worker.terminate(); } catch {}
  }
  worker = null;

  const error = new Error("DINOv2 worker đã dispose.");
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
}


export async function embedImageDinov2Variants(image, { includeGray = true } = {}) {
  try {
    if (typeof Worker !== "undefined") {
      const res = await request("embed-variants-v2", { image, includeGray });
      if (res && Array.isArray(res.probes) && res.probes.length > 0) {
        return res;
      }
    }
  } catch (workerErr) {
    console.warn("embedImageDinov2Variants worker v2 fallback:", workerErr);
  }

  const canonical = await canonicalizeImageVariants(image, { includeGray });
  const probes = [];

  for (const variant of canonical.variants) {
    const result = await embedImageDinov2(variant.image_data_url);
    probes.push({
      probe_id: variant.probe_id,
      view_variant: variant.view_variant,
      embedding: result.embedding,
      profile: {
        ...result.profile,
        preprocess_version: 'kim_canon_v2'
      },
      runtime: result.runtime || null,
      diagnostics: variant.diagnostics || null
    });
  }

  return {
    probes,
    diagnostics: canonical.diagnostics,
    geometry: canonical.geometry || null,
    preprocess_version: 'kim_canon_v2'
  };
}

export async function processLayer1InWorker(image) {
  return request("layer1", { image });
}

export async function enrollSkuSignatureV2(skuId, image) {
  return request("enroll-signature-v2", { skuId, image });
}

export async function searchPartTop10V2(image, candidates) {
  return request("search-v2", { image, candidates });
}

export async function reindexBatchV2(items) {
  return request("reindex-batch-v2", { items });
}

export async function deleteSignatureV2(skuId) {
  return request("delete-signature", { skuId });
}

export async function countSignaturesV2() {
  const res = await request("count-signatures");
  return Number(res?.count || 0);
}

export async function clearSignaturesV2() {
  return request("clear-signatures");
}
