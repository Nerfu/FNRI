/** Presentation of prepared skill data. Never persists or modifies roll data. */
import {applicableRollContributions,selectRollParts,selectedRollParts,applyDirectRollModifiers} from '../rolls/roll-context.mjs';
import {nonStackingSelections} from '../rolls/roll-contributions.mjs';
import {skillFormula} from '../rolls/checks.mjs';
const die=/^(?:1)?d(4|6|8|10|12)$/i;
const number=v=>typeof v==='number'&&Number.isFinite(v)?v:0;
const compact=v=>String(v??'').trim();
const sign=v=>v<0?`−${Math.abs(v)}`:`+${v}`;
const tr=k=>globalThis.game?.i18n?.localize?.(`FASTNRI.SkillDisplay.${k}`)??k;
function terms(value){
  const s=value.replace(/\s+/g,'');
  if(!s)return [];
  if(!/^[+-]?(?:\d*d\d+|\d+(?:\.\d+)?)(?:[+-](?:\d*d\d+|\d+(?:\.\d+)?))*$/i.test(s))return null;
  return s.match(/[+-]?(?:\d*d\d+|\d+(?:\.\d+)?)/gi);
}
function additions(parts,modifier){
  const dice=new Map();let total=modifier;
  for(const part of parts){
    const m=/^([+-]?)(\d*)d(\d+)$/i.exec(part);
    if(m){
      // Opposite-signed dice remain independent random variables, never cancel.
      const key=`${m[1]==='-'?'−':'+'}${Number(m[3])}`;
      dice.set(key,(dice.get(key)??0)+Number(m[2]||1));
    }else total+=Number(part);
  }
  let text='';for(const [key,count] of dice)if(count)text+=`${key[0]}${count}d${key.slice(1)}`;
  return text+(total?sign(total):'');
}
/** The common roll builder appends parenthesized terms. Split only these
 * boundaries, not the expression inside a user's arbitrary skill formula. */
function rollGroups(expression){
  const first=expression.indexOf(' + (');
  if(first<0)return {check:expression,groups:[]};
  const groups=[];let i=first;
  while(i<expression.length){
    if(expression.slice(i,i+4)!==' + (')return null;
    const start=i+4;let depth=1;i=start;
    while(i<expression.length&&depth){if(expression[i]==='(')depth++;else if(expression[i]===')')depth--;i++;}
    if(depth)return null;
    groups.push(expression.slice(start,i-1));
  }
  return {check:expression.slice(0,first),groups};
}
/** Native changes are already present in prepared data. Default-enabled,
 * non-consuming scoped skill contributions use the normal modifier engine;
 * other selectable parts and specializations stay in the preroll. */
export function skillFormulaDisplay(row,prepared,actor,{origin='',originalFace=null}={}){
  const raw=compact(row.dice),current=compact(prepared?.dice??row.dice);
  const modifier=number(prepared?.modifier??row.modifier);
  const formula=skillFormula({dice:current,modifier});
  const entries=applicableRollContributions(actor,{kind:'skill',skillId:row.id,formula});
  const selected=selectRollParts(entries).filter(e=>!e.onUse||e.onUse==='none');
  const sources=[`${tr('base')}: ${raw||'—'}${origin?' · '+origin:''}`];
  if(number(row.modifier))sources.push(`${tr('manual')}: ${sign(row.modifier)}`);
  for(const entry of entries)for(const p of selectedRollParts(entry))if(p.kind==='native')sources.push(`${entry.name}: ${p.value} (${p.type??''})`);
  let effective=current,extras=[];
  // Use the actual default modifier order and non-stacking rules. If an
  // authored expression cannot be safely represented, retain prepared data
  // and leave the direct contribution to the normal preroll rather than guess.
  try{
    const result=rollGroups(applyDirectRollModifiers(formula,selected));
    if(!result)throw Error('unsupported display');
    const groups=[...result.groups];
    const next=current?groups.shift():'';
    const actualModifier=modifier?groups.shift():null;
    if(actualModifier!==null&&Number(actualModifier)!==modifier)throw Error('unsupported modifier');
    const parsed=groups.map(terms);if(parsed.some(p=>!p))throw Error('unsupported terms');
    effective=next??current;extras=parsed.flat();
    if(result.check!=='1d20')sources.push(`${tr('checkChange')}: 1d20 → ${result.check}`);
    const winners=nonStackingSelections(selected);
    for(const entry of selected)for(const p of selectedRollParts(entry)){
      if(p.kind==='replacement')sources.push(`${entry.name}: ${p.from} → ${p.to} (${tr('defaultRoll')})`);
      if(p.kind!=='modifier')continue;
      const win=p.nonStackingGroup?winners.get(p.nonStackingGroup)?.winner:null;
      if(p.nonStackingGroup&&(!win||win.entry!==entry.uuid||win.part!==p.id))continue;
      sources.push(`${entry.name}: ${p.value} (${tr('defaultRoll')})`);
    }
  }catch{sources.push(tr('prerollOnly'));}
  let base=effective,tail=[];
  const simple=die.exec(raw),effectiveTerms=terms(effective);
  // Preserve arbitrary authored expressions verbatim; don't infer algebra.
  if(simple&&effectiveTerms?.length&&die.test(effectiveTerms[0])){
    base=effectiveTerms[0].replace(/^1d/i,'d');tail=effectiveTerms.slice(1);
  }else if(!raw&&effectiveTerms){base='';tail=effectiveTerms;}
  let suffix=additions([...tail,...extras],modifier);
  if(!base)suffix=suffix.replace(/^\+/,'');
  const from=originalFace??(simple?Number(simple[1]):null);
  const to=Number(die.exec(base)?.[1])||null;
  const direction=from&&to?Math.sign(to-from):0;
  if(direction)sources.push(`${tr('step')}: d${from} → d${to}`);
  if(current!==raw)sources.push(`${tr('prepared')}: ${current||'—'}`);
  const text=(base+suffix)||'—';
  sources.push(`${tr('total')}: ${text}`);
  return {base:base||(!suffix?'—':''),suffix,text,direction:direction>0?'up':direction<0?'down':'',arrow:direction>0?'↑':direction<0?'↓':'',hint:sources.join('\n')};
}
