export function buildGrid(world, walls, cell, inflate) {
  const gw = Math.max(1, Math.ceil(world.width / cell));
  const gh = Math.max(1, Math.ceil(world.height / cell));
  const blocked = Array.from({ length: gh }, () => new Array(gw).fill(false));

  for (const w of walls) {
    const rot = (w.rotation || 0) * Math.PI / 180;
    const cos = Math.abs(Math.cos(rot)), sin = Math.abs(Math.sin(rot));
    const hw = w.w / 2, hh = w.h / 2;
    const extX = hw * cos + hh * sin;
    const extY = hw * sin + hh * cos;
    const minX = Math.floor((w.x - extX - inflate) / cell);
    const maxX = Math.floor((w.x + extX + inflate) / cell);
    const minY = Math.floor((w.y - extY - inflate) / cell);
    const maxY = Math.floor((w.y + extY + inflate) / cell);
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        if (cx >= 0 && cx < gw && cy >= 0 && cy < gh) blocked[cy][cx] = true;
      }
    }
  }

  return { gw, gh, blocked };
}

export function findPath(grid, sx, sy, gx, gy) {
  const { gw, gh, blocked } = grid;
  if (sx < 0 || sy < 0 || sx >= gw || sy >= gh) return null;
  if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) return null;
  if (blocked[sy][sx] || blocked[gy][gx]) return null;

  const key = (x, y) => y * gw + x;
  const h = (x, y) => Math.abs(x - gx) + Math.abs(y - gy);

  const gScore = new Map();
  const fScore = new Map();
  const cameFrom = new Map();
  const open = new Map();

  const startKey = key(sx, sy);
  gScore.set(startKey, 0);
  fScore.set(startKey, h(sx, sy));
  open.set(startKey, { x: sx, y: sy });

  while (open.size) {
    let current = null;
    let ck = null;
    for (const [k, node] of open) {
      if (current === null || fScore.get(k) < fScore.get(ck)) {
        current = node;
        ck = k;
      }
    }

    if (current.x === gx && current.y === gy) {
      const path = [];
      let k = ck;
      while (k !== undefined) {
        path.push({ x: k % gw, y: Math.floor(k / gw) });
        k = cameFrom.get(k);
      }
      return path.reverse();
    }

    open.delete(ck);

    const neighbors = [
      [current.x + 1, current.y],
      [current.x - 1, current.y],
      [current.x, current.y + 1],
      [current.x, current.y - 1]
    ];

    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
      if (blocked[ny][nx]) continue;
      const nk = key(nx, ny);
      const tentative = gScore.get(ck) + 1;
      if (!gScore.has(nk) || tentative < gScore.get(nk)) {
        cameFrom.set(nk, ck);
        gScore.set(nk, tentative);
        fScore.set(nk, tentative + h(nx, ny));
        if (!open.has(nk)) open.set(nk, { x: nx, y: ny });
      }
    }
  }

  return null;
}

export function nearestWalkable(grid, cx, cy) {
  const { gw, gh, blocked } = grid;
  for (let r = 0; r <= Math.max(gw, gh); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || x >= gw || y < 0 || y >= gh) continue;
        if (!blocked[y][x]) return { x, y };
      }
    }
  }
  return null;
}
