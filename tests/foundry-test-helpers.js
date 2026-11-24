/** Minimal test-only adapters for the v14 sheet and DialogV2 contracts. */
export function sheetOptions(Sheet) {
  const chain=[];
  for(let cls=Sheet;cls && cls!==Function.prototype;cls=Object.getPrototypeOf(cls)) {
    if(Object.hasOwn(cls,'DEFAULT_OPTIONS'))chain.unshift(cls.DEFAULT_OPTIONS);
  }
  return chain.reduce((out,opts)=>({...out,...opts,
    actions:{...out.actions,...opts.actions},form:{...out.form,...opts.form}}),{});
}
// Exercise the real dialog callback, accepting the actual default checkbox values.
export async function acceptPreroll(config) {
  const fields=new Map();
  for(const [,tag,name] of config.content.matchAll(/(<input\b[^>]*\bname="(part_\d+_\d+)"[^>]*>)/g)) {
    fields.set(name,{checked:/\bchecked\b/.test(tag)});
  }
  return config.buttons.find(b=>b.action==='roll').callback({}, {form:{
    elements:{namedItem:name=>fields.get(name)??null},querySelectorAll:()=>[]
  }});
}
export function installTemplateMock() {
  globalThis.foundry.applications.handlebars??={loadTemplates:async()=>({})};
}
