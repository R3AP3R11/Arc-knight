/**
 * 触发器混入模块（分类：关卡设计）
 *
 * 职责：关卡触发器的事件派发与敌人波次调度——同步/异步事件分流、
 * 门（gate）的开启与关闭、波次定时链推进、波次中止与残留清理。
 *
 * 方法清单：
 *   fireTrigger / dispatchTriggerEvent      —— 触发器点火 / 单事件派发
 *   triggerHasPendingWaves                  —— 本触发器是否仍有未生成波次
 *   setGatesActive / activeGateWalls        —— 门开合 / 生效门的碰撞矩形
 *   triggerSpawnEnemy / runTriggerWave      —— 生成事件入口 / 波次定时链
 *   stopTriggerSpawn                        —— 中止波次并清理特效与冻结敌人
 *
 * 通过 Object.assign(EditorScene.prototype, TriggersMixin) 混入，
 * 内部 this 恒为 EditorScene 实例，语义与原类内方法完全一致。
 */

import { hitTrigger } from '../combat/geometry.js';
import { roomPassagesForPoint, isGateOnPassage } from '../../rooms.js';
import { GATE_OUTER_COLOR, GATE_INNER_COLOR } from '../constants.js';

export const TriggersMixin = {
  // ── 事件派发 ──
    fireTrigger(t) {
      const st = this.triggerState.get(t.id) || { inside: false, lastFire: -1e9, waveIndex: 0 };
      for (const ev of (t.events || [])) {
        if (ev.when === 'enemiesCleared') {
          // 异步事件：等待本触发器召唤的敌人被全部击败后触发
          const pending = st.pendingClearEvents || (st.pendingClearEvents = []);
          if (!pending.includes(ev)) pending.push(ev);
        } else {
          this.dispatchTriggerEvent(t, ev);
        }
      }
      this.triggerState.set(t.id, st);
    },

    dispatchTriggerEvent(t, ev) {
      const ctx = this.ctx;
      if (ev.type === 'spawnEnemy') {
        this.triggerSpawnEnemy(t, ev);
      } else if (ev.type === 'switchLevel') {
        this.beginSwitch(ev);
      } else if (ev.type === 'spawnGate') {
        this.setGatesActive(ev, true, t);
      } else if (ev.type === 'removeGate') {
        this.setGatesActive(ev, false, t);
      } else if (ev.type === 'combat') {
        this.setHudMode('combat');
      } else if (ev.type === 'bossBattle') {
        this.startBossBattle(ev);
      } else if (ev.type === 'roomComplete') {
        this.setHudMode('secure', { autoReturn: { mode: 'explore', delay: 1500 } });
      } else if (ev.type === 'complete') {
        this.state = 'end';
        this.settleVictory();
      } else if (ev.type === 'playCinematic') {
        this.playCutsceneById(ev.cinematicId, { focusTarget: ev.focusTarget });
      }
    },

    // Boss 战激活：点亮指定/首个待机 BOSS（母舰或原型机-2-5T5），供 UI 血条（B/C 侧）消费 bossTarget / bossBarReveal
    startBossBattle(ev) {
      const boss = (ev.bossId ? this.enemies.find(en => en.id === ev.bossId) : null)
        || this.enemies.find(en => (en.type === 'mothership' || en.type === 'boss-2-5t5') && !en.bossActive);
      if (!boss) return;   // 找不到待机 BOSS 则静默返回
      boss.bossActive = true;
      this.bossTarget = boss;
      this.bossBarReveal = 0;
    },

    // 本触发器是否还有未生成完的敌人波次
    triggerHasPendingWaves(t) {
      const spawnEv = (t.events || []).find(e => e.type === 'spawnEnemy');
      if (!spawnEv) return false;
      const waves = spawnEv.spawn?.waves || [];
      if (!waves.length) return false;
      const st = this.triggerState.get(t.id);
      return (st?.waveIndex || 0) < waves.length;
    },

  // ── 门控与波次调度 ──
    setGatesActive(ev, activate, trigger) {
      let targets;
      if (ev.auto && trigger) {
        // 自动模式：一键生成/消除触发器所在箱庭通道的门
        targets = this.autoRoomGates(trigger, activate);
      } else {
        if (!this.gates?.length) return;
        targets = (Array.isArray(ev.gateIds) ? ev.gateIds : ev.gateId ? [ev.gateId] : [])
          .map(id => this.gates.find(gt => gt.id === id)).filter(Boolean);
        if (!targets.length) {
          const ref = trigger || ev;
          const nearest = this.gates.reduce((best, gt) =>
            !best || Math.hypot(gt.x - ref.x, gt.y - ref.y) < Math.hypot(best.x - ref.x, best.y - ref.y) ? gt : best, null);
          targets = nearest ? [nearest] : [];
        }
      }
      if (!targets?.length) return;
      for (const gate of targets) {
        if (activate) {
          if (gate.closing) gate.closing = false;
          if (!gate.active) { gate.active = true; gate.spawnT = 0; }
        } else if (gate.active && !gate.closing) {
          gate.closing = true;
        }
      }
    },

    // 自动模式：返回触发器所在箱庭房间各通道上的门；生成（activate）时若通道还没门则新建一扇并启用。
    autoRoomGates(trigger, activate) {
      const ctx = this.ctx;
      const layout = ctx.state.level?.roomLayout;
      if (!layout) return [];
      const room = roomPassagesForPoint(layout, trigger.x, trigger.y);
      if (!room?.passages?.length) return [];
      const gates = this.gates || [];
      const out = [];
      for (const p of room.passages) {
        let gate = gates.find(g => isGateOnPassage(g, p));
        if (!gate && activate) {
          gate = {
            id: `gate-${trigger.id}-${p.edge}`,
            x: p.cx, y: p.cy, w: p.w, h: 45, rotation: p.rotation,
            label: 'Barrier Active', color1: GATE_OUTER_COLOR, color2: GATE_INNER_COLOR,
            active: true, spawnT: 0, visible: true, auto: true
          };
          gates.push(gate);
        }
        if (gate) out.push(gate);
      }
      return out;
    },

    activeGateWalls() {
      if (this.editing) return [];
      return (this.gates || [])
        .filter(gt => gt.active && gt.visible !== false)
        .map(gt => ({ x: gt.x, y: gt.y, w: gt.w, h: gt.h * 1.42, shape: 'rect', rotation: gt.rotation || 0 }));
    },

    // 阻挡子弹的门（仅子弹碰撞用）：普通激活门 + 「只挡子弹」门（shieldOnly，触发前不可见且不挡玩家）。
    // 玩家移动碰撞仍走 activeGateWalls（不含盾门未激活态），使盾门准玩家通过但可挡弹。
    bulletGateWalls() {
      if (this.editing) return [];
      return (this.gates || [])
        .filter(gt => gt.shieldOnly || (gt.active && gt.visible !== false))
        .map(gt => ({ x: gt.x, y: gt.y, w: gt.w, h: gt.h * 1.42, shape: 'rect', rotation: gt.rotation || 0 }));
    },

    triggerSpawnEnemy(t, ev) {
      const spawn = ev.spawn || {};
      const waves = Array.isArray(spawn.waves) && spawn.waves.length ? spawn.waves : [];
      if (!waves.length) return;

      const rt = this.triggerState.get(t.id) || { inside: false, lastFire: -1e9, waveIndex: 0, timer: null };
      const startIndex = spawn.resumeOnReturn !== false ? rt.waveIndex : 0;
      if (startIndex >= waves.length) return;

      if (rt.timer) { rt.timer.remove(false); rt.timer = null; }
      rt.waveIndex = startIndex;
      this.triggerState.set(t.id, rt);

      // runTriggerWave/spawnInScreen/createSpawnEffect 仍从 t.spawn 读取波次配置
      t.spawn = spawn;
      this.runTriggerWave(t, startIndex, waves[startIndex].preDelay || 0);
    },

    runTriggerWave(t, index, delay) {
      const waves = t.spawn.waves;
      if (index >= waves.length) return;
      const wave = waves[index];
      const st = this.triggerState.get(t.id);
      if (!st) return;

      const fire = () => {
        st.timer = null;
        if (wave.mode === 'offscreen') {
          this.spawnOffscreen(t, wave.count, wave.enemyType);
        } else if (wave.mode === 'inscreen') {
          this.spawnInScreen(t, wave);
        } else {
          this.createSpawnEffect(t, wave);
        }
        st.waveIndex = index + 1;
        this.triggerState.set(t.id, st);
        if (index + 1 < waves.length) {
          const next = waves[index + 1];
          const nextDelay = (wave.postDelay || 0) + (next.preDelay || 0);
          this.runTriggerWave(t, index + 1, nextDelay);
        }
      };

      // 勾选「等待清理」时：场上仍有存活敌人则延后到这波生成
      const enemiesCleared = () => !this.enemies.some(e => e.alive);
      const run = () => {
        if (wave.waitForClear && !enemiesCleared()) {
          st.timer = this.time.delayedCall(120, run);
          st.timer.triggerId = t.id;
          this.waveEvents.push(st.timer);
          return;
        }
        fire();
      };

      const ev = this.time.delayedCall(delay, run);
      ev.triggerId = t.id;
      st.timer = ev;
      this.waveEvents.push(ev);
      this.triggerState.set(t.id, st);
    },

    stopTriggerSpawn(t) {
      const st = this.triggerState.get(t.id);
      if (st?.timer) { st.timer.remove(false); st.timer = null; }
      this.waveEvents = this.waveEvents.filter(ev => ev.triggerId !== t.id);
      this.spawnEffects = this.spawnEffects.filter(fx => {
        if (fx.triggerId !== t.id) return true;
        for (const e of fx.spawnedEnemies) e.frozen = false;
        return false;
      });
      this.lockEffects = this.lockEffects.filter(fx => fx.triggerId !== t.id);
    },

  // ── 回填：异步事件 / 波次残留 / 触发器逐帧推进 ──
    checkAsyncTriggerEvents() {
    const ctx = this.ctx;
      const l = ctx.state.level;
      for (const t of l.triggers) {
        const st = this.triggerState.get(t.id);
        const pending = st?.pendingClearEvents;
        if (!pending || !pending.length) continue;
        // 仍有未生成的波次，等待生成完毕
        if (this.triggerHasPendingWaves(t)) continue;
        // 仍有本触发器召唤的存活敌人，等待击杀
        if (this.enemies.some(e => e.alive && e.triggerId === t.id)) continue;
        // 仍有本触发器的生成锁定动画（屏幕内随机敌人尚未落地），等待生成完成
        if (this.lockEffects.some(fx => fx.triggerId === t.id)) continue;
        const events = pending.splice(0, pending.length);
        for (const ev of events) this.dispatchTriggerEvent(t, ev);
        this.spawnChestsForTrigger(t.id);
        this.spawnPortalsForTrigger(t.id);
      }
    },

    hasPendingSpawnWaves() {
    const ctx = this.ctx;
      const l = ctx.state.level;
      for (const t of l.triggers) {
        const spawnEv = (t.events || []).find(e => e.type === 'spawnEnemy');
        if (!spawnEv) continue;
        const waves = spawnEv.spawn?.waves || [];
        if (!waves.length) continue;
        const st = this.triggerState.get(t.id);
        const waveIndex = st?.waveIndex || 0;
        if (waveIndex < waves.length) return true;
      }
      return false;
    },

    updateTriggers() {
    const ctx = this.ctx;
      const l = ctx.state.level;
      for (const t of l.triggers) {
        const inside = hitTrigger(t, this.player.x, this.player.y);
        const st = this.triggerState.get(t.id) || { inside: false, lastFire: -1e9, waveIndex: 0 };
        const spawnEv = (t.events || []).find(e => e.type === 'spawnEnemy');

        if (!inside && st.inside && spawnEv && spawnEv.spawn?.stopOnExit) {
          this.stopTriggerSpawn(t);
        }

        if ((t.events || []).some(e => e.type === 'switchLevel') || t.once !== false) {
          if (this.triggered.has(t.id)) {
            st.inside = inside;
            this.triggerState.set(t.id, st);
            continue;
          }
          if (inside) {
            this.triggered.add(t.id);
            this.fireTrigger(t);
          }
          st.inside = inside;
          this.triggerState.set(t.id, st);
          continue;
        }

        if (inside && !st.inside && this.time.now - st.lastFire >= (t.cooldown || 0)) {
          st.lastFire = this.time.now;
          this.fireTrigger(t);
        }
        if (!inside && st.inside && spawnEv && spawnEv.spawn?.resumeOnReturn === false) {
          st.waveIndex = 0;
        }
        st.inside = inside;
        this.triggerState.set(t.id, st);
      }
    },
};
