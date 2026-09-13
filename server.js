import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const defaultLevel={backgroundColor:'#0b1b2b',gridColor:'#173a55',showGridInPlay:false,ui:'battle',walls:[{x:450,y:300,w:30,h:210}],enemies:[{x:730,y:130},{x:730,y:470},{x:180,y:460}],spawn:{x:130,y:300},triggers:[]};
const templates={
 single:{name:'单箱庭关卡',level:{...defaultLevel,walls:[],enemies:[]}},
 multi:{name:'多箱庭关卡',level:{
  ...defaultLevel,walls:[],enemies:[],
  roomLayout:{mode:'multi',cols:4,rows:4,wallThickness:30,roadWidth:448,roadLength:560,cells:[{c:0,r:1},{c:1,r:1},{c:2,r:1}]}
 }}
};
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
 ]},
 'idol-buffs':{id:'idol-buffs',offerCount:3,buffs:[
  {id:'atk',name:'力量祝福',desc:'攻击力 +15%',icon:'asset-1787970208151',stats:{attackPower:{op:'mul',value:1.15}}},
  {id:'crit',name:'致命祝福',desc:'暴击率 +10%',icon:'',stats:{critRate:{op:'add',value:0.1}}},
  {id:'dodge',name:'迅捷祝福',desc:'闪避率 +8%',icon:'',stats:{dodgeRate:{op:'add',value:0.08}}},
  {id:'speed',name:'疾风祝福',desc:'移动速度 +12%',icon:'',stats:{moveSpeed:{op:'mul',value:1.12}}},
  {id:'hp',name:'生命祝福',desc:'生命上限 +25',icon:'',stats:{maxHp:{op:'add',value:25}}},
  {id:'reduction',name:'守护祝福',desc:'受到伤害 -10%',icon:'',stats:{damageReduction:{op:'mul',value:0.9}}}
 ]}
};
const MIME={
 '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
 '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml',
 '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif',
 '.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf'
};

export async function startServer(options = {}) {
  const root = options.root || process.cwd();
  const isPackaged = !!options.isPackaged;
  const dataRoot = options.dataRoot || path.join(root, 'data');
  const levelsDir = options.levelsDir || path.join(dataRoot, 'levels');
  const uiDir = options.uiDir || path.join(dataRoot, 'ui');
  const staticDir = options.staticDir || null;
  const host = options.host;
  const port = options.port ?? (isPackaged ? 0 : Number(process.env.PORT || 5173));
  // 图标素材目录（编辑器下拉选择用），开发模式指向项目根下的「图标」文件夹
  const iconsDir = options.iconsDir || path.join(root, '图标');

  const dirs = {
    levels: levelsDir,
    ui: uiDir,
    uploads: path.join(dataRoot, 'uploads'),
    players: path.join(dataRoot, 'players'),
    testPlayers: path.join(dataRoot, 'test-players'),
    assets: path.join(dataRoot, 'assets'),
    weapons: path.join(dataRoot, 'weapons'),
    pets: path.join(dataRoot, 'pets'),
    outlines: path.join(dataRoot, 'outlines'),
    pixels: path.join(dataRoot, 'pixels'),
    uiDesigns: options.uiDesignsDir || path.join(root, 'docs', 'ui-designs')
  };

  // 打包模式：优先使用只读内置资源；若内置目录缺失则回退可写目录，保证进程仍可启动。
  if (isPackaged) {
    for (const key of ['levels', 'ui']) {
      const preferred = key === 'levels' ? levelsDir : uiDir;
      try {
        const st = await fs.stat(preferred);
        if (st.isDirectory()) dirs[key] = preferred;
        else throw new Error('not a directory');
      } catch {
        dirs[key] = path.join(dataRoot, key);
      }
    }
  }

  const legacy = path.join(dataRoot, 'level.json');

  await fs.mkdir(dirs.uploads, { recursive: true });
  await fs.mkdir(dirs.players, { recursive: true });
  await fs.mkdir(dirs.testPlayers, { recursive: true });
  await fs.mkdir(dirs.assets, { recursive: true });
  await fs.mkdir(dirs.weapons, { recursive: true });
  await fs.mkdir(dirs.pets, { recursive: true });
  await fs.mkdir(dirs.outlines, { recursive: true });
  await fs.mkdir(dirs.pixels, { recursive: true });
  await fs.mkdir(dirs.uiDesigns, { recursive: true });

  // 开发模式：levels/ui 属于项目 data/，可写且需要补齐默认内容。
  // 打包模式：levels/ui 来自只读内置资源，不做任何写入与补齐。
  if (!isPackaged) {
    await fs.mkdir(dirs.levels, { recursive: true });
    await fs.mkdir(dirs.ui, { recursive: true });
    for (const [id, value] of Object.entries(defaultUi)) {
      const f = path.join(dirs.ui, `${id}.json`);
      try { await fs.access(f); } catch { await fs.writeFile(f, JSON.stringify(value, null, 2)); }
    }
    try {
      const files = await fs.readdir(dirs.levels);
      if (!files.length) {
        let value = defaultLevel;
        try { value = JSON.parse(await fs.readFile(legacy, 'utf8')); } catch {}
        await fs.writeFile(path.join(dirs.levels, 'level-1.json'), JSON.stringify(value, null, 2));
      }
    } catch {}
  }

  const json = (res, value, status = 200) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(value));
  };
  async function body(req) { let text = ''; for await (const c of req) text += c; return JSON.parse(text || '{}'); }
  async function rawBody(req) { const chunks = []; for await (const c of req) chunks.push(c); return Buffer.concat(chunks); }
  async function list(kind) { return (await fs.readdir(dirs[kind])).filter(x => x.endsWith('.json')).map(x => x.slice(0, -5)).sort(); }
  async function file(kind, id) { return path.join(dirs[kind], `${id}.json`); }

  const playersIndex = path.join(dirs.players, 'index.json');
  async function readJson(f, fallback) { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return fallback ? structuredClone(fallback) : null; } }
  async function writeJson(f, value) { await fs.writeFile(f, JSON.stringify(value, null, 2)); }
  async function listPlayers() { return await readJson(playersIndex, []); }
  async function savePlayers(slots) { await writeJson(playersIndex, slots); }

  const testPlayersIndex = path.join(dirs.testPlayers, 'index.json');
  async function listTestPlayers() { return await readJson(testPlayersIndex, []); }
  async function saveTestPlayers(slots) { await writeJson(testPlayersIndex, slots); }

  // 策划表格 → 内购数据：开发期优先实时解析 xlsx（按三份表 mtime 缓存），
  // 解析失败（文件缺失/被占用/格式异常/打包环境无 exceljs）时回退 data/inner-shop.json。
  const tablesDir = options.tablesDir || path.join(root, '策划文档', 'server');
  const TABLE_FILES = ['消耗品.xlsx', '武器.xlsx', '老虎机.xlsx'];
  const innerShopEmpty = { consumables: [], weapons: [], lottery: { drawCost: 15, goldPrize: 15, kinds: [] } };
  let innerShopCache = { key: '', value: null };
  async function tableMtimeKey() {
    const parts = [];
    for (const name of TABLE_FILES) {
      try { const st = await fs.stat(path.join(tablesDir, name)); parts.push(String(st.mtimeMs)); }
      catch { parts.push('missing'); }
    }
    return parts.join('|');
  }
  async function readInnerShopFallback() {
    try {
      const doc = JSON.parse(await fs.readFile(path.join(dataRoot, 'inner-shop.json'), 'utf8'));
      if (doc && Array.isArray(doc.consumables) && Array.isArray(doc.weapons) && doc.lottery) return doc;
    } catch {}
    return structuredClone(innerShopEmpty);
  }
  async function getInnerShop() {
    const key = await tableMtimeKey();
    if (innerShopCache.value && innerShopCache.key === key) return innerShopCache.value;
    try {
      const { buildInnerShop } = await import('./tools/export-tables.mjs');
      const value = await buildInnerShop({ tablesDir });
      innerShopCache = { key, value };
      return value;
    } catch (e) {
      console.warn('[inner-shop] 解析策划表格失败，回退 data/inner-shop.json：', e.message);
      return await readInnerShopFallback();
    }
  }

  async function serveStatic(req, res, url) {
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const rootAbs = path.resolve(staticDir);
    const full = path.resolve(rootAbs, rel);
    if (full !== rootAbs && !full.startsWith(rootAbs + path.sep)) return json(res, { error: 'Invalid' }, 400);
    try {
      const stat = await fs.stat(full);
      if (stat.isFile()) {
        res.statusCode = 200;
        res.setHeader('Content-Type', MIME[path.extname(full).toLowerCase()] || 'application/octet-stream');
        res.setHeader('Content-Length', stat.size);
        return res.end(await fs.readFile(full));
      }
    } catch {}
    // SPA 回退：无扩展名路径（前端路由）回退到 index.html
    if (!path.extname(rel)) {
      try {
        const index = path.join(rootAbs, 'index.html');
        res.statusCode = 200;
        res.setHeader('Content-Type', MIME['.html']);
        return res.end(await fs.readFile(index));
      } catch { return json(res, { error: 'Not found' }, 404); }
    }
    return json(res, { error: 'Not found' }, 404);
  }

  let vite = null;
  if (!staticDir) {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({ root, server: { middlewareMode: true } });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const parts = url.pathname.split('/').filter(Boolean);

    if (parts[0] === 'api') {
      try {
        // 打包模式：关卡/UI/流程配置只读，拒绝任何写入
        const readOnlyDenied = isPackaged && (
          (parts[1] === 'levels' && parts.length > 2 && (req.method === 'POST' || req.method === 'DELETE')) ||
          (parts[1] === 'level' && req.method === 'POST') ||
          (parts[1] === 'ui' && parts.length > 2 && req.method === 'POST') ||
          (parts[1] === 'flow' && req.method === 'POST') ||
          (parts[1] === 'assets' && parts.length > 2 && (req.method === 'POST' || req.method === 'DELETE')) ||
          (parts[1] === 'weapons' && parts.length > 2 && (req.method === 'POST' || req.method === 'DELETE')) ||
          (parts[1] === 'pets' && parts.length > 2 && (req.method === 'POST' || req.method === 'DELETE')) ||
          (parts[1] === 'outlines' && parts.length > 2 && (req.method === 'POST' || req.method === 'DELETE')) ||
          (parts[1] === 'pixels' && parts.length > 2 && (req.method === 'POST' || req.method === 'DELETE')) ||
          (parts[1] === 'ui-designs' && parts.length > 2 && (req.method === 'POST' || req.method === 'DELETE'))
        );
        if (readOnlyDenied) return json(res, { error: 'Read-only in packaged mode' }, 403);

        if (parts[1] === 'levels') {
          if (parts.length === 2 && req.method === 'GET') return json(res, { levels: await list('levels') });
          const id = parts[2]; if (!id || !/^[-\w]+$/.test(id)) return json(res, { error: 'Invalid id' }, 400);
          if (req.method === 'GET') return json(res, JSON.parse(await fs.readFile(await file('levels', id), 'utf8')));
          if (req.method === 'POST') { const value = await body(req); await fs.writeFile(await file('levels', id), JSON.stringify(value, null, 2)); return json(res, { ok: true }); }
          if (req.method === 'DELETE') { await fs.rm(await file('levels', id), { force: true }); return json(res, { ok: true }); }
        }
        if (parts[1] === 'templates' && req.method === 'GET') return json(res, templates);
        if (parts[1] === 'flow') {
          if (req.method === 'GET') {
            try { return json(res, JSON.parse(await fs.readFile(path.join(dataRoot, 'flow.json'), 'utf8'))); }
            catch { return json(res, { version: 2, flows: { game: { name: '游戏流程', entry: '', nodes: [] }, tutorial: { name: '教程流程', entry: '', nodes: [] } } }); }
          }
          if (req.method === 'POST') { await fs.writeFile(path.join(dataRoot, 'flow.json'), JSON.stringify(await body(req), null, 2)); return json(res, { ok: true }); }
        }
        if (parts[1] === 'inner-shop' && req.method === 'GET') return json(res, await getInnerShop());
        if (parts[1] === 'level') {
          const id = parts[2] || 'level-1';
          if (req.method === 'GET') return json(res, JSON.parse(await fs.readFile(await file('levels', id), 'utf8')));
          if (req.method === 'POST') { await fs.writeFile(await file('levels', id), JSON.stringify(await body(req), null, 2)); return json(res, { ok: true }); }
        }
        if (parts[1] === 'ui') {
          const id = parts[2];
          if (!id || !/^[-\w]+$/.test(id)) return json(res, { error: 'Invalid id' }, 400);
          const f = path.join(dirs.ui, `${id}.json`);
          if (req.method === 'GET') { try { return json(res, JSON.parse(await fs.readFile(f, 'utf8'))); } catch { return json(res, defaultUi[id] || { id, name: id, nodes: [] }); } }
          if (req.method === 'POST') { await fs.writeFile(f, JSON.stringify(await body(req), null, 2)); return json(res, { ok: true }); }
        }
        if (parts[1] === 'players') {
          if (parts.length === 2 && req.method === 'GET') {
            const slots = await listPlayers();
            const metas = {};
            for (const id of slots) { try { const p = await readJson(await file('players', id)); if (p) metas[id] = { name: p.meta?.name, updatedAt: p.meta?.updatedAt, level: p.progress?.level }; } catch {} }
            return json(res, { slots, metas });
          }
          const id = parts[2]; if (!id || !/^[-\w]+$/.test(id)) return json(res, { error: 'Invalid id' }, 400);
          if (req.method === 'GET') { const p = await readJson(await file('players', id)); if (!p) return json(res, { error: 'Not found' }, 404); return json(res, p); }
          if (req.method === 'POST') {
            const value = await body(req); const slots = await listPlayers();
            if (!slots.includes(id)) slots.push(id);
            await savePlayers(slots);
            await writeJson(await file('players', id), value);
            return json(res, { ok: true });
          }
          if (req.method === 'DELETE') {
            await fs.rm(await file('players', id), { force: true });
            const slots = (await listPlayers()).filter(x => x !== id);
            await savePlayers(slots);
            return json(res, { ok: true });
          }
        }
        if (parts[1] === 'test-players') {
          if (parts.length === 2 && req.method === 'GET') {
            const slots = await listTestPlayers();
            const metas = {};
            for (const id of slots) { try { const p = await readJson(await file('testPlayers', id)); if (p) metas[id] = { name: p.meta?.name, updatedAt: p.meta?.updatedAt, level: p.progress?.level }; } catch {} }
            return json(res, { slots, metas });
          }
          const id = parts[2]; if (!id || !/^[-\w]+$/.test(id)) return json(res, { error: 'Invalid id' }, 400);
          if (req.method === 'GET') { const p = await readJson(await file('testPlayers', id)); if (!p) return json(res, { error: 'Not found' }, 404); return json(res, p); }
          if (req.method === 'POST') {
            const value = await body(req); const slots = await listTestPlayers();
            if (!slots.includes(id)) slots.push(id);
            await saveTestPlayers(slots);
            await writeJson(await file('testPlayers', id), value);
            return json(res, { ok: true });
          }
          if (req.method === 'DELETE') {
            await fs.rm(await file('testPlayers', id), { force: true });
            const slots = (await listTestPlayers()).filter(x => x !== id);
            await saveTestPlayers(slots);
            return json(res, { ok: true });
          }
        }
        if (parts[1] === 'uploads' && req.method === 'POST') {
          const buf = await rawBody(req);
          const ct = (req.headers['content-type'] || '').toLowerCase();
          const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('gif') ? 'gif' : ct.includes('svg') ? 'svg' : 'jpg';
          const name = `${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;
          await fs.writeFile(path.join(dirs.uploads, name), buf);
          return json(res, { path: `/uploads/${name}` });
        }
        if (parts[1] === 'icons' && req.method === 'GET') {
          let names = [];
          try {
            names = (await fs.readdir(iconsDir))
              .filter(n => /\.(png|jpe?g|webp|gif)$/i.test(n))
              .sort();
          } catch {}
          return json(res, { icons: names.map(name => ({ name, url: `/icons/${encodeURIComponent(name)}` })) });
        }
        if (parts[1] === 'assets') {
          if (parts.length === 2 && req.method === 'GET') {
            let names = [];
            try { names = await list('assets'); } catch {}
            const assets = [];
            for (const id of names) {
              let name = id;
              try { const a = JSON.parse(await fs.readFile(await file('assets', id), 'utf8')); if (a && a.name) name = a.name; } catch {}
              assets.push({ id, name });
            }
            return json(res, { assets });
          }
          const id = parts[2]; if (!id || !/^[-\w]+$/.test(id)) return json(res, { error: 'Invalid id' }, 400);
          if (req.method === 'GET') {
            try { return json(res, JSON.parse(await fs.readFile(await file('assets', id), 'utf8'))); }
            catch { return json(res, { error: 'Not found' }, 404); }
          }
          if (req.method === 'POST') { await fs.writeFile(await file('assets', id), JSON.stringify(await body(req), null, 2)); return json(res, { ok: true }); }
          if (req.method === 'DELETE') { await fs.rm(await file('assets', id), { force: true }); return json(res, { ok: true }); }
        }
        if (parts[1] === 'weapons') {
          if (parts.length === 2 && req.method === 'GET') {
            let names = [];
            try { names = await list('weapons'); } catch {}
            const defs = [];
            for (const id of names) {
              let name = id;
              try { const w = JSON.parse(await fs.readFile(await file('weapons', id), 'utf8')); if (w && w.name) name = w.name; } catch {}
              defs.push({ id, name });
            }
            return json(res, { weapons: defs });
          }
          const id = parts[2]; if (!id || !/^[-\w]+$/.test(id)) return json(res, { error: 'Invalid id' }, 400);
          if (req.method === 'GET') {
            try { return json(res, JSON.parse(await fs.readFile(await file('weapons', id), 'utf8'))); }
            catch { return json(res, { error: 'Not found' }, 404); }
          }
          if (req.method === 'POST') { await fs.writeFile(await file('weapons', id), JSON.stringify(await body(req), null, 2)); return json(res, { ok: true }); }
          if (req.method === 'DELETE') { await fs.rm(await file('weapons', id), { force: true }); return json(res, { ok: true }); }
        }
        if (parts[1] === 'pets') {
          if (parts.length === 2 && req.method === 'GET') {
            let names = [];
            try { names = await list('pets'); } catch {}
            const defs = [];
            for (const id of names) {
              let name = id;
              try { const p = JSON.parse(await fs.readFile(await file('pets', id), 'utf8')); if (p && p.name) name = p.name; } catch {}
              defs.push({ id, name });
            }
            return json(res, { pets: defs });
          }
          const id = parts[2]; if (!id || !/^[-\w]+$/.test(id)) return json(res, { error: 'Invalid id' }, 400);
          if (req.method === 'GET') {
            try { return json(res, JSON.parse(await fs.readFile(await file('pets', id), 'utf8'))); }
            catch { return json(res, { error: 'Not found' }, 404); }
          }
          if (req.method === 'POST') { await fs.writeFile(await file('pets', id), JSON.stringify(await body(req), null, 2)); return json(res, { ok: true }); }
          if (req.method === 'DELETE') { await fs.rm(await file('pets', id), { force: true }); return json(res, { ok: true }); }
        }
        if (parts[1] === 'outlines') {
          if (parts.length === 2 && req.method === 'GET') {
            let names = [];
            try { names = await list('outlines'); } catch {}
            const items = [];
            for (const id of names) {
              let name = id;
              try { const doc = JSON.parse(await fs.readFile(await file('outlines', id), 'utf8')); if (doc && doc.name) name = doc.name; } catch {}
              items.push({ id, name });
            }
            return json(res, { outlines: items });
          }
          const id = parts[2]; if (!id || !/^[-\w]+$/.test(id)) return json(res, { error: 'Invalid id' }, 400);
          if (req.method === 'GET') {
            try { return json(res, JSON.parse(await fs.readFile(await file('outlines', id), 'utf8'))); }
            catch { return json(res, { error: 'Not found' }, 404); }
          }
          if (req.method === 'POST') { await fs.writeFile(await file('outlines', id), JSON.stringify(await body(req), null, 2)); return json(res, { ok: true }); }
          if (req.method === 'DELETE') { await fs.rm(await file('outlines', id), { force: true }); return json(res, { ok: true }); }
        }
        if (parts[1] === 'pixels') {
          if (parts.length === 2 && req.method === 'GET') {
            let names = [];
            try { names = await list('pixels'); } catch {}
            const items = [];
            for (const id of names) {
              let name = id;
              try { const doc = JSON.parse(await fs.readFile(await file('pixels', id), 'utf8')); if (doc && doc.name) name = doc.name; } catch {}
              items.push({ id, name });
            }
            return json(res, { pixels: items });
          }
          const id = parts[2]; if (!id || !/^[-\w]+$/.test(id)) return json(res, { error: 'Invalid id' }, 400);
          if (req.method === 'GET') {
            try { return json(res, JSON.parse(await fs.readFile(await file('pixels', id), 'utf8'))); }
            catch { return json(res, { error: 'Not found' }, 404); }
          }
          if (req.method === 'POST') { await fs.writeFile(await file('pixels', id), JSON.stringify(await body(req), null, 2)); return json(res, { ok: true }); }
          if (req.method === 'DELETE') { await fs.rm(await file('pixels', id), { force: true }); return json(res, { ok: true }); }
        }
        if (parts[1] === 'ui-designs') {
          if (parts.length === 2 && req.method === 'GET') {
            let names = [];
            try { names = await list('uiDesigns'); } catch {}
            const items = [];
            for (const id of names) {
              let name = id;
              try { const d = JSON.parse(await fs.readFile(await file('uiDesigns', id), 'utf8')); if (d && d.name) name = d.name; } catch {}
              items.push({ id, name });
            }
            return json(res, { designs: items });
          }
          const rawId = parts[2] || '';
          let id = rawId;
          try { id = decodeURIComponent(rawId); } catch {}
          if (!id || !/^[-\w\p{L}\p{N}]+$/u.test(id)) return json(res, { error: 'Invalid id' }, 400);
          if (req.method === 'GET') {
            try { return json(res, JSON.parse(await fs.readFile(await file('uiDesigns', id), 'utf8'))); }
            catch { return json(res, { error: 'Not found' }, 404); }
          }
          if (req.method === 'POST') { await fs.writeFile(await file('uiDesigns', id), JSON.stringify(await body(req), null, 2)); return json(res, { ok: true }); }
          if (req.method === 'DELETE') { await fs.rm(await file('uiDesigns', id), { force: true }); return json(res, { ok: true }); }
        }
        return json(res, { error: 'Not found' }, 404);
      } catch (e) { console.error('[api error]', req.method, url.pathname, e); return json(res, { error: 'Not found' }, 404); }
    }

    if (parts[0] === 'uploads') {
      const name = parts[1];
      if (!name || !/^[\w.-]+$/.test(name)) return json(res, { error: 'Invalid' }, 400);
      const ext = path.extname(name).slice(1).toLowerCase();
      const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };
      res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      try { return res.end(await fs.readFile(path.join(dirs.uploads, name))); } catch { return json(res, { error: 'Not found' }, 404); }
    }

    if (parts[0] === 'icons') {
      const name = decodeURIComponent(parts[1] || '');
      if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) return json(res, { error: 'Invalid' }, 400);
      const ext = path.extname(name).slice(1).toLowerCase();
      const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };
      res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      try { return res.end(await fs.readFile(path.join(iconsDir, name))); } catch { return json(res, { error: 'Not found' }, 404); }
    }

    if (staticDir) return serveStatic(req, res, url);
    if (vite) return vite.middlewares(req, res);
    return json(res, { error: 'Not found' }, 404);
  });

  await new Promise((resolve, reject) => {
    const onError = error => {
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Stop existing dev server or run with PORT=5174 npm run dev`);
        reject(error);
      } else reject(error);
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });

  const actual = server.address();
  const actualPort = typeof actual === 'object' && actual ? actual.port : port;
  console.log(`${isPackaged ? 'Packaged game' : 'Editor'} running at http://${host || 'localhost'}:${actualPort}`);
  return {
    server,
    port: actualPort,
    host: host || '127.0.0.1',
    close: async () => {
      await new Promise(resolve => server.close(() => resolve()));
      if (vite) await vite.close();
    }
  };
}

// 直接以 `node server.js` 运行时启动开发服务器；被 Electron 动态 import 时跳过。
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    await startServer();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
