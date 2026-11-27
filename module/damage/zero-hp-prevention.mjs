const ID='fast-nri-v14';
export function zeroHpPreventionItem(actor){
  if((actor.effects?.contents??[]).some(e=>(e.getFlag?.(ID,'zeroHpPreventionUsed')??e.flags?.[ID]?.zeroHpPreventionUsed)===true))return null;
  return (actor.items?.contents??[]).find(i=>i.type==='ability'&&i.system?.mechanics?.preventZeroHpMarker===true)??null;
}
export async function markZeroHpPrevention(actor,item){
  const [effect]=await actor.createEmbeddedDocuments('ActiveEffect',[{name:item.name,img:item.img,type:'base',showIcon:2,disabled:false,transfer:false,origin:item.uuid,duration:{},system:{changes:[]},flags:{[ID]:{zeroHpPreventionUsed:true}}}]);
  if(!effect?.id)throw Error('Неукротимость: эффект не создан');return effect;
}
