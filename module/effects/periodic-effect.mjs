/** Explicit creation of one independent, native Actor ActiveEffect for
 * periodic damage. No new UI and no automatic interpretation of Item names.
 * Application and turn settlement are separate stages of the same lifecycle.
 */
import {PERIODIC_SCOPE, PERIODIC_KEY, periodicTraits,readPeriodicData,
  calculatePeriodicTick,declaredPeriodicDefenses} from '../damage/periodic-damage.mjs';
import {canReadChatContent,chatAudience,gmChatAudience} from '../data/chat-visibility.mjs';

const plain=value=>value && typeof value==='object'&&!Array.isArray(value)?value:{};
const numeric=value=>Number.isSafeInteger(value) && value>=0;
function owner(actor) {
  return !!actor && actor.documentName==='Actor' &&
    (actor.canUserModify?.(game.user,'update')===true || actor.isOwner===true || game.user?.isGM===true);
}
function validateTicks(value) {
  if (value == null || value === '') return null;
  if (!Number.isSafeInteger(value) || value<1) throw Error('Duration must be a positive integer number of triggers');
  return value;
}
/** Preparing this draft does not write a world document or alter existing rolls. */
export async function preparePeriodicDamage({value=null,formula=null,traits=[],durationTicks=null,end={},name='Периодический урон'}={}) {
  const expression=String(formula??'').trim();
  let roll=null;
  if (expression) {
    if (typeof Roll !== 'function') throw Error('Foundry Roll API is unavailable');
    roll = await new Roll(expression).evaluate();
    value = Number(roll.total);
  }
  if (value != null && !numeric(value)) throw Error('Invalid periodic result');
  const normalizedTraits=periodicTraits(traits);
  const ending=plain(end);
  const nonnegativeList=list=>Array.isArray(list) ? list.filter(numeric) : [];
  const data = {
    version:1, value, traits:normalizedTraits, durationTicks:validateTicks(durationTicks),
    end:{skipCheck:ending.skipCheck===true,bonuses:nonnegativeList(ending.bonuses),
      penalties:nonnegativeList(ending.penalties)}
  };
  return {name:String(name??'').trim() || 'Периодический урон', data, roll};
}

/** Missing/zero value, missing damage category and immunity are notifications,
 * not an artificial prohibition on adding or editing the native effect. */
export async function createPeriodicDamageEffect(actor, options={}) {
  if (!owner(actor) || typeof actor.createEmbeddedDocuments !== 'function')
    throw Error('No permission to add an effect to this Actor');
  const sourceMessage=options.sourceMessage??null;
  if (sourceMessage && !canReadChatContent(sourceMessage)) throw Error('Source message is not visible');
  const {data:preparedData,name,roll}=options.prepared ?? await preparePeriodicDamage(options);
  const data={...preparedData};
  if (sourceMessage?.id) data.sourceMessageId=sourceMessage.id;
  if (options.privateToGm===true) data.privateToGm=true;
  if (typeof options.applicationKey==='string') data.applicationKey=options.applicationKey;
  const documentId=typeof options.documentId==='string' ? options.documentId : null;
  if (documentId && (!/^[A-Za-z0-9]{16}$/.test(documentId))) throw Error('Invalid effect ID');
  const prior=documentId ? actor.effects?.get(documentId) : null;
  if (prior) {
    if (prior.getFlag?.(PERIODIC_SCOPE,PERIODIC_KEY)?.applicationKey !== data.applicationKey ||
        !data.applicationKey) throw Error('Periodic effect identity collision');
    return {effect:prior,alreadyApplied:true,initialCalculation:calculatePeriodicTick(
      readPeriodicData(prior),declaredPeriodicDefenses(actor)),requiresManualResolution:false};
  }
  const currentSource = sourceMessage ? game.messages?.get?.(sourceMessage.id) ?? sourceMessage : null;
  if (sourceMessage && !canReadChatContent(currentSource)) throw Error('Source is no longer visible');
  const projection=calculatePeriodicTick(data,declaredPeriodicDefenses(actor));
  const payload={name,type:'base',showIcon:2,disabled:false,transfer:false,duration:{},
    system:{changes:[]},flags:{[PERIODIC_SCOPE]:{[PERIODIC_KEY]:data}}};
  if (typeof options.damageReportKey==='string') {
    payload.flags[PERIODIC_SCOPE].attackOutcomeApplication=true;
    payload.flags[PERIODIC_SCOPE].attackOutcomeReportKey=options.damageReportKey;
  }
  // The system's ActiveEffect uses native `system.changes` when authored.
  // No active numerical changes are installed by the periodic marker.
  if (typeof options.sourceItem?.uuid==='string') payload.origin=options.sourceItem.uuid;
  if (documentId) payload._id=documentId;
  let created=[];
  try {created=await actor.createEmbeddedDocuments('ActiveEffect',[payload],
    documentId?{keepId:true}:{});}
  catch(error) {
    const concurrent=documentId ? actor.effects?.get(documentId) : null;
    if (!concurrent || !data.applicationKey ||
        concurrent.getFlag?.(PERIODIC_SCOPE,PERIODIC_KEY)?.applicationKey!==data.applicationKey) throw error;
    return {effect:concurrent,alreadyApplied:true,
      initialCalculation:calculatePeriodicTick(readPeriodicData(concurrent),declaredPeriodicDefenses(actor)),
      requiresManualResolution:false};
  }
  const effect=created?.[0];
  if (!effect?.id || readPeriodicData(effect).version !== 1)
    throw Error('Foundry did not persist the periodic damage ActiveEffect');
  if (roll) {
    try {
      const message=await roll.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:name},
        {create:false});
      if (currentSource) {
        Object.assign(message,data.privateToGm ? gmChatAudience(currentSource) : chatAudience(currentSource));
        await ChatMessage.create(message);
      } else {
        await ChatMessage.create(ChatMessage.applyMode(message));
      }
    } catch (error) {
      // A failed chat post must not silently remove an already created effect.
      console.error('Fast NRI | Periodic application Roll chat failed',error);
    }
  }
  return {effect,initialCalculation:projection,
    requiresManualResolution:!projection.resolved || projection.total<=0};
}
