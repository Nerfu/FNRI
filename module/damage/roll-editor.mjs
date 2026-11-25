/** GM-only native chat context command. All corrections live in flags;
 * original Roll and already applied HP are NEVER changed.
 */
import {changePart,appendDamageComponents,calculateDamage,criticalDamageRule,copy} from './damage-core.mjs';
import {messageIntervention} from '../rolls/attack-properties.mjs';
import {refreshDamageMessage} from './damage-chat.mjs';
const ID='fast-nri-v14';
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const l=key=>game.i18n.localize(`FASTNRI.Damage.${key}`);
const own=msg=>!!globalThis.game?.user?.isGM && !!msg && msg.visible!==false && msg.isContentVisible!==false && (msg.canUserModify?.(game.user,'update')!==false);
const get=(msg,key)=>msg?.getFlag?.(ID,key) ?? msg?.flags?.[ID]?.[key];
const num=v=>Number(v);
export function editableMessage(msg) {
  return Boolean(msg && (get(msg,'weaponDamage')?.version===2 || Array.isArray(get(msg,'rollEdit')?.components) || msg.rolls?.some(r=>Number.isFinite(r.total))));
}

/** The evaluated Roll retains its arithmetic terms in Foundry 14. For
 * additive expressions, track a minus operator through ParentheticalTerms:
 * excluding/rerolling a negative die must INCREASE the corrected total, not
 * subtract its face value a second time. This never mutates the source Roll.
 * Non-additive expressions retain the original correction semantics until
 * their individual-die coefficients can be established without guessing.
 */
function additiveDieCoefficients(roll) {
  if (!Array.isArray(roll?.terms)) return null;
  const weights=new Map();
  const visit=(terms,outer=1)=>{
    let operator='+';
    for (const term of terms) {
      if (typeof term?.operator==='string') {
        if (!['+','-'].includes(term.operator)) return false;
        operator=term.operator;
        continue;
      }
      const factor=operator==='-'?-outer:outer;
      operator='+';
      if (Number.isInteger(term?.faces) && Array.isArray(term?.results)) {
        weights.set(term,factor);
      } else if (Array.isArray(term?.roll?.terms)) {
        if (!visit(term.roll.terms,factor)) return false;
      } else if ((term?.dice?.length??0)>0) {
        return false;
      }
    }
    return true;
  };
  if (!visit(roll.terms) || (roll.dice??[]).some(d=>!weights.has(d))) return null;
  return weights;
}

export function rollSnapshot(msg) {
  const roll=msg.rolls?.[0];
  if (!roll || !Number.isFinite(roll.total)) throw new Error('Original Roll is unavailable');
  const weights=additiveDieCoefficients(roll);
  let i=0;
  const pieces=(roll.dice??[]).flatMap(d=>(d.results??[])
    .filter(r=>r.active!==false).map(r=>({id:`die-${++i}`,kind:'die',faces:d.faces,
      original:r.result,value:r.result,excluded:false,formula:`1d${d.faces}`,
      coefficient:weights?.get(d)??1})));
  const fixed=(get(msg,'fixedRollComponents')??[]).filter(p=>p?.kind==='fixed' && Number.isFinite(p.value))
    .map((p,i)=>({...p,id:`fixed-${i}`,original:Number(p.original),value:Number(p.value),excluded:false}));
  return {version:1,originalTotal:roll.total,components:[...pieces,...fixed],offset:0,
    currentTotal:roll.total,manualTotalOnly:!!roll.terms?.length && !weights,history:[]};
}
export function computedRollTotal(state) {
  return state.originalTotal + (state.offset??0) + state.components.reduce((sum,p)=>
    sum + (state.manualTotalOnly&&!p.added?0:((p.excluded?0:p.value)-p.original) * (p.coefficient===-1?-1:1)),0);
}
export async function applyRollCorrection(msg,{partId,action,value}={}) {
  if (!own(msg) || !editableMessage(msg)) throw new Error('Only GM may edit system rolls');
  const card=get(msg,'weaponDamage');
  if (card?.version===2) {
    const before=copy(card);
    let next,old,current;
    if(partId.startsWith('adjustment:')) {
      const key=partId.slice('adjustment:'.length);
      if(!['penalty','resistance','vulnerability'].includes(key)||action!=='set'||!Number.isFinite(value)||value<0)
        throw new Error('Invalid damage adjustment');
      next=copy(card);old=next.adjustments?.[key]??0;
      next.adjustments??={};next.adjustments[key]=value;current=value;
    } else ({next,old,current}=changePart(card,partId,action,value));
    next.history=[...(next.history??[]),{by:game.user.id,at:Date.now(),action,
      id:partId,before:old,after:current}];
    next.revision=(next.revision??0)+1;
    await msg.update({[`flags.${ID}.weaponDamage`]:next});
    return {previous:calculateDamage(before),current:calculateDamage(next)};
  }
  const state=copy(get(msg,'rollEdit') ?? rollSnapshot(msg));
  if (partId==='offset') {
    if(action!=='set'||!Number.isFinite(value)) throw new Error('Invalid total correction');
    const old=state.offset??0;state.offset=value;
    state.history.push({by:game.user.id,at:Date.now(),action,id:'offset',before:old,after:value});
  } else {
    const part=state.components.find(p=>p.id===partId);
    if(!part)throw new Error('Missing roll component');
    const old={value:part.value,excluded:!!part.excluded};
    if(action==='exclude')part.excluded=true;
    else if(action==='restore')part.excluded=false;
    else if(action==='reset') {part.value=part.added?part.initial:part.original;part.excluded=false;}
    else if(action==='set'||action==='reroll') {
      if(!Number.isFinite(value)|| (action==='set' && part.kind==='die' && !Number.isInteger(value)) ||
        (action==='reroll' && (part.kind!=='die'||!Number.isInteger(value)||value<1||value>part.faces)))throw new Error('Invalid roll value');
      part.value=action==='set' && part.kind==='die' ? Math.max(1,value) : value;
    } else throw new Error('Unknown roll correction');
    state.history.push({by:game.user.id,at:Date.now(),action,id:partId,before:old,
      after:{value:part.value,excluded:!!part.excluded}});
  }
  state.currentTotal=computedRollTotal(state);
  await msg.update({[`flags.${ID}.rollEdit`]:state});
  return state;
}

/** Add a die batch or one fixed contribution to a version-2 damage message.
 * The operation is GM-only and uses exactly one flag update with an audit entry.
 */
export async function addDamageToMessage(msg,{kind,faces,count=1,value=0,damageType='',traits=[]}={}) {
  if(!own(msg) || !editableMessage(msg))throw new Error('Only GM may edit system rolls');
  const card=get(msg,'weaponDamage');
  if(card?.version!==2) {
    const state=copy(get(msg,'rollEdit')??rollSnapshot(msg));
    if(kind==='die' && (!Number.isInteger(faces)||faces<2||faces>1000||!Number.isInteger(count)||count<1||count>1000))throw Error('Invalid dice addition');
    if(!['die','fixed'].includes(kind)||kind==='fixed'&&!Number.isFinite(value))throw Error('Invalid addition');
    const roll=kind==='die'?await new Roll(`${count}d${faces}`).evaluate():null;
    const values=roll?(roll.dice??[]).flatMap(d=>d.results.filter(r=>r.active!==false).map(r=>r.result)):[value];
    if(roll&&(values.length!==count||values.some(v=>!Number.isInteger(v)||v<1||v>faces)))throw Error('Invalid dice results');
    const latest=copy(get(msg,'rollEdit')??rollSnapshot(msg));
    const occupied=new Set(latest.components.map(p=>p.id));let n=1;
    const added=values.map(v=>{while(occupied.has(`added-${n}`))n++;const id=`added-${n++}`;occupied.add(id);return {id,kind,faces,formula:kind==='die'?`1d${faces}`:String(v),original:0,initial:v,value:v,added:true,excluded:false,damageType,traits:[...traits]};});
    if(!own(msg))throw Error('Only GM may edit system rolls');
    latest.components.push(...added);latest.history.push({by:game.user.id,at:Date.now(),action:'add',ids:added.map(p=>p.id)});latest.currentTotal=computedRollTotal(latest);
    await msg.update({[`flags.${ID}.rollEdit`]:latest});return {added,after:latest.currentTotal};
  }
  // Newly added dice are deliberately pending, not rolled on creation.
  // They have no numerical contribution until resolved by a real Roll.
  if(kind==='die' && (!Number.isInteger(faces)||faces<2||faces>1000||
    !Number.isInteger(count)||count<1||count>1000))throw new Error('Invalid dice addition');
  const values=[];
  const {next,appended}=appendDamageComponents(card,{kind,faces,count,values,value,damageType,traits});
  next.history=[...(next.history??[]),{by:game.user.id,at:Date.now(),action:'add',
    ids:appended.map(p=>p.id),components:copy(appended)}];
  next.revision=(next.revision??0)+1;
  await msg.update({[`flags.${ID}.weaponDamage`]:next});
  refreshDamageMessage(msg);
  return {added:appended,after:calculateDamage(next)};
}

/** The editor keeps selection in memory, but pending dice live in chat flags.
 * A whole selection is evaluated in ONE Foundry Roll and committed in ONE update.
 * Mapping is by stable component ID, never by filtered page position.
 */
export function pendingDiceIds(card) {
  return (card?.parts??[]).filter(p=>p.kind==='die' && p.pending).map(p=>p.id);
}

export async function rollMarkedDice(msg,partIds) {
  if(!own(msg)||!editableMessage(msg))throw Error('Only GM may edit system rolls');
  const card=get(msg,'weaponDamage');
  if(card?.version!==2)throw Error('Batch dice are only supported on damage cards');
  const selected=new Set(partIds??[]);
  const marked=card.parts.filter(p=>selected.has(p.id) && p.kind==='die');
  if(!marked.length)throw Error(l('selectDiceFirst'));
  if(marked.some(p=>!Number.isInteger(p.faces)||p.faces<1))throw Error('Invalid die faces');
  // A Roll is asynchronous. Capture the selected dice's initial state, then
  // merge the results into CURRENT flags, never a stale full damage card.
  const originalDice=marked.map(p=>({id:p.id,kind:p.kind,faces:p.faces,
    value:p.value,original:p.original,pending:!!p.pending,
    excluded:!!p.excluded,immune:!!p.immune}));
  // Adjacent terms of the same size are grouped to keep enormous formulas compact.
  const groups=[];
  for(const part of marked) {
    const last=groups.at(-1);
    if(last?.faces===part.faces)last.count++;
    else groups.push({faces:part.faces,count:1});
  }
  const roll=new Roll(groups.map(g=>`${g.count}d${g.faces}`).join(' + '));
  await roll.evaluate();
  const actual=(roll.dice??[]).flatMap(d=>(d.results??[])
    .filter(x=>x.active!==false).map(x=>({faces:d.faces,value:x.result})));
  if(actual.length!==marked.length || actual.some((v,i)=>v.faces!==originalDice[i].faces ||
    !Number.isInteger(v.value)||v.value<1||v.value>v.faces))throw Error('Invalid batch roll results');
  const currentCard=get(msg,'weaponDamage');
  if(!own(msg) || currentCard?.version!==2 || !Array.isArray(currentCard.parts))
    throw Error(l('error'));
  const latestById=new Map(currentCard.parts.map(p=>[p.id,p]));
  // If one of these exact dice changed during evaluation, do not overwrite it
  // with an outdated roll. Unrelated edits are retained in the latest card.
  const unchanged=originalDice.every(before=>{
    const now=latestById.get(before.id);
    return now?.kind===before.kind && now.faces===before.faces &&
      now.value===before.value && now.original===before.original &&
      !!now.pending===before.pending && !!now.excluded===before.excluded &&
      !!now.immune===before.immune;
  });
  if(!unchanged) throw Error(l('error'));
  const next=copy(currentCard),byId=new Map(originalDice.map((p,i)=>[p.id,actual[i].value]));
  const changes=[];
  for(const part of next.parts) {
    if(!byId.has(part.id))continue;
    // Record the initial value too: resolving a pending die establishes its
    // original result, whereas an ordinary reroll must leave it untouched.
    const before={original:part.original,value:part.value,pending:!!part.pending,excluded:!!part.excluded};
    part.value=byId.get(part.id);
    if(part.pending)part.original=part.value;
    part.pending=false;part.excluded=false;
    changes.push({id:part.id,before,after:{original:part.original,value:part.value,pending:false,excluded:false}});
  }
  next.history=[...(next.history??[]),{by:game.user.id,at:Date.now(),action:'rerollBatch',changes}];
  next.revision=(next.revision??0)+1;
  await msg.update({[`flags.${ID}.weaponDamage`]:next});
  refreshDamageMessage(msg);
  return {count:changes.length,roll,changes,after:calculateDamage(next)};
}

/** Exclude or restore selected parts, or all parts when no selection exists. */
export async function setBulkExcluded(msg,partIds=[],excluded=true) {
  if(!own(msg)||!editableMessage(msg))throw Error('Only GM may edit system rolls');
  const card=get(msg,'weaponDamage');
  if(card?.version!==2)throw Error('Bulk edit is only supported on damage cards');
  const selection=new Set(partIds);
  const next=copy(card),changed=[],changes=[];
  for(const p of next.parts) {
    if(selection.size && !selection.has(p.id))continue;
    if(!!p.excluded===excluded)continue;
    const before={excluded:!!p.excluded};
    p.excluded=excluded;changed.push(p.id);
    // Preserve the old `ids` shape and enrich the same audit entry with the
    // exact state transition; no extra log or snapshot is created.
    changes.push({id:p.id,before,after:{excluded:!!p.excluded}});
  }
  if(changed.length) {
    next.history=[...(next.history??[]),{by:game.user.id,at:Date.now(),
      action:excluded?'excludeBatch':'restoreBatch',ids:changed,changes}];
    next.revision=(next.revision??0)+1;
    await msg.update({[`flags.${ID}.weaponDamage`]:next});
    refreshDamageMessage(msg);
  }
  return {count:changed.length};
}

/** Remove only unresolved additions. Existing rolled dice are never deleted. */
export async function discardPendingDice(msg) {
  if(!own(msg)||!editableMessage(msg))throw Error('Only GM may edit system rolls');
  const card=get(msg,'weaponDamage');
  if(card?.version!==2)throw Error('Pending dice are only supported on damage cards');
  const next=copy(card),ids=pendingDiceIds(next);
  if(!ids.length)return {count:0};
  const toRemove=new Set(ids);
  next.parts=next.parts.filter(p=>!toRemove.has(p.id));
  next.history=[...(next.history??[]),{by:game.user.id,at:Date.now(),action:'discardPending',ids}];
  next.revision=(next.revision??0)+1;
  await msg.update({[`flags.${ID}.weaponDamage`]:next});
  refreshDamageMessage(msg);
  return {count:ids.length};
}

/** On explicit close, all remaining unrolled dice must be resolved or removed. */
export async function resolvePendingOnClose(msg,dialog=foundry.applications.api.DialogV2) {
  const ids=pendingDiceIds(get(msg,'weaponDamage'));
  if(!ids.length)return true;
  const choice=await dialog.wait({window:{title:l('unrolledDice')},modal:true,
    content:`<p>${esc(l('unrolledDice'))}: ${ids.length}</p>`,
    buttons:[{action:'roll',label:l('rollUnrolled')},
      {action:'discard',label:l('discardUnrolled')},
      {action:'cancel',label:l('editorCancel')}],rejectClose:false});
  if(choice==='roll')await rollMarkedDice(msg,ids);
  else if(choice==='discard')await discardPendingDice(msg);
  else return false;
  return true;
}

/** Only an upwards manual override needs GM confirmation. */
export function isOutOfRangeDieValue(part,value) {
  return part?.kind==='die' && Number.isFinite(value) && value>part.faces;
}

/** Override only the concrete chat result, not its source Item or original Roll. */
export async function setMessageIntervention(msg,enabled) {
  if (!own(msg) || !editableMessage(msg) || typeof enabled!=='boolean')
    throw new Error('Only GM may change intervention state');
  const before=messageIntervention(msg);
  if(before===enabled)return false;
  const history=[...(get(msg,'interventionHistory')??[]),{by:game.user.id,at:Date.now(),before,after:enabled}];
  await msg.update({[`flags.${ID}.interventionOverride`]:enabled,
    [`flags.${ID}.interventionHistory`]:history});
  refreshDamageMessage(msg);
  return true;
}

/** Manual critical override changes only this damage result, never the attack Roll. */
export async function setMessageCritical(msg,mode='auto',multiplier=2) {
  if(!own(msg)) throw new Error('Only GM may change critical damage');
  const card=get(msg,'weaponDamage');
  if(card?.version!==2 || !['auto','true','false'].includes(mode))
    throw new Error('Unsupported critical edit');
  if(card.noCritical===true)return false;
  if(mode==='true' && (!Number.isFinite(multiplier) || multiplier<=1))
    throw new Error('Invalid critical multiplier');
  const next=copy(card);
  const previous={enabled:next.manualCritical??null,multiplier:next.manualCritMultiplier??null};
  next.manualCritical=mode==='auto'?null:mode==='true';
  if(mode==='true')next.manualCritMultiplier=multiplier;
  const current={enabled:next.manualCritical,multiplier:next.manualCritMultiplier??null};
  if(previous.enabled===current.enabled && previous.multiplier===current.multiplier)return false;
  next.history=[...(next.history??[]),{by:game.user.id,at:Date.now(),action:'critical',before:previous,after:current}];
  next.revision=(next.revision??0)+1;
  await msg.update({[`flags.${ID}.weaponDamage`]:next});
  refreshDamageMessage(msg);
  return true;
}

export function getEditorParts(msg) {
  const card=get(msg,'weaponDamage');
  if(card?.version===2)return card.parts;
  return (get(msg,'rollEdit') ?? rollSnapshot(msg)).components;
}

/** A real Foundry Roll, followed by one flag update. Never mutate the source Roll. */
export async function executeRollEditorAction(msg,{partId,action,value}={}) {
  if (!own(msg) || !editableMessage(msg)) throw new Error('Only GM may edit system rolls');
  if (action !== 'reroll') {
    await applyRollCorrection(msg,{partId,action,value});
    return {action,partId};
  }
  const part=getEditorParts(msg).find(p=>p.id===partId);
  if (!part || part.kind !== 'die' || !Number.isInteger(part.faces) || part.faces < 1)
    throw new Error(l('notADie'));
  // A single reroll also awaits Roll.evaluate(). Record the exact die's
  // current state, and refuse a stale write if it was edited in the meantime.
  // Unrelated edits are retained because applyRollCorrection reads the latest flags.
  const before=part.value;
  const originalPart={kind:part.kind,faces:part.faces,original:part.original,coefficient:part.coefficient,
    value:part.value,pending:!!part.pending,excluded:!!part.excluded,immune:!!part.immune};
  const roll=await new Roll(`1d${part.faces}`).evaluate();
  const current=roll?.total;
  if (!Number.isInteger(current) || current < 1 || current > part.faces)
    throw new Error('Invalid new dice result');
  const latest=getEditorParts(msg).find(p=>p.id===partId);
  if(!latest || Object.entries(originalPart).some(([key,val])=>
    (['pending','excluded','immune'].includes(key)?!!latest[key]:latest[key])!==val))
    throw new Error(l('error'));
  await applyRollCorrection(msg,{partId,action,value:current});
  return {action,partId,before,current};
}

/** One button per action. Numbers are entered only after Set is clicked;
 * checkboxes apply only to this chat message, never to its source card.
 */
export function criticalCheckboxState(msg) {
  const card=get(msg,'weaponDamage');
  if(card?.version!==2)return null;
  if(card.noCritical===true)return false;
  return card.manualCritical===null || card.manualCritical===undefined
    ? criticalDamageRule(card).triggered : !!card.manualCritical;
}

/** Draw only 20 independent dice components at a time. The original part indexes
 * are used in every action, so pagination and search never change target IDs.
 */
export const ROLL_EDITOR_PAGE_SIZE=20;
/** Component metadata already belongs to the damage snapshot. Search is read-only;
 * never change component IDs or invent damage types for ordinary checks. */
export function editorPartTraits(part) {
  const raw=part?.traits ?? part?.properties ?? [];
  return (Array.isArray(raw)?raw:String(raw).split(/[,;]+/))
    .map(value=>String(value??'').trim()).filter(Boolean);
}
export function rollEditorPage(parts,{page=0,query=''}={}) {
  const needle=String(query??'').trim().toLocaleLowerCase();
  const numeric=/^#?(\d+)$/.exec(needle);
  const filtered=parts.map((part,index)=>({part,index})).filter(({part,index})=>
    !needle || (numeric?index+1===Number(numeric[1]):
      [part.formula,part.id,part.kind,part.damageType,...editorPartTraits(part)]
        .some(v=>String(v??'').toLocaleLowerCase().includes(needle))));
  const pages=Math.max(1,Math.ceil(filtered.length/ROLL_EDITOR_PAGE_SIZE));
  const currentPage=Math.max(0,Math.min(pages-1,Number.isSafeInteger(page)?page:0));
  return {items:filtered.slice(currentPage*ROLL_EDITOR_PAGE_SIZE,(currentPage+1)*ROLL_EDITOR_PAGE_SIZE),
    count:filtered.length,pages,page:currentPage};
}

export function renderRollEditorContent(msg,{feedback='',page=0,query='',interventionDraft,criticalDraft,selectedIds}={}) {
  const card=get(msg,'weaponDamage');
  const isDamage=card?.version===2;
  const parts=getEditorParts(msg);
  const selected=new Set(selectedIds===undefined?parts.filter(p=>p.pending).map(p=>p.id):selectedIds);
  const heading=isDamage?calculateDamage(card).total:(get(msg,'rollEdit')?.currentTotal ?? msg.rolls?.[0]?.total);
  const excludedLabel=l('excludedState');
  const initial=l('initialValue');
  // Carry the immutable component ID on its existing action button. Search
  // refreshes may rebuild the list while another client changes the message:
  // a row index is presentation only and is not a safe document identifier.
  const button=(op,label,partId=null)=>`<button type="button" class="fnri-editor-action" data-fnri-editor-op="${esc(op)}"`+
    (partId!==null?` data-fnri-editor-target-id="${esc(partId)}"`:'')+`>${esc(label)}</button>`;
  const listing=rollEditorPage(parts,{page,query});
  const operations=listing.items.map(({part:p,index:i})=>{
    const excluded=!!p.excluded;
    const number=p.pending?l('unrolledDie'):Number(p.value);
    const partTitle=p.formula??p.id;
    const metadata=[p.damageType,...editorPartTraits(p)].filter(Boolean);
    const metadataLabel=metadata.length?` · ${metadata.map(esc).join(' · ')}`:'';
    const old=!p.pending && number!==p.original?` · ${initial}: ${p.original}`:'';
    const title=`#${i+1} · ${esc(partTitle)}: ${esc(number)}${metadataLabel}${excluded?` · ${esc(excludedLabel)}`:''}${esc(old)}`;
    return `<div class="fnri-editor-part-row${excluded?' fnri-editor-part-excluded':''}${p.pending?' fnri-editor-part-pending':''}">`+
      `<div class="fnri-editor-part-line"><label class="fnri-editor-part-pick">`+
      `<input type="checkbox" data-fnri-editor-select="${esc(p.id)}" ${selected.has(p.id)?'checked':''} `+
      `aria-label="${esc(l('selectComponent'))} #${i+1}"></label>`+
      `<div class="fnri-editor-part-heading">${title}</div></div>`+
      `<div class="fnri-editor-actions">`+
      (p.kind==='die'&&!p.pending?button(`reroll:${i}`,l('reroll'),p.id):'')+
      button(`${excluded?'restore':'exclude'}:${i}`,l(excluded?'restore':'exclude'),p.id)+
      (!p.pending&&(excluded || number!==p.original)?button(`reset:${i}`,l('resetOriginal'),p.id):'')+
      (!p.pending?button(`set:${i}`,l('set'),p.id):'')+
      `</div></div>`;
  }).join('');
  const selectedParts=parts.filter(p=>selected.has(p.id));
  const selectedDice=selectedParts.filter(p=>p.kind==='die').length;
  const selectionLabel=selected.size?`${l('selectedCount')}: ${selected.size}`:l('allComponents');
  const bulk=isDamage?`<div class="fnri-editor-bulk" aria-live="polite">`+
    `<div class="fnri-editor-bulk-info">${esc(selectionLabel)}</div>`+
    `<div class="fnri-editor-bulk-buttons">`+
    button('rerollMarked',`${l('rerollMarked')} (${selectedDice})`)+
    button('excludeBulk',selected.size?l('excludeMarked'):l('excludeAll'))+
    button('restoreBulk',selected.size?l('restoreMarked'):l('restoreAll'))+
    `</div></div>`:'';
  const adjustments=isDamage?['penalty','resistance','vulnerability'].map(k=>{
    const amount=Number(card.adjustments?.[k]??0);
    return `<div class="fnri-editor-adjust-row"><span>${esc(l(k))}: ${esc(amount)}</span>`+
      button(`adjustment:${k}`,l('set'))+`</div>`;
  }).join(''):'';
  const offset=!isDamage?`${(get(msg,'rollEdit')??rollSnapshot(msg)).manualTotalOnly?`<p>${esc(l('manualFormulaCorrection'))}</p>`:''}<div class="fnri-editor-adjust-row"><span>${esc(l('totalCorrection'))}: `+
    `${esc(get(msg,'rollEdit')?.offset??0)}</span>${button('offset',l('set'))}</div>`:'';
  const interventionState=typeof interventionDraft==='boolean'?interventionDraft:messageIntervention(msg);
  const criticalState=typeof criticalDraft==='boolean'?criticalDraft:criticalCheckboxState(msg);
  const critical=isDamage&&card.noCritical!==true?`<label class="fnri-editor-boolean-toggle">`+
    `<input type="hidden" name="criticalPresent" value="1">`+
    `<input type="checkbox" name="critical" value="true" ${criticalState?'checked':''}>`+
    `${esc(l('criticalToggle'))}</label>`:'';
  return `<div class="fnri-roll-editor"><strong>${esc(l('total'))}: ${esc(heading)}</strong>`+
    `<fieldset class="fnri-editor-section"><legend>${esc(l('rollProperties'))}</legend>`+
    `<input type="hidden" name="interventionPresent" value="1">`+
    `<label class="fnri-editor-boolean-toggle"><input type="checkbox" name="intervention" value="true" `+
    `${interventionState?'checked':''}> ${esc(l('interventionProperty'))}</label>`+
    critical+
    `<small>${esc(l('interventionHint'))}</small></fieldset>`+
    `<fieldset class="fnri-editor-section fnri-editor-components"><legend>${esc(l('component'))} (${parts.length})</legend>`+
    `<div class="fnri-editor-search"><input class="fnri-editor-find-input" type="search" name="editorSearch" `+
    `value="${esc(query)}" placeholder="${esc(l('editorSearch'))}" aria-label="${esc(l('editorSearch'))}">`+
    (query?`<button type="button" data-fnri-editor-nav="clear">${esc(l('editorClear'))}</button>`:'')+`</div>`+
    `<div class="fnri-editor-page-info" aria-live="polite">${esc(l('editorResults'))}: ${listing.count} · `+
    `${esc(l('editorPage'))} ${listing.page+1}/${listing.pages}</div>`+
    `<div class="fnri-editor-parts-list" role="region" aria-label="${esc(l('component'))}">`+
    (operations||`<p>${esc(l('editorNoResults'))}</p>`)+`</div>`+
    `<div class="fnri-editor-pages">`+
    (listing.page>0?`<button type="button" data-fnri-editor-nav="prev">${esc(l('editorPrev'))}</button>`:'')+
    (listing.page<listing.pages-1?`<button type="button" data-fnri-editor-nav="next">${esc(l('editorNext'))}</button>`:'')+`</div>`+
    bulk+adjustments+offset+
    `<div class="fnri-editor-add-row">${button('add',l('addComponent'))}</div>`+
    `</fieldset>`+
    `<small>${esc(l('history'))}: ${isDamage?(card.history?.length??0):(get(msg,'rollEdit')?.history?.length??0)}</small>`+
    (feedback?`<div class="fnri-roll-editor-feedback" role="status">${esc(feedback)}</div>`:'')+`</div>`;
}

/** Live update just the result region: keep the search field focused and both
 * checkboxes untouched. No chat flags are changed during search or pagination.
 * Returned page may be clamped if a query reduces the result count. */
export function refreshRollEditorSearch(root,msg,{page=0,query='',selectedIds}={}) {
  const markup=renderRollEditorContent(msg,{page,query,selectedIds});
  const template=document.createElement('template');
  template.innerHTML=markup;
  const fresh=template.content.querySelector('.fnri-roll-editor');
  for(const selector of ['.fnri-editor-page-info','.fnri-editor-parts-list','.fnri-editor-pages','.fnri-editor-bulk']) {
    const existing=root.querySelector(selector);
    const updated=fresh?.querySelector(selector);
    if(existing && updated)existing.replaceWith(updated);
  }
  const searchBar=root.querySelector('.fnri-editor-search');
  searchBar?.querySelector('[data-fnri-editor-nav="clear"]')?.remove();
  const clear=fresh?.querySelector('[data-fnri-editor-nav="clear"]');
  if(clear && searchBar)searchBar.append(clear);
  return rollEditorPage(getEditorParts(msg),{page,query}).page;
}

/** Execute only the action explicitly selected. UI values do not modify dice on
 * their own. Intervention and critical fields are independent of the dice. */
export async function saveRollEditorInput(msg,result,baseline={}) {
  const card=get(msg,'weaponDamage');
  const isDamage=card?.version===2;
  const parts=getEditorParts(msg);
  let op=String(result.operation??'none');
  // Compatibility with early dialog fixture responses (not exposed in new UI).
  if(!('operation' in result) && result.part && result.action) {
    const i=parts.findIndex(p=>p.id===result.part);
    if(i>=0) {op=`${result.action}:${i}`;result={...result,[`partValue_${i}`]:result.value};}
  }
  let outcome=null;
  if(op!=='none') {
    if(op.startsWith('adjustment:')) {
      const k=op.slice('adjustment:'.length);
      if(!isDamage||!['penalty','resistance','vulnerability'].includes(k))throw Error('Invalid adjustment');
      const value=Number(result[`adjustValue_${k}`]);
      if(!Number.isFinite(value)||value<0)throw Error('Invalid adjustment value');
      if(value!==Number(card.adjustments?.[k]??0))outcome=await executeRollEditorAction(msg,{partId:op,action:'set',value});
    } else if(op==='offset') {
      if(isDamage)throw Error('Invalid offset');
      const value=Number(result.offsetValue);
      if(!Number.isFinite(value))throw Error('Invalid total correction');
      if(value!==Number(get(msg,'rollEdit')?.offset??0))outcome=await executeRollEditorAction(msg,{partId:'offset',action:'set',value});
    } else {
      const match=/^(reroll|set|exclude|restore|reset):(\d+)$/.exec(op);
      if(!match)throw Error('Unknown component operation');
      const [,action,index]=match;
      // The dialog may have been open while components were added or removed.
      // A clicked button must keep targeting its original stable part ID,
      // never the component that now happens to occupy the old row index.
      const hasTarget=Object.hasOwn(result,'targetPartId');
      const part=hasTarget?parts.find(p=>p.id===result.targetPartId):parts[Number(index)];
      if(!part)throw Error('Missing roll component');
      const value=action==='set'?Number(result[`partValue_${index}`]):undefined;
      if(action==='set' && !Number.isFinite(value))throw Error('Invalid roll value');
      if(action==='reroll' && part.kind!=='die')throw Error(l('notADie'));
      if(action==='exclude' && part.excluded || action==='restore' && !part.excluded ||
        action==='set' && value===part.value || action==='reset' && part.value===part.original && !part.excluded) {
        // Do not record a no-op and do not inadvertently adjust another part.
      } else outcome=await executeRollEditorAction(msg,{partId:part.id,action,value});
    }
  }
  // An unchecked HTML checkbox is absent from FormData. The hidden marker
  // distinguishes that from a legacy/API call which did not submit this field.
  const hasInterventionInput=Object.hasOwn(result,'intervention') ||
    Object.hasOwn(result,'interventionPresent');
  const rawIntervention=result.intervention;
  const desired=hasInterventionInput
    ? (rawIntervention===true || rawIntervention==='true' || rawIntervention==='on' ||
      rawIntervention==='1' || rawIntervention===1)
    : messageIntervention(msg);
  // Do not overwrite a concurrent edit merely because an old dialog submitted
  // an untouched checkbox. Only an actual change from the opened state wins.
  const interventionChanged=(!hasInterventionInput ||
    (typeof baseline.intervention==='boolean' && desired===baseline.intervention))
    ? false : await setMessageIntervention(msg,desired);
  let criticalChanged=false;
  if(isDamage) {
    const hasCheckbox=Object.hasOwn(result,'critical') || Object.hasOwn(result,'criticalPresent');
    if(hasCheckbox) {
      const enabled=[true,'true','on','1',1].includes(result.critical);
      const current=criticalCheckboxState(msg);
      if(enabled!==current &&
        (typeof baseline.critical!=='boolean' || enabled!==baseline.critical)) {
        const currentCard=get(msg,'weaponDamage');
        const natural=criticalDamageRule(currentCard).triggered;
        // Restore automatic rule when manual correction matches it again.
        const mode=enabled===natural?'auto':String(enabled);
        const mult=Number(currentCard.manualCritMultiplier??currentCard.naturalCritMultiplier??2);
        criticalChanged=await setMessageCritical(msg,mode,mult);
      }
    } else if(Object.hasOwn(result,'criticalMode')) {
      // Keep backward-compatible programmatic input, but no select in the UI.
      const mode=String(result.criticalMode);
      const multiplier=Number(result.criticalMultiplier??card.naturalCritMultiplier??2);
      criticalChanged=await setMessageCritical(msg,mode,multiplier);
    }
  }
  return {outcome,interventionChanged,criticalChanged};
}

/** Prompt only for a chosen numeric correction; never show a permanent value field. */
export async function promptEditorNumber(msg,operation,dialog=foundry.applications.api.DialogV2,targetPartId=null) {
  const parts=getEditorParts(msg);
  let current,allowNegative=false;
  const match=/^set:(\d+)$/.exec(operation);
  if(match) {
    const p=targetPartId===null?parts[Number(match[1])]:parts.find(p=>p.id===targetPartId);
    if(!p)throw Error('Missing roll component');
    current=p.value;
    allowNegative=true; // GM is not bound by the natural die range when manually editing.
  } else if(operation.startsWith('adjustment:')) {
    const k=operation.slice('adjustment:'.length);
    if(!['penalty','resistance','vulnerability'].includes(k))throw Error('Invalid adjustment');
    current=get(msg,'weaponDamage')?.adjustments?.[k]??0;
  } else if(operation==='offset') {current=get(msg,'rollEdit')?.offset??0;allowNegative=true;}
  else throw Error('Action does not require a number');
  const component=match?(targetPartId===null?parts[Number(match[1])]:
    parts.find(p=>p.id===targetPartId)):null;
  const input=await dialog.input({window:{title:l('set')},
    content:`<label>${esc(l('value'))}<input name="newValue" type="number" step="${component?.kind==='die'?'1':'any'}" `+
      `${allowNegative?'':'min="0"'} value="${esc(current)}" autofocus required></label>`,
    ok:{label:l('applyCorrection')},rejectClose:false});
  if(!input)return null;
  const raw=input.newValue;
  if(raw===null || raw===undefined || String(raw).trim()==='')throw Error('Value is required');
  const number=Number(raw);
  if(!Number.isFinite(number)||(!allowNegative && number<0)||
    (component?.kind==='die'&&!Number.isInteger(number)))throw Error('Invalid roll value');
  if(component?.kind==='die' && number<1) {
    // Notify exactly once. The accepted die value is always at least 1.
    await dialog.prompt({window:{title:l('dieValueTitle')},
      content:`<p>${esc(l('dieValueSetToOne'))}</p>`,
      ok:{label:l('ok')},rejectClose:false});
    return 1;
  }
  if(isOutOfRangeDieValue(component,number)) {
    // Only exceeding the face count requires explicit confirmation.
    const confirmed=await dialog.confirm({window:{title:l('dieValueTitle')},
      content:`<p>${esc(component.formula)}: ${esc(number)} &gt; ${esc(component.faces)}. ${esc(l('outOfRangeQuestion'))}</p>`,
      yes:{label:l('applyCorrection')},no:{label:l('editorCancel')},rejectClose:false});
    if(confirmed!==true)return null;
  }
  return number;
}

/** Add UI is available only on a v2 damage message; a single dialog captures
 * the component type, count, faces, damage type and comma-separated traits.
 */
export async function promptAddDamageComponent(dialog=foundry.applications.api.DialogV2) {
  const input=await dialog.input({window:{title:l('addComponent')},
    content:`<div class="fnri-editor-add-form">`+
      `<label>${esc(l('componentKind'))}<select name="kind">`+
      `<option value="die">${esc(l('componentDie'))}</option>`+
      `<option value="fixed">${esc(l('componentFixed'))}</option></select></label>`+
      `<div data-fnri-add-dice><label>${esc(l('diceFaces'))}<input type="number" name="faces" value="6" min="2" max="1000" step="1"></label>`+
      `<label>${esc(l('diceCount'))}<input type="number" name="count" value="1" min="1" max="1000" step="1"></label></div>`+
      `<div data-fnri-add-fixed hidden><label>${esc(l('value'))}<input type="number" name="value" value="1" step="any"></label></div>`+
      `<label>${esc(l('damageType'))}<input type="text" name="damageType" value="" maxlength="100" `+
      `placeholder="${esc(l('damageTypePlaceholder'))}"></label>`+
      `<label>${esc(l('componentTraits'))}<input type="text" name="traits" value="" `+
      `placeholder="${esc(l('componentTraitsPlaceholder'))}"></label></div>`,
    ok:{label:l('addComponent')},rejectClose:false,
    render:(_event,app)=>{
      const root=app.element;
      const picker=root?.querySelector?.('select[name="kind"]');
      const sync=()=>{
        const die=picker?.value==='die';
        const dieFields=root?.querySelector?.('[data-fnri-add-dice]');
        const fixedFields=root?.querySelector?.('[data-fnri-add-fixed]');
        if(dieFields)dieFields.hidden=!die;
        if(fixedFields)fixedFields.hidden=die;
      };
      picker?.addEventListener?.('change',sync);sync();
    }});
  if(!input)return null;
  const kind=String(input.kind??'die');
  if(!['die','fixed'].includes(kind))throw Error('Unknown component kind');
  const faces=Number(input.faces??6),count=Number(input.count??1),value=Number(input.value);
  if(kind==='die' && (!Number.isInteger(faces)||faces<2||faces>1000||
    !Number.isInteger(count)||count<1||count>1000))throw Error('Invalid dice addition');
  if(kind==='fixed' && (String(input.value??'').trim()===''||!Number.isFinite(value)))
    throw Error('Invalid fixed addition');
  const damageType=String(input.damageType??'').trim();
  const traits=String(input.traits??'').split(/[,;\n]+/).map(t=>t.trim()).filter(Boolean);
  return {kind,faces,count,value,damageType,traits};
}

/** DOM actions are actual buttons. Close the editor to apply each action and
 * re-open with fresh message flags, so the displayed dice never go stale.
 */
export async function openRollEditor(msg) {
  if(!own(msg)||!editableMessage(msg))return;
  const dialog=foundry.applications.api.DialogV2;
  let feedback='';
  let page=0,query='',interventionDraft,criticalDraft;
  const selectedIds=new Set(getEditorParts(msg).filter(p=>p.pending).map(p=>p.id));
  while(true) {
    let content,renderedParts,baseline;
    // Capture the actual state and the part IDs displayed when this dialog
    // opened; neither is safely reconstructed from a later row index.
    try {
      renderedParts=getEditorParts(msg);
      baseline={intervention:messageIntervention(msg),critical:criticalCheckboxState(msg)};
      content=renderRollEditorContent(msg,{feedback,page,query,interventionDraft,criticalDraft,selectedIds});
    } catch(error){ui.notifications?.error(error.message);return;}
    let pressed=null;
    const result=await dialog.input({window:{title:l('editRoll')},content,
      ok:{label:l('applyCorrection')},rejectClose:false,
      render:(_event,app)=>{
        const root=app.element?.querySelector?.('.fnri-roll-editor');
        const updateResults=(nextQuery,nextPage)=>{
          query=nextQuery;
          page=refreshRollEditorSearch(root,msg,{query,page:nextPage,selectedIds});
        };
        root?.addEventListener?.('change',event=>{
          const target=event.target;
          if(!target?.matches?.('input[data-fnri-editor-select]'))return;
          const id=target.dataset.fnriEditorSelect;
          if(target.checked)selectedIds.add(id);else selectedIds.delete(id);
          updateResults(query,page);
        });
        root?.addEventListener?.('input',event=>{
          if(event.target?.matches?.('input[name="editorSearch"]'))
            updateResults(event.target.value,0);
        });
        root?.addEventListener?.('click',event=>{
          const button=event.target?.closest?.('button[data-fnri-editor-op], button[data-fnri-editor-nav]');
          if(!button || !root.contains(button))return;
          event.preventDefault();event.stopPropagation();
          const navigation=button.dataset.fnriEditorNav;
          if(navigation) {
            if(navigation==='clear') {
              const field=root.querySelector('input[name="editorSearch"]');
              if(field)field.value='';
              updateResults('',0);
              field?.focus();
            } else if(navigation==='next')updateResults(query,page+1);
            else if(navigation==='prev')updateResults(query,page-1);
            return;
          }
          const intervention=root.querySelector('input[name="intervention"]')?.checked;
          const crit=root.querySelector('input[name="critical"]')?.checked;
          const isDamage=!!get(msg,'weaponDamage')?.parts;
          pressed={operation:button.dataset.fnriEditorOp??'none',
            interventionPresent:'1',...(intervention?{intervention:'true'}:{}),
            ...(isDamage?{criticalPresent:'1',...(crit?{critical:'true'}:{})}:{})};
          const selectedOp=/^(?:reroll|set|exclude|restore|reset):(\d+)$/.exec(pressed.operation);
          if(selectedOp)pressed.targetPartId=button.dataset.fnriEditorTargetId ?? renderedParts[Number(selectedOp[1])]?.id;
          void app.close();
        });
        root?.addEventListener?.('keydown',event=>{
          if(event.key==='Enter' && event.target?.matches?.('input[name="editorSearch"]')) {
            event.preventDefault();event.stopPropagation();
            updateResults(event.target.value,0);
          }
        });
      }});
    if(!pressed && !result) {
      try {
        if(await resolvePendingOnClose(msg,dialog))return;
        feedback=l('unrolledDice');
        continue;
      }catch(error){ui.notifications?.error(error.message);feedback=error.message;continue;}
    }
    try {
      let input=pressed ?? result;
      if(pressed) {
        const op=pressed.operation;
        if(op.startsWith('set:')||op.startsWith('adjustment:')||op==='offset') {
          const number=await promptEditorNumber(msg,op,dialog,pressed.targetPartId??null);
          if(number===null) {
            interventionDraft=['true',true].includes(input.intervention);
            criticalDraft=['true',true].includes(input.critical);
            feedback=l('noChanges');continue;
          }
          if(op.startsWith('set:'))input[`partValue_${op.slice(4)}`]=number;
          else if(op.startsWith('adjustment:'))input[`adjustValue_${op.slice('adjustment:'.length)}`]=number;
          else input.offsetValue=number;
        }
      }
      const bulkOp=input.operation;
      if(['rerollMarked','excludeBulk','restoreBulk'].includes(bulkOp)) {
        // Preserve edited checkboxes independently of the batch action.
        await saveRollEditorInput(msg,{...input,operation:'none'},baseline);
        if(bulkOp==='rerollMarked') {
          const chosen=getEditorParts(msg).filter(p=>selectedIds.has(p.id)&&p.kind==='die').map(p=>p.id);
          if(!chosen.length){feedback=l('selectDiceFirst');continue;}
          const answer=await rollMarkedDice(msg,chosen);
          feedback=`${l('rerollMarked')}: ${answer.count}`;
        } else {
          const answer=await setBulkExcluded(msg,[...selectedIds],bulkOp==='excludeBulk');
          feedback=`${l(bulkOp==='excludeBulk'?'excludedCount':'restoredCount')}: ${answer.count}`;
        }
        interventionDraft=undefined;criticalDraft=undefined;
        continue;
      }
      let added=null;
      if(input.operation==='add') {
        const config=await promptAddDamageComponent(dialog);
        if(config===null) {
          interventionDraft=['true',true].includes(input.intervention);
          criticalDraft=['true',true].includes(input.critical);
          feedback=l('noChanges');continue;
        }
        // Preserve independently edited checkboxes in the same UI action.
        input={...input,operation:'none'};
        added=await addDamageToMessage(msg,config);
        for(const part of added.added)if(part.pending)selectedIds.add(part.id);
        query='';page=Math.max(0,Math.ceil(getEditorParts(msg).length/ROLL_EDITOR_PAGE_SIZE)-1);
      }
      const saved=await saveRollEditorInput(msg,input,baseline);
      interventionDraft=undefined;criticalDraft=undefined;
      if(added)feedback=`${l('componentAdded')}: ${added.added.length}`;
      else if(saved.outcome?.action==='reroll') {
        feedback=`${l('reroll')}: ${saved.outcome.before} → ${saved.outcome.current}`;
      } else if(saved.interventionChanged)feedback=l('interventionSaved');
      else if(saved.criticalChanged)feedback=l('criticalSaved');
      else feedback=l(saved.outcome?'correctionSaved':'noChanges');
    } catch(error) {
      console.error('Fast NRI | roll edit failed',error);
      ui.notifications?.error(error.message);feedback=error.message;
    }
  }
}

/** Select the native Roll explicitly; secondary corrections have independent flags. */
export function nativeRollView(msg,index) {
  if(!Number.isInteger(index)||!Number.isFinite(msg.rolls?.[index]?.total))throw Error('Invalid Roll index');
  if(index===0 && !get(msg,'weaponDamage'))return msg;
  const key=`rollEditNative${index}`;
  return new Proxy(msg,{get(target,prop){
    if(prop==='rolls')return [target.rolls[index]];
    if(prop==='getFlag')return (scope,name)=>['weaponDamage','weaponAttack','fixedRollComponents'].includes(name)?undefined:(target.getFlag?.(scope,name==='rollEdit'?key:name)??target.flags?.[scope]?.[name==='rollEdit'?key:name]);
    if(prop==='flags')return {[ID]:{rollEdit:target.getFlag?.(ID,key)??target.flags?.[ID]?.[key]}};
    if(prop==='update')return patch=>target.update(Object.fromEntries(Object.entries(patch).map(([path,value])=>[path===`flags.${ID}.rollEdit`?`flags.${ID}.${key}`:path,value])));
    const value=Reflect.get(target,prop,target);return typeof value==='function'?value.bind(target):value;
  }});
}
export function rollChoices(msg) {
  const result=[];
  if(get(msg,'weaponDamage')?.version===2)result.push({id:'damage',label:l('damage'),message:msg});
  for(const [index,roll] of (msg.rolls??[]).entries())if(Number.isFinite(roll.total))
    result.push({id:String(index),label:`#${index+1} · ${roll.formula??''} = ${get(nativeRollView(msg,index),'rollEdit')?.currentTotal??roll.total}`,message:nativeRollView(msg,index)});
  if(!result.length && Array.isArray(get(msg,'rollEdit')?.components))result.push({id:'saved',label:l('correctedTotal'),message:msg});
  return result;
}
export async function chooseRollChoice(msg) {
  const choices=rollChoices(msg);
  if(choices.length===1)return choices[0];
  if(!choices.length)return null;
  const input=await foundry.applications.api.DialogV2.input({window:{title:l('selectRoll')},content:`<select name="roll">${choices.map(c=>`<option value="${c.id}">${esc(c.label)}</option>`).join('')}</select>`,ok:{label:l('select')},rejectClose:false});
  return choices.find(c=>c.id===input?.roll)??null;
}
export async function chooseRollView(msg) {return (await chooseRollChoice(msg))?.message??null;}
function contextMessage(element) {
  const id=element?.closest?.('[data-message-id]')?.dataset?.messageId ?? element?.dataset?.messageId;
  return id ? game.messages?.get(id) : null;
}
export function registerRollEditor() {
  Hooks.on('getChatMessageContextOptions',(app,items)=>{
    items.push({label:'FASTNRI.Damage.editRoll',icon:'fa-solid fa-sliders',
      visible:element=>{const msg=contextMessage(element);return own(msg)&&editableMessage(msg);},
      onClick:(event,element)=>{const msg=contextMessage(element);if(msg&&own(msg))void (async()=>{const chosen=await chooseRollView(msg);if(chosen)await openRollEditor(chosen);})();}});
  });
  Hooks.on('renderChatMessageHTML',renderCorrectedRolls);
  Hooks.on('updateChatMessage',msg=>{
    if(typeof document==='undefined'||!document.querySelectorAll)return;
    for(const el of document.querySelectorAll('.chat-message'))if(el.dataset?.messageId===msg.id)renderCorrectedRolls(msg,el);
  });
}

export function renderCorrectedRolls(msg,html){
  if(msg.visible===false||msg.isContentVisible===false||!html?.querySelector)return;
  html.querySelector('[data-fnri-roll-corrected]')?.remove?.();
  const states=(msg.rolls??[]).map((r,index)=>({index,state:get(msg,`rollEditNative${index}`)??(index===0&&!get(msg,'weaponDamage')?get(msg,'rollEdit'):null)})).filter(x=>x.state);
  if(!states.length&&!(msg.rolls?.length)&&get(msg,'rollEdit'))states.push({index:0,state:get(msg,'rollEdit')});
  if(!states.length)return;
  const native=html.querySelectorAll?.('.dice-roll .dice-total')??[];
  const label=document.createElement('div');label.dataset.fnriRollCorrected='';label.className='fnri-roll-corrected';
  for(const {index,state} of states){
    const original=native.length===msg.rolls?.length?native[index]:null;
    if(original){original.classList.add('fnri-original-roll');original.title=l('originalTotal');}
    const row=document.createElement('span');row.dataset.fnriRollIndex=String(index);row.textContent=`${l('correctedTotal')} #${index+1}: ${state.currentTotal}`;label.append(row);
  }
  (html.querySelector('.message-content')??html).append(label);
}
