/**
 * 文件职责：编辑器鼠标 / 键盘输入处理（拖拽 / 画墙 / 选择 / 框选 / 滚轮缩放）
 * 归属分类：引擎(编辑器)需求
 * 主要导出：EditorInputMixin（3 个方法）
 * 依赖：systems/constants.js、systems/combat/geometry.js、systems/editor/editor-geometry.js、state.js
 */
import Phaser from 'phaser';
import { CELL } from '../constants.js';
import { snap } from '../combat/geometry.js';
import { pickTopEntity, rotationHandleAt, handleAtRect, backgroundHandleAt, resizeBackground, resizeRect } from './editor-geometry.js';
import { DEFAULT_WALL_COLOR, normalizeEnemy, normalizePortal, normalizeCrate, normalizeBarrel, normalizeChest } from '../../state.js';

export const EditorInputMixin = {
    pointerDown(p) {
    const ctx = this.ctx;
      if (!this.editing) {
        if (this.menuScreen) {
          if (this.menuScreen === 'workshop' && this.handleWorkshopPointerDown(p)) return;
          if (this.menuScreen === 'weapon' && this.handleShopPointerDown()) return;
          if (this.menuScreen === 'levelSelect' && this.levelSelectPage === 2) {
            const up = this.uiPointer();
            const hitBtn = this.buttons.some(b => up.x >= b.x && up.x <= b.x + b.w && up.y >= b.y && up.y <= b.y + b.h);
            if (!hitBtn) {
              this.levelSelectDrag = { sx: up.x, sy: up.y, ox: this.smallLevelPan?.x || 0, oy: this.smallLevelPan?.y || 0 };
              return;
            }
          }
          this.onUIPointer(p);
          return;
        }
        if (this.isMenuLevel()) {
          const up = this.uiPointer();
          for (const id in this.loginButtonRects) {
            const r = this.loginButtonRects[id];
            if (up.x >= r.x && up.x <= r.x + r.w && up.y >= r.y && up.y <= r.y + r.h) {
              this.pressAnim(id);
              this.onLoginButtonClick(id);
              return;
            }
          }
          this.onUIPointer(p);
          return;
        }
        if (this.state === 'playing' && this.settingsButtonRect) {
          const up = this.uiPointer();
          const r = this.settingsButtonRect;
          if (up.x >= r.x && up.x <= r.x + r.w && up.y >= r.y && up.y <= r.y + r.h) {
            this.pressAnim('settingsBtn');
            this.openSettingsOverlay();
            return;
          }
        }
        if (this.state === 'paused') { this.onUIPointer(p); return; }
        if (this.state === 'end' || this.state === 'fail') { this.onUIPointer(p); return; }
        return;
      }

      if (p.middleButtonDown() || p.rightButtonDown()) {
        this.panning = true;
        this.panStart = { x: p.x, y: p.y, sx: this.cameras.main.scrollX, sy: this.cameras.main.scrollY };
        return;
      }

      // 记录一次撤销快照（放置/拖拽/旋转/缩放/删除等编辑操作前）
      ctx.pushUndo?.();

      const l = ctx.state.level;
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      const x = snap(wp.x);
      const y = snap(wp.y);
      const tool = ctx.state.tool;
      const selected = ctx.state.selected;
      const selectedWall = selected && l.walls.includes(selected);
      const selectedTrigger = selected && l.triggers.includes(selected);
      const selectedImage = selected && l.images.includes(selected);
      const selectedGate = selected && l.gates.includes(selected);
      const selectedZone = selected && (l.spawnZones || []).includes(selected);
      const selectedVendor = selected && (l.vendors || []).includes(selected);
      const selectedIdol = selected && (l.idols || []).includes(selected);
      const selectedIcon = selected && (l.icons || []).includes(selected);
      const selectedPortal = selected && (l.portals || []).includes(selected);

      if (tool === 'select' && selected && (selectedWall || selectedTrigger || selectedImage || selectedGate || selectedZone || selectedVendor || selectedIdol || selectedIcon || selectedPortal)) {
        if ((selectedWall || selectedGate || selectedPortal) && rotationHandleAt(selected, wp.x, wp.y)) {
          this.drag = { mode: 'rotate', entity: selected };
          return;
        }
        const handle = handleAtRect(selected, wp.x, wp.y);
        if (handle) {
          this.drag = { mode: 'resize', handle, entity: selected };
          return;
        }
      }

      if (tool === 'select' && selected && selected === l.background) {
        const bh = backgroundHandleAt(selected, wp.x, wp.y);
        if (bh) {
          this.drag = { mode: 'bg-resize', handle: bh, entity: selected };
          return;
        }
      }

      if (tool === 'erase') {
        const hit = pickTopEntity(l, wp.x, wp.y);
        if (hit) {
          if (hit.type === 'wall') {
            l.walls = l.walls.filter(w => w !== hit.entity);
          } else if (hit.type === 'enemy') {
            l.enemies = l.enemies.filter(e => e !== hit.entity);
          } else if (hit.type === 'trigger') {
            l.triggers = l.triggers.filter(t => t !== hit.entity);
          } else if (hit.type === 'crate') {
            l.crates = l.crates.filter(c => c !== hit.entity);
          } else if (hit.type === 'barrel') {
            l.barrels = l.barrels.filter(b => b !== hit.entity);
          } else if (hit.type === 'chest') {
            l.chests = l.chests.filter(c => c !== hit.entity);
          } else if (hit.type === 'image') {
            l.images = l.images.filter(im => im !== hit.entity);
          } else if (hit.type === 'gate') {
            l.gates = l.gates.filter(gt => gt !== hit.entity);
          } else if (hit.type === 'vendor') {
            l.vendors = l.vendors.filter(v => v !== hit.entity);
          } else if (hit.type === 'idol') {
            l.idols = l.idols.filter(v => v !== hit.entity);
          } else if (hit.type === 'icon') {
            l.icons = (l.icons || []).filter(v => v !== hit.entity);
          } else if (hit.type === 'portal') {
            l.portals = (l.portals || []).filter(v => v !== hit.entity);
          } else if (hit.type === 'spawnZone') {
            l.spawnZones = (l.spawnZones || []).filter(z => z !== hit.entity);
          } else if (hit.type === 'background') {
            l.background = null;
          }
        }
        if (selected && !l.walls.includes(selected) && !l.triggers.includes(selected)
          && !l.enemies.includes(selected) && !l.crates.includes(selected)
          && !l.barrels.includes(selected) && !l.chests.includes(selected)
          && !l.images.includes(selected)
          && !l.gates.includes(selected)
          && !l.vendors.includes(selected)
          && !l.idols.includes(selected)
          && !(l.icons || []).includes(selected)
          && !(l.portals || []).includes(selected)
          && !(l.spawnZones || []).includes(selected)
          && selected !== l.background) {
          ctx.state.selected = null;
        }
      } else if (tool === 'wall') {
        l.walls.push({ id: `wall-${Date.now()}`, x, y, w: CELL * 4, h: CELL * 3, shape: 'rect', thickness: CELL, visible: true, color: DEFAULT_WALL_COLOR });
      } else if (tool === 'enemy') {
        l.enemies.push(normalizeEnemy({ x, y, id: `enemy-${Date.now()}` }, l.enemies.length));
      } else if (tool === 'spawn') {
        l.spawn = { ...l.spawn, x, y };
        ctx.state.selected = l.spawn;
      } else if (tool === 'trigger') {
        l.triggers.push({ id: `trigger-${Date.now()}`, x, y, w: CELL * 3, h: CELL * 2, shape: 'rect', color: '#f3b63f', visible: true, once: true, resumeOnReturn: true, events: [{ type: 'complete' }] });
      } else if (tool === 'gate') {
        const gate = { id: `gate-${Date.now()}`, x, y, w: CELL * 8, h: 45, label: 'Barrier Active', active: false, visible: true };
        l.gates.push(gate);
        ctx.state.selected = gate;
      } else if (tool === 'vendor') {
        const vendor = { id: `vendor-${Date.now()}`, x, y, w: 130, h: 96, interactRadius: 120, visible: true };
        (l.vendors || (l.vendors = [])).push(vendor);
        ctx.state.selected = vendor;
      } else if (tool === 'idol') {
        const idol = { id: `idol-${Date.now()}`, x, y, w: 110, h: 110, interactRadius: 130, visible: true };
        (l.idols || (l.idols = [])).push(idol);
        ctx.state.selected = idol;
      } else if (tool === 'icon') {
        const icon = { id: `icon-${Date.now()}`, x, y, w: 64, h: 64, src: '', interactRadius: 120, tipText: '按 F 交互', event: 'workshop', visible: true };
        (l.icons || (l.icons = [])).push(icon);
        ctx.state.selected = icon;
      } else if (tool === 'portal') {
        const portal = normalizePortal({ x, y }, (l.portals || []).length);
        (l.portals || (l.portals = [])).push(portal);
        ctx.state.selected = portal;
      } else if (tool === 'spawnzone') {
        const zone = { id: `spawnzone-${Date.now()}`, x, y, w: CELL * 10, h: CELL * 6, color: '#7ee787', visible: true };
        (l.spawnZones || (l.spawnZones = [])).push(zone);
        ctx.state.selected = zone;
      } else if (tool === 'crate') {
        l.crates.push(normalizeCrate({ x, y, id: `crate-${Date.now()}` }, l.crates.length));
      } else if (tool === 'barrel') {
        l.barrels.push(normalizeBarrel({ x, y, id: `barrel-${Date.now()}` }, l.barrels.length));
      } else if (tool === 'chest') {
        const chest = normalizeChest({ x, y, id: `chest-${Date.now()}` }, l.chests.length);
        l.chests.push(chest);
        ctx.state.selected = chest;
      } else {
        const hit = pickTopEntity(l, wp.x, wp.y);
        const entity = hit ? hit.entity : null;
        if (entity && entity === l.background) {
          this.drag = { mode: 'bg-move', entity };
        } else {
          this.drag = entity && entity !== l.spawn ? { mode: 'move', entity } : entity === l.spawn ? { mode: 'spawn' } : null;
        }
        ctx.state.selected = entity;
      }

      ctx.redraw();
    },

    pointerMove(p) {
    const ctx = this.ctx;
      if (!this.editing) {
        if (this.menuScreen === 'workshop') {
          this.updateWorkshopLongPress();
          this.updateWorkshopScrollDrag();
          this.updateWorkshopInvScrollDrag();
        }
        if (this.menuScreen === 'levelSelect' && this.levelSelectPage === 2 && this.levelSelectDrag) {
          const up = this.uiPointer();
          this.smallLevelPan = { x: this.levelSelectDrag.ox + (up.x - this.levelSelectDrag.sx), y: this.levelSelectDrag.oy + (up.y - this.levelSelectDrag.sy) };
        }
        return;
      }

      if (this.panning) {
        const cam = this.cameras.main;
        cam.scrollX = this.panStart.sx - (p.x - this.panStart.x) / cam.zoomX;
        cam.scrollY = this.panStart.sy - (p.y - this.panStart.y) / cam.zoomY;
        this.clampEditorView();
        this.draw();
        return;
      }

      if (!this.drag) return;
      if (this.drag.mode !== 'spawn' && !this.drag.entity) return;

      const wp = this.cameras.main.getWorldPoint(p.x, p.y);

      if (this.drag.mode === 'spawn') {
        ctx.state.level.spawn = { ...ctx.state.level.spawn, x: snap(wp.x), y: snap(wp.y) };
        ctx.state.selected = ctx.state.level.spawn;
      } else if (this.drag.mode === 'move') {
        this.drag.entity.x = snap(wp.x);
        this.drag.entity.y = snap(wp.y);
      } else if (this.drag.mode === 'rotate') {
        const angle = Phaser.Math.Angle.Between(this.drag.entity.x, this.drag.entity.y, wp.x, wp.y) + Math.PI / 2;
        this.drag.entity.rotation = Math.round(Phaser.Math.RadToDeg(angle) / 5) * 5;
      } else if (this.drag.mode === 'bg-move') {
        this.drag.entity.x = wp.x;
        this.drag.entity.y = wp.y;
      } else if (this.drag.mode === 'bg-resize') {
        resizeBackground(this.drag.entity, this.drag, wp.x, wp.y);
      } else {
        resizeRect(this.drag.entity, this.drag, wp.x, wp.y);
      }

      ctx.redraw();
    },

    updateEditorKeys() {
    const ctx = this.ctx;
      const sel = ctx.state.selected;
      if (!sel || typeof sel.x !== 'number' || typeof sel.y !== 'number') return;

      // 玩家正在侧边栏输入框打字时，不响应方向键，避免误移动实体
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;

      let dx = 0, dy = 0;
      if (Phaser.Input.Keyboard.JustDown(this.keys.LEFT)) dx = -CELL;
      else if (Phaser.Input.Keyboard.JustDown(this.keys.RIGHT)) dx = CELL;
      else if (Phaser.Input.Keyboard.JustDown(this.keys.UP)) dy = -CELL;
      else if (Phaser.Input.Keyboard.JustDown(this.keys.DOWN)) dy = CELL;
      else return;

      ctx.pushUndo?.();
      sel.x = snap(sel.x + dx);
      sel.y = snap(sel.y + dy);
      ctx.redraw?.();
    },
};
