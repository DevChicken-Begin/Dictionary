/**
 * featureMatcher.js — Bộ lọc đặc điểm nhận dạng chính xác theo cặp Số + Chữ
 * 
 * Quy tắc nghiêm ngặt:
 * 1. Phân tách theo dấu phẩy "," (ví dụ: "2 lỗ tròn, 4 Lỗ vuông, 2 Lỗ oval, 2 lỗ chữ nhật").
 * 2. Không phân biệt chữ hoa hay chữ thường (case-insensitive) và bỏ qua dấu tiếng Việt.
 * 3. Bóc tách rõ ràng theo cặp: Key "Số" và Key "Chữ" (ví dụ: cụm "2 lỗ tròn" -> key số: 2, key chữ: "lỗ tròn", shape: "tron").
 * 4. So khớp cực kỳ sát sao (Strict Matching):
 *    - Key Số: BẮT BUỘC bằng nhau hoàn toàn (2 chỉ lọc 2; TUYỆT ĐỐI KHÔNG lọc 20, 22, 12).
 *    - Key Chữ: BẮT BUỘC khớp đúng loại hình dáng ("lỗ tròn" chỉ lọc lỗ tròn; TUYỆT ĐỐI KHÔNG lọc lỗ vuông hay lỗ oval).
 * 5. Khi có nhiều đặc điểm ngăn cách bởi dấu phẩy trong query (ví dụ: "2 lỗ tròn, 4 lỗ vuông"):
 *    Mã phải thỏa mãn đồng thời (AND) tất cả các đặc điểm yêu cầu.
 * 6. CHỈ LỌC NHỮNG GÌ ĐÃ "TRUE", TUYỆT ĐỐI KHÔNG LẤY MÃ RÁC TOP 10.
 */

/** Chuẩn hóa chữ thường và khoảng trắng */
export function cleanFeatureText(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[.,;:!?()[\]{}"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Chuẩn hóa không dấu cho tìm kiếm tiếng Việt không dấu */
export function removeVietnameseAccents(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

const TRAILING_WORDS = new Set([
  "nhe", "nha", "a", "di", "voi", "giup", "anh", "em", "nhi", "khong", "chua", "ha", "roi", "oi"
]);

export const KNOWN_SHAPES = [
  { shape: "tam giac", match: /\b(?:tam giac|triangle)\b/i },
  { shape: "chu nhat", match: /\b(?:chu nhat|rectangle|chu\s+nhat)\b/i },
  { shape: "oval", match: /\b(?:oval|bau duc|ellipse)\b/i },
  { shape: "vuong", match: /\b(?:vuong|square)\b/i },
  { shape: "tron", match: /\b(?:tron|round|circular)\b/i }
];

/**
 * Trích xuất từ khóa hình dáng / loại lỗ lõi từ chuỗi text
 */
export function extractShapeKeyword(text) {
  const norm = removeVietnameseAccents(cleanFeatureText(text));

  // 1. Kiểm tra hình dạng chuẩn nếu có
  for (const item of KNOWN_SHAPES) {
    if (item.match.test(norm)) {
      return item.shape;
    }
  }

  // 2. Lọc bỏ các từ đệm và từ cảm thán cuối câu
  const words = norm.split(/\s+/).filter(w =>
    !["lo", "hole", "holes", "cai", "hinh", "co", "than"].includes(w) &&
    !TRAILING_WORDS.has(w)
  );
  return words.join(" ").trim();
}

/**
 * Phân tích 1 chuỗi segment thành { number, text, shape, raw }
 * Ví dụ:
 * - "2 lỗ tròn" -> { number: 2, text: "lỗ tròn", shape: "tron", raw: "2 lỗ tròn" }
 * - "22 lỗ tròn" -> { number: 22, text: "lỗ tròn", shape: "tron", raw: "22 lỗ tròn" }
 * - "4 lỗ vuông" -> { number: 4, text: "lỗ vuông", shape: "vuong", raw: "4 lỗ vuông" }
 */
export function parseSingleFeature(segment) {
  const raw = String(segment || "").trim();
  if (!raw) return null;

  const cleaned = cleanFeatureText(raw);
  const match = cleaned.match(/^(\d+)\s*(.+)$/);

  if (match) {
    const num = parseInt(match[1], 10);
    const textPart = match[2].trim();
    return {
      number: num,
      text: textPart,
      shape: extractShapeKeyword(textPart),
      raw
    };
  }

  // Nếu không bắt đầu bằng số, thử tìm số bên trong segment:
  // Ví dụ "có 2 lỗ tròn" hoặc "thân có 2 ngàm"
  const innerMatch = cleaned.match(/(\d+)\s+([a-zA-Zà-ỹÀ-Ỹ\s]+)/);
  if (innerMatch) {
    const num = parseInt(innerMatch[1], 10);
    const textPart = innerMatch[2].trim();
    return {
      number: num,
      text: textPart,
      shape: extractShapeKeyword(textPart),
      raw
    };
  }

  return {
    number: null,
    text: cleaned,
    shape: extractShapeKeyword(cleaned),
    raw
  };
}

/**
 * Phân tích toàn bộ chuỗi identifying_features (ngăn cách bởi dấu phẩy ",")
 * Hỗ trợ bóc tách cả phân đoạn chính lẫn phân đoạn phụ có dấu "+" (ví dụ: "20 lỗ nhỏ + 1 lỗ to")
 */
export function parseIdentifyingFeatures(featuresString) {
  if (!featuresString) return [];
  const segments = String(featuresString)
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const results = [];
  for (const seg of segments) {
    // Nếu trong phân đoạn có dấu "+" nối các đặc điểm con (ví dụ: "20 lỗ nhỏ + 1 lỗ to")
    if (seg.includes("+")) {
      const plusParts = seg.split("+").map(p => p.trim()).filter(Boolean);
      for (const pp of plusParts) {
        const pf = parseSingleFeature(pp);
        if (pf && pf.number != null) {
          results.push(pf);
        }
      }
    }

    const parsed = parseSingleFeature(seg);
    if (parsed) {
      results.push(parsed);
    }
  }

  return results;
}

/**
 * Trích xuất các yêu cầu đặc điểm nhận dạng từ câu query của người dùng
 * Bóc tách chính xác cặp: Key Số + Key Chữ và ngăn cách bởi dấu phẩy ","
 * Hỗ trợ:
 * - "2 lỗ tròn"
 * - "22 lỗ tròn"
 * - "20 lỗ tròn"
 * - "2 lỗ tròn, 4 lỗ vuông"
 * - "tìm mã 2 lỗ tròn"
 * - "2 lo tron" / "2 LỖ TRÒN"
 */
export function extractQueryFeatures(queryMessage) {
  const msg = String(queryMessage || "").trim();
  if (!msg) return [];

  // 1. Nếu query có dấu phẩy ",", phân tách thành từng phân đoạn độc lập
  if (msg.includes(",")) {
    const commaParts = msg.split(",").map(p => p.trim()).filter(Boolean);
    const candidateParts = [];

    for (const part of commaParts) {
      const parsed = parseSingleFeature(part);
      if (parsed && (parsed.number != null || parsed.shape)) {
        candidateParts.push(parsed);
      } else {
        const sub = extractQueryFeatures(part);
        if (sub.length) candidateParts.push(...sub);
      }
    }

    if (candidateParts.length > 0) {
      return candidateParts;
    }
  }

  // 2. Tìm kiếm regex cho các cụm [số] [chữ]
  const results = [];
  const pattern = /(?:^|[^\d])(\d+)\s*(?:lo|lỗ|hole|holes)?\s*([a-zA-Zà-ỹÀ-Ỹ]+(?:\s+[a-zA-Zà-ỹÀ-Ỹ]+)?)/gi;

  let m;
  const regex = new RegExp(pattern);
  while ((m = regex.exec(msg)) !== null) {
    const num = parseInt(m[1], 10);
    const textPart = m[2].trim();
    const cleaned = cleanFeatureText(textPart);

    // Bỏ qua nếu từ sau số là các stopword thông thường không phải đặc điểm nhận dạng
    const stopwords = ["ngay", "thang", "nam", "gio", "phut", "lan", "con", "ma", "chiec", "dong", "trang"];
    if (stopwords.includes(removeVietnameseAccents(cleaned))) {
      continue;
    }

    const fullText = `lỗ ${cleaned}`;
    results.push({
      number: num,
      text: fullText,
      shape: extractShapeKeyword(fullText),
      raw: m[0].trim()
    });
  }

  // 3. Fallback: Nếu câu ngắn gọn dưới 40 ký tự và bắt đầu bằng số (ví dụ: "2 lỗ tròn", "22 tròn", "4 oval")
  if (results.length === 0) {
    const directParsed = parseSingleFeature(msg);
    if (directParsed && directParsed.number != null && directParsed.text.length > 0) {
      results.push(directParsed);
    }
  }

  return results;
}

/**
 * So khớp cực kỳ sát sao 1 đặc điểm query với 1 đặc điểm trong DB
 * Quy tắc:
 * 1. Key Số: BẮT BUỘC bằng nhau hoàn toàn (2 === 2; 2 !== 22, 2 !== 20, 2 !== 12).
 * 2. Key Chữ: BẮT BUỘC khớp đúng loại hình dáng (lỗ tròn chỉ khớp lỗ tròn, KHÔNG khớp lỗ vuông hay oval).
 */
export function isSingleFeatureMatch(dbFeature, queryFeature) {
  if (!dbFeature || !queryFeature) return false;

  // 1. Kiểm tra key Số: BẮT BUỘC PHẢI BẰNG NHAU HOÀN TOÀN
  if (queryFeature.number != null) {
    if (dbFeature.number == null || dbFeature.number !== queryFeature.number) {
      return false; // Số khác nhau (ví dụ: query 2 !== db 22 hay db 20 hay db 12) -> FALSE!
    }
  }

  // 2. Kiểm tra key Chữ (Hình dáng / Loại lỗ):
  const qShape = queryFeature.shape || extractShapeKeyword(queryFeature.text);
  const dbShape = dbFeature.shape || extractShapeKeyword(dbFeature.text);

  // Nếu query có chỉ định loại hình dáng chuẩn (ví dụ "tron", "vuong", "oval", "chu nhat", "tam giac"):
  if (qShape) {
    if (!dbShape) return false;
    // BẮT BUỘC PHẢI KHỚP CHÍNH XÁC LOẠI HÌNH DÁNG
    // Nếu qShape là 'tron' thì dbShape BẮT BUỘC PHẢI LÀ 'tron'.
    // Tuyệt đối KHÔNG khớp nếu dbShape là 'vuong', 'oval', 'chu nhat', 'tam giac'!
    if (qShape !== dbShape) {
      return false;
    }
    return true;
  }

  // Nếu query không chỉ định hình dáng chuẩn (ví dụ chỉ tìm "2 lỗ"):
  const dbText = removeVietnameseAccents(cleanFeatureText(dbFeature.text));
  const qText = removeVietnameseAccents(cleanFeatureText(queryFeature.text));
  if (dbText === qText || dbText.includes(qText) || qText.includes(dbText)) {
    return true;
  }

  return false;
}

/**
 * Kiểm tra xem 1 record catalogue có khớp TẤT CẢ các đặc điểm query hay không (AND logic)
 * @returns {boolean} true nếu khớp toàn bộ các đặc điểm yêu cầu
 */
export function matchRowWithFeatures(row, queryFeatures) {
  if (!row || !queryFeatures || queryFeatures.length === 0) return false;

  const dbFeatures = parseIdentifyingFeatures(row.identifying_features);
  if (dbFeatures.length === 0) return false;

  // Mọi queryFeature đều phải tìm thấy ít nhất 1 dbFeature tương ứng khớp
  for (const qf of queryFeatures) {
    const matched = dbFeatures.some(df => isSingleFeatureMatch(df, qf));
    if (!matched) {
      return false;
    }
  }

  return true;
}

/**
 * Lọc danh mục catalogue theo đặc điểm nhận dạng
 * QUAN TRỌNG: Chỉ lọc những mã đã "TRUE", TUYỆT ĐỐI KHÔNG LỌC TOP 10 RÁC.
 */
export function filterCatalogueByQueryFeatures(catalogueRows, queryMessage) {
  const queryFeatures = extractQueryFeatures(queryMessage);

  if (queryFeatures.length === 0) {
    return {
      isFeatureQuery: false,
      queryFeatures: [],
      matchedRows: []
    };
  }

  const rows = Array.isArray(catalogueRows) ? catalogueRows : [];
  const matchedRows = rows.filter(row => matchRowWithFeatures(row, queryFeatures));

  return {
    isFeatureQuery: true,
    queryFeatures,
    matchedRows
  };
}
