/** PC skill dice: stable grant IDs, a pure allocation resolver and explicit edit plans.
 * No writes during preparation, no game-rule vetoes. Specializations/NPCs are independent.
 * Canon: Rulebook 7.0, V / Кубы навыков, racial property cards. */
import {BASIC_SKILLS,standardSkillEntry} from './skills-catalog.mjs';
import {classDefinition,mandatoryClassSkills} from './classes.mjs';
import {racialContentId,racialPropertyRule} from './racial-properties.mjs';
const ids=new Set(BASIC_SKILLS.map(s=>s.id));
const ranks=[4,6,8,10,12];
const face=v=>Number(/^1?d(4|6|8|10|12)$/.exec(String(v??''))?.[1]??0);
const formula=n=>n?`1d${n}`:'';
const record=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
export const initialSkillAllocation=()=>({assignments:{},upgrades:{},overrides:{}});
const copyState=state=>Object.fromEntries(Object.keys(initialSkillAllocation()).map(k=>[k,{...record(state?.[k])}]));

export function skillDiceSources(system,items=[]){
  const rule=classDefinition(system), dice=[], upgrades=[];
  const add=(id,source,size,extra={})=>dice.push({id,source,size,...extra});
  if(rule){
    mandatoryClassSkills(system).forEach(skill=>add(`class_${skill}`,rule.name,10,{preferred:skill,locked:true}));
    [8,6,6].forEach((size,i)=>add(`free_${i}`,rule.name,size));
  }
  const seen=new Set();
  for(const item of items){
    if(!racialPropertyRule(item))continue;
    const key=racialContentId(item)||item.id;
    if(!key||seen.has(key))continue;
    seen.add(key);
    const grant=item.system.mechanics.skillDice;
    if(!grant||typeof grant!=='object')continue;
    const source=item.name||key, prefix=`racial_${key.replace(/[^a-zA-Z0-9_-]/g,'_')}`;
    for(const [i,entry] of (Array.isArray(grant.grants)?grant.grants:[]).entries()){
      if(!ranks.includes(entry?.size))continue;
      const preferred=ids.has(entry.skill)?entry.skill:undefined;
      const allowed=Array.isArray(entry.allowed)?entry.allowed.filter(id=>ids.has(id)):undefined;
      add(`${prefix}_${i}`,source,entry.size,{preferred,allowed});
    }
    for(const size of (Array.isArray(grant.upgrades)?grant.upgrades:[]))if(ranks.includes(size)&&size<12)
      upgrades.push({id:`${prefix}_upgrade_${size}`,source,size});
  }
  return {dice,upgrades,needsTradition:!!rule?.traditions&&!mandatoryClassSkills(system).length,active:!!rule||dice.length>0||upgrades.length>0};
}

export function resolveSkillAllocation(system,items=[],sourceSkills=system?.skills??{}){
  const {dice,upgrades,needsTradition,active}=skillDiceSources(system,items);
  const state=copyState(system?.skillAllocation), warnings=[];
  const warn=(code,data={})=>warnings.push({code,...data});
  if(needsTradition)warn('tradition');
  const byId=new Map(dice.map(d=>[d.id,{...d,face:d.size,skill:null,displaced:false}]));
  const promoted=new Set(), upgradeRows=[];
  for(const u of upgrades){
    const id=state.upgrades[u.id], d=byId.get(id);
    if(d&&d.size===u.size&&!promoted.has(id)){
      d.face=ranks[ranks.indexOf(d.size)+1];promoted.add(id);upgradeRows.push({...u,target:id});
    } else {
      upgradeRows.push({...u,target:null});
      if(id)warn('invalidUpgrade',{upgrade:u.id,die:id});
    }
  }
  const candidates=[...byId.values()];
  // A named grant explicitly reallocated after displacement is now an ordinary
  // assigned die. Do not steal it back if its original skill later becomes free.
  for(const d of candidates)if(d.preferred&&!d.locked&&ids.has(state.assignments[d.id])&&state.assignments[d.id]!==d.preferred)d.displaced=true;
  const slots=new Map();
  const place=(d,skill)=>{d.skill=skill;slots.set(skill,d);};
  const preferred=d=>d.displaced?state.assignments[d.id]:d.preferred||state.assignments[d.id];
  // Mandatory d10 wins; otherwise higher dice win. An existing explicit
  // allocation wins a tie against a newly granted named die.
  // Resolve intended destinations together, so even an already assigned stronger
  // free die can displace a newly received weaker grant. No die is destroyed.
  candidates.sort((a,b)=>Number(!!b.locked)-Number(!!a.locked)||b.face-a.face||Number(!!a.preferred&&!a.displaced)-Number(!!b.preferred&&!b.displaced)||a.id.localeCompare(b.id));
  for(const d of candidates){
    const target=preferred(d);
    if(ids.has(target)&&!slots.has(target))place(d,target);
    else if(d.preferred&&!d.locked)d.displaced=true;
  }
  // A displaced named grant is now free; a user can allocate its alternative.
  for(const d of candidates){
    const alt=state.assignments[d.id];
    if(d.displaced&&ids.has(alt)&&!slots.has(alt))place(d,alt);
    if(d.skill&&d.allowed&&!d.allowed.includes(d.skill))warn('restricted',{skill:d.skill,die:d.id});
  }
  const rows={};
  for(const skill of BASIC_SKILLS){
    const d=slots.get(skill.id), expected=formula(d?.face), raw=sourceSkills[`core_${skill.id}`]?.dice;
    // Explicit raw formula is the existing manual path, not a migration.
    const override=typeof state.overrides[skill.id]==='string'?state.overrides[skill.id]:String(raw??'').trim()||null;
    const actual=override??expected;
    if(override!==null&&actual!==expected&&face(actual)!==face(expected))warn(d?.locked?'mandatoryOverride':'manualOverride',{skill:skill.id,expected,actual});
    else if(override!==null&&actual!==expected&&!face(actual))warn('manualOverride',{skill:skill.id,expected,actual});
    rows[skill.id]={skill:skill.id,die:d?.id??null,expected,formula:actual,override};
  }
  return {active:active||Object.values(state.overrides).some(v=>typeof v==='string'),dice:candidates,upgrades:upgradeRows,rows,warnings,free:candidates.filter(d=>!d.skill),needsTradition};
}

/** Used by the current sheet and future button editor. An unavailable die is
 * a deliberate manual override, not an artificial rejection. */
export function planSkillDie(system,items,skill,value){
  const state=copyState(system.skillAllocation), current=resolveSkillAllocation(system,items);
  if(!ids.has(skill))return state;
  const requested=String(value??'').trim(), size=face(requested);
  const d=current.dice.find(d=>d.skill===skill);
  if(current.rows[skill].override===null&&(requested===current.rows[skill].expected||size&&size===face(current.rows[skill].expected)))return state;
  if(d&&!d.locked&&(!d.preferred||d.displaced)){
    state.assignments[d.id]=null;
  }
  state.overrides[skill]=null;
  // Ignore raw manual value for the edited row while selecting a grant.
  const cleanSkills={...system.skills,[`core_${skill}`]:{...system.skills?.[`core_${skill}`],dice:''}};
  let next=resolveSkillAllocation({...system,skills:cleanSkills,skillAllocation:state},items);
  if(requested===next.rows[skill].expected||size&&size===face(next.rows[skill].expected))return state;
  if(size&&!(d?.preferred&&!d.displaced)){
    // Prefer an eligible free cube, but still allow choosing a restricted one
    // with an advisory warning if no eligible source is available.
    const free=next.free.filter(d=>d.face===size&&!d.locked);
    const token=free.find(d=>d.allowed?.includes(skill))??free.find(d=>!d.allowed)??free[0];
    if(token){
      state.assignments[token.id]=skill;
      next=resolveSkillAllocation({...system,skills:cleanSkills,skillAllocation:state},items);
      if(face(next.rows[skill].expected)===size)return state;
      state.assignments[token.id]=null;
    }
  }
  state.overrides[skill]=requested;
  return state;
}

/** Explicit token operations for the forthcoming skill editor. Null entries
 * clear stored values safely under Foundry's nested-object merge semantics. */
export function planSkillAssignment(system,die,skill){
  const state=copyState(system.skillAllocation);
  state.assignments[die]=ids.has(skill)?skill:null;
  return state;
}
export function planSkillUpgrade(system,upgrade,die){
  const state=copyState(system.skillAllocation);
  state.upgrades[upgrade]=die||null;
  return state;
}
export function clearSkillAllocation(system){
  const state=copyState(system.skillAllocation);
  for(const bucket of Object.values(state))for(const key of Object.keys(bucket))bucket[key]=null;
  return state;
}
export function prepareSkillAllocation(system){
  if(!system.skills)return;
  const items=system.parent?.items?.contents??[];
  const source=system.parent?.toObject?.(true)?.system?.skills??system.skills;
  const allocation=resolveSkillAllocation(system,items,source);
  if(!allocation.active)return;
  for(const skill of BASIC_SKILLS){
    const id=`core_${skill.id}`;
    system.skills[id]??=standardSkillEntry(skill);
    system.skills[id].dice=allocation.rows[skill.id].formula;
  }
}

/** Only changed paths are written; no full Actor skill dictionary replacement. */
export function skillAllocationPatch(system,state){
  const previous=copyState(system.skillAllocation), patch={};
  for(const [bucket,entries] of Object.entries(state))for(const [id,value] of Object.entries(entries))
    if(/^[a-zA-Z0-9_-]+$/.test(id)&&value!==previous[bucket]?.[id])patch[`system.skillAllocation.${bucket}.${id}`]=value;
  return patch;
}
export function skillDieEditPatch(system,items,skill,value){
  const patch=skillAllocationPatch(system,planSkillDie(system,items,skill,value));
  const id=`core_${skill}`;
  if(system.skills?.[id]?.dice)patch[`system.skills.${id}.dice`]='';
  return patch;
}
export function resetSkillDicePatch(system){
  const patch=skillAllocationPatch(system,clearSkillAllocation(system));
  for(const skill of BASIC_SKILLS){
    const id=`core_${skill.id}`;
    if(system.skills?.[id]?.dice)patch[`system.skills.${id}.dice`]='';
  }
  return patch;
}
