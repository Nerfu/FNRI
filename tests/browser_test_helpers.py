"""Small shared helpers for representative Chromium tests, not a Foundry renderer."""
import re

def expand_actor_template(root, filename):
    source=(root/'templates'/filename).read_text()
    # The projection and standard sheets are mutually exclusive.
    if source.startswith('{{#if projectionSheet}}'):
        marker='{{else}}\n<section class="fnri-body fnri-actor-body">'
        assert marker in source
        source='<section class="fnri-body fnri-actor-body">'+source.split(marker,1)[1]
    def partial(match):
        name=match.group(1)
        assert name in {'actor-actions','actor-core-skill','actor-custom-skill','actor-standard-action','actor-short-rest','actor-resource','actor-abilities'}
        return re.sub(r'\{\{> fnri-([\w-]+)\}\}',partial,(root/'templates'/f'{name}.hbs').read_text())
    return re.sub(r'\{\{> fnri-([\w-]+)\}\}',partial,source)


def load_real_sheet(page, root, markup, shim, after=''):
    """Import actual modules offline, translating only relative ESM specifiers.

    The import map preserves module identities and cycles. Only Foundry's
    APIs/documents are mocked; no test server or external network is needed.
    """
    import base64,json
    root=root.resolve()
    paths=[*sorted((root/'module').rglob('*.mjs')),root/'tests/foundry-test-helpers.js']
    imports={}
    for file in paths:
        def specifier(match):
            target=(file.parent/match.group(3)).resolve()
            assert root in target.parents and target.is_file(),target
            return match.group(1)+match.group(2)+'fnri/'+target.relative_to(root).as_posix()+match.group(2)
        source=re.sub(r'(\bfrom\s+|\bimport\s+)([\"\'])(\.[^\"\']+)\2',specifier,file.read_text())
        key='fnri/'+file.relative_to(root).as_posix()
        imports[key]='data:text/javascript;base64,'+base64.b64encode(source.encode()).decode()
    page.set_content('<script type="importmap">'+json.dumps({'imports':imports})+'</script>'+markup)
    page.add_script_tag(content=shim)
    page.evaluate('''async () => {
        foundry.applications.handlebars ??= {loadTemplates: async()=>({})};
        const {FastNRICharacterSheet}=await import('fnri/module/sheets/sheets.mjs');
        const {sheetOptions}=await import('fnri/tests/foundry-test-helpers.js');
        window.FastNRICharacterSheet=FastNRICharacterSheet;
        window.sheetActions=sheetOptions(FastNRICharacterSheet).actions;
        window.sheet=new FastNRICharacterSheet({actor:window.actor});
        // Editing tests explicitly unlock the local configuration guard.
        window.sheet._configurationLocked=false;
        await window.sheet._onRender({},{});
    }''')
    if after:
        page.evaluate('()=>{'+after+'}')

# Narrow Handlebars subset for actual template previews (not Foundry).
renderer=r'''
window.renderSkill=(source,context,rootContext=context)=>{
 const tokens=source.split(/(\{\{\{[\s\S]*?\}\}\}|\{\{[\s\S]*?\}\})/g).filter(Boolean);
 const tag=t=>t.startsWith('{{')?t.replace(/^\{\{\{?|\}\}\}?$/g,'').trim():null;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function get(path,ctx){if(path==='this')return ctx;if(path.startsWith('@root.'))return path.slice(6).split('.').reduce((o,k)=>o?.[k],rootContext);return path.replace(/^this\./,'').split('.').reduce((o,k)=>o?.[k],ctx);}
 const truth=v=>Array.isArray(v)?v.length>0:!!v;
 function render(start,end,ctx){let out='';for(let i=start;i<end;i++){
  const t=tokens[i],key=tag(t);if(key===null){out+=t;continue;}
  if(key.startsWith('#')){const [kind,path]=key.slice(1).split(/\s+/);let depth=1,j=i+1,branches=[{start:j,condition:path}];
   for(;j<end;j++){const k=tag(tokens[j]);if(!k)continue;if(k.startsWith('#'))depth++;else if(k.startsWith('/')){if(--depth===0)break;}
    else if(depth===1&&k.startsWith('else')){branches.at(-1).end=j;branches.push({start:j+1,condition:k.startsWith('else if ')?k.slice(8):null});}}
   if(j===end)throw Error('Unclosed '+key);branches.at(-1).end=j;
   const val=get(path,ctx);
   if(kind==='each'){for(const item of val??[])out+=render(branches[0].start,branches[0].end,item);}
   else if(kind==='if'||kind==='unless'){const first=kind==='unless'?!truth(val):truth(val);const branch=first?branches[0]:branches.slice(1).find(b=>b.condition===null||truth(get(b.condition,ctx)));if(branch)out+=render(branch.start,branch.end,ctx);}
   else throw Error('Unsupported '+kind);i=j;continue;}
  if(key.startsWith('> fnri-')){out+=window.renderSkill(window.templates[key.slice(7)],ctx,rootContext);continue;}
  if(key.startsWith('localize ')){out+=esc(key.slice(9).replace(/^['"]|['"]$/g,''));continue;}
  const val=get(key,ctx);out+=t.startsWith('{{{')?String(val??''):esc(val);
 }return out;}
 return render(0,tokens.length,context);
};
'''
