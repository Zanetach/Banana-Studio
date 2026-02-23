[简体中文](#zh-cn) | [English](#en-us)

<span id="zh-cn"></span>

# Banana Studio (Obsidian Plugin)

Banana Studio 是一个面向 Obsidian 的 AI 生图插件，核心流程是：

**输入 Prompt -> 生成候选图 -> 选择单张插入到当前笔记正文**。

## 功能展示

### 1. 文生图（Text-to-Image）

输入描述词后，直接生成候选图并进行挑选插入。

![文生图示例](./public/01.jpg)

### 2. 图生图（Image-to-Image）

开启图生图后，使用参考图 + Prompt 进行生成，支持候选图管理与单张插入。

![图生图示例](./public/02.jpg)

### 3. 从当前笔记选择参考图

可直接扫描当前笔记中的图片并选择作为参考图，无需手动重新上传。

![从当前笔记选图](./public/03.jpg)

### 4. 候选图网格与批量插入

支持多张并发生成、候选图网格预览，以及一键插入全部。

![候选图网格与批量插入](./public/04.jpg)


## 核心能力

- 侧边栏生成候选图，支持并发生成（并发数跟随张数设置）
- 候选图单卡操作：插入、重生、丢弃、复制嵌入
- 插入到当前笔记正文（优先当前编辑位置）
- 图生图参考图管理：本地上传 + 从当前笔记选图
- 参考图名称自动同步到 Prompt 第一行，并在生成前兜底校正
- 预设管理、分辨率、比例、张数、模型切换

## Provider 支持

- OpenRouter
- OpenAI
- Gemini
- ZenMux

## 安装（手动）

1. 在 [Releases](https://github.com/Zanetach/Banana-Studio/releases) 下载最新版本。
2. 解压到 vault：`.obsidian/plugins/banana-studio/`。
3. 重启 Obsidian，在 `设置 -> 第三方插件` 启用 `Banana Studio`。

## 开发

```bash
npm install
npm run build
```

本地开发同步到 Obsidian Vault：

```bash
npm run deploy:dev -- /path/to/your/vault
```

## 免责声明

- 插件依赖第三方模型 API，调用可能产生费用。
- API Key 保存在本地 Obsidian 配置中。
- 生成内容合规性由使用者自行负责。

## License

GPL-3.0，见 [LICENSE](LICENSE)。

---

<span id="en-us"></span>

# Banana Studio (Obsidian Plugin)

Banana Studio is an AI image generation plugin for Obsidian.
Core workflow:

**Write prompt -> generate candidates -> insert selected image into current note content**.

## Feature Showcase

### 1. Text-to-Image

Generate image candidates directly from prompt text.

![Text-to-Image](./public/01.jpg)

### 2. Image-to-Image

Use reference image + prompt to generate and manage candidates.

![Image-to-Image](./public/02.jpg)

### 3. Select Reference from Current Note

Pick existing images from the active note as references.

![Select from current note](./public/03.jpg)

### 4. Candidate Grid and Bulk Insert

Supports concurrent multi-image generation, grid preview, and one-click insert all.

![Candidate grid and bulk insert](./public/04.jpg)

## Key Capabilities

- Sidebar candidate generation with configurable parallelism
- Per-candidate actions: Insert, Regenerate, Discard, Copy Embed
- Insert into current note body (cursor-first)
- Reference image flow: local upload + from current note
- Prompt reference-line auto-sync with pre-generate fallback enforcement
- Presets, resolution, aspect ratio, count, model switching

## Supported Providers

- OpenRouter
- OpenAI
- Gemini
- ZenMux

## Installation (Manual)

1. Download latest package from [Releases](https://github.com/Zanetach/Banana-Studio/releases).
2. Extract to `.obsidian/plugins/banana-studio/` in your vault.
3. Restart Obsidian and enable `Banana Studio` in Community Plugins.

## Development

```bash
npm install
npm run build
```

Local sync to a vault:

```bash
npm run deploy:dev -- /path/to/your/vault
```

## Disclaimer

- Third-party API usage may incur cost.
- API keys are stored locally in Obsidian config.
- Users are responsible for generated content compliance.

## License

GPL-3.0, see [LICENSE](LICENSE).
