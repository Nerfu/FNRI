// FNRI game archives v1. Only data and raster images; no executable content.
const SYSTEM='fast-nri-v14';
const TYPES=['Folder','Item','Actor','JournalEntry','Scene'];
const COLLECTION={Folder:'folders',Item:'items',Actor:'actors',JournalEntry:'journal',Scene:'scenes'};
const MAX=128*1024*1024, SINGLE=32*1024*1024;
const ASSET=/^assets\/(?:(?:maps|portraits|tokens|illustrations)\/)?[a-z0-9][a-z0-9_-]*\.(webp|png|jpg|jpeg)$/;
const ID=/^[A-Za-z0-9]{16}$/;
const slug=/^[a-z0-9][a-z0-9-]{0,63}$/;
const own=(o,k)=>Object.hasOwn(o,k);
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fail=s=>{throw new Error(s)};
const check=(v,s)=>{if(!v)fail(s)};
const decoder=new TextDecoder('utf-8',{fatal:true});
const crcTable=Uint32Array.from({length:256},(_,i)=>{for(let k=0;k<8;k++)i=(i&1)?0xedb88320^(i>>>1):i>>>1;return i>>>0});
export function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
async function inflate(bytes,size){
  const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const out=new Uint8Array(size);let offset=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;check(offset+value.length<=size,'ZIP: превышен размер');out.set(value,offset);offset+=value.length;}}
  finally {await reader.cancel();}
  check(offset===size,'ZIP: неверный размер');return out;
}
// Central directory is authoritative; local name/flags/method checked against it.
export async function readGameZip(buffer){
  const b=new Uint8Array(buffer),d=new DataView(b.buffer,b.byteOffset,b.byteLength);
  check(b.length>=22&&b.length<=MAX,'ZIP: допустимо до 128 MiB');
  const u16=i=>d.getUint16(i,true),u32=i=>d.getUint32(i,true);
  let end=-1;for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(u32(i)===0x06054b50&&i+22+u16(i+20)===b.length){end=i;break;}
  check(end>=0,'ZIP: отсутствует каталог');
  const n=u16(end+10),start=u32(end+16),length=u32(end+12);
  check(!u16(end+4)&&!u16(end+6)&&u16(end+8)===n&&n>0&&n<=512&&start+length===end,'ZIP: неподдерживаемый каталог');
  const result=new Map();let total=0,p=start;
  for(let i=0;i<n;i++){
    check(p+46<=end&&u32(p)===0x02014b50,'ZIP: повреждён каталог');
    const flags=u16(p+8),method=u16(p+10),crc=u32(p+16),packed=u32(p+20),size=u32(p+24),nl=u16(p+28),xl=u16(p+30),cl=u16(p+32),local=u32(p+42);
    check(p+46+nl+xl+cl<=end&&!u16(p+34)&&!(flags&~0x080e)&&[0,8].includes(method),'ZIP: неподдерживаемая запись');
    const name=decoder.decode(b.subarray(p+46,p+46+nl));p+=46+nl+xl+cl;
    check(name==='game.json'||ASSET.test(name),'ZIP: недопустимый путь '+name);
    check(!result.has(name)&&size<=SINGLE&&(total+=size)<=MAX,'ZIP: дубликат или превышен лимит');
    check(local+30<=start&&u32(local)===0x04034b50&&u16(local+6)===flags&&u16(local+8)===method,'ZIP: неверный локальный заголовок');
    const ln=u16(local+26),lx=u16(local+28),data=local+30+ln+lx;
    check(data+packed<=start&&decoder.decode(b.subarray(local+30,local+30+ln))===name,'ZIP: неверное имя или размер');
    const raw=b.subarray(data,data+packed);const bytes=method===0?raw:await inflate(raw,size);
    check(bytes.length===size&&crc32(bytes)===crc,'ZIP: контрольная сумма '+name);
    result.set(name,{bytes,crc});
  }
  check(p===end&&result.has('game.json'),'ZIP: отсутствует game.json или лишние записи');return result;
}
function transform(value,assets){
  if(typeof value==='string')return value.replace(/@asset\/(assets\/(?:(?:maps|portraits|tokens|illustrations)\/)?[a-z0-9][a-z0-9_-]*\.(?:webp|png|jpg|jpeg))/g,(_,name)=>{check(assets.has(name),'Нет изображения '+name);return assets.get(name)});
  if(Array.isArray(value))return value.map(v=>transform(v,assets));
  if(obj(value))return Object.fromEntries(Object.entries(value).map(([k,v])=>{check(!['__proto__','constructor','prototype'].includes(k),'Недопустимый ключ');return [k,transform(v,assets)]}));
  return value;
}
function raster(name,bytes){const ext=name.split('.').at(-1);const s=(i,n)=>String.fromCharCode(...bytes.subarray(i,i+n));return ext==='webp'?s(0,4)==='RIFF'&&s(8,4)==='WEBP':ext==='png'?bytes[0]===137&&s(1,3)==='PNG':bytes[0]===255&&bytes[1]===216;}
export function planGameArchive(entries,worldId){
  check(/^[A-Za-z0-9_-]+$/.test(worldId),'Некорректный ID мира');
  const m=JSON.parse(decoder.decode(entries.get('game.json').bytes));
  check(obj(m)&&m.format==='fnri-game'&&m.schema===1&&m.system===SYSTEM&&slug.test(m.id)&&typeof m.title==='string'&&obj(m.documents),'Неизвестный формат игрового архива');
  const root=`worlds/${worldId}/fnri-game/${m.id}`;
  const assets=new Map();for(const [name,entry] of entries){if(name==='game.json')continue;check(raster(name,entry.bytes),'Некорректное изображение '+name);const parts=name.slice(7).split('/'),file=parts.pop();assets.set(name,`${root}/${parts.length?parts.join('/')+'/':''}${entry.crc.toString(16).padStart(8,'0')}-${file}`);}
  check(Object.keys(m.documents).every(k=>TYPES.includes(k)),'Неподдерживаемый тип документа');
  const docs={};const indexes={};
  for(const type of TYPES){const list=m.documents[type]??[];check(Array.isArray(list)&&list.length<=1000,'Некорректный список '+type);indexes[type]=new Map();docs[type]=list.map(source=>{
    check(obj(source)&&ID.test(source._id)&&typeof source.name==='string'&&source.name.trim()&&!indexes[type].has(source._id),'Некорректный ID или имя '+type);
    const row=transform(source,assets);check(!JSON.stringify(row).includes('@asset/'),'Неразрешённая ссылка на изображение');
    delete row._stats;delete row.pack;row.flags??={};check(obj(row.flags),'Некорректные flags');row.flags[SYSTEM]??={};check(obj(row.flags[SYSTEM]),'Некорректные flags FNRI');row.flags[SYSTEM].gameArchive=m.id;
    if(type==='Folder')check(['Actor','Item','JournalEntry','Scene'].includes(row.type)&&!row.folder,'В v1 допускаются только корневые папки');
    else {row.ownership={default:0};if(row.folder)check(indexes.Folder.get(row.folder)?.type===type,'Неверная папка '+row.name);}
    if(type==='Actor'){
      check(['npc','character'].includes(row.type),'Неизвестный тип Actor');
      const role=row.system?.role;
      if(typeof role==='string'&&role.startsWith('world-role:'))check(indexes.Item.get(role.slice(11))?.system?.mechanics?.roleDefinition?.version===1,'Нет карточки Роли '+row.name);
    }
    if(type==='Item'){
      check(['weapon','armor','gear','ability','item'].includes(row.type),'Неизвестный тип Item');
      const role=row.system?.mechanics?.roleDefinition;
      if(role!==undefined){check(row.type==='item'&&obj(role)&&role.version===1&&obj(role.defenses)&&Object.keys(role.defenses).every(k=>['awareness','reflex','fortitude','will'].includes(k)&&Number.isFinite(role.defenses[k])),'Неверная карточка Роли '+row.name);row.ownership={default:2};}
    }
    if(type==='Scene'){row.active=false;row.navigation=false;for(const token of row.tokens??[]){check(indexes.Actor.has(token.actorId),'Нет Actor токена '+token.name);if(token.level)check((row.levels??[]).some(l=>l._id===token.level),'Нет уровня токена '+token.name);}if(row.journal)check(indexes.JournalEntry.has(row.journal),'Нет журнала сцены');for(const note of row.notes??[])if(note.entryId)check(indexes.JournalEntry.has(note.entryId),'Нет журнала заметки');}
    indexes[type].set(row._id,row);return row;
  });}
  return {id:m.id,title:m.title,root,assets,docs};
}
function preflight(plan,collections){let skipped=0;const pending={};for(const type of TYPES){pending[type]=[];for(const row of plan.docs[type]){const existing=collections[type].get(row._id);if(!existing)pending[type].push(row);else {check(existing.getFlag(SYSTEM,'gameArchive')===plan.id,'Конфликт ID: '+type+' '+row.name);skipped++;}}}return {pending,skipped};}
async function ensureDirectory(picker,root){let parent=root.split('/').slice(0,2).join('/');for(const segment of root.split('/').slice(2)){const dir=parent+'/'+segment;const found=await picker.browse('data',parent);if(!found.dirs.includes(dir))await picker.createDirectory('data',dir);parent=dir;}return picker.browse('data',root);}
let importing=false;
export async function importGameArchive(file){
  check(game.user?.isGM,'Импорт доступен ведущему');check(!importing,'Импорт уже выполняется');importing=true;
  const report={created:0,skipped:0,uploaded:0};
  try {
    check(file&&file.size<=MAX,'Выберите ZIP до 128 MiB');const entries=await readGameZip(await file.arrayBuffer());const plan=planGameArchive(entries,game.world.id);
    const collections=Object.fromEntries(TYPES.map(t=>[t,game[COLLECTION[t]]]));const {pending,skipped}=preflight(plan,collections);report.skipped=skipped;
    const picker=foundry.applications.apps.FilePicker.implementation;
    if(plan.assets.size){const listings=new Map();for(const [name,path] of plan.assets){const dir=path.slice(0,path.lastIndexOf('/'));if(!listings.has(dir))listings.set(dir,await ensureDirectory(picker,dir));if(listings.get(dir).files.includes(path))continue;const ext=name.split('.').at(-1);const mime=ext==='webp'?'image/webp':ext==='png'?'image/png':'image/jpeg';const uploaded=await picker.upload('data',dir,new File([entries.get(name).bytes],path.split('/').at(-1),{type:mime}),{},{notify:false});check(uploaded?.path===path,'Не удалось загрузить '+name);report.uploaded++;}}
    for(const type of TYPES){const cls=CONFIG[type]?.documentClass??foundry.documents[type].implementation;for(const row of pending[type]){const old=collections[type].get(row._id);if(old){check(old.getFlag(SYSTEM,'gameArchive')===plan.id,'Конфликт ID: '+row.name);report.skipped++;continue;}const [created]=await cls.createDocuments([row],{keepId:true,keepEmbeddedIds:true});check(created?.id===row._id,'Foundry не сохранил ID: '+row.name);report.created++;}}
    return report;
  }catch(error){error.importReport=report;throw error;}finally{importing=false;}
}
export function registerGameArchive(){
  const {ApplicationV2,HandlebarsApplicationMixin}=foundry.applications.api;
  class GameArchiveMenu extends HandlebarsApplicationMixin(ApplicationV2){
    static DEFAULT_OPTIONS={id:'fnri-game-archive',tag:'form',window:{title:'FASTNRI.GameArchive.title'},position:{width:480},form:{closeOnSubmit:false,handler:async function(_event,form){const file=form.querySelector('input[type=file]').files[0];const status=form.querySelector('[data-import-status]');const button=form.querySelector('button');button.disabled=true;status.textContent=game.i18n.localize('FASTNRI.GameArchive.running');try{const r=await importGameArchive(file);status.textContent=game.i18n.format('FASTNRI.GameArchive.done',r);}catch(e){const r=e.importReport??{created:0,skipped:0,uploaded:0};status.textContent=game.i18n.format('FASTNRI.GameArchive.failed',{...r,error:e.message});console.error('Fast NRI | game archive',e);}finally{button.disabled=false;}}}};
    static PARTS={form:{template:'systems/fast-nri-v14/templates/game-archive.hbs'}};
  }
  game.settings.registerMenu(SYSTEM,'gameArchive',{name:'FASTNRI.GameArchive.title',label:'FASTNRI.GameArchive.button',hint:'FASTNRI.GameArchive.hint',icon:'fas fa-file-import',type:GameArchiveMenu,restricted:true});
}
