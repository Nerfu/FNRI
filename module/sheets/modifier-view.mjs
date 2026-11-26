/** Read-only catalogue of known modifier sources. Never applies a second bonus. */
import {classDefinition,prepareClassBaseStats,prepareSpellRangeBase} from '../data/classes.mjs';
import {actorRoleDefinition} from '../data/roles.mjs';
import {racialPropertyRule,racialContentId} from '../data/racial-properties.mjs';
import {permanentRacialStats} from '../data/character-contributions.mjs';
import {equipmentDefensePreview} from '../equipment/item-properties.mjs';
import {isOffGuard,isSlowed,isFrightened,isWeakened} from '../effects/condition-calculations.mjs';
import {readEffectChangeRows} from '../effects/effect-formulas.mjs';
import {resolveSkillAllocation} from '../data/skill-allocation.mjs';
import {projectionBorrowedArmor,projectionArmorForActor} from '../projection/projection.mjs';
import {itemSlot} from '../equipment/equipment.mjs';
import {ruleComponents} from '../rolls/roll-contributions.mjs';
import {potionResource} from '../data/potion-resource.mjs';
import {BASIC_SKILLS_BY_ROW_ID} from '../data/skills-catalog.mjs';
const scope='fast-nri-v14';
const paths=['hp.max','speed','spellRange','combatDie','attackModifier',...['partial','success','great'].map(k=>'ac.'+k),...['awareness','reflex','fortitude','will'].map(k=>'defenses.'+k)];
const get=(o,p)=>p.split('.').reduce((x,k)=>x?.[k],o);
const show=v=>v===null||v===undefined||v===''?'—':String(v);
const signed=v=>typeof v==='number'&&v>0?`+${v}`:show(v);
export function modifierGroups(actor,t=k=>k){
  const raw=actor.toObject?.(true)?.system??actor.system??{}, effective=actor.system??{};
  const borrowed=projectionArmorForActor(actor);
  const base=JSON.parse(JSON.stringify(raw));
  const pc=actor.type==='character';
  if(pc)prepareClassBaseStats(base);
  else prepareSpellRangeBase(base);
  const role=actorRoleDefinition(actor)?.[1], cls=pc?classDefinition(raw):null;
  const items=actor.items?.contents??[], groups=new Map();
  const rollKinds=['skill','ability','attack','intervention','damage','maneuver','heal'];
  const label=p=>{
    const [g,k]=p.split('.');
    if(g==='skills')return BASIC_SKILLS_BY_ROW_ID.get(k)?.name??effective.skills?.[k]?.name??k;
    if(g==='resources')return (effective.resources?.[k]?.name??k)+' · '+t('Fields.'+(p.endsWith('.max')?'max':'current'));
    if(p.startsWith('contextual.'))return t('Fields.contextual')+' · '+t('ModifierView.rollKinds.'+k);
    if(p==='hp.current')return t('Fields.hpCurrent');
    if(p==='hp.temp')return t('Fields.hpTemp');
    if(p==='potionMax')return t('Potions.name');
    return (g==='ac'?t('Fields.acShort')+' · ':'')+t('Fields.'+(p==='hp.max'?'hpMax':k??g));
  };
  const group=p=>{if(!groups.has(p))groups.set(p,{name:label(p),total:show(p.startsWith('ac.')&&borrowed?get({ac:borrowed},p):get(effective,p)),sources:[]});return groups.get(p);};
  const add=(p,source,value,note)=>group(p).sources.push({source,value:show(value),note});
  for(const [k,v] of Object.entries(role?.defenses??{}))add('defenses.'+k,role.name,signed(v),t('ModifierView.permanent'));
  if(pc){
    const seen=new Set();
    for(const item of items){
      const data=item.system?.mechanics?.characterContributions,id=racialContentId(item)||item.id;
      if(!racialPropertyRule(item)||!data||seen.has(id))continue;
      seen.add(id);
      for(const [k,p] of [['hpMax','hp.max'],['speed','speed']])if(Number.isFinite(data[k])&&data[k])add(p,item.name,signed(data[k]),t('ModifierView.permanent'));
      for(const g of ['ac','defenses'])for(const [k,v] of Object.entries(data[g]??{}))if(Number.isFinite(v)&&v)add(g+'.'+k,item.name,signed(v),t('ModifierView.permanent'));
      if(data.heldShieldAc)for(const k of ['partial','success','great'])add('ac.'+k,item.name,signed(data.heldShieldAc),t('ModifierView.heldShield'));
    }
    const preview=equipmentDefensePreview(actor,{shieldBonus:permanentRacialStats(actor).heldShieldAc});
    for(const item of preview.protectiveItems){
      const authored=items.find(i=>i.uuid&&i.uuid===item.itemUuid)?.system?.mechanics?.protection?.acBonus;
      for(const k of ['partial','success','great'])add('ac.'+k,item.name,signed(Number.isFinite(authored)?authored:item.bonus),t(item.bonus===preview.protection&&preview.protection>0?'ModifierView.nonstack':'ModifierView.notSelected'));
    }
  }
  const casterAc=!pc?projectionBorrowedArmor(actor):null;
  if(casterAc)for(const k of ['partial','success','great'])add('ac.'+k,t('ModifierView.projection'),casterAc[k],t('ModifierView.replacement'));
  if(isOffGuard(actor))for(const p of paths.filter(p=>(p.startsWith('ac.')||p.startsWith('defenses.'))&&Number.isFinite(p.startsWith('ac.')&&borrowed?get({ac:borrowed},p):get(effective,p))))add(p,t('ModifierView.offGuard'),'-2',t('ModifierView.once'));
  const contextual=(rows,source,active=true)=>{
    for(const row of Array.isArray(rows)?rows:[]){
      if(!row||typeof row!=='object')continue;
      for(const kind of rollKinds){
        const parts=ruleComponents([{...row,label:row.label||source||t('Fields.contextual')}],{kind,skillId:row.skillId,defenseStat:row.defenseStat});
        for(const part of parts){
          const p=row.skillId?'skills.'+row.skillId:row.defenseStat?'defenses.'+row.defenseStat:'contextual.'+kind;
          const value=part.kind==='replacement'?`${part.from} → ${part.to}`:signed(part.value);
          const note=[t(active?'ModifierView.situational':'ModifierView.inactive'),t('ModifierView.rollKinds.'+kind)].join(' · ');
          add(p,source,value,note);
        }
      }
    }
  };
  contextual(role?.rollContributions,role?.name);
  for(const item of items){
    contextual(item.system?.mechanics?.rollContributions,item.name);
    const tool=item.system?.mechanics?.tool;
    if(tool?.chosenSkillId&&tool.dice)add('skills.'+tool.chosenSkillId,item.name,tool.dice,t('ModifierView.situational'));
    if(item.type==='ability'&&(item.system?.mechanics?.combatDieUpgrade===true||racialContentId(item)==='fnri7.rulebook.racial.master-boia'))add('combatDie',item.name,'↑ 1',t('ModifierView.situational'));
    const spell=item.system?.mechanics?.spell;
    if(item.type==='gear'&&spell?.stack==='highest'&&Number.isFinite(spell.rangeBonus)&&spell.rangeBonus>0){
      const held=itemSlot(item.id,effective)?.kind==='hand';
      const proficient=!spell.requiresProficiency||spell.proficiencyClasses?.includes(cls?.name??effective.className);
      add('spellRange',item.name,signed(spell.rangeBonus),t(held&&proficient?'ModifierView.focus':'ModifierView.inactive'));
    }
  }
  if(pc&&cls?.potionBonus){add('potionMax',cls.name,signed(cls.potionBonus),t('ModifierView.permanent'));}
  if(pc){const stable=items.find(i=>i.type==='ability'&&(i.getFlag?.(scope,'contentId')??i.flags?.[scope]?.contentId)==='fnri7.rulebook.racial.ustoichivyi');if(stable)add('potionMax',stable.name,'+1',t('ModifierView.permanent'));}
  if(groups.has('potionMax')||pc&&Number.isSafeInteger(raw.potionsBaseMax)){const g=group('potionMax');g.total=show(potionResource(actor).max);g.sources.unshift({source:t(Number.isSafeInteger(raw.potionsBaseMax)?'ModifierView.manual':'ModifierView.base'),value:show(raw.potionsBaseMax??3),note:t('ModifierView.base')});}
  if(pc){
    const allocation=resolveSkillAllocation(raw,items);
    if(allocation.active){
      for(const [skill,row] of Object.entries(allocation.rows))if(row.override!==null)add('skills.core_'+skill,t('ModifierView.manual'),row.formula,t('ModifierView.permanent'));
      for(const die of allocation.dice){
      if(!die.skill)continue;
      const p='skills.core_'+die.skill;
      if(allocation.rows[die.skill]?.override!==null)continue;
      add(p,die.source,`d${die.size}`,t('ModifierView.permanent'));
      for(const upgrade of allocation.upgrades.filter(u=>u.target===die.id))add(p,upgrade.source,`d${die.size} → d${die.face}`,t('ModifierView.permanent'));
      }
    }
  }
  for(const [id,row] of Object.entries(effective.skills??{})){
    const manual=raw.skills?.[id]?.modifier;
    const rawDice=raw.skills?.[id]?.dice;
    if(rawDice&&!groups.get('skills.'+id)?.sources.some(r=>r.source===t('ModifierView.manual')&&r.note===t('ModifierView.permanent')))add('skills.'+id,t('ModifierView.manual'),rawDice,t('ModifierView.base'));
    if(Number.isFinite(manual)&&manual)add('skills.'+id,t('ModifierView.manual'),signed(manual),'');
  }
  for(const effect of (typeof actor.allApplicableEffects==='function'?actor.allApplicableEffects():actor.effects?.contents??[])){
    const active=effect.active!==false&&!effect.disabled&&!effect.isSuppressed&&effect.duration?.expired!==true&&effect.flags?.[scope]?.effectState?.strength!==0;
    for(const row of readEffectChangeRows(effect))if(row.key.startsWith('system.'))add(row.key.slice(7),effect.name,`${row.type}: ${row.appliedValue}`,t(active?'ModifierView.active':'ModifierView.inactive'));
    contextual(effect.flags?.[scope]?.rollContributions,effect.name,active);
    const influence=effect.flags?.[scope]?.rollInfluence;
    if(influence){
      const {kinds,skillId,defenseStat,modifier,replace}=influence;
      contextual([{kinds,skillId,defenseStat,kind:'modifier',value:modifier},{kinds,skillId,defenseStat,kind:'replacement',...replace}],effect.name,active);
    }
  }
  if(Number.isFinite(effective.speed)&&isSlowed(actor))add('speed',t('ModifierView.slowed'),'÷ 2',t('ModifierView.once'));
  if(isFrightened(actor))add('contextual.d20Check',t('ModifierView.frightened'),'-2',t('ModifierView.frightenedScope'));
  if(isWeakened(actor))add('contextual.damage',t('ModifierView.weakened'),'-2',t('ModifierView.weakenedScope'));
  for(const p of paths){
    const b=get(base,p),e=get(effective,p);
    if(b!==e&&!groups.get(p)?.sources.length)add(p,t('ModifierView.unknown'),show(e),'');
    if(!groups.has(p)||b==null||b==='')continue;
    const rawValue=get(raw,p),fromClass=cls&&(rawValue==null||rawValue==='');
    groups.get(p).sources.unshift({source:fromClass?cls.name:t('ModifierView.base'),value:show(b),note:t(fromClass?'ModifierView.classBase':'ModifierView.base')});
  }
  for(const [p,g] of groups)if(p.startsWith('skills.')&&p.split('.').length===2){const id=p.split('.')[1],row=effective.skills?.[id];g.total=row?[row.dice,row.modifier?signed(row.modifier):''].filter(Boolean).join('')||'—':'—';}
  // Preserve separate grouping of native skill field changes, but never render an object as a numeric total.
  for(const [p,g] of groups)if(p.startsWith('skills.')&&p.split('.').length>2)g.name+=' · '+t('Fields.'+(p.endsWith('.modifier')?'checkModifier':'dice'));
  for(const [p,g] of groups)if(p.startsWith('contextual.'))g.total='—';
  return [...groups.values()];
}
