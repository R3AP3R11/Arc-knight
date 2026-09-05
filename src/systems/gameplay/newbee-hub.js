/**
 * 文件职责：新手教程阶段机与骑士之家（Hub）交互
 * 归属分类：系统玩法
 * 主要导出：NewbeeHubMixin（12 个方法）
 * 依赖：systems/constants.js、systems/ui/entity-art.js
 */
import Phaser from 'phaser';
import { FONT_TECH, FONT_TECH_SC } from '../constants.js';
import { color } from '../ui/entity-art.js';

const HUB_INTERACT_RADIUS = 80;        // 骑士之家可互动物体的触发距离
const HUB_INTERACTABLES = [
  { id: 'workshop', x: 1320, y: 680, label: '工坊' },   // 打开工坊页面
  { id: 'weapon', x: 540, y: 300, label: '商店' },      // 打开武器页面
  { id: 'levelSelect', x: 940, y: 300, label: '选择关卡' } // 打开关卡选择页面
];
const NEWBEE_HINT_FADE_MS = 1000;      // 提示淡入/淡出时长
const NEWBEE_HINT_PRE_MS = 2000;       // 提示出现前延迟
const NEWBEE_HINT_POST_MS = 2000;      // 提示结束后的额外等待
const NEWBEE_HINT_Y_OFFSET = 160;      // 提示相对玩家头顶的高度
// 提示图标（图片素材：位于 public/ 目录，随项目版本控制）
const NEWBEE_ICONS = {
  mouse: '/mouse.png',     // 鼠标左键
  wasd: '/wasd.png',       // WASD
  space: '/space.png',     // 空格
  f: '/f.png'              // F 键
};
export const NewbeeHubMixin = {
    initNewbee() {
      if (this.newbeeHintText) { this.newbeeHintText.destroy(); this.newbeeHintText = null; }
      if (this.newbeeHintIcons) {
        for (const img of Object.values(this.newbeeHintIcons)) if (img && typeof img === 'object') img.destroy?.();
        this.newbeeHintIcons = null;
      }
      if (this.newbeeRectLabels) {
        for (const label of this.newbeeRectLabels.values()) label.destroy?.();
        this.newbeeRectLabels = null;
      }
      if (!this.isNewbeeLevel()) { this.newbee = null; return; }
      this.newbeeDelay = {};
      this.newbee = {
        phase: 1,
        // 权限开关
        allowFire: true,       // 阶段1即解禁左键射击
        allowMove: false,
        allowShield: false,
        // 提示
        hint: { text: '按「鼠标左键」射击', icon: 'mouse', fadeAt: null, pre: NEWBEE_HINT_PRE_MS, showT: 0 },
        // 阶段 1 子状态
        fired: false,          // 是否已开火
        subHintShown: false,   // 校准提示是否已显示
        // 阶段 2
        moved: false,
        // 阶段 3
        enemies: [],           // 本阶段生成的敌人引用
        phase3Fire: false,
        // 阶段 4
        advanced: null,
        shieldBlocked: false,  // 是否已用护盾抵挡过一次子弹
        // 阶段 6
        phase6Shown: false,
        exitRect: { x: 797, y: 139, w: 160, h: 160 },
        practiceRect: { x: 432, y: 674, w: 160, h: 160 }
      };
    },

    initHub() {
      if (this.hubIcons) {
        for (const spr of Object.values(this.hubIcons)) spr.destroy?.();
        this.hubIcons = null;
      }
      this.hubTipText?.destroy?.();
      this.hubTipText = null;
      this.hubTipKeyText?.destroy?.();
      this.hubTipKeyText = null;
      this.hubNearest = null;
      this.hubTipT = 0;
    },

    getFKeyBadge() {
      if (this.fKeyBadge) return this.fKeyBadge;
      const key = '__fkey_badge__';
      const make = () => {
        this.fKeyBadge = this.add.image(0, 0, key).setOrigin(0.5).setDepth(14).setDisplaySize(30, 30);
        if (this.uiCam) this.uiCam.ignore(this.fKeyBadge);
        this.fKeyBadge.setVisible(false);
        return this.fKeyBadge;
      };
      if (this.textures.exists(key)) return make();
      const raw = new Image();
      raw.onload = () => {
        if (!this.textures?.game) return;   // 场景/游戏已销毁，异步加载期间不可再写纹理
        if (!raw.naturalWidth || this.fKeyBadge) return;
        if (!this.textures.exists(key)) this.textures.addImage(key, raw);
        make();
      };
      raw.src = '/f.png';
      return null;
    },

    setNewbeeHint(text, icon, fadeAt = null) {
      if (!this.newbee) return;
      this.newbee.hint = { text, icon, fadeAt, pre: text ? NEWBEE_HINT_PRE_MS : null, showT: 0 };
    },

    updateHubInteract(dt) {
      if (!this.isHubLevel() || this.state !== 'playing') return;
      const p = this.player;
      if (!p) return;

      let nearest = null;
      let nearestDist = Infinity;
      for (const it of HUB_INTERACTABLES) {
        const d = Math.hypot(p.x - it.x, p.y - it.y);
        if (d < HUB_INTERACT_RADIUS && d < nearestDist) { nearestDist = d; nearest = it; }
      }
      this.hubNearest = nearest;

      // 提示渐显
      if (this.hubTipT == null) this.hubTipT = 0;
      this.hubTipT = nearest ? Math.min(1, this.hubTipT + dt / 180) : 0;

      if (nearest && this.keys.F && Phaser.Input.Keyboard.JustDown(this.keys.F)) {
        this.openMenuScreen(nearest.id);
      }
    },

    updateNewbee(dt) {
      const nb = this.newbee;
      if (!nb) return;

      // 提示出现前延迟倒计时
      if (nb.hint && nb.hint.pre != null) {
        nb.hint.pre -= dt;
        if (nb.hint.pre <= 0) nb.hint.pre = 0;
      }
      // 淡入计时：出现后 1s 内渐显
      if (nb.hint.showT != null && nb.hint.pre === 0) {
        nb.hint.showT = Math.min(NEWBEE_HINT_FADE_MS, nb.hint.showT + dt);
      }
      // 提示淡出计时：到期后清除
      if (nb.hint.fadeAt != null) {
        nb.hint.fadeAt -= dt;
        if (nb.hint.fadeAt <= 0) { this.setNewbeeHint('', null); }
      }

      this.newbeeDelay = this.newbeeDelay || {};
      const d = this.newbeeDelay;
      for (const k of Object.keys(d)) if (typeof d[k] === 'number') d[k] = Math.max(0, d[k] - dt);

      this.advanceNewbee();
    },

    advanceNewbee() {
      const nb = this.newbee;
      if (!nb) return;
      const d = this.newbeeDelay;

      if (nb.phase === 1) {
        // 首次开火：让射击提示 1.5s 后淡出
        if (nb.fired && d.p1fade === undefined) {
          d.p1fade = NEWBEE_HINT_FADE_MS;
          this.setNewbeeHint('按「鼠标左键」射击', 'mouse', NEWBEE_HINT_FADE_MS);
        }
        // 射击提示淡出结束，等待（0.5s + 后延迟）展示校准提示
        if (nb.fired && d.p1fade != null && d.p1fade <= 0 && !nb.subHintShown && d.p1gap === undefined) {
          d.p1gap = 500 + NEWBEE_HINT_POST_MS;
        }
        if (d.p1gap != null && d.p1gap <= 0 && !nb.subHintShown) {
          nb.subHintShown = true;
          d.p1after = 1500 + NEWBEE_HINT_POST_MS;
          this.setNewbeeHint('你的准心在一直移动，使用「射击」来校准', 'mouse');
        }
        // 校准提示播放 1.5s（+后延迟）后进入阶段2
        if (nb.subHintShown && d.p1after != null && d.p1after <= 0) {
          nb.phase = 2;
          nb.allowMove = true;
          this.setNewbeeHint('按 WASD 移动', 'wasd');
        }
        return;
      }

      if (nb.phase === 2) {
        if (nb.moved && d.p2fade === undefined) {
          d.p2fade = NEWBEE_HINT_FADE_MS;
          this.setNewbeeHint('按 WASD 移动', 'wasd', NEWBEE_HINT_FADE_MS);
        }
        if (nb.moved && d.p2fade <= 0 && d.p2wait === undefined) {
          d.p2wait = 5000 + NEWBEE_HINT_POST_MS;
        }
        if (d.p2wait != null && d.p2wait <= 0) {
          // 进入阶段3：生成 3 个屏幕外简单敌人
          nb.phase = 3;
          nb.phase3Fire = false;
          this.spawnNewbeeEnemies(3, 'basic1');
          nb.enemies = this.enemies.slice(); // 引用共享，仅用于标记（其实可直接用 this.enemies）
          this.setNewbeeHint('敌人出现了！击败他们', null);
        }
        return;
      }

      if (nb.phase === 3) {
        // 确保「敌人出现了」提示始终显示（除非玩家已开火触发淡出）
        if (!nb.phase3Fire && (!nb.hint.text || nb.hint.text !== '敌人出现了！击败他们')) {
          this.setNewbeeHint('敌人出现了！击败他们', null);
        }
        if (nb.phase3Fire && d.p3fade === undefined) {
          d.p3fade = 1000;
          this.setNewbeeHint('敌人出现了！击败他们', null, 1000);
        }
        // 击杀全部阶段3敌人 → 等待 4s（+后延迟）进入阶段4
        const p3enemiesAlive = this.enemies.some(e => e.alive && e.type === 'basic1');
        if (nb.phase3Fire && !p3enemiesAlive && d.p3after === undefined) {
          d.p3after = 4000 + NEWBEE_HINT_POST_MS;
        }
        if (d.p3after != null && d.p3after <= 0) {
          nb.phase = 4;
          nb.allowFire = false;
          nb.allowShield = true;
          // 右上角生成进阶敌人2
          const adv = this.spawnAdvanced2AtTopRight();
          nb.advanced = adv;
          this.setNewbeeHint('按「空格」进行防御', 'space');
        }
        return;
      }

      if (nb.phase === 4) {
        // 保持防御提示，直到用护盾成功抵挡一次子弹
        if (!nb.hint.text || nb.hint.text !== '按「空格」进行防御') {
          this.setNewbeeHint('按「空格」进行防御', 'space');
        }
        if (nb.shieldBlocked) {
          nb.phase = 5;
          nb.allowFire = true;
          this.setNewbeeHint('干得好！解决掉面前的敌人', null);
        }
        return;
      }

      if (nb.phase === 5) {
        // 击杀进阶敌人2后，停顿 3 秒进入阶段6
        const advAlive = this.enemies.some(e => e.alive && e.type === 'advanced2');
        if (!advAlive && d.p5pause === undefined) {
          d.p5pause = 3000;
        }
        if (d.p5pause != null && d.p5pause <= 0) {
          nb.phase = 6;
          nb.phase6Shown = true;
          this.setNewbeeHint('新手教程结束，现在你可以继续练习或离开教学了', null);
        }
        return;
      }

      if (nb.phase === 6) {
        // 两个矩形触发器（后续用特效代替）
        const p = this.player;
        // 离开教学：回到主界面（登录关卡）
        if (Math.abs(p.x - nb.exitRect.x) < nb.exitRect.w / 2 && Math.abs(p.y - nb.exitRect.y) < nb.exitRect.h / 2) {
          if (!nb.leaving) {
            nb.leaving = true;
            this.beginSwitch({ target: 'login', spawnPoint: null });
          }
          return;
        }
        // 练习：场上无敌人时进入，重复三角形成3个普通敌人
        if (Math.abs(p.x - nb.practiceRect.x) < nb.practiceRect.w / 2 && Math.abs(p.y - nb.practiceRect.y) < nb.practiceRect.h / 2) {
          if (!this.enemies.some(e => e.alive) && d.practiceCooldown === undefined) {
            d.practiceCooldown = 1200;
            this.spawnNewbeeEnemies(3, 'basic1');
          }
        }
        if (d.practiceCooldown != null && d.practiceCooldown <= 0) {
          delete this.newbeeDelay.practiceCooldown;
        }
        return;
      }
    },

    drawNewbeeHint() {
      const nb = this.newbee;
      if (!nb || !nb.hint || !nb.hint.text) {
        this.newbeeHintText?.setVisible(false);
        if (this.newbeeHintIcons) {
          for (const img of Object.values(this.newbeeHintIcons)) if (img && typeof img === 'object') img.setVisible(false);
        }
        return;
      }

      const hint = nb.hint;
      const p = this.player;
      // 出现前延迟：倒计时未结束不显示
      if (hint.pre != null && hint.pre > 0) {
        this.newbeeHintText?.setVisible(false);
        if (this.newbeeHintIcons) {
          for (const img of Object.values(this.newbeeHintIcons)) if (img && typeof img === 'object') img.setVisible(false);
        }
        return;
      }
      // 透明底淡入 / 淡出透明度
      let alpha = hint.showT != null ? Phaser.Math.Clamp(hint.showT / NEWBEE_HINT_FADE_MS, 0, 1) : 1;
      if (hint.fadeAt != null) {
        alpha = Math.min(alpha, Phaser.Math.Clamp(hint.fadeAt / NEWBEE_HINT_FADE_MS, 0, 1));
      }
      if (alpha <= 0) return;

      if (!this.newbeeHintText) {
        this.newbeeHintText = this.add.text(0, 0, '', {
          fontFamily: FONT_TECH_SC,
          fontSize: '30px', color: '#ffffff', fontStyle: 'bold'
        }).setOrigin(0.5, 1).setDepth(12);
        this.newbeeHintText.setShadow(0, 2, 'rgba(0,0,0,0.7)', 4);
        this.uiCam.ignore(this.newbeeHintText);   // 仅主相机渲染，跟随玩家显示
      }
      const t = this.newbeeHintText;
      t.setText(hint.text);
      t.setVisible(true);
      t.setAlpha(alpha);
      t.setPosition(p.x, p.y - NEWBEE_HINT_Y_OFFSET);

      // 键位图标（图片素材，若存在则叠加显示在文字上方）
      if (hint.icon) {
        const src = NEWBEE_ICONS[hint.icon];
        if (!this.newbeeHintIcons) this.newbeeHintIcons = {};
        let img = this.newbeeHintIcons[hint.icon];
        if (src && img === undefined) {
          const key = `__newbee_${hint.icon}__`;
          this.newbeeHintIcons[hint.icon] = 'loading';
          const raw = new Image();
          raw.onload = () => {
            if (!this.textures?.game) return;   // 场景/游戏已销毁，异步加载期间不可再写纹理
            // 校验资源有效性：404 等会返回非图片内容，naturalWidth 为 0
            if (!raw.naturalWidth || !raw.naturalHeight) {
              this.newbeeHintIcons[hint.icon] = null;
              return;
            }
            if (!this.textures.exists(key)) this.textures.addImage(key, raw);
            const tex = this.textures.get(key);
            if (!tex || !tex.source?.[0]?.image) { this.newbeeHintIcons[hint.icon] = null; return; }
            const spr = this.add.image(0, 0, key).setOrigin(0.5, 1).setDepth(12);
            spr.setDisplaySize(72, 72);
            this.uiCam.ignore(spr);   // 仅主相机渲染，跟随玩家显示
            this.newbeeHintIcons[hint.icon] = spr;
          };
          raw.onerror = () => { this.newbeeHintIcons[hint.icon] = null; };
          raw.src = src;
          img = this.newbeeHintIcons[hint.icon];
        }
        if (img && img !== 'loading') {
          img.setAlpha(alpha);
          img.setVisible(true);
          img.setPosition(p.x, p.y - NEWBEE_HINT_Y_OFFSET - t.height - 14);
        }
      }
    },

    drawNewbeeRects(g) {
      const nb = this.newbee;
      if (!nb || nb.phase !== 6) {
        if (this.newbeeRectLabels) for (const label of this.newbeeRectLabels.values()) label.setVisible(false);
        return;
      }
      this.drawNewbeeRect(g, nb.exitRect, 0x4fc3f7, '离开');
      this.drawNewbeeRect(g, nb.practiceRect, 0x81c784, '练习');
    },

    drawNewbeeRect(g, rect, colorHex, label) {
      g.lineStyle(3, colorHex, 0.9);
      g.strokeRect(rect.x - rect.w / 2, rect.y - rect.h / 2, rect.w, rect.h);
      g.fillStyle(colorHex, 0.15);
      g.fillRect(rect.x - rect.w / 2, rect.y - rect.h / 2, rect.w, rect.h);
      this.drawWorldLabel(rect.x, rect.y, label, colorHex);
    },

    drawWorldLabel(x, y, text, colorHex) {
      if (!this.newbeeRectLabels) this.newbeeRectLabels = new Map();
      let label = this.newbeeRectLabels.get(text);
      if (!label) {
        label = this.add.text(0, 0, text, {
          fontFamily: FONT_TECH_SC, fontSize: '20px', color: `#${colorHex.toString(16).padStart(6, '0')}`, fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(12);
        this.newbeeRectLabels.set(text, label);
      }
      label.setPosition(x, y);
      label.setVisible(true);
    },

    drawHubUI(g) {
      const hub = this.isHubLevel();
      if (!hub || this.state !== 'playing') {
        if (this.hubIcons) for (const spr of Object.values(this.hubIcons)) spr.setVisible(false);
        this.hubTipText?.setVisible(false);
        this.hubTipKeyText?.setVisible(false);
        this.fKeyBadge?.setVisible(false);
        return;
      }

      const p = this.player;
      const it = this.hubNearest;

      // 可互动物体图标占位（待制作）
      if (!this.hubIcons) this.hubIcons = {};
      for (const item of HUB_INTERACTABLES) {
        const key = item.id;
        if (!this.hubIcons[key]) {
          const spr = this.add.text(item.x, item.y, ({ workshop: '⚒', weapon: '🛒', levelSelect: '🗺' })[item.id] || '🛒', {
            fontFamily: FONT_TECH_SC, fontSize: '48px'
          }).setOrigin(0.5).setDepth(12);
          if (this.uiCam) this.uiCam.ignore(spr);   // 仅主相机渲染（世界坐标），避免镜头层出现重复图标
          this.hubIcons[key] = spr;
        }
        const spr = this.hubIcons[key];
        spr.setPosition(item.x, item.y);
        spr.setVisible(true);
        if (it === item) {
          const r = HUB_INTERACT_RADIUS;
          g.lineStyle(2, 0xffd54f, 0.7);
          g.strokeCircle(item.x, item.y, r);
        }
      }

      // F 键提示渐显（透明度由 updateHubInteract 累积）
      const alpha = this.hubTipT ?? 0;
      if (alpha <= 0 || !it) {
        this.hubTipText?.setVisible(false);
        this.hubTipKeyText?.setVisible(false);
        this.fKeyBadge?.setVisible(false);
        return;
      }

      const tx = p.x + 20, ty = p.y - 20;
      // 平行四边形白底
      const w = 190, h = 44, skew = 18;
      g.fillStyle(0xffffff, 0.92 * alpha);
      g.beginPath();
      g.moveTo(tx + skew, ty - h / 2);
      g.lineTo(tx + w, ty - h / 2);
      g.lineTo(tx + w - skew, ty + h / 2);
      g.lineTo(tx, ty + h / 2);
      g.closePath();
      g.fillPath();

      if (!this.hubTipText) {
        this.hubTipText = this.add.text(0, 0, '', {
          fontFamily: FONT_TECH_SC, fontSize: '22px', color: '#000000'
        }).setOrigin(0, 0.5).setDepth(13);
        if (this.uiCam) this.uiCam.ignore(this.hubTipText);
      }
      const tip = this.hubTipText;
      tip.setText(it.label);
      tip.setPosition(tx + skew + 42, ty);
      tip.setAlpha(alpha);
      tip.setVisible(true);

      // F 键帽图标
      const badge = this.getFKeyBadge();
      if (badge) {
        badge.setPosition(tx + skew + 21, ty);
        badge.setAlpha(alpha);
        badge.setVisible(true);
      }
    },
};
