import { describe, it, expect } from "vitest";
import {
  parseIdentifyingFeatures,
  extractQueryFeatures,
  isSingleFeatureMatch,
  matchRowWithFeatures,
  filterCatalogueByQueryFeatures,
  parseIdentifyingFeaturesAST,
  matchFeatureQueryFlexible
} from "../functions/_lib/moris/v5/retrieval/featureMatcher.js";

describe("Moris Identifying Features Matcher (Đặc điểm nhận dạng)", () => {
  describe("parseIdentifyingFeatures — Phân tách đặc điểm trong DB", () => {
    it("phân tách chính xác nhiều đặc điểm ngăn cách bằng dấu phẩy", () => {
      const raw = "6 lỗ tròn, 2 Lỗ vuông, 4 Lỗ oval, 3 lỗ tam giác";
      const parsed = parseIdentifyingFeatures(raw);

      expect(parsed).toHaveLength(4);
      expect(parsed[0]).toMatchObject({ number: 6, text: "lỗ tròn", shape: "tron" });
      expect(parsed[1]).toMatchObject({ number: 2, text: "lỗ vuông", shape: "vuong" });
      expect(parsed[2]).toMatchObject({ number: 4, text: "lỗ oval", shape: "oval" });
      expect(parsed[3]).toMatchObject({ number: 3, text: "lỗ tam giác", shape: "tam giac" });
    });

    it("xử lý an toàn chuỗi rỗng hoặc null", () => {
      expect(parseIdentifyingFeatures(null)).toEqual([]);
      expect(parseIdentifyingFeatures("")).toEqual([]);
      expect(parseIdentifyingFeatures("   ")).toEqual([]);
    });
  });

  describe("extractQueryFeatures — Trích xuất key từ câu hỏi người dùng", () => {
    it("trích xuất đúng key số và key chữ từ cụm ngắn", () => {
      const q1 = extractQueryFeatures("6 lỗ tròn");
      expect(q1).toHaveLength(1);
      expect(q1[0].number).toBe(6);
      expect(q1[0].shape).toBe("tron");

      const q2 = extractQueryFeatures("4 Lỗ oval");
      expect(q2).toHaveLength(1);
      expect(q2[0].number).toBe(4);
      expect(q2[0].shape).toBe("oval");
    });

    it("trích xuất đúng từ câu hỏi tự nhiên", () => {
      const q = extractQueryFeatures("tìm giúp anh mã 6 lỗ tròn nhé");
      expect(q).toHaveLength(1);
      expect(q[0].number).toBe(6);
      expect(q[0].shape).toBe("tron");
    });

    it("trích xuất nhiều đặc điểm ngăn cách bởi dấu phẩy", () => {
      const q = extractQueryFeatures("6 lỗ tròn, 2 Lỗ vuông");
      expect(q).toHaveLength(2);
      expect(q[0]).toMatchObject({ number: 6, shape: "tron" });
      expect(q[1]).toMatchObject({ number: 2, shape: "vuong" });
    });
  });

  describe("So khớp nghiêm ngặt theo key Số + key Chữ", () => {
    it("khớp '6 lỗ tròn' với DB '6 lỗ tròn' -> TRUE", () => {
      const db = { number: 6, text: "lỗ tròn", shape: "tron" };
      const q = { number: 6, text: "lỗ tròn", shape: "tron" };
      expect(isSingleFeatureMatch(db, q)).toBe(true);
    });

    it("TUYỆT ĐỐI KHÔNG khớp '6 lỗ tròn' khi DB là '16 lỗ tròn' -> FALSE (khác số)", () => {
      const db = { number: 16, text: "lỗ tròn", shape: "tron" };
      const q = { number: 6, text: "lỗ tròn", shape: "tron" };
      expect(isSingleFeatureMatch(db, q)).toBe(false);
    });

    it("TUYỆT ĐỐI KHÔNG khớp '16 lỗ tròn' khi DB là '6 lỗ tròn' -> FALSE", () => {
      const db = { number: 6, text: "lỗ tròn", shape: "tron" };
      const q = { number: 16, text: "lỗ tròn", shape: "tron" };
      expect(isSingleFeatureMatch(db, q)).toBe(false);
    });

    it("TUYỆT ĐỐI KHÔNG khớp '6 lỗ tròn' khi DB là '6 lỗ vuông' -> FALSE (khác chữ)", () => {
      const db = { number: 6, text: "lỗ vuông", shape: "vuong" };
      const q = { number: 6, text: "lỗ tròn", shape: "tron" };
      expect(isSingleFeatureMatch(db, q)).toBe(false);
    });

    it("không phân biệt hoa thường: '4 lỗ oval' khớp '4 Lỗ oval' -> TRUE", () => {
      const db = { number: 4, text: "Lỗ oval", shape: "oval" };
      const q = { number: 4, text: "lỗ oval", shape: "oval" };
      expect(isSingleFeatureMatch(db, q)).toBe(true);
    });
  });

  describe("matchRowWithFeatures & filterCatalogueByQueryFeatures trên Record", () => {
    const mockCatalogue = [
      { id: "1", code: "3411160201", identifying_features: "6 lỗ tròn" },
      { id: "2", code: "3411160202", identifying_features: "16 lỗ tròn" },
      { id: "3", code: "3411160203", identifying_features: "6 lỗ vuông" },
      { id: "4", code: "3411160204", identifying_features: "6 lỗ tròn, 2 Lỗ vuông, 4 Lỗ oval, 3 lỗ tam giác" },
      { id: "5", code: "3411160205", identifying_features: null }
    ];

    it("tìm '6 lỗ tròn': CHỈ trả về đúng các mã có '6 lỗ tròn' (code 3411160201 & 3411160204), loại bỏ 16 lỗ tròn và 6 lỗ vuông", () => {
      const result = filterCatalogueByQueryFeatures(mockCatalogue, "6 lỗ tròn");
      expect(result.isFeatureQuery).toBe(true);
      expect(result.matchedRows).toHaveLength(2);
      expect(result.matchedRows.map(r => r.code)).toEqual(["3411160201", "3411160204"]);
    });

    it("tìm '16 lỗ tròn': chỉ trả về đúng mã '3411160202', không trả về mã 6 lỗ tròn", () => {
      const result = filterCatalogueByQueryFeatures(mockCatalogue, "16 lỗ tròn");
      expect(result.isFeatureQuery).toBe(true);
      expect(result.matchedRows).toHaveLength(1);
      expect(result.matchedRows[0].code).toBe("3411160202");
    });

    it("tìm '4 lỗ oval' (không phân biệt hoa thường): khớp mã có '4 Lỗ oval'", () => {
      const result = filterCatalogueByQueryFeatures(mockCatalogue, "4 lỗ oval");
      expect(result.isFeatureQuery).toBe(true);
      expect(result.matchedRows).toHaveLength(1);
      expect(result.matchedRows[0].code).toBe("3411160204");
    });

    it("tìm đặc điểm không tồn tại (ví dụ '8 lỗ tròn'): trả về mảng rỗng [] CHỨ KHÔNG NHỒI NHÉT TOP 10 RÁC", () => {
      const result = filterCatalogueByQueryFeatures(mockCatalogue, "8 lỗ tròn");
      expect(result.isFeatureQuery).toBe(true);
      expect(result.matchedRows).toHaveLength(0);
    });

    it("tìm kết hợp nhiều đặc điểm: '6 lỗ tròn, 2 Lỗ vuông' -> chỉ mã 3411160204 thỏa mãn cả 2", () => {
      const result = filterCatalogueByQueryFeatures(mockCatalogue, "6 lỗ tròn, 2 Lỗ vuông");
      expect(result.isFeatureQuery).toBe(true);
      expect(result.matchedRows).toHaveLength(1);
      expect(result.matchedRows[0].code).toBe("3411160204");
    });
  });

  describe("API Integration: /api/moris/chat onRequestPost", () => {
    const mockDbParts = [
      { id: "uuid-1", code: "3411160201", identifying_features: "6 lỗ tròn" },
      { id: "uuid-2", code: "3411160202", identifying_features: "16 lỗ tròn" },
      { id: "uuid-3", code: "3411160203", identifying_features: "6 lỗ vuông" },
      { id: "uuid-4", code: "3411160204", identifying_features: "part 4", confusing_note: null },
      { id: "uuid-5", code: "3411160205", identifying_features: "part 5", confusing_note: null },
      { id: "uuid-6", code: "3411160206", identifying_features: "part 6", confusing_note: null },
      { id: "uuid-7", code: "3411160207", identifying_features: "part 7", confusing_note: null },
      { id: "uuid-8", code: "3411160208", identifying_features: "part 8", confusing_note: null },
      { id: "uuid-9", code: "3411160209", identifying_features: "part 9", confusing_note: null },
      { id: "uuid-10", code: "3411160210", identifying_features: "part 10", confusing_note: null },
      { id: "uuid-11", code: "3411160211", identifying_features: "part 11", confusing_note: null }
    ];

    function createMockEnv() {
      return {
        SUPABASE_URL: "https://test.supabase.co",
        SUPABASE_ANON_KEY: "anon-token",
        SUPABASE_SERVICE_ROLE_KEY: "service-token"
      };
    }

    it("gửi '6 lỗ tròn' -> CHỈ trả về đúng 1 mã 3411160201, không bị ép top 10 rác", async () => {
      const { onRequestPost } = await import("../functions/api/moris/chat.js");

      // Mock fetch cho session và catalogue RPC
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url) => {
        const u = String(url);
        if (u.includes("app_me")) {
          return new Response(JSON.stringify([{ ok: true, id: "test-user-id" }]), { status: 200 });
        }
        if (u.includes("app_search_catalogue")) {
          return new Response(JSON.stringify(mockDbParts), { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      };

      try {
        const fakeJwt = "header.payload.signature";
        const request = new Request("https://example.com/api/moris/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-session-token": fakeJwt
          },
          body: JSON.stringify({
            message: "6 lỗ tròn",
            session_token: fakeJwt
          })
        });

        const res = await onRequestPost({ request, env: createMockEnv() });
        expect(res.status).toBe(200);
        const data = await res.json();

        expect(data.ok).toBe(true);
        expect(data.engine).toBe("moris-feature-filter");
        // CHỈ ĐÚNG 1 MÃ TRUE, KHÔNG PHẢI TOP 10 RÁC
        expect(data.candidates).toHaveLength(1);
        expect(data.candidates[0].code).toBe("3411160201");
        expect(data.candidates[0].is_feature_match).toBe(true);
        expect(data.candidates[0].badge_label).toBe("Khớp");
        expect(data.answer).toContain("3411160201");
        expect(data.answer).not.toContain("3411160202");
        expect(data.answer).not.toContain("3411160203");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("gửi '16 lỗ tròn' -> CHỈ trả về đúng mã 3411160202, không nhầm sang 6 lỗ tròn", async () => {
      const { onRequestPost } = await import("../functions/api/moris/chat.js");

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url) => {
        const u = String(url);
        if (u.includes("app_me")) {
          return new Response(JSON.stringify([{ ok: true, id: "test-user-id" }]), { status: 200 });
        }
        if (u.includes("app_search_catalogue")) {
          return new Response(JSON.stringify(mockDbParts), { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      };

      try {
        const fakeJwt = "header.payload.signature";
        const request = new Request("https://example.com/api/moris/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-session-token": fakeJwt
          },
          body: JSON.stringify({
            message: "16 lỗ tròn",
            session_token: fakeJwt
          })
        });

        const res = await onRequestPost({ request, env: createMockEnv() });
        const data = await res.json();

        expect(data.ok).toBe(true);
        expect(data.candidates).toHaveLength(1);
        expect(data.candidates[0].code).toBe("3411160202");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("gửi '99 lỗ tròn' (không tồn tại) -> trả về candidates rỗng [], không pad mã bừa bãi", async () => {
      const { onRequestPost } = await import("../functions/api/moris/chat.js");

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url) => {
        const u = String(url);
        if (u.includes("app_me")) {
          return new Response(JSON.stringify([{ ok: true, id: "test-user-id" }]), { status: 200 });
        }
        if (u.includes("app_search_catalogue")) {
          return new Response(JSON.stringify(mockDbParts), { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      };

      try {
        const fakeJwt = "header.payload.signature";
        const request = new Request("https://example.com/api/moris/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-session-token": fakeJwt
          },
          body: JSON.stringify({
            message: "99 lỗ tròn",
            session_token: fakeJwt
          })
        });

        const res = await onRequestPost({ request, env: createMockEnv() });
        const data = await res.json();

        expect(data.ok).toBe(true);
        expect(data.candidates).toHaveLength(0);
        expect(data.answer).toContain("không tìm thấy mã nào");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("gửi '2 lỗ tròn': CHỈ trả về đúng mã có 2 lỗ tròn, TUYỆT ĐỐI loại bỏ mã 22 lỗ tròn, 20 lỗ và 2 lỗ vuông", async () => {
      const { onRequestPost } = await import("../functions/api/moris/chat.js");

      const realisticParts = [
        { id: "p-2", code: "3887000001", identifying_features: "2 lỗ tròn to, có rãnh khoét toàn thân" },
        { id: "p-22", code: "3960480101", identifying_features: "22 lỗ tròn, 4 lỗ vuông, 2 lỗ oval, 2 lỗ chữ nhật" },
        { id: "p-20", code: "3888130001", identifying_features: "21 lỗ tròn 20 lỗ nhỏ + 1 lỗ to, 4 lỗ chữ nhật" },
        { id: "p-2v", code: "3411160299", identifying_features: "2 lỗ vuông" }
      ];

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url) => {
        const u = String(url);
        if (u.includes("app_me")) {
          return new Response(JSON.stringify([{ ok: true, id: "test-user-id" }]), { status: 200 });
        }
        if (u.includes("app_search_catalogue")) {
          return new Response(JSON.stringify(realisticParts), { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      };

      try {
        const fakeJwt = "header.payload.signature";
        const request = new Request("https://example.com/api/moris/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-session-token": fakeJwt
          },
          body: JSON.stringify({
            message: "2 lỗ tròn",
            session_token: fakeJwt
          })
        });

        const res = await onRequestPost({ request, env: createMockEnv() });
        const data = await res.json();

        expect(data.ok).toBe(true);
        expect(data.candidates).toHaveLength(1);
        expect(data.candidates[0].code).toBe("3887000001");
        expect(data.candidates.some(c => c.code === "3960480101")).toBe(false);
        expect(data.candidates.some(c => c.code === "3888130001")).toBe(false);
        expect(data.candidates.some(c => c.code === "3411160299")).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("gửi '22 lỗ tròn': CHỈ trả về đúng mã 22 lỗ tròn (3960480101), không trả về mã 2 lỗ tròn", async () => {
      const { onRequestPost } = await import("../functions/api/moris/chat.js");

      const realisticParts = [
        { id: "p-2", code: "3887000001", identifying_features: "2 lỗ tròn to, có rãnh khoét toàn thân" },
        { id: "p-22", code: "3960480101", identifying_features: "22 lỗ tròn, 4 lỗ vuông, 2 lỗ oval, 2 lỗ chữ nhật" }
      ];

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url) => {
        const u = String(url);
        if (u.includes("app_me")) {
          return new Response(JSON.stringify([{ ok: true, id: "test-user-id" }]), { status: 200 });
        }
        if (u.includes("app_search_catalogue")) {
          return new Response(JSON.stringify(realisticParts), { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      };

      try {
        const fakeJwt = "header.payload.signature";
        const request = new Request("https://example.com/api/moris/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-session-token": fakeJwt
          },
          body: JSON.stringify({
            message: "22 lỗ tròn",
            session_token: fakeJwt
          })
        });

        const res = await onRequestPost({ request, env: createMockEnv() });
        const data = await res.json();

        expect(data.ok).toBe(true);
        expect(data.candidates).toHaveLength(1);
        expect(data.candidates[0].code).toBe("3960480101");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("Nghiêm ngặt case '2 lỗ tròn' vs '22 lỗ tròn' vs '20 lỗ tròn' vs 'lỗ vuông, oval'", () => {
    const dataset = [
      { id: "1", code: "3887000001", identifying_features: "2 lỗ tròn to, có rãnh khoét toàn thân" },
      { id: "2", code: "3960480101", identifying_features: "22 lỗ tròn, 4 lỗ vuông, 2 lỗ oval, 2 lỗ chữ nhật" },
      { id: "3", code: "3888130001", identifying_features: "21 lỗ tròn 20 lỗ nhỏ + 1 lỗ to, 4 lỗ chữ nhật" },
      { id: "4", code: "TEST_12", identifying_features: "12 lỗ tròn" },
      { id: "5", code: "TEST_2V", identifying_features: "2 lỗ vuông" },
      { id: "6", code: "TEST_2O", identifying_features: "2 lỗ oval" }
    ];

    it("lọc '2 lỗ tròn': chỉ giữ đúng mã 3887000001, loại 22 lỗ tròn, 20 lỗ, 12 lỗ, 2 lỗ vuông, 2 lỗ oval", () => {
      const res = filterCatalogueByQueryFeatures(dataset, "2 lỗ tròn");
      expect(res.isFeatureQuery).toBe(true);
      expect(res.matchedRows).toHaveLength(1);
      expect(res.matchedRows[0].code).toBe("3887000001");
    });

    it("lọc '22 lỗ tròn': chỉ giữ đúng mã 3960480101, không bị lẫn mã 2 lỗ tròn", () => {
      const res = filterCatalogueByQueryFeatures(dataset, "22 lỗ tròn");
      expect(res.isFeatureQuery).toBe(true);
      expect(res.matchedRows).toHaveLength(1);
      expect(res.matchedRows[0].code).toBe("3960480101");
    });

    it("lọc '2 lỗ vuông': chỉ giữ đúng mã TEST_2V, không nhầm sang 2 lỗ tròn hay 4 lỗ vuông", () => {
      const res = filterCatalogueByQueryFeatures(dataset, "2 lỗ vuông");
      expect(res.isFeatureQuery).toBe(true);
      expect(res.matchedRows).toHaveLength(1);
      expect(res.matchedRows[0].code).toBe("TEST_2V");
    });

    it("lọc nhiều đặc điểm ngăn cách dấu phẩy: '22 lỗ tròn, 4 lỗ vuông' -> chỉ mã 3960480101 thỏa mãn AND", () => {
      const res = filterCatalogueByQueryFeatures(dataset, "22 lỗ tròn, 4 lỗ vuông");
      expect(res.isFeatureQuery).toBe(true);
      expect(res.matchedRows).toHaveLength(1);
      expect(res.matchedRows[0].code).toBe("3960480101");
    });

    it("lọc nhiều đặc điểm: '2 lỗ tròn, 4 lỗ vuông' -> trả về rỗng vì không có mã nào vừa có 2 lỗ tròn vừa có 4 lỗ vuông", () => {
      const res = filterCatalogueByQueryFeatures(dataset, "2 lỗ tròn, 4 lỗ vuông");
      expect(res.isFeatureQuery).toBe(true);
      expect(res.matchedRows).toHaveLength(0);
    });
  });

  describe("parseIdentifyingFeaturesAST & matchFeatureQueryFlexible — Bất biến thứ tự & Suy luận", () => {
    it("trích xuất AST chính xác và tự động suy luận tổng số lỗ (big + small = total)", () => {
      const ast1 = parseIdentifyingFeaturesAST("5 lỗ tròn 4 lỗ to + 1 lỗ nhỏ");
      expect(ast1.totalHoles).toBe(5);
      expect(ast1.bigHoles).toBe(4);
      expect(ast1.smallHoles).toBe(1);
      expect(ast1.holeShapes).toContain("tron");

      // Đảo thứ tự chuỗi đầu vào nhưng AST thu được giống hệt
      const ast2 = parseIdentifyingFeaturesAST("1 lỗ nhỏ 4 lỗ to 5 lỗ tròn");
      expect(ast2.totalHoles).toBe(5);
      expect(ast2.bigHoles).toBe(4);
      expect(ast2.smallHoles).toBe(1);
      expect(ast2.holeShapes).toContain("tron");

      // Tự suy luận totalHoles = 3 + 2 = 5
      const ast3 = parseIdentifyingFeaturesAST("3 lỗ to 2 lỗ nhỏ");
      expect(ast3.totalHoles).toBe(5);
      expect(ast3.bigHoles).toBe(3);
      expect(ast3.smallHoles).toBe(2);
    });

    it("so khớp giao hoán (Order-Independent): '5 lỗ tròn 2 lỗ nhỏ + 3 lỗ to' khớp '5 lỗ tròn 3 lỗ to + 2 lỗ nhỏ'", () => {
      const dbText = "5 lỗ tròn, 3 lỗ to + 2 lỗ nhỏ";
      const queryReversed = "5 lỗ tròn 2 lỗ nhỏ + 3 lỗ to";

      const res = matchFeatureQueryFlexible(dbText, queryReversed);
      expect(res.matched).toBe(true);
      expect(res.tier).toBe("exact_match");
      expect(res.score).toBe(1.0);
    });

    it("so khớp ngầm định không cần nêu '5 lỗ tròn': '2 nhỏ 3 to' khớp DB '5 lỗ tròn 3 lỗ to + 2 lỗ nhỏ'", () => {
      const dbText = "5 lỗ tròn 3 lỗ to + 2 lỗ nhỏ";
      const queryShort = "2 nhỏ 3 to";

      const res = matchFeatureQueryFlexible(dbText, queryShort);
      expect(res.matched).toBe(true);
      expect(res.tier).toBe("exact_match");
      expect(res.score).toBe(1.0);
    });

    it("ngưỡng sai số cảm tính mắt thường (perceptual_tolerance): lệch 1 lỗ to/nhỏ khi bật allowPerceptualTolerance", () => {
      const dbText = "5 lỗ tròn 3 lỗ to + 2 lỗ nhỏ";
      const queryShift = "5 lỗ tròn 2 lỗ to + 3 lỗ nhỏ";

      // Mặc định allowPerceptualTolerance = false -> tuyệt đối không khớp
      const strictRes = matchFeatureQueryFlexible(dbText, queryShift);
      expect(strictRes.matched).toBe(false);

      // Khi bật allowPerceptualTolerance: true -> khớp sai số cảm tính
      const res = matchFeatureQueryFlexible(dbText, queryShift, { allowPerceptualTolerance: true });
      expect(res.matched).toBe(true);
      expect(res.tier).toBe("perceptual_tolerance");
      expect(res.score).toBe(0.85);
    });

    it("ranh giới số nghiêm ngặt: '2 lỗ' tuyệt đối không khớp '22 lỗ' hay '12 lỗ'", () => {
      expect(matchFeatureQueryFlexible("22 lỗ tròn", "2 lỗ tròn").matched).toBe(false);
      expect(matchFeatureQueryFlexible("12 lỗ tròn", "2 lỗ tròn").matched).toBe(false);
      expect(matchFeatureQueryFlexible("20 lỗ tròn", "2 lỗ tròn").matched).toBe(false);
      expect(matchFeatureQueryFlexible("2 lỗ tròn to", "2 lỗ tròn").matched).toBe(true);
    });
  });

  describe("Production Hotfix Cases: '3 lỗ nhỏ + 1 lỗ to' vs false positives", () => {
    const productionParts = [
      { id: "1", code: "3687110001", identifying_features: "4 lỗ tròn 3 lỗ nhỏ + 1 lỗ to" },
      { id: "2", code: "3885600001", identifying_features: "4 lỗ tròn 3 lỗ nhỏ 1 lỗ to, có uốn cong 2 đoạn" },
      { id: "3", code: "3883310001", identifying_features: "4 lỗ tròn 2 lỗ to + 2 lỗ nhỏ" },
      { id: "4", code: "3889630101", identifying_features: "4 lỗ oval, 5 lỗ tròn, 1 lỗ vuông nhỏ, 1 lỗ vuông to, uốn cong giữa thân" },
      { id: "5", code: "3889510001", identifying_features: "4 lỗ tròn, có uốn cong" },
      { id: "6", code: "3960230001", identifying_features: "4 lỗ tròn, 1 lỗ vuông" }
    ];

    const testQueries = [
      "3 lỗ nhỏ + 1 lỗ to",
      "1 lỗ to + 3 lỗ nhỏ",
      "4 lỗ tròn 3 lỗ nhỏ + 1 lỗ to"
    ];

    for (const q of testQueries) {
      it(`truy vấn "${q}": MUST match 3687110001 & 3885600001, MUST NOT match 3883310001, 3889630101, 3889510001, 3960230001`, () => {
        const res = filterCatalogueByQueryFeatures(productionParts, q);
        expect(res.isFeatureQuery).toBe(true);
        const codes = res.matchedRows.map(r => r.code);
        expect(codes).toContain("3687110001");
        expect(codes).toContain("3885600001");
        expect(codes).not.toContain("3883310001");
        expect(codes).not.toContain("3889630101");
        expect(codes).not.toContain("3889510001");
        expect(codes).not.toContain("3960230001");
        expect(res.matchedRows).toHaveLength(2);
      });
    }

    it("Moris Chat candidate trả về nhãn 'Khớp' và is_feature_match: true thay vì 100%", async () => {
      const { onRequestPost } = await import("../functions/api/moris/chat.js");
      const fakeJwt = "header.payload.signature";
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url) => {
        const u = String(url);
        if (u.includes("app_me")) return new Response(JSON.stringify([{ ok: true, id: "test-user-id" }]), { status: 200 });
        if (u.includes("app_search_catalogue")) return new Response(JSON.stringify(productionParts), { status: 200 });
        return new Response("Not found", { status: 404 });
      };

      try {
        const request = new Request("https://example.com/api/moris/chat", {
          method: "POST",
          headers: { "content-type": "application/json", "x-session-token": fakeJwt },
          body: JSON.stringify({ message: "3 lỗ nhỏ + 1 lỗ to", session_token: fakeJwt })
        });

        const res = await onRequestPost({ request, env: { SUPABASE_URL: "https://test.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "srv" } });
        const data = await res.json();
        expect(data.ok).toBe(true);
        expect(data.candidates).toHaveLength(2);
        for (const cand of data.candidates) {
          expect(cand.is_feature_match).toBe(true);
          expect(cand.badge_label).toBe("Khớp");
        }
        expect(data.answer).not.toContain("100%");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});


