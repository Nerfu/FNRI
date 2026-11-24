/** Presentation state only. Incomplete allocation never restricts play. */
export function skillAllocationDisplay(allocation) {
  const showPool = allocation.free.length > 0;
  const complete = !showPool && !allocation.needsTradition && !(allocation.warnings?.length) &&
    allocation.upgrades.every(upgrade => Boolean(upgrade.target));
  return {showPool, complete};
}

export function summaryOpenAfterRefresh(previousComplete, previousOpen, complete) {
  return previousComplete === complete ? previousOpen : !complete;
}
