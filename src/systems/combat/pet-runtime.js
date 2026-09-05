//运行时混入模块（分类：战斗相关）
//
// 职责：玩家装备槽里的「宠物」在战斗内的生成、环绕运动、索敌开火，
// 以及是否可被敌方子弹命中与生命值结算。
//
// 方法清单：
//   initPets       —— 从 player.equipment.pets（物品 id 数组）生成宠物实例
//   updatePets     —— 每帧环绕玩家 + 朝最近敌人开火
//   firePet        —— 调宠物引用的武器 fire 生成子弹并标记宠物伤害
//   damagePet      —— 宠物受击扣血，血尽后失活
//   drawPets       —— 用宠物画板资产渲染外形 + 受击白闪
//
// 通过 Object.assign(EditorScene.prototype, PetMixin) 混入，
// 内部 this 恒为 EditorScene 实例，语义与原类内方法完全一致。
import Phaser from 'phaser';
import { WEAPONS } from './weapons.js';
import { renderAsset } from '../art/asset-render.js';
import { getDesign } from '../art/design-store.js';
import { color } from '../ui/entity-art.js';
import { getPetDef } from '../art/pet-store.js';

// 宠物数值定义已迁移到 data/pets/*.json，经 pet-store（getPetDef）懒加载；
// 机制行为（环绕 + 朝最近敌人开火）硬编码在本模块。
export const PetMixin = {
  // ── 生成宠物实例 ──
    initPets() {
      this.pets = [];
      const eq = this.player?.equipment;
      const ids = Array.isArray(eq?.pets) ? eq.pets : [];
      for (const id of ids) {
        const def = getPetDef(id);
        if (!def) continue;
        const maxHp = Math.max(0, def.maxHp || 0);
        this.pets.push({
          id,
          art: def.art,
          radius: def.radius,
          angularSpeed: def.angularSpeed,
          size: def.size,
          weapon: def.weapon,
          fireInterval: def.fireInterval,
          damage: def.damage,
          maxHp,
          // 只有显式配置可被击且给了生命值才受击；否则完全无敌
          invincible: !(def.hitActive && maxHp > 0),
          r: Math.max(4, 12 * def.size),      // 受击/绘制半径
          x: this.player.x + def.radius,
          y: this.player.y,
          orbitAngle: Math.random() * Math.PI * 2,
          aimAngle: 0,
          fireClock: 0,
          hp: maxHp,
          alive: true,
          hitFlash: null
        });
      }
    },

    // ── 每帧：环绕 + 索敌开火 ──
    updatePets(dt) {
      if (this.editing) return;
      if (!this.pets) this.initPets();
      if (!this.pets.length) return;
      const p = this.player;
      const sec = dt / 1000;

      // 朝离玩家最近的存活敌人开火
      let target = null, td = Infinity;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < td) { td = d; target = e; }
      }

      const fireShots = [];
      for (const pet of this.pets) {
        if (!pet.alive) continue;
        // 环绕
        pet.orbitAngle = (pet.orbitAngle + Phaser.Math.DegToRad(pet.angularSpeed) * sec) % (Math.PI * 2);
        pet.x = p.x + Math.cos(pet.orbitAngle) * pet.radius;
        pet.y = p.y + Math.sin(pet.orbitAngle) * pet.radius;

        pet.fireClock -= dt;
        if (target) {
          pet.aimAngle = Phaser.Math.Angle.Between(pet.x, pet.y, target.x, target.y);
          if (pet.fireClock <= 0) {
            this.firePet(pet, fireShots);
            pet.fireClock = pet.fireInterval;
          }
        }
        if (pet.hitFlash != null) pet.hitFlash = Math.max(0, pet.hitFlash - dt / 150);
      }
      if (fireShots.length) this.bullets.push(...fireShots);
    },

    // ── 宠物开火：复用武器编辑的弹道，重设发射位与伤害 ──
    firePet(pet, out) {
      const w = WEAPONS[pet.weapon];
      if (!w || typeof w.fire !== 'function') return;
      // 构造一个临时的「发射者」以复用既有武器的 fire / drawBullet / stepBullet
      const fake = {
        x: pet.x, y: pet.y,
        weaponAngle: pet.aimAngle,
        artScale: 1,
        weapon: w,
        weaponType: pet.weapon,
        weaponLevel: this.player?.weaponLevel || 1
      };
      const shots = w.fire(fake, this.player?.weaponLevel || 1, this) || [];
      for (const s of shots) {
        if (s.beam) continue;               // 宠物暂不支持激光束介型，跳过
        out.push({ ...s, weaponType: pet.weapon, petDamage: pet.damage });
      }
    },

    // ── 宠物受击 ──
    damagePet(pet, dmg) {
      if (!pet || !pet.alive || pet.invincible || pet.maxHp <= 0) return;
      pet.hp = Math.max(0, pet.hp - (dmg || 0));
      pet.hitFlash = 1;
      if (pet.hp <= 0) pet.alive = false;
    },

    // ── 宠物绘制（画板外形 + 受击白闪）──
    drawPets(g, t = 0) {
      if (this.editing) return;
      if (!this.pets) return;
      for (const pet of this.pets) {
        if (!pet.alive) continue;
        const design = pet.art ? getDesign(pet.art) : null;
        if (design) {
          renderAsset(g, design, pet.x, pet.y, t, pet.size || 1);
        } else {
          g.fillStyle(color('#ffd54f'), 1);
          g.fillCircle(pet.x, pet.y, Math.max(4, (pet.r || 12) * 0.6));
        }
        if (pet.hitFlash != null && pet.hitFlash > 0) {
          g.fillStyle(0xffffff, pet.hitFlash * 0.8);
          g.fillCircle(pet.x, pet.y, (pet.r || 12) + 2);
        }
      }
    },
};
