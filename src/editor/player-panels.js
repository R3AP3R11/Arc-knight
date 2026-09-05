/**
 * 预览 / 试玩玩家数据面板。
 * 职责：渲染「游戏预览」临时玩家与「试玩存档」玩家的属性表单，绑定其数值/武器/模组交互，
 *       以及存档保存、重载、栏位切换；含模组库存数量写入 setOwnedMod。
 * 分类：数值经济
 * 导出：renderPreviewPlayer, renderTrialPlayer, bindPlayerPanels
 */
import { MOD_DEFS, ITEM_DEFS } from '../state.js';
import { loadPlayer, savePlayer } from '../api.js';
import { setStatus, renderPreviewWeapons, renderPreviewMods, renderPreviewPets } from '../ui.js';
import { normalizePlayer } from '../player-data.js';
import { ctx } from './context.js';

const { state } = ctx;

// 写「库存数量」：通用改件进 items.stacks（无上限），专属改件进 items.uniques（每种最多 1）
function setOwnedMod(player, id, def, value, checked) {
  if (!player || !def) return;
  player.items = player.items || { stacks: {}, uniques: [] };
  const stacks = player.items.stacks || (player.items.stacks = {});
  const uniques = player.items.uniques || (player.items.uniques = []);
  if (def.stackable) {
    const n = Math.max(0, Math.floor(Number(value) || 0));
    if (n > 0) stacks[id] = n;
    else delete stacks[id];
  } else {
    const exists = uniques.some(u => u.itemId === id);
    if (checked && !exists) uniques.push({ uid: `u-${id}-${Date.now()}`, itemId: id });
    if (!checked && exists) player.items.uniques = uniques.filter(u => u.itemId !== id);
  }
}

// 宠物「拥有 / 装备」绑定：拥有进 items.uniques，装备进 equipment.pets（上限 2）
function bindPetPanel(container, getPlayer, prefix) {
  if (!container) return;
  container.addEventListener('change', e => {
    const input = e.target;
    if (input.type !== 'checkbox') return;
    const player = getPlayer();
    if (!player) return;
    const ownKey = `data-${prefix}-pet-own`;
    const eqKey = `data-${prefix}-pet-eq`;
    if (input.hasAttribute(ownKey)) {
      const id = input.getAttribute(ownKey);
      player.items = player.items || { stacks: {}, uniques: [] };
      const uniques = player.items.uniques || (player.items.uniques = []);
      if (input.checked) { if (!uniques.some(u => u.itemId === id)) uniques.push({ uid: `u-${id}`, itemId: id }); }
      else player.items.uniques = uniques.filter(u => u.itemId !== id);
    } else if (input.hasAttribute(eqKey)) {
      const id = input.getAttribute(eqKey);
      player.equipment = player.equipment || { weaponMods: {}, relics: [], pets: [] };
      const pets = player.equipment.pets || (player.equipment.pets = []);
      if (input.checked) {
        if (pets.includes(id)) return;
        if (pets.length >= 2) { alert('宠物装备槽已满（最多 2）'); input.checked = false; return; }
        pets.push(id);
      } else {
        player.equipment.pets = pets.filter(p => p !== id);
      }
    }
  });
}

// ── 渲染 ──
export function renderPreviewPlayer() {
  const dom = ctx.dom;
  const p = state.previewPlayer;
  const c = p.combat;
  dom.pvLevel.value = p.progress.level;
  dom.pvExp.value = p.progress.exp;
  dom.pvPoints.value = p.progress.points ?? 0;
  dom.pvGold.value = p.currency.gold;
  dom.pvMoveSpeed.value = c.moveSpeed;
  dom.pvAttackPower.value = c.attackPower;
  dom.pvCritRate.value = c.critRate;
  dom.pvAttackSpeed.value = c.attackSpeed;
  dom.pvMaxHp.value = c.maxHp;
  dom.pvMaxShield.value = c.maxShield;
  dom.pvDamageReduction.value = c.damageReduction;
  dom.pvDodgeRate.value = c.dodgeRate;
  renderPreviewWeapons(dom, p.weapons);
  renderPreviewMods(dom, p.items, MOD_DEFS);
  renderPreviewPets(dom, p, 'pvPets', 'pv');
}

export function renderTrialPlayer() {
  const dom = ctx.dom;
  const p = state.player;
  const c = p.combat;
  dom.tpSlot.value = state.playerId;
  dom.tpLevel.value = p.progress.level;
  dom.tpExp.value = p.progress.exp;
  dom.tpPoints.value = p.progress.points ?? 0;
  dom.tpGold.value = p.currency.gold;
  dom.tpMoveSpeed.value = c.moveSpeed;
  dom.tpAttackPower.value = c.attackPower;
  dom.tpCritRate.value = c.critRate;
  dom.tpAttackSpeed.value = c.attackSpeed;
  dom.tpMaxHp.value = c.maxHp;
  dom.tpMaxShield.value = c.maxShield;
  dom.tpDamageReduction.value = c.damageReduction;
  dom.tpDodgeRate.value = c.dodgeRate;
  renderPreviewWeapons(dom, p.weapons, 'tpWeapons');
  renderPreviewMods(dom, p.items, MOD_DEFS, 'tpMods');
  renderPreviewPets(dom, p, 'tpPets', 'tp');
}

// ── 表单绑定 ──
export function bindPlayerPanels() {
  const dom = ctx.dom;

  // 武器美术方案已集成到武器系统（weapon-board），这里不再提供画板美术方案下拉。
  renderPreviewPlayer();
  renderTrialPlayer();

  // 预览玩家数据表单
  dom.pvLevel.oninput = e => { const n = Number(e.target.value); if (n >= 1) state.previewPlayer.progress.level = Math.floor(n); };
  dom.pvExp.oninput = e => { const n = Number(e.target.value); if (n >= 0) state.previewPlayer.progress.exp = Math.floor(n); };
  dom.pvPoints.oninput = e => { const n = Number(e.target.value); if (n >= 0) state.previewPlayer.progress.points = Math.floor(n); };
  dom.pvGold.oninput = e => { const n = Number(e.target.value); if (n >= 0) state.previewPlayer.currency.gold = Math.floor(n); };
  dom.pvMoveSpeed.oninput = e => { const n = Number(e.target.value); if (n >= 0.1) state.previewPlayer.combat.moveSpeed = n; };
  dom.pvAttackPower.oninput = e => { const n = Number(e.target.value); if (n >= 0) state.previewPlayer.combat.attackPower = n; };
  dom.pvCritRate.oninput = e => { const n = Number(e.target.value); if (n >= 0 && n <= 1) state.previewPlayer.combat.critRate = n; };
  dom.pvAttackSpeed.oninput = e => { const n = Number(e.target.value); if (n >= 0.1) state.previewPlayer.combat.attackSpeed = n; };
  dom.pvMaxHp.oninput = e => { const n = Number(e.target.value); if (n >= 1) state.previewPlayer.combat.maxHp = Math.floor(n); };
  dom.pvMaxShield.oninput = e => { const n = Number(e.target.value); if (n >= 0) state.previewPlayer.combat.maxShield = Math.floor(n); };
  dom.pvDamageReduction.oninput = e => { const n = Number(e.target.value); if (n >= 0 && n <= 1) state.previewPlayer.combat.damageReduction = n; };
  dom.pvDodgeRate.oninput = e => { const n = Number(e.target.value); if (n >= 0 && n <= 1) state.previewPlayer.combat.dodgeRate = n; };
  dom.pvWeapons.addEventListener('change', e => {
    const input = e.target;
    if (input.type !== 'checkbox') return;
    const w = input.dataset.w, wd = state.previewPlayer.weapons[w] || (state.previewPlayer.weapons[w] = { unlocked: false, enhance: [0, 0, 0] });
    if (input.dataset.u !== undefined) wd.unlocked = input.checked;
    else if (input.dataset.e !== undefined) wd.enhance[Number(input.dataset.e)] = input.checked ? 1 : 0;
  });

  dom.pvMods.addEventListener('input', e => {
    const input = e.target;
    const id = input.dataset.own;
    if (!id || !MOD_DEFS[id]) return;
    setOwnedMod(state.previewPlayer, id, ITEM_DEFS[id], input.value, input.checked);
  });

  // 试玩存档面板：直接编辑正式玩家存档 state.player
  dom.tpLevel.oninput = e => { const n = Number(e.target.value); if (n >= 1) state.player.progress.level = Math.floor(n); };
  dom.tpExp.oninput = e => { const n = Number(e.target.value); if (n >= 0) state.player.progress.exp = Math.floor(n); };
  dom.tpPoints.oninput = e => { const n = Number(e.target.value); if (n >= 0) state.player.progress.points = Math.floor(n); };
  dom.tpGold.oninput = e => { const n = Number(e.target.value); if (n >= 0) state.player.currency.gold = Math.floor(n); };
  dom.tpMoveSpeed.oninput = e => { const n = Number(e.target.value); if (n >= 0.1) state.player.combat.moveSpeed = n; };
  dom.tpAttackPower.oninput = e => { const n = Number(e.target.value); if (n >= 0) state.player.combat.attackPower = n; };
  dom.tpCritRate.oninput = e => { const n = Number(e.target.value); if (n >= 0 && n <= 1) state.player.combat.critRate = n; };
  dom.tpAttackSpeed.oninput = e => { const n = Number(e.target.value); if (n >= 0.1) state.player.combat.attackSpeed = n; };
  dom.tpMaxHp.oninput = e => { const n = Number(e.target.value); if (n >= 1) state.player.combat.maxHp = Math.floor(n); };
  dom.tpMaxShield.oninput = e => { const n = Number(e.target.value); if (n >= 0) state.player.combat.maxShield = Math.floor(n); };
  dom.tpDamageReduction.oninput = e => { const n = Number(e.target.value); if (n >= 0 && n <= 1) state.player.combat.damageReduction = n; };
  dom.tpDodgeRate.oninput = e => { const n = Number(e.target.value); if (n >= 0 && n <= 1) state.player.combat.dodgeRate = n; };
  dom.tpWeapons.addEventListener('change', e => {
    const input = e.target;
    if (input.type !== 'checkbox') return;
    const w = input.dataset.w, wd = state.player.weapons[w] || (state.player.weapons[w] = { unlocked: false, enhance: [0, 0, 0] });
    if (input.dataset.u !== undefined) wd.unlocked = input.checked;
    else if (input.dataset.e !== undefined) wd.enhance[Number(input.dataset.e)] = input.checked ? 1 : 0;
  });
  dom.tpMods.addEventListener('input', e => {
    const input = e.target;
    const id = input.dataset.own;
    if (!id || !MOD_DEFS[id]) return;
    setOwnedMod(state.player, id, ITEM_DEFS[id], input.value, input.checked);
  });
  dom.tpSave.onclick = () => {
    state.player.meta.updatedAt = Date.now();
    renderTrialPlayer();
    savePlayer(state.playerId, state.player)
      .then(() => { state.hasAnySave = true; setStatus(dom, '存档已保存'); })
      .catch(e => setStatus(dom, `存档保存失败：${e.message}`, true));
  };
  dom.tpReload.onclick = async () => {
    try {
      state.player = normalizePlayer(await loadPlayer(state.playerId));
      renderTrialPlayer();
      setStatus(dom, '存档已重新加载');
    } catch (e) {
      setStatus(dom, `存档加载失败：${e.message}`, true);
    }
  };
  // 切换存档栏位：加载所选存档并自动套用数据
  dom.tpSlot.onchange = async e => {
    const id = e.target.value;
    try {
      state.playerId = id;
      try {
        state.player = normalizePlayer(await loadPlayer(id));
        state.hasAnySave = true;
      } catch {
        state.player = normalizePlayer();
        state.hasAnySave = false;
      }
      renderTrialPlayer();
      setStatus(dom, `已切换到 ${id}`);
    } catch (error) {
      setStatus(dom, `切换存档失败：${error.message}`, true);
    }
  };

  // 宠物「拥有 / 装备」配置
  bindPetPanel(dom.pvPets, () => state.previewPlayer, 'pv');
  bindPetPanel(dom.tpPets, () => state.player, 'tp');
}
