const { app, BrowserWindow } = require('electron');
const path = require('node:path');

let serverHandle = null;
let win = null;

async function start() {
  const { startServer } = await import('../server.js');

  // 正式存档写入 %APPDATA%/arc-engine/（players、test-players、uploads 可写）
  const dataRoot = path.join(app.getPath('appData'), 'arc-engine');
  // 关卡/UI 只读内置资源：打包后 electron-builder extraResources 解包到 resources/data/*
  const resourcesPath = process.resourcesPath;
  const builtinLevelsDir = path.join(resourcesPath, 'data', 'levels');
  const builtinUiDir = path.join(resourcesPath, 'data', 'ui');
  // 未打包直接跑 electron . 时，回退到项目 data/levels、data/ui，便于本地验证打包流程
  const levelsDir = app.isPackaged ? builtinLevelsDir : path.join(__dirname, '..', 'data', 'levels');
  const uiDir = app.isPackaged ? builtinUiDir : path.join(__dirname, '..', 'data', 'ui');
  // 前端静态文件：vite build 产物
  const staticDir = path.join(__dirname, '..', 'dist');

  serverHandle = await startServer({
    dataRoot,
    levelsDir,
    uiDir,
    staticDir,
    isPackaged: true,
    host: '127.0.0.1',
    port: 0
  });

  win = new BrowserWindow({
    width: 1920,
    height: 1080,
    autoHideMenuBar: true,
    backgroundColor: '#0b1b2b',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await win.loadURL(`http://127.0.0.1:${serverHandle.port}/?packaged=1`);
}

app.whenReady().then(start).catch(error => {
  console.error('[electron] startup failed:', error);
  app.quit();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('quit', () => {
  if (serverHandle && typeof serverHandle.close === 'function') {
    serverHandle.close().catch(() => {});
  }
});
