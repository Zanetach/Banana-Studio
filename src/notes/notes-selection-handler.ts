/**
 * Notes Selection Handler (Image-only)
 * 仅为 Sidebar 生图提供选区上下文、生成、插入与清理能力
 */

import { App, Editor, MarkdownView, Notice, TFile } from "obsidian";
import type CanvasAIPlugin from "../../main";
import { SelectionContext } from "../types";
import { extractDocumentImages, saveImageToVault } from "../utils/image-utils";
import { isZhLocale, t } from "../../lang/helpers";
import {
  SideBarCoPilotView,
  VIEW_TYPE_SIDEBAR_COPILOT,
} from "./sidebar-copilot-view";
import { ApiManager } from "../api/api-manager";
import { ApiProvider } from "../settings/settings";
import {
  GeneratedImageCandidate,
  NoteImageTaskManager,
} from "./note-image-task-manager";

export interface NotesSelectionContext extends SelectionContext {
  editor: Editor;
  file: TFile;
}

export class NotesSelectionHandler {
  private plugin: CanvasAIPlugin;
  private app: App;
  private lastContext: NotesSelectionContext | null = null;
  private imageTaskManager: NoteImageTaskManager;

  constructor(plugin: CanvasAIPlugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.imageTaskManager = new NoteImageTaskManager(
      this.app,
      this.plugin.settings,
    );
  }

  private tr(zh: string, en: string): string {
    return isZhLocale() ? zh : en;
  }

  private getSidebarView(): SideBarCoPilotView | null {
    const leaves = this.app.workspace.getLeavesOfType(
      VIEW_TYPE_SIDEBAR_COPILOT,
    );
    if (leaves.length > 0) {
      return leaves[0].view as SideBarCoPilotView;
    }
    return null;
  }

  private findMarkdownViewByPath(path: string): MarkdownView | null {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    const leaf = leaves.find(
      (l) => (l.view as MarkdownView).file?.path === path,
    );
    return leaf ? (leaf.view as MarkdownView) : null;
  }

  private createImageApiManager(): ApiManager {
    const selectedModel = this.plugin.settings.paletteImageModel || "";
    if (!selectedModel) {
      return new ApiManager(this.plugin.settings);
    }

    const [provider, modelId] = selectedModel.split("|");
    if (!provider || !modelId) {
      return new ApiManager(this.plugin.settings);
    }

    const localSettings = {
      ...this.plugin.settings,
      apiProvider: provider as ApiProvider,
    };
    if (provider === "openrouter") {
      localSettings.openRouterImageModel = modelId;
    } else if (provider === "openai") {
      localSettings.openAIImageModel = modelId;
    } else if (provider === "zenmux") {
      localSettings.zenmuxImageModel = modelId;
    } else if (provider === "gemini") {
      localSettings.geminiImageModel = modelId;
    }
    return new ApiManager(localSettings);
  }

  private buildSelectionContext(
    view: MarkdownView,
  ): NotesSelectionContext | null {
    const editor = view.editor;
    const selection = editor.getSelection();
    if (!selection || selection.trim().length === 0) return null;

    const fullText = editor.getValue();
    const fromCursor = editor.getCursor("from");
    const toCursor = editor.getCursor("to");

    const doc = editor.getDoc();
    let fromOffset = 0;
    for (let i = 0; i < fromCursor.line; i++) {
      fromOffset += doc.getLine(i).length + 1;
    }
    fromOffset += fromCursor.ch;

    let toOffset = 0;
    for (let i = 0; i < toCursor.line; i++) {
      toOffset += doc.getLine(i).length + 1;
    }
    toOffset += toCursor.ch;

    return {
      nodeId: view.file!.path,
      selectedText: selection,
      preText: fullText.substring(0, fromOffset),
      postText: fullText.substring(toOffset),
      fullText,
      isExplicit: true,
      editor,
      file: view.file!,
    };
  }

  /**
   * 供侧栏调用：捕获当前选区上下文
   */
  public captureSelectionForSidebar(): NotesSelectionContext | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view && view.file) {
      const context = this.buildSelectionContext(view);
      if (context) {
        this.lastContext = context;
        return context;
      }
    }

    // 侧栏可能导致 active view 不是 markdown，尝试按 active file 反查
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && activeFile.extension === "md") {
      const fallbackView = this.findMarkdownViewByPath(activeFile.path);
      if (fallbackView && fallbackView.file) {
        const context = this.buildSelectionContext(fallbackView);
        if (context) {
          this.lastContext = context;
          return context;
        }
      }
    }

    return null;
  }

  /**
   * 供侧栏调用：清理缓存选区
   */
  public clearHighlightForSidebar(): void {
    this.lastContext = null;
    const sidebar = this.getSidebarView();
    if (sidebar) {
      sidebar.onSelectionCleared();
    }
  }

  /**
   * 供侧栏调用：兼容旧接口，无 UI 状态需要同步
   */
  public setFloatingButtonGenerating(_generating: boolean): void {
    // image-only mode: no floating edit button
  }

  /**
   * 供侧栏调用：获取当前缓存的选区上下文
   */
  public getLastContext(): NotesSelectionContext | null {
    return this.lastContext;
  }

  /**
   * 处理 Image 模式生图，返回候选图元数据
   */
  public async handleImageGeneration(
    prompt: string,
    manualContext?: NotesSelectionContext | null,
    extraInputImages: { base64: string; mimeType: string; role: string }[] = [],
  ): Promise<GeneratedImageCandidate> {
    let context = manualContext || this.lastContext;
    let file: TFile;
    let selectedText = "";

    const activeFile = this.app.workspace.getActiveFile();
    if (context && activeFile && context.file.path !== activeFile.path) {
      context = null;
    }

    if (context) {
      file = context.file;
      selectedText = context.selectedText;
    } else {
      let view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) {
        const active = this.app.workspace.getActiveFile();
        if (active && active.extension === "md") {
          view = this.findMarkdownViewByPath(active.path);
        }
      }

      if (!view || !view.file) {
        new Notice(t("No active file"));
        throw new Error(t("No active file"));
      }
      file = view.file;
    }

    const imageOptions = {
      resolution: this.plugin.settings.defaultResolution || "1K",
      aspectRatio: this.plugin.settings.defaultAspectRatio || "1:1",
    };

    const localApiManager = this.createImageApiManager();

    let instruction = prompt;
    if (!instruction && selectedText) {
      instruction = t("Generate image from context");
    }
    if (!instruction) {
      new Notice(t("Enter instructions"));
      throw new Error(t("Enter instructions"));
    }

    const contextText = selectedText || "";
    // 当侧边栏已显式上传参考图时，强制只使用上传图，不混入文档内其他参考图。
    const inputImages =
      extraInputImages.length > 0
        ? []
        : await extractDocumentImages(
            this.app,
            contextText,
            file.path,
            this.plugin.settings,
          );
    const imagesWithRoles = [
      ...inputImages.map((img) => ({
        base64: img.base64,
        mimeType: img.mimeType,
        role: "reference",
      })),
      ...extraInputImages,
    ];

    const candidate = await this.imageTaskManager.startTask(
      instruction,
      contextText,
      imagesWithRoles,
      imageOptions,
      localApiManager,
      file,
      (base64, f) =>
        saveImageToVault(
          this.app.vault,
          base64,
          f,
          this.plugin.settings.imageSaveFolder,
        ),
    );

    return candidate;
  }

  /**
   * 显式插入候选图片到笔记
   * 规则：优先当前光标，无法获取光标时回退文末
   */
  public async insertImageCandidate(
    candidate: GeneratedImageCandidate,
  ): Promise<boolean> {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const activeFile = activeView?.file || this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== "md") {
      new Notice(
        this.tr(
          "请先激活一个 Markdown 笔记，再执行插入",
          "Please activate a Markdown note before inserting.",
        ),
      );
      return false;
    }

    const targetFile = activeFile;
    const normalizedImagePath = candidate.filePath.replace(/^\/+/, "");
    const imageAbstract =
      this.app.vault.getAbstractFileByPath(normalizedImagePath);
    if (!(imageAbstract instanceof TFile)) {
      new Notice(
        this.tr(
          `找不到图片文件：${normalizedImagePath}`,
          `Image file not found: ${normalizedImagePath}`,
        ),
      );
      return false;
    }

    const linkText = this.app.metadataCache.fileToLinktext(
      imageAbstract,
      targetFile.path,
      false,
    );
    const embed = `![[${linkText}]]`;
    const view = this.findMarkdownViewByPath(targetFile.path) || activeView;

    if (view?.editor) {
      const cursor = view.editor.getCursor();
      view.editor.replaceRange(`\n${embed}\n`, cursor);
      return true;
    }

    const text = await this.app.vault.read(targetFile);
    const suffix = text.endsWith("\n") ? "" : "\n";
    await this.app.vault.modify(targetFile, `${text}${suffix}${embed}\n`);
    return true;
  }

  /**
   * 删除候选图片文件（用于手动丢弃/过期清理）
   */
  public async removeCandidateImageFile(filePath: string): Promise<void> {
    const normalized = filePath.replace(/^\/+/, "");
    const abstract = this.app.vault.getAbstractFileByPath(normalized);
    if (abstract instanceof TFile) {
      await this.app.vault.delete(abstract);
    }
  }

  /**
   * 兼容旧快捷键入口：image-only 模式下不再支持打开编辑面板
   */
  public triggerOpenPalette(): boolean {
    return false;
  }

  /**
   * 兼容旧接口：image-only 模式不使用该能力
   */
  public selectGeneratedText(
    _editor: Editor,
    _startPos: { line: number; ch: number },
    _endPos: { line: number; ch: number },
  ): void {
    // no-op
  }

  /**
   * 从设置刷新配置
   */
  public refreshFromSettings(): void {
    this.imageTaskManager.updateSettings(this.plugin.settings);
  }

  public cancelImageTasks(): void {
    this.imageTaskManager.cancelAllTasks();
  }

  public destroy(): void {
    this.imageTaskManager.destroy();
  }
}
