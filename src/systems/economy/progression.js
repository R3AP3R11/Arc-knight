/**
 * 文件职责：成长经济（工坊加点 / 存档来源与落盘）
 * 归属分类：数值_经济
 * 主要导出：ProgressionMixin（3 个方法）、UPGRADE_STATS
 */

// 工坊页基础属性加点配置：key → 属性键 / 每点收益 / 上限 / 显示
export const UPGRADE_STATS = {
  maxHp:       { label: '生命', per: 20, cap: 10, fmt: v => `${Math.round(v)}` },
  maxShield:   { label: '护盾', per: 10, cap: 10, fmt: v => `${Math.round(v)}` },
  attackPower: { label: '攻击', per: 0.1, cap: 10, fmt: v => `${Math.round((v - 1) * 100)}%` },
  attackSpeed: { label: '攻速', per: 0.08, cap: 10, fmt: v => `${Math.round((v - 1) * 100)}%` }
};

export const ProgressionMixin = {
    applyUpgrade(key) {
      const cfg = UPGRADE_STATS[key];
      if (!cfg || !this.menuScreen) return;
      const source = this.saveSource();
      const spendable = this.player.spendablePoints ?? 0;
      const spent = (this.player.points?.[key] ?? 0);
      if (spendable <= 0 || spent >= cfg.cap) return;

      // 写入玩家运行时 + 存档源
      this.player.points = { ...this.player.points, [key]: spent + 1 };
      this.player.spendablePoints = spendable - 1;
      this.player.combat = { ...this.player.combat, [key]: (this.player.combat[key] ?? 0) + cfg.per };
      if (key === 'maxHp') this.player.maxHp = this.player.combat.maxHp;
      if (key === 'maxShield') this.player.maxShield = this.player.combat.maxShield;

      if (source) {
        source.combat = { ...this.player.combat };
        source.points = { ...this.player.points };
        source.progress = { ...(source.progress || {}), points: this.player.spendablePoints };
        this.persistSave(source);
      }
      this.syncUIState();
      this.drawUI();
    },

    saveSource() {
    const ctx = this.ctx;
      if (this.isPreviewMode()) return ctx.state.previewPlayer;
      return ctx.state.player;
    },

    persistSave(source) {
    const ctx = this.ctx;
      if (this.editing || this.isPreviewMode() || !source) return;
      ctx.onPlayerSave?.(source);
    },
};
