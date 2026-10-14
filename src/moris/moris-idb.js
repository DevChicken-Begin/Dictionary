/**
 * moris-idb.ts
 * ============================================================================
 * MORIS 3-LAYER COMPUTER VISION HARNESS — INDEXEDDB SIGNATURE STORAGE (v2)
 *
 * Manages client-side persistent storage and fast indexing of MorisPartSignature v2
 * across 850 stamped steel part SKUs for offline Web Worker search.
 *
 * Features:
 * - IndexedDB Database: "moris_cv_db", Object Store: "signatures_v2", keyPath: "skuId"
 * - Secondary Indexes: "aspectRatio", "holeCount", "solidity"
 * - Batch upsert / bulk retrieval / geometric range queries
 * - Full memory store fallback for Node.js / test environments where IDB is unavailable.
 * ============================================================================
 */
const DB_NAME = "moris_cv_db";
const DB_VERSION = 2;
const STORE_NAME = "signatures_v2";
// In-memory fallback map for non-browser / headless test environments
const memoryStore = new Map();
function isIndexedDBAvailable() {
    return typeof indexedDB !== "undefined";
}
/**
 * Serializes MorisPartSignature with TypedArrays into IDB-storable plain objects.
 */
export function serializeSignature(sig) {
    return {
        skuId: sig.skuId,
        version: 2,
        aspectRatio: sig.aspectRatio,
        solidity: sig.solidity,
        holeCount: sig.holeCount,
        canonicalEmbedding: Array.from(sig.canonicalEmbedding),
        perspectiveCentroid: Array.from(sig.perspectiveCentroid),
        holeConstellation: sig.holeConstellation.map(h => ({ ...h })),
        efdCoefficients: Array.from(sig.efdCoefficients),
        keyPatches: sig.keyPatches.map(kp => ({
            gridIdx: kp.gridIdx,
            weight: kp.weight,
            vec: Array.from(kp.vec)
        }))
    };
}
/**
 * Deserializes raw IDB record back into strongly-typed MorisPartSignature with TypedArrays.
 */
export function deserializeSignature(raw) {
    return {
        skuId: String(raw.skuId),
        version: 2,
        aspectRatio: Number(raw.aspectRatio || 1.0),
        solidity: Number(raw.solidity || 1.0),
        holeCount: Number(raw.holeCount || 0),
        canonicalEmbedding: new Float32Array(raw.canonicalEmbedding || 768),
        perspectiveCentroid: new Float32Array(raw.perspectiveCentroid || 768),
        holeConstellation: Array.isArray(raw.holeConstellation) ? raw.holeConstellation : [],
        efdCoefficients: new Float32Array(raw.efdCoefficients || 16),
        keyPatches: Array.isArray(raw.keyPatches)
            ? raw.keyPatches.map((kp) => ({
                gridIdx: Number(kp.gridIdx || 0),
                weight: Number(kp.weight || 0),
                vec: new Float32Array(kp.vec || 384)
            }))
            : []
    };
}
/**
 * Opens or upgrades the IndexedDB database instance.
 */
export function openMorisDatabase() {
    if (!isIndexedDBAvailable()) {
        return Promise.resolve(null);
    }
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: "skuId" });
                store.createIndex("aspectRatio", "aspectRatio", { unique: false });
                store.createIndex("holeCount", "holeCount", { unique: false });
                store.createIndex("solidity", "solidity", { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error("Không thể mở IndexedDB."));
    });
}
/**
 * Saves or updates a single part signature in the database.
 */
export async function saveSignature(sig) {
    const db = await openMorisDatabase();
    if (!db) {
        memoryStore.set(sig.skuId, sig);
        return;
    }
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const serialized = serializeSignature(sig);
        const req = store.put(serialized);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error || new Error(`Lỗi lưu signature ${sig.skuId}`));
    });
}
/**
 * Batch saves an array of part signatures in a single transaction.
 */
export async function saveSignaturesBatch(signatures) {
    if (!signatures.length)
        return 0;
    const db = await openMorisDatabase();
    if (!db) {
        for (const sig of signatures) {
            memoryStore.set(sig.skuId, sig);
        }
        return signatures.length;
    }
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        let count = 0;
        for (const sig of signatures) {
            store.put(serializeSignature(sig));
            count++;
        }
        tx.oncomplete = () => resolve(count);
        tx.onerror = () => reject(tx.error || new Error("Lỗi batch upsert signatures."));
    });
}
/**
 * Retrieves a part signature by SKU ID.
 */
export async function getSignatureBySku(skuId) {
    const db = await openMorisDatabase();
    if (!db) {
        return memoryStore.get(skuId) || null;
    }
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(skuId);
        req.onsuccess = () => {
            if (req.result) {
                resolve(deserializeSignature(req.result));
            }
            else {
                resolve(null);
            }
        };
        req.onerror = () => reject(req.error);
    });
}
/**
 * Retrieves all stored part signatures (e.g. for Layer 2 coarse filtering across 850 SKUs).
 */
export async function getAllSignatures() {
    const db = await openMorisDatabase();
    if (!db) {
        return Array.from(memoryStore.values());
    }
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
            const records = Array.isArray(req.result) ? req.result : [];
            resolve(records.map(deserializeSignature));
        };
        req.onerror = () => reject(req.error);
    });
}
/**
 * Clears all signatures from the database.
 */
export async function clearAllSignatures() {
    const db = await openMorisDatabase();
    if (!db) {
        memoryStore.clear();
        return;
    }
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}
/**
 * Deletes a single part signature by SKU ID.
 */
export async function deleteSignature(skuId) {
    const db = await openMorisDatabase();
    if (!db) {
        memoryStore.delete(skuId);
        return;
    }
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(skuId);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}
/**
 * Returns total count of enrolled SKU signatures.
 */
export async function countSignatures() {
    const db = await openMorisDatabase();
    if (!db) {
        return memoryStore.size;
    }
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.count();
        req.onsuccess = () => resolve(Number(req.result || 0));
        req.onerror = () => reject(req.error);
    });
}
