/**
 * featureMatcher.js — Bộ lọc đặc điểm nhận dạng chính xác theo cặp Số + Chữ
 * 
 * Quy tắc:
 * 1. Phân tách identifying_features theo dấu phẩy "," (ví dụ: "6 lỗ tròn, 2 Lỗ vuông, 4 Lỗ oval, 3 lỗ tam giác").
 * 2. Không phân biệt chữ hoa hay chữ thường (case-insensitive).
 * 3. Tham chiếu theo cặp: "Số" trước, "Chữ" sau (ví dụ: cụm "6 lỗ tròn" -> key số: 6, key chữ: "lỗ tròn").
 * 4. So khớp chính xác:
 *    - Số query === Số DB (nghiêm ngặt: 6 KHÔNG khớp 16, 26, 60).
 *    - Chữ query khớp Chữ DB (lỗ tròn KHÔNG khớp lỗ vuông hay oval).
 * 5. CHỈ LỌC NHỮNG GÌ ĐÃ "TRUE", TUYỆT ĐỐI KHÔNG ÉP VỀ TOP 10 (nếu có 1 mã true thì chỉ trả đúng 1 mã).
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

const KNOWN_SHAPES = [
  { shape: "tam giac", match: /\b(?:tam giac|triangle)\b/ },
  { shape: "chu nhat", match: /\b(?:chu nhat|rectangle)\b/ },
  { shape: "oval", match: /\b(?:oval|bau duc|ellipse)\b/ },
  { shape: "vuong", match: /\b(?:vuong|square)\b/ },
  { shape: "tron", match: /\b(?:tron|round|circular)\b/ }
];

/**
 * Trích xuất từ khóa hình dáng / loại lỗ lõi (loại bỏ từ "lỗ" hoặc từ đệm)
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
    !["lo", "hole", "holes", "cai", "hinh"].includes(w) &&
    !TRAILING_WORDS.has(w)
  );
  return words.join(" ").trim();
}

/**
 * Phân tích 1 chuỗi segment thành { number, text, raw }
 * Ví dụ: "6 lỗ tròn" -> { number: 6, text: "lỗ tròn", shape: "tron", raw: "6 lỗ tròn" }
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

  return {
    number: null,
    text: cleaned,
    shape: extractShapeKeyword(cleaned),
    raw
  };
}

/**
 * Phân tích toàn bộ chuỗi identifying_features (ngăn cách bởi dấu phẩy ",")
 */
export function parseIdentifyingFeatures(featuresString) {
  if (!featuresString) return [];
  const segments = String(featuresString)
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  return segments
    .map(parseSingleFeature)
    .filter(Boolean);
}

/**
 * Trích xuất các yêu cầu đặc điểm nhận dạng từ câu query của người dùng
 * Hỗ trợ các dạng:
 * - "6 lỗ tròn"
 * - "4 Lỗ oval"
 * - "6 lỗ tròn, 2 Lỗ vuông"
 * - "tìm mã 6 lỗ tròn"
 * - "có mã nào 4 lỗ oval không"
 */
export function extractQueryFeatures(queryMessage) {
  const msg = String(queryMessage || "").trim();
  if (!msg) return [];

  const results = [];

  // 1. Nếu query có dấu phẩy, thử parse từng phân đoạn
  if (msg.includes(",")) {
    const commaParts = msg.split(",").map(p => p.trim()).filter(Boolean);
    let allPartsParsed = true;
    const candidateParts = [];

    for (const part of commaParts) {
      const parsed = parseSingleFeature(part);
      if (parsed && parsed.number != null) {
        candidateParts.push(parsed);
      } else {
        allPartsParsed = false;
        break;
      }
    }

    if (allPartsParsed && candidateParts.length > 0) {
      return candidateParts;
    }
  }

  // 2. Tìm kiếm regex cho các cụm [số] [chữ]
  // Nhận diện: (\d+)\s*(lỗ\s+[a-zA-Zà-ỹÀ-Ỹ]+|[a-zA-Zà-ỹÀ-Ỹ]+\s+lỗ|[a-zA-Zà-ỹÀ-Ỹ]+)
  // Ưu tiên các cụm có từ "lỗ", "lo", "oval", "tron", "vuong", "tam giac", "chu nhat"...
  const pattern = /(?:^|[^\d])(\d+)\s+(?:lo|lỗ|hole|holes)?\s*([a-zA-Zà-ỹÀ-Ỹ]+(?:\s+[a-zA-Zà-ỹÀ-Ỹ]+)?)/gi;

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

    // Tái tạo cụm chữ đặc điểm (giữ từ "lỗ" nếu query có chứa)
    const hasHoleWord = /\b(?:lo|lỗ|hole|holes)\b/i.test(m[0]);
    const fullText = hasHoleWord ? `lỗ ${cleaned}` : cleaned;

    results.push({
      number: num,
      text: fullText,
      shape: extractShapeKeyword(fullText),
      raw: m[0].trim()
    });
  }

  // 3. Fallback: Nếu câu ngắn gọn dưới 30 ký tự và bắt đầu bằng số (ví dụ: "6 lỗ tròn", "4 oval")
  if (results.length === 0) {
    const directParsed = parseSingleFeature(msg);
    if (directParsed && directParsed.number != null && directParsed.text.length > 0) {
      results.push(directParsed);
    }
  }

  return results;
}

/**
 * So khớp 1 đặc điểm query với 1 đặc điểm trong DB
 */
export function isSingleFeatureMatch(dbFeature, queryFeature) {
  if (!dbFeature || !queryFeature) return false;

  // 1. Kiểm tra key Số: PHẢI KHỚP HOÀN TOÀN
  if (queryFeature.number != null) {
    if (dbFeature.number !== queryFeature.number) {
      return false; // Số khác nhau (ví dụ 6 !== 16) -> FALSE
    }
  }

  // 2. Kiểm tra key Chữ:
  const dbText = cleanFeatureText(dbFeature.text);
  const qText = cleanFeatureText(queryFeature.text);

  // Khớp chính xác hoàn toàn (case-insensitive)
  if (dbText === qText) return true;

  // Khớp không dấu
  const dbNorm = removeVietnameseAccents(dbText);
  const qNorm = removeVietnameseAccents(qText);
  if (dbNorm === qNorm) return true;

  // Khớp theo hình dạng lõi (ví dụ "lỗ tròn" vs "tròn", "lỗ oval" vs "oval")
  const dbShape = dbFeature.shape || extractShapeKeyword(dbText);
  const qShape = queryFeature.shape || extractShapeKeyword(qText);

  if (dbShape && qShape) {
    if (dbShape === qShape) return true;
    if (dbShape.includes(qShape) || qShape.includes(dbShape)) return true;
  }

  return false;
}

/**
 * Kiểm tra xem 1 record catalogue có khớp TẤT CẢ các đặc điểm query hay không
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
