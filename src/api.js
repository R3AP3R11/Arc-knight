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
  const [draft, formal] = await Promise.allSettled([
    get(`/drafts/${id}`),
    get(`/levels/${id}`)
  ]);
  return draft.status === 'fulfilled'
    ? draft.value
    : formal.status === 'fulfilled' ? formal.value : null;
}

export const saveDraft = (id, level) => post(`/drafts/${id}`, level);
export const saveFormal = (id, level) => post(`/levels/${id}`, level);

export const getUi = id => get(`/ui/${id}`);
export const saveUi = (id, graph) => post(`/ui/${id}`, graph);
