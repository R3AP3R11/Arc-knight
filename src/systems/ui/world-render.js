/**
 * 文件职责：世界层渲染与精灵同步（背景图 / 桶 / 售货机 / 神像 / 图标 / 传送门 / 宝箱 / 主渲染 draw）
 * 归属分类：UI交互
 * 主要导出：WorldRenderMixin（12 个方法）
 * 依赖：systems/constants.js、systems/combat/geometry.js、systems/ui/entity-art.js、systems/editor/editor-geometry.js、state.js
 */
import Phaser from 'phaser';
import { CELL, FONT_TECH, BARREL_TEX_KEY, CHEST_CLOSED_KEY, CHEST_OPEN_KEY, CHEST_SIZE, CHEST_OPEN_SCALE_CORRECTION, PORTAL_ALPHA, PORTAL_LABEL, VENDOR_TEX_KEY, IDOL_TEX_KEY, ROTATE_HANDLE_OFFSET, HIT_FX_TTL, HIT_FX_RADIUS } from '../constants.js';
import { wallCorners, wallRotationRad } from '../combat/geometry.js';
import { color, drawCrate, drawCrateDebris, drawPortalShape, drawWormhole, drawEnemyShape, drawDropDiamond, drawWallShape, drawShieldArc, drawPlayer } from './entity-art.js';
import { drawGates } from '../editor/editor-geometry.js';
import { drawBoss25T5Zones, drawBoss25T5Vortices } from './boss25t5-art.js';
import { WEAPONS } from '../combat/weapons.js';
import { DEFAULT_WALL_COLOR } from '../../state.js';
import { ensureDesigns } from '../art/design-store.js';

export const WorldRenderMixin = {
    // 按需加载玩家 / 敌人引用的画板设计稿（幂等，缓存命中后零成本）
    requestArtDesigns() {
      const ids = [];
      if (this.player?.art) ids.push(this.player.art);
      const enemies = this.editing ? (this.ctx.state.level.enemies || []) : (this.enemies || []);
      for (const e of enemies) if (e?.art) ids.push(e.art);
      for (const pet of (this.pets || [])) if (pet?.art) ids.push(pet.art);
      if (!ids.length) return;
      if (!this._artReq) this._artReq = new Set();
      const fresh = ids.filter(id => !this._artReq.has(id));
      if (fresh.length) { fresh.forEach(id => this._artReq.add(id)); ensureDesigns(fresh); }
    },
    iconSprite(id, src) {
      if (!this.menuIconSprites) this.menuIconSprites = new Map();
      if (this.menuIconSprites.has(id)) return this.menuIconSprites.get(id);
      if (!this.menuIconLoading) this.menuIconLoading = new Set();
      const texKey = `__menu_icon_${id}__`;
      const make = () => {
        const s = this.add.image(0, 0, texKey).setOrigin(0.5).setDepth(1002);
        this.cameras.main.ignore(s);
        s.setVisible(false);
        this.menuIconSprites.set(id, s);
        return s;
      };
      if (this.textures.exists(texKey)) return make();
      if (this.menuIconLoading.has(id)) return null;
      this.menuIconLoading.add(id);
      const raw = new Image();
      raw.onload = () => {
        if (!this.textures?.game) return;   // 场景/游戏已销毁，异步加载期间不可再写纹理
        this.menuIconLoading.delete(id);
        if (!raw.naturalWidth || this.menuIconSprites.has(id)) return;
        if (!this.textures.exists(texKey)) this.textures.addImage(texKey, raw);
        make();
      };
      raw.onerror = () => this.menuIconLoading.delete(id);
      raw.src = src;
      return null;
    },

    loadBackgroundImage() {
    const ctx = this.ctx;
      if (this.bgImage) {
        this.bgImage.destroy();
        this.bgImage = null;
      }
      const key = '__level_bg__';
      if (this.textures.exists(key)) this.textures.remove(key);

      const bg = ctx.state.level.background;
      if (!bg?.src) return;

      this.load.once('complete', () => {
        if (!this.textures.exists(key)) return;
        this.bgImage = this.add.image(bg.x, bg.y, key).setOrigin(0.5).setDepth(1);
        if (this.uiCam) this.uiCam.ignore(this.bgImage);
        this.applyBackground();
      });
      this.load.image(key, bg.src);
      this.load.start();
    },

    reloadBackground() {
      this.loadBackgroundImage();
    },

    syncLevelImages() {
    const ctx = this.ctx;
      const images = ctx.state.level.images || [];
      for (const img of images) {
        const key = `__lvl_img_${img.id}__`;
        let sprite = this.levelImageSprites.get(img.id);

        if (sprite && sprite.getData('src') !== img.src) {
          sprite.destroy();
          this.levelImageSprites.delete(img.id);
          if (this.textures.exists(key)) this.textures.remove(key);
          sprite = null;
        }

        if (!sprite) {
          if (this.textures.exists(key)) {
            sprite = this.add.image(img.x, img.y, key).setOrigin(0.5).setDepth(2);
            sprite.setData('src', img.src);
            if (this.uiCam) this.uiCam.ignore(sprite);
            this.levelImageSprites.set(img.id, sprite);
          } else if (!this.levelImageLoading.has(key)) {
            this.levelImageLoading.add(key);
            this.load.once(`filecomplete-image-${key}`, () => {
              this.levelImageLoading.delete(key);
              this.syncLevelImages();
            });
            this.load.image(key, img.src);
            this.load.start();
          }
          continue;
        }

        sprite.setPosition(img.x, img.y);
        const ra = this.roomRevealAlpha(img.x, img.y);
        sprite.setAlpha(ra);
        sprite.setVisible((this.editing || img.visible !== false) && ra > 0);
        const tw = sprite.frame?.width || img.w;
        const th = sprite.frame?.height || img.h;
        sprite.setScale(img.w / tw, img.h / th);
      }

      const seen = new Set(images.map(i => i.id));
      for (const [id, sprite] of this.levelImageSprites) {
        if (!seen.has(id)) {
          sprite.destroy();
          this.levelImageSprites.delete(id);
        }
      }
    },

    applyBackground() {
    const ctx = this.ctx;
      const bg = ctx.state.level.background;
      if (!this.bgImage) return;
      if (!bg?.src) {
        this.bgImage.setVisible(false);
        return;
      }
      this.bgImage.setVisible(bg.visible !== false);
      this.bgImage.setPosition(bg.x, bg.y);
      const frame = this.bgImage.frame;
      const tw = frame?.width || bg.w;
      const th = frame?.height || bg.h;
      this.bgImage.setScale(bg.w / tw, bg.h / th);
    },

    syncBarrelSprites() {
    const ctx = this.ctx;
      if (!this.textures.exists(BARREL_TEX_KEY)) return;

      const barrels = this.editing
        ? (ctx.state.level.barrels || [])
        : this.barrels.filter(b => b.alive);

      const seen = new Set();
      for (const b of barrels) {
        seen.add(b.id);
        let img = this.barrelSprites.get(b.id);
        if (!img) {
          img = this.add.image(b.x, b.y, BARREL_TEX_KEY).setOrigin(0.5).setDepth(9);
          if (this.uiCam) this.uiCam.ignore(img);
          this.barrelSprites.set(b.id, img);
        }
        img.setPosition(b.x, b.y);
        const tw = img.frame?.width || 60;
        img.setScale((b.r * 2) / tw);
        const ra = this.roomRevealAlpha(b.x, b.y);
        img.setAlpha(ra);
        img.setVisible(ra > 0);
      }

      for (const [id, img] of this.barrelSprites) {
        if (!seen.has(id)) {
          img.destroy();
          this.barrelSprites.delete(id);
        }
      }
    },

    syncVendorSprites() {
    const ctx = this.ctx;
      if (!this.textures.exists(VENDOR_TEX_KEY)) return;

      const vendors = this.editing ? (ctx.state.level.vendors || []) : (this.vendors || []);
      const seen = new Set();
      for (const v of vendors) {
        seen.add(v.id);
        let img = this.vendorSprites.get(v.id);
        if (!img) {
          img = this.add.image(v.x, v.y, VENDOR_TEX_KEY).setOrigin(0.5).setDepth(9);
          if (this.uiCam) this.uiCam.ignore(img);
          this.vendorSprites.set(v.id, img);
        }
        img.setPosition(v.x, v.y);
        const tw = img.frame?.width || 1024;
        const th = img.frame?.height || 755;
        img.setScale(Math.min(v.w / tw, v.h / th));
        const ra = this.roomRevealAlpha(v.x, v.y);
        img.setAlpha(ra);
        img.setVisible(v.visible !== false && ra > 0);
      }

      for (const [id, img] of this.vendorSprites) {
        if (!seen.has(id)) {
          img.destroy();
          this.vendorSprites.delete(id);
        }
      }
    },

    syncIdolSprites() {
    const ctx = this.ctx;
      if (!this.textures.exists(IDOL_TEX_KEY)) return;

      const idols = this.editing ? (ctx.state.level.idols || []) : (this.idols || []);
      const seen = new Set();
      for (const v of idols) {
        seen.add(v.id);
        let img = this.idolSprites.get(v.id);
        if (!img) {
          img = this.add.image(v.x, v.y, IDOL_TEX_KEY).setOrigin(0.5).setDepth(9);
          if (this.uiCam) this.uiCam.ignore(img);
          this.idolSprites.set(v.id, img);
        }
        img.setPosition(v.x, v.y);
        const tw = img.frame?.width || 1145;
        const th = img.frame?.height || 1098;
        img.setScale(Math.min(v.w / tw, v.h / th));
        const ra = this.roomRevealAlpha(v.x, v.y);
        img.setAlpha(ra);
        img.setVisible(v.visible !== false && ra > 0);
      }

      for (const [id, img] of this.idolSprites) {
        if (!seen.has(id)) {
          img.destroy();
          this.idolSprites.delete(id);
        }
      }
    },

    syncIconSprites() {
    const ctx = this.ctx;
      const icons = this.editing ? (ctx.state.level.icons || []) : (this.icons || []);
      for (const ic of icons) {
        if (!ic.src) continue;
        const key = `__icon_${ic.id}__`;
        let sprite = this.iconSprites.get(ic.id);

        if (sprite && sprite.getData('src') !== ic.src) {
          sprite.destroy();
          this.iconSprites.delete(ic.id);
          if (this.textures.exists(key)) this.textures.remove(key);
          sprite = null;
        }

        if (!sprite) {
          if (this.textures.exists(key)) {
            sprite = this.add.image(ic.x, ic.y, key).setOrigin(0.5).setDepth(9);
            sprite.setData('src', ic.src);
            if (this.uiCam) this.uiCam.ignore(sprite);
            this.iconSprites.set(ic.id, sprite);
          } else if (!this.iconLoading.has(key)) {
            this.iconLoading.add(key);
            this.load.once(`filecomplete-image-${key}`, () => {
              this.iconLoading.delete(key);
              this.syncIconSprites();
            });
            this.load.image(key, ic.src);
            this.load.start();
          }
          continue;
        }

        sprite.setPosition(ic.x, ic.y);
        const ra = this.roomRevealAlpha(ic.x, ic.y);
        sprite.setAlpha(ra);
        sprite.setVisible((this.editing || ic.visible !== false) && ra > 0);
        const tw = sprite.frame?.width || ic.w;
        const th = sprite.frame?.height || ic.h;
        sprite.setScale(Math.min(ic.w / tw, ic.h / th));
      }

      const seen = new Set(icons.filter(i => i.src).map(i => i.id));
      for (const [id, sprite] of this.iconSprites) {
        if (!seen.has(id)) {
          sprite.destroy();
          this.iconSprites.delete(id);
        }
      }
    },

    syncPortalSprites() {
    const ctx = this.ctx;
      const portals = this.editing
        ? (ctx.state.level.portals || [])
        : (this.portals || []).filter(p => p.spawned && p.visible !== false);

      const seen = new Set();
      for (const p of portals) {
        seen.add(p.id);
        let t = this.portalTexts.get(p.id);
        if (!t) {
          t = this.add.text(p.x, p.y, PORTAL_LABEL, {
            fontFamily: FONT_TECH, fontSize: '12px', color: '#000000', fontStyle: 'bold'
          }).setOrigin(0.5).setDepth(10).setAlpha(PORTAL_ALPHA);
          if (this.uiCam) this.uiCam.ignore(t);
          this.portalTexts.set(p.id, t);
        }
        t.setPosition(p.x, p.y);
        t.setRotation(Phaser.Math.DegToRad(p.rotation || 0));
        t.setFontSize(Math.max(10, Math.round(p.h * 0.26)));
        const ra = this.roomRevealAlpha(p.x, p.y);
        t.setAlpha(PORTAL_ALPHA * ra);
        t.setVisible(ra > 0);
      }

      for (const [id, t] of this.portalTexts) {
        if (!seen.has(id)) {
          t.destroy();
          this.portalTexts.delete(id);
        }
      }
    },

    syncChestSprites() {
    const ctx = this.ctx;
      if (!this.textures.exists(CHEST_CLOSED_KEY) || !this.textures.exists(CHEST_OPEN_KEY)) return;

      const chests = this.editing
        ? (ctx.state.level.chests || [])
        : (this.chests || []).filter(c => c.spawned);

      const seen = new Set();
      for (const c of chests) {
        seen.add(c.id);
        let img = this.chestSprites.get(c.id);
        if (!img) {
          img = this.add.image(c.x, c.y, CHEST_CLOSED_KEY).setOrigin(0.5).setDepth(9);
          if (this.uiCam) this.uiCam.ignore(img);
          this.chestSprites.set(c.id, img);
        }
        img.setPosition(c.x, c.y);
        const opened = this.editing ? false : c.opened;
        const tex = opened ? CHEST_OPEN_KEY : CHEST_CLOSED_KEY;
        if (img.texture.key !== tex) img.setTexture(tex);
        const tw = img.frame?.width || 1254;
        // 开启态内容在画布内留白更多，按内容宽比补偿，使开启/常态视觉同宽
        const correction = opened ? CHEST_OPEN_SCALE_CORRECTION : 1;
        img.setScale(CHEST_SIZE / tw * correction);
        const ra = this.roomRevealAlpha(c.x, c.y);
        img.setAlpha(ra);
        img.setVisible(ra > 0);
      }

      for (const [id, img] of this.chestSprites) {
        if (!seen.has(id)) {
          img.destroy();
          this.chestSprites.delete(id);
        }
      }
    },

    draw() {
    const ctx = this.ctx;
      const l = ctx.state.level;
      const g = this.g;
      const { w: ww, h: wh } = this.worldSize();

      if (this.editing && this.hudIndicatorText) this.hudIndicatorText.setVisible(false);

      this.bgG.clear();
      this.bgG.fillStyle(color(l.backgroundColor));
      this.bgG.fillRect(0, 0, ww, wh);
      this.applyBackground();
      this.syncLevelImages();

      g.clear();

      if (l.background?.fx === 'wormhole') drawWormhole(g, l.background, this.time.now / 1000, this.intro || null);

      if ((this.editing && ctx.state.showGridInEditor) || (!this.editing && l.showGridInPlay)) {
        const gridW = this.cameras.main.zoomX ? 1 / this.cameras.main.zoomX : 1;
        g.lineStyle(gridW, color(l.gridColor), .7);
        for (let x = 0; x <= ww; x += CELL) g.lineBetween(x, 0, x, wh);
        for (let y = 0; y <= wh; y += CELL) g.lineBetween(0, y, ww, y);
      }

      l.walls.forEach(w => {
        if (!this.editing && w.visible === false) return;
        drawWallShape(g, w, color(w.color || DEFAULT_WALL_COLOR));

        if (ctx.state.selected === w && this.editing) {
          const corners = wallCorners(w);
          g.lineStyle(2, 0xffe083);
          g.beginPath();
          g.moveTo(corners[0].x, corners[0].y);
          for (let i = 1; i < 4; i++) g.lineTo(corners[i].x, corners[i].y);
          g.closePath();
          g.strokePath();

          for (const c of corners) {
            g.fillStyle(0xffffff);
            g.fillRect(c.x - 5, c.y - 5, 10, 10);
          }

          const r = wallRotationRad(w);
          const cr = Math.cos(r), sr = Math.sin(r);
          const off = ROTATE_HANDLE_OFFSET + w.h / 2;
          const rhx = w.x + off * sr;
          const rhy = w.y - off * cr;
          g.lineStyle(1, 0xffffff, .8);
          g.lineBetween(w.x, w.y, rhx, rhy);
          g.fillStyle(0xffe083);
          g.fillCircle(rhx, rhy, 6);
        }
      });

      const crates = this.editing ? (l.crates || []) : this.crates.filter(c => c.alive);
      crates.forEach(c => {
        drawCrate(g, c.x, c.y, this.roomRevealAlpha(c.x, c.y));
        if (this.editing && ctx.state.selected === c) {
          g.lineStyle(2, 0xffe083);
          g.strokeRect(c.x - c.w / 2, c.y - c.h / 2, c.w, c.h);
        }
      });

      this.syncBarrelSprites();
      const barrels = this.editing ? (l.barrels || []) : this.barrels.filter(b => b.alive);
      barrels.forEach(b => {
        if (this.editing && ctx.state.selected === b) {
          g.lineStyle(2, 0xffe083);
          g.strokeCircle(b.x, b.y, b.r + 2);
        }
      });

      this.syncChestSprites();
      this.syncVendorSprites();
      this.syncIdolSprites();
      this.syncIconSprites();
      this.drawIcons(g);
      this.syncPortalSprites();
      const chests = this.editing ? (l.chests || []) : (this.chests || []).filter(c => c.spawned);
      if (this.editing) {
        chests.forEach(c => {
          if (ctx.state.selected === c) {
            g.lineStyle(2, 0xffe083);
            g.strokeCircle(c.x, c.y, c.openRadius);
          }
        });
      }
      this.drawChestEffects(g);

      const portals = this.editing ? (l.portals || []) : (this.portals || []).filter(p => p.spawned && p.visible !== false);
      portals.forEach(p => {
        drawPortalShape(g, p.x, p.y, p.w, p.h, p.rotation || 0, this.roomRevealAlpha(p.x, p.y));
        if (this.editing && ctx.state.selected === p) {
          g.lineStyle(2, 0xffe083);
          g.strokeCircle(p.x, p.y, p.interactRadius || 90);
          const corners = wallCorners(p);
          g.lineStyle(2, 0xffe083);
          g.beginPath();
          g.moveTo(corners[0].x, corners[0].y);
          for (let i = 1; i < 4; i++) g.lineTo(corners[i].x, corners[i].y);
          g.closePath();
          g.strokePath();
          for (const c of corners) {
            g.fillStyle(0xffffff);
            g.fillRect(c.x - 5, c.y - 5, 10, 10);
          }
          const r = wallRotationRad(p);
          const cr = Math.cos(r), sr = Math.sin(r);
          const off = ROTATE_HANDLE_OFFSET + p.h / 2;
          const rhx = p.x + off * sr;
          const rhy = p.y - off * cr;
          g.lineStyle(1, 0xffffff, .8);
          g.lineBetween(p.x, p.y, rhx, rhy);
          g.fillStyle(0xffe083);
          g.fillCircle(rhx, rhy, 6);
        }
      });
      this.drawPortalEffects(g);

      drawGates(this, g, l, ctx.state.selected);

      if (this.editing) {
        (l.spawnZones || []).forEach(z => {
          const sel = ctx.state.selected === z;
          g.lineStyle(2, sel ? 0xffe083 : color(z.color || '#7ee787'), sel ? 1 : 0.6);
          g.strokeRect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h);
          g.lineStyle(1, sel ? 0xffe083 : color(z.color || '#7ee787'), 0.3);
          g.strokeRect(z.x - z.w / 2 + 4, z.y - z.h / 2 + 4, z.w - 8, z.h - 8);
          if (sel) {
            for (const [hx, hy] of [
              [z.x - z.w / 2, z.y - z.h / 2],
              [z.x + z.w / 2, z.y - z.h / 2],
              [z.x - z.w / 2, z.y + z.h / 2],
              [z.x + z.w / 2, z.y + z.h / 2]
            ]) {
              g.fillStyle(0xffffff);
              g.fillRect(hx - 5, hy - 5, 10, 10);
            }
          }
        });
      }

      if (!this.editing) {
        this.crateDebris.forEach(d => drawCrateDebris(g, d));
      }

      l.triggers.forEach(t => {
        if (!t.visible && !this.editing) return;
        g.fillStyle(color(t.color));
        if (t.shape === 'circle') {
          const r = Math.max(t.w, t.h) / 2;
          g.fillCircle(t.x, t.y, r);
          g.lineStyle(2, ctx.state.selected === t ? 0xffe083 : 0xffffff, .6);
          g.strokeCircle(t.x, t.y, r);
          if (ctx.state.selected === t && this.editing) {
            g.lineStyle(2, 0xffe083);
            g.strokeCircle(t.x, t.y, r + 4);
          }
          return;
        }
        g.fillRect(t.x - t.w / 2, t.y - t.h / 2, t.w, t.h);
        g.lineStyle(2, ctx.state.selected === t ? 0xffe083 : 0xffffff, .6);
        g.strokeRect(t.x - t.w / 2, t.y - t.h / 2, t.w, t.h);

        if (ctx.state.selected === t && this.editing) {
          for (const [hx, hy] of [
            [t.x - t.w / 2, t.y - t.h / 2],
            [t.x + t.w / 2, t.y - t.h / 2],
            [t.x - t.w / 2, t.y + t.h / 2],
            [t.x + t.w / 2, t.y + t.h / 2]
          ]) {
            g.fillStyle(0xffffff);
            g.fillRect(hx - 5, hy - 5, 10, 10);
          }
        }
      });

      if (this.editing) {
        g.fillStyle(0x45c8ff);
        g.fillCircle(l.spawn.x, l.spawn.y, 14);
        if (ctx.state.selected === l.spawn) {
          g.lineStyle(2, 0xffe083);
          g.strokeCircle(l.spawn.x, l.spawn.y, 20);
        }
      }

      this.requestArtDesigns();

      if (this.editing) {
        l.enemies.forEach(e => drawEnemyShape(g, e, false));
      } else {
        this.drawSpawnEffects(g);
        this.drawLockEffects(g);
        this.enemies.forEach(e => { if (e.alive) drawEnemyShape(g, e, true, this.player, (this.time?.now || 0) / 1000, this.roomRevealAlpha(e.x, e.y)); });
        this.hitEffects.forEach(h => {
          g.fillStyle(h.color || 0xffffff, Math.max(0, h.ttl / HIT_FX_TTL));
          g.fillCircle(h.x, h.y, HIT_FX_RADIUS);
        });
        this.drops.forEach(d => {
          const da = this.roomRevealAlpha(d.x, d.y);
          if (da <= 0) return;
          if (d.type === 'gold') drawDropDiamond(g, d.x, d.y, 0xffd54f, da);
          else if (d.type === 'diamond') drawDropDiamond(g, d.x, d.y, 0x00e5ff, da);
          else {
            g.fillStyle(d.type === 'charge' ? color(WEAPONS[d.weapon]?.ringColor || '#3a7bff') : 0xffffff, da);
            g.fillCircle(d.x, d.y, 3);
          }
        });
      }

      if (!this.editing) {
        if (!this.isMenuLevel()) {
          // BOSS「原型机-2-5T5」技能5 蓝色漩涡：画在技能区域黑遮罩之前（遮罩须盖住漩涡），
          // 也一定在 drawPlayer 之前 → 图层「玩家之下、其余世界元素之上」。
          drawBoss25T5Vortices(g, this.boss25t5Vortices || [], (this.time?.now || 0) / 1000);
          // BOSS「原型机-2-5T5」技能区域 + 黑色遮罩：紧贴 drawPlayer 之前调用，
          // 保证图层在「玩家之下、其余世界元素之上」（本体已在上方敌人循环绘制，天然在遮罩之下）。
          this.enemies.forEach(e => { if (e.type === 'boss-2-5t5' && e.alive) drawBoss25T5Zones(g, e, (this.time?.now || 0) / 1000); });
          drawPlayer(g, this.player, (this.time?.now || 0) / 1000);
          drawShieldArc(g, this.player);
          this.drawPets(g, (this.time?.now || 0) / 1000);
          this.drawNewbeeHint();
          this.drawNewbeeRects(g);
          this.drawHubUI(g);
          this.drawVendorUI(g);
          this.drawIdolUI(g);
          this.drawIconUI(g);
          this.drawPortalUI(g);
          this.drawGuideArrows(g);
          this.lasers.forEach(l => {
            g.lineStyle(l.width, color(l.color), 0.9);
            g.lineBetween(l.x0, l.y0, l.x1, l.y1);
          });
          this.bullets.forEach(b => WEAPONS[b.weaponType]?.drawBullet(g, b));
          this.enemyBullets.forEach(b => {
            const speed = Math.hypot(b.vx, b.vy) || 1;
            const ux = b.vx / speed, uy = b.vy / speed;
            const px = -uy, py = ux;
            const gap = 1;
            const tailStartX = b.x - ux * gap;
            const tailStartY = b.y - uy * gap;
            const tailEndX = b.x - ux * (gap + b.trailLen);
            const tailEndY = b.y - uy * (gap + b.trailLen);
            g.fillStyle(0xffffff, 0.9);
            g.beginPath();
            g.moveTo(tailStartX + px * 2.5, tailStartY + py * 2.5);
            g.lineTo(tailEndX, tailEndY);
            g.lineTo(tailStartX - px * 2.5, tailStartY - py * 2.5);
            g.closePath();
            g.fillPath();
            g.fillStyle(0xffffff);
            g.fillCircle(b.x, b.y, 2.5);
          });
          this.drawHitFlash(g);
        }
        this.drawUI();
      }

      if (this.editing && l.background && ctx.state.selected === l.background) {
        const bg = l.background;
        if (bg.fx === 'wormhole') {
          g.lineStyle(2, 0x6fd3ff);
          g.strokeCircle(bg.x, bg.y, bg.radius + 20);
        } else {
          g.lineStyle(2, 0x6fd3ff);
          g.strokeRect(bg.x - bg.w / 2, bg.y - bg.h / 2, bg.w, bg.h);
          for (const [hx, hy] of [
            [bg.x - bg.w / 2, bg.y - bg.h / 2],
            [bg.x + bg.w / 2, bg.y - bg.h / 2],
            [bg.x - bg.w / 2, bg.y + bg.h / 2],
            [bg.x + bg.w / 2, bg.y + bg.h / 2]
          ]) {
            g.fillStyle(0xffffff);
            g.fillRect(hx - 5, hy - 5, 10, 10);
          }
        }
      }

      if (this.editing && ctx.state.selected && (l.idols || []).includes(ctx.state.selected)) {
        const v = ctx.state.selected;
        g.lineStyle(2, 0x6fd3ff);
        g.strokeRect(v.x - v.w / 2, v.y - v.h / 2, v.w, v.h);
        for (const [hx, hy] of [
          [v.x - v.w / 2, v.y - v.h / 2],
          [v.x + v.w / 2, v.y - v.h / 2],
          [v.x - v.w / 2, v.y + v.h / 2],
          [v.x + v.w / 2, v.y + v.h / 2]
        ]) {
          g.fillStyle(0xffffff);
          g.fillRect(hx - 5, hy - 5, 10, 10);
        }
        g.lineStyle(1, 0xffd54f, 0.5);
        g.strokeCircle(v.x, v.y, v.interactRadius || 130);
      }

      if (this.editing && ctx.state.selected && (l.vendors || []).includes(ctx.state.selected)) {
        const v = ctx.state.selected;
        g.lineStyle(2, 0x6fd3ff);
        g.strokeRect(v.x - v.w / 2, v.y - v.h / 2, v.w, v.h);
        for (const [hx, hy] of [
          [v.x - v.w / 2, v.y - v.h / 2],
          [v.x + v.w / 2, v.y - v.h / 2],
          [v.x - v.w / 2, v.y + v.h / 2],
          [v.x + v.w / 2, v.y + v.h / 2]
        ]) {
          g.fillStyle(0xffffff);
          g.fillRect(hx - 5, hy - 5, 10, 10);
        }
        g.lineStyle(1, 0xffd54f, 0.5);
        g.strokeCircle(v.x, v.y, v.interactRadius || 120);
      }

      if (this.editing && ctx.state.selected && (l.icons || []).includes(ctx.state.selected)) {
        const ic = ctx.state.selected;
        g.lineStyle(2, 0x6fd3ff);
        g.strokeRect(ic.x - ic.w / 2, ic.y - ic.h / 2, ic.w, ic.h);
        for (const [hx, hy] of [
          [ic.x - ic.w / 2, ic.y - ic.h / 2],
          [ic.x + ic.w / 2, ic.y - ic.h / 2],
          [ic.x - ic.w / 2, ic.y + ic.h / 2],
          [ic.x + ic.w / 2, ic.y + ic.h / 2]
        ]) {
          g.fillStyle(0xffffff);
          g.fillRect(hx - 5, hy - 5, 10, 10);
        }
        g.lineStyle(1, 0xffd54f, 0.5);
        g.strokeCircle(ic.x, ic.y, ic.interactRadius || 120);
      }

      if (this.editing && ctx.state.selected && l.images.includes(ctx.state.selected)) {
        const im = ctx.state.selected;
        g.lineStyle(2, 0x6fd3ff);
        g.strokeRect(im.x - im.w / 2, im.y - im.h / 2, im.w, im.h);
        for (const [hx, hy] of [
          [im.x - im.w / 2, im.y - im.h / 2],
          [im.x + im.w / 2, im.y - im.h / 2],
          [im.x - im.w / 2, im.y + im.h / 2],
          [im.x + im.w / 2, im.y + im.h / 2]
        ]) {
          g.fillStyle(0xffffff);
          g.fillRect(hx - 5, hy - 5, 10, 10);
        }
      }

      if (ctx.state.selected && ctx.state.selected !== l.spawn && !l.triggers.includes(ctx.state.selected) && ctx.state.selected !== l.background && !l.images.includes(ctx.state.selected)) {
        g.lineStyle(2, 0xffe083);
        g.strokeCircle(ctx.state.selected.x, ctx.state.selected.y, 22);
      }
    },
};
