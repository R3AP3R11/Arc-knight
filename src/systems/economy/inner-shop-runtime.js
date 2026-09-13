/**
 * 文件职责：局内售货机运行时（打开页面、刷新/购买商品、老虎机摇奖与结算）
 * 归属分类：数值_经济
 * 主要导出：InnerShopMixin（10 个方法）
 * 依赖：systems/economy/inner-shop.js、systems/ui/vendor-shop-art.js
 */
import { getInnerShopData, loadInnerShop, rollShopStock, rollLottery, LOTTERY_ROLL_MS } from './inner-shop.js';
import { preloadArtRefs } from '../ui/vendor-shop-art.js';

// 数据是否就绪：消耗品池 + 武器池至少有一个条目
const isReady = d => !!(d && ((d.consumables?.length || 0) + (d.weapons?.length || 0)) > 0);

export const InnerShopMixin = {
    // ── 打开售货机页面：记录当前实体并触发一次商品刷新 ──
    openVendorShop(vendor) {
      if (this.editing || this.menuScreen) return;
      if (!vendor) return;
      this.vendorActive = vendor;
      this.vendorView = null;   // 置空 → 页面重播入场翻牌动画（见 screens.js:drawVendorShop）
      this.ensureVendorStock(vendor);
      this.openMenuScreen('vendor');
    },

    // ── 确保实体带有商品列表：已刷过则跳过；未就绪时异步加载后补刷 ──
    ensureVendorStock(vendor) {
      if (!vendor || (Array.isArray(vendor.stock) && vendor.stock.length)) return;
      const data = getInnerShopData();
      if (isReady(data)) {
        this.setupVendorStock(vendor, data);
      } else {
        // 数据未就绪时保持 vendor.stock 为 undefined，页面持续显示「加载中…」
        loadInnerShop().then(() => {
          if (!(Array.isArray(vendor.stock) && vendor.stock.length)) this.setupVendorStock(vendor, getInnerShopData());
        });
      }
    },

    // ── 抽取并写入商品列表（长度 = min(4, 池大小)），并预取美术 ──
    setupVendorStock(vendor, data) {
      if (!data || !((data.consumables?.length || 0) + (data.weapons?.length || 0))) return;
      vendor.stock = rollShopStock(data);
      vendor.bought = new Set();
      this.preloadVendorArt(vendor.stock, data);
    },

    // ── 预取商品与老虎机图标的画板资产（fire-and-forget，preloadArtRefs 自带 catch） ──
    preloadVendorArt(stock, data) {
      const seen = new Set();
      const refs = [];
      const push = r => {
        const artType = r?.artType;
        const artName = r?.artName;
        if (!artType || !artName) return;
        const key = `${artType}|${artName}`;
        if (seen.has(key)) return;
        seen.add(key);
        refs.push({ artType, artName });
      };
      for (const it of (stock || [])) push(it);
      for (const k of (data?.lottery?.kinds || [])) push(k);
      preloadArtRefs(refs);
    },

    // ── 页面取数：当前售货机商品列表（未就绪返回 null） ──
    getVendorStock() {
      const v = this.vendorActive;
      return v && Array.isArray(v.stock) && v.stock.length ? v.stock : null;
    },

    // ── 是否已购买第 index 个商品 ──
    isVendorBought(index) {
      const v = this.vendorActive;
      return !!(v && v.bought && v.bought.has(index));
    },

    // ── 购买第 index 个商品：扣金币 → 标记已购 → 发放到当局库存 ──
    buyVendorItem(index) {
      const v = this.vendorActive;
      const item = v?.stock?.[index];
      if (!item || !this.player) return false;
      if (v.bought?.has(index)) return false;
      const cost = Math.max(0, Math.floor(Number(item.cost) || 0));
      if ((this.player.gold ?? 0) < cost) return false;
      this.player.gold -= cost;
      v.bought = v.bought || new Set();
      v.bought.add(index);
      if (item.kind === 'weapon') this.addRunTimedWeapon(item);
      else this.addRunItem(item.id, 1);
      this.syncUIState();
      return true;
    },

    // ── 摇奖：扣金币并开启滚动动画（自愈上次未结算的 rolling） ──
    rollVendorSlot() {
      const v = this.vendorActive;
      if (!v) return false;
      if (v.slot?.rolling && this.time.now >= v.slot.settleAt) this.settleVendorRoll();
      if (v.slot?.rolling) return false;

      const data = getInnerShopData();
      const ready = !!(data && ((data.consumables?.length || 0) + (data.weapons?.length || 0) + (data.lottery?.kinds?.length || 0)) > 0);
      if (!ready) return false;

      const cost = Math.max(0, Math.floor(Number(data.lottery?.drawCost) || 0));
      if ((this.player?.gold ?? 0) < cost) return false;
      if (cost > 0) this.player.gold -= cost;

      const { icons, prize } = rollLottery(data);
      const now = this.time.now;
      v.slot = { icons, prize, rolling: true, rollAt: now, settleAt: now + LOTTERY_ROLL_MS, prizeAt: 0, granted: false };
      this.syncUIState();
      return true;
    },

    // ── 每帧推进：到点结算（幂等，页面也会自行调用 settleVendorRoll） ──
    updateVendorSlot() {
      const slot = this.vendorActive?.slot;
      if (!slot?.rolling) return;
      if (this.time.now >= slot.settleAt) this.settleVendorRoll();
    },

    // ── 结算：定格滚动并发奖 ──
    settleVendorRoll() {
      const v = this.vendorActive;
      const slot = v?.slot;
      if (!slot?.rolling) return;
      slot.rolling = false;
      slot.prizeAt = this.time.now;
      slot.granted = true;

      const prize = slot.prize;
      if (prize && prize.kind === 'weapon') {
        this.addRunTimedWeapon(prize.item || {});
      } else if (prize && prize.kind === 'consumable') {
        this.addRunItem((prize.item || {}).id, 1);
      } else if (prize && prize.kind === 'gold') {
        this.player.gold = (this.player.gold || 0) + Math.max(0, Math.floor(Number(prize.amount) || 0));
      }
      // trash / none / prize == null：不发奖
      this.syncUIState();
    },
};
