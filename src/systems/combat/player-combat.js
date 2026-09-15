/**
 * 玩家战斗混入模块（分类：战斗相关）
 *
 * 职责：玩家侧的受伤结算、护盾格挡判定与破盾、武器轮切换，
 * 以及受击时覆盖全屏的红色闪屏绘制。
 *
 * 方法清单：
 *   damagePlayer     —— 扣血（含即时护盾吸收、减伤、新手关血量下限、失败判定）
 *   blockWithShield  —— 扇形护盾角度 + 距离判定，命中则扣盾并抖屏
 *   hitShield        —— 近身敌人撞盾：先结算击杀再走格挡
 *   switchWeapon     —— 按方向切换武器轮当前槽位
 *   equipWeaponByType —— 按武器类型切到指定武器（火堆选卡后自动切换复用）
 *   drawHitFlash     —— 受击红色闪屏（挖去玩家周围圆形）
 *
 * 通过 Object.assign(EditorScene.prototype, PlayerCombatMixin) 混入，
 * 内部 this 恒为 EditorScene 实例，语义与原类内方法完全一致。
 */
import Phaser from 'phaser';
import { PLAYER_ART, SHIELD, SHIELD_SHAKE_MS, SHIELD_SHAKE_INTENSITY, SHIELD_HIT_COLOR, HIT_FX_TTL } from '../constants.js';
import { WEAPONS } from './weapons.js';
import { playerIncomingDamage } from '../economy/damage.js';
import { enterWeapon, leaveWeapon } from '../economy/weapon-buffs.js';
import { pointInWall, hitWall } from './geometry.js';

// ── 本模块私有常量 ──
const NEWBEE_MIN_HP = 5;         // 新手关血量下限，永不失败
const HIT_FLASH_RADIUS = 70;     // 受击闪屏在玩家周围挖空的半径

export const PlayerCombatMixin = {
  // ── 受伤与护盾 ──
    damagePlayer(dmg) {
      const floor = this.isNewbeeLevel() ? NEWBEE_MIN_HP : 0;
      const actual = playerIncomingDamage(this, dmg);
      if (actual <= 0) return;
      // 即时护盾吸收：先按数组顺序逐个扣盾，remaining 归零则免掉本次 HP 损失
      let remaining = actual;
      const shields = Array.isArray(this.player.itemShields) ? this.player.itemShields : [];
      for (let i = 0; i < shields.length && remaining > 0; i++) {
        const sh = shields[i];
        if (!sh || typeof sh !== 'object') continue;
        const absorbed = Math.min(sh.hp || 0, remaining);
        sh.hp = (sh.hp || 0) - absorbed;
        remaining -= absorbed;
        if (sh.hp <= 0) {
          shields.splice(i, 1);
          i--;   // 移除后后续元素前移，回退索引以维持「按数组顺序」处理
          this.hitEffects.push({ x: this.player.x, y: this.player.y, ttl: HIT_FX_TTL, color: SHIELD_HIT_COLOR });
          this.cameras.main.shake(SHIELD_SHAKE_MS, SHIELD_SHAKE_INTENSITY);
        }
      }
      if (remaining <= 0) return;
      this.player.hp = Math.max(floor, (this.player.hp ?? 100) - remaining);
      this.player.hitFlash = {
        alpha: 1,
        total: Phaser.Math.Clamp(dmg * 40, 200, 1200),
        t: 0
      };
      if (this.player.hp <= 0) {
        this.triggerPlayerDefeat();
      }
    },

    blockWithShield(x, y, damage, extraRadius) {
      if (!this.player.shieldActive || this.player.shieldBroken) return false;
      const toP = Phaser.Math.Angle.Between(this.player.x, this.player.y, x, y);
      const diff = Math.abs(Phaser.Math.Angle.Wrap(toP - this.player.shieldAngle));
      const radius = PLAYER_ART.weaponRingRadius + SHIELD.gap + (extraRadius || 0);
      if (diff <= Phaser.Math.DegToRad(SHIELD.arcDeg / 2) && Math.hypot(x - this.player.x, y - this.player.y) < radius) {
        const actual = playerIncomingDamage(this, damage || 0) || damage || 0;
        this.player.shield = Math.max(0, this.player.shield - actual);
        this.hitEffects.push({ x, y, ttl: HIT_FX_TTL, color: SHIELD_HIT_COLOR });
        this.cameras.main.shake(SHIELD_SHAKE_MS, SHIELD_SHAKE_INTENSITY);
        if (this.newbee) this.newbee.shieldBlocked = true;
        if (this.player.shield <= 0) {
          this.player.shieldBroken = true;
          this.player.shieldActive = false;
          this.player.shieldTimer = 0;
        }
        return true;
      }
      return false;
    },

    hitShield(e) {
      this.defeatEnemy(e);
      this.blockWithShield(e.x, e.y, e.damage, e.r);
    },

  // ── 武器切换 ──
    // 按方向在武器轮上移动一格，算出目标武器后交给 equipWeaponByType 执行实际切换。
    switchWeapon(dir) {
      const weapons = this.player.weapons;
      const n = weapons.length;
      if (n <= 1) return;                               // 不足两把：无轮可转
      const to = (this.player.weaponIndex + dir + n) % n;
      this.equipWeaponByType(weapons[to]);
    },

    // 按武器类型切到指定武器（火堆选卡后自动切换复用同一套切换步骤）。
    // 关闭条件（任一）→ 返回 false 且不改任何状态：无 weaponType / 未登记在 player.weapons /
    // 已是当前武器 / WEAPONS 缺定义。leaveWeapon / enterWeapon 必须成对调用
    // （按武器生效的属性强化靠它回退 / 重放，见 economy/weapon-buffs.js）。
    equipWeaponByType(weaponType) {
      if (!weaponType) return false;
      const weapons = this.player.weapons || [];
      const to = weapons.indexOf(weaponType);
      if (to < 0) return false;                         // 该武器不在当前武器轮中
      if (weaponType === this.player.weaponType) return false;   // 已是当前武器：无事可做
      const weapon = WEAPONS[weaponType];
      if (!weapon) return false;                        // WEAPONS 缺定义：不切换
      const from = this.player.weaponIndex;
      leaveWeapon(this);                                // 切走旧武器：回退其火堆祝福
      this.player.weaponIndex = to;
      this.player.weaponType = weaponType;
      this.player.weapon = weapon;
      this.player.scheme = weapon.scheme;
      this.player.weaponArt = (weapon.appearance && Array.isArray(weapon.appearance.elements) && weapon.appearance.elements.length) ? weapon.appearance : null;
      enterWeapon(this, weaponType);                    // 切到新武器：应用其火堆祝福
      this.player.weaponIntroAt = this.time?.now || 0;   // 出武器：重播本体出场动画
      this.wheelAnim = { from, to, t: 0, dur: 500 };
      this.syncUIState();
      return true;
    },

  // ── 受击闪屏 ──
    drawHitFlash(g) {
      if (!this.player.hitFlash || this.player.hitFlash.alpha <= 0) return;
      const v = this.viewRect();
      const alpha = this.player.hitFlash.alpha * 0.85;
      g.fillStyle(0xff0000, alpha);
      g.beginPath();
      g.moveTo(v.x, v.y);
      g.lineTo(v.x + v.w, v.y);
      g.lineTo(v.x + v.w, v.y + v.h);
      g.lineTo(v.x, v.y + v.h);
      g.closePath();
      g.arc(this.player.x, this.player.y, HIT_FLASH_RADIUS, 0, Math.PI * 2, true);
      g.fillPath();
    },

  // ── 回填：点是否落在墙内（供射击命中用） ──
    pointInWall(x, y) {
    const ctx = this.ctx;
      return ctx.state.level.walls.some(w => hitWall(w, x, y))
        || this.activeGateWalls().some(w => hitWall(w, x, y));
    },
};
