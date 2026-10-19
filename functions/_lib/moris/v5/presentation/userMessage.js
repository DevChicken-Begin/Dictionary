import { HOLE_FORMAT_NAMES } from "../retrieval/holeFormatReference.js";

function clean(v){ return String(v ?? "").trim(); }
function codeOf(c){ return clean(c?.code || c?.part_id || c?.id || c?.record_id); }

function listCodes(rows,limit=10){
  return (rows || []).slice(0,limit).map((c,i)=>
    `${i+1}. ${codeOf(c) || "Không rõ mã"}`
  );
}

export const MORIS_PUBLIC_MESSAGES = Object.freeze({
  welcome:"Chào anh, em là Moris. Em có thể giúp gì cho anh?",
  noMatch:"Xin lỗi anh, em không tìm thấy kết quả phù hợp với yêu cầu này trong catalogue.",
  unsupported:"Xin lỗi anh, yêu cầu này em chưa được học. Anh giúp em hỏi nội dung liên quan đến catalogue nhé!",
  temporaryError:"Xin lỗi anh, em chưa thể xử lý yêu cầu này lúc này. Anh thử lại giúp em nhé.",
  sizeGateNoMatch:"Em tìm thấy ứng viên nhưng tất cả đều khác kích thước ngoài dung sai. Anh kiểm tra lại cạnh dài nhất / cạnh ngắn nhất hoặc bỏ nhập kích thước giúp em."
});

// M28: ghi chú trung tính khi size gate bỏ qua hoặc có loại ứng viên (Q8).
function sizeEvidenceNote(sizeEvidence){
  if(!sizeEvidence || typeof sizeEvidence !== "object") return "";
  if(sizeEvidence.status === "dims_unavailable"){
    return "Chưa có dữ liệu kích thước catalogue — em chưa lọc theo kích thước được.";
  }
  if(sizeEvidence.status === "applied" && Number(sizeEvidence.rejected_count || 0) > 0){
    const relative = Math.round(Number(sizeEvidence?.tolerance?.relative ?? 0.05) * 100);
    const floorMm = Number(sizeEvidence?.tolerance?.floorMm ?? 2);
    return `Đã đối chiếu kích thước: loại ${sizeEvidence.rejected_count} mã ngoài dung sai (±${relative}% hoặc tối thiểu ${floorMm}mm).`;
  }
  return "";
}

// Từ điển mẫu lỗ (2026-10-19): ghi chú trung tính — Moris nói tên định dạng khi có cơ sở,
// khẳng định rõ đây chỉ là tham chiếu (không loại trừ ứng viên khác định dạng).
function holeFormatEvidenceNote(evidence){
  if(!evidence || typeof evidence !== "object") return "";
  const tags = Array.isArray(evidence.query_tags) ? evidence.query_tags : [];
  if(!tags.length) return "";
  const names = tags.map(t=>HOLE_FORMAT_NAMES[t] || t).join(", ");
  const matched = Number(evidence.matched_count || 0);
  if(matched > 0){
    return `Định dạng lỗ tham chiếu: ${names}. ${matched} mã có mô tả cùng định dạng (chỉ để tham khảo).`;
  }
  return `Định dạng lỗ tham chiếu: ${names} — chưa có mã nào có mô tả cùng định dạng; em vẫn xếp hạng theo tương đồng ảnh.`;
}

// Cặp dễ nhầm lẫn (Hard-Negative Pair): cảnh báo chuyên gia khi Top ứng viên chứa cặp dễ nhầm
function confusingPairEvidenceNote(pairEvidence){
  if (!pairEvidence || !pairEvidence.active) return "";
  return `⚠️ Lưu ý: Mã ${pairEvidence.skuA} và ${pairEvidence.skuB} là cặp dễ nhầm lẫn (kích thước tương đương, khác chi tiết lỗ). Anh kiểm tra kỹ vị trí/kích thước lỗ nhé.`;
}

function withNote(message,note){
  return note ? `${message}\n${note}` : message;
}

export function buildMorisUserMessage(result){
  const rows=Array.isArray(result?.candidates) ? result.candidates : [];
  const mode=clean(result?.mode).toUpperCase();
  const decision=clean(result?.decision).toLowerCase();
  const note=[
    sizeEvidenceNote(result?.size_evidence),
    holeFormatEvidenceNote(result?.hole_format_evidence),
    confusingPairEvidenceNote(result?.confusing_pair_evidence)
  ].filter(Boolean).join("\n");

  if(mode === "MORIS_UNSUPPORTED") return MORIS_PUBLIC_MESSAGES.unsupported;

  if(mode === "MORIS_SIZE_GATE_NO_MATCH") return MORIS_PUBLIC_MESSAGES.sizeGateNoMatch;

  if(mode.includes("NO_MATCH") || mode === "MORIS_NO_MATCH" ||
     (!rows.length && decision !== "ambiguous")){
    return withNote(MORIS_PUBLIC_MESSAGES.noMatch,note);
  }

  if(rows.length && mode.startsWith("MORIS_VECTOR")){
    const reasons=result?.decision?.reasons||[];
    const guidance=reasons.includes('low_quality')?'Ảnh chưa rõ vùng linh kiện; anh chụp lại trên nền đồng nhất, đủ sáng và không cắt mép.':
      reasons.includes('orientation_uncertain')?'Chưa xác định rõ mặt hoặc bên trái/phải; anh bổ sung góc chụp để đối chiếu.':
      reasons.includes('close_candidates')?'Các mã có điểm gần nhau; anh đối chiếu lỗ, rãnh và mặt linh kiện trước khi chọn.':
      'Anh đối chiếu ảnh và đặc điểm trước khi xác nhận mã.';
    return withNote(`Em gợi ý ${rows.length} mã để đối chiếu. Điểm so khớp không phải xác suất đúng. ${guidance}\n${listCodes(rows).join("\n")}`,note);
  }

  if(rows.length){
    return withNote(`Em tìm thấy ${rows.length} mã phù hợp:\n${listCodes(rows).join("\n")}`,note);
  }

  if(decision === "ambiguous"){
    return withNote("Em tìm thấy vài mã khá giống nhau nhưng chưa đủ chắc chắn. Anh bổ sung thêm ảnh rõ hơn giúp em nhé.",note);
  }

  return withNote(MORIS_PUBLIC_MESSAGES.noMatch,note);
}
