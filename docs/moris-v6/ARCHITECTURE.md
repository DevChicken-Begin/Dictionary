# Moris V6: quyền ghi vector (M01)

Source of truth: `public.catalogue_image_vectors`; ảnh/metadata catalogue được lưu độc lập. IndexedDB là cache cục bộ, không chứng minh độ phủ Supabase. Query embedding là dữ liệu tạm để tìm kiếm, không lập chỉ mục.

## Call graph trước M02–M05

```text
src/app.js checkSession → timer → processMorisVectorQueue
  → vectorizeSavedPart → embedImageDinov2Variants
  → enrollSkuSignatureV2 → Worker enroll → IndexedDB
  → upsertMorisVectors → chunkedUpsert → POST /api/moris/vector-upsert
Editor button → vectorizeCurrentEditorPart → vectorizeSavedPart
Center single/batch click → embedImageDinov2Variants → POST vector-upsert
kim-vector-reindex.html → moris-vector-reindex.js start click
  → reindex-batch (read assets) → embedImageDinov2 → POST vector-upsert
vector-upsert → validateSession → requireEditor(admin/editor/converter)
  → duplicate check → service RPC kim_upsert_catalogue_image_vector
  → catalogue_image_vectors (unique composite key, ON CONFLICT UPDATE)
Moris query → browser embedding → search/chat → retrieval (no index write)
```

Static discovery: [M01-callers.txt](evidence/M01-callers.txt). The old Editor functions currently return early under disabled auto-save flags, but their entry points and retry timer remain. `savePart` already has no enqueue call. M02 removes the write entry points, preserving query embedding and deletion cleanup. The legacy reindex page must lead to Center rather than remain a second writer (M03).

## Event ownership contract

| Event | Allowed effect | Index writes |
|---|---|---|
| Editor create/save/update/upload | Metadata and image CRUD | Never |
| Editor mount/login/retry/auto-repair | Read session/catalogue | Never |
| Editor local signature enrollment | Not permitted | Never |
| Center mount/list/status/image preview | Read only | Never |
| Center single click + confirmation | Selected image assets only | Authorized role only |
| Center batch before confirmation/cancel | Preview counts | Never |
| Center confirmed batch | Explicit bounded asset list | Authorized role only |
| Same asset/profile/variant rerun | Skip or explicitly replace | Zero row growth |
| Moris image query | Temporary embedding and retrieval | Never |
| Image/SKU deletion | Existing approved deletion lifecycle | No embedding/create |

Server authorization remains `admin`, `editor`, `converter`; no privilege expansion. Client source markers express intent, not authorization: session/role checks remain mandatory. CSRF/anti-bot middleware remains in force.

## Identity, freshness and boundaries

Identity is `(record_id, asset_type, object_key, view_variant, embedding_model, embedding_model_version, preprocess_version, embedding_profile)`. Only `canon_rgb_v2` may be indexed by default. Gray expansion, new profiles and bulk patch storage require separate evidence/approval.

Freshness belongs to each asset, not a single SKU boolean. Missing, stale, partial and failed must never be promoted to ready merely because a sibling view has a vector. Same-key content freshness requires a measured source version/digest; absent evidence is not proof of freshness. Editor does not reindex or delete stale vectors.

M04/M05 must review lifecycle handling for replaced image keys and concurrent requests. No production migration is authorized. Tests use isolated fixtures/databases; production observation is read-only.

## Review and rollback

M01 changes documentation only. Revert its documentation and appended AGENTS contract to roll back; no DB action. M02–M05 implement this contract sequentially; Gate A requires evidence before any release. Unit tests alone do not certify camera accuracy or live staging E2E.
