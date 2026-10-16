// Rotation preserves handedness. Reflection needs explicit, trusted view evidence.
export function orientationPolicy(query={},candidate={}){
 const qSide=query.usage_side,cSide=candidate.usage_side;
 const sided=v=>['left','right'].includes(v);
 const conflict=sided(qSide)&&sided(cSide)&&qSide!==cSide;
 const qView=query.view||query.asset_type,cView=candidate.view||candidate.vector_asset_type||candidate.asset_type;
 const oppositeViews=['front','back'].includes(qView)&&['front','back'].includes(cView)&&qView!==cView;
 const sameSide=qSide===cSide&&['left','right','both'].includes(qSide);
 const verifiedSymmetry=candidate.is_symmetric===true&&candidate.symmetry_verified===true;
 const allowMirror=!conflict&&(verifiedSymmetry||(oppositeViews&&sameSide&&candidate.view_mode==='dual_face'&&query.view_mode==='dual_face'));
 return {compatible:!conflict,allow_mirror:allowMirror,
  transforms:allowMirror?['identity','rotate180','mirrorX','mirrorY']:['identity','rotate180'],
  reason:conflict?'usage_side_conflict':allowMirror?'verified_reflection':'rotation_only'};
}
export function transformPoint(p,transform){
 return {...p,x:['rotate180','mirrorX'].includes(transform)?1-p.x:p.x,y:['rotate180','mirrorY'].includes(transform)?1-p.y:p.y};
}
