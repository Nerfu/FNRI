import { standardAction } from '../rolls/standard-actions.mjs';

const GROUPS = [
  ['maneuvers', ['trip', 'grapple', 'escape', 'reposition', 'shove']],
  ['movement', ['move', 'standingJump', 'runningJump', 'climb', 'step', 'stand', 'dash', 'swapPlaces']],
  ['assistance', ['prepare', 'aidAlly', 'freeAlly']],
  ['interventions', ['selfDefense', 'counteraction', 'dodge', 'quickStrike']]
];
const SKILL_ACTIONS = {
  athletics: ['climb', 'escape'], acrobatics: ['slip', 'escape'], stealth: ['hide'],
  medicine: ['firstAid'], deception: ['distract'], intimidation: ['demoralize']
};
const REST_ACTIONS = ['reload', 'bindWounds', 'fieldRecovery', 'recoverResource', 'endEffect'];
const PERSONAL_ACTIONS = ['coverAlly', 'combatMaster', 'invocation', 'doubleInvocation'];
const CONTEXT_ACTIONS = new Set(['selfDefense', 'counteraction', 'dodge', 'coverAlly']);
const LINKED_SKILL_ACTIONS = new Set(['climb', 'escape']);
const CATALOG_IDS = new Set([
  ...GROUPS.flatMap(([, ids]) => ids), ...Object.values(SKILL_ACTIONS).flat(),
  ...REST_ACTIONS, ...PERSONAL_ACTIONS, 'forceAidAlly', 'transferItem'
]);

export const sheetActionText = (id, field) => game.i18n.localize(`FASTNRI.SheetActions.cards.${id}.${field}`);
const contentId = item => item.getFlag('fast-nri-v14', 'contentId');
export function isFirearm(item) {
  if (item.type !== 'weapon') return false;
  const traits = item.system.mechanics?.weapon?.properties;
  return (Array.isArray(traits) && traits.includes('Огнестрельное')) ||
    /^(огнестрельное оружие|firearms?)$/i.test(String(item.system.category ?? '').trim());
}
export const isInvocationSpell = item => item.type === 'ability' && (
  item.system.mechanics?.invocation === true || /^fnri7\.rulebook\.ability\.warlock\.(blade|eldritch-blast|shadow-shield|projection|drain|black-needles)$/.test(contentId(item) ?? '')
);

export function sheetAction(id) {
  if (!CATALOG_IDS.has(id)) return null;
  return {
    id, name: sheetActionText(id, 'name'),
    builtinId: id === 'selfDefense' ? 'builtin:selfDefense' : null,
    roll: Boolean(standardAction(id)?.skillId), context: CONTEXT_ACTIONS.has(id),
    hasVariants: id === 'aidAlly', quickStrike: id === 'quickStrike'
  };
}

export function actionSections(items) {
  return GROUPS.map(([id, ids]) => {
    const cards = ids.map(sheetAction);
    if (id === 'interventions' && items.some(item =>
      item.type === 'ability' && (item.system.mechanics?.grantsAction === 'coverAlly' ||
        contentId(item) === 'fnri7.rulebook.racial.samootverzhennyi'))) cards.push(sheetAction('coverAlly'));
    return {id, title: game.i18n.localize(`FASTNRI.SheetActions.${id}`), cards};
  });
}

export function skillActionRows(skill) {
  return (Object.hasOwn(SKILL_ACTIONS, skill) ? SKILL_ACTIONS[skill] : []).map(id => ({
    ...sheetAction(id), link: LINKED_SKILL_ACTIONS.has(id)
  }));
}

export function shortRestActions(actor) {
  const className = String(actor.system.className ?? '').trim();
  return REST_ACTIONS.filter(id => {
    if (id === 'reload') return actor.items.contents.some(isFirearm);
    if (id === 'fieldRecovery') return /^(егерь|клерик|друид|колдун|ranger|cleric|druid|warlock)$/i.test(className);
    return true;
  }).map(sheetAction);
}

export function extraAbilityActions(items) {
  const double = items.find(item => item.type === 'ability' && (item.system.mechanics?.doubleInvocation === true ||
    contentId(item) === 'fnri7.rulebook.ability.warlock.double-invocation'));
  return [
    ...(items.some(isInvocationSpell) || double ? [sheetAction('invocation')] : []),
    ...(double ? [{...sheetAction('doubleInvocation'), itemId: double.id}] : [])
  ];
}
