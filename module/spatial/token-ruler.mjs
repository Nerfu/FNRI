const {TokenRuler} = foundry.canvas.placeables.tokens;
const pluralRules = {ru: new Intl.PluralRules('ru'), en: new Intl.PluralRules('en')};

function plannedMovementCost(destination) {
  const segments = [];
  for (let waypoint = destination; waypoint?.stage === 'planned'; waypoint = waypoint.previous) {
    const segment = waypoint.measurement?.backward;
    if (segment && segment.spaces !== 0) segments.push(segment);
  }
  if (!segments.length) return null;

  let cells = 0;
  let diagonals = 0;
  for (const segment of segments.reverse()) {
    const {spaces, diagonals: newDiagonals, distance, cost} = segment;
    if (!Number.isSafeInteger(spaces) || spaces < 1 ||
        !Number.isSafeInteger(newDiagonals) || newDiagonals < 0 || newDiagonals > spaces ||
        !Number.isFinite(distance) || distance <= 0 || !Number.isFinite(cost) || cost < 0) return null;

    const nextDiagonals = diagonals + newDiagonals;
    const extra = Math.floor(nextDiagonals / 2) - Math.floor(diagonals / 2);
    // Preserve the native movement multiplier while pricing the diagonal steps
    // from the start of this drag instead of reusing Foundry's running total.
    cells += (spaces + extra) * (cost / distance);
    diagonals = nextDiagonals;
  }
  return Number.isFinite(cells) ? cells : null;
}

/** Render the planned drag with Foundry's native ruler. */
export class FastNRITokenRuler extends TokenRuler {
  static WAYPOINT_LABEL_TEMPLATE = 'systems/fast-nri-v14/templates/token-ruler-label.hbs';

  async draw() {
    await foundry.applications.handlebars.loadTemplates([TokenRuler.WAYPOINT_LABEL_TEMPLATE]);
    return super.draw();
  }

  refresh(rulerData) {
    // The native ruler can draw both the token's history and the history
    // attached to each user's plan. Keep only the current drag in its input.
    const plannedMovement = Object.fromEntries(
      Object.entries(rulerData.plannedMovement ?? {}).map(([userId, plan]) =>
        [userId, {...plan, history: []}])
    );
    super.refresh({...rulerData, passedWaypoints: [], pendingWaypoints: [], plannedMovement});
  }

  _getWaypointLabelContext(waypoint, state) {
    const context = super._getWaypointLabelContext(waypoint, state);
    if (!context || !canvas.grid?.isSquare || waypoint.stage !== 'planned') return context;
    if (waypoint.next) return;
    if (waypoint.unreachable) return context;

    const cells = plannedMovementCost(waypoint);
    if (cells === null) return context;
    const language = game.i18n.lang === 'ru' ? 'ru' : 'en';
    const rounded = Number(cells.toFixed(2));
    const category = pluralRules[language].select(rounded);
    const count = rounded.toLocaleString(language, {maximumFractionDigits: 2});
    return {
      ...context,
      fnriMovementLabel: game.i18n.format(`FASTNRI.MovementRuler.${category}`, {count})
    };
  }
}
