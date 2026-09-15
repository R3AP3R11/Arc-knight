/**
 * 文件职责：局内消耗品（药水使用/限时加成）与局内限时武器的运行时 mixin（供 HUD 层调用）
 * 归属分类：数值_经济
 * 主要导出：RunItemsMixin（14 个方法）
 * 依赖：systems/economy/run-items.js、systems/economy/inner-shop.js、systems/ui/vendor-shop-art.js、
 *       systems/combat/weapons.js、systems/art/weapon-store.js
 */
import { statMul, potionQueueAdd, applyStatEffect } from './run-items.js';
import {
  loadInnerShop, getItemArt, getPotionList, findConsumable, getItemEffect, isInstantItem, isPotionItem
} from './inner-shop.js';
import { preloadArtRefs } from '../ui/vendor-shop-art.js';
import { WEAPONS } from '../combat/weapons.js';
import { ensureWeaponDef } from '../art/weapon-store.js';
import { enterWeapon, leaveWeapon } from './weapon-buffs.js';

export const RunItemsMixin = {
    // ── 获得一件局内消耗品：即时生效类立刻结算；药水类进队列（同 id 叠加、满 4 瓶丢弃新获得的） ──
    addRunItem(id, count = 1) {
      const c = findConsumable(id);
      if (!c) return false;
      const p = this.player;
      if (isInstantItem(c)) {
        const { type, value } = getItemEffect(c);
        if (type === 'heal' && p) {
          p.hp = Math.min(Number(p.maxHp ?? p.hp) || 0, (Number(p.hp) || 0) + value);
        } else if (type === 'shield' && p) {
          p.itemShields = Array.isArray(p.itemShields) ? p.itemShields : [];
          p.itemShields.push({ hp: value, maxHp: value });
        } else if (type) {
          applyStatEffect(p?.combat, type, statMul(value), 1);
        }
        return true;
      }
      if (!isPotionItem(c)) return false;
      this.runItems = Array.isArray(this.runItems) ? this.runItems : [];
      return potionQueueAdd(this.runItems, String(id), count);
    },

    // ── 局内「限时武器」入列：同时只持有 1 把，直接替换旧的那把 ──
    // 若替换时正「使用中」，先取消（把主武器态写回），避免玩家武器被留在临时武器上。
    // id 用项目武器 id（weaponId），保证战斗/界面能取到武器定义；表格编号仅作兜底。
    addRunTimedWeapon(item) {
      if (this.isTempWeaponActive()) this.cancelTempWeapon();
      const id = String(item?.weaponId || item?.id || '');
      const durationSec = Number(item?.durationSec) || 0;
      this.runTimedWeapons = [{ id, name: item?.name || '', durationSec, remainSec: durationSec }];
    },

    // ── 药水队列副本（界面轮盘取数；无数据 → []） ──
    getRunPotions() {
      return (Array.isArray(this.runItems) ? this.runItems : [])
        .map(r => ({ id: String(r.id), count: Number(r.count) || 0 }));
    },

    // ── 最先获得且未使用的一瓶（副本；无则 null） ──
    getFrontPotion() {
      const q = Array.isArray(this.runItems) ? this.runItems : [];
      const front = q.find(r => r && (Number(r.count) || 0) > 0);
      return front ? { id: String(front.id), count: Number(front.count) || 0 } : null;
    },

    // ── 局内限时武器副本（无则 null） ──
    getTempWeapon() {
      const t = Array.isArray(this.runTimedWeapons) ? this.runTimedWeapons[0] : null;
      return t ? { ...t } : null;
    },

    // ── 限时生效中的加成列表（界面状态图标取数；内部引用，仅供读取） ──
    getRunEffects() {
      this.runEffects = Array.isArray(this.runEffects) ? this.runEffects : [];
      return this.runEffects;
    },

    // ── 使用队列第 index 瓶药水（按轮盘顺序，不强制先进先出）；成功 true ──
    usePotionAt(index) {
      const q = Array.isArray(this.runItems) ? this.runItems : [];
      const i = Math.floor(Number(index) || 0);
      const slot = q[i];
      if (!slot || (Number(slot.count) || 0) <= 0) return false;
      const c = findConsumable(slot.id);
      if (!c) return false;
      const p = this.player;
      const { type, value, sec } = getItemEffect(c);
      if (type === 'heal' && p) {
        p.hp = Math.min(Number(p.maxHp ?? p.hp) || 0, (Number(p.hp) || 0) + value);
      } else if (type === 'shield' && p) {
        p.itemShields = Array.isArray(p.itemShields) ? p.itemShields : [];
        p.itemShields.push({ hp: value, maxHp: value });
      } else if (type && sec > 0 && p) {
        // 限时加成：生效并登记状态图标（字段名冻结，界面按此读）
        applyStatEffect(p.combat, type, statMul(value), 1);
        const art = getItemArt(c) || {};
        this.runEffects = Array.isArray(this.runEffects) ? this.runEffects : [];
        this.runEffects.push({
          id: String(slot.id), name: c.name || '',
          artType: art.artType || '', artName: art.artName || '',
          effect: { type, value, sec }, remainSec: sec, totalSec: sec
        });
      } else if (type) {
        // 本局永久（无时长）加成：生效但不登记状态图标
        applyStatEffect(p?.combat, type, statMul(value), 1);
      }
      slot.count -= 1;
      if (slot.count <= 0) q.splice(i, 1);
      this.syncUIState?.();
      return true;
    },

    // ── 使用队列最前面的一瓶（数字键 4） ──
    useFrontPotion() {
      return this.usePotionAt(0);
    },

    // ── 数字键 5：未使用 → 使用临时武器；使用中 → 取消。返回「是否处于使用中」 ──
    toggleTempWeapon() {
      if (this.isTempWeaponActive()) { this.cancelTempWeapon(); return false; }
      return this.useTempWeapon();
    },

    // ── 当前是否正在使用临时武器 ──
    isTempWeaponActive() {
      return this.tempWeaponActive === true;
    },

    // ── 启用临时武器：保存主武器态 → 开火/外观切到设计稿武器 ──
    useTempWeapon() {
      const t = this.getTempWeapon();
      if (!t) return false;
      const rt = WEAPONS[t.id];
      if (!rt) {
        // 设计稿武器尚未加载：异步取回后，若仍未使用则自动切换
        ensureWeaponDef(t.id).then(() => {
          if (WEAPONS[t.id] && !this.isTempWeaponActive()) this.useTempWeapon();
        });
        return false;
      }
      const p = this.player;
      if (!p) return false;
      this.tempWeaponSaved = {
        weaponType: p.weaponType, weapon: p.weapon, weaponArt: p.weaponArt,
        scheme: p.scheme, weaponIndex: p.weaponIndex, charge: p.charge
      };
      leaveWeapon(this);                        // 切走主武器：回退其火堆祝福
      p.weaponType = t.id;
      p.weapon = rt;
      p.weaponArt = rt.appearance || null;
      p.weaponIntroAt = this.time?.now || 0;   // 出武器：重播本体出场动画
      p.scheme = rt.scheme;
      p.charge = 0;
      p.ammo = p.ammo || {};
      if (p.ammo[t.id] === undefined) p.ammo[t.id] = rt.maxAmmo ?? Infinity;
      p.previousFireDown = false;
      this.tempWeaponActive = true;
      this.syncUIState?.();
      return true;
    },

    // ── 取消临时武器：把主武器态写回玩家 ──
    cancelTempWeapon() {
      const s = this.tempWeaponSaved;
      const p = this.player;
      if (p && s) {
        p.weaponType = s.weaponType;
        p.weapon = s.weapon;
        p.weaponArt = s.weaponArt;
        p.scheme = s.scheme;
        p.weaponIndex = s.weaponIndex;
        p.charge = s.charge;
        p.weaponIntroAt = this.time?.now || 0;   // 出武器：重播本体出场动画
        enterWeapon(this, s.weaponType);          // 写回主武器：重新生效其火堆祝福
      }
      this.tempWeaponSaved = null;
      this.tempWeaponActive = false;
      this.syncUIState?.();
      return true;
    },

    // ── 每帧推进：限时加成倒计时（到期回退并移除图标）、临时武器使用时长倒计时（到期取消并清空） ──
    updateRunItems(dt) {
      const sec = (Number(dt) || 0) / 1000;
      const p = this.player;
      if (Array.isArray(this.runEffects) && this.runEffects.length) {
        for (let i = this.runEffects.length - 1; i >= 0; i--) {
          const r = this.runEffects[i];
          r.remainSec = (Number(r.remainSec) || 0) - sec;
          if (r.remainSec <= 0) {
            const e = r.effect || {};
            applyStatEffect(p?.combat, e.type, statMul(e.value), -1);
            this.runEffects.splice(i, 1);
          }
        }
      }
      if (this.isTempWeaponActive() && Array.isArray(this.runTimedWeapons) && this.runTimedWeapons.length) {
        const t = this.runTimedWeapons[0];
        t.remainSec = (Number(t.remainSec) || 0) - sec;
        if (t.remainSec <= 0) {
          this.cancelTempWeapon();
          this.runTimedWeapons = [];
        }
      }
    },

    // ── 预取全部药水图标的画板资产（fire-and-forget，preloadArtRefs 自带 catch） ──
    preloadRunItemArt() {
      loadInnerShop().then(() => {
        const refs = getPotionList()
          .map(c => getItemArt(c))
          .filter(a => a && a.artType && a.artName)
          .map(a => ({ artType: a.artType, artName: a.artName }));
        preloadArtRefs(refs);
      }).catch(() => {});
    },
};
