/**
 * 文件职责：掉落物生成 / 拾取 / 刷新（敌人掉落、武器补给拾取）
 * 归属分类：数值_经济
 * 主要导出：DropsMixin（5 个方法）、PICKUP_RADIUS、MAGNET_RADIUS
 * 依赖：systems/combat/weapons.js
 */
import { WEAPONS } from '../combat/weapons.js';

// 掉落拾取判定半径
export const PICKUP_RADIUS = 26;
// 金币/钻石自动吸附触发半径（玩家进入该范围内吸向玩家）
export const MAGNET_RADIUS = 90;

export const DropsMixin = {
    spawnDrops(e) {
    const ctx = this.ctx;
      const rules = ctx.state.level.dropRules?.[e.type];
      if (Array.isArray(rules) && rules.length) {
        for (const rule of rules) {
          if (Math.random() * 100 >= rule.chance) continue;
          const count = Math.max(0, Math.floor(Number(rule.count) || 0));
          if (rule.item === 'charge') {
            // weapon 未指定时：为玩家局内拥有的每把特殊武器各掉一个充能球
            const targets = rule.weapon ? [rule.weapon] : Object.keys(this.player.weaponCharge || {});
            for (const weapon of targets) {
              const c = this.player.weaponCharge?.[weapon];
              if (!c || c.have >= c.need) continue;
              this.spawnDropItems(e, 'charge', count, weapon);
            }
            continue;
          }
          this.spawnDropItems(e, rule.item, count);
        }
        return;
      }
      const d = e.drops || {};
      const counts = { gold: Number(d.gold) || 0, exp: Number(d.exp) || 0, diamond: Number(d.diamond) || 0 };
      for (const [type, count] of Object.entries(counts)) this.spawnDropItems(e, type, count);
    },

    spawnDropItems(e, type, count, weapon = '') {
      if (type === 'charge' && !weapon) return;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const currency = type === 'gold' || type === 'diamond';
        const driftSpeed = currency ? 10 : 20;
        const driftTtl = currency ? 1000 : 600;
        this.drops.push({
          type,
          weapon,
          x: e.x + (Math.random() - 0.5) * 30,
          y: e.y + (Math.random() - 0.5) * 30,
          drift: { vx: Math.cos(angle) * driftSpeed, vy: Math.sin(angle) * driftSpeed, ttl: driftTtl }
        });
      }
    },

    collectDrop(d) {
      if (d.type === 'exp') {
        this.player.exp = (this.player.exp || 0) + 1;
        this.commitPlayer();
        this.runExpGained = (this.runExpGained || 0) + 1;
      } else if (d.type === 'charge') {
        const c = this.player.weaponCharge?.[d.weapon];
        if (!c) return;
        c.have++;
        this.tryRefillWeapon(d.weapon);
      } else if (d.type === 'gold') {
        // 金币局内累加，通关结算时才写入存档
        this.player.gold = (this.player.gold || 0) + 1;
        this.runGoldGained = (this.runGoldGained || 0) + 1;
      } else if (d.type === 'diamond') {
        // 钻石局内累加，通关结算时才写入存档（对应 currency.gems）
        this.player.gems = (this.player.gems || 0) + 1;
      }
    },

    tryRefillWeapon(type) {
      const c = this.player.weaponCharge?.[type];
      if (!c) return;
      const ammo = this.player.ammo?.[type];
      if (ammo === undefined || ammo === Infinity) return;
      if (ammo <= 0 && c.have >= c.need) {
        c.have = 0;
        this.player.ammo[type] = WEAPONS[type]?.maxAmmo ?? ammo;
      }
    },

    updateDrops(dt) {
      const sec = dt / 1000;
      this.drops = this.drops.filter(d => {
        if (d.drift && d.drift.ttl > 0) {
          d.drift.ttl -= dt;
          d.x += d.drift.vx * sec;
          d.y += d.drift.vy * sec;
          return true;
        }

        if (d.type === 'gold' || d.type === 'diamond') {
          const dx = this.player.x - d.x, dy = this.player.y - d.y;
          const dist = Math.hypot(dx, dy);
          if (dist < PICKUP_RADIUS) { this.collectDrop(d); return false; }
          if (dist <= MAGNET_RADIUS) {
            const step = 800 * sec;
            if (dist <= step) { this.collectDrop(d); return false; }
            d.x += dx / dist * step;
            d.y += dy / dist * step;
          }
          return true;
        }

        const dx = this.player.x - d.x, dy = this.player.y - d.y;
        const dist = Math.hypot(dx, dy);
        const step = 800 * sec;
        if (dist < step) { this.collectDrop(d); return false; }
        d.x += dx / dist * step;
        d.y += dy / dist * step;
        return true;
      });
    },
};
