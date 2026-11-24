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
        assert name in {'actor-actions','actor-core-skill','actor-custom-skill','actor-standard-action','actor-short-rest'}
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
