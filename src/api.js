const API = '/api';

async function request(path, options) {
  const response = await fetch(`${API}${path}`, options);
  if (!response.ok) throw new Error(`${response.status} ${path}`);
  return response.json();
}

export const get = path => request(path);

export const post = (path, value) => request(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(value)
});

export const remove = path => request(path, { method: 'DELETE' });

export async function loadLevel(id) {
  return get(`/levels/${id}`);
}

export const saveFormal = (id, level) => post(`/levels/${id}`, level);
export const saveDraft = saveFormal;

export const getUi = id => get(`/ui/${id}`);
export const saveUi = (id, graph) => post(`/ui/${id}`, graph);

// 神像祝福配置（data/ui/idol-buffs.json：{ offerCount, buffs[] }）
export const getIdolBuffs = () => get(`/ui/idol-buffs`);

// 玩家存档 API
export const listPlayers = () => get('/players');
export const loadPlayer = id => get(`/players/${id}`);
export const savePlayer = (id, player) => post(`/players/${id}`, player);
export const deletePlayer = id => remove(`/players/${id}`);

// 画板设计稿 API（data/assets/）
export const listAssets = () => get('/assets');
export const loadAsset = id => get(`/assets/${id}`);
export const saveAsset = (id, design) => post(`/assets/${id}`, design);
export const deleteAsset = id => remove(`/assets/${id}`);

// 武器设计 API（data/weapons/）
export const listWeapons = () => get('/weapons');
export const loadWeapon = id => get(`/weapons/${id}`);
export const saveWeapon = (id, design) => post(`/weapons/${id}`, design);
export const deleteWeapon = id => remove(`/weapons/${id}`);

// 宠物设计 API（data/pets/）
export const listPets = () => get('/pets');
export const loadPet = id => get(`/pets/${id}`);
export const savePet = (id, design) => post(`/pets/${id}`, design);
export const deletePet = id => remove(`/pets/${id}`);

// 试玩测试存档 API（data/test-players/，与正式存档完全隔离）
export const listTestPlayers = () => get('/test-players');
export const loadTestPlayer = id => get(`/test-players/${id}`);
export const saveTestPlayer = (id, player) => post(`/test-players/${id}`, player);
export const deleteTestPlayer = id => remove(`/test-players/${id}`);

// 轮廓库 API（data/outlines/）
export const listOutlines = () => get('/outlines');
export const loadOutline = id => get(`/outlines/${id}`);
export const saveOutline = (id, outline) => post(`/outlines/${id}`, outline);
export const deleteOutline = id => remove(`/outlines/${id}`);

// UI 设计稿 API（docs/ui-designs/，供 AI 读取的控件位置+动画/逻辑描述）
export const listUiDesigns = () => get('/ui-designs');
export const loadUiDesign = id => get(`/ui-designs/${id}`);
export const saveUiDesign = (id, design) => post(`/ui-designs/${id}`, design);
export const deleteUiDesign = id => remove(`/ui-designs/${id}`);
