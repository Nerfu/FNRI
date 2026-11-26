import {BASIC_SKILLS_BY_ROW_ID} from '../data/skills-catalog.mjs';
const starter=['1d6','1d4'];
export const specializationPresets=mode=>mode==='strict'?[...starter]:[...starter,'1d8','1d10','1d12'];
/** Source rows only: advisory presentation, never a permission or roll gate. */
export function specializationStatus(skills,mode,isPC=true){
  const rows=Object.entries(skills??{}).filter(([id,row])=>!BASIC_SKILLS_BY_ROW_ID.has(id)&&row?.kind==='specialization').map(([,row])=>row);
  const named=rows.filter(row=>String(row.name??'').trim());
  const names=named.map(row=>String(row.name).trim().toLowerCase());
  const warnings=[];
  if(isPC&&mode!=='free'){
    if(named.length<2)warnings.push('specMissing');
    if(rows.length>2)warnings.push('specExtra');
    if(named.length!==rows.length)warnings.push('specUnnamed');
    if(new Set(names).size!==names.length)warnings.push('specDuplicateName');
    if(starter.some(d=>named.filter(row=>row.dice===d).length!==1)||named.some(row=>!starter.includes(row.dice)))warnings.push('specDice');
  }
  return {showHint:isPC,canAdd:!isPC||mode!=='strict'||rows.length<2,warnings};
}
