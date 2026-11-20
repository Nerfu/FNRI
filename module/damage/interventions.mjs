/** Chainable intervention cards. All card-owned rules are read from Item data;
 * the only built-in game action is Rulebook Self-Defense.
 */
import {copy,selfDefenseOutcome} from './damage-core.mjs';
import {BASE_SELF_DEFENSE} from '../data/core-actions.mjs';
import {chooseControlledToken} from './hp-actions.mjs';
const ID='fast-nri-v14';
const tr=k=>game.i18n.localize('FASTNRI.Damage.'+k);
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const naturalD20=roll=>{const ds=(roll?.dice??[]).filter(d=>d.faces===20&&d.number===1);
  const n=ds.length===1?ds[0].results?.filter(r=>r.active!==false)?.[0]?.result:null;
  return Number.isInteger(n)&&n>=1&&n<=20?n:null;};

export function availableInterventions(actor) {
  const abilities=[...(actor?.items??[])].filter(i=>i.type==='ability' &&
    (i.system?.mechanics?.intervention || /(?:вмешательств|intervention)/i.test(String(i.system?.trigger??''))));
  return [{id:BASE_SELF_DEFENSE.id,name:game.i18n.localize('FASTNRI.'+BASE_SELF_DEFENSE.nameKey),builtin:true},...abilities.map(i=>
    ({id:i.id,name:i.name,item:i,builtin:false}))];
}

export function selfDefenseFormula(actor,attackKind) {
  const range=attackKind==='ranged' || attackKind==='distance' || attackKind==='throw';
  const defense=Number(range?actor?.system?.defenses?.reflex:actor?.system?.defenses?.fortitude);
  const bonus=Number.isFinite(defense)?defense:0;
  const die=String(actor?.system?.combatDie??'').trim().toLowerCase();
  const isNpc=actor?.type==='npc';
  const combat=/^(?:1)?d\d+$/.test(die) ? (die.startsWith('1')?die:'1'+die) : null;
  const attackMod=Number(actor?.system?.attackModifier);
  const expression=isNpc ? `1d20 + ${bonus} + ${Number.isFinite(attackMod)?attackMod:0}`:
    `1d20 + ${bonus}${combat?` + ${combat}`:''}`;
  const warnings=[];
  if(!['melee','ranged','distance','throw'].includes(attackKind))warnings.push(tr('unknownRange'));
  if(!Number.isFinite(defense))warnings.push(tr('missingDefense'));
  if(!isNpc&&!combat)warnings.push(tr('missingCombatDie'));
  return {expression,warnings};
}

async function chooseTie(parts) {
  if(parts.length===1)return parts[0];
  const opts=parts.map(p=>`<option value="${esc(p.id)}">${esc(p.formula)} · ${p.value}</option>`).join('');
  const fd=await foundry.applications.api.DialogV2.input({window:{title:tr('chooseRemoved')},
    content:`<select name="part">${opts}</select>`,ok:{label:tr('select')},rejectClose:false});
  return parts.find(p=>p.id===fd?.part)??null;
}

export async function initiateIntervention(message) {
  const card=message?.getFlag?.(ID,'weaponDamage');
  if(!card||card.version!==2)throw new Error('Intervention requires a component damage card');
  const token=await chooseControlledToken();if(!token)return null;
  const abilities=availableInterventions(token.actor);
  const opts=abilities.map((x,i)=>`<option value="${i}">${esc(x.name)}</option>`).join('');
  const answer=await foundry.applications.api.DialogV2.input({window:{title:tr('intervention')},
    content:`<select name="choice">${opts}</select>`,ok:{label:tr('intervention')},rejectClose:false});
  const index=Number(answer?.choice);
  if(!answer||!Number.isInteger(index)||index<0||index>=abilities.length)return null;
  const selected=abilities[index];const rule=selected.item?.system?.mechanics?.intervention;
  const adapted=selected.builtin?selfDefenseFormula(token.actor,card.attackKind):
    {expression:String(rule?.rollFormula||selected.item?.system?.rollFormula||'').trim(),warnings:[]};
  const warnings=[...adapted.warnings];
  if(card.cancelled)warnings.push(tr('alreadyCancelled'));
  if(card.previousMessageId && selected.builtin)warnings.push(tr('defenseVsIntervention'));
  if(selected.builtin && card.originalTargetUuid && token.document?.uuid!==card.originalTargetUuid)
    warnings.push(tr('selfDefenseOther'));
  if(!card.attackTotal && card.attackTotal!==0)warnings.push(tr('missingAttackTotal'));
  if(!selected.builtin && (!rule||!rule.effect))warnings.push(tr('noAutomatedEffect'));
  if(warnings.length) {
    const ok=await foundry.applications.api.DialogV2.confirm({window:{title:tr('intervention')},
      content: `<p>${warnings.map(esc).join('</p><p>')}</p>`,rejectClose:false});
    if(!ok)return null;
  }
  if(adapted.expression && typeof Roll.validate==='function' && !Roll.validate(adapted.expression)) {
    ui.notifications?.error(tr('invalidFormula'));return null;
  }
  const roll=adapted.expression?await new Roll(adapted.expression,token.actor.getRollData?.()??{}).evaluate():null;
  const next=copy(card);
  next.previousMessageId=message.id;
  next.intervention={id:selected.id,name:selected.name,sourceUuid:selected.item?.uuid??null,
    initiatorActorUuid:token.actor.uuid,initiatorTokenUuid:token.document?.uuid??null,
    total:roll?.total??null,naturalD20:roll?naturalD20(roll):null};
  next.revision=(next.revision??0)+1;
  next.history=[...(next.history??[])];
  let outcome=null;
  if(roll && (selected.builtin || rule?.effect?.kind==='directedDefense')) {
    outcome=selfDefenseOutcome({card,defenseTotal:roll.total,naturalD20:next.intervention.naturalD20});
    if(outcome.success) {
      if(outcome.cancelled)next.cancelled=true;
      else if(outcome.choices.length) {
        const removed=await chooseTie(outcome.choices);
        if(!removed)return null;
        const part=next.parts.find(p=>p.id===removed.id);
        if(part)part.excluded=true;
      }
      next.effectDegree=outcome.effectDegree;
    }
  }
  next.history.push({by:game.user.id,at:Date.now(),action:'intervention',source:selected.id,name:selected.name,
    initiator:token.actor.uuid,checkTotal:roll?.total??null,success:outcome?.success??null,
    cancelled:outcome?.cancelled??false});
  const chatData={speaker:ChatMessage.getSpeaker({actor:token.actor,token:token.document}),
    content:`<strong>${esc(selected.name)}</strong> · ${esc(token.name)}`+
      (roll?` · <strong>${esc(roll.total)}</strong>`:''),
    ...(message.whisper?.length?{whisper:[...message.whisper]}:{}),
    ...(message.blind?{blind:true}:{}),
    flags:{[ID]:{weaponDamage:next}}};
  if(roll)chatData.rolls=[roll.toJSON()];
  return ChatMessage.create(chatData);
}
