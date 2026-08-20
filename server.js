import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';

const root=process.cwd(), dataDir=path.join(root,'data');
const dirs={levels:path.join(dataDir,'levels'),drafts:path.join(dataDir,'drafts'),ui:path.join(dataDir,'ui'),uploads:path.join(dataDir,'uploads')};
const legacy=path.join(dataDir,'level.json');
const defaultLevel={backgroundColor:'#0b1b2b',gridColor:'#173a55',showGridInPlay:false,ui:'battle',walls:[{x:450,y:300,w:30,h:210}],enemies:[{x:730,y:130},{x:730,y:470},{x:180,y:460}],spawn:{x:130,y:300},triggers:[]};
const templates={
 blank:{name:'空白战斗场',level:{...defaultLevel,walls:[],enemies:[]}},
 training:{name:'训练场',level:{...defaultLevel,walls:[{x:450,y:300,w:30,h:210}],enemies:[]}},
 single:{name:'单波敌人',level:{...defaultLevel,enemies:[{x:730,y:300}]}},
 multi:{name:'多波敌人',level:{...defaultLevel,enemies:[{x:730,y:130},{x:730,y:470},{x:180,y:460},{x:760,y:300},{x:220,y:150}]}},
 defend:{name:'防守目标',level:{...defaultLevel,goal:{x:700,y:300},enemies:[{x:780,y:120},{x:780,y:480},{x:160,y:300}]}}
};
await Promise.all([fs.mkdir(dirs.levels,{recursive:true}),fs.mkdir(dirs.drafts,{recursive:true}),fs.mkdir(dirs.ui,{recursive:true}),fs.mkdir(dirs.uploads,{recursive:true})]);
const defaultUi={
 battle:{id:'battle',type:'battle',name:'战斗UI',nodes:[
  {id:'hpBar',type:'bar',x:40,y:40,w:360,h:28,fill:'#e84c5e',bg:'#3a1f2b',bind:{ratio:'hpRatio'}},
  {id:'hpText',type:'text',x:40,y:76,size:24,color:'#eaf4fb',bind:{text:'hpText'}},
  {id:'coinIcon',type:'icon',kind:'coin',x:1560,y:40,r:16},
  {id:'goldText',type:'text',x:1590,y:32,size:24,color:'#ffd54f',bind:{text:'gold'}},
  {id:'levelBar',type:'bar',x:40,y:1000,w:280,h:16,fill:'#4fc3f7',bg:'#2f5a7a',bind:{ratio:'expRatio'}},
  {id:'levelText',type:'text',x:40,y:964,size:20,color:'#9fc3d8',bind:{text:'level'}},
  {id:'killsText',type:'text',x:360,y:1000,size:20,color:'#eaf4fb',bind:{text:'kills'}}
 ]},
 interface:{id:'interface',type:'interface',name:'界面UI',nodes:[
  {id:'panel',type:'panel',x:360,y:140,w:1200,h:800,fill:'#0e2233',stroke:'#2f5a7a',alpha:0.95},
  {id:'title',type:'text',x:420,y:180,size:36,color:'#eaf4fb',text:'界面'},
  {id:'levelRow',type:'text',x:420,y:280,size:26,color:'#eaf4fb',bind:{text:'level'}},
  {id:'goldRow',type:'text',x:420,y:340,size:26,color:'#ffd54f',bind:{text:'gold'}},
  {id:'killsRow',type:'text',x:420,y:400,size:26,color:'#eaf4fb',bind:{text:'kills'}},
  {id:'close',type:'button',x:1460,y:180,w:64,h:64,label:'✕'}
 ],stats:[{key:'level',label:'等级'},{key:'exp',label:'经验',progress:true},{key:'gold',label:'金币'},{key:'kills',label:'击杀'}],sections:[]},
 login:{id:'login',type:'login',name:'登录UI',nodes:[
  {id:'logo',type:'image',x:96,y:96,w:96,h:86,src:'/logo.svg'},
  {id:'title',type:'text',x:184,y:70,size:64,color:'#ffffff',bold:true,text:'ARC ENGINE'},
  {id:'subtitle',type:'text',x:120,y:620,size:28,color:'#9fc3d8',text:'进入太空电梯井'},
  {id:'start',type:'button',x:120,y:700,w:420,h:76,fill:'#ff9d2e',label:'开始游戏'},
  {id:'startLabel',type:'text',x:322,y:724,size:32,color:'#ffffff',text:'开始游戏'},
  {id:'continue',type:'button',x:120,y:800,w:420,h:60,label:'继续游戏'},
  {id:'continueLabel',type:'text',x:306,y:816,size:24,color:'#ffffff',text:'继续游戏'},
  {id:'settings',type:'button',x:120,y:880,w:200,h:60,label:'设置'},
  {id:'settingsLabel',type:'text',x:200,y:894,size:22,color:'#ffffff',text:'设置'},
  {id:'exit',type:'button',x:340,y:880,w:200,h:60,label:'退出'},
  {id:'exitLabel',type:'text',x:420,y:894,size:22,color:'#ffffff',text:'退出'},
  {id:'version',type:'text',x:120,y:1010,size:20,color:'#9fc3d8',text:'v0.1.0'}
 ]}
};
for(const [id,value] of Object.entries(defaultUi)){
 const f=path.join(dirs.ui,`${id}.json`);
 try{await fs.access(f)}catch{await fs.writeFile(f,JSON.stringify(value,null,2))}
}
try{const files=await fs.readdir(dirs.levels);if(!files.length){let value=defaultLevel;try{value=JSON.parse(await fs.readFile(legacy,'utf8'))}catch{}await fs.writeFile(path.join(dirs.levels,'level-1.json'),JSON.stringify(value,null,2))}}catch{}
const json=(res,value,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))};
async function body(req){let text='';for await(const c of req)text+=c;return JSON.parse(text||'{}')}
async function rawBody(req){const chunks=[];for await(const c of req)chunks.push(c);return Buffer.concat(chunks)}
async function list(kind){return (await fs.readdir(dirs[kind])).filter(x=>x.endsWith('.json')).map(x=>x.slice(0,-5)).sort()}
async function migrateLegacyDraft(){const legacyDraft=path.join(dataDir,'draft.json');try{const drafts=await list('drafts');if(!drafts.length){const value=JSON.parse(await fs.readFile(legacyDraft,'utf8'));await fs.writeFile(path.join(dirs.drafts,'level-1.json'),JSON.stringify(value,null,2))}}catch{}}
await migrateLegacyDraft();
async function file(kind,id){return path.join(dirs[kind],`${id}.json`)}
const vite=await createViteServer({root,server:{middlewareMode:true}});
const server=(await import('node:http')).createServer(async(req,res)=>{
 const url=new URL(req.url,`http://${req.headers.host||'localhost'}`), parts=url.pathname.split('/').filter(Boolean);
 if(parts[0]==='api'){
  try{
   if(parts[1]==='levels'){
    if(parts.length===2&&req.method==='GET')return json(res,{levels:await list('levels')});
    const id=parts[2]; if(!id||!/^[-\w]+$/.test(id))return json(res,{error:'Invalid id'},400);
    if(req.method==='GET')return json(res,JSON.parse(await fs.readFile(await file('levels',id),'utf8')));
    if(req.method==='POST'){const value=await body(req);await fs.writeFile(await file('levels',id),JSON.stringify(value,null,2));return json(res,{ok:true})}
    if(req.method==='DELETE'){await fs.rm(await file('levels',id),{force:true});await fs.rm(await file('drafts',id),{force:true});return json(res,{ok:true})}
   }
   if(parts[1]==='drafts'){
    const id=parts[2];if(req.method==='GET')return json(res,JSON.parse(await fs.readFile(await file('drafts',id),'utf8')));if(req.method==='POST'){await fs.writeFile(await file('drafts',id),JSON.stringify(await body(req),null,2));return json(res,{ok:true})}if(req.method==='DELETE'){await fs.rm(await file('drafts',id),{force:true});return json(res,{ok:true})}
   }
   if(parts[1]==='templates'&&req.method==='GET')return json(res,templates);
   if(parts[1]==='flow'){if(req.method==='GET'){try{return json(res,JSON.parse(await fs.readFile(path.join(dataDir,'flow.json'),'utf8')))}catch{return json(res,{version:2,flows:{game:{name:'游戏流程',entry:'',nodes:[]},tutorial:{name:'教程流程',entry:'',nodes:[]}}})}}if(req.method==='POST'){await fs.writeFile(path.join(dataDir,'flow.json'),JSON.stringify(await body(req),null,2));return json(res,{ok:true})}}
   if(parts[1]==='draft'||parts[1]==='level'){const kind=parts[1]==='draft'?'drafts':'levels',id=parts[2]||'level-1';if(req.method==='GET')return json(res,JSON.parse(await fs.readFile(await file(kind,id),'utf8')));if(req.method==='POST'){await fs.writeFile(await file(kind,id),JSON.stringify(await body(req),null,2));return json(res,{ok:true})}}
   if(parts[1]==='ui'){
    const id=parts[2];
    if(!id||!/^[-\w]+$/.test(id))return json(res,{error:'Invalid id'},400);
    const f=path.join(dirs.ui,`${id}.json`);
    if(req.method==='GET'){try{return json(res,JSON.parse(await fs.readFile(f,'utf8')))}catch{return json(res,defaultUi[id]||{id,name:id,nodes:[]})}}
    if(req.method==='POST'){await fs.writeFile(f,JSON.stringify(await body(req),null,2));return json(res,{ok:true})}
   }
   if(parts[1]==='uploads'&&req.method==='POST'){
    const buf=await rawBody(req);
    const ct=(req.headers['content-type']||'').toLowerCase();
    const ext=ct.includes('png')?'png':ct.includes('webp')?'webp':ct.includes('gif')?'gif':ct.includes('svg')?'svg':'jpg';
    const name=`${Date.now()}-${Math.round(Math.random()*1e6)}.${ext}`;
    await fs.writeFile(path.join(dirs.uploads,name),buf);
    return json(res,{path:`/uploads/${name}`});
   }
   return json(res,{error:'Not found'},404);
  }catch(e){return json(res,{error:'Not found'},404)}
 }
 if(parts[0]==='uploads'){
  const name=parts[1];
  if(!name||!/^[\w.-]+$/.test(name))return json(res,{error:'Invalid'},400);
  const ext=path.extname(name).slice(1).toLowerCase();
  const types={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',svg:'image/svg+xml'};
  res.setHeader('Content-Type',types[ext]||'application/octet-stream');
  res.setHeader('Cache-Control','no-store');
  try{return res.end(await fs.readFile(path.join(dirs.uploads,name)))}catch{return json(res,{error:'Not found'},404)}
 }
 vite.middlewares(req,res);
});
const port=Number(process.env.PORT||5173);
server.on('error',error=>{if(error.code==='EADDRINUSE'){console.error(`Port ${port} is already in use. Stop existing dev server or run with PORT=5174 npm run dev`);process.exit(1)}throw error});
server.listen(port,()=>console.log(`Editor running at http://localhost:${port}`));
