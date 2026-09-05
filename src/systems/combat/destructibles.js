/**
 * 文件职责：可破坏物（木箱残骸 / 油桶爆炸）
 * 归属分类：战斗相关
 * 主要导出：DestructiblesMixin（2 个方法）
 * 依赖：systems/constants.js、systems/ui/entity-art.js
 */
import { BARREL_DAMAGE, BARREL_EXPLOSION_MS, CRATE_DEBRIS_TTL, CRATE_SIZE, CRATE_INSET, HIT_FX_TTL, BARREL_TEX_KEY } from '../constants.js';

export const DestructiblesMixin = {
    spawnCrateDebris(c) {
      const s = CRATE_SIZE / 2;
      const half = s - CRATE_INSET;
      const edges = [
        { cx: c.x, cy: c.y - s, horizontal: true },
        { cx: c.x + s, cy: c.y, horizontal: false },
        { cx: c.x, cy: c.y + s, horizontal: true },
        { cx: c.x - s, cy: c.y, horizontal: false }
      ];
      const segments = edges.map(edge => {
        const a = Math.random() * Math.PI * 2;
        const speed = 80 + Math.random() * 120;
        return {
          cx: edge.cx,
          cy: edge.cy,
          horizontal: edge.horizontal,
          half,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed
        };
      });
      this.crateDebris.push({ ttl: CRATE_DEBRIS_TTL, segments });
    },

    explodeBarrel(b) {
      b.alive = false;
      this.hitEffects.push({ x: b.x, y: b.y, ttl: HIT_FX_TTL });

      const radius = b.explodeRadius || 150;
      const img = this.add.image(b.x, b.y, BARREL_TEX_KEY).setOrigin(0.5).setDepth(11);
      if (this.uiCam) this.uiCam.ignore(img);
      const tw = img.frame?.width || 60;
      img.setScale(radius * 2 / tw);
      this.barrelExplosions.push({ img, ttl: BARREL_EXPLOSION_MS });

      const pd = Math.hypot(this.player.x - b.x, this.player.y - b.y);
      if (pd < radius) {
        this.damagePlayer(BARREL_DAMAGE);
      }

      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (Math.hypot(e.x - b.x, e.y - b.y) < radius) {
          e.hp -= BARREL_DAMAGE;
          this.hitEffects.push({ x: e.x, y: e.y, ttl: HIT_FX_TTL });
          if (e.hp <= 0) this.defeatEnemy(e);
        }
      }

      for (const o of this.barrels) {
        if (o.alive && o !== b && Math.hypot(o.x - b.x, o.y - b.y) < radius) {
          this.explodeBarrel(o);
        }
      }

      for (const c of this.crates) {
        if (!c.alive) continue;
        const nearestX = Math.max(c.x - c.w / 2, Math.min(b.x, c.x + c.w / 2));
        const nearestY = Math.max(c.y - c.h / 2, Math.min(b.y, c.y + c.h / 2));
        if (Math.hypot(b.x - nearestX, b.y - nearestY) < radius) {
          c.alive = false;
          this.hitEffects.push({ x: c.x, y: c.y, ttl: HIT_FX_TTL });
          this.spawnCrateDebris(c);
        }
      }
    },
};
