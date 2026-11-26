/** Starting PC class data. Source: Fast NRI 7.0, Rulebook Part II and armour table.
 * These are defaults, not restrictions. A non-empty explicit base stat is a manual override.
 * No Actor migration, no world writes during preparation. */
const armor = Object.freeze({none:['Без брони',5,10,16],leather:['Кожаная',6,12,16],
  padded:['Стёганая',7,13,17],mail:['Кольчуга',7,15,19],plate:['Латы',11,16,22]});
const keys = ['partial','success','great'];
const defenses = ['awareness','reflex','fortitude','will'];
const resource = (id,name,current,max) => Object.freeze({id:`class_${id}`,name,current,max,kind:'class'});
const def = (name,hp,combatDie,speed,armorId,acBonus,protection,mandatorySkills,extra={}) => Object.freeze({
  name,hp,combatDie,speed,armorId,armorName:armor[armorId][0],acBonus,
  ac:Object.freeze(Object.fromEntries(keys.map((k,i)=>[k,armor[armorId][i+1]+acBonus]))),
  defenses:Object.freeze(Object.fromEntries(defenses.map((k,i)=>[k,protection[i]]))),
  mandatorySkills:Object.freeze(mandatorySkills), ...extra
});
const warlockAbility = id => `fnri7.rulebook.ability.warlock.${id}`;
export const WARLOCK_SPELL_IDS = Object.freeze(
  ['eldritch-blast', 'blade', 'shadow-shield', 'projection', 'drain', 'black-needles'].map(warlockAbility)
);
export const DOUBLE_INVOCATION_ID = warlockAbility('double-invocation');

export const CLASSES = Object.freeze({
  defender:def('Защитник',21,'d6',6,'plate',3,[10,8,14,10],['athletics']),
  warrior:def('Воин',21,'d10',7,'mail',3,[10,10,10,10],['athletics']),
  ranger:def('Егерь',18,'d8',8,'padded',3,[14,12,8,10],['survival'],{potionBonus:1}),
  rogue:def('Разбойник',18,'d6',9,'leather',5,[12,14,8,10],['stealth']),
  cleric:def('Клерик',19,'d6',6,'mail',0,[12,10,12,14],['religion'],{spellRange:4,spellEnergy:'divine',resource:resource('divine','Божественная сила',5,5)}),
  wizard:def('Волшебник',15,'d6',6,'none',3,[12,10,8,12],['arcana'],{spellRange:4,spellEnergy:'wizard',resource:resource('wizard','Волшебная сила',7,7)}),
  druid:def('Друид',19,'d8',7,'leather',3,[12,8,12,12],['nature'],{spellRange:4,spellEnergy:'life',resource:resource('life','Жизненная сила',5,5)}),
  bard:def('Бард',18,'d8',8,'padded',2,[10,10,10,12],['mysticism'],{spellRange:5,resource:resource('rhythm','Ритм',0,3)}),
  warlock:def('Колдун',19,'d6',6,'none',3,[10,10,10,12],[],{
    spellRange:8,traditions:Object.freeze(['arcana','mysticism','nature','religion']),resource:resource('magic','Магическая сила',4,4),
    abilityIds:Object.freeze([DOUBLE_INVOCATION_ID, ...WARLOCK_SPELL_IDS])}),
  fighter:def('Боец',22,'d8',7,'none',4,[12,12,12,12],['athletics','acrobatics'])
});
const normalize=v=>String(v??'').trim().toLocaleLowerCase('ru');
export const classNames=()=>Object.values(CLASSES).map(c=>c.name);
export function classDefinition(system){
  const name=normalize(system?.className);
  return Object.entries(CLASSES).find(([id,c])=>name===id||name===normalize(c.name))?.[1]??null;
}
export const actorClassDefinition=actor=>actor?.type==='character'?classDefinition(actor.system):null;
export function mandatoryClassSkills(system){
  const rule=classDefinition(system);
  if(!rule)return [];
  if(rule.traditions)return rule.traditions.includes(system.classTradition)?[system.classTradition]:[];
  return [...rule.mandatorySkills];
}
/** Called before initial ActiveEffect application. Null means calculated default.
 * Explicit raw values remain freely editable overrides, including zero. */
export function prepareSpellRangeBase(system){
  if(system.spellRange==null)system.spellRange=classDefinition(system)?.spellRange??3;
}
export function prepareClassBaseStats(system){
  const rule=classDefinition(system);
  prepareSpellRangeBase(system);
  if(!rule)return;
  if(system.hp && system.hp.max==null)system.hp.max=rule.hp;
  if(system.speed==null)system.speed=rule.speed;
  if(!String(system.combatDie??'').trim())system.combatDie=rule.combatDie;
  for(const group of ['ac','defenses'])for(const [key,value] of Object.entries(rule[group]))
    if(system[group] && system[group][key]==null)system[group][key]=value;
}
/** Plan one explicit class selection. Initialization occurs only if the value
 * is absent, never on render/prepare and never refills a spent resource. */
export function classSelectionUpdate(actor,name,{hpBonus=0}={}){
  const rule=classDefinition({className:name});
  const raw=actor.toObject?.(true)?.system??actor.system??{};
  return {'system.className':rule?.name??String(name??''),...classInitializationUpdate({...raw,className:name},{hpBonus})};
}

/** Only explicit creation/class selection: never writes or refills on preparation. */
export function classInitializationUpdate(raw,{hpBonus=0}={}){
  const rule=classDefinition(raw);
  const patch={};
  if(!rule)return patch;
  if(raw.level==null)patch['system.level']=1;
  if(raw.hp?.current==null)patch['system.hp.current']=(raw.hp?.max??rule.hp)+hpBonus;
  const r=rule.resource;
  if(r && !Object.hasOwn(raw.resources??{},r.id) && !Object.values(raw.resources??{}).some(row=>row.kind==='class'&&row.resourceKey===r.id || normalize(row.name)===normalize(r.name))){
    const {id,...row}=r;
    patch[`system.resources.${id}`]=row;
  }
  return patch;
}

/** Resolve the standard resource by its stable ID, with the same unique-name
 * path used for a manually created class resource. No creation on recovery. */
export function classResourceEntry(actor,rule=actorClassDefinition(actor)){
  const r=rule?.resource;
  if(actor?.type!=='character'||!r)return null;
  const rows=actor.system?.resources??{};
  const assigned=Object.entries(rows).filter(([id,row])=>id===r.id||row.resourceKey===r.id);
  if(assigned.length)return assigned.length===1&&assigned[0][1].kind==='class'?assigned[0]:null;
  const matches=Object.entries(rows).filter(([id,row])=>/^[A-Za-z0-9_-]{1,64}$/.test(id)&&
    (!row.kind||row.kind==='class')&&normalize(row.name)===normalize(r.name));
  return matches.length===1?matches[0]:null;
}
export function restResourceTarget(actor,id,row){
  if(actor?.type==='character'&&(id===CLASSES.bard.resource.id||
      (actorClassDefinition(actor)===CLASSES.bard&&classResourceEntry(actor,CLASSES.bard)?.[0]===id)))return 0;
  return row?.max;
}
export function combatStartResourceUpdate(actor){
  const rule=actorClassDefinition(actor);
  if(rule!==CLASSES.warlock&&rule!==CLASSES.bard)return {};
  const entry=classResourceEntry(actor,rule);
  if(!entry)return {};
  const [id,row]=entry;
  const target=rule===CLASSES.bard?0:row?.max;
  if(typeof target!=='number'||!Number.isFinite(target)||row?.current===target)return {};
  return {[`system.resources.${id}.current`]:target};
}
