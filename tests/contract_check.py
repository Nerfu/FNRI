#!/usr/bin/env python3
"""Local pre-release source verification. Never interacts with GitHub."""
import json,re,sys,zipfile,tempfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
manifest=json.loads((root/'system.json').read_text())
assert manifest['id']=='fast-nri-v14'
assert re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', manifest['version'])
assert manifest['download'] == f"https://github.com/Nerfu/FNRI/releases/download/v{manifest['version']}/fast-nri-v14.zip"
assert manifest['manifest'] == 'https://raw.githubusercontent.com/Nerfu/FNRI/main/system.json'
modules=[root/'main.mjs', *list((root/'module').rglob('*.mjs'))]
for path in modules:
    src=path.read_text()
    for name in re.findall(r'from\s+["\'](\.[^"\']+)["\']',src):
        dest=(path.parent/name).resolve()
        assert dest.is_file(), f'Missing import: {path} -> {dest}'

for language in ['en','ru']:
    obj=json.loads((root/'lang'/f'{language}.json').read_text())
    assert obj['TYPES']['Item']['item'], 'Legacy subtype localization missing'
    keys=[]
    for hbs in (root/'templates').glob('*.hbs'):
        src=hbs.read_text()
        keys.extend(re.findall(r'\{\{localize\s+["\']([^"\']+)["\']\}\}',src))
        for tag in re.findall(r'\{\{([^}]+)\}\}',src):
            assert not tag.count('"')%2, f'Unbalanced quotes in {hbs.name}: {tag[:70]}'
    for key in keys:
        ptr=obj
        for part in key.split('.'):
            assert part in ptr, f'Unknown {language} localization key {key}'
            ptr=ptr[part]
        assert isinstance(ptr,str)

for hbs in (root/'templates').glob('*.hbs'):
    src=hbs.read_text()
    assert src.count('{{')==src.count('}}'),f'Unbalanced Handlebars tokens: {hbs.name}'
    assert 'name="' in src and 'fnri-body' in src
for name in ('character','npc'):
    src=(root/'templates'/f'{name}.hbs').read_text()
    assert src.count('data-action="fnriSwitchTab"')==5
    assert src.count('data-fnri-target=')==5
    assert src.count('data-fnri-panel=')==5
    assert 'data-action="tab"' not in src
    assert src.count('fnri-tab-content')==5
    assert 'data-action="createItem"' in src
    assert 'name="system.equipment.leftHand"' in src
    assert 'name="system.equipment.rightHand"' in src
    assert 'data-row-collection="skills"' in src
    assert 'data-row-collection="resources"' in src
    assert 'data-row-field="dice"' in src
    assert 'data-row-field="kind"' in src
    assert 'data-action="addSpecialization"' in src
    assert 'data-row-collection="equipmentSlots"' in src
    assert 'data-action="addEquipmentSlot"' in src
    assert 'data-action="removeEquipmentSlot"' in src
    assert 'name="system.hp.current"' in src
    assert src.index('fnri-persistent') < src.index('fnri-tabs')
    assert src.index('name="system.hp.current"') < src.index('fnri-tabs')
    assert src.index('name="system.defenses.awareness"') < src.index('fnri-tabs')
    assert src.count('name="system.hp.current"') == 1
    assert 'name="system.wealth"' in src
    assert 'missingEquipment.leftHand' in src
    assert 'missingEquipment.armor' in src
    assert '{{#unless editable}}disabled{{/unless}}' in src
css=(root/'styles'/'fast-nri.css').read_text()
assert '.fnri-tab-content[hidden]' in css and 'overflow-y: auto !important' in css
assert '.fnri-persistent' in css and 'max-height: 650px' in css
models=(root/'module'/'data'/'models.mjs').read_text()
assert 'new F.TypedObjectField' in models
assert 'dice: text()' in models
assert 'kind: text()' in models
assert 'equipmentSlots: new F.TypedObjectField' in models
assert 'new F.ArrayField' not in models
sheets=(root/'module'/'sheets'/'sheets.mjs').read_text()
assert 'submitOnChange: false' in sheets
assert 'globalThis._del' in sheets
assert 'NUMERIC_ROW_FIELDS' in sheets
assert 'addSpecialization' in sheets and 'addEquipmentSlot' in sheets
assert 'this.render({ force: true })' not in sheets and 'fnriSwitchTab: ActorBase.changeTab' in sheets
assert 'items.filter(i => ["weapon", "gear", "item"]' not in sheets
files=[root/'system.json']
files.extend(root/p for p in manifest['esmodules']+manifest['styles'])
files.extend(root/obj['path'] for obj in manifest['languages'])
files.extend(p for folder in ('module','templates') for p in (root/folder).rglob('*') if p.is_file())
files=list(dict.fromkeys(files))
assert all(p.is_file() for p in files)
with tempfile.TemporaryDirectory() as folder:
    dest=Path(folder)/'test.zip'
    with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED) as z:
        for path in files:z.write(path,'fast-nri-v14/'+str(path.relative_to(root)))
    with zipfile.ZipFile(dest) as z:
        assert z.testzip() is None
        paths=z.namelist()
        assert all(p.startswith('fast-nri-v14/') and '/mnt/' not in p for p in paths)
        assert not any('/tests/' in p or '/docs/' in p for p in paths)
        assert len(paths)==len(set(paths))
print(f'PASS: {len(modules)} JS module(s), RU/EN localization, 5 tabs, persistent header, dynamic version, paths, and {len(files)} runtime file(s) in temporary ZIP')
