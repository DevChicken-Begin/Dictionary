diff --git a/functions/_lib/moris/v5/presentation/publicResult.js b/functions/_lib/moris/v5/presentation/publicResult.js
index c647621..35ed5c3 100644
--- a/functions/_lib/moris/v5/presentation/publicResult.js
+++ b/functions/_lib/moris/v5/presentation/publicResult.js
@@ -2,7 +2,20 @@ import { buildMorisUserMessage } from "./userMessage.js";
 
 export function toPublicMorisResult(result,{debug=false}={}){
   const rawList = Array.isArray(result?.candidates) ? [...result.candidates] : [];
-  const sortedCandidates = rawList
+  const isFeatureMode = result?.mode === 'feature_filter' || result?.match_source === 'identifying_features';
+
+  const processedList = rawList.map(c => {
+    if (isFeatureMode || c?.match_source === 'identifying_features' || c?.score_source === 'identifying_features_match' || c?.is_feature_match) {
+      return {
+        ...c,
+        is_feature_match: true,
+        badge_label: 'Khớp'
+      };
+    }
+    return c;
+  });
+
+  const sortedCandidates = processedList
     .sort((a, b) => {
       const scoreA = Number(a?.match_score ?? a?.final_score ?? a?.geometric_score ?? a?.vector_similarity ?? 0);
       const scoreB = Number(b?.match_score ?? b?.final_score ?? b?.geometric_score ?? b?.vector_similarity ?? 0);
diff --git a/functions/_lib/moris/v5/retrieval/featureMatcher.js b/functions/_lib/moris/v5/retrieval/featureMatcher.js
index fa2f532..2dae39c 100644
--- a/functions/_lib/moris/v5/retrieval/featureMatcher.js
+++ b/functions/_lib/moris/v5/retrieval/featureMatcher.js
@@ -277,6 +277,7 @@ export function parseIdentifyingFeaturesAST(text) {
       bigHoles: null,
       smallHoles: null,
       holeShapes: [],
+      shapeCounts: {},
       otherNumberedPairs: [],
       keywords: []
     };
@@ -285,68 +286,100 @@ export function parseIdentifyingFeaturesAST(text) {
   const cleaned = cleanFeatureText(raw);
   const norm = removeVietnameseAccents(cleaned);
 
-  let totalHoles = null;
   let bigHoles = null;
+  const bigRegex = /(?<!\d)(\d+)\s*(?:lo\s*(?:tron|vuong|oval|bau duc|chu nhat|tam giac)?\s*)?(?:to|lon)\b/gi;
+  let bMatch;
+  while ((bMatch = bigRegex.exec(norm)) !== null) {
+    const n = parseInt(bMatch[1], 10);
+    bigHoles = (bigHoles === null ? 0 : bigHoles) + n;
+  }
+
   let smallHoles = null;
+  const smallRegex = /(?<!\d)(\d+)\s*(?:lo\s*(?:tron|vuong|oval|bau duc|chu nhat|tam giac)?\s*)?(?:nho|be)\b/gi;
+  let sMatch;
+  while ((sMatch = smallRegex.exec(norm)) !== null) {
+    const n = parseInt(sMatch[1], 10);
+    smallHoles = (smallHoles === null ? 0 : smallHoles) + n;
+  }
+
+  const segments = raw.split(",").map(s => s.trim()).filter(Boolean);
+  const shapeCounts = {};
+  const generalShapeCounts = {};
   const holeShapes = [];
-  const otherNumberedPairs = [];
-  const keywords = [];
 
-  // 1. Trích xuất Big Holes (ví dụ: "4 lỗ to", "4 to", "4 lỗ tròn to", "4 lo to")
-  const bigMatch = norm.match(/(?:^|[^\d])(\d+)\s*(?:(?:lo\s*(?:tron\s*)?|lo\s+)?(?:to|lon)\b|(?:to|lon)\b)/i);
-  if (bigMatch) {
-    bigHoles = parseInt(bigMatch[1], 10);
-  }
+  const holeRegex = /(?<!\d)(\d+)\s*(?:lo\b\s*)?(?:(tron|vuong|oval|bau duc|chu nhat|tam giac)\b\s*)?(to|lon|nho|be)?\b/gi;
 
-  // 2. Trích xuất Small Holes (ví dụ: "1 lỗ nhỏ", "1 nhỏ", "1 lỗ tròn nhỏ", "1 lo nho")
-  const smallMatch = norm.match(/(?:^|[^\d])(\d+)\s*(?:(?:lo\s*(?:tron\s*)?|lo\s+)?(?:nho|be)\b|(?:nho|be)\b)/i);
-  if (smallMatch) {
-    smallHoles = parseInt(smallMatch[1], 10);
-  }
+  let explicitGeneralHoles = 0;
+  let match;
+  while ((match = holeRegex.exec(norm)) !== null) {
+    const full = match[0].trim();
+    const num = parseInt(match[1], 10);
+    let shape = match[2] ? match[2].toLowerCase() : null;
+    if (shape === "bau duc") shape = "oval";
+    const size = match[3] ? match[3].toLowerCase() : null;
 
-  // 3. Trích xuất Total Holes trên norm (ví dụ: "5 lo tron", "5 lo", "8 lo", nhưng không phải "4 lo to" hay "1 lo nho")
-  const totalRegex = /(?:^|[^\d])(\d+)\s*(?:lo|hole|holes)\b(?!\s*(?:to|lon|nho|be))/gi;
-  let tMatch;
-  while ((tMatch = totalRegex.exec(norm)) !== null) {
-    const n = parseInt(tMatch[1], 10);
-    if (totalHoles == null) {
-      totalHoles = n;
+    const hasLo = /\blo\b/i.test(full);
+    if (!hasLo && !shape && !size) continue;
+
+    if (shape) {
+      shapeCounts[shape] = (shapeCounts[shape] || 0) + num;
+      if (!holeShapes.includes(shape)) holeShapes.push(shape);
     }
-  }
 
-  if (totalHoles == null) {
-    const directShapeMatch = norm.match(/(?:^|[^\d])(\d+)\s*(?:tron|vuong|oval|bau duc|chu nhat|tam giac)\b/i);
-    if (directShapeMatch) {
-      totalHoles = parseInt(directShapeMatch[1], 10);
+    if (!size) {
+      explicitGeneralHoles += num;
+      if (shape) {
+        generalShapeCounts[shape] = (generalShapeCounts[shape] || 0) + num;
+      }
     }
   }
 
-  // 4. Auto-inference rule:
-  // - Nếu có bigHoles và smallHoles mà chưa có totalHoles: totalHoles = bigHoles + smallHoles
-  if (totalHoles == null && bigHoles != null && smallHoles != null) {
-    totalHoles = bigHoles + smallHoles;
-  } else if (totalHoles == null && bigHoles != null && smallHoles == null) {
-    totalHoles = bigHoles;
-  } else if (totalHoles == null && smallHoles != null && bigHoles == null) {
-    totalHoles = smallHoles;
-  } else if (totalHoles != null && bigHoles != null && smallHoles == null && totalHoles >= bigHoles) {
-    smallHoles = totalHoles - bigHoles;
-  } else if (totalHoles != null && smallHoles != null && bigHoles == null && totalHoles >= smallHoles) {
-    bigHoles = totalHoles - smallHoles;
+  for (const item of KNOWN_SHAPES) {
+    if (item.match.test(norm) && !holeShapes.includes(item.shape)) {
+      holeShapes.push(item.shape);
+    }
   }
 
-  // 5. Trích xuất các hình dạng lỗ xuất hiện trong chuỗi
-  for (const item of KNOWN_SHAPES) {
-    if (item.match.test(norm)) {
-      if (!holeShapes.includes(item.shape)) {
-        holeShapes.push(item.shape);
+  let totalHoles = null;
+  const hasBigOrSmall = bigHoles != null || smallHoles != null;
+  const subSum = (bigHoles || 0) + (smallHoles || 0);
+
+  if (hasBigOrSmall) {
+    if (explicitGeneralHoles === subSum && explicitGeneralHoles > 0) {
+      totalHoles = explicitGeneralHoles;
+    } else if (explicitGeneralHoles === 0) {
+      if (bigHoles != null && smallHoles != null) {
+        totalHoles = subSum;
+      } else if (Object.keys(shapeCounts).length === 1 && (bigHoles != null || smallHoles != null)) {
+        totalHoles = subSum;
+      }
+    } else {
+      const isShapeBreakdown = Object.values(generalShapeCounts).some(cnt => cnt === subSum);
+      if (isShapeBreakdown) {
+        totalHoles = explicitGeneralHoles;
+      } else if (explicitGeneralHoles > 0 && segments.length > 1) {
+        totalHoles = explicitGeneralHoles + subSum;
+      } else if (explicitGeneralHoles > 0) {
+        totalHoles = explicitGeneralHoles;
       }
     }
+
+    if (totalHoles != null && holeShapes.length <= 1 && explicitGeneralHoles > 0) {
+      if (bigHoles != null && smallHoles == null && totalHoles >= bigHoles) {
+        smallHoles = totalHoles - bigHoles;
+      } else if (smallHoles != null && bigHoles == null && totalHoles >= smallHoles) {
+        bigHoles = totalHoles - smallHoles;
+      }
+    }
+  } else {
+    if (explicitGeneralHoles > 0) {
+      totalHoles = explicitGeneralHoles;
+    }
   }
 
-  // 6. Trích xuất các cặp số khác (otherNumberedPairs) với ranh giới số nghiêm ngặt
-  const pairRegex = /(?:^|[^\d])(\d+)\s+([a-zA-Zà-ỹÀ-Ỹ]+)/gi;
+  const pairRegex = /(?<!\d)(\d+)\s+([a-zA-Zà-ỹÀ-Ỹ]+)/gi;
   let pMatch;
+  const otherNumberedPairs = [];
   while ((pMatch = pairRegex.exec(cleaned)) !== null) {
     const num = parseInt(pMatch[1], 10);
     const noun = pMatch[2].trim().toLowerCase();
@@ -358,10 +391,10 @@ export function parseIdentifyingFeaturesAST(text) {
     }
   }
 
-  // 7. Trích xuất keywords cấu trúc
   const STRUCTURAL_KEYWORDS = [
     "uon cong", "dap noi", "vat goc", "tai bat oc", "go dap", "gan noi", "dap gan", "chot dinh vi", "ngam"
   ];
+  const keywords = [];
   for (const kw of STRUCTURAL_KEYWORDS) {
     if (norm.includes(kw)) {
       keywords.push(kw);
@@ -373,6 +406,7 @@ export function parseIdentifyingFeaturesAST(text) {
     bigHoles,
     smallHoles,
     holeShapes,
+    shapeCounts,
     otherNumberedPairs,
     keywords
   };
@@ -383,7 +417,7 @@ export function parseIdentifyingFeaturesAST(text) {
  * Hỗ trợ đảo vị trí ("5 lỗ tròn 2 lỗ nhỏ + 3 lỗ to" == "5 lỗ tròn 3 lỗ to + 2 lỗ nhỏ"),
  * suy luận tổng số lỗ ngầm định, và ngưỡng sai số cảm tính (+/- 1 lỗ to/nhỏ).
  */
-export function matchFeatureQueryFlexible(dbText, queryText) {
+export function matchFeatureQueryFlexible(dbText, queryText, options = { allowPerceptualTolerance: false }) {
   if (!dbText || !queryText) {
     return { matched: false, tier: "none", score: 0 };
   }
@@ -395,7 +429,7 @@ export function matchFeatureQueryFlexible(dbText, queryText) {
       let minScore = 1.0;
       let worstTier = "exact_match";
       for (const part of parts) {
-        const sub = matchFeatureQueryFlexible(dbText, part);
+        const sub = matchFeatureQueryFlexible(dbText, part, options);
         if (!sub.matched) {
           return { matched: false, tier: "none", score: 0 };
         }
@@ -435,6 +469,15 @@ export function matchFeatureQueryFlexible(dbText, queryText) {
         }
       }
     }
+
+    // Nếu query có số lượng cho từng hình dáng (ví dụ "6 lỗ tròn", "4 lỗ oval", "22 lỗ tròn"):
+    for (const [shape, count] of Object.entries(qAST.shapeCounts || {})) {
+      if (dbAST.shapeCounts && dbAST.shapeCounts[shape] != null) {
+        if (dbAST.shapeCounts[shape] !== count) {
+          return { matched: false, tier: "none", score: 0 };
+        }
+      }
+    }
   }
 
   // 2. Kiểm tra các cặp số khác (ví dụ: "2 ngàm")
@@ -457,78 +500,57 @@ export function matchFeatureQueryFlexible(dbText, queryText) {
 
   // 4. Nếu query có chỉ định số lượng lỗ (total, big, small)
   if (qHasHoleNumber) {
-    if (qAST.totalHoles != null) {
-      if (dbAST.totalHoles == null || dbAST.totalHoles !== qAST.totalHoles) {
+    let usedTolerance = false;
+
+    // a. Big holes strict check
+    if (qAST.bigHoles != null) {
+      if (dbAST.bigHoles == null) {
         return { matched: false, tier: "none", score: 0 };
       }
-
-      if (qAST.bigHoles != null && qAST.smallHoles != null) {
-        if (dbAST.bigHoles != null && dbAST.smallHoles != null) {
-          if (qAST.bigHoles === dbAST.bigHoles && qAST.smallHoles === dbAST.smallHoles) {
-            return { matched: true, tier: "exact_match", score: 1.0 };
-          }
-          if (Math.abs(qAST.bigHoles - dbAST.bigHoles) === 1 && Math.abs(qAST.smallHoles - dbAST.smallHoles) === 1) {
-            return { matched: true, tier: "perceptual_tolerance", score: 0.85 };
-          }
+      if (qAST.bigHoles !== dbAST.bigHoles) {
+        if (options?.allowPerceptualTolerance && Math.abs(qAST.bigHoles - dbAST.bigHoles) === 1) {
+          usedTolerance = true;
+        } else {
           return { matched: false, tier: "none", score: 0 };
         }
-        return { matched: true, tier: "partial_match", score: 0.90 };
       }
+    }
 
-      if (qAST.bigHoles != null) {
-        if (dbAST.bigHoles != null) {
-          if (qAST.bigHoles === dbAST.bigHoles) {
-            return { matched: true, tier: "exact_match", score: 1.0 };
-          }
-          if (Math.abs(qAST.bigHoles - dbAST.bigHoles) === 1) {
-            return { matched: true, tier: "perceptual_tolerance", score: 0.85 };
-          }
-          return { matched: false, tier: "none", score: 0 };
-        }
-        return { matched: true, tier: "partial_match", score: 0.90 };
+    // b. Small holes strict check
+    if (qAST.smallHoles != null) {
+      if (dbAST.smallHoles == null) {
+        return { matched: false, tier: "none", score: 0 };
       }
-
-      if (qAST.smallHoles != null) {
-        if (dbAST.smallHoles != null) {
-          if (qAST.smallHoles === dbAST.smallHoles) {
-            return { matched: true, tier: "exact_match", score: 1.0 };
-          }
-          if (Math.abs(qAST.smallHoles - dbAST.smallHoles) === 1) {
-            return { matched: true, tier: "perceptual_tolerance", score: 0.85 };
-          }
+      if (qAST.smallHoles !== dbAST.smallHoles) {
+        if (options?.allowPerceptualTolerance && Math.abs(qAST.smallHoles - dbAST.smallHoles) === 1) {
+          usedTolerance = true;
+        } else {
           return { matched: false, tier: "none", score: 0 };
         }
-        return { matched: true, tier: "partial_match", score: 0.90 };
       }
-
-      return { matched: true, tier: "exact_match", score: 1.0 };
     }
 
-    if (qAST.bigHoles != null) {
-      if (dbAST.bigHoles != null) {
-        if (qAST.bigHoles === dbAST.bigHoles) {
-          return { matched: true, tier: "exact_match", score: 1.0 };
+    // c. Total holes check
+    if (qAST.totalHoles != null) {
+      const queryHasShapeCounts = Object.keys(qAST.shapeCounts || {}).length > 0;
+      if (!queryHasShapeCounts || qAST.bigHoles != null || qAST.smallHoles != null) {
+        if (dbAST.totalHoles == null || dbAST.totalHoles !== qAST.totalHoles) {
+          return { matched: false, tier: "none", score: 0 };
         }
-        if (Math.abs(qAST.bigHoles - dbAST.bigHoles) === 1) {
-          return { matched: true, tier: "perceptual_tolerance", score: 0.85 };
+      } else {
+        if (dbAST.holeShapes.length <= 1) {
+          if (dbAST.totalHoles == null || dbAST.totalHoles !== qAST.totalHoles) {
+            return { matched: false, tier: "none", score: 0 };
+          }
         }
       }
-      return { matched: false, tier: "none", score: 0 };
     }
 
-    if (qAST.smallHoles != null) {
-      if (dbAST.smallHoles != null) {
-        if (qAST.smallHoles === dbAST.smallHoles) {
-          return { matched: true, tier: "exact_match", score: 1.0 };
-        }
-        if (Math.abs(qAST.smallHoles - dbAST.smallHoles) === 1) {
-          return { matched: true, tier: "perceptual_tolerance", score: 0.85 };
-        }
-      }
-      return { matched: false, tier: "none", score: 0 };
+    if (usedTolerance) {
+      return { matched: true, tier: "perceptual_tolerance", score: 0.85 };
     }
 
-    return { matched: false, tier: "none", score: 0 };
+    return { matched: true, tier: "exact_match", score: 1.0 };
   }
 
   // 5. Nếu không có số lượng lỗ, chỉ lọc theo shapes hoặc keywords
@@ -547,19 +569,27 @@ export function matchFeatureQueryFlexible(dbText, queryText) {
 export function matchRowWithFeatures(row, queryFeatures, rawQuery = "") {
   if (!row) return false;
 
+  const qAST = rawQuery ? parseIdentifyingFeaturesAST(rawQuery) : null;
+  const isHoleQuery = qAST && (qAST.totalHoles != null || qAST.bigHoles != null || qAST.smallHoles != null);
+
   // 1. Kiểm tra bằng Flexible AST Match nếu có rawQuery
   if (rawQuery) {
     const flex = matchFeatureQueryFlexible(row.identifying_features, rawQuery);
     if (flex.matched) return true;
+    // Khi qAST là truy vấn số lượng lỗ, matchFeatureQueryFlexible là cơ quan thẩm quyền duy nhất,
+    // TUYỆT ĐỐI không fallback xuống parseIdentifyingFeatures lỏng lẻo
+    if (isHoleQuery) return false;
   }
 
   if (Array.isArray(queryFeatures) && queryFeatures.length > 0) {
     const queryStr = queryFeatures.map(q => q.raw || `${q.number || ''} ${q.text || ''}`).join(", ");
     const flex = matchFeatureQueryFlexible(row.identifying_features, queryStr);
     if (flex.matched) return true;
+    const qfAST = parseIdentifyingFeaturesAST(queryStr);
+    if (qfAST.totalHoles != null || qfAST.bigHoles != null || qfAST.smallHoles != null) return false;
   }
 
-  // 2. Cơ chế phân đoạn dấu phẩy gốc (bảo toàn 100% tương thích)
+  // 2. Cơ chế phân đoạn dấu phẩy gốc (bảo toàn 100% tương thích cho các query phi số lượng lỗ)
   if (!queryFeatures || queryFeatures.length === 0) return false;
   const dbFeatures = parseIdentifyingFeatures(row.identifying_features);
   if (dbFeatures.length === 0) return false;
diff --git a/functions/api/moris/chat.js b/functions/api/moris/chat.js
index ccf39ec..6aaf7fd 100644
--- a/functions/api/moris/chat.js
+++ b/functions/api/moris/chat.js
@@ -122,6 +122,8 @@ function toCandidate(row, rank, isFeatureMatch = false) {
     probe_consensus: 0,
     structural_score: null,
     score_source: isFeatureMatch ? "identifying_features_match" : "metadata_rank",
+    is_feature_match: isFeatureMatch,
+    badge_label: isFeatureMatch ? "Khớp" : null,
     reason: features.slice(0, 160) || null,
     matched: [],
     conflicts: [],
diff --git a/index.html b/index.html
index 6b22994..09a32b1 100644
--- a/index.html
+++ b/index.html
@@ -1489,8 +1489,9 @@
               <div v-if="c.match_reason" class="mt-1 text-[10px] text-emerald-700 font-bold line-clamp-2">{{ c.match_reason }}</div>
             </div>
             <div class="text-right">
-              <div v-if="morisCandidatePercent(c)!==null" class="text-xs font-black text-emerald-700">{{ morisCandidatePercent(c) }}%</div>
-                <div v-else class="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-1">Khớp đặc điểm</div>
+              <div v-if="c.is_feature_match || c.badge_label==='Khớp'" class="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5">Khớp</div>
+              <div v-else-if="morisCandidatePercent(c)!==null" class="text-xs font-black text-emerald-700">{{ morisCandidatePercent(c) }}%</div>
+              <div v-else class="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5">Khớp</div>
               <i data-lucide="chevron-right" class="w-4 h-4 text-slate-300 ml-auto mt-1"></i>
             </div>
           </button>
diff --git a/src/app.js b/src/app.js
index 7545ce1..6f7b010 100644
--- a/src/app.js
+++ b/src/app.js
@@ -1207,6 +1207,7 @@ createApp({
           bigHoles: null,
           smallHoles: null,
           holeShapes: [],
+          shapeCounts: {},
           otherNumberedPairs: [],
           keywords: []
         };
@@ -1215,41 +1216,52 @@ createApp({
       const cleaned = this.cleanFeatureText(raw);
       const norm = this.removeVietnameseAccents(cleaned);
 
-      let totalHoles = null;
       let bigHoles = null;
+      const bigRegex = /(?<!\d)(\d+)\s*(?:lo\s*(?:tron|vuong|oval|bau duc|chu nhat|tam giac)?\s*)?(?:to|lon)\b/gi;
+      let bMatch;
+      while ((bMatch = bigRegex.exec(norm)) !== null) {
+        const n = parseInt(bMatch[1], 10);
+        bigHoles = (bigHoles === null ? 0 : bigHoles) + n;
+      }
+
       let smallHoles = null;
+      const smallRegex = /(?<!\d)(\d+)\s*(?:lo\s*(?:tron|vuong|oval|bau duc|chu nhat|tam giac)?\s*)?(?:nho|be)\b/gi;
+      let sMatch;
+      while ((sMatch = smallRegex.exec(norm)) !== null) {
+        const n = parseInt(sMatch[1], 10);
+        smallHoles = (smallHoles === null ? 0 : smallHoles) + n;
+      }
+
+      const segments = raw.split(',').map(s => s.trim()).filter(Boolean);
+      const shapeCounts = {};
+      const generalShapeCounts = {};
       const holeShapes = [];
-      const otherNumberedPairs = [];
-      const keywords = [];
 
-      const bigMatch = norm.match(/(?:^|[^\d])(\d+)\s*(?:(?:lo\s*(?:tron\s*)?|lo\s+)?(?:to|lon)\b|(?:to|lon)\b)/i);
-      if (bigMatch) bigHoles = parseInt(bigMatch[1], 10);
+      const holeRegex = /(?<!\d)(\d+)\s*(?:lo\b\s*)?(?:(tron|vuong|oval|bau duc|chu nhat|tam giac)\b\s*)?(to|lon|nho|be)?\b/gi;
 
-      const smallMatch = norm.match(/(?:^|[^\d])(\d+)\s*(?:(?:lo\s*(?:tron\s*)?|lo\s+)?(?:nho|be)\b|(?:nho|be)\b)/i);
-      if (smallMatch) smallHoles = parseInt(smallMatch[1], 10);
+      let explicitGeneralHoles = 0;
+      let match;
+      while ((match = holeRegex.exec(norm)) !== null) {
+        const full = match[0].trim();
+        const num = parseInt(match[1], 10);
+        let shape = match[2] ? match[2].toLowerCase() : null;
+        if (shape === 'bau duc') shape = 'oval';
+        const size = match[3] ? match[3].toLowerCase() : null;
 
-      const totalRegex = /(?:^|[^\d])(\d+)\s*(?:lo|hole|holes)\b(?!\s*(?:to|lon|nho|be))/gi;
-      let tMatch;
-      while ((tMatch = totalRegex.exec(norm)) !== null) {
-        const n = parseInt(tMatch[1], 10);
-        if (totalHoles == null) totalHoles = n;
-      }
+        const hasLo = /\blo\b/i.test(full);
+        if (!hasLo && !shape && !size) continue;
 
-      if (totalHoles == null) {
-        const directShapeMatch = norm.match(/(?:^|[^\d])(\d+)\s*(?:tron|vuong|oval|bau duc|chu nhat|tam giac)\b/i);
-        if (directShapeMatch) totalHoles = parseInt(directShapeMatch[1], 10);
-      }
+        if (shape) {
+          shapeCounts[shape] = (shapeCounts[shape] || 0) + num;
+          if (!holeShapes.includes(shape)) holeShapes.push(shape);
+        }
 
-      if (totalHoles == null && bigHoles != null && smallHoles != null) {
-        totalHoles = bigHoles + smallHoles;
-      } else if (totalHoles == null && bigHoles != null && smallHoles == null) {
-        totalHoles = bigHoles;
-      } else if (totalHoles == null && smallHoles != null && bigHoles == null) {
-        totalHoles = smallHoles;
-      } else if (totalHoles != null && bigHoles != null && smallHoles == null && totalHoles >= bigHoles) {
-        smallHoles = totalHoles - bigHoles;
-      } else if (totalHoles != null && smallHoles != null && bigHoles == null && totalHoles >= smallHoles) {
-        bigHoles = totalHoles - smallHoles;
+        if (!size) {
+          explicitGeneralHoles += num;
+          if (shape) {
+            generalShapeCounts[shape] = (generalShapeCounts[shape] || 0) + num;
+          }
+        }
       }
 
       const knownShapes = [
@@ -1266,8 +1278,46 @@ createApp({
         }
       }
 
-      const pairRegex = /(?:^|[^\d])(\d+)\s+([a-zA-Zà-ỹÀ-Ỹ]+)/gi;
+      let totalHoles = null;
+      const hasBigOrSmall = bigHoles != null || smallHoles != null;
+      const subSum = (bigHoles || 0) + (smallHoles || 0);
+
+      if (hasBigOrSmall) {
+        if (explicitGeneralHoles === subSum && explicitGeneralHoles > 0) {
+          totalHoles = explicitGeneralHoles;
+        } else if (explicitGeneralHoles === 0) {
+          if (bigHoles != null && smallHoles != null) {
+            totalHoles = subSum;
+          } else if (Object.keys(shapeCounts).length === 1 && (bigHoles != null || smallHoles != null)) {
+            totalHoles = subSum;
+          }
+        } else {
+          const isShapeBreakdown = Object.values(generalShapeCounts).some(cnt => cnt === subSum);
+          if (isShapeBreakdown) {
+            totalHoles = explicitGeneralHoles;
+          } else if (explicitGeneralHoles > 0 && segments.length > 1) {
+            totalHoles = explicitGeneralHoles + subSum;
+          } else if (explicitGeneralHoles > 0) {
+            totalHoles = explicitGeneralHoles;
+          }
+        }
+
+        if (totalHoles != null && holeShapes.length <= 1 && explicitGeneralHoles > 0) {
+          if (bigHoles != null && smallHoles == null && totalHoles >= bigHoles) {
+            smallHoles = totalHoles - bigHoles;
+          } else if (smallHoles != null && bigHoles == null && totalHoles >= smallHoles) {
+            bigHoles = totalHoles - smallHoles;
+          }
+        }
+      } else {
+        if (explicitGeneralHoles > 0) {
+          totalHoles = explicitGeneralHoles;
+        }
+      }
+
+      const pairRegex = /(?<!\d)(\d+)\s+([a-zA-Zà-ỹÀ-Ỹ]+)/gi;
       let pMatch;
+      const otherNumberedPairs = [];
       while ((pMatch = pairRegex.exec(cleaned)) !== null) {
         const num = parseInt(pMatch[1], 10);
         const noun = pMatch[2].trim().toLowerCase();
@@ -1284,10 +1334,10 @@ createApp({
         if (norm.includes(kw)) keywords.push(kw);
       }
 
-      return { totalHoles, bigHoles, smallHoles, holeShapes, otherNumberedPairs, keywords };
+      return { totalHoles, bigHoles, smallHoles, holeShapes, shapeCounts, otherNumberedPairs, keywords };
     },
 
-    matchFeatureQueryFlexible(dbText, queryText) {
+    matchFeatureQueryFlexible(dbText, queryText, options = { allowPerceptualTolerance: false }) {
       if (!dbText || !queryText) return { matched: false, tier: 'none', score: 0 };
 
       if (queryText.includes(',')) {
@@ -1296,7 +1346,7 @@ createApp({
           let minScore = 1.0;
           let worstTier = 'exact_match';
           for (const part of parts) {
-            const sub = this.matchFeatureQueryFlexible(dbText, part);
+            const sub = this.matchFeatureQueryFlexible(dbText, part, options);
             if (!sub.matched) return { matched: false, tier: 'none', score: 0 };
             if (sub.score < minScore) minScore = sub.score;
             if (sub.tier === 'perceptual_tolerance') worstTier = 'perceptual_tolerance';
@@ -1328,6 +1378,15 @@ createApp({
             if (!normDb.includes(qs)) return { matched: false, tier: 'none', score: 0 };
           }
         }
+
+        // Nếu query có số lượng cho từng hình dáng:
+        for (const [shape, count] of Object.entries(qAST.shapeCounts || {})) {
+          if (dbAST.shapeCounts && dbAST.shapeCounts[shape] != null) {
+            if (dbAST.shapeCounts[shape] !== count) {
+              return { matched: false, tier: 'none', score: 0 };
+            }
+          }
+        }
       }
 
       for (const qPair of qAST.otherNumberedPairs) {
@@ -1343,58 +1402,57 @@ createApp({
       }
 
       if (qHasHoleNumber) {
-        if (qAST.totalHoles != null) {
-          if (dbAST.totalHoles == null || dbAST.totalHoles !== qAST.totalHoles) {
+        let usedTolerance = false;
+
+        // a. Big holes strict check
+        if (qAST.bigHoles != null) {
+          if (dbAST.bigHoles == null) {
             return { matched: false, tier: 'none', score: 0 };
           }
-          if (qAST.bigHoles != null && qAST.smallHoles != null) {
-            if (dbAST.bigHoles != null && dbAST.smallHoles != null) {
-              if (qAST.bigHoles === dbAST.bigHoles && qAST.smallHoles === dbAST.smallHoles) {
-                return { matched: true, tier: 'exact_match', score: 1.0 };
-              }
-              if (Math.abs(qAST.bigHoles - dbAST.bigHoles) === 1 && Math.abs(qAST.smallHoles - dbAST.smallHoles) === 1) {
-                return { matched: true, tier: 'perceptual_tolerance', score: 0.85 };
-              }
+          if (qAST.bigHoles !== dbAST.bigHoles) {
+            if (options?.allowPerceptualTolerance && Math.abs(qAST.bigHoles - dbAST.bigHoles) === 1) {
+              usedTolerance = true;
+            } else {
               return { matched: false, tier: 'none', score: 0 };
             }
-            return { matched: true, tier: 'partial_match', score: 0.90 };
           }
-          if (qAST.bigHoles != null) {
-            if (dbAST.bigHoles != null) {
-              if (qAST.bigHoles === dbAST.bigHoles) return { matched: true, tier: 'exact_match', score: 1.0 };
-              if (Math.abs(qAST.bigHoles - dbAST.bigHoles) === 1) return { matched: true, tier: 'perceptual_tolerance', score: 0.85 };
-              return { matched: false, tier: 'none', score: 0 };
-            }
-            return { matched: true, tier: 'partial_match', score: 0.90 };
+        }
+
+        // b. Small holes strict check
+        if (qAST.smallHoles != null) {
+          if (dbAST.smallHoles == null) {
+            return { matched: false, tier: 'none', score: 0 };
           }
-          if (qAST.smallHoles != null) {
-            if (dbAST.smallHoles != null) {
-              if (qAST.smallHoles === dbAST.smallHoles) return { matched: true, tier: 'exact_match', score: 1.0 };
-              if (Math.abs(qAST.smallHoles - dbAST.smallHoles) === 1) return { matched: true, tier: 'perceptual_tolerance', score: 0.85 };
+          if (qAST.smallHoles !== dbAST.smallHoles) {
+            if (options?.allowPerceptualTolerance && Math.abs(qAST.smallHoles - dbAST.smallHoles) === 1) {
+              usedTolerance = true;
+            } else {
               return { matched: false, tier: 'none', score: 0 };
             }
-            return { matched: true, tier: 'partial_match', score: 0.90 };
           }
-          return { matched: true, tier: 'exact_match', score: 1.0 };
         }
 
-        if (qAST.bigHoles != null) {
-          if (dbAST.bigHoles != null) {
-            if (qAST.bigHoles === dbAST.bigHoles) return { matched: true, tier: 'exact_match', score: 1.0 };
-            if (Math.abs(qAST.bigHoles - dbAST.bigHoles) === 1) return { matched: true, tier: 'perceptual_tolerance', score: 0.85 };
+        // c. Total holes check
+        if (qAST.totalHoles != null) {
+          const queryHasShapeCounts = Object.keys(qAST.shapeCounts || {}).length > 0;
+          if (!queryHasShapeCounts || qAST.bigHoles != null || qAST.smallHoles != null) {
+            if (dbAST.totalHoles == null || dbAST.totalHoles !== qAST.totalHoles) {
+              return { matched: false, tier: 'none', score: 0 };
+            }
+          } else {
+            if (dbAST.holeShapes.length <= 1) {
+              if (dbAST.totalHoles == null || dbAST.totalHoles !== qAST.totalHoles) {
+                return { matched: false, tier: 'none', score: 0 };
+              }
+            }
           }
-          return { matched: false, tier: 'none', score: 0 };
         }
 
-        if (qAST.smallHoles != null) {
-          if (dbAST.smallHoles != null) {
-            if (qAST.smallHoles === dbAST.smallHoles) return { matched: true, tier: 'exact_match', score: 1.0 };
-            if (Math.abs(qAST.smallHoles - dbAST.smallHoles) === 1) return { matched: true, tier: 'perceptual_tolerance', score: 0.85 };
-          }
-          return { matched: false, tier: 'none', score: 0 };
+        if (usedTolerance) {
+          return { matched: true, tier: 'perceptual_tolerance', score: 0.85 };
         }
 
-        return { matched: false, tier: 'none', score: 0 };
+        return { matched: true, tier: 'exact_match', score: 1.0 };
       }
 
       if (qHasShapes || qHasKeywords || qHasOtherNumber) {
@@ -1406,14 +1464,20 @@ createApp({
 
     matchRowWithFeatures(row, queryFeatures, rawQuery = '') {
       if (!row) return false;
+      const qAST = rawQuery ? this.parseIdentifyingFeaturesAST(rawQuery) : null;
+      const isHoleQuery = qAST && (qAST.totalHoles != null || qAST.bigHoles != null || qAST.smallHoles != null);
+
       if (rawQuery) {
         const flex = this.matchFeatureQueryFlexible(row.identifying_features, rawQuery);
         if (flex.matched) return true;
+        if (isHoleQuery) return false;
       }
       if (Array.isArray(queryFeatures) && queryFeatures.length > 0) {
         const queryStr = queryFeatures.map(q => q.raw || `${q.number || ''} ${q.text || ''}`).join(', ');
         const flex = this.matchFeatureQueryFlexible(row.identifying_features, queryStr);
         if (flex.matched) return true;
+        const qfAST = this.parseIdentifyingFeaturesAST(queryStr);
+        if (qfAST.totalHoles != null || qfAST.bigHoles != null || qfAST.smallHoles != null) return false;
       }
       if (!queryFeatures || queryFeatures.length === 0) return false;
       const dbFeatures = this.parseIdentifyingFeatures(row.identifying_features);
@@ -1432,12 +1496,12 @@ createApp({
         const qAST = this.parseIdentifyingFeaturesAST(this.filters.search);
         const isFeatureSearch = qFeatures.length > 0 || qAST.totalHoles != null || qAST.bigHoles != null || qAST.smallHoles != null || qAST.holeShapes.length > 0;
 
-        const fetchLimit = isFeatureSearch ? 300 : CONFIG.PAGE_LIMIT + 1;
+        const fetchLimit = isFeatureSearch ? 2000 : CONFIG.PAGE_LIMIT + 1;
         const fetchOffset = isFeatureSearch ? 0 : this.page * CONFIG.PAGE_LIMIT;
 
         const rows = await this.rpcRows('app_search_catalogue', {
           p_session_token:this.session.token,
-          p_search:this.filters.search || '',
+          p_search: isFeatureSearch ? '' : (this.filters.search || ''),
           p_usage_side:this.filters.usage,
           p_view_mode:this.filters.viewMode,
           p_limit:fetchLimit,
@@ -2876,6 +2940,9 @@ createApp({
     },
 
     morisCandidatePercent(candidate) {
+      if (candidate?.is_feature_match || candidate?.badge_label === 'Khớp' || candidate?.score_source === 'identifying_features_match') {
+        return null;
+      }
       const match = Number(candidate?.match_score);
       const vector = Number(candidate?.vector_similarity);
       const final = Number(candidate?.compatibility_score ?? candidate?.final_score);
@@ -3465,10 +3532,23 @@ createApp({
     },
 
     applyMorisSearchResults(data) {
-      const candidatesList = Array.isArray(data?.candidates)
+      const rawCandidates = Array.isArray(data?.candidates)
         ? data.candidates.slice(0, 10)
         : [];
 
+      const isFeatureSearchMode = !this.moris.imageDataUrl || data?.engine === 'moris-feature-filter' || data?.mode === 'feature_filter';
+
+      const candidatesList = rawCandidates.map(c => {
+        if (c?.is_feature_match || c?.badge_label === 'Khớp' || c?.score_source === 'identifying_features_match' || (isFeatureSearchMode && (c?.vector_similarity == null || c?.vector_similarity === 0))) {
+          return {
+            ...c,
+            is_feature_match: true,
+            badge_label: 'Khớp'
+          };
+        }
+        return c;
+      });
+
       // Sắp xếp danh sách Top 10 giảm dần theo tỷ lệ phần trăm hiển thị (từ lớn trở xuống)
       candidatesList.sort((a, b) => {
         const pctA = this.morisCandidatePercent(a) ?? -1;
diff --git a/src/moris/retrieval/featureMatcher.js b/src/moris/retrieval/featureMatcher.js
index fa2f532..2dae39c 100644
--- a/src/moris/retrieval/featureMatcher.js
+++ b/src/moris/retrieval/featureMatcher.js
@@ -277,6 +277,7 @@ export function parseIdentifyingFeaturesAST(text) {
       bigHoles: null,
       smallHoles: null,
       holeShapes: [],
+      shapeCounts: {},
       otherNumberedPairs: [],
       keywords: []
     };
@@ -285,68 +286,100 @@ export function parseIdentifyingFeaturesAST(text) {
   const cleaned = cleanFeatureText(raw);
   const norm = removeVietnameseAccents(cleaned);
 
-  let totalHoles = null;
   let bigHoles = null;
+  const bigRegex = /(?<!\d)(\d+)\s*(?:lo\s*(?:tron|vuong|oval|bau duc|chu nhat|tam giac)?\s*)?(?:to|lon)\b/gi;
+  let bMatch;
+  while ((bMatch = bigRegex.exec(norm)) !== null) {
+    const n = parseInt(bMatch[1], 10);
+    bigHoles = (bigHoles === null ? 0 : bigHoles) + n;
+  }
+
   let smallHoles = null;
+  const smallRegex = /(?<!\d)(\d+)\s*(?:lo\s*(?:tron|vuong|oval|bau duc|chu nhat|tam giac)?\s*)?(?:nho|be)\b/gi;
+  let sMatch;
+  while ((sMatch = smallRegex.exec(norm)) !== null) {
+    const n = parseInt(sMatch[1], 10);
+    smallHoles = (smallHoles === null ? 0 : smallHoles) + n;
+  }
+
+  const segments = raw.split(",").map(s => s.trim()).filter(Boolean);
+  const shapeCounts = {};
+  const generalShapeCounts = {};
   const holeShapes = [];
-  const otherNumberedPairs = [];
-  const keywords = [];
 
-  // 1. Trích xuất Big Holes (ví dụ: "4 lỗ to", "4 to", "4 lỗ tròn to", "4 lo to")
-  const bigMatch = norm.match(/(?:^|[^\d])(\d+)\s*(?:(?:lo\s*(?:tron\s*)?|lo\s+)?(?:to|lon)\b|(?:to|lon)\b)/i);
-  if (bigMatch) {
-    bigHoles = parseInt(bigMatch[1], 10);
-  }
+  const holeRegex = /(?<!\d)(\d+)\s*(?:lo\b\s*)?(?:(tron|vuong|oval|bau duc|chu nhat|tam giac)\b\s*)?(to|lon|nho|be)?\b/gi;
 
-  // 2. Trích xuất Small Holes (ví dụ: "1 lỗ nhỏ", "1 nhỏ", "1 lỗ tròn nhỏ", "1 lo nho")
-  const smallMatch = norm.match(/(?:^|[^\d])(\d+)\s*(?:(?:lo\s*(?:tron\s*)?|lo\s+)?(?:nho|be)\b|(?:nho|be)\b)/i);
-  if (smallMatch) {
-    smallHoles = parseInt(smallMatch[1], 10);
-  }
+  let explicitGeneralHoles = 0;
+  let match;
+  while ((match = holeRegex.exec(norm)) !== null) {
+    const full = match[0].trim();
+    const num = parseInt(match[1], 10);
+    let shape = match[2] ? match[2].toLowerCase() : null;
+    if (shape === "bau duc") shape = "oval";
+    const size = match[3] ? match[3].toLowerCase() : null;
 
-  // 3. Trích xuất Total Holes trên norm (ví dụ: "5 lo tron", "5 lo", "8 lo", nhưng không phải "4 lo to" hay "1 lo nho")
-  const totalRegex = /(?:^|[^\d])(\d+)\s*(?:lo|hole|holes)\b(?!\s*(?:to|lon|nho|be))/gi;
-  let tMatch;
-  while ((tMatch = totalRegex.exec(norm)) !== null) {
-    const n = parseInt(tMatch[1], 10);
-    if (totalHoles == null) {
-      totalHoles = n;
+    const hasLo = /\blo\b/i.test(full);
+    if (!hasLo && !shape && !size) continue;
+
+    if (shape) {
+      shapeCounts[shape] = (shapeCounts[shape] || 0) + num;
+      if (!holeShapes.includes(shape)) holeShapes.push(shape);
     }
-  }
 
-  if (totalHoles == null) {
-    const directShapeMatch = norm.match(/(?:^|[^\d])(\d+)\s*(?:tron|vuong|oval|bau duc|chu nhat|tam giac)\b/i);
-    if (directShapeMatch) {
-      totalHoles = parseInt(directShapeMatch[1], 10);
+    if (!size) {
+      explicitGeneralHoles += num;
+      if (shape) {
+        generalShapeCounts[shape] = (generalShapeCounts[shape] || 0) + num;
+      }
     }
   }
 
-  // 4. Auto-inference rule:
-  // - Nếu có bigHoles và smallHoles mà chưa có totalHoles: totalHoles = bigHoles + smallHoles
-  if (totalHoles == null && bigHoles != null && smallHoles != null) {
-    totalHoles = bigHoles + smallHoles;
-  } else if (totalHoles == null && bigHoles != null && smallHoles == null) {
-    totalHoles = bigHoles;
-  } else if (totalHoles == null && smallHoles != null && bigHoles == null) {
-    totalHoles = smallHoles;
-  } else if (totalHoles != null && bigHoles != null && smallHoles == null && totalHoles >= bigHoles) {
-    smallHoles = totalHoles - bigHoles;
-  } else if (totalHoles != null && smallHoles != null && bigHoles == null && totalHoles >= smallHoles) {
-    bigHoles = totalHoles - smallHoles;
+  for (const item of KNOWN_SHAPES) {
+    if (item.match.test(norm) && !holeShapes.includes(item.shape)) {
+      holeShapes.push(item.shape);
+    }
   }
 
-  // 5. Trích xuất các hình dạng lỗ xuất hiện trong chuỗi
-  for (const item of KNOWN_SHAPES) {
-    if (item.match.test(norm)) {
-      if (!holeShapes.includes(item.shape)) {
-        holeShapes.push(item.shape);
+  let totalHoles = null;
+  const hasBigOrSmall = bigHoles != null || smallHoles != null;
+  const subSum = (bigHoles || 0) + (smallHoles || 0);
+
+  if (hasBigOrSmall) {
+    if (explicitGeneralHoles === subSum && explicitGeneralHoles > 0) {
+      totalHoles = explicitGeneralHoles;
+    } else if (explicitGeneralHoles === 0) {
+      if (bigHoles != null && smallHoles != null) {
+        totalHoles = subSum;
+      } else if (Object.keys(shapeCounts).length === 1 && (bigHoles != null || smallHoles != null)) {
+        totalHoles = subSum;
+      }
+    } else {
+      const isShapeBreakdown = Object.values(generalShapeCounts).some(cnt => cnt === subSum);
+      if (isShapeBreakdown) {
+        totalHoles = explicitGeneralHoles;
+      } else if (explicitGeneralHoles > 0 && segments.length > 1) {
+        totalHoles = explicitGeneralHoles + subSum;
+      } else if (explicitGeneralHoles > 0) {
+        totalHoles = explicitGeneralHoles;
       }
     }
+
+    if (totalHoles != null && holeShapes.length <= 1 && explicitGeneralHoles > 0) {
+      if (bigHoles != null && smallHoles == null && totalHoles >= bigHoles) {
+        smallHoles = totalHoles - bigHoles;
+      } else if (smallHoles != null && bigHoles == null && totalHoles >= smallHoles) {
+        bigHoles = totalHoles - smallHoles;
+      }
+    }
+  } else {
+    if (explicitGeneralHoles > 0) {
+      totalHoles = explicitGeneralHoles;
+    }
   }
 
-  // 6. Trích xuất các cặp số khác (otherNumberedPairs) với ranh giới số nghiêm ngặt
-  const pairRegex = /(?:^|[^\d])(\d+)\s+([a-zA-Zà-ỹÀ-Ỹ]+)/gi;
+  const pairRegex = /(?<!\d)(\d+)\s+([a-zA-Zà-ỹÀ-Ỹ]+)/gi;
   let pMatch;
+  const otherNumberedPairs = [];
   while ((pMatch = pairRegex.exec(cleaned)) !== null) {
     const num = parseInt(pMatch[1], 10);
     const noun = pMatch[2].trim().toLowerCase();
@@ -358,10 +391,10 @@ export function parseIdentifyingFeaturesAST(text) {
     }
   }
 
-  // 7. Trích xuất keywords cấu trúc
   const STRUCTURAL_KEYWORDS = [
     "uon cong", "dap noi", "vat goc", "tai bat oc", "go dap", "gan noi", "dap gan", "chot dinh vi", "ngam"
   ];
+  const keywords = [];
   for (const kw of STRUCTURAL_KEYWORDS) {
     if (norm.includes(kw)) {
       keywords.push(kw);
@@ -373,6 +406,7 @@ export function parseIdentifyingFeaturesAST(text) {
     bigHoles,
     smallHoles,
     holeShapes,
+    shapeCounts,
     otherNumberedPairs,
     keywords
   };
@@ -383,7 +417,7 @@ export function parseIdentifyingFeaturesAST(text) {
  * Hỗ trợ đảo vị trí ("5 lỗ tròn 2 lỗ nhỏ + 3 lỗ to" == "5 lỗ tròn 3 lỗ to + 2 lỗ nhỏ"),
  * suy luận tổng số lỗ ngầm định, và ngưỡng sai số cảm tính (+/- 1 lỗ to/nhỏ).
  */
-export function matchFeatureQueryFlexible(dbText, queryText) {
+export function matchFeatureQueryFlexible(dbText, queryText, options = { allowPerceptualTolerance: false }) {
   if (!dbText || !queryText) {
     return { matched: false, tier: "none", score: 0 };
   }
@@ -395,7 +429,7 @@ export function matchFeatureQueryFlexible(dbText, queryText) {
       let minScore = 1.0;
       let worstTier = "exact_match";
       for (const part of parts) {
-        const sub = matchFeatureQueryFlexible(dbText, part);
+        const sub = matchFeatureQueryFlexible(dbText, part, options);
         if (!sub.matched) {
           return { matched: false, tier: "none", score: 0 };
         }
@@ -435,6 +469,15 @@ export function matchFeatureQueryFlexible(dbText, queryText) {
         }
       }
     }
+
+    // Nếu query có số lượng cho từng hình dáng (ví dụ "6 lỗ tròn", "4 lỗ oval", "22 lỗ tròn"):
+    for (const [shape, count] of Object.entries(qAST.shapeCounts || {})) {
+      if (dbAST.shapeCounts && dbAST.shapeCounts[shape] != null) {
+        if (dbAST.shapeCounts[shape] !== count) {
+          return { matched: false, tier: "none", score: 0 };
+        }
+      }
+    }
   }
 
   // 2. Kiểm tra các cặp số khác (ví dụ: "2 ngàm")
@@ -457,78 +500,57 @@ export function matchFeatureQueryFlexible(dbText, queryText) {
 
   // 4. Nếu query có chỉ định số lượng lỗ (total, big, small)
   if (qHasHoleNumber) {
-    if (qAST.totalHoles != null) {
-      if (dbAST.totalHoles == null || dbAST.totalHoles !== qAST.totalHoles) {
+    let usedTolerance = false;
+
+    // a. Big holes strict check
+    if (qAST.bigHoles != null) {
+      if (dbAST.bigHoles == null) {
         return { matched: false, tier: "none", score: 0 };
       }
-
-      if (qAST.bigHoles != null && qAST.smallHoles != null) {
-        if (dbAST.bigHoles != null && dbAST.smallHoles != null) {
-          if (qAST.bigHoles === dbAST.bigHoles && qAST.smallHoles === dbAST.smallHoles) {
-            return { matched: true, tier: "exact_match", score: 1.0 };
-          }
-          if (Math.abs(qAST.bigHoles - dbAST.bigHoles) === 1 && Math.abs(qAST.smallHoles - dbAST.smallHoles) === 1) {
-            return { matched: true, tier: "perceptual_tolerance", score: 0.85 };
-          }
+      if (qAST.bigHoles !== dbAST.bigHoles) {
+        if (options?.allowPerceptualTolerance && Math.abs(qAST.bigHoles - dbAST.bigHoles) === 1) {
+          usedTolerance = true;
+        } else {
           return { matched: false, tier: "none", score: 0 };
         }
-        return { matched: true, tier: "partial_match", score: 0.90 };
       }
+    }
 
-      if (qAST.bigHoles != null) {
-        if (dbAST.bigHoles != null) {
-          if (qAST.bigHoles === dbAST.bigHoles) {
-            return { matched: true, tier: "exact_match", score: 1.0 };
-          }
-          if (Math.abs(qAST.bigHoles - dbAST.bigHoles) === 1) {
-            return { matched: true, tier: "perceptual_tolerance", score: 0.85 };
-          }
-          return { matched: false, tier: "none", score: 0 };
-        }
-        return { matched: true, tier: "partial_match", score: 0.90 };
+    // b. Small holes strict check
+    if (qAST.smallHoles != null) {
+      if (dbAST.smallHoles == null) {
+        return { matched: false, tier: "none", score: 0 };
       }
-
-      if (qAST.smallHoles != null) {
-        if (dbAST.smallHoles != null) {
-          if (qAST.smallHoles === dbAST.smallHoles) {
-            return { matched: true, tier: "exact_match", score: 1.0 };
-          }
-          if (Math.abs(qAST.smallHoles - dbAST.smallHoles) === 1) {
-            return { matched: true, tier: "perceptual_tolerance", score: 0.85 };
-          }
+      if (qAST.smallHoles !== dbAST.smallHoles) {
+        if (options?.allowPerceptualTolerance && Math.abs(qAST.smallHoles - dbAST.smallHoles) === 1) {
+          usedTolerance = true;
+        } else {
           return { matched: false, tier: "none", score: 0 };
         }
-        return { matched: true, tier: "partial_match", score: 0.90 };
       }
-
-      return { matched: true, tier: "exact_match", score: 1.0 };
     }
 
-    if (qAST.bigHoles != null) {
-      if (dbAST.bigHoles != null) {
-        if (qAST.bigHoles === dbAST.bigHoles) {
-          return { matched: true, tier: "exact_match", score: 1.0 };
+    // c. Total holes check
+    if (qAST.totalHoles != null) {
+      const queryHasShapeCounts = Object.keys(qAST.shapeCounts || {}).length > 0;
+      if (!queryHasShapeCounts || qAST.bigHoles != null || qAST.smallHoles != null) {
+        if (dbAST.totalHoles == null || dbAST.totalHoles !== qAST.totalHoles) {
+          return { matched: false, tier: "none", score: 0 };
         }
-        if (Math.abs(qAST.bigHoles - dbAST.bigHoles) === 1) {
-          return { matched: true, tier: "perceptual_tolerance", score: 0.85 };
+      } else {
+        if (dbAST.holeShapes.length <= 1) {
+          if (dbAST.totalHoles == null || dbAST.totalHoles !== qAST.totalHoles) {
+            return { matched: false, tier: "none", score: 0 };
+          }
         }
       }
-      return { matched: false, tier: "none", score: 0 };
     }
 
-    if (qAST.smallHoles != null) {
-      if (dbAST.smallHoles != null) {
-        if (qAST.smallHoles === dbAST.smallHoles) {
-          return { matched: true, tier: "exact_match", score: 1.0 };
-        }
-        if (Math.abs(qAST.smallHoles - dbAST.smallHoles) === 1) {
-          return { matched: true, tier: "perceptual_tolerance", score: 0.85 };
-        }
-      }
-      return { matched: false, tier: "none", score: 0 };
+    if (usedTolerance) {
+      return { matched: true, tier: "perceptual_tolerance", score: 0.85 };
     }
 
-    return { matched: false, tier: "none", score: 0 };
+    return { matched: true, tier: "exact_match", score: 1.0 };
   }
 
   // 5. Nếu không có số lượng lỗ, chỉ lọc theo shapes hoặc keywords
@@ -547,19 +569,27 @@ export function matchFeatureQueryFlexible(dbText, queryText) {
 export function matchRowWithFeatures(row, queryFeatures, rawQuery = "") {
   if (!row) return false;
 
+  const qAST = rawQuery ? parseIdentifyingFeaturesAST(rawQuery) : null;
+  const isHoleQuery = qAST && (qAST.totalHoles != null || qAST.bigHoles != null || qAST.smallHoles != null);
+
   // 1. Kiểm tra bằng Flexible AST Match nếu có rawQuery
   if (rawQuery) {
     const flex = matchFeatureQueryFlexible(row.identifying_features, rawQuery);
     if (flex.matched) return true;
+    // Khi qAST là truy vấn số lượng lỗ, matchFeatureQueryFlexible là cơ quan thẩm quyền duy nhất,
+    // TUYỆT ĐỐI không fallback xuống parseIdentifyingFeatures lỏng lẻo
+    if (isHoleQuery) return false;
   }
 
   if (Array.isArray(queryFeatures) && queryFeatures.length > 0) {
     const queryStr = queryFeatures.map(q => q.raw || `${q.number || ''} ${q.text || ''}`).join(", ");
     const flex = matchFeatureQueryFlexible(row.identifying_features, queryStr);
     if (flex.matched) return true;
+    const qfAST = parseIdentifyingFeaturesAST(queryStr);
+    if (qfAST.totalHoles != null || qfAST.bigHoles != null || qfAST.smallHoles != null) return false;
   }
 
-  // 2. Cơ chế phân đoạn dấu phẩy gốc (bảo toàn 100% tương thích)
+  // 2. Cơ chế phân đoạn dấu phẩy gốc (bảo toàn 100% tương thích cho các query phi số lượng lỗ)
   if (!queryFeatures || queryFeatures.length === 0) return false;
   const dbFeatures = parseIdentifyingFeatures(row.identifying_features);
   if (dbFeatures.length === 0) return false;
diff --git a/tests/moris-features-filter.test.js b/tests/moris-features-filter.test.js
index 174c4d2..9b25580 100644
--- a/tests/moris-features-filter.test.js
+++ b/tests/moris-features-filter.test.js
@@ -195,6 +195,8 @@ describe("Moris Identifying Features Matcher (Đặc điểm nhận dạng)", ()
         // CHỈ ĐÚNG 1 MÃ TRUE, KHÔNG PHẢI TOP 10 RÁC
         expect(data.candidates).toHaveLength(1);
         expect(data.candidates[0].code).toBe("3411160201");
+        expect(data.candidates[0].is_feature_match).toBe(true);
+        expect(data.candidates[0].badge_label).toBe("Khớp");
         expect(data.answer).toContain("3411160201");
         expect(data.answer).not.toContain("3411160202");
         expect(data.answer).not.toContain("3411160203");
@@ -466,11 +468,16 @@ describe("Moris Identifying Features Matcher (Đặc điểm nhận dạng)", ()
       expect(res.score).toBe(1.0);
     });
 
-    it("ngưỡng sai số cảm tính mắt thường (perceptual_tolerance): lệch 1 lỗ to/nhỏ khi tổng số lỗ khớp", () => {
+    it("ngưỡng sai số cảm tính mắt thường (perceptual_tolerance): lệch 1 lỗ to/nhỏ khi bật allowPerceptualTolerance", () => {
       const dbText = "5 lỗ tròn 3 lỗ to + 2 lỗ nhỏ";
       const queryShift = "5 lỗ tròn 2 lỗ to + 3 lỗ nhỏ";
 
-      const res = matchFeatureQueryFlexible(dbText, queryShift);
+      // Mặc định allowPerceptualTolerance = false -> tuyệt đối không khớp
+      const strictRes = matchFeatureQueryFlexible(dbText, queryShift);
+      expect(strictRes.matched).toBe(false);
+
+      // Khi bật allowPerceptualTolerance: true -> khớp sai số cảm tính
+      const res = matchFeatureQueryFlexible(dbText, queryShift, { allowPerceptualTolerance: true });
       expect(res.matched).toBe(true);
       expect(res.tier).toBe("perceptual_tolerance");
       expect(res.score).toBe(0.85);
@@ -483,6 +490,70 @@ describe("Moris Identifying Features Matcher (Đặc điểm nhận dạng)", ()
       expect(matchFeatureQueryFlexible("2 lỗ tròn to", "2 lỗ tròn").matched).toBe(true);
     });
   });
+
+  describe("Production Hotfix Cases: '3 lỗ nhỏ + 1 lỗ to' vs false positives", () => {
+    const productionParts = [
+      { id: "1", code: "3687110001", identifying_features: "4 lỗ tròn 3 lỗ nhỏ + 1 lỗ to" },
+      { id: "2", code: "3885600001", identifying_features: "4 lỗ tròn 3 lỗ nhỏ 1 lỗ to, có uốn cong 2 đoạn" },
+      { id: "3", code: "3883310001", identifying_features: "4 lỗ tròn 2 lỗ to + 2 lỗ nhỏ" },
+      { id: "4", code: "3889630101", identifying_features: "4 lỗ oval, 5 lỗ tròn, 1 lỗ vuông nhỏ, 1 lỗ vuông to, uốn cong giữa thân" },
+      { id: "5", code: "3889510001", identifying_features: "4 lỗ tròn, có uốn cong" },
+      { id: "6", code: "3960230001", identifying_features: "4 lỗ tròn, 1 lỗ vuông" }
+    ];
+
+    const testQueries = [
+      "3 lỗ nhỏ + 1 lỗ to",
+      "1 lỗ to + 3 lỗ nhỏ",
+      "4 lỗ tròn 3 lỗ nhỏ + 1 lỗ to"
+    ];
+
+    for (const q of testQueries) {
+      it(`truy vấn "${q}": MUST match 3687110001 & 3885600001, MUST NOT match 3883310001, 3889630101, 3889510001, 3960230001`, () => {
+        const res = filterCatalogueByQueryFeatures(productionParts, q);
+        expect(res.isFeatureQuery).toBe(true);
+        const codes = res.matchedRows.map(r => r.code);
+        expect(codes).toContain("3687110001");
+        expect(codes).toContain("3885600001");
+        expect(codes).not.toContain("3883310001");
+        expect(codes).not.toContain("3889630101");
+        expect(codes).not.toContain("3889510001");
+        expect(codes).not.toContain("3960230001");
+        expect(res.matchedRows).toHaveLength(2);
+      });
+    }
+
+    it("Moris Chat candidate trả về nhãn 'Khớp' và is_feature_match: true thay vì 100%", async () => {
+      const { onRequestPost } = await import("../functions/api/moris/chat.js");
+      const fakeJwt = "header.payload.signature";
+      const originalFetch = globalThis.fetch;
+      globalThis.fetch = async (url) => {
+        const u = String(url);
+        if (u.includes("app_me")) return new Response(JSON.stringify([{ ok: true, id: "test-user-id" }]), { status: 200 });
+        if (u.includes("app_search_catalogue")) return new Response(JSON.stringify(productionParts), { status: 200 });
+        return new Response("Not found", { status: 404 });
+      };
+
+      try {
+        const request = new Request("https://example.com/api/moris/chat", {
+          method: "POST",
+          headers: { "content-type": "application/json", "x-session-token": fakeJwt },
+          body: JSON.stringify({ message: "3 lỗ nhỏ + 1 lỗ to", session_token: fakeJwt })
+        });
+
+        const res = await onRequestPost({ request, env: { SUPABASE_URL: "https://test.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "srv" } });
+        const data = await res.json();
+        expect(data.ok).toBe(true);
+        expect(data.candidates).toHaveLength(2);
+        for (const cand of data.candidates) {
+          expect(cand.is_feature_match).toBe(true);
+          expect(cand.badge_label).toBe("Khớp");
+        }
+        expect(data.answer).not.toContain("100%");
+      } finally {
+        globalThis.fetch = originalFetch;
+      }
+    });
+  });
 });
 
 
