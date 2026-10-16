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
  temporaryError:"Xin lỗi anh, em chưa thể xử lý yêu cầu này lúc này. Anh thử lại giúp em nhé."
});

export function buildMorisUserMessage(result){
  const rows=Array.isArray(result?.candidates) ? result.candidates : [];
  const mode=clean(result?.mode).toUpperCase();
  const decision=clean(result?.decision).toLowerCase();

  if(mode === "MORIS_UNSUPPORTED") return MORIS_PUBLIC_MESSAGES.unsupported;

  if(mode.includes("NO_MATCH") || mode === "MORIS_NO_MATCH" ||
     (!rows.length && decision !== "ambiguous")){
    return MORIS_PUBLIC_MESSAGES.noMatch;
  }

  if(rows.length && mode.startsWith("MORIS_VECTOR")){
    const reasons=result?.decision?.reasons||[];
    const guidance=reasons.includes('low_quality')?'Ảnh chưa rõ vùng linh kiện; anh chụp lại trên nền đồng nhất, đủ sáng và không cắt mép.':
      reasons.includes('orientation_uncertain')?'Chưa xác định rõ mặt hoặc bên trái/phải; anh bổ sung góc chụp để đối chiếu.':
      reasons.includes('close_candidates')?'Các mã có điểm gần nhau; anh đối chiếu lỗ, rãnh và mặt linh kiện trước khi chọn.':
      'Anh đối chiếu ảnh và đặc điểm trước khi xác nhận mã.';
    return `Em gợi ý ${rows.length} mã để đối chiếu. Điểm so khớp không phải xác suất đúng. ${guidance}\n${listCodes(rows).join("\n")}`;
  }

  if(rows.length){
    return `Em tìm thấy ${rows.length} mã phù hợp:\n${listCodes(rows).join("\n")}`;
  }

  if(decision === "ambiguous"){
    return "Em tìm thấy vài mã khá giống nhau nhưng chưa đủ chắc chắn. Anh bổ sung thêm ảnh rõ hơn giúp em nhé.";
  }

  return MORIS_PUBLIC_MESSAGES.noMatch;
}
