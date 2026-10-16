export function assertEmbeddingContract({
  vector,
  dimension=384,
  model,
  modelVersion,
  preprocessVersion,
  profile
}){
  if(!Array.isArray(vector) && !(vector instanceof Float32Array)){
    throw new Error("Embedding phải là array hoặc Float32Array.");
  }

  if(vector.length !== dimension){
    throw new Error(`Sai dimension: expected=${dimension}, actual=${vector.length}`);
  }

  for(const value of vector){
    if(typeof value !== "number" || !Number.isFinite(value)){
      throw new Error("Embedding chứa giá trị không hữu hạn.");
    }
  }

  if (Math.hypot(...vector) < 1e-12) throw new Error("Embedding zero norm.");

  if(!model || !modelVersion || !preprocessVersion || !profile){
    throw new Error("Thiếu embedding contract version.");
  }

  return true;
}

export function l2Normalize(vector){
  let sum = 0;
  for(const value of vector) sum += Number(value) ** 2;
  const norm = Math.sqrt(sum);
  if (!Number.isFinite(norm) || norm < 1e-12 || Array.from(vector).some(v => typeof v !== "number" || !Number.isFinite(v))) {
    const error = new Error("Embedding invalid or zero norm.");
    error.status = 400;
    throw error;
  }
  return Array.from(vector,value=>Number(value)/norm);
}
