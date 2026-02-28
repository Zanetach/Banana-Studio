import {
  ItemView,
  WorkspaceLeaf,
  Notice,
  setIcon,
  TFile,
  Modal,
  App,
  Menu,
} from "obsidian";
import type CanvasAIPlugin from "../../main";
import type { PromptPreset, QuickSwitchModel } from "../settings/settings";
import { isZhLocale, t } from "../../lang/helpers";
import type { NotesSelectionContext } from "./notes-selection-handler";
import type { GeneratedImageCandidate } from "./note-image-task-manager";

export const VIEW_TYPE_SIDEBAR_COPILOT = "canvas-ai-sidebar-copilot";

type CandidateStatus = "pending" | "ready" | "inserted" | "discarded";

interface SidebarInputImage {
  base64: string;
  mimeType: string;
  role: "reference";
  fileName: string;
  sourcePath?: string;
}

interface SidebarImageCandidate extends GeneratedImageCandidate {
  status: CandidateStatus;
  sessionId: number;
  sequence: number;
  sourcePrompt: string;
  sourceContext: NotesSelectionContext | null;
  sourceInputImages: SidebarInputImage[];
}

interface FailedGenerationTask {
  id: string;
  prompt: string;
  context: NotesSelectionContext | null;
  inputImages: SidebarInputImage[];
  errorMessage: string;
  createdAt: number;
}

interface GenerationQueueTask {
  prompt: string;
  context: NotesSelectionContext | null;
  sequence: number;
  inputImages: SidebarInputImage[];
}

interface CurrentNoteInjectionResult {
  prompt: string;
  replaced: boolean;
}

interface NoteImageOption {
  path: string;
  fileName: string;
  previewSrc: string;
}

type ImageErrorCode =
  | "超时"
  | "余额不足"
  | "鉴权失败"
  | "网络异常"
  | "服务异常"
  | "未知错误";

type PrimaryReferenceSource = "uploaded" | "note";

interface PresetEditorResult {
  selectedId: string;
  name: string;
  prompt: string;
}

const bi = (zh: string, en: string): string => (isZhLocale() ? zh : en);

class ReferenceImagePreviewModal extends Modal {
  private readonly imageUrl: string;
  private readonly fileName: string;
  private readonly actions?: {
    downloadText: string;
    insertText: string;
    onDownload: () => void;
    onInsert: () => void;
  };

  constructor(
    app: App,
    imageUrl: string,
    fileName: string,
    actions?: {
      downloadText: string;
      insertText: string;
      onDownload: () => void;
      onInsert: () => void;
    },
  ) {
    super(app);
    this.imageUrl = imageUrl;
    this.fileName = fileName;
    this.actions = actions;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("sidebar-reference-preview-modal");
    contentEl.createEl("h3", {
      text: this.fileName || bi("参考图预览", "Reference Preview"),
    });
    contentEl.createEl("img", {
      cls: "sidebar-reference-preview-modal-image",
      attr: {
        src: this.imageUrl,
        alt: this.fileName || bi("参考图预览", "Reference Preview"),
      },
    });

    if (this.actions) {
      const actionsEl = contentEl.createDiv("sidebar-reference-preview-actions");
      actionsEl
        .createEl("button", {
          text: this.actions.downloadText,
        })
        .addEventListener("click", () => {
          this.actions?.onDownload();
        });
      actionsEl
        .createEl("button", {
          text: this.actions.insertText,
          cls: "mod-cta",
        })
        .addEventListener("click", () => {
          this.actions?.onInsert();
          this.close();
        });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class NoteImagePickerModal extends Modal {
  private readonly options: NoteImageOption[];
  private readonly preselectedPaths: Set<string>;
  private readonly onConfirm: (paths: string[]) => void;

  constructor(
    app: App,
    options: NoteImageOption[],
    preselectedPaths: Set<string>,
    onConfirm: (paths: string[]) => void,
  ) {
    super(app);
    this.options = options;
    this.preselectedPaths = preselectedPaths;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("sidebar-note-image-picker-modal");
    contentEl.createEl("h3", {
      text: bi(
        "从当前笔记选择参考图",
        "Select Reference Images from Current Note",
      ),
    });

    if (this.options.length === 0) {
      contentEl.createDiv({
        cls: "sidebar-note-image-picker-empty",
        text: bi(
          "当前笔记未找到可用图片",
          "No available images found in current note",
        ),
      });
      return;
    }

    const selected = new Set<string>(this.preselectedPaths);
    const list = contentEl.createDiv("sidebar-note-image-picker-list");

    this.options.forEach((option) => {
      const item = list.createDiv("sidebar-note-image-picker-item");
      const label = item.createEl("label", {
        cls: "sidebar-note-image-picker-label",
      });
      const checkbox = label.createEl("input", {
        attr: { type: "checkbox" },
      });
      checkbox.checked = selected.has(option.path);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(option.path);
        else selected.delete(option.path);
      });
      label.createEl("img", {
        cls: "sidebar-note-image-picker-thumb",
        attr: { src: option.previewSrc, alt: option.fileName },
      });
      label.createDiv({
        cls: "sidebar-note-image-picker-name",
        text: option.fileName,
      });
    });

    const actions = contentEl.createDiv("modal-button-container");
    actions
      .createEl("button", { text: t("Cancel") })
      .addEventListener("click", () => {
        this.close();
      });
    actions
      .createEl("button", { text: bi("确认", "Confirm"), cls: "mod-cta" })
      .addEventListener("click", () => {
        this.onConfirm(Array.from(selected));
        this.close();
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class PresetBrowserModal extends Modal {
  private readonly presets: PromptPreset[];
  private readonly onSelect: (preset: PromptPreset) => void;

  constructor(
    app: App,
    presets: PromptPreset[],
    onSelect: (preset: PromptPreset) => void,
  ) {
    super(app);
    this.presets = presets;
    this.onSelect = onSelect;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: bi("全部预设", "All Presets") });

    if (this.presets.length === 0) {
      contentEl.createDiv({
        cls: "sidebar-recent-presets-empty",
        text: bi("暂无预设", "No presets yet"),
      });
      return;
    }

    const list = contentEl.createDiv("sidebar-all-presets-list");
    [...this.presets].reverse().forEach((preset) => {
      const btn = list.createEl("button", {
        cls: "sidebar-all-preset-item",
        text: preset.name,
      });
      btn.addEventListener("click", () => {
        this.onSelect(preset);
        this.close();
      });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
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
    contentEl.createEl("h3", {
      text: bi("添加 / 选择预设", "Add / Select Preset"),
    });

    const presetRow = contentEl.createDiv("canvas-ai-modal-row");
    presetRow.createEl("label", { text: bi("已有预设", "Existing Presets") });

    const presetSelect = presetRow.createEl("select");
    presetSelect.createEl("option", {
      value: "",
      text: bi("新建预设", "Create New Preset"),
    });
    this.presets.forEach((p) => {
      presetSelect.createEl("option", { value: p.id, text: p.name });
    });
    if (this.selectedId) {
      presetSelect.value = this.selectedId;
    }

    const nameRow = contentEl.createDiv("canvas-ai-modal-row");
    nameRow.createEl("label", { text: bi("预设名称", "Preset Name") });
    const nameInput = nameRow.createEl("input", {
      attr: {
        type: "text",
        placeholder: bi("输入预设名称", "Enter preset name"),
      },
    });

    const promptRow = contentEl.createDiv("canvas-ai-modal-row");
    promptRow.createEl("label", { text: bi("预设 Prompt", "Preset Prompt") });
    const promptInput = promptRow.createEl("textarea", {
      attr: {
        rows: "6",
        placeholder: bi("输入预设 Prompt 内容", "Enter preset prompt content"),
      },
    });
    promptInput.addClass("canvas-ai-modal-prompt-input");

    const autoResizePromptInput = (): void => {
      promptInput.style.height = "auto";
      const maxHeight = 360;
      const nextHeight = Math.min(promptInput.scrollHeight, maxHeight);
      promptInput.style.height = `${nextHeight}px`;
      promptInput.style.overflowY =
        promptInput.scrollHeight > maxHeight ? "auto" : "hidden";
    };

    const applySelectedPreset = (id: string): void => {
      if (!id) {
        nameInput.value = "";
        promptInput.value = "";
        this.nameValue = "";
        this.promptValue = "";
        autoResizePromptInput();
        return;
      }

      const preset = this.presets.find((p) => p.id === id);
      if (!preset) return;

      nameInput.value = preset.name;
      promptInput.value = preset.prompt;
      this.nameValue = preset.name;
      this.promptValue = preset.prompt;
      autoResizePromptInput();
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
      autoResizePromptInput();
    });

    const actions = contentEl.createDiv("modal-button-container");
    const cancelBtn = actions.createEl("button", { text: t("Cancel") });
    cancelBtn.addEventListener("click", () => this.close());

    const saveBtn = actions.createEl("button", {
      text: bi("保存", "Save"),
      cls: "mod-cta",
    });
    saveBtn.addEventListener("click", () => {
      const name = this.nameValue.trim();
      const prompt = this.promptValue.trim();

      if (!name) {
        new Notice(bi("请输入预设名称", "Please enter preset name"));
        return;
      }
      if (!prompt) {
        new Notice(
          bi("请输入预设 Prompt 内容", "Please enter preset prompt content"),
        );
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
    setTimeout(autoResizePromptInput, 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class SideBarCoPilotView extends ItemView {
  private readonly referencePromptPrefix = "[参考图] ";
  private readonly pptAutoMarker = "[PPT_AUTO]";
  private readonly pptAutoLegacyMarker = "[PPT_AUTO_8]";
  private readonly currentNotePlaceholderTokens = [
    "@current_note",
    "{{current_note}}",
    "@当前笔记",
  ];
  private readonly currentNoteShortcutPattern =
    /(^|[\s,，。；;])@(?=$|[\s,，。；;])/g;
  private readonly currentNoteTokenPattern = /@current_note(?:\([^)]+\))?/g;

  private plugin: CanvasAIPlugin;

  private messagesContainer: HTMLElement;
  private candidateContainer: HTMLElement;
  private candidateListEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private optimizePromptBtn: HTMLButtonElement;
  private generateBtn: HTMLButtonElement;
  private cancelBtn: HTMLButtonElement;
  private retryFailedBtn: HTMLButtonElement;
  private insertAllBtn: HTMLButtonElement;
  private generationStatusEl: HTMLElement;
  private imageToImageToggleBtn: HTMLButtonElement;
  private imageToImageStateEl: HTMLElement;
  private imageToImagePanelEl: HTMLElement;
  private imageToImageUploadBtn: HTMLButtonElement;
  private imageToImageClearBtn: HTMLButtonElement;
  private imageToImageFileInput: HTMLInputElement;
  private imageToImagePreviewWrapEl: HTMLElement;
  private imageToImagePreviewEl: HTMLImageElement;
  private imageToImageFileNameEl: HTMLElement;

  private imageModelSelect: HTMLSelectElement;
  private resolutionSelect: HTMLSelectElement;
  private aspectRatioSelect: HTMLSelectElement;
  private imageCountSelect: HTMLSelectElement;
  private presetSelect: HTMLSelectElement;
  private presetManageBtn: HTMLButtonElement;
  private presetDeleteBtn: HTMLButtonElement;
  private viewAllPresetsBtn: HTMLButtonElement;
  private recentPresetsListEl: HTMLElement;

  private imagePresets: PromptPreset[] = [];
  private quickSwitchImageModels: QuickSwitchModel[] = [];
  private selectedImageModel: string = "";

  private pendingTaskCount: number = 0;
  private promptSaveTimer: number | null = null;
  private activeRequestTotal: number = 0;
  private activeConcurrencyCount: number = 0;
  private currentSessionId: number = 0;
  private canceledSessionIds: Set<number> = new Set();
  private imageCandidates: SidebarImageCandidate[] = [];
  private failedTasks: FailedGenerationTask[] = [];
  private failedTaskCounter: number = 0;
  private isBulkInserting: boolean = false;
  private discardedCandidateSlots: Set<string> = new Set();
  private candidateCleanupTimer: number | null = null;
  private readonly candidateTtlMs = 24 * 60 * 60 * 1000;
  private candidateRenderRaf: number | null = null;
  private candidateViewportKey: string = "";
  private readonly candidateGridMinWidth = 120;
  private readonly candidateGridGap = 8;
  private readonly candidateVirtualOverscanRows = 2;

  private capturedContext: NotesSelectionContext | null = null;
  private isImageToImageEnabled: boolean = false;
  private uploadedReferenceImage: SidebarInputImage | null = null;
  private selectedReferenceImages: SidebarInputImage[] = [];
  private primaryReferenceSource: PrimaryReferenceSource | null = null;
  private referencePreviewObjectUrl: string | null = null;

  private tr(zh: string, en: string): string {
    return isZhLocale() ? zh : en;
  }

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
    if (this.promptSaveTimer !== null) {
      window.clearTimeout(this.promptSaveTimer);
      this.promptSaveTimer = null;
    }
    if (this.candidateRenderRaf !== null) {
      window.cancelAnimationFrame(this.candidateRenderRaf);
      this.candidateRenderRaf = null;
    }
    this.setReferencePreviewObjectUrl(null);
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

    this.candidateContainer = container.createDiv("sidebar-image-candidates");
    const candidateHeader = this.candidateContainer.createDiv(
      "sidebar-image-candidates-header",
    );
    candidateHeader.createDiv({
      cls: "sidebar-image-candidates-title",
      text: this.tr("生成候选图", "Generated Candidates"),
    });

    this.insertAllBtn = candidateHeader.createEl("button", {
      cls: "sidebar-insert-all-btn",
      text: this.tr("一键插入全部", "Insert All"),
    });
    this.insertAllBtn.addEventListener("click", () => {
      void this.handleInsertAllCandidates();
    });

    this.retryFailedBtn = candidateHeader.createEl("button", {
      cls: "sidebar-retry-failed-btn",
      text: this.tr("重试失败项", "Retry Failed"),
    });
    this.retryFailedBtn.addEventListener("click", () => {
      this.retryFailedTasks();
    });

    this.candidateListEl = this.candidateContainer.createDiv(
      "sidebar-image-candidates-list",
    );
    this.registerDomEvent(this.candidateListEl, "scroll", () => {
      this.scheduleCandidateListRender();
    });
    this.registerDomEvent(window, "resize", () => {
      this.scheduleCandidateListRender();
    });

    const footer = container.createDiv(
      "canvas-ai-palette-footer sidebar-studio-layout",
    );

    const zone1 = footer.createDiv("sidebar-zone-1");

    const presetSection = zone1.createDiv("sidebar-preset-section");
    presetSection.createDiv({
      cls: "sidebar-section-title",
      text: this.tr("预设管理", "Preset Management"),
    });
    presetSection.createDiv({
      cls: "sidebar-section-subtitle",
      text: this.tr(
        "支持新增、编辑、删除预设",
        "Add, edit, and delete presets",
      ),
    });
    const presetControls = presetSection.createDiv("sidebar-preset-controls");

    this.presetSelect = presetControls.createEl("select", {
      cls: "canvas-ai-preset-select",
    });

    const presetActions = presetControls.createDiv("sidebar-preset-actions");

    this.presetManageBtn = presetActions.createEl("button", {
      cls: "canvas-ai-preset-manage-btn",
      text: this.tr("新增 / 编辑", "Add / Edit"),
    });

    this.presetDeleteBtn = presetActions.createEl("button", {
      cls: "canvas-ai-preset-delete-btn",
      text: this.tr("删除预设", "Delete Preset"),
    });

    const recentWrap = presetSection.createDiv("sidebar-recent-presets");
    const recentHeader = recentWrap.createDiv("sidebar-recent-presets-header");
    recentHeader.createDiv({
      cls: "sidebar-recent-presets-title",
      text: this.tr("最近预设", "Recent Presets"),
    });
    this.viewAllPresetsBtn = recentHeader.createEl("button", {
      cls: "sidebar-view-all-presets-btn",
      text: this.tr("查看更多", "View All"),
    });
    this.recentPresetsListEl = recentWrap.createDiv(
      "sidebar-recent-presets-list",
    );

    const paramsSection = zone1.createDiv("sidebar-params-section");
    paramsSection.createDiv({
      cls: "sidebar-section-title",
      text: this.tr("参数设置", "Parameters"),
    });
    paramsSection.createDiv({
      cls: "sidebar-section-subtitle",
      text: this.tr(
        "模型 / 分辨率 / 长宽比",
        "Model / Resolution / Aspect Ratio",
      ),
    });

    const optionsRow = paramsSection.createDiv("canvas-ai-image-options");

    const modelGroup = optionsRow.createDiv("canvas-ai-option-group");
    modelGroup.createEl("label", { text: this.tr("模型", "Model") });
    this.imageModelSelect = modelGroup.createEl("select", {
      cls: "canvas-ai-image-model-select",
    });

    const resolutionGroup = optionsRow.createDiv("canvas-ai-option-group");
    resolutionGroup.createEl("label", {
      text: this.tr("分辨率", "Resolution"),
    });
    this.resolutionSelect = resolutionGroup.createEl("select");
    ["1K", "2K", "4K"].forEach((v) => {
      this.resolutionSelect.createEl("option", { value: v, text: v });
    });

    const aspectGroup = optionsRow.createDiv("canvas-ai-option-group");
    aspectGroup.createEl("label", { text: this.tr("长宽比", "Aspect Ratio") });
    this.aspectRatioSelect = aspectGroup.createEl("select");
    ["1:1", "16:9", "9:16", "4:3", "3:4"].forEach((v) => {
      this.aspectRatioSelect.createEl("option", { value: v, text: v });
    });

    const countGroup = optionsRow.createDiv("canvas-ai-option-group");
    countGroup.createEl("label", { text: this.tr("张数", "Count") });
    this.imageCountSelect = countGroup.createEl("select");
    Array.from({ length: 9 }, (_, i) => i + 1).forEach((n) => {
      this.imageCountSelect.createEl("option", {
        value: String(n),
        text: String(n),
      });
    });

    const zone2 = footer.createDiv("sidebar-zone-2");
    const zone2Header = zone2.createDiv("sidebar-zone-2-header");
    zone2Header.createDiv({
      cls: "sidebar-section-title",
      text: this.tr("自定义输入", "Custom Input"),
    });

    const zone2Actions = zone2Header.createDiv("sidebar-zone-2-actions");
    const img2imgSwitchWrap = zone2Actions.createDiv(
      "sidebar-img2img-switch-wrap",
    );
    img2imgSwitchWrap.createDiv({
      cls: "sidebar-img2img-switch-label",
      text: this.tr("图生图", "Image-to-Image"),
    });
    this.imageToImageToggleBtn = img2imgSwitchWrap.createEl("button", {
      cls: "sidebar-img2img-switch",
      attr: {
        type: "button",
        "aria-label": this.tr("图生图开关", "Image-to-Image Switch"),
        "aria-pressed": "false",
      },
    });
    this.imageToImageToggleBtn.createSpan({
      cls: "sidebar-img2img-switch-knob",
    });
    this.imageToImageStateEl = img2imgSwitchWrap.createDiv({
      cls: "sidebar-img2img-switch-state",
      text: this.tr("关", "Off"),
    });

    const hintWrap = zone2Actions.createDiv("sidebar-hint-wrap");
    const hintBtn = hintWrap.createEl("button", {
      cls: "sidebar-hint-btn",
      attr: { "aria-label": this.tr("使用提示", "Usage Tip"), type: "button" },
    });
    setIcon(hintBtn, "info");
    hintWrap.createDiv({
      cls: "sidebar-hint-tooltip",
      text: this.tr(
        "输入需求后点击生成；从候选图中选择并插入到笔记。可用 @current_note 自动引用当前笔记内容。",
        "Enter prompt and click Generate; then choose a candidate and insert into note. Use @current_note to inject current note context.",
      ),
    });

    this.generationStatusEl = zone2Header.createDiv({
      cls: "sidebar-generation-status is-idle",
      text: "",
    });

    const modeRow = zone2.createDiv("sidebar-zone-2-mode-row");

    this.imageToImagePanelEl = modeRow.createDiv(
      "sidebar-img2img-panel is-hidden",
    );
    this.imageToImageUploadBtn = this.imageToImagePanelEl.createEl("button", {
      cls: "sidebar-img2img-upload-btn",
      text: this.tr("参考图", "Reference"),
      attr: { type: "button" },
    });
    this.imageToImagePreviewWrapEl = this.imageToImagePanelEl.createDiv({
      cls: "sidebar-img2img-preview-wrap",
    });
    this.imageToImagePreviewEl = this.imageToImagePreviewWrapEl.createEl(
      "img",
      {
        cls: "sidebar-img2img-preview",
        attr: { alt: this.tr("参考图预览", "Reference Preview") },
      },
    );
    this.imageToImageFileNameEl = this.imageToImagePreviewWrapEl.createDiv({
      cls: "sidebar-img2img-file-name",
      text: this.tr("未选择图片", "No image selected"),
    });
    this.imageToImageClearBtn = this.imageToImagePanelEl.createEl("button", {
      cls: "sidebar-img2img-clear-btn",
      text: this.tr("清空", "Clear"),
      attr: { type: "button" },
    });
    this.imageToImageFileInput = this.imageToImagePanelEl.createEl("input", {
      cls: "sidebar-img2img-file-input",
      attr: { type: "file", accept: "image/*" },
    });

    const inputRow = zone2.createDiv("sidebar-zone-2-row");

    this.inputEl = inputRow.createEl("textarea", {
      cls: "canvas-ai-prompt-input sidebar-horizontal-input",
      attr: {
        placeholder: this.tr(
          "输入你要生成的图片描述（可结合预设，支持 @current_note）",
          "Describe the image you want to generate (optional with preset, supports @current_note)",
        ),
        rows: "3",
      },
    });

    const actionCol = inputRow.createDiv("sidebar-zone-2-action-col");

    this.optimizePromptBtn = actionCol.createEl("button", {
      cls: "canvas-ai-optimize-btn sidebar-horizontal-optimize-btn",
      text: this.tr("优化", "Optimize"),
      attr: { type: "button" },
    });

    this.generateBtn = actionCol.createEl("button", {
      cls: "canvas-ai-generate-btn sidebar-horizontal-generate-btn",
      text: this.tr("生成", "Generate"),
    });

    this.cancelBtn = actionCol.createEl("button", {
      cls: "canvas-ai-cancel-btn sidebar-horizontal-cancel-btn",
      text: this.tr("取消", "Cancel"),
    });

    this.messagesContainer = container.createDiv(
      "sidebar-image-log sidebar-image-log-hidden",
    );

    this.setupEvents();
    this.renderCandidateList();
  }

  private setupEvents(): void {
    this.presetSelect.addEventListener("change", () => {
      const selectedId = this.presetSelect.value;
      this.presetDeleteBtn.disabled = !selectedId;

      const selected = this.imagePresets.find((p) => p.id === selectedId);
      if (selected) {
        this.setInputPromptValue(selected.prompt || "", {
          persist: false,
          updateState: false,
        });
      }
      this.renderRecentPresets();
      this.queuePersistSidebarState();
      this.updateGenerateButtonState();
    });

    this.presetManageBtn.addEventListener("click", () => {
      this.openPresetEditor();
    });

    this.viewAllPresetsBtn.addEventListener("click", () => {
      this.openPresetBrowser();
    });

    this.presetDeleteBtn.addEventListener("click", () => {
      void this.handleDeletePreset();
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

    this.imageCountSelect.addEventListener("change", () => {
      const count = Number.parseInt(this.imageCountSelect.value, 10);
      this.plugin.settings.defaultImageCount =
        Number.isFinite(count) && count >= 1 && count <= 9 ? count : 4;
      void this.plugin.saveSettings();
    });

    this.generateBtn.addEventListener("click", () => {
      void this.handleGenerate();
    });

    this.inputEl.addEventListener("input", () => {
      const normalized = this.normalizeCurrentNoteShortcut(this.inputEl.value);
      if (normalized !== this.inputEl.value) {
        const cursor = this.inputEl.selectionStart ?? this.inputEl.value.length;
        this.inputEl.value = normalized;
        const nextCursor = Math.min(
          cursor + ("@current_note".length - 1),
          normalized.length,
        );
        this.inputEl.setSelectionRange(nextCursor, nextCursor);
      }
      this.enforceReferenceLineLock();
      this.autoResizePromptInput();
      this.queuePersistSidebarState();
      this.updateGenerateButtonState();
    });

    this.cancelBtn.addEventListener("click", () => {
      this.cancelCurrentGeneration();
    });

    this.optimizePromptBtn.addEventListener("click", () => {
      this.handleOptimizePrompt();
    });

    this.imageToImageToggleBtn.addEventListener("click", () => {
      this.setImageToImageMode(!this.isImageToImageEnabled);
    });

    this.imageToImageUploadBtn.addEventListener("click", (event) => {
      this.openAddReferenceMenu(event);
    });

    this.imageToImageFileInput.addEventListener("change", () => {
      void this.handleReferenceImageFileChange();
    });

    this.imageToImageClearBtn.addEventListener("click", () => {
      this.clearAllReferenceImages();
    });

    this.imageToImagePreviewWrapEl.addEventListener("click", () => {
      if (this.referencePreviewObjectUrl && this.uploadedReferenceImage) {
        const modal = new ReferenceImagePreviewModal(
          this.app,
          this.referencePreviewObjectUrl,
          this.uploadedReferenceImage.fileName,
        );
        modal.open();
        return;
      }
      if (!this.imageToImageUploadBtn.disabled) {
        this.imageToImageFileInput.value = "";
        this.imageToImageFileInput.click();
      }
    });

    this.imageToImagePreviewWrapEl.addEventListener("dragover", (event) => {
      if (!this.canAcceptReferenceImageDrop()) return;
      event.preventDefault();
      this.imageToImagePreviewWrapEl.addClass("is-drag-over");
    });

    this.imageToImagePreviewWrapEl.addEventListener("dragleave", (event) => {
      if (!this.canAcceptReferenceImageDrop()) return;
      const nextTarget = event.relatedTarget as Node | null;
      if (nextTarget && this.imageToImagePreviewWrapEl.contains(nextTarget)) {
        return;
      }
      this.imageToImagePreviewWrapEl.removeClass("is-drag-over");
    });

    this.imageToImagePreviewWrapEl.addEventListener("drop", (event) => {
      if (!this.canAcceptReferenceImageDrop()) return;
      event.preventDefault();
      this.imageToImagePreviewWrapEl.removeClass("is-drag-over");
      const droppedFile = event.dataTransfer?.files?.[0];
      if (!droppedFile) return;
      void this.processReferenceImageFile(droppedFile);
    });
  }

  private initFromSettings(): void {
    this.imagePresets = [...(this.plugin.settings.imagePresets || [])];
    const supportedProviders = new Set([
      "openrouter",
      "openai",
      "zenmux",
      "gemini",
    ]);
    this.quickSwitchImageModels = [
      ...(this.plugin.settings.quickSwitchImageModels || []),
    ].filter((m) => supportedProviders.has(String(m.provider || "")));

    if (
      this.quickSwitchImageModels.length !==
      (this.plugin.settings.quickSwitchImageModels || []).length
    ) {
      this.plugin.settings.quickSwitchImageModels = [
        ...this.quickSwitchImageModels,
      ];
      void this.plugin.saveSettings();
    }

    const rawSelectedModel = this.plugin.settings.paletteImageModel || "";
    const selectedModelProvider = rawSelectedModel.split("|")[0] || "";
    this.selectedImageModel = supportedProviders.has(selectedModelProvider)
      ? rawSelectedModel
      : "";

    if (rawSelectedModel !== this.selectedImageModel) {
      this.plugin.settings.paletteImageModel = this.selectedImageModel;
      void this.plugin.saveSettings();
    }

    this.rebuildPresetSelect();
    this.rebuildImageModelSelect();

    this.resolutionSelect.value =
      this.plugin.settings.defaultResolution || "1K";
    this.aspectRatioSelect.value =
      this.plugin.settings.defaultAspectRatio || "1:1";

    const savedCount = this.plugin.settings.defaultImageCount || 4;
    const safeCount = Math.min(9, Math.max(1, savedCount));
    this.imageCountSelect.value = String(safeCount);
    this.plugin.settings.defaultImageCount = safeCount;

    const savedPresetId = this.plugin.settings.sidebarSelectedPresetId || "";
    if (
      savedPresetId &&
      this.imagePresets.some((p) => p.id === savedPresetId)
    ) {
      this.presetSelect.value = savedPresetId;
      this.presetDeleteBtn.disabled = false;
    } else {
      this.presetSelect.value = "";
      this.presetDeleteBtn.disabled = true;
    }
    this.renderRecentPresets();

    this.setInputPromptValue(this.plugin.settings.sidebarDraftPrompt || "", {
      persist: false,
      updateState: false,
    });
    // 不要在设置刷新时强制关闭图生图，避免输入时被意外重置。
    this.updateImageToImageControls();

    this.updateGenerateButtonState();
  }

  private renderRecentPresets(): void {
    if (!this.recentPresetsListEl) return;
    this.recentPresetsListEl.empty();

    if (this.imagePresets.length === 0) {
      this.recentPresetsListEl.createDiv({
        cls: "sidebar-recent-presets-empty",
        text: this.tr("暂无预设", "No presets yet"),
      });
      return;
    }

    const selectedId = this.presetSelect?.value || "";
    const recentPresets = [...this.imagePresets].slice(-6).reverse();
    recentPresets.forEach((preset, index) => {
      const item = this.recentPresetsListEl.createEl("button", {
        cls: "sidebar-recent-preset-item",
        text: preset.name,
      });
      if (preset.id === selectedId) {
        item.addClass("is-active");
      }

      if (index === 0) {
        item.addClass("is-latest");
        item.setAttribute("title", this.tr("最近添加", "Recently added"));
      }

      item.addEventListener("click", () => {
        this.presetSelect.value = preset.id;
        this.presetDeleteBtn.disabled = false;
        this.setInputPromptValue(preset.prompt || "", {
          persist: false,
          updateState: false,
        });
        this.renderRecentPresets();
        this.queuePersistSidebarState();
        this.updateGenerateButtonState();
      });
    });
  }

  private rebuildPresetSelect(selectedId: string = ""): void {
    this.presetSelect.empty();

    this.presetSelect.createEl("option", {
      value: "",
      text: this.tr("选择预设（可选）", "Select preset (optional)"),
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

    if (this.presetDeleteBtn) {
      this.presetDeleteBtn.disabled = !this.presetSelect.value;
    }

    this.renderRecentPresets();
  }

  private rebuildImageModelSelect(): void {
    this.imageModelSelect.empty();

    this.imageModelSelect.createEl("option", {
      value: "",
      text: this.tr("使用默认模型", "Use default model"),
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

  private openPresetBrowser(): void {
    const modal = new PresetBrowserModal(
      this.app,
      this.imagePresets,
      (preset) => {
        this.presetSelect.value = preset.id;
        this.presetDeleteBtn.disabled = false;
        this.setInputPromptValue(preset.prompt || "", {
          persist: false,
          updateState: false,
        });
        this.queuePersistSidebarState();
        this.updateGenerateButtonState();
      },
    );
    modal.open();
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
        this.setInputPromptValue(prompt, {
          persist: false,
          updateState: false,
        });
        this.plugin.settings.sidebarSelectedPresetId = idToSelect;
        this.plugin.settings.sidebarDraftPrompt = this.inputEl.value;
        await this.plugin.saveSettings();
        this.updateGenerateButtonState();
        new Notice(this.tr("预设已保存", "Preset saved"));
      },
    );

    modal.open();
  }

  private async handleDeletePreset(): Promise<void> {
    const selectedId = this.presetSelect?.value || "";
    if (!selectedId) {
      new Notice(this.tr("请先选择一个预设", "Please select a preset first"));
      return;
    }

    const target = this.imagePresets.find((p) => p.id === selectedId);
    if (!target) {
      new Notice(this.tr("未找到预设", "Preset not found"));
      return;
    }

    const ok = window.confirm(
      this.tr(
        `确定删除预设「${target.name}」吗？`,
        `Delete preset "${target.name}"?`,
      ),
    );
    if (!ok) return;

    this.imagePresets = this.imagePresets.filter((p) => p.id !== selectedId);
    this.plugin.settings.imagePresets = [...this.imagePresets];
    await this.plugin.saveSettings();

    this.rebuildPresetSelect("");
    this.setInputPromptValue("", { persist: false, updateState: false });
    this.plugin.settings.sidebarSelectedPresetId = "";
    this.plugin.settings.sidebarDraftPrompt = this.inputEl.value;
    await this.plugin.saveSettings();
    this.updateGenerateButtonState();
    new Notice(this.tr("预设已删除", "Preset deleted"));
  }

  private generatePresetId(): string {
    return `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }

  private autoResizePromptInput(): void {
    if (!this.inputEl) return;

    const minHeight = 120;
    const maxHeight = 360;

    this.inputEl.style.height = "auto";
    const next = Math.min(
      maxHeight,
      Math.max(minHeight, this.inputEl.scrollHeight),
    );
    this.inputEl.style.height = String(next) + "px";
    this.inputEl.style.overflowY =
      this.inputEl.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  private setImageToImageMode(enabled: boolean): void {
    this.isImageToImageEnabled = enabled;
    this.updateImageToImageControls();
    this.updateGenerateButtonState();
  }

  private updateImageToImageControls(): void {
    if (!this.imageToImageToggleBtn || !this.imageToImagePanelEl) return;

    this.imageToImageToggleBtn.toggleClass(
      "is-active",
      this.isImageToImageEnabled,
    );
    this.imageToImageToggleBtn.setAttr(
      "aria-pressed",
      this.isImageToImageEnabled ? "true" : "false",
    );
    if (this.imageToImageStateEl) {
      this.imageToImageStateEl.textContent = this.isImageToImageEnabled
        ? this.tr("开", "On")
        : this.tr("关", "Off");
      this.imageToImageStateEl.toggleClass(
        "is-active",
        this.isImageToImageEnabled,
      );
    }

    this.imageToImagePanelEl.toggleClass(
      "is-hidden",
      !this.isImageToImageEnabled,
    );

    const uploadedIsPrimary = this.isUploadedReferencePrimary();
    const fileName =
      this.getPrimaryReferenceName() ||
      this.tr("未选择图片", "No image selected");
    if (this.imageToImageFileNameEl) {
      this.imageToImageFileNameEl.textContent = fileName;
      this.imageToImageFileNameEl.toggleClass(
        "has-file",
        Boolean(this.getPrimaryReferenceName()),
      );
    }
    if (this.imageToImagePreviewWrapEl) {
      this.imageToImagePreviewWrapEl.toggleClass(
        "has-file",
        Boolean(
          uploadedIsPrimary &&
          this.uploadedReferenceImage &&
          this.referencePreviewObjectUrl,
        ),
      );
      this.imageToImagePreviewWrapEl.toggleClass(
        "is-disabled",
        this.imageToImageUploadBtn?.disabled ?? false,
      );
      this.imageToImagePreviewWrapEl.setAttr(
        "title",
        uploadedIsPrimary && this.uploadedReferenceImage
          ? this.tr(
              "点击查看大图，也可拖拽替换",
              "Click to preview, or drag to replace",
            )
          : this.tr(
              "点击或拖拽上传参考图",
              "Click or drag to upload a reference image",
            ),
      );
    }

    if (this.imageToImageClearBtn) {
      this.imageToImageClearBtn.disabled =
        !this.uploadedReferenceImage &&
        this.selectedReferenceImages.length === 0;
    }
  }

  private async handleReferenceImageFileChange(): Promise<void> {
    const file = this.imageToImageFileInput?.files?.[0];
    if (!file) return;
    await this.processReferenceImageFile(file);
  }

  private canAcceptReferenceImageDrop(): boolean {
    return Boolean(
      this.isImageToImageEnabled &&
      this.imageToImagePanelEl &&
      !this.imageToImagePanelEl.hasClass("is-hidden") &&
      !this.imageToImageUploadBtn?.disabled,
    );
  }

  private async processReferenceImageFile(file: File): Promise<void> {
    if (!this.isImageFile(file)) {
      new Notice(this.tr("仅支持图片文件", "Only image files are supported"));
      return;
    }

    try {
      const dataUrl = await this.readFileAsDataUrl(file);
      const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
      if (!match) {
        throw new Error("invalid_image_data");
      }

      this.uploadedReferenceImage = {
        base64: match[2],
        mimeType: match[1] || file.type || "image/png",
        role: "reference",
        fileName: file.name,
      };
      this.primaryReferenceSource = "uploaded";
      this.setReferencePreviewObjectUrl(URL.createObjectURL(file));
      this.syncReferenceImageNameToPrompt(this.getPrimaryReferenceName());
      this.updateImageToImageControls();
      this.updateGenerateButtonState();
      new Notice(this.tr("已加载参考图", "Reference image loaded"));
    } catch (error) {
      console.error("Sidebar CoPilot: failed to read reference image", error);
      this.clearReferenceImage();
      this.updateGenerateButtonState();
      new Notice(
        this.tr(
          "参考图读取失败，请重试",
          "Failed to read reference image, please retry",
        ),
      );
    }
  }

  private isImageFile(file: File): boolean {
    if (file.type?.startsWith("image/")) return true;
    return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name || "");
  }

  private clearReferenceImage(): void {
    const shouldFallbackToNote =
      this.primaryReferenceSource === "uploaded" &&
      this.selectedReferenceImages.length > 0;
    this.uploadedReferenceImage = null;
    this.imageToImageFileInput.value = "";
    this.primaryReferenceSource = shouldFallbackToNote ? "note" : null;
    this.setReferencePreviewObjectUrl(null);
    this.syncReferenceImageNameToPrompt(this.getPrimaryReferenceName());
    this.updateImageToImageControls();
    this.updateGenerateButtonState();
  }

  private clearAllReferenceImages(): void {
    this.selectedReferenceImages = [];
    this.primaryReferenceSource = null;
    this.clearReferenceImage();
  }

  private async openNoteImagePicker(): Promise<void> {
    const options = await this.collectCurrentNoteImageOptions();
    const preselected = new Set(
      this.selectedReferenceImages
        .map((item) => item.sourcePath || "")
        .filter((v) => Boolean(v)),
    );

    const modal = new NoteImagePickerModal(
      this.app,
      options,
      preselected,
      (paths) => {
        void this.applySelectedNoteImages(paths);
      },
    );
    modal.open();
  }

  private openAddReferenceMenu(event: MouseEvent): void {
    if (!this.isImageToImageEnabled) {
      this.setImageToImageMode(true);
    }

    const menu = new Menu();
    menu.addItem((item) => {
      item
        .setTitle(this.tr("从本地上传", "Upload from Local"))
        .setIcon("upload")
        .onClick(() => {
          this.imageToImageFileInput.value = "";
          this.imageToImageFileInput.click();
        });
    });
    menu.addItem((item) => {
      item
        .setTitle(this.tr("从当前笔记选择", "Select from Current Note"))
        .setIcon("image-file")
        .onClick(() => {
          void this.openNoteImagePicker();
        });
    });
    menu.showAtMouseEvent(event);
  }

  private getPrimaryReferenceName(): string | null {
    if (
      this.primaryReferenceSource === "note" &&
      this.selectedReferenceImages[0]?.fileName
    ) {
      return this.selectedReferenceImages[0].fileName;
    }
    if (
      this.primaryReferenceSource === "uploaded" &&
      this.uploadedReferenceImage?.fileName
    ) {
      return this.uploadedReferenceImage.fileName;
    }
    if (this.selectedReferenceImages[0]?.fileName) {
      return this.selectedReferenceImages[0].fileName;
    }
    if (this.uploadedReferenceImage?.fileName) {
      return this.uploadedReferenceImage.fileName;
    }
    return null;
  }

  private isUploadedReferencePrimary(): boolean {
    if (!this.uploadedReferenceImage) return false;
    if (this.primaryReferenceSource === "note") return false;
    return true;
  }

  private async applySelectedNoteImages(paths: string[]): Promise<void> {
    const next: SidebarInputImage[] = [];
    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      try {
        const data = await this.app.vault.readBinary(file);
        const bytes = new Uint8Array(data);
        const base64 = this.encodeBytesToBase64(bytes);
        next.push({
          base64,
          mimeType: this.getMimeTypeByFileName(file.name),
          role: "reference",
          fileName: file.name,
          sourcePath: file.path,
        });
      } catch (error) {
        console.warn("Sidebar CoPilot: failed to read note image", path, error);
      }
    }
    this.selectedReferenceImages = next;
    if (next.length > 0) {
      // 用户从笔记重新选图时，按“替换当前主参考图”处理，避免与上传图并存导致显示与提示词不一致。
      this.uploadedReferenceImage = null;
      this.imageToImageFileInput.value = "";
      this.setReferencePreviewObjectUrl(null);
      this.primaryReferenceSource = "note";
    } else if (!this.uploadedReferenceImage) {
      this.primaryReferenceSource = null;
    }
    this.syncReferenceImageNameToPrompt(this.getPrimaryReferenceName());
    this.updateImageToImageControls();
    this.updateGenerateButtonState();
    if (next.length > 0) {
      new Notice(
        this.tr(
          `已选择 ${next.length} 张参考图`,
          `${next.length} reference image(s) selected`,
        ),
      );
    }
  }

  private encodeBytesToBase64(bytes: Uint8Array): string {
    if (bytes.length === 0) return "";
    const chunkSize = 0x8000;
    const parts: string[] = [];
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      parts.push(String.fromCharCode(...chunk));
    }
    return btoa(parts.join(""));
  }

  private async collectCurrentNoteImageOptions(): Promise<NoteImageOption[]> {
    const file =
      this.app.workspace.getActiveFile() || this.capturedContext?.file;
    if (!file || file.extension !== "md") {
      new Notice(
        this.tr(
          "请先激活一个 Markdown 笔记",
          "Please activate a Markdown note first",
        ),
      );
      return [];
    }
    const content = await this.app.vault.read(file);
    const refs = this.extractImageRefsFromContent(content);
    const unique = new Set<string>();
    const results: NoteImageOption[] = [];

    for (const rawPath of refs) {
      const resolved = this.resolveCandidateImagePath(file.path, rawPath);
      if (!resolved || unique.has(resolved)) continue;
      const abstract = this.app.vault.getAbstractFileByPath(resolved);
      if (!(abstract instanceof TFile)) continue;
      unique.add(resolved);
      results.push({
        path: resolved,
        fileName: abstract.name,
        previewSrc: this.app.vault.getResourcePath(abstract),
      });
    }
    return results;
  }

  private extractImageRefsFromContent(content: string): string[] {
    const refs: string[] = [];
    const obsidianRegex = /!\[\[([^\]]+)\]\]/gi;
    const markdownRegex =
      /!\[[^\]]*]\(([^)]+\.(?:png|jpg|jpeg|gif|webp|svg|bmp)[^)]*)\)/gi;
    let match: RegExpExecArray | null = null;
    while ((match = obsidianRegex.exec(content)) !== null) {
      const cleaned = this.normalizeObsidianImageTarget(match[1] || "");
      if (cleaned) refs.push(cleaned);
    }
    while ((match = markdownRegex.exec(content)) !== null) {
      const cleaned = this.normalizeMarkdownImageTarget(match[1] || "");
      if (cleaned) refs.push(cleaned);
    }
    return refs;
  }

  private normalizeObsidianImageTarget(rawTarget: string): string {
    const trimmed = (rawTarget || "").trim();
    if (!trimmed) return "";
    const withoutAlias = trimmed.split("|")[0]?.trim() || "";
    const withoutAnchor = withoutAlias.split("#")[0]?.trim() || "";
    if (!/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(withoutAnchor)) return "";
    return withoutAnchor;
  }

  private normalizeMarkdownImageTarget(rawTarget: string): string {
    const trimmed = rawTarget.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("<") && trimmed.includes(">")) {
      return trimmed.slice(1, trimmed.indexOf(">")).trim();
    }
    return trimmed.split(/\s+/)[0] || "";
  }

  private resolveCandidateImagePath(
    notePath: string,
    rawPath: string,
  ): string | null {
    const normalized = rawPath.replace(/^\/+/, "").trim();

    const resolvedByLink = this.app.metadataCache.getFirstLinkpathDest(
      normalized,
      notePath,
    );
    if (resolvedByLink instanceof TFile) {
      return resolvedByLink.path;
    }

    if (this.app.vault.getAbstractFileByPath(normalized)) {
      return normalized;
    }
    const dir = notePath.includes("/")
      ? notePath.slice(0, notePath.lastIndexOf("/"))
      : "";
    const relative = dir ? `${dir}/${normalized}` : normalized;
    if (this.app.vault.getAbstractFileByPath(relative)) {
      return relative;
    }
    return null;
  }

  private getMimeTypeByFileName(fileName: string): string {
    const ext = (fileName.split(".").pop() || "").toLowerCase();
    if (ext === "png") return "image/png";
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "webp") return "image/webp";
    if (ext === "gif") return "image/gif";
    if (ext === "bmp") return "image/bmp";
    if (ext === "svg") return "image/svg+xml";
    return "image/png";
  }

  private syncReferenceImageNameToPrompt(fileName: string | null): void {
    if (!this.inputEl) return;
    const current = this.inputEl.value || "";
    const next = this.composePromptWithReferenceLine(current, fileName);
    if (next === current) return;
    this.inputEl.value = next;
    this.autoResizePromptInput();
    this.queuePersistSidebarState();
    this.updateGenerateButtonState();
  }

  private composePromptWithReferenceLine(
    prompt: string,
    fileName: string | null,
  ): string {
    const lines = (prompt || "").split("\n");
    const bodyLines = lines.filter(
      (line) => !line.trimStart().startsWith(this.referencePromptPrefix),
    );
    if (fileName) {
      return [`${this.referencePromptPrefix}${fileName}`, ...bodyLines].join(
        "\n",
      );
    }
    return bodyLines.join("\n");
  }

  private enforceReferenceLineLock(): void {
    if (!this.inputEl || !this.isImageToImageEnabled) return;
    const primaryRefName = this.getPrimaryReferenceName();
    if (!primaryRefName) return;

    const current = this.inputEl.value || "";
    const next = this.composePromptWithReferenceLine(current, primaryRefName);
    if (next === current) return;

    const cursor = this.inputEl.selectionStart ?? current.length;
    const firstLineBreak = current.indexOf("\n");
    const bodyOffset =
      firstLineBreak >= 0 && current.startsWith(this.referencePromptPrefix)
        ? Math.max(0, cursor - (firstLineBreak + 1))
        : cursor;

    this.inputEl.value = next;

    const nextBody = this.composePromptWithReferenceLine(next, null);
    const safeBodyOffset = Math.min(bodyOffset, nextBody.length);
    const prefixLen = `${this.referencePromptPrefix}${primaryRefName}`.length;
    const nextCursor =
      safeBodyOffset > 0 ? prefixLen + 1 + safeBodyOffset : prefixLen;
    this.inputEl.setSelectionRange(nextCursor, nextCursor);
  }

  private setReferencePreviewObjectUrl(nextUrl: string | null): void {
    if (this.referencePreviewObjectUrl) {
      URL.revokeObjectURL(this.referencePreviewObjectUrl);
    }
    this.referencePreviewObjectUrl = nextUrl;
    if (!this.imageToImagePreviewEl) return;
    if (nextUrl) {
      this.imageToImagePreviewEl.src = nextUrl;
      return;
    }
    this.imageToImagePreviewEl.removeAttribute("src");
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        if (!result) {
          reject(new Error("empty_file"));
          return;
        }
        resolve(result);
      };
      reader.onerror = () => reject(reader.error || new Error("read_failed"));
      reader.readAsDataURL(file);
    });
  }

  private queuePersistSidebarState(): void {
    if (this.promptSaveTimer !== null) {
      window.clearTimeout(this.promptSaveTimer);
    }

    this.promptSaveTimer = window.setTimeout(() => {
      this.plugin.settings.sidebarDraftPrompt = this.inputEl?.value || "";
      this.plugin.settings.sidebarSelectedPresetId =
        this.presetSelect?.value || "";
      void this.plugin.saveSettings();
      this.promptSaveTimer = null;
    }, 220);
  }

  private setInputPromptValue(
    rawPrompt: string,
    options?: { persist?: boolean; updateState?: boolean },
  ): void {
    if (!this.inputEl) return;
    const persist = options?.persist ?? true;
    const updateState = options?.updateState ?? true;

    let next = this.normalizeCurrentNoteShortcut(rawPrompt || "");
    if (this.isImageToImageEnabled) {
      const refName = this.getPrimaryReferenceName();
      if (refName) {
        next = this.composePromptWithReferenceLine(next, refName);
      }
    }

    this.inputEl.value = next;
    this.autoResizePromptInput();
    if (persist) this.queuePersistSidebarState();
    if (updateState) this.updateGenerateButtonState();
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

    const hasRunning = this.pendingTaskCount > 0;
    const explicitRefCount =
      (this.uploadedReferenceImage ? 1 : 0) +
      this.selectedReferenceImages.length;
    const imageRequiredMissing =
      this.isImageToImageEnabled && explicitRefCount === 0;
    const hasPrompt = Boolean(this.inputEl?.value.trim());
    this.generateBtn.disabled = hasRunning || imageRequiredMissing;
    this.cancelBtn.disabled = !hasRunning;
    this.cancelBtn.toggleClass("is-active", hasRunning);
    this.optimizePromptBtn.disabled = hasRunning || !hasPrompt;

    if (this.imageToImageToggleBtn) {
      this.imageToImageToggleBtn.disabled = hasRunning;
    }
    if (this.imageToImageUploadBtn) {
      this.imageToImageUploadBtn.disabled =
        hasRunning || !this.isImageToImageEnabled;
    }
    if (this.imageToImageFileInput) {
      this.imageToImageFileInput.disabled =
        hasRunning || !this.isImageToImageEnabled;
    }

    const readyCount = this.getReadyCandidateCount();
    this.insertAllBtn.disabled =
      readyCount === 0 || hasRunning || this.isBulkInserting;
    this.insertAllBtn.textContent =
      readyCount > 0
        ? this.tr("一键插入全部", "Insert All") + " (" + readyCount + ")"
        : this.tr("一键插入全部", "Insert All");

    const hasFailed = this.failedTasks.length > 0;
    this.retryFailedBtn.disabled =
      !hasFailed || hasRunning || this.isBulkInserting;
    this.retryFailedBtn.textContent = hasFailed
      ? this.tr("重试失败项", "Retry Failed") +
        " (" +
        this.failedTasks.length +
        ")"
      : this.tr("重试失败项", "Retry Failed");

    if (!hasRunning) {
      this.generateBtn.textContent = this.tr("生成", "Generate");
      this.generateBtn.removeClass("generating");
      if (this.generationStatusEl) {
        if (hasFailed) {
          this.generationStatusEl.textContent = this.tr(
            "有 " + this.failedTasks.length + " 项失败，可点击重试",
            this.failedTasks.length + " failed item(s). Click Retry Failed.",
          );
          this.generationStatusEl.removeClass("is-running");
          this.generationStatusEl.addClass("is-idle");
        } else if (imageRequiredMissing) {
          this.generationStatusEl.textContent = this.tr(
            "图生图已开启，请先上传或选择参考图",
            "Image-to-Image is on. Upload or select a reference image first.",
          );
          this.generationStatusEl.removeClass("is-running");
          this.generationStatusEl.addClass("is-idle");
        } else {
          this.generationStatusEl.textContent = "";
          this.generationStatusEl.removeClass("is-running");
          this.generationStatusEl.addClass("is-idle");
        }
      }
      return;
    }

    const total = this.activeRequestTotal || this.pendingTaskCount;
    const finished = Math.max(0, total - this.pendingTaskCount);
    this.generateBtn.textContent =
      this.tr("生成中", "Generating") + " " + finished + "/" + total;
    this.generateBtn.addClass("generating");

    if (this.generationStatusEl) {
      const running = Math.max(0, this.activeConcurrencyCount);
      this.generationStatusEl.textContent =
        this.tr("并发进行中", "Running") +
        " " +
        running +
        this.tr(" 路，剩余 ", " concurrent, remaining ") +
        this.pendingTaskCount +
        " / " +
        total;
      this.generationStatusEl.removeClass("is-idle");
      this.generationStatusEl.addClass("is-running");
    }
  }

  private hasCurrentNotePlaceholder(prompt: string): boolean {
    if (!prompt) return false;
    this.currentNoteShortcutPattern.lastIndex = 0;
    if (this.currentNoteShortcutPattern.test(prompt)) {
      this.currentNoteShortcutPattern.lastIndex = 0;
      return true;
    }
    this.currentNoteShortcutPattern.lastIndex = 0;
    this.currentNoteTokenPattern.lastIndex = 0;
    if (this.currentNoteTokenPattern.test(prompt)) {
      this.currentNoteTokenPattern.lastIndex = 0;
      return true;
    }
    this.currentNoteTokenPattern.lastIndex = 0;
    return this.currentNotePlaceholderTokens.some((token) =>
      prompt.includes(token),
    );
  }

  private getActiveMarkdownBasename(): string {
    const file =
      this.app.workspace.getActiveFile() || this.capturedContext?.file;
    if (!file || file.extension !== "md") return "";
    return file.basename || "";
  }

  private decorateCurrentNoteTokenWithName(prompt: string): string {
    if (!prompt) return prompt;
    const basename = this.getActiveMarkdownBasename();
    if (!basename) return prompt;

    let next = prompt;
    this.currentNoteTokenPattern.lastIndex = 0;
    next = next.replace(this.currentNoteTokenPattern, (match) => {
      if (/\([^)]+\)$/.test(match)) return match;
      return `@current_note(${basename})`;
    });
    this.currentNoteTokenPattern.lastIndex = 0;
    return next;
  }

  private normalizeCurrentNoteShortcut(prompt: string): string {
    if (!prompt) return prompt;
    const basename = this.getActiveMarkdownBasename();
    const replacement = basename
      ? `@current_note(${basename})`
      : "@current_note";
    this.currentNoteShortcutPattern.lastIndex = 0;
    const normalized = prompt.replace(
      this.currentNoteShortcutPattern,
      (_match, prefix: string) => `${prefix}${replacement}`,
    );
    return this.decorateCurrentNoteTokenWithName(normalized);
  }

  private stripMarkdownNoise(content: string): string {
    let next = content || "";
    next = next.replace(/^---\n[\s\S]*?\n---\n?/m, "");
    next = next.replace(/```[\s\S]*?```/g, " ");
    next = next.replace(/`[^`]*`/g, " ");
    return next;
  }

  private collapseSpaces(text: string): string {
    return text
      .replace(/\r/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  private summarizeNoteForPrompt(content: string): string {
    const cleaned = this.collapseSpaces(this.stripMarkdownNoise(content));
    if (!cleaned) return "";

    const lines = cleaned
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => Boolean(line));

    const ranked: string[] = [];
    const headings = lines
      .filter((line) => /^#{1,4}\s+/.test(line))
      .slice(0, 8)
      .map((line) => line.replace(/^#{1,4}\s+/, ""));
    const bullets = lines
      .filter((line) => /^([-*]|\d+\.)\s+/.test(line))
      .slice(0, 12)
      .map((line) => line.replace(/^([-*]|\d+\.)\s+/, ""));
    const paragraphs = lines
      .filter(
        (line) => !/^#{1,4}\s+/.test(line) && !/^([-*]|\d+\.)\s+/.test(line),
      )
      .slice(0, 12);

    if (headings.length > 0) {
      ranked.push(this.tr("标题与章节：", "Headings and sections:"));
      headings.forEach((item) => ranked.push(`- ${item}`));
    }
    if (bullets.length > 0) {
      ranked.push(this.tr("关键要点：", "Key points:"));
      bullets.forEach((item) => ranked.push(`- ${item}`));
    }
    if (paragraphs.length > 0) {
      ranked.push(this.tr("正文摘要：", "Body summary:"));
      paragraphs.forEach((item) => ranked.push(`- ${item}`));
    }

    const merged = ranked.join("\n").trim() || cleaned.slice(0, 2000);
    const maxChars = 3200;
    if (merged.length <= maxChars) return merged;
    return `${merged.slice(0, maxChars)}\n...`;
  }

  private async injectCurrentNoteContentIntoPrompt(
    prompt: string,
    context: NotesSelectionContext | null,
  ): Promise<CurrentNoteInjectionResult> {
    if (!this.hasCurrentNotePlaceholder(prompt)) {
      return { prompt, replaced: false };
    }

    const noteFile = context?.file || this.app.workspace.getActiveFile();
    if (!noteFile || noteFile.extension !== "md") {
      throw new Error(
        this.tr(
          "使用 @current_note 需要先打开一个 Markdown 笔记",
          "Using @current_note requires an active Markdown note",
        ),
      );
    }

    const raw = await this.app.vault.read(noteFile);
    const summary = this.summarizeNoteForPrompt(raw);
    if (!summary) {
      throw new Error(
        this.tr(
          "当前笔记内容为空，无法从 @current_note 注入上下文",
          "Current note is empty, unable to inject context from @current_note",
        ),
      );
    }

    const injectedBlock = [
      this.tr("[当前笔记上下文]", "[Current Note Context]"),
      `${this.tr("笔记名", "Note title")}: ${noteFile.basename}`,
      `${this.tr("路径", "Path")}: ${noteFile.path}`,
      this.tr(
        "以下是自动提取的笔记摘要，请基于它完成本次生图：",
        "Auto-extracted note summary for this generation:",
      ),
      summary,
    ].join("\n");

    let nextPrompt = prompt;
    this.currentNoteTokenPattern.lastIndex = 0;
    nextPrompt = nextPrompt.replace(
      this.currentNoteTokenPattern,
      injectedBlock,
    );
    this.currentNoteTokenPattern.lastIndex = 0;
    this.currentNotePlaceholderTokens.forEach((token) => {
      nextPrompt = nextPrompt.split(token).join(injectedBlock);
    });
    return { prompt: nextPrompt, replaced: true };
  }

  private async handleGenerate(): Promise<void> {
    if (this.pendingTaskCount > 0) return;

    const notesHandler = this.plugin.getNotesHandler();
    if (!notesHandler) {
      new Notice(this.tr("笔记处理器不可用", "Notes handler unavailable"));
      return;
    }

    let promptDraft = this.inputEl.value || "";
    const normalizedShortcut = this.normalizeCurrentNoteShortcut(promptDraft);
    if (normalizedShortcut !== promptDraft) {
      promptDraft = normalizedShortcut;
      this.inputEl.value = normalizedShortcut;
      this.autoResizePromptInput();
      this.queuePersistSidebarState();
    }

    const refreshedContext = notesHandler.captureSelectionForSidebar();
    if (refreshedContext) {
      this.capturedContext = refreshedContext;
    }

    const inputImages: SidebarInputImage[] = this.isImageToImageEnabled
      ? [
          ...(this.uploadedReferenceImage ? [this.uploadedReferenceImage] : []),
          ...this.selectedReferenceImages,
        ]
      : [];

    if (this.isImageToImageEnabled && inputImages.length === 0) {
      new Notice(
        this.tr(
          "请先上传或选择参考图，再进行图生图",
          "Please upload or select a reference image before Image-to-Image.",
        ),
      );
      return;
    }

    const primaryRefName = this.getPrimaryReferenceName();
    if (this.isImageToImageEnabled && primaryRefName) {
      const normalized = this.composePromptWithReferenceLine(
        promptDraft,
        primaryRefName,
      );
      if (normalized !== promptDraft) {
        promptDraft = normalized;
        this.inputEl.value = normalized;
        this.autoResizePromptInput();
        this.queuePersistSidebarState();
      }
    }

    let injected = promptDraft;
    try {
      const injectedResult = await this.injectCurrentNoteContentIntoPrompt(
        promptDraft,
        this.capturedContext,
      );
      injected = injectedResult.prompt;
      if (injectedResult.replaced) {
        new Notice(
          this.tr(
            "已自动读取当前笔记内容并注入生成上下文",
            "Current note content has been injected into generation context",
          ),
        );
      }
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : this.formatImageError(error);
      new Notice(msg);
      return;
    }

    const rawPrompt = injected.trim();
    if (!rawPrompt && !this.capturedContext?.selectedText?.trim()) {
      new Notice(t("Enter instructions"));
      return;
    }

    const selectedCount = Number.parseInt(this.imageCountSelect.value, 10);
    const requestCount =
      Number.isFinite(selectedCount) && selectedCount >= 1 && selectedCount <= 9
        ? selectedCount
        : Math.min(9, Math.max(1, this.plugin.settings.defaultImageCount || 4));

    if (
      rawPrompt.includes(this.pptAutoMarker) ||
      rawPrompt.includes(this.pptAutoLegacyMarker)
    ) {
      const pageCount = this.extractPptPageCountFromPrompt(rawPrompt);
      const tasks = this.buildPptAutoGenerationTasks(
        rawPrompt,
        this.capturedContext,
        pageCount,
        requestCount,
        inputImages,
      );
      if (tasks.length === 0) {
        new Notice(
          this.tr(
            "PPT 自动拆页任务为空，请检查提示词",
            "PPT auto-split tasks are empty. Please check the prompt.",
          ),
        );
        return;
      }
      new Notice(
        this.tr(
          `已按 ${pageCount} 页拆解；每页 ${requestCount} 张候选，共 ${tasks.length} 个任务`,
          `Split into ${pageCount} pages; ${requestCount} candidate(s) per page, ${tasks.length} tasks in total`,
        ),
      );
      this.failedTasks = [];
      this.startGenerationTasks(tasks);
      return;
    }

    const prompt =
      this.isImageToImageEnabled && inputImages.length > 0
        ? this.buildStrictImg2ImgPrompt(rawPrompt)
        : rawPrompt;

    this.failedTasks = [];
    this.startGenerationBatch(
      prompt,
      this.capturedContext,
      requestCount,
      inputImages,
    );
  }

  private handleOptimizePrompt(): void {
    const current = this.inputEl?.value || "";
    const lines = current.split("\n");
    const hasRefLine =
      lines.length > 0 &&
      lines[0].trimStart().startsWith(this.referencePromptPrefix);
    const body = (hasRefLine ? lines.slice(1) : lines).join("\n").trim();

    if (!body) {
      new Notice(
        this.tr(
          "请先输入需要优化的提示词",
          "Please enter a prompt to optimize",
        ),
      );
      return;
    }

    if (this.isPptRequest(body)) {
      const primaryRefName = this.getPrimaryReferenceName();
      const optimizedPpt = this.buildOptimizedPptPrompt(body);
      this.inputEl.value =
        this.isImageToImageEnabled && primaryRefName
          ? this.composePromptWithReferenceLine(optimizedPpt, primaryRefName)
          : optimizedPpt;
      new Notice(
        this.tr(
          "已生成 PPT 自动拆页提示词（生成时按页拆解）",
          "Generated PPT auto-split prompt (generation will split by pages)",
        ),
      );
      this.autoResizePromptInput();
      this.queuePersistSidebarState();
      this.updateGenerateButtonState();
      return;
    }

    const primaryRefName = this.getPrimaryReferenceName();
    if (this.isImageToImageEnabled && primaryRefName) {
      const optimized = this.buildOptimizedImg2ImgPrompt(body);
      const refLine = `${this.referencePromptPrefix}${primaryRefName}`;
      this.inputEl.value = `${refLine}\n${optimized}`;
      new Notice(
        this.tr(
          "已生成保真优先的图生图提示词",
          "Generated an Image-to-Image prompt optimized for fidelity",
        ),
      );
    } else {
      this.inputEl.value = this.buildOptimizedTextToImagePrompt(body);
      new Notice(
        this.tr(
          "已生成结构化文生图提示词",
          "Generated a structured Text-to-Image prompt",
        ),
      );
    }
    this.autoResizePromptInput();
    this.queuePersistSidebarState();
    this.updateGenerateButtonState();
  }

  private buildOptimizedImg2ImgPrompt(userPrompt: string): string {
    const text = userPrompt.replace(/\s+/g, " ").trim();
    const hasLensConflict = /(85mm|特写|close[- ]?up|人像特写)/i.test(text);
    const hasSceneConflict =
      /(黑暗虚空|纯黑背景|彻底更换背景|换场景|dark void)/i.test(text);
    const hasIdentityConflict =
      /(换人|更换人物|不同的人|remove glasses|无眼镜|摘掉眼镜)/i.test(text);

    const conflictTips: string[] = [];
    if (hasIdentityConflict) {
      conflictTips.push(
        this.tr(
          "人物身份相关冲突：保持同一人物身份，不替换人物。",
          "Identity conflict: keep the same person identity, do not replace the person.",
        ),
      );
    }
    if (hasLensConflict) {
      conflictTips.push(
        this.tr(
          "镜头构图冲突：优先保留参考图机位，镜头变化仅做轻微调整。",
          "Lens/composition conflict: keep original camera angle; only minor lens adjustment.",
        ),
      );
    }
    if (hasSceneConflict) {
      conflictTips.push(
        this.tr(
          "场景冲突：优先保留原背景结构，只做氛围强化。",
          "Scene conflict: preserve original background structure and only enhance atmosphere.",
        ),
      );
    }

    const conflictSection =
      conflictTips.length > 0
        ? `${this.tr("冲突修正：", "Conflict fixes:")}\n- ${conflictTips.join("\n- ")}\n\n`
        : "";

    return [
      this.tr(
        "【图生图优化版（保真优先）】",
        "[Image-to-Image Optimized | Fidelity First]",
      ),
      this.tr(
        "必须以上传参考图为唯一视觉来源。",
        "Use the uploaded reference image as the only visual source.",
      ),
      this.tr(
        "先保留：人物身份、脸部结构、姿态与主体位置关系。",
        "Preserve first: identity, facial structure, pose, and subject composition.",
      ),
      this.tr(
        "再调整：材质特效、局部细节、氛围与光影。",
        "Then adjust: materials/effects, local details, atmosphere, and lighting.",
      ),
      this.tr(
        "禁止：替换人物、彻底重构场景、与参考图主体无关的改造。",
        "Do not: replace person, fully rebuild scene, or make unrelated transformations.",
      ),
      "",
      conflictSection + this.tr("用户目标效果：", "Target effect:"),
      text,
    ]
      .join("\n")
      .trim();
  }

  private buildOptimizedTextToImagePrompt(userPrompt: string): string {
    const text = userPrompt.replace(/\s+/g, " ").trim();
    return [
      this.tr("【文生图优化版】", "[Text-to-Image Optimized]"),
      this.tr(
        "请生成一张高质量、细节丰富、构图明确的图像。",
        "Generate a high-quality image with rich detail and clear composition.",
      ),
      this.tr(
        "输出要求：主体清晰、背景与主体关系明确、光线与色彩统一、材质细节可见。",
        "Requirements: clear subject, coherent background relation, consistent lighting/colors, visible material details.",
      ),
      this.tr(
        "请避免无关元素和文字水印。",
        "Avoid irrelevant elements and text watermarks.",
      ),
      "",
      this.tr("用户需求：", "User request:"),
      text,
      "",
      this.tr("补充建议：", "Optional suggestions:"),
      this.tr(
        "- 明确镜头与景别（近景/中景/远景）",
        "- Specify lens and shot size (close/mid/long shot)",
      ),
      this.tr("- 明确光线方向与氛围", "- Specify lighting direction and mood"),
      this.tr(
        "- 明确风格关键词（写实/电影感/插画等）",
        "- Specify style keywords (realistic/cinematic/illustration etc.)",
      ),
    ].join("\n");
  }

  private isPptRequest(text: string): boolean {
    if (!text) return false;
    return /(ppt|幻灯|课件|演示文稿|投影片|简报)/i.test(text);
  }

  private buildOptimizedPptPrompt(userPrompt: string): string {
    const text = userPrompt.replace(/\s+/g, " ").trim();
    const pageCount = this.extractPptPageCountFromPrompt(text);
    const aspectRatio = this.extractPreferredAspectRatioFromPrompt(text);
    const withCurrentNote =
      this.hasCurrentNotePlaceholder(text) || text.includes("@current_note(")
        ? text
        : `@current_note\n${text}`;
    const hasStyleConstraints =
      /(风格|样式|背景|配色|颜色|字体|serif|sans|grid|布局|图表|质感|Claude|Anthropic|humanism|palette|typography|style)/i.test(
        text,
      );

    const styleSection = hasStyleConstraints
      ? [
          this.tr("【风格策略】", "[Style Strategy]"),
          this.tr(
            "严格沿用并执行用户提示词中已有的风格、配色、字体、排版与图表要求；不要覆盖或改写。",
            "Strictly follow the style, palette, typography, layout, and chart requirements already defined by the user; do not override or rewrite them.",
          ),
        ]
      : [
          this.tr(
            "【风格兜底（仅在未提供风格时生效）】",
            "[Style Fallback (only if user did not specify)]",
          ),
          "Warm academic humanism, 16:9 single-slide output, card-based clean grid, readable Chinese typography.",
        ];

    return [
      this.pptAutoMarker,
      this.tr(
        `【PPT 自动拆页模式】生成时将自动拆成 ${pageCount} 页任务；参数“张数”=每页候选数。`,
        `[PPT Auto Split Mode] Generation will split into ${pageCount} page tasks; Image Count = candidates per page.`,
      ),
      this.tr(
        "请严格沿用用户提示词中的受众、语气、目标与内容要求，不要擅自改写定位。",
        "Strictly preserve the audience, tone, goals, and content requirements from the user prompt; do not rewrite positioning.",
      ),
      "",
      ...styleSection,
      this.tr("【通用质量约束】", "[General Quality Constraints]"),
      this.tr(
        `一页一图（建议比例 ${aspectRatio}，若用户另有要求则以用户提示词为准），不要多页拼接长图；信息密度按用户提示词执行，缺省时保持版面充实且可读性优先。`,
        `One slide per image (recommended ratio ${aspectRatio}, but user prompt takes priority), no multi-page long collage; follow user-defined information density, and keep slides content-rich and readable when unspecified.`,
      ),
      "",
      this.tr("【内容来源】", "[Content Source]"),
      withCurrentNote,
      "",
      this.tr("【页级拆分策略】", "[Page Split Strategy]"),
      this.tr(
        `按 ${pageCount} 页拆分并逐页生成：先抽取用户提示词中的章节/主题；若未明确章节，再使用通用结构兜底。`,
        `Split into ${pageCount} slides and generate page by page: first extract sections/topics from the user prompt; use generic fallback only when sections are missing.`,
      ),
    ].join("\n");
  }

  private extractPptPageCountFromPrompt(prompt: string): number {
    const text = (prompt || "").replace(/\s+/g, " ");
    const patterns: RegExp[] = [
      /(?:共|总计|总共|需要|生成|做|制作)\s*(\d{1,2})\s*页/i,
      /(\d{1,2})\s*页(?:\s*(?:ppt|幻灯|课件|演示文稿|投影片|简报))?/i,
      /(?:slides?|pages?)\s*[:：]?\s*(\d{1,2})/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (!m) continue;
      const value = Number.parseInt(m[1], 10);
      if (Number.isFinite(value) && value >= 1 && value <= 30) {
        return value;
      }
    }
    return 8;
  }

  private extractPreferredAspectRatioFromPrompt(prompt: string): string {
    const text = prompt || "";
    const match = text.match(/\b(1:1|16:9|9:16|4:3|3:4)\b/i);
    if (match?.[1]) return match[1];
    return (
      this.aspectRatioSelect?.value ||
      this.plugin.settings.defaultAspectRatio ||
      "16:9"
    );
  }

  private buildStrictImg2ImgPrompt(userPrompt: string): string {
    const withoutRefLine = this.composePromptWithReferenceLine(
      userPrompt,
      null,
    );
    const cleaned = withoutRefLine.replace(
      /\bimage[_-]?\d+\.(png|jpe?g|webp|gif|bmp)\b/gi,
      this.tr("上传参考图", "uploaded reference image"),
    );
    const guard = [
      this.tr("【图生图强约束】", "[Image-to-Image Hard Constraints]"),
      this.tr(
        "你只能以“本次上传的参考图”作为唯一视觉参考来源。",
        'Use the "uploaded reference image in this task" as the only visual reference source.',
      ),
      this.tr(
        "忽略提示词中提到的其他图片文件名、历史图片或外部图片描述。",
        "Ignore any other image filenames, historical images, or external image descriptions in the prompt.",
      ),
      this.tr(
        "必须严格保留上传参考图的主体身份、构图关系与关键视觉特征，再按用户要求做风格/细节变化。",
        "Strictly preserve identity, composition, and key visual features from the uploaded reference before applying style/detail changes.",
      ),
      this.tr(
        "不要替换为其他人物或其他参考来源。",
        "Do not replace with other people or reference sources.",
      ),
    ].join("\n");
    return `${guard}\n\n${this.tr("用户需求：", "User request:")}\n${cleaned}`;
  }

  private startGenerationBatch(
    prompt: string,
    context: NotesSelectionContext | null,
    requestCount: number,
    inputImages: SidebarInputImage[] = [],
  ): void {
    const tasks: GenerationQueueTask[] = Array.from(
      { length: requestCount },
      (_, i) => ({
        prompt,
        context,
        sequence: i + 1,
        inputImages: [...inputImages],
      }),
    );
    this.startGenerationTasks(tasks);
  }

  private startGenerationTasks(tasks: GenerationQueueTask[]): void {
    if (tasks.length === 0) return;
    this.currentSessionId += 1;
    const sessionId = this.currentSessionId;
    const sequencedTasks = tasks.map((task, index) => ({
      ...task,
      sequence: index + 1,
    }));

    this.activeRequestTotal = sequencedTasks.length;
    this.activeConcurrencyCount = 0;
    this.pendingTaskCount = sequencedTasks.length;
    this.prepareTaskPlaceholders(sessionId, sequencedTasks);
    this.updateGenerateButtonState();
    this.runGenerationQueue(sessionId, sequencedTasks);
  }

  private prepareTaskPlaceholders(
    sessionId: number,
    tasks: GenerationQueueTask[],
  ): void {
    // 每次新一轮生成默认清空旧候选，避免混入历史结果造成误解。
    this.imageCandidates = tasks.map((task, i) => ({
      taskId: `pending-${sessionId}-${task.sequence || i + 1}`,
      fileName: this.tr("生成中...", "Generating..."),
      filePath: "",
      notePath:
        task.context?.file?.path ||
        this.app.workspace.getActiveFile()?.path ||
        "",
      createdAt: Date.now(),
      imageDataUrl: "",
      status: "pending" as const,
      sessionId,
      sequence: task.sequence || i + 1,
      sourcePrompt: task.prompt,
      sourceContext: task.context,
      sourceInputImages: [...task.inputImages],
    }));
    this.renderCandidateList();
  }

  private buildPptAutoGenerationTasks(
    prompt: string,
    context: NotesSelectionContext | null,
    pageCount: number,
    perPageCandidates: number,
    inputImages: SidebarInputImage[] = [],
  ): GenerationQueueTask[] {
    const safePageCount = Math.min(30, Math.max(1, pageCount));
    const safePerPage = Math.min(9, Math.max(1, perPageCandidates));
    const totalTasks = safePageCount * safePerPage;
    const fallbackPages: string[] = Array.from(
      { length: safePageCount },
      (_, i) => this.getFallbackPptPageTitle(i),
    );
    const rawBasePrompt = prompt
      .split("\n")
      .filter(
        (line) =>
          !line.includes(this.pptAutoMarker) &&
          !line.includes(this.pptAutoLegacyMarker),
      )
      .join("\n")
      .trim();
    const basePrompt = this.compactPptPromptForTaskCount(
      rawBasePrompt,
      totalTasks,
    );
    const pages = this.extractPptPageTitlesFromPrompt(
      basePrompt,
      fallbackPages,
      safePageCount,
    );
    const tasks: GenerationQueueTask[] = [];

    pages.forEach((pageTitle, pageIndex) => {
      for (let variant = 1; variant <= safePerPage; variant++) {
        const pagePrompt = [
          basePrompt,
          "",
          this.tr("【当前仅生成这一页】", "[Generate This Page Only]"),
          `${this.tr("页码", "Page")}: ${pageIndex + 1}/${pages.length}`,
          `${this.tr("页面标题", "Slide title")}: ${pageTitle}`,
          this.tr(
            "仅输出这一页的完整 PPT 画面，不要输出多页拼接图。",
            "Output only this single complete slide, not a multi-page collage.",
          ),
          `${this.tr("同页候选", "Variant")}: ${variant}/${safePerPage}`,
          this.tr(
            "同页候选之间可做版式/构图/插图细节差异，但保持主题和风格一致。",
            "Variants can differ in layout/composition/illustration details while keeping theme and style consistent.",
          ),
        ].join("\n");
        tasks.push({
          prompt: pagePrompt,
          context,
          sequence: tasks.length + 1,
          inputImages: [...inputImages],
        });
      }
    });

    return tasks;
  }

  private compactPptPromptForTaskCount(
    prompt: string,
    totalTasks: number,
  ): string {
    const trimmed = (prompt || "").trim();
    if (!trimmed) return trimmed;

    // 任务越多，基础提示词应越精简，避免重复传输同一大段上下文导致慢和贵。
    const maxChars =
      totalTasks > 120
        ? 1800
        : totalTasks > 64
          ? 2400
          : totalTasks > 24
            ? 3200
            : 4600;
    if (trimmed.length <= maxChars) return trimmed;

    const keepHead = Math.floor(maxChars * 0.78);
    const keepTail = Math.max(180, maxChars - keepHead);
    return `${trimmed.slice(0, keepHead).trim()}\n...\n${trimmed
      .slice(Math.max(0, trimmed.length - keepTail))
      .trim()}`;
  }

  private extractPptPageTitlesFromPrompt(
    prompt: string,
    fallbackPages: string[],
    pageCount: number,
  ): string[] {
    const lines = (prompt || "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => Boolean(line));
    const found: string[] = [];
    const seen = new Set<string>();

    const explicitPatterns: RegExp[] = [
      /^(?:[-*]\s*)?第\s*(\d{1,2})\s*页\s*[:：\-\s]+(.+)$/i,
      /^(?:[-*]\s*)?(?:页|page|slide)\s*(\d{1,2})\s*[:：\-\s]+(.+)$/i,
    ];

    for (const line of lines) {
      let m: RegExpMatchArray | null = null;
      for (const pattern of explicitPatterns) {
        m = line.match(pattern);
        if (m) break;
      }
      if (!m) continue;
      const rawTitle = (m[2] || "").trim();
      const title = rawTitle
        .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      if (!title) continue;
      if (title.length > 80) continue;
      if (
        /^(ppt|slide|页面|页码|标题|全局风格|内容来源|页级|通用质量)/i.test(
          title,
        )
      ) {
        continue;
      }
      if (seen.has(title)) continue;
      seen.add(title);
      found.push(title);
      if (found.length >= pageCount) break;
    }

    if (found.length >= Math.min(4, pageCount)) {
      while (found.length < pageCount) {
        found.push(fallbackPages[found.length]);
      }
      return found.slice(0, pageCount);
    }
    return fallbackPages.slice(0, pageCount);
  }

  private getFallbackPptPageTitle(index: number): string {
    const defaults = [
      this.tr("封面", "Cover"),
      this.tr("这篇内容在讲什么", "What This Content Is About"),
      this.tr("核心概念拆解", "Core Concepts"),
      this.tr("流程图与主线", "Flow and Main Path"),
      this.tr("场景与命令对照", "Scenario-to-Command Mapping"),
      this.tr("关键对比", "Key Comparison"),
      this.tr("实操步骤", "Practical Steps"),
      this.tr("总结与行动", "Summary and Action"),
    ];
    if (index < defaults.length) return defaults[index];
    return this.tr(`扩展内容 ${index + 1}`, `Extended Topic ${index + 1}`);
  }

  private getGenerationConcurrency(taskCount: number): number {
    // 默认并发与张数一致；弱网自动降并发，提升稳定性。
    const requested = Math.min(9, Math.max(1, taskCount));
    const networkType = this.getEffectiveNetworkType();
    const online = navigator.onLine !== false;

    if (!online) return 1;
    if (networkType === "slow-2g") return Math.min(requested, 1);
    if (networkType === "2g") return Math.min(requested, 2);
    if (networkType === "3g") return Math.min(requested, 3);
    return requested;
  }

  private getEffectiveNetworkType():
    | "slow-2g"
    | "2g"
    | "3g"
    | "4g"
    | "unknown" {
    const connection = (
      navigator as Navigator & {
        connection?: { effectiveType?: string };
      }
    ).connection;
    const value = String(connection?.effectiveType || "").toLowerCase();
    if (
      value === "slow-2g" ||
      value === "2g" ||
      value === "3g" ||
      value === "4g"
    ) {
      return value;
    }
    return "unknown";
  }

  private getRetryCountByNetwork(): number {
    const networkType = this.getEffectiveNetworkType();
    if (navigator.onLine === false) return 0;
    if (networkType === "slow-2g" || networkType === "2g") return 3;
    if (networkType === "3g") return 2;
    return 1;
  }

  private getRetryDelayMs(retryIndex: number): number {
    const networkType = this.getEffectiveNetworkType();
    const base =
      networkType === "slow-2g" || networkType === "2g" ? 1800 : 1200;
    return Math.min(8000, base * 2 ** Math.max(0, retryIndex - 1));
  }

  private isRetryableErrorCode(code: ImageErrorCode): boolean {
    return code === "超时" || code === "网络异常" || code === "服务异常";
  }

  private sleepWithSessionCancel(ms: number, sessionId: number): Promise<void> {
    if (ms <= 0 || this.isSessionCanceled(sessionId)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => resolve(), ms);
      if (this.isSessionCanceled(sessionId)) {
        window.clearTimeout(timer);
        resolve();
      }
    });
  }

  private runGenerationQueue(
    sessionId: number,
    tasks: GenerationQueueTask[],
  ): void {
    if (tasks.length === 0) return;
    const concurrency = this.getGenerationConcurrency(tasks.length);
    if (concurrency < tasks.length) {
      new Notice(
        this.tr(
          `检测到网络较慢，并发已自动降为 ${concurrency} 路以提高稳定性`,
          `Slow network detected. Concurrency auto-reduced to ${concurrency} for better stability.`,
        ),
      );
    }
    let cursor = 0;
    let running = 0;

    const pump = (): void => {
      if (this.isSessionCanceled(sessionId)) return;

      while (running < concurrency && cursor < tasks.length) {
        const task = tasks[cursor++];
        running += 1;
        this.activeConcurrencyCount += 1;
        this.updateGenerateButtonState();
        void this.runOneGeneration(
          sessionId,
          task.prompt,
          task.context,
          task.sequence,
          task.inputImages,
        ).finally(() => {
          running = Math.max(0, running - 1);
          this.activeConcurrencyCount = Math.max(
            0,
            this.activeConcurrencyCount - 1,
          );
          this.updateGenerateButtonState();
          pump();
        });
      }
    };

    pump();
  }

  private async runOneGeneration(
    sessionId: number,
    prompt: string,
    context: NotesSelectionContext | null,
    sequence: number,
    inputImages: SidebarInputImage[] = [],
  ): Promise<void> {
    const notesHandler = this.plugin.getNotesHandler();
    if (!notesHandler) {
      this.pendingTaskCount = Math.max(0, this.pendingTaskCount - 1);
      this.updateGenerateButtonState();
      return;
    }

    try {
      const maxAttempts = 1 + this.getRetryCountByNetwork();
      let candidate: GeneratedImageCandidate | null = null;
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (this.isSessionCanceled(sessionId)) return;
        try {
          candidate = await notesHandler.handleImageGeneration(
            prompt,
            context,
            inputImages,
          );
          break;
        } catch (error) {
          lastError = error;
          const normalized = this.normalizeImageError(error);
          const canRetry =
            attempt < maxAttempts &&
            this.isRetryableErrorCode(normalized.code) &&
            !this.isSessionCanceled(sessionId);
          if (!canRetry) {
            break;
          }

          const delayMs = this.getRetryDelayMs(attempt);
          this.addMessage(
            "assistant",
            this.tr(
              `第 ${sequence} 张生成失败，${Math.round(delayMs / 1000)} 秒后自动重试（${attempt + 1}/${maxAttempts}）`,
              `Image #${sequence} failed, retrying in ${Math.round(delayMs / 1000)}s (${attempt + 1}/${maxAttempts})`,
            ),
          );
          await this.sleepWithSessionCancel(delayMs, sessionId);
        }
      }

      if (!candidate) {
        throw lastError || new Error("generation_failed");
      }

      if (this.isSessionCanceled(sessionId)) {
        await notesHandler
          .removeCandidateImageFile(candidate.filePath)
          .catch(() => undefined);
        return;
      }

      this.resolvePendingCandidate(
        sessionId,
        sequence,
        candidate,
        prompt,
        context,
        inputImages,
      );
      this.addMessage(
        "assistant",
        this.tr(
          "第 " + sequence + " 张图片已生成：" + candidate.fileName,
          `Image #${sequence} generated: ${candidate.fileName}`,
        ),
      );
    } catch (e) {
      if (!this.isSessionCanceled(sessionId)) {
        const msg = this.formatImageError(e);
        this.markPendingCandidateFailed(sessionId, sequence);
        this.addMessage("assistant", msg);
        this.failedTasks.push({
          id: "f-" + String(++this.failedTaskCounter),
          prompt,
          context,
          inputImages: [...inputImages],
          errorMessage: msg,
          createdAt: Date.now(),
        });
      }
    } finally {
      this.pendingTaskCount = Math.max(0, this.pendingTaskCount - 1);
      if (this.pendingTaskCount === 0) {
        const total = this.activeRequestTotal;
        this.activeRequestTotal = 0;
        this.activeConcurrencyCount = 0;
        const isCanceled = this.isSessionCanceled(sessionId);
        if (!isCanceled && total > 0) {
          const failedCount = this.failedTasks.length;
          const successCount = Math.max(0, total - failedCount);
          new Notice(
            this.tr(
              `已生成 ${successCount}/${total} 张，提示词已保留，可继续微调`,
              `Generated ${successCount}/${total}. Prompt has been kept for further tuning.`,
            ),
          );
        }
        this.canceledSessionIds.delete(sessionId);
      }
      this.updateGenerateButtonState();
    }
  }

  private normalizeImageError(rawError: unknown): {
    code: ImageErrorCode;
    message: string;
    suggestion: string;
  } {
    const source =
      rawError instanceof Error ? rawError.message : String(rawError || "");
    const text = source.toLowerCase();

    const timeoutHit =
      text.includes("timeout") ||
      text.includes("timed out") ||
      text.includes("超时");
    if (timeoutHit) {
      return {
        code: "超时",
        message: this.tr(
          "请求超时，请稍后重试。",
          "Request timed out. Please try again later.",
        ),
        suggestion: this.tr(
          "可降低分辨率或切换更快的模型。",
          "Try lowering resolution or using a faster model.",
        ),
      };
    }

    const quotaHit =
      text.includes("quota") ||
      text.includes("insufficient") ||
      text.includes("balance") ||
      text.includes("credit") ||
      text.includes("429") ||
      text.includes("余额");
    if (quotaHit) {
      return {
        code: "余额不足",
        message: this.tr(
          "账户额度或余额不足，无法继续生图。",
          "Insufficient account quota/balance. Unable to continue generation.",
        ),
        suggestion: this.tr(
          "请检查服务商余额、配额或账单状态。",
          "Please check provider balance, quota, or billing status.",
        ),
      };
    }

    const authHit =
      text.includes("unauthorized") ||
      text.includes("forbidden") ||
      text.includes("api key") ||
      text.includes("auth") ||
      text.includes("401") ||
      text.includes("403") ||
      text.includes("密钥");
    if (authHit) {
      return {
        code: "鉴权失败",
        message: this.tr(
          "API 鉴权失败，请检查密钥配置。",
          "API authentication failed. Please check key settings.",
        ),
        suggestion: this.tr(
          "确认 API Key、生图模型和 Provider 配置。",
          "Confirm API key, image model, and provider configuration.",
        ),
      };
    }

    const networkHit =
      text.includes("network") ||
      text.includes("fetch") ||
      text.includes("econn") ||
      text.includes("socket") ||
      text.includes("dns") ||
      text.includes("连接");
    if (networkHit) {
      return {
        code: "网络异常",
        message: this.tr(
          "网络连接异常，暂时无法访问生图服务。",
          "Network error. Unable to access image generation service.",
        ),
        suggestion: this.tr(
          "请检查网络、代理或稍后重试。",
          "Check network/proxy or retry later.",
        ),
      };
    }

    const apiHit =
      text.includes("500") ||
      text.includes("502") ||
      text.includes("503") ||
      text.includes("504") ||
      text.includes("bad gateway") ||
      text.includes("service unavailable") ||
      text.includes("invalid request") ||
      text.includes("provider");
    if (apiHit) {
      return {
        code: "服务异常",
        message: this.tr(
          "生图服务返回异常，请稍后重试。",
          "Image service returned an error. Please retry later.",
        ),
        suggestion: this.tr(
          "可切换模型或 Provider 再试。",
          "Try switching model or provider.",
        ),
      };
    }

    return {
      code: "未知错误",
      message: this.tr(
        "发生未知错误，当前任务未完成。",
        "Unknown error. Current task did not complete.",
      ),
      suggestion: this.tr(
        "可先重试失败项，或切换模型后再试。",
        "Retry failed items first, or switch model and retry.",
      ),
    };
  }

  private formatImageError(rawError: unknown): string {
    const normalized = this.normalizeImageError(rawError);
    const codeLabel = this.tr(
      normalized.code,
      {
        超时: "TIMEOUT",
        余额不足: "INSUFFICIENT_BALANCE",
        鉴权失败: "AUTH_FAILED",
        网络异常: "NETWORK_ERROR",
        服务异常: "SERVICE_ERROR",
        未知错误: "UNKNOWN_ERROR",
      }[normalized.code] || "UNKNOWN_ERROR",
    );
    return (
      this.tr("错误码[", "Error[") +
      codeLabel +
      "] " +
      normalized.message +
      this.tr(" 建议：", " Suggestion: ") +
      normalized.suggestion
    );
  }

  private isSessionCanceled(sessionId: number): boolean {
    return this.canceledSessionIds.has(sessionId);
  }

  private cancelCurrentGeneration(): void {
    if (this.pendingTaskCount <= 0) return;

    const notesHandler = this.plugin.getNotesHandler();
    notesHandler?.cancelImageTasks();

    const sessionId = this.currentSessionId;
    this.canceledSessionIds.add(sessionId);
    // 取消后立即移除当前会话的 pending 占位，避免“看起来还在生成”。
    this.imageCandidates = this.imageCandidates.filter(
      (candidate) =>
        !(candidate.sessionId === sessionId && candidate.status === "pending"),
    );
    this.renderCandidateList();
    this.activeConcurrencyCount = 0;
    this.pendingTaskCount = 0;
    this.activeRequestTotal = 0;
    this.updateGenerateButtonState();
    new Notice(this.tr("已取消生成任务", "Generation cancelled"));
  }

  private retryFailedTasks(): void {
    if (this.pendingTaskCount > 0 || this.failedTasks.length === 0) return;

    const tasksToRetry = [...this.failedTasks];
    this.failedTasks = [];

    const queueTasks: GenerationQueueTask[] = tasksToRetry.map(
      (task, index) => ({
        prompt: task.prompt,
        context: task.context,
        sequence: index + 1,
        inputImages: [...task.inputImages],
      }),
    );
    this.startGenerationTasks(queueTasks);
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

  private getReadyCandidateCount(): number {
    return this.imageCandidates.filter((c) => c.status === "ready").length;
  }

  private addCandidate(
    candidate: GeneratedImageCandidate,
    prompt: string,
    context: NotesSelectionContext | null,
    inputImages: SidebarInputImage[] = [],
  ): void {
    this.imageCandidates.unshift({
      ...candidate,
      status: "ready",
      sessionId: this.currentSessionId,
      sequence: 0,
      sourcePrompt: prompt,
      sourceContext: context,
      sourceInputImages: [...inputImages],
    });
    this.renderCandidateList();
  }

  private resolvePendingCandidate(
    sessionId: number,
    sequence: number,
    candidate: GeneratedImageCandidate,
    prompt: string,
    context: NotesSelectionContext | null,
    inputImages: SidebarInputImage[] = [],
  ): void {
    const slotKey = `${sessionId}:${sequence}`;
    if (this.discardedCandidateSlots.has(slotKey)) {
      const notesHandler = this.plugin.getNotesHandler();
      void notesHandler
        ?.removeCandidateImageFile(candidate.filePath)
        .catch(() => undefined);
      return;
    }

    const next: SidebarImageCandidate = {
      ...candidate,
      status: "ready",
      sessionId,
      sequence,
      sourcePrompt: prompt,
      sourceContext: context,
      sourceInputImages: [...inputImages],
    };

    const index = this.imageCandidates.findIndex(
      (c) => c.sessionId === sessionId && c.sequence === sequence,
    );
    if (index >= 0) {
      this.imageCandidates[index] = next;
    } else {
      this.imageCandidates.unshift(next);
    }
    this.renderCandidateList();
  }

  private markPendingCandidateFailed(
    sessionId: number,
    sequence: number,
  ): void {
    const index = this.imageCandidates.findIndex(
      (c) => c.sessionId === sessionId && c.sequence === sequence,
    );
    if (index < 0) return;
    this.imageCandidates.splice(index, 1);
    this.renderCandidateList();
  }

  private renderCandidateList(): void {
    this.renderCandidateListInternal(false);
  }

  private scheduleCandidateListRender(): void {
    if (this.candidateRenderRaf !== null) return;
    this.candidateRenderRaf = window.requestAnimationFrame(() => {
      this.candidateRenderRaf = null;
      this.renderCandidateListInternal(true);
    });
  }

  private getCandidateLayoutMetrics(total: number): {
    columns: number;
    rowHeight: number;
    totalRows: number;
    viewportHeight: number;
    scrollTop: number;
  } {
    const width = Math.max(1, this.candidateListEl.clientWidth);
    const columns = Math.max(
      1,
      Math.floor(
        (width + this.candidateGridGap) /
          (this.candidateGridMinWidth + this.candidateGridGap),
      ),
    );
    const itemWidth =
      (width - (columns - 1) * this.candidateGridGap) / Math.max(1, columns);
    const rowHeight = Math.max(96, Math.ceil(itemWidth + 14));
    const totalRows = Math.max(1, Math.ceil(total / columns));
    const viewportHeight = Math.max(1, this.candidateListEl.clientHeight);
    const scrollTop = this.candidateListEl.scrollTop;
    return { columns, rowHeight, totalRows, viewportHeight, scrollTop };
  }

  private renderCandidateListInternal(fromScroll: boolean): void {
    if (this.imageCandidates.length === 0) {
      this.candidateViewportKey = "";
      this.candidateListEl.empty();
      this.candidateListEl.createDiv({
        cls: "sidebar-image-candidate-empty",
        text: this.tr("暂无图片", "No images yet"),
      });
      return;
    }

    const { columns, rowHeight, totalRows, viewportHeight, scrollTop } =
      this.getCandidateLayoutMetrics(this.imageCandidates.length);
    const startRow = Math.max(
      0,
      Math.floor(scrollTop / rowHeight) - this.candidateVirtualOverscanRows,
    );
    const endRow = Math.min(
      totalRows,
      Math.ceil((scrollTop + viewportHeight) / rowHeight) +
        this.candidateVirtualOverscanRows,
    );
    const startIndex = startRow * columns;
    const endIndex = Math.min(this.imageCandidates.length, endRow * columns);
    const viewportKey = `${startIndex}-${endIndex}-${columns}-${this.imageCandidates.length}`;

    if (fromScroll && viewportKey === this.candidateViewportKey) {
      return;
    }
    this.candidateViewportKey = viewportKey;
    this.candidateListEl.empty();

    const topPad = Math.max(0, startRow * rowHeight);
    const bottomPad = Math.max(0, (totalRows - endRow) * rowHeight);
    if (topPad > 0) {
      const topSpacer = this.candidateListEl.createDiv(
        "sidebar-image-candidate-spacer",
      );
      topSpacer.style.height = `${topPad}px`;
    }

    this.imageCandidates
      .slice(startIndex, endIndex)
      .forEach((candidate) =>
        this.renderCandidateCard(this.candidateListEl, candidate),
      );

    if (bottomPad > 0) {
      const bottomSpacer = this.candidateListEl.createDiv(
        "sidebar-image-candidate-spacer",
      );
      bottomSpacer.style.height = `${bottomPad}px`;
    }
  }

  private renderCandidateCard(
    parent: HTMLElement,
    candidate: SidebarImageCandidate,
  ): void {
    const card = parent.createDiv("sidebar-image-candidate-card");
    const previewSrc = this.getCandidatePreviewSrc(candidate);
    const preview = card.createDiv("sidebar-image-candidate-preview");

    const statusText =
      candidate.status === "pending"
        ? this.tr("生成中", "Generating")
        : candidate.status === "ready"
          ? this.tr("待插入", "Ready")
          : this.tr("已插入", "Inserted");
    preview.createDiv({
      cls: `sidebar-image-candidate-status status-${candidate.status}`,
      text: statusText,
    });

    const actions = preview.createDiv(
      "sidebar-image-candidate-actions-overlay",
    );
    const insertBtn = actions.createEl("button", {
      cls: "mod-cta candidate-btn-insert",
      text: this.tr("插入", "Insert"),
    });
    const regenerateBtn = actions.createEl("button", {
      cls: "candidate-btn-regenerate",
      text: this.tr("重生", "Regenerate"),
    });
    const discardBtn = actions.createEl("button", {
      cls: "candidate-btn-discard",
      text: this.tr("丢弃", "Discard"),
    });
    const copyPathBtn = actions.createEl("button", {
      cls: "candidate-btn-copy",
      text: this.tr("复制嵌入", "Copy Embed"),
    });

    if (previewSrc) {
      const img = preview.createEl("img", {
        attr: { src: previewSrc, alt: candidate.fileName },
      });
      img.loading = "lazy";
      preview.addClass("is-clickable");
      preview.setAttr(
        "title",
        this.tr(
          "悬停或点击显示操作；双击查看大图",
          "Hover/click to show actions; double-click to preview",
        ),
      );
      preview.addEventListener("click", () => {
        card.toggleClass("is-actions-visible", true);
      });
      preview.addEventListener("dblclick", () => {
        this.openCandidatePreviewModal(candidate, previewSrc);
      });
    } else {
      preview.createDiv({
        cls: "sidebar-image-candidate-preview-empty",
        text: this.tr("图片预览不可用", "Preview unavailable"),
      });
      card.addClass("is-actions-visible");
    }

    const canInsertSingle =
      candidate.status === "ready" && !this.isBulkInserting;
    const canOperateCompletedCandidate =
      (candidate.status === "ready" || candidate.status === "inserted") &&
      !this.isBulkInserting;
    const canCopyEmbed = canOperateCompletedCandidate && !!candidate.filePath;
    insertBtn.disabled = !canInsertSingle;
    regenerateBtn.disabled = !canOperateCompletedCandidate;
    discardBtn.disabled = !canOperateCompletedCandidate;
    copyPathBtn.disabled = !canCopyEmbed;

    const markVisible = (): void => card.addClass("is-actions-visible");
    [insertBtn, regenerateBtn, discardBtn, copyPathBtn].forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        markVisible();
      });
    });

    insertBtn.addEventListener("click", () => {
      void this.handleInsertCandidate(candidate.taskId);
    });
    regenerateBtn.addEventListener("click", () => {
      void this.handleRegenerateCandidate(candidate.taskId);
    });
    discardBtn.addEventListener("click", () => {
      void this.handleDiscardCandidate(candidate.taskId);
    });
    copyPathBtn.addEventListener("click", () => {
      void this.handleCopyCandidateEmbed(candidate.taskId);
    });
  }

  private openCandidatePreviewModal(
    candidate: SidebarImageCandidate,
    previewSrc: string,
  ): void {
    const modal = new ReferenceImagePreviewModal(this.app, previewSrc, candidate.fileName, {
      downloadText: this.tr("下载图片到本地", "Download Image"),
      insertText: this.tr("插入到笔记", "Insert into Note"),
      onDownload: () => this.downloadCandidateImage(candidate, previewSrc),
      onInsert: () => {
        void this.handleInsertCandidate(candidate.taskId);
      },
    });
    modal.open();
  }

  private downloadCandidateImage(
    candidate: SidebarImageCandidate,
    previewSrc: string,
  ): void {
    try {
      const link = document.createElement("a");
      link.href = previewSrc;
      link.download = candidate.fileName || `ai-generated-${Date.now()}.png`;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      new Notice(this.tr("已开始下载图片", "Image download started"));
    } catch (error) {
      console.error("Sidebar CoPilot: failed to download candidate image", error);
      new Notice(this.tr("下载失败，请重试", "Download failed. Please retry."));
    }
  }

  private async handleInsertAllCandidates(): Promise<void> {
    if (this.pendingTaskCount > 0 || this.isBulkInserting) return;

    const notesHandler = this.plugin.getNotesHandler();
    if (!notesHandler) return;

    const readyCandidates = this.imageCandidates.filter(
      (c) => c.status === "ready",
    );
    if (readyCandidates.length === 0) {
      new Notice(this.tr("没有可插入的图片", "No images available to insert"));
      return;
    }

    this.isBulkInserting = true;
    this.updateGenerateButtonState();
    let success = 0;
    try {
      for (const candidate of readyCandidates) {
        const ok = await notesHandler.insertImageCandidate(candidate);
        if (ok) {
          candidate.status = "inserted";
          success += 1;
        }
      }
    } catch (error) {
      console.error("Sidebar CoPilot: bulk insert failed", error);
      new Notice(
        this.tr(
          "批量插入过程中出现错误，请重试",
          "An error occurred during bulk insert. Please retry.",
        ),
      );
    } finally {
      this.isBulkInserting = false;
      this.renderCandidateList();
      this.updateGenerateButtonState();
    }
    new Notice(
      this.tr("已插入 " + success + " 张图片", `Inserted ${success} image(s)`),
    );
  }

  private async handleCopyCandidateEmbed(candidateId: string): Promise<void> {
    const candidate = this.imageCandidates.find(
      (c) => c.taskId === candidateId,
    );
    if (!candidate) return;
    if (!(candidate.status === "ready" || candidate.status === "inserted")) {
      new Notice(
        this.tr(
          "请等待图片生成完成后再复制",
          "Please wait until image generation completes",
        ),
      );
      return;
    }

    try {
      const normalized = (candidate.filePath || "").replace(/^\/+/, "");
      const embed = `![[${normalized}]]`;
      await navigator.clipboard.writeText(embed);
      new Notice(this.tr("已复制嵌入语法", "Copied embed syntax"));
    } catch {
      new Notice(
        this.tr(
          "复制失败，请检查系统剪贴板权限",
          "Copy failed. Please check clipboard permissions.",
        ),
      );
    }
  }

  private async handleInsertCandidate(candidateId: string): Promise<void> {
    const notesHandler = this.plugin.getNotesHandler();
    if (!notesHandler) return;

    const candidate = this.imageCandidates.find(
      (c) => c.taskId === candidateId,
    );
    if (!candidate) return;
    if (candidate.status !== "ready") {
      new Notice(
        this.tr(
          "当前候选图未就绪，无法插入。",
          "Candidate not ready and cannot be inserted.",
        ),
      );
      return;
    }

    const ok = await notesHandler.insertImageCandidate(candidate);
    if (!ok) return;

    candidate.status = "inserted";
    this.renderCandidateList();
    new Notice(
      this.tr(
        "图片已插入到当前笔记内容",
        "Image inserted into current note content",
      ),
    );
  }

  private async handleRegenerateCandidate(candidateId: string): Promise<void> {
    const notesHandler = this.plugin.getNotesHandler();
    if (!notesHandler) return;

    const candidateIndex = this.imageCandidates.findIndex(
      (c) => c.taskId === candidateId,
    );
    if (candidateIndex < 0) return;
    const candidate = this.imageCandidates[candidateIndex];
    if (candidate.status === "discarded") return;
    if (!(candidate.status === "ready" || candidate.status === "inserted")) {
      new Notice(
        this.tr(
          "请等待图片生成完成后再重生",
          "Please wait until image generation completes",
        ),
      );
      return;
    }

    const shouldDeleteSource = candidate.status !== "inserted";
    const oldFilePath = candidate.filePath;

    let sessionId: number;
    let sequence: number;
    if (this.pendingTaskCount > 0) {
      // 进行中任务：追加到当前会话，不重置已有候选。
      sessionId = this.currentSessionId;
      sequence = Math.max(1, this.activeRequestTotal + 1);
      this.activeRequestTotal += 1;
    } else {
      // 空闲状态：开启一个新的“单张重生会话”，仅更新当前卡片。
      this.currentSessionId += 1;
      sessionId = this.currentSessionId;
      sequence = 1;
      this.activeRequestTotal = 1;
    }

    this.pendingTaskCount += 1;
    this.activeConcurrencyCount += 1;
    this.imageCandidates[candidateIndex] = {
      ...candidate,
      taskId: `pending-${sessionId}-${sequence}`,
      fileName: this.tr("生成中...", "Generating..."),
      filePath: "",
      createdAt: Date.now(),
      imageDataUrl: "",
      status: "pending",
      sessionId,
      sequence,
    };
    this.renderCandidateList();
    this.updateGenerateButtonState();

    if (shouldDeleteSource && oldFilePath) {
      await notesHandler
        .removeCandidateImageFile(oldFilePath)
        .catch(() => undefined);
    }

    void this.runOneGeneration(
      sessionId,
      candidate.sourcePrompt,
      candidate.sourceContext,
      sequence,
      candidate.sourceInputImages,
    ).finally(() => {
      this.activeConcurrencyCount = Math.max(
        0,
        this.activeConcurrencyCount - 1,
      );
      this.updateGenerateButtonState();
    });
    new Notice(this.tr("已开始重生该图片", "Regeneration started"));
  }

  private async handleDiscardCandidate(candidateId: string): Promise<void> {
    const notesHandler = this.plugin.getNotesHandler();
    if (!notesHandler) return;

    const candidateIndex = this.imageCandidates.findIndex(
      (c) => c.taskId === candidateId,
    );
    if (candidateIndex < 0) return;
    const candidate = this.imageCandidates[candidateIndex];
    if (!(candidate.status === "ready" || candidate.status === "inserted")) {
      new Notice(
        this.tr(
          "请等待图片生成完成后再丢弃",
          "Please wait until image generation completes",
        ),
      );
      return;
    }

    const shouldDeleteSource = candidate.status !== "inserted";
    this.imageCandidates.splice(candidateIndex, 1);
    this.renderCandidateList();
    new Notice(this.tr("已丢弃该图片", "Discarded this image"));

    if (shouldDeleteSource) {
      try {
        await notesHandler.removeCandidateImageFile(candidate.filePath);
      } catch (e) {
        console.warn("Sidebar CoPilot: failed to delete discarded image", e);
      }
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

  private getCandidatePreviewSrc(candidate: SidebarImageCandidate): string | null {
    if (candidate.imageDataUrl) {
      return candidate.imageDataUrl;
    }
    const filePath = candidate.filePath || "";
    if (!filePath) return null;
    try {
      const normalized = filePath.replace(/^\/+/, "");
      const fromAdapter = this.app.vault.adapter.getResourcePath(normalized);
      if (fromAdapter) {
        return fromAdapter;
      }
    } catch (error) {
      console.warn(
        "Sidebar CoPilot: failed to resolve preview via adapter",
        error,
      );
    }

    const abstract = this.app.vault.getAbstractFileByPath(filePath);
    if (!(abstract instanceof TFile)) {
      return null;
    }
    return this.app.vault.getResourcePath(abstract);
  }
}
