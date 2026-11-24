// Foundry document IDs are 16 alphanumeric characters. A repeat of the same
// native create uses the same ID, including when another client submits it.
export function stableDocumentId(prefix, key) {
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(JSON.stringify(key))) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  }
  return prefix + hash.toString(36).padStart(13, '0');
}
