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
 * Phân tích chuỗi đặc điểm nhận dạng thành Abstract Syntax Tree (AST):
 * {
 *   totalHoles: number | null,
 *   bigHoles: number | null,
 *   smallHoles: number | null,
 *   holeShapes: string[],
 *   otherNumberedPairs: Array<{ count: number, noun: string }>,
 *   keywords: string[]
 * }
 */
export function parseIdentifyingFeaturesAST(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return {
      totalHoles: null,
      bigHoles: null,
      smallHoles: null,
      holeShapes: [],
      shapeCounts: {},
      otherNumberedPairs: [],
      keywords: []
    };
  }

  const cleaned = cleanFeatureText(raw);
  const norm = removeVietnameseAccents(cleaned);

  let bigHoles = null;
  const bigRegex = /(?<!\d)(\d+)\s*(?:lo\s*(?:tron|vuong|oval|bau duc|chu nhat|tam giac)?\s*)?(?:to|lon)\b/gi;
  let bMatch;
  while ((bMatch = bigRegex.exec(norm)) !== null) {
    const n = parseInt(bMatch[1], 10);
    bigHoles = (bigHoles === null ? 0 : bigHoles) + n;
  }

  let smallHoles = null;
  const smallRegex = /(?<!\d)(\d+)\s*(?:lo\s*(?:tron|vuong|oval|bau duc|chu nhat|tam giac)?\s*)?(?:nho|be)\b/gi;
  let sMatch;
  while ((sMatch = smallRegex.exec(norm)) !== null) {
    const n = parseInt(sMatch[1], 10);
    smallHoles = (smallHoles === null ? 0 : smallHoles) + n;
  }

  const segments = raw.split(",").map(s => s.trim()).filter(Boolean);
  const shapeCounts = {};
  const generalShapeCounts = {};
  const holeShapes = [];

  const holeRegex = /(?<!\d)(\d+)\s*(?:lo\b\s*)?(?:(tron|vuong|oval|bau duc|chu nhat|tam giac)\b\s*)?(to|lon|nho|be)?\b/gi;

  let explicitGeneralHoles = 0;
  let match;
  while ((match = holeRegex.exec(norm)) !== null) {
    const full = match[0].trim();
    const num = parseInt(match[1], 10);
    let shape = match[2] ? match[2].toLowerCase() : null;
    if (shape === "bau duc") shape = "oval";
    const size = match[3] ? match[3].toLowerCase() : null;

    const hasLo = /\blo\b/i.test(full);
    if (!hasLo && !shape && !size) continue;

    if (shape) {
      shapeCounts[shape] = (shapeCounts[shape] || 0) + num;
      if (!holeShapes.includes(shape)) holeShapes.push(shape);
    }

    if (!size) {
      explicitGeneralHoles += num;
      if (shape) {
        generalShapeCounts[shape] = (generalShapeCounts[shape] || 0) + num;
      }
    }
  }

  for (const item of KNOWN_SHAPES) {
    if (item.match.test(norm) && !holeShapes.includes(item.shape)) {
      holeShapes.push(item.shape);
    }
  }

  let totalHoles = null;
  const hasBigOrSmall = bigHoles != null || smallHoles != null;
  const subSum = (bigHoles || 0) + (smallHoles || 0);

  if (hasBigOrSmall) {
    if (explicitGeneralHoles === subSum && explicitGeneralHoles > 0) {
      totalHoles = explicitGeneralHoles;
    } else if (explicitGeneralHoles === 0) {
      if (bigHoles != null && smallHoles != null) {
        totalHoles = subSum;
      } else if (Object.keys(shapeCounts).length === 1 && (bigHoles != null || smallHoles != null)) {
        totalHoles = subSum;
      }
    } else {
      const isShapeBreakdown = Object.values(generalShapeCounts).some(cnt => cnt === subSum);
      if (isShapeBreakdown) {
        totalHoles = explicitGeneralHoles;
      } else if (explicitGeneralHoles > 0 && segments.length > 1) {
        totalHoles = explicitGeneralHoles + subSum;
      } else if (explicitGeneralHoles > 0) {
        totalHoles = explicitGeneralHoles;
      }
    }

    if (totalHoles != null && holeShapes.length <= 1 && explicitGeneralHoles > 0) {
      if (bigHoles != null && smallHoles == null && totalHoles >= bigHoles) {
        smallHoles = totalHoles - bigHoles;
      } else if (smallHoles != null && bigHoles == null && totalHoles >= smallHoles) {
        bigHoles = totalHoles - smallHoles;
      }
    }
  } else {
    if (explicitGeneralHoles > 0) {
      totalHoles = explicitGeneralHoles;
    }
  }

  const pairRegex = /(?<!\d)(\d+)\s+([a-zA-Zà-ỹÀ-Ỹ]+)/gi;
  let pMatch;
  const otherNumberedPairs = [];
  while ((pMatch = pairRegex.exec(cleaned)) !== null) {
    const num = parseInt(pMatch[1], 10);
    const noun = pMatch[2].trim().toLowerCase();
    const nounNorm = removeVietnameseAccents(noun);
    const isHoleWord = ["lo", "lỗ", "to", "lon", "nho", "be", "tron", "vuong", "oval"].includes(nounNorm);
    const isStopWord = ["ngay", "thang", "nam", "gio", "phut", "lan", "con", "ma", "chiec", "dong", "trang"].includes(nounNorm);
    if (!isHoleWord && !isStopWord) {
      otherNumberedPairs.push({ count: num, noun: nounNorm });
    }
  }

  const STRUCTURAL_KEYWORDS = [
    "uon cong", "dap noi", "vat goc", "tai bat oc", "go dap", "gan noi", "dap gan", "chot dinh vi", "ngam"
  ];
  const keywords = [];
  for (const kw of STRUCTURAL_KEYWORDS) {
    if (norm.includes(kw)) {
      keywords.push(kw);
    }
  }

  return {
    totalHoles,
    bigHoles,
    smallHoles,
    holeShapes,
    shapeCounts,
    otherNumberedPairs,
    keywords
  };
}

/**
 * So khớp linh hoạt và giao hoán (Commutative & Order-Independent)
 * Hỗ trợ đảo vị trí ("5 lỗ tròn 2 lỗ nhỏ + 3 lỗ to" == "5 lỗ tròn 3 lỗ to + 2 lỗ nhỏ"),
 * suy luận tổng số lỗ ngầm định, và ngưỡng sai số cảm tính (+/- 1 lỗ to/nhỏ).
 */
export function matchFeatureQueryFlexible(dbText, queryText, options = { allowPerceptualTolerance: false }) {
  if (!dbText || !queryText) {
    return { matched: false, tier: "none", score: 0 };
  }

  // Nếu query có dấu phẩy ",", MỌI phân đoạn đều phải thỏa mãn (AND logic)
  if (queryText.includes(",")) {
    const parts = queryText.split(",").map(p => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      let minScore = 1.0;
      let worstTier = "exact_match";
      for (const part of parts) {
        const sub = matchFeatureQueryFlexible(dbText, part, options);
        if (!sub.matched) {
          return { matched: false, tier: "none", score: 0 };
        }
        if (sub.score < minScore) minScore = sub.score;
        if (sub.tier === "perceptual_tolerance") worstTier = "perceptual_tolerance";
        else if (sub.tier === "partial_match" && worstTier !== "perceptual_tolerance") worstTier = "partial_match";
      }
      return { matched: true, tier: worstTier, score: minScore };
    }
  }

  const dbAST = parseIdentifyingFeaturesAST(dbText);
  const qAST = parseIdentifyingFeaturesAST(queryText);

  const qHasHoleNumber = qAST.totalHoles != null || qAST.bigHoles != null || qAST.smallHoles != null;
  const qHasOtherNumber = qAST.otherNumberedPairs.length > 0;
  const qHasKeywords = qAST.keywords.length > 0;
  const qHasShapes = qAST.holeShapes.length > 0;

  if (!qHasHoleNumber && !qHasOtherNumber && !qHasKeywords && !qHasShapes) {
    return { matched: false, tier: "none", score: 0 };
  }

  // 1. Kiểm tra hình dáng: nếu query có hình dạng, DB không được sai khác
  if (qHasShapes) {
    if (dbAST.holeShapes.length > 0) {
      const allShapesMatch = qAST.holeShapes.every(qs => dbAST.holeShapes.includes(qs));
      if (!allShapesMatch) {
        return { matched: false, tier: "none", score: 0 };
      }
    } else {
      const normDb = removeVietnameseAccents(cleanFeatureText(dbText));
      for (const qs of qAST.holeShapes) {
        const shapeItem = KNOWN_SHAPES.find(s => s.shape === qs);
        if (shapeItem && !shapeItem.match.test(normDb)) {
          return { matched: false, tier: "none", score: 0 };
        }
      }
    }

    // Nếu query có số lượng cho từng hình dáng (ví dụ "6 lỗ tròn", "4 lỗ oval", "22 lỗ tròn"):
    for (const [shape, count] of Object.entries(qAST.shapeCounts || {})) {
      if (dbAST.shapeCounts && dbAST.shapeCounts[shape] != null) {
        if (dbAST.shapeCounts[shape] !== count) {
          return { matched: false, tier: "none", score: 0 };
        }
      }
    }
  }

  // 2. Kiểm tra các cặp số khác (ví dụ: "2 ngàm")
  for (const qPair of qAST.otherNumberedPairs) {
    const matchedPair = dbAST.otherNumberedPairs.find(
      dbPair => dbPair.count === qPair.count && (dbPair.noun.includes(qPair.noun) || qPair.noun.includes(dbPair.noun))
    );
    if (!matchedPair) {
      return { matched: false, tier: "none", score: 0 };
    }
  }

  // 3. Kiểm tra keywords
  const normDb = removeVietnameseAccents(cleanFeatureText(dbText));
  for (const kw of qAST.keywords) {
    if (!normDb.includes(kw)) {
      return { matched: false, tier: "none", score: 0 };
    }
  }

  // 4. Nếu query có chỉ định số lượng lỗ (total, big, small)
  if (qHasHoleNumber) {
    let usedTolerance = false;

    // a. Big holes strict check
    if (qAST.bigHoles != null) {
      if (dbAST.bigHoles == null) {
        return { matched: false, tier: "none", score: 0 };
      }
      if (qAST.bigHoles !== dbAST.bigHoles) {
        if (options?.allowPerceptualTolerance && Math.abs(qAST.bigHoles - dbAST.bigHoles) === 1) {
          usedTolerance = true;
        } else {
          return { matched: false, tier: "none", score: 0 };
        }
      }
    }

    // b. Small holes strict check
    if (qAST.smallHoles != null) {
      if (dbAST.smallHoles == null) {
        return { matched: false, tier: "none", score: 0 };
      }
      if (qAST.smallHoles !== dbAST.smallHoles) {
        if (options?.allowPerceptualTolerance && Math.abs(qAST.smallHoles - dbAST.smallHoles) === 1) {
          usedTolerance = true;
        } else {
          return { matched: false, tier: "none", score: 0 };
        }
      }
    }

    // c. Total holes check
    if (qAST.totalHoles != null) {
      const queryHasShapeCounts = Object.keys(qAST.shapeCounts || {}).length > 0;
      if (!queryHasShapeCounts || qAST.bigHoles != null || qAST.smallHoles != null) {
        if (dbAST.totalHoles == null || dbAST.totalHoles !== qAST.totalHoles) {
          return { matched: false, tier: "none", score: 0 };
        }
      } else {
        if (dbAST.holeShapes.length <= 1) {
          if (dbAST.totalHoles == null || dbAST.totalHoles !== qAST.totalHoles) {
            return { matched: false, tier: "none", score: 0 };
          }
        }
      }
    }

    if (usedTolerance) {
      return { matched: true, tier: "perceptual_tolerance", score: 0.85 };
    }

    return { matched: true, tier: "exact_match", score: 1.0 };
  }

  // 5. Nếu không có số lượng lỗ, chỉ lọc theo shapes hoặc keywords
  if (qHasShapes || qHasKeywords || qHasOtherNumber) {
    return { matched: true, tier: "partial_match", score: 0.80 };
  }

  return { matched: false, tier: "none", score: 0 };
}

/**
 * Kiểm tra xem 1 record catalogue có khớp TẤT CẢ các đặc điểm query hay không (AND logic)
 * Hỗ trợ cả cơ chế Flexible AST Matching lẫn phân đoạn độc lập dấu phẩy.
 * @returns {boolean} true nếu khớp toàn bộ các đặc điểm yêu cầu
 */
export function matchRowWithFeatures(row, queryFeatures, rawQuery = "") {
  if (!row) return false;

  const qAST = rawQuery ? parseIdentifyingFeaturesAST(rawQuery) : null;
  const isHoleQuery = qAST && (qAST.totalHoles != null || qAST.bigHoles != null || qAST.smallHoles != null);

  // 1. Kiểm tra bằng Flexible AST Match nếu có rawQuery
  if (rawQuery) {
    const flex = matchFeatureQueryFlexible(row.identifying_features, rawQuery);
    if (flex.matched) return true;
    // Khi qAST là truy vấn số lượng lỗ, matchFeatureQueryFlexible là cơ quan thẩm quyền duy nhất,
    // TUYỆT ĐỐI không fallback xuống parseIdentifyingFeatures lỏng lẻo
    if (isHoleQuery) return false;
  }

  if (Array.isArray(queryFeatures) && queryFeatures.length > 0) {
    const queryStr = queryFeatures.map(q => q.raw || `${q.number || ''} ${q.text || ''}`).join(", ");
    const flex = matchFeatureQueryFlexible(row.identifying_features, queryStr);
    if (flex.matched) return true;
    const qfAST = parseIdentifyingFeaturesAST(queryStr);
    if (qfAST.totalHoles != null || qfAST.bigHoles != null || qfAST.smallHoles != null) return false;
  }

  // 2. Cơ chế phân đoạn dấu phẩy gốc (bảo toàn 100% tương thích cho các query phi số lượng lỗ)
  if (!queryFeatures || queryFeatures.length === 0) return false;
  const dbFeatures = parseIdentifyingFeatures(row.identifying_features);
  if (dbFeatures.length === 0) return false;

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
  const qAST = parseIdentifyingFeaturesAST(queryMessage);
  const hasAST = qAST.totalHoles != null || qAST.bigHoles != null || qAST.smallHoles != null || qAST.holeShapes.length > 0;

  if (queryFeatures.length === 0 && !hasAST) {
    return {
      isFeatureQuery: false,
      queryFeatures: [],
      matchedRows: []
    };
  }

  const rows = Array.isArray(catalogueRows) ? catalogueRows : [];
  const matchedRows = rows.filter(row => matchRowWithFeatures(row, queryFeatures, queryMessage));

  return {
    isFeatureQuery: true,
    queryFeatures,
    matchedRows
  };
}
