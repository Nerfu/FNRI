import {compilePack} from '@foundryvtt/foundryvtt-cli';
import {join} from 'node:path';
import {existsSync, rmSync, readdirSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const base=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(readFileSync(join(base,'system.json'),'utf8'));
for(const pack of manifest.packs ?? []) {
  if (!['Item','Actor'].includes(pack.type) || pack.system !== manifest.id) throw Error(`Invalid source pack: ${pack.name}`);
  const source=join(base,'packs','_source',pack.name);
  const destination=join(base,pack.path);
  if(!existsSync(source) || !readdirSync(source).some(n=>n.endsWith('.json'))) throw Error(`Empty source pack: ${pack.name}`);
  if(existsSync(destination)) rmSync(destination,{recursive:true,force:true});
  await compilePack(source,destination,{yaml:false});
  if(!existsSync(destination) || readdirSync(destination).length===0) throw Error(`No compiled LevelDB pack: ${pack.name}`);
  console.log(`Compiled ${pack.name}`);
}
