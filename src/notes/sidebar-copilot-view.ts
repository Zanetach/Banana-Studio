import {
  ItemView,
  WorkspaceLeaf,
  Notice,
  setIcon,
  TFile,
  Modal,
  App,
} from "obsidian";
import type CanvasAIPlugin from "../../main";
import type { PromptPreset, QuickSwitchModel } from "../settings/settings";
import { t } from "../../lang/helpers";
import type { NotesSelectionContext } from "./notes-selection-handler";
import type { GeneratedImageCandidate } from "./note-image-task-manager";

export const VIEW_TYPE_SIDEBAR_COPILOT = "canvas-ai-sidebar-copilot";

type CandidateStatus = "ready" | "inserted" | "discarded";

interface SidebarImageCandidate extends GeneratedImageCandidate {
  status: CandidateStatus;
}

interface PresetEditorResult {
  selectedId: string;
  name: string;
  prompt: string;
}

class PresetEditorModal extends Modal {
  private readonly presets: PromptPreset[];
  private selectedId: string;
  private nameValue: string = "";
  private promptValue: string = "";
  private readonly onSave: (result: PresetEditorResult) => void;

  constructor(
    app: App,
    presets: PromptPreset[],
    initialPresetId: string,
    onSave: (result: PresetEditorResult) => void,
  ) {
    super(app);
    this.presets = presets;
    this.selectedId = initialPresetId;
    this.onSave = onSave;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "添加 / 选择预设" });

    const presetRow = contentEl.createDiv("canvas-ai-modal-row");
    presetRow.createEl("label", { text: "已有预设" });

    const presetSelect = presetRow.createEl("select");
    presetSelect.createEl("option", { value: "", text: "新建预设" });
    this.presets.forEach((p) => {
      presetSelect.createEl("option", { value: p.id, text: p.name });
    });
    if (this.selectedId) {
      presetSelect.value = this.selectedId;
    }

    const nameRow = contentEl.createDiv("canvas-ai-modal-row");
    nameRow.createEl("label", { text: "预设名称" });
    const nameInput = nameRow.createEl("input", {
      attr: { type: "text", placeholder: "输入预设名称" },
    });

    const promptRow = contentEl.createDiv("canvas-ai-modal-row");
    promptRow.createEl("label", { text: "预设 Prompt" });
    const promptInput = promptRow.createEl("textarea", {
      attr: { rows: "6", placeholder: "输入预设 Prompt 内容" },
    });

    const applySelectedPreset = (id: string): void => {
      if (!id) {
        nameInput.value = "";
        promptInput.value = "";
        this.nameValue = "";
        this.promptValue = "";
        return;
      }

      const preset = this.presets.find((p) => p.id === id);
      if (!preset) return;

      nameInput.value = preset.name;
      promptInput.value = preset.prompt;
      this.nameValue = preset.name;
      this.promptValue = preset.prompt;
    };

    applySelectedPreset(this.selectedId);

    presetSelect.addEventListener("change", () => {
      this.selectedId = presetSelect.value;
      applySelectedPreset(this.selectedId);
    });

    nameInput.addEventListener("input", () => {
      this.nameValue = nameInput.value;
    });

    promptInput.addEventListener("input", () => {
      this.promptValue = promptInput.value;
    });

    const actions = contentEl.createDiv("modal-button-container");
    const cancelBtn = actions.createEl("button", { text: t("Cancel") });
    cancelBtn.addEventListener("click", () => this.close());

    const saveBtn = actions.createEl("button", {
      text: "保存",
      cls: "mod-cta",
    });
    saveBtn.addEventListener("click", () => {
      const name = this.nameValue.trim();
      const prompt = this.promptValue.trim();

      if (!name) {
        new Notice("请输入预设名称");
        return;
      }
      if (!prompt) {
        new Notice("请输入预设 Prompt 内容");
        return;
      }

      this.close();
      this.onSave({
        selectedId: this.selectedId,
        name,
        prompt,
      });
    });

    setTimeout(() => nameInput.focus(), 50);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class SideBarCoPilotView extends ItemView {
  private plugin: CanvasAIPlugin;

  private messagesContainer: HTMLElement;
  private candidateContainer: HTMLElement;
  private candidateListEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private generateBtn: HTMLButtonElement;

  private imageModelSelect: HTMLSelectElement;
  private resolutionSelect: HTMLSelectElement;
  private aspectRatioSelect: HTMLSelectElement;
  private presetSelect: HTMLSelectElement;
  private presetManageBtn: HTMLButtonElement;

  private imagePresets: PromptPreset[] = [];
  private quickSwitchImageModels: QuickSwitchModel[] = [];
  private selectedImageModel: string = "";

  private pendingTaskCount: number = 0;
  private imageCandidates: SidebarImageCandidate[] = [];
  private candidateCleanupTimer: number | null = null;
  private readonly candidateTtlMs = 24 * 60 * 60 * 1000;

  private capturedContext: NotesSelectionContext | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: CanvasAIPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_SIDEBAR_COPILOT;
  }

  getDisplayText(): string {
    return "Banana Studio";
  }

  getIcon(): string {
    return "banana";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("sidebar-copilot-container");

    this.createDOM(container);
    this.initFromSettings();
    this.registerActiveFileListener();
    this.startCandidateCleanupTimer();
  }

  async onClose(): Promise<void> {
    if (this.candidateCleanupTimer !== null) {
      window.clearInterval(this.candidateCleanupTimer);
      this.candidateCleanupTimer = null;
    }
  }

  public refreshFromSettings(): void {
    this.initFromSettings();
  }

  public onSelectionCleared(): void {
    this.capturedContext = null;
    this.updateGenerateButtonState();
  }

  private createDOM(container: HTMLElement): void {
    const header = container.createDiv("sidebar-copilot-header");
    header.createDiv({ cls: "sidebar-copilot-title", text: t("Image") });

    this.messagesContainer = container.createDiv("sidebar-image-log");

    this.candidateContainer = container.createDiv("sidebar-image-candidates");
    const candidateHeader = this.candidateContainer.createDiv(
      "sidebar-image-candidates-header",
    );
    candidateHeader.createDiv({
      cls: "sidebar-image-candidates-title",
      text: "Generated Images",
    });

    const clearBtn = candidateHeader.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": "Clear Expired" },
    });
    setIcon(clearBtn, "trash");
    clearBtn.addEventListener("click", () => {
      void this.clearExpiredCandidates();
    });

    this.candidateListEl = this.candidateContainer.createDiv(
      "sidebar-image-candidates-list",
    );

    const footer = container.createDiv("canvas-ai-palette-footer");

    const zone1 = footer.createDiv("sidebar-zone-1");

    const presetSection = zone1.createDiv("sidebar-preset-section");
    presetSection.createEl("label", { text: "预设区" });
    const presetControls = presetSection.createDiv("sidebar-preset-controls");

    this.presetSelect = presetControls.createEl("select", {
      cls: "canvas-ai-preset-select",
    });

    this.presetManageBtn = presetControls.createEl("button", {
      cls: "canvas-ai-preset-manage-btn",
      text: "添加/选择预设",
    });

    const paramsSection = zone1.createDiv("sidebar-params-section");
    paramsSection.createEl("label", { text: "参数区" });

    const optionsRow = paramsSection.createDiv("canvas-ai-image-options");

    const modelGroup = optionsRow.createDiv("canvas-ai-option-group");
    modelGroup.createEl("label", { text: "Image Model" });
    this.imageModelSelect = modelGroup.createEl("select", {
      cls: "canvas-ai-image-model-select",
    });

    const resolutionGroup = optionsRow.createDiv("canvas-ai-option-group");
    resolutionGroup.createEl("label", { text: "分辨率" });
    this.resolutionSelect = resolutionGroup.createEl("select");
    ["1K", "2K", "4K"].forEach((v) => {
      this.resolutionSelect.createEl("option", { value: v, text: v });
    });

    const aspectGroup = optionsRow.createDiv("canvas-ai-option-group");
    aspectGroup.createEl("label", { text: "Aspect Ratio" });
    this.aspectRatioSelect = aspectGroup.createEl("select");
    ["1:1", "16:9", "9:16", "4:3", "3:4"].forEach((v) => {
      this.aspectRatioSelect.createEl("option", { value: v, text: v });
    });

    const zone2 = footer.createDiv("sidebar-zone-2");

    this.inputEl = zone2.createEl("textarea", {
      cls: "canvas-ai-prompt-input",
      attr: {
        placeholder: "Describe image to generate",
        rows: "3",
      },
    });

    this.generateBtn = zone2.createEl("button", {
      cls: "canvas-ai-generate-btn",
      text: "生成",
    });

    this.setupEvents();
    this.renderCandidateList();
  }

  private setupEvents(): void {
    this.presetSelect.addEventListener("change", () => {
      const selectedId = this.presetSelect.value;
      const selected = this.imagePresets.find((p) => p.id === selectedId);
      if (selected) {
        this.inputEl.value = selected.prompt || "";
        this.updateGenerateButtonState();
      }
    });

    this.presetManageBtn.addEventListener("click", () => {
      this.openPresetEditor();
    });

    this.imageModelSelect.addEventListener("change", () => {
      this.selectedImageModel = this.imageModelSelect.value;
      this.plugin.settings.paletteImageModel = this.selectedImageModel;
      void this.plugin.saveSettings();
    });

    this.resolutionSelect.addEventListener("change", () => {
      this.plugin.settings.defaultResolution = this.resolutionSelect.value;
      void this.plugin.saveSettings();
    });

    this.aspectRatioSelect.addEventListener("change", () => {
      this.plugin.settings.defaultAspectRatio = this.aspectRatioSelect.value;
      void this.plugin.saveSettings();
    });

    this.generateBtn.addEventListener("click", () => {
      void this.handleGenerate();
    });
  }

  private initFromSettings(): void {
    this.imagePresets = [...(this.plugin.settings.imagePresets || [])];
    this.quickSwitchImageModels = [
      ...(this.plugin.settings.quickSwitchImageModels || []),
    ];
    this.selectedImageModel = this.plugin.settings.paletteImageModel || "";

    this.rebuildPresetSelect();
    this.rebuildImageModelSelect();

    this.resolutionSelect.value =
      this.plugin.settings.defaultResolution || "1K";
    this.aspectRatioSelect.value =
      this.plugin.settings.defaultAspectRatio || "1:1";

    this.updateGenerateButtonState();
  }

  private rebuildPresetSelect(selectedId: string = ""): void {
    this.presetSelect.empty();

    this.presetSelect.createEl("option", {
      value: "",
      text: "选择预设",
    });

    this.imagePresets.forEach((preset) => {
      this.presetSelect.createEl("option", {
        value: preset.id,
        text: preset.name,
      });
    });

    if (selectedId) {
      this.presetSelect.value = selectedId;
    }
  }

  private rebuildImageModelSelect(): void {
    this.imageModelSelect.empty();

    this.imageModelSelect.createEl("option", {
      value: "",
      text: "Use default model",
    });

    this.quickSwitchImageModels.forEach((m) => {
      const label = `${m.provider}/${m.modelId}`;
      this.imageModelSelect.createEl("option", {
        value: `${m.provider}|${m.modelId}`,
        text: label,
      });
    });

    if (this.selectedImageModel) {
      this.imageModelSelect.value = this.selectedImageModel;
    }
  }

  private openPresetEditor(): void {
    const modal = new PresetEditorModal(
      this.app,
      this.imagePresets,
      this.presetSelect?.value || "",
      async ({ selectedId, name, prompt }) => {
        let idToSelect = selectedId;

        if (selectedId) {
          const target = this.imagePresets.find((p) => p.id === selectedId);
          if (target) {
            target.name = name;
            target.prompt = prompt;
          } else {
            idToSelect = "";
          }
        }

        if (!idToSelect) {
          const existedByName = this.imagePresets.find((p) => p.name === name);
          if (existedByName) {
            existedByName.prompt = prompt;
            idToSelect = existedByName.id;
          } else {
            const created: PromptPreset = {
              id: this.generatePresetId(),
              name,
              prompt,
            };
            this.imagePresets.push(created);
            idToSelect = created.id;
          }
        }

        this.plugin.settings.imagePresets = [...this.imagePresets];
        await this.plugin.saveSettings();

        this.rebuildPresetSelect(idToSelect);
        this.inputEl.value = prompt;
        this.updateGenerateButtonState();
        new Notice("预设已保存");
      },
    );

    modal.open();
  }

  private generatePresetId(): string {
    return `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }

  private registerActiveFileListener(): void {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        const file = this.app.workspace.getActiveFile();
        if (file?.extension !== "md") {
          this.capturedContext = null;
        }
      }),
    );
  }

  private updateGenerateButtonState(): void {
    if (!this.generateBtn) return;

    if (this.pendingTaskCount === 0) {
      this.generateBtn.textContent = "生成";
      this.generateBtn.removeClass("generating");
    } else {
      this.generateBtn.textContent =
        "Generating " + this.pendingTaskCount + " Tasks";
      this.generateBtn.addClass("generating");
    }
  }

  private async handleGenerate(): Promise<void> {
    if (this.pendingTaskCount > 0) return;
    await this.handleImageGenerate();
  }

  private async handleImageGenerate(): Promise<void> {
    const notesHandler = this.plugin.getNotesHandler();
    if (!notesHandler) {
      new Notice("Notes handler unavailable");
      return;
    }

    const prompt = this.inputEl.value.trim();

    const refreshedContext = notesHandler.captureSelectionForSidebar();
    if (refreshedContext) {
      this.capturedContext = refreshedContext;
    }

    if (!prompt && !this.capturedContext?.selectedText?.trim()) {
      new Notice(t("Enter instructions"));
      return;
    }

    const requestCount = 4;
    this.pendingTaskCount = requestCount;
    this.updateGenerateButtonState();

    for (let i = 0; i < requestCount; i++) {
      void (async () => {
        try {
          const candidate = await notesHandler.handleImageGeneration(
            prompt,
            this.capturedContext,
          );
          this.addCandidate(candidate);
          this.addMessage(
            "assistant",
            `Image #${i + 1} ready: ${candidate.fileName}`,
          );
        } catch (e) {
          console.error("Sidebar CoPilot: image generation failed", e);
          const msg =
            e instanceof Error ? e.message : "Image generation failed";
          this.addMessage("assistant", msg);
        } finally {
          this.pendingTaskCount = Math.max(0, this.pendingTaskCount - 1);
          this.updateGenerateButtonState();
        }
      })();
    }
  }

  private addMessage(role: "user" | "assistant", content: string): void {
    const wrapper = this.messagesContainer.createDiv(
      `sidebar-image-log-item ${role}`,
    );
    wrapper.createDiv({
      cls: `sidebar-image-log-message ${role}`,
      text: content,
    });
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  private addCandidate(candidate: GeneratedImageCandidate): void {
    this.imageCandidates.unshift({ ...candidate, status: "ready" });
    this.renderCandidateList();
  }

  private renderCandidateList(): void {
    this.candidateListEl.empty();

    if (this.imageCandidates.length === 0) {
      this.candidateListEl.createDiv({
        cls: "sidebar-image-candidate-empty",
        text: "No images yet",
      });
      return;
    }

    this.imageCandidates.forEach((candidate) => {
      const card = this.candidateListEl.createDiv(
        "sidebar-image-candidate-card",
      );

      const previewSrc = this.getCandidatePreviewSrc(candidate.filePath);
      const preview = card.createDiv("sidebar-image-candidate-preview");
      if (previewSrc) {
        const img = preview.createEl("img", {
          attr: { src: previewSrc, alt: candidate.fileName },
        });
        img.loading = "lazy";
      } else {
        preview.createDiv({ text: candidate.fileName });
      }

      const meta = card.createDiv("sidebar-image-candidate-meta");
      meta.createDiv({
        cls: "sidebar-image-candidate-name",
        text: candidate.fileName,
      });

      const statusText =
        candidate.status === "ready"
          ? "Ready to insert"
          : candidate.status === "inserted"
            ? "Inserted"
            : "Discarded";

      meta.createDiv({
        cls: `sidebar-image-candidate-status status-${candidate.status}`,
        text: statusText,
      });

      const actions = card.createDiv("sidebar-image-candidate-actions");
      const insertBtn = actions.createEl("button", {
        cls: "mod-cta",
        text: t("Insert"),
      });
      const discardBtn = actions.createEl("button", {
        text: "Discard",
      });

      const disabled = candidate.status !== "ready";
      insertBtn.disabled = disabled;
      discardBtn.disabled = disabled;

      insertBtn.addEventListener("click", () => {
        void this.handleInsertCandidate(candidate.taskId);
      });
      discardBtn.addEventListener("click", () => {
        void this.handleDiscardCandidate(candidate.taskId);
      });
    });
  }

  private async handleInsertCandidate(candidateId: string): Promise<void> {
    const notesHandler = this.plugin.getNotesHandler();
    if (!notesHandler) return;

    const candidate = this.imageCandidates.find(
      (c) => c.taskId === candidateId,
    );
    if (!candidate || candidate.status !== "ready") return;

    const ok = await notesHandler.insertImageCandidate(candidate);
    if (!ok) return;

    candidate.status = "inserted";
    this.renderCandidateList();
    new Notice("Image inserted");
  }

  private async handleDiscardCandidate(candidateId: string): Promise<void> {
    const notesHandler = this.plugin.getNotesHandler();
    if (!notesHandler) return;

    const candidate = this.imageCandidates.find(
      (c) => c.taskId === candidateId,
    );
    if (!candidate || candidate.status !== "ready") return;

    candidate.status = "discarded";
    this.renderCandidateList();

    try {
      await notesHandler.removeCandidateImageFile(candidate.filePath);
    } catch (e) {
      console.warn("Sidebar CoPilot: failed to delete discarded image", e);
    }
  }

  private startCandidateCleanupTimer(): void {
    if (this.candidateCleanupTimer !== null) return;
    this.candidateCleanupTimer = window.setInterval(
      () => {
        void this.clearExpiredCandidates();
      },
      10 * 60 * 1000,
    );
  }

  private async clearExpiredCandidates(): Promise<void> {
    if (this.imageCandidates.length === 0) return;
    const notesHandler = this.plugin.getNotesHandler();
    const now = Date.now();

    const remaining: SidebarImageCandidate[] = [];
    for (const candidate of this.imageCandidates) {
      const expired = now - candidate.createdAt > this.candidateTtlMs;
      const keep = !expired || candidate.status === "inserted";
      if (keep) {
        remaining.push(candidate);
        continue;
      }

      if (candidate.status === "ready" && notesHandler) {
        try {
          await notesHandler.removeCandidateImageFile(candidate.filePath);
        } catch (e) {
          console.warn("Sidebar CoPilot: failed to cleanup expired image", e);
        }
      }
    }

    if (remaining.length !== this.imageCandidates.length) {
      this.imageCandidates = remaining;
      this.renderCandidateList();
    }
  }

  private getCandidatePreviewSrc(filePath: string): string | null {
    const abstract = this.app.vault.getAbstractFileByPath(filePath);
    if (!(abstract instanceof TFile)) {
      return null;
    }
    return this.app.vault.getResourcePath(abstract);
  }
}
