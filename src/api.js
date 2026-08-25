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

// 玩家存档 API
export const listPlayers = () => get('/players');
export const loadPlayer = id => get(`/players/${id}`);
export const savePlayer = (id, player) => post(`/players/${id}`, player);
export const deletePlayer = id => remove(`/players/${id}`);
