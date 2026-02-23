[简体中文](#zh-cn) | [English](#en-us)

<span id="zh-cn"></span>

# Banana Studio (Obsidian Plugin)

Banana Studio 是一个面向 Obsidian 笔记的 AI 生图插件，当前版本专注于一个流程：

**在侧边栏生成图片 -> 选择图片 -> 插入到当前笔记**。

## 功能概览

- 侧边栏生图（一次并发生成 4 张候选图）
- 候选图列表（可预览、插入、丢弃）
- 插入到当前笔记（优先光标位置，失败回退文末）
- 过期候选图自动清理（TTL）
- 支持多 Provider（Gemini / OpenRouter / Yunwu / GPTGod / AntigravityTools）
- 支持图片模型快速切换、分辨率、比例、图片提示词预设

## 安装（手动）

1. 在 [Releases](https://github.com/Zanetach/Banana-Studio/releases) 下载最新版本。
2. 解压到你的 vault：`.obsidian/plugins/Banana-Studio/`。
3. 重启 Obsidian，在 `设置 -> 第三方插件` 中启用 `Banana Studio`。

## 使用流程

1. 打开一篇 Markdown 笔记。
2. 点击左侧 Ribbon 的香蕉图标，打开侧边栏。
3. 在侧边栏输入提示词（可选中正文作为上下文）。
4. 设置图片模型、分辨率、比例后点击 `Generate`。
5. 在候选图卡片点击：
   - `Insert`：插入到当前笔记
   - `Discard`：丢弃并删除候选文件

## 验证建议

- 功能验证
  - 能打开侧边栏并发起生图
  - 能看到候选图列表
  - `Insert` 后图片成功写入笔记
  - `Discard` 后文件被移除
- 构建验证（开发者）

```bash
npm install
npm run build
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

Banana Studio is an AI image plugin for Obsidian notes, focused on one workflow:

**Generate images in the sidebar -> choose a candidate -> insert into the current note**.

Chat / Edit / Canvas features are no longer part of this version.

## Features

- Sidebar image generation (4 candidates per run)
- Candidate list (preview, insert, discard)
- Insert into current note (cursor-first, EOF fallback)
- Auto cleanup for expired candidates (TTL)
- Multi-provider support (Gemini / OpenRouter / Yunwu / GPTGod / AntigravityTools)
- Image model quick switch, resolution, aspect ratio, prompt presets

## Installation (Manual)

1. Download the latest release from [Releases](https://github.com/LiuYangArt/obsidian-canvas-banana/releases).
2. Extract into your vault at `.obsidian/plugins/canvas-banana/`.
3. Restart Obsidian and enable `Banana Studio` in `Settings -> Community Plugins`.

## Workflow

1. Open a Markdown note.
2. Click the banana ribbon icon to open the sidebar.
3. Enter a prompt (optionally select note text as context).
4. Set model/resolution/aspect ratio and click `Generate`.
5. For each candidate image:
   - `Insert`: insert into the current note
   - `Discard`: drop candidate and delete file

## Validation

- Functional checks
  - Sidebar opens and can generate images
  - Candidate list is visible
  - `Insert` adds image embed to note
  - `Discard` removes candidate file
- Build check (for developers)

```bash
npm install
npm run build
```

## Disclaimer

- This plugin depends on third-party model APIs and usage may incur cost.
- API keys are stored locally in Obsidian config.
- Users are responsible for content compliance.

## License

GPL-3.0, see [LICENSE](LICENSE).
