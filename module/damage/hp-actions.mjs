/** Explicit HP changes with per-application report and undo (no automatic HP). */
import {calculateDamage, planHpChange, reverseHpChange} from './damage-core.mjs';
export const SYSTEM_ID='fast-nri-v14';
const locks=new Set();
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const t=key=>game.i18n.localize(`FASTNRI.Damage.${key}`);
const canChange=actor=>!!actor && (game.user?.isGM || actor.canUserModify?.(game.user,'update')===true || actor.isOwner===true);
const confirm=async(content,title)=>Boolean(await foundry.applications.api.DialogV2.confirm({window:{title},content,modal:true,rejectClose:false}));
const messageFrom=id=>game.messages?.get(id);

export async function chooseControlledToken() {
  const all=canvas?.tokens?.controlled ?? [];
  if (all.length===0) { ui.notifications?.warn(t('selectToken')); return null; }
  if (all.length===1) return all[0];
  const choices=all.map((token,i)=>`<option value="${i}">${esc(token.name)}</option>`).join('');
  const fd=await foundry.applications.api.DialogV2.input({window:{title:t('selectToken')},
    content:`<select name="token">${choices}</select>`,ok:{label:t('select')},rejectClose:false});
  const n=Number(fd?.token);
  return fd && Number.isInteger(n) && n>=0 && n<all.length ? all[n] : null;
}

function reportsForMessage(id) {
  return (game.messages?.contents ?? []).filter(m=>m.getFlag?.(SYSTEM_ID,'hpReport')?.sourceMessageId===id);
}

/** Healing is available for future card adapters and macros, not silently
 * inferred from a weapon's damage type. */
export async function applyHp({kind='damage',amount,sourceMessage=null,token=null}={}) {
  token??=await chooseControlledToken();
  if (!token) return null;
  const actor=token.actor;
  if (!canChange(actor)) {ui.notifications?.error(t('noPermission'));return null;}
  if (!['damage','heal','temp'].includes(kind)) throw new Error('Unknown HP channel');
  const key=actor.uuid;
  if (locks.has(key)) return null;
  if (sourceMessage && reportsForMessage(sourceMessage.id).length) {
    const yes=await confirm(`<p>${esc(t('alreadyApplied'))}</p>`,t('apply'));
    if (!yes) return null;
  }
  locks.add(key);
  try {
    const plan=planHpChange(actor.system.hp,amount,kind);
    const doc=token.document ?? token;
    const report={version:1,kind,recipientName:token.name ?? actor.name,
      actorUuid:actor.uuid,tokenUuid:doc.uuid ?? null,sourceMessageId:sourceMessage?.id ?? null,
      sourceRevision:sourceMessage?.getFlag?.(SYSTEM_ID,'weaponDamage')?.revision ?? 0,
      before:plan.before,after:plan.after,delta:plan.delta,requested:plan.requested,
      actual:plan.actual,reverted:false,author:game.user.id,createdAt:Date.now()};
    await actor.update({'system.hp.current':plan.after.current,'system.hp.temp':plan.after.temp});
    try {
      return await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),
        content:`<div class="fnri-hp-report">${esc(token.name ?? actor.name)} · ${esc(t(kind))}: <strong>${plan.actual}</strong>`+
          (kind==='damage' ? ` <small>(${esc(t('temp'))} ${-plan.delta.temp}, HP ${-plan.delta.current})</small>`:'')+`</div>`,
        flags:{[SYSTEM_ID]:{hpReport:report}}});
    } catch(error) {
      // Avoid successful but untracked changes when the chat creation fails.
      const hp=actor.system.hp;
      if (hp.current===plan.after.current && hp.temp===plan.after.temp) {
        try {await actor.update({'system.hp.current':plan.before.current,'system.hp.temp':plan.before.temp});}
        catch (rollbackError) {console.error('Fast NRI | recovery failed',rollbackError);}
      }
      throw error;
    }
  } finally {locks.delete(key);}
}

export async function applyCardDamage(message) {
  const card=message?.getFlag?.(SYSTEM_ID,'weaponDamage');
  if (!card || card.version!==2) throw new Error('Unsupported damage card');
  return applyHp({kind:'damage',amount:calculateDamage(card).total,sourceMessage:message});
}

export async function revertHpReport(message) {
  const report=message?.getFlag?.(SYSTEM_ID,'hpReport');
  if (!report || report.reverted) return null;
  if (!game.user?.isGM && !message.isAuthor) {ui.notifications?.error(t('noPermission'));return null;}
  const key=`undo:${message.id}`;
  if (locks.has(key)) return null;
  locks.add(key);
  try {
    // Re-read persistent message; never use stale click state.
    const fresh=messageFrom(message.id) ?? message;
    const saved=fresh.getFlag(SYSTEM_ID,'hpReport');
    if (!saved || saved.reverted || saved.pendingUndo) return null;
    const doc=saved.tokenUuid ? await fromUuid(saved.tokenUuid) : null;
    const actor=doc?.actor ?? (saved.actorUuid ? await fromUuid(saved.actorUuid) : null);
    if (!canChange(actor)) {ui.notifications?.error(t('noPermission'));return null;}
    const hpBeforeUndo={current:actor.system.hp.current,temp:actor.system.hp.temp};
    const reverse=reverseHpChange(actor.system.hp,saved);
    if (reverse.changedSince) {
      const yes=await confirm(`<p>${esc(t('changedHp'))}</p><p>HP: ${actor.system.hp.current} → ${reverse.current}, `+
        `${esc(t('temp'))}: ${actor.system.hp.temp} → ${reverse.temp}</p>`,t('undo'));
      if (!yes) return null;
    }
    // Reserve the report before the HP write. Lock is scoped to this client;
    // the persistent pending flag lets cooperating clients observe the action.
    await fresh.update({[`flags.${SYSTEM_ID}.hpReport.pendingUndo`]:game.user.id});
    let hpUpdated=false;
    try {
      await actor.update({'system.hp.current':reverse.current,'system.hp.temp':reverse.temp});
      hpUpdated=true;
      await fresh.update({[`flags.${SYSTEM_ID}.hpReport.reverted`]:true,
        [`flags.${SYSTEM_ID}.hpReport.pendingUndo`]:null,
        [`flags.${SYSTEM_ID}.hpReport.revertedAt`]:Date.now(),
        [`flags.${SYSTEM_ID}.hpReport.revertedBy`]:game.user.id,
        [`flags.${SYSTEM_ID}.hpReport.reverseAfter`]:{current:reverse.current,temp:reverse.temp}});
    } catch(error) {
      // If saving the report fails after HP changed, compensate only when the
      // Actor still has our values. Otherwise leave a pending marker for GM.
      let restored=!hpUpdated;
      if(hpUpdated && actor.system.hp.current===reverse.current && actor.system.hp.temp===reverse.temp) {
        try {await actor.update({'system.hp.current':hpBeforeUndo.current,'system.hp.temp':hpBeforeUndo.temp});restored=true;}
        catch(e){console.error('Fast NRI | undo compensation failed',e);}
      }
      if(restored) {
        try {await fresh.update({[`flags.${SYSTEM_ID}.hpReport.pendingUndo`]:null});}
        catch(e){console.error('Fast NRI | failed to clear pending undo',e);}
      }
      throw error;
    }
    return true;
  } finally {locks.delete(key);}
}

export function renderHpReport(message,html) {
  const report=message?.getFlag?.(SYSTEM_ID,'hpReport');
  if (!report || !html?.querySelector || html.querySelector('[data-fnri-hp-actions]')) return;
  const anchor=html.querySelector('.message-content') ?? html;
  const wrap=document.createElement('div');wrap.dataset.fnriHpActions='';
  wrap.className='fnri-hp-report-actions';
  if (report.reverted) {
    anchor.classList.add('fnri-hp-reverted');
    const hint=document.createElement('small');hint.textContent=t('reverted');wrap.append(hint);
  } else if (game.user?.isGM || message.isAuthor) {
    const b=document.createElement('button');b.type='button';b.textContent=t('undo');
    b.addEventListener('click',async()=>{if(b.disabled)return;b.disabled=true;
      try {await revertHpReport(message);} catch(e){console.error('Fast NRI | undo failed',e);ui.notifications?.error(t('error'));}
      finally {b.disabled=false;}});wrap.append(b);
  }
  anchor.append(wrap);
}
