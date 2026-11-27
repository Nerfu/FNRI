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
const IN_POOL = '__pool__';
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

/** Remove persisted references to grants which no longer exist. Manual overrides
 * and specialization rows are independent of the grant pool. */
export function obsoleteSkillAllocationPatch(system,items=[]){
  const {dice,upgrades}=skillDiceSources(system,items);
  const byId=new Map(dice.map(d=>[d.id,d]));
  const byUpgrade=new Map(upgrades.map(u=>[u.id,u]));
  const state=copyState(system.skillAllocation),patch={};
  for(const id of Object.keys(state.assignments))
    if(!byId.has(id))patch[`system.skillAllocation.assignments.-=${id}`]=null;
  for(const [id,target] of Object.entries(state.upgrades))
    if(!byUpgrade.has(id)||target&&byId.get(target)?.size!==byUpgrade.get(id).size)
      patch[`system.skillAllocation.upgrades.-=${id}`]=null;
  return patch;
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
  for (const d of candidates) {
    const assignment = state.assignments[d.id];
    if (d.preferred && !d.locked &&
        (assignment === IN_POOL || ids.has(assignment) && assignment !== d.preferred)) d.displaced = true;
  }
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
  if(canMoveSkillDie(d)){
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

export function canMoveSkillDie(die) {
  return Boolean(die && !die.locked && (!die.preferred || die.displaced));
}

/** Edit the assignment of a specific die, leaving manual formulas intact.
 * The expected source and destination guard choices from an older render. */
export function skillPoolEditPatch(system, items, skill, {dieId, from, previous}) {
  const allocation = resolveSkillAllocation(system, items);
  const row = allocation.rows[skill];
  if (!row || row.die !== previous) return null;
  const replaced = allocation.dice.find(die => die.id === row.die);
  const moving = allocation.dice.find(die => die.id === dieId);
  if (replaced && !canMoveSkillDie(replaced)) return null;
  if (dieId !== null && (!canMoveSkillDie(moving) || moving.skill !== from || moving.skill === skill)) return null;

  const state = copyState(system.skillAllocation);
  // A displaced racial die explicitly returned to the pool stays there even
  // if its original skill has become vacant.
  if (replaced) state.assignments[replaced.id] = replaced.preferred ? IN_POOL : null;
  if (moving) state.assignments[moving.id] = skill;

  const next = resolveSkillAllocation({...system, skillAllocation: state}, items);
  if (moving && next.rows[skill].die !== moving.id) return null;
  return skillAllocationPatch(system, state);
}

/** A blank manual formula still overrides the assigned die. Null restores it. */
export function skillFormulaOverridePatch(system, skill, value) {
  if (!ids.has(skill)) return {};
  const state = copyState(system.skillAllocation);
  state.overrides[skill] = value === null ? null : String(value ?? '').trim();
  const patch = skillAllocationPatch(system, state);
  const id = `core_${skill}`;
  if (system.skills?.[id]?.dice) patch[`system.skills.${id}.dice`] = '';
  return patch;
}

export function resetSkillAssignmentsPatch(system) {
  const state = copyState(system.skillAllocation);
  for (const id of Object.keys(state.assignments)) state.assignments[id] = null;
  return skillAllocationPatch(system, state);
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

/** World configuration only; never consulted while preparing or rolling a skill. */
export const SKILL_MODES = Object.freeze(['strict','warning','free']);
export function skillAllocationMode(actor=null){
  if(actor?.type==='npc')return 'free';
  const mode=globalThis.game?.settings?.get?.('fast-nri-v14','skillAllocationMode');
  return SKILL_MODES.includes(mode)?mode:'strict';
}
export function registerSkillAllocationSettings(){
  game.settings.register('fast-nri-v14','skillAllocationMode',{
    name:'FASTNRI.SkillAllocation.mode',hint:'FASTNRI.SkillAllocation.modeHint',
    scope:'world',config:true,type:String,default:'strict',
    choices:Object.fromEntries(SKILL_MODES.map(mode=>[mode,`FASTNRI.SkillAllocation.mode_${mode}`])),
    onChange:()=>{for(const actor of game.actors??[])if(['character','npc'].includes(actor.type)&&actor.sheet?.rendered)actor.sheet.render();}
  });
}
export function skillDieAllows(die,skill){return !die.allowed||die.allowed.includes(skill);}
/** Deterministic choice among actually free grants. Never steals an assigned die. */
export function skillNominalChoices(allocation,skill,mode){
  const row=allocation.rows[skill];
  if(!row)return [];
  const current=allocation.dice.find(d=>d.id===row.die);
  if(current&&!canMoveSkillDie(current)&&mode!=='free')return [];
  const free=allocation.free.filter(canMoveSkillDie).sort((a,b)=>
    Number(skillDieAllows(b,skill))-Number(skillDieAllows(a,skill))||
    (a.allowed?.length??ids.size)-(b.allowed?.length??ids.size)||a.id.localeCompare(b.id));
  return ranks.flatMap(size=>{
    const die=free.find(d=>d.face===size&&(mode!=='strict'||skillDieAllows(d,skill)));
    if(die&&(!current||canMoveSkillDie(current)))return [{size,dieId:die.id,warning:mode==='warning'&&!skillDieAllows(die,skill)}];
    return mode==='free'?[{size,dieId:null,warning:false}]:[];
  });
}
/** Resolve again inside the existing write queue, so a stale UI cannot duplicate a grant. */
export function skillNominalEditPatch(system,items,skill,command,mode,previous){
  const allocation=resolveSkillAllocation(system,items),row=allocation.rows[skill];
  if(!row||row.die!==previous)return null;
  const current=allocation.dice.find(d=>d.id===row.die);
  if(command==='release'){
    if(current&&!canMoveSkillDie(current)){
      return mode==='free'?skillFormulaOverridePatch(system,skill,''):null;
    }
    const patch=skillPoolEditPatch(system,items,skill,{dieId:null,from:null,previous});
    if(!patch)return null;
    // A mode change never writes. An explicit removal clears the old formula.
    return {...patch,...skillFormulaOverridePatch(system,skill,null)};
  }
  const choice=skillNominalChoices(allocation,skill,mode).find(d=>d.size===Number(command));
  if(!choice)return null;
  if(!choice.dieId){
    const released=current&&canMoveSkillDie(current)?skillPoolEditPatch(system,items,skill,{dieId:null,from:null,previous}):{};
    if(!released)return null;
    return {...released,...skillFormulaOverridePatch(system,skill,formula(choice.size))};
  }
  const patch=skillPoolEditPatch(system,items,skill,{dieId:choice.dieId,from:null,previous});
  if(!patch)return null;
  return {...patch,...skillFormulaOverridePatch(system,skill,null)};
}
