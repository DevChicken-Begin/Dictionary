/**
 * confusingPairs.js — Trích xuất và đối sánh cặp linh kiện dễ nhầm lẫn (Hard-Negative Pairs)
 * phục vụ phân giải nhầm lẫn (Disambiguation) và cảnh báo trong Moris V6 (Client companion).
 */
export {
  extractConfusingSkus,
  arePartsConfusingPair,
  evaluateHardNegativeCondition,
  detectConfusingPairInTopCandidates
} from '../../../functions/_lib/moris/v5/retrieval/confusingPairs.js';
