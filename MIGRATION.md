# Banana Studio Migration Guide

## 中文

### 这是一次“全新插件迁移”

- 旧插件 ID：`canvas-banana`
- 新插件 ID：`banana-studio`

由于 Obsidian 以插件 ID 识别插件，这次迁移会被视为**新插件安装**，不会自动继承旧插件目录与设置文件。

### 用户迁移步骤

1. 安装新插件到：`.obsidian/plugins/banana-studio/`
2. 在 Obsidian 里启用 `Banana Studio`
3. 在新插件设置页重新填写 API Key、模型与预设
4. 确认功能正常后，可禁用/卸载旧插件 `canvas-banana`

### 向后兼容说明

- 不提供自动迁移脚本（避免误覆盖用户本地配置）
- 旧插件可与新插件短期并存（不建议长期同时启用）

### 发布策略（建议）

1. 在新仓库发布 `v0.2.0+`（ID=`banana-studio`）
2. 在旧仓库最后发一个“迁移公告版”Release：
   - 标题示例：`Final notice: moved to Banana Studio`
   - 内容包含新仓库地址与迁移步骤
3. 后续所有功能迭代只在新仓库发布

---

## English

### This is a full plugin migration

- Old plugin ID: `canvas-banana`
- New plugin ID: `banana-studio`

Obsidian treats plugin ID as identity, so this migration is a **new plugin install**. Old settings/folder are not auto-reused.

### User migration steps

1. Install new plugin to `.obsidian/plugins/banana-studio/`
2. Enable `Banana Studio`
3. Re-enter API key, models, and presets in settings
4. Disable/uninstall old plugin `canvas-banana` after verification

### Compatibility policy

- No automatic migration script (to avoid overwriting local settings)
- Old/new plugins may coexist temporarily (not recommended long-term)

### Release strategy (recommended)

1. Publish `v0.2.0+` in the new repo (`id=banana-studio`)
2. Publish one final notice release in old repo with migration instructions
3. Continue all future releases only in the new repo
