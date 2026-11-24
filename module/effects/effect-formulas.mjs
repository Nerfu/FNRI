/**
 * Declarative, per-ActiveEffect-change calculations for Foundry VTT v14.
 *
 * This is deliberately NOT a JS/Foundry Roll evaluator: ActiveEffect change
 * values must be deterministic numeric values and must never roll dice or
 * execute code during Actor data preparation. Legacy effects remain untouched.
 */
export const CALC_SCOPE = 'fast-nri-v14';
export const CALC_KEY = 'changeCalculations';
const MAX_FORMULA = 256;
const MAX_TOKENS = 120;
const MAX_DEPTH = 24;
const MAX_RESULT = 1e12;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const FUNCTIONS = Object.freeze({
  abs: { n: 1, call: Math.abs },
  floor: { n: 1, call: Math.floor },
  ceil: { n: 1, call: Math.ceil },
  round: { n: 1, call: Math.round },
  min: { n: 2, call: Math.min },
  max: { n: 2, call: Math.max },
  clamp: { n: 3, call: (n, lo, hi) => Math.min(Math.max(n, lo), hi) }
});

function finite(value) {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_RESULT) throw Error('Non-finite/out-of-range formula result');
  return value;
}

/** Safe formula grammar: numbers, + - * /, parentheses, listed functions, numeric @variables. */
export function evaluateEffectFormula(formula, { state = {}, actor = null, deferActor = false } = {}) {
  const source = String(formula ?? '').trim();
  if (!source || source.length > MAX_FORMULA) throw Error('Formula is missing or too long');
  const tokens = [];
  const rx = /\s*(@[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*|(?:\d+(?:\.\d*)?|\.\d+)|[()+\-*/,]|[A-Za-z][A-Za-z0-9]*)/y;
  let cursor = 0;
  while (cursor < source.length) {
    rx.lastIndex = cursor;
    const match = rx.exec(source);
    if (!match) {
      if (source.slice(cursor).trim() === '') break;
      throw Error('Unsupported character in formula');
    }
    tokens.push(match[1]);
    if (tokens.length > MAX_TOKENS) throw Error('Formula is too complex');
    cursor = rx.lastIndex;
  }
  if (!tokens.length) throw Error('Empty formula');
  let pos = 0;
  const peek = () => tokens[pos];
  const accept = value => peek() === value ? (pos++, true) : false;
  const require = value => { if (!accept(value)) throw Error(`Expected ${value}`); };
  const resolve = token => {
    const name = token.slice(1);
    if (['strength', 'effectLevel', 'magnitude'].includes(name)) {
      const n = state[name];
      if (typeof n !== 'number') throw Error(`Missing numeric @${name}`);
      return finite(n);
    }
    if (!name.startsWith('actor.system.')) throw Error(`Unsupported variable @${name}`);
    if (!actor && deferActor) return 1; // Syntax-only probe; never persist its result.
    const segments = name.slice('actor.'.length).split('.');
    if (segments.some(s => FORBIDDEN.has(s))) throw Error('Forbidden actor data path');
    // Read only actor.system (source data), not prepared/derived values modified by this effect.
    const root = typeof actor?.toObject === 'function' ? actor.toObject(true) : actor;
    let current = root;
    for (const segment of segments) {
      if (!current || typeof current !== 'object' || !Object.hasOwn(current, segment))
        throw Error(`Unknown numeric @${name}`);
      current = current[segment];
    }
    if (typeof current !== 'number') throw Error(`Non-numeric @${name}`);
    return finite(current);
  };
  const expression = (depth = 0) => {
    let result = product(depth + 1);
    while (peek() === '+' || peek() === '-') {
      const op = tokens[pos++];
      const right = product(depth + 1);
      result = finite(op === '+' ? result + right : result - right);
    }
    return result;
  };
  const product = depth => {
    let result = unary(depth + 1);
    while (peek() === '*' || peek() === '/') {
      const op = tokens[pos++];
      const right = unary(depth + 1);
      if (op === '/' && right === 0) throw Error('Division by zero');
      result = finite(op === '*' ? result * right : result / right);
    }
    return result;
  };
  const unary = depth => {
    if (depth > MAX_DEPTH) throw Error('Formula nesting too deep');
    if (accept('+')) return unary(depth + 1);
    if (accept('-')) return finite(-unary(depth + 1));
    if (accept('(')) {
      const value = expression(depth + 1);
      require(')');
      return value;
    }
    const token = tokens[pos++];
    if (!token) throw Error('Incomplete formula');
    if (token.startsWith('@')) return resolve(token);
    if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) return finite(Number(token));
    const fn = FUNCTIONS[token];
    if (!fn) throw Error(`Unknown function ${token}`);
    require('(');
    const args = [];
    for (let i = 0; i < fn.n; i++) {
      if (i) require(',');
      args.push(expression(depth + 1));
    }
    require(')');
    return finite(fn.call(...args));
  };
  const value = expression();
  if (pos !== tokens.length) throw Error('Unexpected token in formula');
  return finite(value);
}

function changeAnchor(change) {
  return JSON.stringify([String(change?.key ?? ''), String(change?.type ?? change?.mode ?? ''),
    String(change?.phase ?? ''), Number(change?.priority ?? 0)]);
}
function currentChanges(effect) {
  return Array.isArray(effect?.system?.changes) ? effect.system.changes : [];
}
function actorFor(effect) {
  return effect?.parent?.documentName === 'Actor' ? effect.parent :
    effect?.parent?.documentName === 'Item' ? effect.parent.parent : null;
}
/**
 * Reconcile saved metadata to v14 change rows. No native row has a persistent ID;
 * only an unambiguous (anchor + last written value) match may be rebound.
 * A native edit of a value invalidates Auto rather than silently overwriting it.
 */
export function readEffectChangeRows(effect) {
  const changes = currentChanges(effect);
  const stored = effect?.flags?.[CALC_SCOPE]?.[CALC_KEY]?.rows;
  const saved = Array.isArray(stored) ? stored : [];
  const assigned = new Set();
  return changes.map((change, index) => {
    const anchor = changeAnchor(change);
    const byIndex = saved.find((row, pos) => !assigned.has(pos) && row.index === index && row.anchor === anchor &&
      String(row.appliedValue ?? '') === String(change.value ?? ''));
    let match = byIndex;
    if (!match) {
      const candidates = saved.filter((row, pos) => !assigned.has(pos) && row.anchor === anchor &&
        String(row.appliedValue ?? '') === String(change.value ?? ''));
      if (candidates.length === 1) match = candidates[0];
    }
    if (match) assigned.add(saved.indexOf(match));
    return {
      id: match?.id ?? `change-${index}`,
      index, anchor, key: String(change.key ?? ''), type: String(change.type ?? change.mode ?? 'add'),
      formula: typeof match?.formula === 'string' ? match.formula : '',
      auto: match?.auto !== false && Boolean(String(match?.formula ?? '').trim()),
      manualValue: match ? String(match.manualValue ?? '') : String(change.value ?? ''),
      appliedValue: String(change.value ?? ''),
      detached: !match && saved.some(row => row.index === index || row.anchor === anchor)
    };
  });
}

export function calculateEffectChangePlan(effect, { rows = readEffectChangeRows(effect), state = {}, actor = actorFor(effect), strict = true, deferActor = false } = {}) {
  const current = currentChanges(effect);
  if (rows.length !== current.length) throw Error('ActiveEffect change rows changed while editing');
  const nextChanges = current.map(change => typeof change?.toObject === 'function' ? change.toObject() : ({ ...change }));
  const errors = [];
  const nextRows = [];
  for (const [index, row] of rows.entries()) {
    if (row.index !== index || row.anchor !== changeAnchor(current[index]))
      throw Error('ActiveEffect change row identity changed');
    const formula = String(row.formula ?? '').trim();
    const auto = row.auto === true && formula.length > 0;
    let value = auto ? String(current[index].value ?? '') : String(row.manualValue ?? '');
    if (auto) {
      try {
        // Referencing the target attribute itself would feed a value back into
        // its own ActiveEffect change and produce unstable Actor preparation.
        const targetPath = String(current[index]?.key ?? '');
        if (targetPath.startsWith('system.') && formula.includes(`@actor.${targetPath}`))
          throw Error('Effect formula cannot reference its own target attribute');
        if (deferActor && !actor && formula.includes('@actor.system.')) {
          // World/compendium Item templates have no target Actor yet. Parse
          // and validate the expression but keep the current placeholder
          // numeric value until a real target is selected on application.
          evaluateEffectFormula(formula, {state, actor:null, deferActor:true});
          value = String(current[index].value ?? '');
        } else {
          value = String(evaluateEffectFormula(formula, {state, actor}));
        }
      } catch (error) {
        errors.push({index, message:String(error?.message ?? error)});
        if (strict) throw Error(`Change ${index + 1}: ${error.message}`);
        // An invalid formula must not block unrelated changes or destroy a manual value.
        value = String(current[index].value ?? '');
      }
    }
    nextChanges[index].value = value;
    nextRows.push({id: String(row.id || `change-${index}`),index,anchor:row.anchor,
      formula,auto,manualValue:String(row.manualValue ?? ''),appliedValue:value});
  }
  return { changes:nextChanges, metadata:{schema:1,rows:nextRows},errors,
    changed:nextChanges.some((change,index)=>String(change.value) !== String(current[index].value)) };
}

/** Recalculate existing automatic rows on changes to strength/level.
 * Only call this after verifying ownership; caller owns the resulting update.
 */
export function recalculationPatch(effect, state) {
  const rows=readEffectChangeRows(effect);
  if (!rows.some(row=>row.auto)) return null;
  const plan=calculateEffectChangePlan(effect,{rows,state,strict:false});
  if (!plan.changed && !plan.errors.length) return null;
  // On missing variables keep previous numeric value and expose errors in the editor.
  return { 'system.changes':plan.changes,
    [`flags.${CALC_SCOPE}.${CALC_KEY}`]:plan.metadata, errors:plan.errors };
}

/**
 * Event-driven update for numeric formulas reading the Actor's SOURCE system.
 * Only the client that caused updateActor should invoke this helper. All other
 * clients receive the resulting effect document update via Foundry sync.
 * No polling or persistent action history is introduced.
 */
export async function refreshActorDependentFormulas(actor, changes) {
  if (!actor?.isOwner || !changes || !Object.keys(changes).some(k => k === 'system' || k.startsWith('system.')))
    return {updated:0,errors:[]};
  const effects = typeof actor.allApplicableEffects === 'function'
    ? [...actor.allApplicableEffects()] : [...(actor.effects?.contents ?? [])];
  let updated=0;
  const errors=[];
  for (const effect of effects) {
    const parent=effect?.parent;
    if (!(parent === actor || (parent?.documentName === 'Item' && parent.parent === actor))) continue;
    if (!parent?.isOwner || !effect?.update) continue;
    const rows=readEffectChangeRows(effect);
    if (!rows.some(row=>row.auto && row.formula.includes('@actor.system.'))) continue;
    try {
      const state=effect?.flags?.[CALC_SCOPE]?.effectState ?? {};
      const patch=recalculationPatch(effect,state);
      if (!patch) continue;
      const {errors:rowErrors,...update}=patch;
      if (!patch['system.changes']) continue;
      if (rowErrors.length) errors.push({effect:effect.uuid,errors:rowErrors});
      if (patch['system.changes'].every((row,i) => String(row.value) === String(effect.system.changes[i]?.value))) continue;
      await effect.update(update);
      updated++;
    } catch(error) {
      errors.push({effect:effect?.uuid,errors:[String(error?.message ?? error)]});
    }
  }
  return {updated,errors};
}
