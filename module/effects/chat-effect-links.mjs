/** Native ActiveEffect UUID drag data for existing card messages; no apply button.
 * Each effect remains a separate source document. Foundry TokenLayer handles
 * {type:'ActiveEffect',uuid} drops onto tokens (v14). */
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

export function cardEffectLinks(item) {
  const effects=item?.effects?.contents ?? [];
  if(!effects.length) return '';
  return `<div class="fnri-chat-effects">${effects.map(effect=>
    `<span class="fnri-chat-effect-link" draggable="true" data-fnri-effect-uuid="${esc(effect.uuid)}"`+
    ` title="${esc(effect.name)}">${esc(effect.name)}</span>`).join(' · ')}</div>`;
}

export function registerChatEffectDrag() {
  Hooks.on('renderChatMessageHTML', (_message,html)=>{
    if(!html?.querySelectorAll || (_message?.getFlag?.('fast-nri-v14','conditionReminder')||_message?.getFlag?.('fast-nri-v14','effectEndingReport')))return;
    // Native Item links are an existing way of posting a card to chat.
    // Expose its separate effect names without a new publication/apply button.
    for(const link of html.querySelectorAll('a.content-link[data-uuid]')) {
      if(link.dataset.fnriItemEffectsChecked)continue;
      link.dataset.fnriItemEffectsChecked='true';
      const uuid=link.dataset.uuid;
      if(!uuid)continue;
      void fromUuid(uuid).then(doc=>{
        if(doc?.documentName!=='Item' || !doc.effects?.contents?.length)return;
        const list=document.createElement('div');
        list.innerHTML=cardEffectLinks(doc);
        if(list.firstElementChild)link.insertAdjacentElement('afterend',list.firstElementChild);
        // Register drag on newly inserted links directly.
        bindEffectLinks(html);
      }).catch(error=>console.debug('Fast NRI | Item chat effects not available',error));
    }
    bindEffectLinks(html);
  });
}

function bindEffectLinks(html) {
  for(const entry of html.querySelectorAll('[data-fnri-effect-uuid]')) {
      if(entry.dataset.fnriDragReady)continue;
      entry.dataset.fnriDragReady='true';
      entry.addEventListener('dragstart',event=>{
        if(!event.dataTransfer)return;
        event.dataTransfer.setData('text/plain',JSON.stringify({type:'ActiveEffect',uuid:entry.dataset.fnriEffectUuid}));
        event.dataTransfer.effectAllowed='copy';
      });
    }
}
