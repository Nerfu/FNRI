/** Foundry can show a placeholder for a roll while hiding its content. */
export function canReadChatContent(message) {
  return Boolean(message && message.visible !== false && message.isContentVisible !== false);
}

export function chatAudience(message) {
  return {whisper:[...(message?.whisper ?? [])],blind:message?.blind === true};
}

/** Respect an existing GM subset. An ordinary or player-only source needs a
 * native GM whisper before it can carry a hidden recipient's data. */
export function gmChatAudience(message) {
  const gms = new Set((game.users?.contents ?? []).filter(user=>user.isGM).map(user=>user.id));
  if (game.user?.isGM) gms.add(game.user.id);
  const source = chatAudience(message);
  const included = source.whisper.filter(id=>gms.has(id));
  if (included.length) return {whisper:included,blind:source.blind};
  if (source.whisper.length && game.user?.isGM) return {whisper:[game.user.id],blind:source.blind};
  if (!gms.size) throw Error('No GM recipient available for a hidden area target');
  return {whisper:[...gms],blind:true};
}
