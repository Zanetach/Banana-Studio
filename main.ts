import { Plugin } from "obsidian";
import { ApiManager } from "./src/api/api-manager";
import {
  ApiProvider,
  QuickSwitchModel,
  PromptPreset,
  CanvasAISettings,
  DEFAULT_SETTINGS,
} from "./src/settings/settings";
import { CanvasAISettingTab } from "./src/settings/settings-tab";
import {
  NotesSelectionHandler,
  SideBarCoPilotView,
  VIEW_TYPE_SIDEBAR_COPILOT,
} from "./src/notes";

// Re-export for backward compatibility
export type { ApiProvider, QuickSwitchModel, PromptPreset, CanvasAISettings };

export default class CanvasAIPlugin extends Plugin {
  settings: CanvasAISettings;

  public apiManager: ApiManager | null = null;
  private notesHandler: NotesSelectionHandler | null = null;

  public getNotesHandler(): NotesSelectionHandler | null {
    return this.notesHandler;
  }

  async onload() {
    console.debug("Banana Studio: Plugin loading...");

    await this.loadSettings();
    this.migrateLegacySettings();
    await this.saveSettings();

    this.addSettingTab(new CanvasAISettingTab(this.app, this));

    // Image-only mode: keep API manager for sidebar generation.
    this.apiManager = new ApiManager(this.settings);
    this.notesHandler = new NotesSelectionHandler(this);

    this.registerView(
      VIEW_TYPE_SIDEBAR_COPILOT,
      (leaf) => new SideBarCoPilotView(leaf, this),
    );

    const ribbonIcon = this.addRibbonIcon("banana", "Banana Studio", () => {
      void this.toggleSidebarCoPilot();
    });
    ribbonIcon.parentElement?.appendChild(ribbonIcon);

    console.debug("Banana Studio: Plugin loaded");
  }

  onunload() {
    console.debug("Banana Studio: Plugin unloading...");
    this.notesHandler?.destroy();
    console.debug("Banana Studio: Plugin unloaded");
  }

  private migrateLegacySettings(): void {
    const rawProvider = this.settings.apiProvider as string;
    if (rawProvider === "yunwu" || rawProvider === "gptgod") {
      this.settings.apiProvider = "openrouter";
    }

    if (this.settings.textModel && !this.settings.openRouterTextModel) {
      this.settings.openRouterTextModel = this.settings.textModel;
      this.settings.textModel = undefined;
    }

    if (this.settings.imageModel && !this.settings.openRouterImageModel) {
      this.settings.openRouterImageModel = this.settings.imageModel;
      this.settings.imageModel = undefined;
    }

    if (
      this.settings.useCustomTextModel !== undefined &&
      this.settings.openRouterUseCustomTextModel === undefined
    ) {
      // @ts-ignore legacy field migration
      this.settings.openRouterUseCustomTextModel =
        this.settings.useCustomTextModel;
      this.settings.useCustomTextModel = undefined;
    }

    if (
      this.settings.useCustomImageModel !== undefined &&
      this.settings.openRouterUseCustomImageModel === undefined
    ) {
      // @ts-ignore legacy field migration
      this.settings.openRouterUseCustomImageModel =
        this.settings.useCustomImageModel;
      this.settings.useCustomImageModel = undefined;
    }

    // @ts-ignore legacy field migration
    if (this.settings.chatSystemPrompt !== undefined) {
      // @ts-ignore legacy field migration
      this.settings.chatSystemPrompt = undefined;
    }
  }

  private async toggleSidebarCoPilot(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(
      VIEW_TYPE_SIDEBAR_COPILOT,
    );

    if (existing.length > 0) {
      existing.forEach((leaf) => leaf.detach());
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;

    await leaf.setViewState({
      type: VIEW_TYPE_SIDEBAR_COPILOT,
      active: true,
    });
    void this.app.workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.apiManager?.updateSettings(this.settings);
    this.notifySettingsChanged();
  }

  private notifySettingsChanged(): void {
    this.notesHandler?.refreshFromSettings();

    const sidebarLeaves = this.app.workspace.getLeavesOfType(
      VIEW_TYPE_SIDEBAR_COPILOT,
    );
    for (const leaf of sidebarLeaves) {
      const view = leaf.view;
      if (view instanceof SideBarCoPilotView) {
        view.refreshFromSettings();
      }
    }
  }
}
