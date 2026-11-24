const VARIANT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A whole Item is still a single option unless it declares its own variants. */
export function directedInterventionVariants(item) {
  const raw = item.system?.mechanics?.intervention;
  const root = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!Array.isArray(root?.variants)) return [{id: null, label: null, rule: root}];

  const {variants, ...common} = root;
  const seen = new Set();
  return variants.flatMap(variant => {
    const id = typeof variant?.id === 'string' ? variant.id : '';
    const label = typeof variant?.label === 'string' ? variant.label.trim() : '';
    if (!VARIANT_ID.test(id) || !label || seen.has(id)) return [];
    seen.add(id);
    return [{id, label, rule: {...common, ...variant}}];
  });
}
