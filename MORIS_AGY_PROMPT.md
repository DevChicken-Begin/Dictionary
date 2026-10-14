# SYSTEM INSTRUCTION & TASK PROMPT FOR AGY CLI (GEMINI 3.8 FLASH)

Read the specification file `MORIS_UPGRADE_PLAN.md` in the root of this repository (`PQVinh99-Glory/Dictionary`) and execute the full upgrade of the **Moris 3-Layer Computer Vision Harness** to achieve accurate Top-10 retrieval across 850 stamped steel part SKUs.

## MANDATORY EXECUTION RULES FOR GEMINI 3.8 FLASH
1. **NO PLACEHOLDERS OR STUBS:** You are strictly forbidden from writing `// TODO`, `// implement later`, or simplified mock math. Every mathematical algorithm specified in `MORIS_UPGRADE_PLAN.md` (PCA rotation, 180-degree hole-centroid disambiguation, CLAHE, 3x3 Scharr gradient, two-pass Chamfer Distance Transform, Signed GeM Pooling p=3.0, 3x3 Spatial Patch Matching, Hole Chamfer Distance, and 16-harmonic Elliptic Fourier Descriptors) MUST be implemented in full using pure TypeScript and `TypedArray` (`Float32Array`, `Uint8Array`, `Int32Array`).
2. **100% OFFLINE WEB WORKER COMPATIBLE:** Do not use DOM-dependent APIs (such as `document.createElement('canvas')`) inside Web Worker modules; use `OffscreenCanvas` or pure pixel buffer (`Uint8ClampedArray` / `Float32Array`) operations.
3. **ONE MILESTONE AT A TIME:** Complete and verify each file fully before moving to the next step so no code gets truncated.

## WORKFLOW TO EXECUTE NOW
1. **Discovery Phase:** Scan the repository to locate the existing Moris pipeline, Web Worker scripts, ONNX Runtime Web (`DINOv2-small`) inference wrapper, and IndexedDB storage service. Output a short mapping of existing files vs. new modules to be created/updated.
2. **Execute Step 1 (`moris-layer1-optical.ts`):** Write the complete Layer 1 module following Section 3 of `MORIS_UPGRADE_PLAN.md`.
3. **Execute Step 2 (`moris-layer2-embedding.ts`):** Write the complete Layer 2 module following Section 4 of `MORIS_UPGRADE_PLAN.md`. Inspect the existing ONNX session output names to extract the 256 patch tokens (`[1, 257, 384]`), and provide a safe fallback if the current model file only outputs `[1, 384]`.
4. **Execute Step 3 (`moris-layer3-rerank.ts`):** Write the complete Layer 3 module following Section 5 of `MORIS_UPGRADE_PLAN.md`.
5. **Execute Step 4 (Integration & Build Verification):** Integrate `moris-layer1-optical.ts`, `moris-layer2-embedding.ts`, and `moris-layer3-rerank.ts` into the main Moris Worker and IndexedDB schema (`MorisPartSignature` v2). Run TypeScript type-checking (`tsc --noEmit`) and fix any compilation errors until the build is completely clean.