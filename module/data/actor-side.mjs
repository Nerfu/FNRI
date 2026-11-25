/** One native side source per PC, independent native dispositions for NPC tokens.
 * No migration, socket escalation, or restriction on game actions. */
const tokenDoc = token => token?.document ?? token;
const sides = () => globalThis.CONST?.TOKEN_DISPOSITIONS ?? {FRIENDLY:1, HOSTILE:-1, NEUTRAL:0, SECRET:-2};
const valid = value => Number.isInteger(value) && Object.values(sides()).includes(value);
const canUpdate = doc => doc?.canUserModify?.(game.user, 'update') === true;
const isLocal = id => id === game.user?.id;
const sideOfChange = changed => changed?.['prototypeToken.disposition'] ?? changed?.prototypeToken?.disposition;
const pcBase = actor => actor?.type === 'character' ? (actor.isToken ? actor.token?.baseActor : actor) : null;
const tokenPC = doc => pcBase(doc?.baseActor ?? doc?.actor);
const syncOption = 'fnriActorSideSync';
const pending = new WeakMap();

export function defaultActorSide(type) {
  return type === 'character' ? sides().FRIENDLY : type === 'npc' ? sides().HOSTILE : undefined;
}

/** Read the native Actor source even if an old placed PC token has a different value. */
export function tokenSide(token) {
  const doc = tokenDoc(token);
  const pc = tokenPC(doc) ?? pcBase(token?.actor);
  const value = pc?.prototypeToken?.disposition;
  return valid(value) ? value : doc?.disposition;
}

/** The caller supplies the exact NPC token context; never choose a random token. */
export function actorSideContext(actor, token = actor?.token) {
  const pc = pcBase(actor);
  if (pc) return {document:pc, path:'prototypeToken.disposition', value:pc.prototypeToken?.disposition, kind:'actor'};
  if (actor?.type !== 'npc') return null;
  const doc = tokenDoc(token);
  if (doc) {
    if (doc.actor !== actor && doc.baseActor !== actor) return null;
    return {document:doc, path:'disposition', value:doc.disposition, kind:'token'};
  }
  return {document:actor, path:'prototypeToken.disposition', value:actor.prototypeToken?.disposition, kind:'prototype'};
}

export async function setActorSide(actor, token, value) {
  const context = actorSideContext(actor, token);
  if (!context || !valid(value) || !canUpdate(context.document)) return false;
  await context.document.update({[context.path]:value});
  return true;
}

/** Native documents on all scenes, not just canvas. Run only on explicit change. */
export function synchronizePCSide(actor) {
  if (!pcBase(actor) || actor.isToken) return Promise.resolve({skipped:0, failed:0});
  const previous = pending.get(actor) ?? Promise.resolve();
  const task = previous.catch(()=>{}).then(async()=>{
    let skipped=0, failed=0;
    const docs = actor.getDependentTokens?.({concreteOnly:true}) ?? [];
    for (const doc of docs) {
      if (tokenPC(doc) !== actor) continue;
      const value = actor.prototypeToken?.disposition;
      if (!valid(value) || doc.disposition === value) continue;
      if (!canUpdate(doc)) {skipped++; continue;}
      try {await doc.update({disposition:value},{[syncOption]:true});}
      catch(error) {failed++; console.warn('Fast NRI | token side synchronization failed', error);}
    }
    if (skipped || failed) ui.notifications?.warn(game.i18n.localize('FASTNRI.ActorSide.syncIncomplete'));
    return {skipped, failed};
  });
  pending.set(actor,task);
  return task;
}

const syncAfterChange = actor => {
  void synchronizePCSide(actor).catch(error=>console.warn('Fast NRI | actor side synchronization failed',error));
};

export function registerActorSides() {
  Hooks.on('preCreateActor',(actor,data,_options,userId)=>{
    if (!isLocal(userId)) return;
    const value = defaultActorSide(actor.type);
    // Preserve explicitly authored content, including neutral and secret.
    if (value !== undefined && !valid(sideOfChange(data))) actor.updateSource({prototypeToken:{disposition:value}});
  });
  Hooks.on('preCreateToken',(doc,_data,_options,userId)=>{
    if (!isLocal(userId)) return;
    const value = tokenPC(doc)?.prototypeToken?.disposition;
    if (valid(value)) doc.updateSource({disposition:value});
  });
  Hooks.on('updateActor',(actor,changed,_options,userId)=>{
    if (!isLocal(userId) || !valid(sideOfChange(changed)) || actor.type !== 'character' || actor.isToken) return;
    syncAfterChange(actor);
  });
  Hooks.on('updateToken',(doc,changed,options,userId)=>{
    if (!isLocal(userId) || options?.[syncOption]) return;
    const pc = tokenPC(doc);
    if (!pc) return;
    // Explicit reassignment to another Actor adopts that Actor's side.
    if (Object.hasOwn(changed,'actorId')) {
      syncAfterChange(pc);
      return;
    }
    if (!valid(changed.disposition) || changed.disposition === pc.prototypeToken?.disposition) return;
    // Native token configuration is also an entry point, not a second side source.
    if (canUpdate(pc)) {
      void pc.update({'prototypeToken.disposition':changed.disposition}).catch(error=>{
        console.warn('Fast NRI | actor side update failed',error);
        syncAfterChange(pc);
      });
    } else {
      ui.notifications?.warn(game.i18n.localize('FASTNRI.ActorSide.actorPermission'));
      syncAfterChange(pc);
    }
  });
}
