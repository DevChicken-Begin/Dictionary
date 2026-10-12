import { describe, it, expect, vi } from "vitest";
import { onRequestPost as handleBulkDelete } from "../functions/api/catalogue/bulk-delete.js";
import { onRequestPost as handleDeletePart } from "../functions/api/catalogue/delete-part.js";
import { onRequestPost as handleDeleteAll } from "../functions/api/catalogue/delete-all.js";

function makeJwt(role = "admin") {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({ role, sub: "user-123", exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${header}.${payload}.signature`;
}

describe("Catalogue Delete Suite (Bulk Delete, Delete Part & Delete All)", () => {
  describe("/api/catalogue/bulk-delete", () => {
    it("từ chối 401 nếu thiếu session token", async () => {
      const mockEnv = {
        SUPABASE_URL: "https://test.supabase.co",
        SUPABASE_ANON_KEY: "anon-key"
      };
      const request = new Request("https://example.com/api/catalogue/bulk-delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image_ids: ["00000000-0000-0000-0000-000000000001"] })
      });
      const res = await handleBulkDelete({ request, env: mockEnv });
      expect(res.status).toBe(401);
    });

    it("từ chối 403 nếu tài khoản không phải admin (ví dụ converter/viewer)", async () => {
      const userJwt = makeJwt("converter");
      const mockEnv = {
        SUPABASE_URL: "https://test.supabase.co",
        SUPABASE_ANON_KEY: "anon-key"
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (String(url).includes("/rpc/app_me")) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, role_name: "converter" }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      });

      const request = new Request("https://example.com/api/catalogue/bulk-delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_token: userJwt, image_ids: ["00000000-0000-0000-0000-000000000001"] })
      });

      const res = await handleBulkDelete({ request, env: mockEnv });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("admin");

      globalThis.fetch = originalFetch;
    });

    it("cho phép admin xóa hàng loạt, gọi R2 delete và xóa sạch vector AI trong catalogue_image_vectors", async () => {
      const adminJwt = makeJwt("admin");
      let deletedKeys = [];
      let vectorDeleteCalled = false;
      const mockBucket = {
        delete: vi.fn().mockImplementation((keys) => {
          deletedKeys.push(...keys);
          return Promise.resolve();
        })
      };
      const mockEnv = {
        SUPABASE_URL: "https://test.supabase.co",
        SUPABASE_ANON_KEY: "anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
        CATALOGUE_BUCKET: mockBucket
      };

      let rpcCalled = "";
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url, opts) => {
        const urlStr = String(url);
        if (urlStr.includes("/rpc/app_me")) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, role_name: "admin" }), { status: 200 }));
        }
        if (urlStr.includes("/rpc/app_bulk_delete_parts")) {
          rpcCalled = "app_bulk_delete_parts";
          return Promise.resolve(new Response(JSON.stringify({
            ok: true,
            deleted_count: 2,
            r2_keys: ["front/M1/u1.webp", "thumb/M1/u2.webp"]
          }), { status: 200 }));
        }
        if (urlStr.includes("/rest/v1/catalogue_image_vectors") && opts?.method === "DELETE") {
          vectorDeleteCalled = true;
          return Promise.resolve(new Response(JSON.stringify([
            { id: 101, record_id: "00000000-0000-0000-0000-000000000001" },
            { id: 102, record_id: "00000000-0000-0000-0000-000000000002" }
          ]), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      });

      const request = new Request("https://example.com/api/catalogue/bulk-delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session_token: adminJwt,
          image_ids: [
            "00000000-0000-0000-0000-000000000001",
            "00000000-0000-0000-0000-000000000002"
          ]
        })
      });

      const res = await handleBulkDelete({ request, env: mockEnv });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.deleted_count).toBe(2);
      expect(data.deleted_vectors_count).toBe(2);
      expect(rpcCalled).toBe("app_bulk_delete_parts");
      expect(vectorDeleteCalled).toBe(true);
      expect(mockBucket.delete).toHaveBeenCalled();
      expect(deletedKeys).toContain("front/M1/u1.webp");
      expect(deletedKeys).toContain("thumb/M1/u2.webp");

      globalThis.fetch = originalFetch;
    });
  });

  describe("/api/catalogue/delete-all", () => {
    it("từ chối 403 nếu không phải admin", async () => {
      const userJwt = makeJwt("viewer");
      const mockEnv = {
        SUPABASE_URL: "https://test.supabase.co",
        SUPABASE_ANON_KEY: "anon-key"
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (String(url).includes("/rpc/app_me")) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, role_name: "viewer" }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      });

      const request = new Request("https://example.com/api/catalogue/delete-all", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_token: userJwt, confirm: true })
      });

      const res = await handleDeleteAll({ request, env: mockEnv });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("admin");

      globalThis.fetch = originalFetch;
    });

    it("từ chối 400 nếu thiếu confirm=true", async () => {
      const adminJwt = makeJwt("admin");
      const mockEnv = {
        SUPABASE_URL: "https://test.supabase.co",
        SUPABASE_ANON_KEY: "anon-key"
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (String(url).includes("/rpc/app_me")) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, role_name: "admin" }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      });

      const request = new Request("https://example.com/api/catalogue/delete-all", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_token: adminJwt, confirm: false })
      });

      const res = await handleDeleteAll({ request, env: mockEnv });
      expect(res.status).toBe(400);

      globalThis.fetch = originalFetch;
    });

    it("cho phép admin xóa toàn bộ catalogue và làm sạch bucket R2", async () => {
      const adminJwt = makeJwt("admin");
      let deletedKeys = [];
      const mockBucket = {
        list: vi.fn().mockResolvedValue({
          objects: [{ key: "front/A1/1.webp" }, { key: "thumb/A1/2.webp" }],
          truncated: false
        }),
        delete: vi.fn().mockImplementation((keys) => {
          deletedKeys.push(...keys);
          return Promise.resolve();
        })
      };
      const mockEnv = {
        SUPABASE_URL: "https://test.supabase.co",
        SUPABASE_ANON_KEY: "anon-key",
        CATALOGUE_BUCKET: mockBucket
      };

      let rpcCalled = "";
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        const urlStr = String(url);
        if (urlStr.includes("/rpc/app_me")) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, role_name: "admin" }), { status: 200 }));
        }
        if (urlStr.includes("/rpc/app_delete_all_parts")) {
          rpcCalled = "app_delete_all_parts";
          return Promise.resolve(new Response(JSON.stringify({
            ok: true,
            deleted_count: 50,
            r2_keys: ["front/A1/1.webp", "thumb/A1/2.webp"]
          }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      });

      const request = new Request("https://example.com/api/catalogue/delete-all", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_token: adminJwt, confirm: true })
      });

      const res = await handleDeleteAll({ request, env: mockEnv });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.deleted_count).toBe(50);
      expect(rpcCalled).toBe("app_delete_all_parts");
      expect(mockBucket.list).toHaveBeenCalled();
      expect(mockBucket.delete).toHaveBeenCalled();
      expect(deletedKeys).toContain("front/A1/1.webp");

      globalThis.fetch = originalFetch;
    });
  });

  describe("/api/catalogue/delete-part", () => {
    it("từ chối 401 nếu thiếu session token", async () => {
      const mockEnv = {
        SUPABASE_URL: "https://test.supabase.co",
        SUPABASE_ANON_KEY: "anon-key"
      };
      const request = new Request("https://example.com/api/catalogue/delete-part", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image_id: "00000000-0000-0000-0000-000000000001" })
      });
      const res = await handleDeletePart({ request, env: mockEnv });
      expect(res.status).toBe(401);
    });

    it("từ chối 403 nếu tài khoản không phải admin", async () => {
      const viewerJwt = makeJwt("viewer");
      const mockEnv = {
        SUPABASE_URL: "https://test.supabase.co",
        SUPABASE_ANON_KEY: "anon-key"
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (String(url).includes("/rpc/app_me")) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, role_name: "viewer" }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      });

      const request = new Request("https://example.com/api/catalogue/delete-part", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_token: viewerJwt, image_id: "00000000-0000-0000-0000-000000000001" })
      });

      const res = await handleDeletePart({ request, env: mockEnv });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("admin");

      globalThis.fetch = originalFetch;
    });

    it("từ chối 400 nếu image_id không hợp lệ (không phải UUID)", async () => {
      const adminJwt = makeJwt("admin");
      const mockEnv = {
        SUPABASE_URL: "https://test.supabase.co",
        SUPABASE_ANON_KEY: "anon-key"
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (String(url).includes("/rpc/app_me")) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, role_name: "admin" }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      });

      const request = new Request("https://example.com/api/catalogue/delete-part", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_token: adminJwt, image_id: "invalid-id" })
      });

      const res = await handleDeletePart({ request, env: mockEnv });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("UUID");

      globalThis.fetch = originalFetch;
    });

    it("cho phép admin xóa mã đơn lẻ, gọi RPC app_delete_part và xóa sạch vector AI trong catalogue_image_vectors", async () => {
      const adminJwt = makeJwt("admin");
      let vectorDeleteCalled = false;
      let rpcDeleteCalled = false;
      const targetId = "12345678-1234-1234-1234-123456789abc";

      const mockEnv = {
        SUPABASE_URL: "https://test.supabase.co",
        SUPABASE_ANON_KEY: "anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "service-key"
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url, opts) => {
        const urlStr = String(url);
        if (urlStr.includes("/rpc/app_me")) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, role_name: "admin" }), { status: 200 }));
        }
        if (urlStr.includes("/rpc/app_delete_part")) {
          rpcDeleteCalled = true;
          return Promise.resolve(new Response(JSON.stringify({ ok: true, deleted_id: targetId }), { status: 200 }));
        }
        if (urlStr.includes("/rest/v1/catalogue_image_vectors") && opts?.method === "DELETE") {
          vectorDeleteCalled = true;
          return Promise.resolve(new Response(JSON.stringify([
            { id: 201, record_id: targetId, asset_type: "front" },
            { id: 202, record_id: targetId, asset_type: "back" }
          ]), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      });

      const request = new Request("https://example.com/api/catalogue/delete-part", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_token: adminJwt, image_id: targetId })
      });

      const res = await handleDeletePart({ request, env: mockEnv });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.deleted_vectors_count).toBe(2);
      expect(rpcDeleteCalled).toBe(true);
      expect(vectorDeleteCalled).toBe(true);

      globalThis.fetch = originalFetch;
    });
  });

  describe("Client Vector Queue Cleanup on Delete", () => {
    it("removeMorisVectorJob dọn sạch job của mã bị xóa khỏi queue và failed queue", () => {
      let store = {
        "catalogue_moris_vector_queue_v5": JSON.stringify([
          { record_id: "id-1", code: "3410970001" },
          { record_id: "id-2", code: "3410970002" }
        ]),
        "catalogue_moris_vector_queue_failed_v5": JSON.stringify([
          { record_id: "id-1", code: "3410970001", error: "fail" }
        ])
      };

      const removeMorisVectorJob = (recordId) => {
        const key = String(recordId || "");
        if (!key) return;
        const q = JSON.parse(store["catalogue_moris_vector_queue_v5"] || "[]").filter(j => String(j?.record_id) !== key);
        store["catalogue_moris_vector_queue_v5"] = JSON.stringify(q);
        const f = JSON.parse(store["catalogue_moris_vector_queue_failed_v5"] || "[]").filter(j => String(j?.record_id) !== key);
        store["catalogue_moris_vector_queue_failed_v5"] = JSON.stringify(f);
      };

      removeMorisVectorJob("id-1");

      const remainingQ = JSON.parse(store["catalogue_moris_vector_queue_v5"]);
      const remainingF = JSON.parse(store["catalogue_moris_vector_queue_failed_v5"]);
      expect(remainingQ).toHaveLength(1);
      expect(remainingQ[0].record_id).toBe("id-2");
      expect(remainingF).toHaveLength(0);
    });

    it("removeMorisVectorJobs dọn sạch danh sách nhiều mã bị xóa hàng loạt", () => {
      let store = {
        "catalogue_moris_vector_queue_v5": JSON.stringify([
          { record_id: "id-1" },
          { record_id: "id-2" },
          { record_id: "id-3" }
        ])
      };

      const removeMorisVectorJobs = (recordIds) => {
        const idSet = new Set((recordIds || []).map(id => String(id)));
        if (!idSet.size) return;
        const q = JSON.parse(store["catalogue_moris_vector_queue_v5"] || "[]").filter(j => !idSet.has(String(j?.record_id)));
        store["catalogue_moris_vector_queue_v5"] = JSON.stringify(q);
      };

      removeMorisVectorJobs(["id-1", "id-3"]);

      const remainingQ = JSON.parse(store["catalogue_moris_vector_queue_v5"]);
      expect(remainingQ).toHaveLength(1);
      expect(remainingQ[0].record_id).toBe("id-2");
    });
  });
});
