/** Real UTC epoch milliseconds, synchronized to Foundry's server clock.
 *  In observers' journals, Intl uses each client's local time zone.
 *  Not in-game worldTime and never an ability cooldown clock.
 */
export function serverTimestamp() {
  const synchronized = game.time?.serverTime;
  return Number.isFinite(synchronized) ? synchronized : Date.now();
}
