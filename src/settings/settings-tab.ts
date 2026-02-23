/**
 * Banana Studio Settings Tab
 * 插件设置界面
 */

import { App, PluginSettingTab, Setting, requestUrl, Notice } from "obsidian";
import type CanvasAIPlugin from "../../main";
import { ApiProvider, CanvasAISettings, QuickSwitchModel } from "./settings";
import { t } from "../../lang/helpers";
import { ApiManager } from "../api/api-manager";
import { formatProviderName } from "../utils/format-utils";

// ========== Settings Tab ==========

// Model info structure from OpenRouter API
interface OpenRouterModel {
  id: string;
  name: string;
  outputModalities: string[];
}

export class CanvasAISettingTab extends PluginSettingTab {
  plugin: CanvasAIPlugin;
  private modelCache: OpenRouterModel[] = [];
  private modelsFetched: boolean = false;
  private isFetching: boolean = false;

  constructor(app: App, plugin: CanvasAIPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Fetch models from API (OpenRouter) or load hardcoded lists (Gemini/OpenAI)
   */
  private async fetchModels(): Promise<void> {
    if (this.isFetching) return;

    const provider = this.plugin.settings.apiProvider;
    const isGemini = provider === "gemini"; // Gemini uses hardcoded model list (no API endpoint)
    const isOpenAI = provider === "openai"; // OpenAI uses curated model list
    const isZenMux = provider === "zenmux"; // ZenMux uses curated model list
    if (isGemini) {
      this.modelCache = this.getGeminiHardcodedModels();
      this.modelsFetched = true;
      console.debug(
        `Banana Studio Settings: Loaded ${this.modelCache.length} hardcoded Gemini models`,
      );
      void this.display();
      return;
    }
    if (isOpenAI) {
      this.modelCache = this.getOpenAIHardcodedModels();
      this.modelsFetched = true;
      console.debug(
        `Banana Studio Settings: Loaded ${this.modelCache.length} hardcoded OpenAI models`,
      );
      void this.display();
      return;
    }
    if (isZenMux) {
      this.modelCache = this.getZenMuxHardcodedModels();
      this.modelsFetched = true;
      console.debug(
        `Banana Studio Settings: Loaded ${this.modelCache.length} hardcoded ZenMux models`,
      );
      void this.display();
      return;
    }
    const apiKey = this.plugin.settings.openRouterApiKey;

    if (!apiKey) {
      console.debug("Banana Studio Settings: No API key, skipping model fetch");
      return;
    }

    this.isFetching = true;
    try {
      const endpoint = "https://openrouter.ai/api/v1/models";
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
      };

      const response = await requestUrl({
        url: endpoint,
        method: "GET",
        headers: headers,
      });

      const data = response.json;

      // Parse and cache model info
      interface ModelData {
        id?: string;
        name?: string;
        architecture?: { output_modalities?: string[] };
      }
      this.modelCache = (data.data || []).map((m: ModelData) => ({
        id: m.id || "",
        name: m.name || m.id || "",
        outputModalities: m.architecture?.output_modalities || ["text"],
      }));

      this.modelsFetched = true;
      console.debug(
        `Banana Studio Settings: Fetched ${this.modelCache.length} models from OpenRouter`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Banana Studio Settings: Failed to fetch models:", message);
      // Keep existing cache or empty
      new Notice(`Failed to fetch model list: ${message}`);
    } finally {
      this.isFetching = false;
      // Update UI after fetch completes (success or error)
      void this.display();
    }
  }

  /**
   * Get hardcoded Gemini models list
   * Gemini doesn't have a public models API, so we maintain a curated list
   */
  private getGeminiHardcodedModels(): OpenRouterModel[] {
    return [
      // Gemini 2.5 series
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        outputModalities: ["text"],
      },
      {
        id: "gemini-2.5-flash-lite",
        name: "Gemini 2.5 Flash Lite",
        outputModalities: ["text"],
      },
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        outputModalities: ["text"],
      },
      {
        id: "gemini-2.5-flash-lite-preview-09-2025",
        name: "Gemini 2.5 Flash Lite Preview 09-2025",
        outputModalities: ["text"],
      },
      {
        id: "gemini-2.5-flash-lite-preview-06-17-nothinking",
        name: "Gemini 2.5 Flash Lite Preview 06-17 (No Thinking)",
        outputModalities: ["text"],
      },
      {
        id: "gemini-2.5-pro-preview-06-05",
        name: "Gemini 2.5 Pro Preview 06-05",
        outputModalities: ["text"],
      },
      {
        id: "gemini-2.5-pro-preview-05-06",
        name: "Gemini 2.5 Pro Preview 05-06",
        outputModalities: ["text"],
      },
      {
        id: "google/gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro Preview",
        outputModalities: ["text", "image"],
      },
      // Gemini 3 series (Image generation)
      {
        id: "gemini-3-pro-image-preview",
        name: "Gemini 3 Pro Image Preview",
        outputModalities: ["image"],
      },
      // Legacy naming (for backward compatibility)
      {
        id: "gemini-pro-latest-thinking-*",
        name: "Gemini Pro Latest (Thinking)",
        outputModalities: ["text"],
      },
      {
        id: "gemini-flash-latest-nothinking",
        name: "Gemini Flash Latest (No Thinking)",
        outputModalities: ["text"],
      },
    ];
  }

  private getOpenAIHardcodedModels(): OpenRouterModel[] {
    return [
      { id: "gpt-5", name: "GPT-5", outputModalities: ["text"] },
      { id: "gpt-5-mini", name: "GPT-5 Mini", outputModalities: ["text"] },
      { id: "gpt-5-nano", name: "GPT-5 Nano", outputModalities: ["text"] },
      { id: "gpt-4.1", name: "GPT-4.1", outputModalities: ["text"] },
      { id: "gpt-4o", name: "GPT-4o", outputModalities: ["text"] },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", outputModalities: ["text"] },
      { id: "gpt-image-1", name: "GPT Image 1", outputModalities: ["image"] },
    ];
  }

  private getZenMuxHardcodedModels(): OpenRouterModel[] {
    return [
      {
        id: "google/gemini-2.5-flash",
        name: "Gemini 2.5 Flash (ZenMux)",
        outputModalities: ["text"],
      },
      {
        id: "google/gemini-2.5-pro",
        name: "Gemini 2.5 Pro (ZenMux)",
        outputModalities: ["text"],
      },
      {
        id: "google/gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro Preview (ZenMux)",
        outputModalities: ["text", "image"],
      },
      {
        id: "google/gemini-3-pro-image-preview",
        name: "Gemini 3 Pro Image Preview (ZenMux)",
        outputModalities: ["image"],
      },
    ];
  }

  // Model keyword filters
  private static TEXT_MODEL_KEYWORDS = ["gpt", "gemini"];
  // Exclude keywords for text models (audio, tts, image, vision, etc.)
  private static TEXT_MODEL_EXCLUDE_KEYWORDS = [
    "audio",
    "tts",
    "image",
    "vision",
    "whisper",
    "dall-e",
    "midjourney",
  ];
  private static RECOMMENDED_TEXT_MODELS = ["gpt-4o-mini", "gemini-2.5-flash"];

  /**
   * Check if model version meets minimum requirements
   * GPT: >= 4.0, Gemini: >= 2.5
   */
  private meetsMinimumVersion(modelId: string): boolean {
    const idLower = modelId.toLowerCase();

    // GPT version check: must be >= 4.0
    if (idLower.includes("gpt")) {
      // Extract version number (e.g., gpt-4.5, gpt-4, gpt-5)
      const gptMatch = idLower.match(/gpt-(\d+)(?:\.(\d+))?/);
      if (gptMatch) {
        const major = parseInt(gptMatch[1]);
        return major >= 4;
      }
      // If no version found, exclude (likely gpt-3.5 or older)
      return false;
    }

    // Gemini version check: must be >= 2.5
    if (idLower.includes("gemini")) {
      // Extract version number (e.g., gemini-2.5, gemini-3)
      const geminiMatch = idLower.match(/gemini-(\d+)(?:\.(\d+))?/);
      if (geminiMatch) {
        const major = parseInt(geminiMatch[1]);
        const minor = geminiMatch[2] ? parseInt(geminiMatch[2]) : 0;
        return major > 2 || (major === 2 && minor >= 5);
      }
      // Legacy naming without version (e.g., gemini-pro-latest) - include them
      return true;
    }

    // For other models, include by default
    return true;
  }

  /**
   * Sort models by provider and version
   * Order: Gemini models first, then GPT models, then others
   * Within each group, sort by version (newest first)
   */
  private sortModels(models: OpenRouterModel[]): OpenRouterModel[] {
    return models.sort((a, b) => {
      const aLower = a.id.toLowerCase();
      const bLower = b.id.toLowerCase();

      const aIsGemini = aLower.includes("gemini");
      const bIsGemini = bLower.includes("gemini");
      const aIsGPT = aLower.includes("gpt");
      const bIsGPT = bLower.includes("gpt");

      // Group by provider: Gemini > GPT > Others
      if (aIsGemini && !bIsGemini) return -1;
      if (!aIsGemini && bIsGemini) return 1;
      if (aIsGPT && !bIsGPT && !bIsGemini) return -1;
      if (!aIsGPT && bIsGPT && !aIsGemini) return 1;

      // Within same provider, sort by version (descending)
      // Extract version numbers for comparison
      const extractVersion = (id: string): number[] => {
        const match = id.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
        if (!match) return [0, 0, 0];
        return [
          parseInt(match[1] || "0"),
          parseInt(match[2] || "0"),
          parseInt(match[3] || "0"),
        ];
      };

      const aVersion = extractVersion(aLower);
      const bVersion = extractVersion(bLower);

      for (let i = 0; i < 3; i++) {
        if (aVersion[i] !== bVersion[i]) {
          return bVersion[i] - aVersion[i]; // Descending order
        }
      }

      // If versions are equal, sort alphabetically
      return a.id.localeCompare(b.id);
    });
  }

  /**
   * Get models that support text output
   */
  private getTextModels(): OpenRouterModel[] {
    const provider = this.plugin.settings.apiProvider;
    const isGemini = provider === "gemini";
    const isOpenAI = provider === "openai";
    const isZenMux = provider === "zenmux";

    if (isOpenAI || isZenMux) {
      return this.modelCache.filter((m) => m.outputModalities.includes("text"));
    }

    const filtered = this.modelCache.filter((m) => {
      const idLower = m.id.toLowerCase(); // For OpenRouter, must support text output; for Gemini, skip this check (hardcoded)
      if (!isGemini && !m.outputModalities.includes("text")) return false;

      // Exclude non-text models by keywords
      if (
        CanvasAISettingTab.TEXT_MODEL_EXCLUDE_KEYWORDS.some((kw) =>
          idLower.includes(kw),
        )
      ) {
        return false;
      }

      // Filter by keywords (case-insensitive)
      if (
        !CanvasAISettingTab.TEXT_MODEL_KEYWORDS.some((kw) =>
          idLower.includes(kw),
        )
      ) {
        return false;
      }

      // Version filtering
      return this.meetsMinimumVersion(m.id);
    });

    const sorted = this.sortModels(filtered);
    if (this.plugin.settings.showAllTextModelsInSettings) {
      return sorted;
    }
    return this.pickRecommendedTextModels(sorted);
  }

  private pickRecommendedTextModels(
    models: OpenRouterModel[],
  ): OpenRouterModel[] {
    const byId = new Map(models.map((m) => [m.id, m] as const));
    const selected: OpenRouterModel[] = [];
    for (const id of CanvasAISettingTab.RECOMMENDED_TEXT_MODELS) {
      const hit = byId.get(id);
      if (hit) selected.push(hit);
    }
    if (selected.length > 0) return selected;
    return models.slice(0, 2);
  }

  /**
   * Get models that support image output
   */
  private getImageModels(): OpenRouterModel[] {
    const provider = this.plugin.settings.apiProvider;
    const isGemini = provider === "gemini";
    const isOpenAI = provider === "openai";
    const isZenMux = provider === "zenmux";

    if (isOpenAI || isZenMux) {
      return this.modelCache.filter((m) =>
        m.outputModalities.includes("image"),
      );
    }

    const filtered = this.modelCache.filter((m) => {
      const idLower = m.id.toLowerCase(); // For OpenRouter, must support image output; for Gemini, skip this check
      if (!isGemini && !m.outputModalities.includes("image")) return false;

      // Must be Gemini family and image-capable:
      // - standard image models include "image"
      // - Gemini 3.1 Pro Preview is also allowed as image-capable by request
      if (
        !idLower.includes("gemini") ||
        (!idLower.includes("image") && !idLower.includes("3.1-pro-preview"))
      ) {
        return false;
      }

      // Version filtering
      return this.meetsMinimumVersion(m.id);
    });

    // Sort models
    return this.sortModels(filtered);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("canvas-ai-settings");

    new Setting(containerEl).setHeading().setName(t("SettingTitle"));

    // ========== API Provider Selection ==========
    new Setting(containerEl).setHeading().setName(t("API configuration"));

    new Setting(containerEl)
      .setName(t("API provider"))
      .setDesc(t("Select API provider"))
      .addDropdown((dropdown) =>
        dropdown

          .addOption("gemini", t("Google Gemini"))
          .addOption("openai", "OpenAI")
          .addOption("zenmux", "ZenMux")

          .addOption("openrouter", t("OpenRouter"))
          .setValue(
            (() => {
              const rawProvider = this.plugin.settings.apiProvider as string;
              const supported = new Set([
                "openrouter",
                "openai",
                "zenmux",
                "gemini",
              ]);
              return supported.has(rawProvider) ? rawProvider : "openrouter";
            })(),
          )
          .onChange(async (value) => {
            this.plugin.settings.apiProvider = value as ApiProvider;
            await this.plugin.saveSettings();

            // Auto-refresh models when switching provider (Non-blocking)
            this.modelsFetched = false;
            void this.fetchModels(); // Fire and forget

            // Re-render immediately to show/hide provider-specific settings
            void this.display();
          }),
      );

    const rawProvider = this.plugin.settings.apiProvider as string;
    const provider = (
      ["openrouter", "openai", "zenmux", "gemini"].includes(rawProvider)
        ? rawProvider
        : "openrouter"
    ) as ApiProvider;

    if (provider !== rawProvider) {
      this.plugin.settings.apiProvider = provider;
      void this.plugin.saveSettings();
    }

    const isGemini = provider === "gemini";
    const isOpenAI = provider === "openai";
    const isZenMux = provider === "zenmux";

    // ========== Configuration Section ==========
    if (provider === "openrouter") {
      // API Key with Test Button
      const apiKeySetting = new Setting(containerEl)
        .setName(t("OpenRouter API key"))
        .setDesc(t("Enter your OpenRouter API key"))
        .addText((text) =>
          text

            .setPlaceholder(t("Placeholder API key OpenRouter"))
            .setValue(this.plugin.settings.openRouterApiKey)
            .onChange(async (value) => {
              this.plugin.settings.openRouterApiKey = value;
              await this.plugin.saveSettings();
            }),
        );

      this.addTestButton(apiKeySetting.controlEl, containerEl);

      new Setting(containerEl)
        .setName(t("API base URL"))
        .setDesc(t("API base URL"))
        .addText((text) =>
          text
            .setPlaceholder("https://openrouter.ai")
            .setValue(this.plugin.settings.openRouterBaseUrl)
            .onChange(async (value) => {
              this.plugin.settings.openRouterBaseUrl = value;
              await this.plugin.saveSettings();
            }),
        );
    } else if (provider === "openai") {
      const openaiKeySetting = new Setting(containerEl)
        .setName("OpenAI API key")
        .setDesc("Enter your OpenAI API key")
        .addText((text) =>
          text
            .setPlaceholder("sk-...")
            .setValue(this.plugin.settings.openAIApiKey)
            .onChange(async (value) => {
              this.plugin.settings.openAIApiKey = value;
              await this.plugin.saveSettings();
            }),
        );

      this.addTestButton(openaiKeySetting.controlEl, containerEl);

      new Setting(containerEl)
        .setName(t("API base URL"))
        .setDesc("OpenAI-compatible base URL")
        .addText((text) =>
          text
            .setPlaceholder("https://api.openai.com")
            .setValue(this.plugin.settings.openAIBaseUrl)
            .onChange(async (value) => {
              this.plugin.settings.openAIBaseUrl = value;
              await this.plugin.saveSettings();
            }),
        );
    } else if (provider === "zenmux") {
      const zenmuxKeySetting = new Setting(containerEl)
        .setName("ZenMux API key")
        .setDesc("Enter your ZenMux API key")
        .addText((text) =>
          text
            .setPlaceholder("zm_...")
            .setValue(this.plugin.settings.zenmuxApiKey)
            .onChange(async (value) => {
              this.plugin.settings.zenmuxApiKey = value;
              await this.plugin.saveSettings();
            }),
        );

      this.addTestButton(zenmuxKeySetting.controlEl, containerEl);

      new Setting(containerEl)
        .setName(t("API base URL"))
        .setDesc("ZenMux Vertex AI endpoint")
        .addText((text) =>
          text
            .setPlaceholder("https://zenmux.ai/api/vertex-ai")
            .setValue(this.plugin.settings.zenmuxBaseUrl)
            .onChange(async (value) => {
              this.plugin.settings.zenmuxBaseUrl = value;
              await this.plugin.saveSettings();
            }),
        );
    } else if (provider === "gemini") {
      const geminiKeySetting = new Setting(containerEl)
        .setName(t("Gemini API key"))
        .setDesc(t("Enter your Gemini API key"))
        .addText((text) =>
          text

            .setPlaceholder(t("Placeholder API key Gemini"))
            .setValue(this.plugin.settings.geminiApiKey)
            .onChange(async (value) => {
              this.plugin.settings.geminiApiKey = value;
              await this.plugin.saveSettings();
            }),
        );

      this.addTestButton(geminiKeySetting.controlEl, containerEl);

      new Setting(containerEl)
        .setName(t("API base URL"))
        .setDesc(t("API base URL"))
        .addText((text) =>
          text
            .setPlaceholder("https://generativelanguage.googleapis.com")
            .setValue(this.plugin.settings.geminiBaseUrl)
            .onChange(async (value) => {
              this.plugin.settings.geminiBaseUrl = value;
              await this.plugin.saveSettings();
            }),
        );
    }

    // ========== 模型配置区域 ==========
    new Setting(containerEl).setHeading().setName(t("Model configuration"));

    // Fetch models if not already fetched (Non-blocking)
    // For Gemini/OpenAI, use hardcoded list; for OpenRouter, fetch from API
    const apiKey = isGemini
      ? this.plugin.settings.geminiApiKey
      : isOpenAI
        ? this.plugin.settings.openAIApiKey
        : isZenMux
          ? this.plugin.settings.zenmuxApiKey
          : this.plugin.settings.openRouterApiKey;
    if (!this.modelsFetched && apiKey && !this.isFetching) {
      setTimeout(() => void this.fetchModels(), 0);
    }

    // Refresh button - show status for all providers
    let statusText = t("Click refresh");
    if (this.isFetching) {
      statusText = t("Fetching...");
    } else if (this.modelsFetched) {
      const source = isGemini
        ? "Gemini (Hardcoded)"
        : isOpenAI
          ? "OpenAI (Hardcoded)"
          : isZenMux
            ? "ZenMux (Hardcoded)"
            : "OpenRouter";
      statusText = t("Loaded models", {
        count: this.modelCache.length,
        textCount: this.getTextModels().length,
        imageCount: this.getImageModels().length,
        source: source,
      });
    }

    const refreshSetting = new Setting(containerEl)
      .setName(t("Model list"))
      .setDesc(statusText);

    // Only show refresh button for OpenRouter (Gemini/OpenAI use hardcoded list)
    if (!isGemini && !isOpenAI && !isZenMux) {
      const refreshBtn = refreshSetting.controlEl.createEl("button", {
        text: this.isFetching ? t("Refreshing...") : t("Refresh model list"),
        cls: "canvas-ai-refresh-btn",
      });

      refreshBtn.disabled = this.isFetching;

      refreshBtn.addEventListener("click", () => {
        refreshBtn.textContent = "Fetching...";
        refreshBtn.disabled = true;
        this.modelsFetched = false; // Force refresh
        void this.fetchModels(); // Fire and forget
        // UI will be updated by fetchModels finally block
      });
    }

    new Setting(containerEl)
      .setName(t("Show all text models (Advanced)"))
      .setDesc(
        t(
          "By default, only 2 recommended text models are shown: gpt-4o-mini, gemini-2.5-flash",
        ),
      )
      .addToggle((toggle) =>
        toggle
          .setValue(!!this.plugin.settings.showAllTextModelsInSettings)
          .onChange(async (value) => {
            this.plugin.settings.showAllTextModelsInSettings = value;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    // ========== Quick Switch Models (Compact Display) ==========
    this.renderQuickSwitchCompact(containerEl);

    // ========== Image Model Setting ==========
    // ========== Image Model Setting ==========
    const imageModelKey = isGemini
      ? "geminiImageModel"
      : isOpenAI
        ? "openAIImageModel"
        : isZenMux
          ? "zenmuxImageModel"
          : "openRouterImageModel";
    const imageCustomKey = isGemini
      ? "geminiUseCustomImageModel"
      : isOpenAI
        ? "openAIUseCustomImageModel"
        : isZenMux
          ? "zenmuxUseCustomImageModel"
          : "openRouterUseCustomImageModel";
    const imagePlaceholder = isGemini
      ? "gemini-3-pro-image-preview"
      : isOpenAI
        ? "gpt-image-1"
        : isZenMux
          ? "google/gemini-3-pro-image-preview"
          : "google/gemini-3-pro-image-preview";

    this.renderModelSetting(containerEl, {
      name: t("Image generation model"),
      desc: t("Image generation model"),
      modelKey: imageModelKey,
      customKey: imageCustomKey,
      placeholder: imagePlaceholder,
      getModels: () => this.getImageModels(),
    });

    // 图片优化区域
    new Setting(containerEl)
      .setHeading()
      .setName(t("Image optimization"))
      .setDesc(t("Image optimization desc"));

    new Setting(containerEl)
      .setName(t("Image compression quality"))
      .setDesc(t("Image compression quality"))
      .addSlider((slider) =>
        slider
          .setLimits(1, 100, 1)
          .setValue(this.plugin.settings.imageCompressionQuality)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.imageCompressionQuality = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("Image max size"))
      .setDesc(t("Image max size"))
      .addText((text) =>
        text
          .setPlaceholder("2048")
          .setValue(String(this.plugin.settings.imageMaxSize))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.imageMaxSize = num;
              await this.plugin.saveSettings();
            }
          })
          .inputEl.addClass("canvas-ai-small-input"),
      );

    new Setting(containerEl)
      .setName(t("Image save location"))
      .setDesc(
        t(
          "Specify a folder path in vault, e.g. Assets/AI (leave empty to save next to current note)",
        ),
      )
      .addText((text) =>
        text
          .setPlaceholder("Assets/AI")
          .setValue(this.plugin.settings.imageSaveFolder || "")
          .onChange(async (value) => {
            this.plugin.settings.imageSaveFolder = value.trim();
            await this.plugin.saveSettings();
          })
          .inputEl.addClass("canvas-ai-small-input"),
      );

    // ========== Prompt Settings ==========
    new Setting(containerEl).setHeading().setName(t("Prompt settings"));

    // Image System Prompt
    new Setting(containerEl)
      .setClass("canvas-ai-block-setting")
      .setName(t("Image system prompt"))
      .setDesc(t("System prompt for image generation mode"))
      .addTextArea((text) =>
        text
          .setPlaceholder("You are an expert creator...")
          .setValue(this.plugin.settings.imageSystemPrompt)
          .onChange(async (value) => {
            this.plugin.settings.imageSystemPrompt = value;
            await this.plugin.saveSettings();
          }),
      );

    // ========== Developer Options ==========
    new Setting(containerEl).setHeading().setName(t("Developer options"));

    new Setting(containerEl)
      .setName(t("Debug mode"))
      .setDesc(t("Debug mode"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.debugMode)
          .onChange(async (value) => {
            this.plugin.settings.debugMode = value;
            await this.plugin.saveSettings();
            // Re-render settings to show/hide experimental options
            this.display();
          }),
      );

    new Setting(containerEl)
      .setName(t("Image Generation Timeout"))
      .setDesc(t("Image Generation Timeout Desc"))
      .addText((text) =>
        text
          .setPlaceholder("120")
          .setValue(String(this.plugin.settings.imageGenerationTimeout || 120))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.imageGenerationTimeout = num;
              await this.plugin.saveSettings();
            }
          }),
      )
      .then((setting) => {
        // Make the input narrower
        const inputEl = setting.controlEl.querySelector("input");
        if (inputEl) {
          inputEl.addClass("canvas-ai-timeout-input");
          inputEl.type = "number";
          inputEl.min = "10";
          inputEl.max = "600";
        }
      });
  }

  /**
   * Helper to add test button
   */
  private addTestButton(parentEl: HTMLElement, resultContainer: HTMLElement) {
    const testBtn = parentEl.createEl("button", {
      text: t("Test connection"),
      cls: "canvas-ai-test-btn",
    });

    const testResultEl = resultContainer.createDiv({
      cls: "canvas-ai-test-result is-hidden",
    });

    testBtn.addEventListener("click", () => {
      void (async () => {
        testBtn.textContent = t("Testing...");
        testBtn.disabled = true;
        testResultEl.addClass("is-hidden");

        try {
          const apiManager = new ApiManager(this.plugin.settings);
          if (!apiManager.isConfigured()) {
            throw new Error("Please enter API Key first");
          }
          const response = await apiManager.chatCompletion(
            'Say "Connection successful!" in one line.',
          );

          testBtn.textContent = t("Success");
          testBtn.addClass("success");
          testResultEl.textContent = `✓ ${t("Connection successful")}: ${response.substring(0, 50)}...`;
          testResultEl.removeClass("error");
          testResultEl.addClass("success");
          testResultEl.removeClass("is-hidden");

          setTimeout(() => {
            testBtn.textContent = t("Test connection");
            testBtn.removeClass("success");
            testBtn.disabled = false;
          }, 3000);
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          testBtn.textContent = t("Failed");
          testBtn.addClass("error");
          testResultEl.textContent = `✗ ${t("Connection failed")}: ${message}`;
          testResultEl.removeClass("success");
          testResultEl.addClass("error");
          testResultEl.removeClass("is-hidden");

          setTimeout(() => {
            testBtn.textContent = t("Test connection");
            testBtn.removeClass("error");
            testBtn.disabled = false;
          }, 3000);
        }
      })();
    });
  }

  /**
   * Render quick switch models as compact inline tags with drag-and-drop reordering
   */
  private renderQuickSwitchCompact(containerEl: HTMLElement): void {
    const imageModels = this.plugin.settings.quickSwitchImageModels || [];

    // Helper to create draggable tag
    const createDraggableTag = (
      container: HTMLElement,
      model: QuickSwitchModel,
      index: number,
      models: QuickSwitchModel[],
    ) => {
      const tag = container.createSpan({ cls: "canvas-ai-quick-switch-tag" });
      tag.setAttribute("draggable", "true");
      tag.dataset.index = String(index);

      // Format: "ModelName | Provider"
      tag.createSpan({
        text: `${model.displayName} | ${formatProviderName(model.provider)}`,
      });
      const removeBtn = tag.createSpan({
        text: " ×",
        cls: "canvas-ai-quick-switch-remove",
      });

      // Remove button click
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void (async () => {
          models.splice(index, 1);
          this.plugin.settings.quickSwitchImageModels = models;
          await this.plugin.saveSettings();
          new Notice(t("Model removed"));
          void this.display();
        })();
      });

      // Drag events
      tag.addEventListener("dragstart", (e) => {
        tag.addClass("dragging");
        e.dataTransfer?.setData("text/plain", String(index));
      });

      tag.addEventListener("dragend", () => {
        tag.removeClass("dragging");
      });

      tag.addEventListener("dragover", (e) => {
        e.preventDefault();
        tag.addClass("drag-over");
      });

      tag.addEventListener("dragleave", () => {
        tag.removeClass("drag-over");
      });

      tag.addEventListener("drop", (e) => {
        e.preventDefault();
        tag.removeClass("drag-over");
        const fromIndex = parseInt(
          e.dataTransfer?.getData("text/plain") || "-1",
        );
        const toIndex = index;
        if (fromIndex >= 0 && fromIndex !== toIndex) {
          void (async () => {
            // Reorder array
            const [moved] = models.splice(fromIndex, 1);
            models.splice(toIndex, 0, moved);
            this.plugin.settings.quickSwitchImageModels = models;
            await this.plugin.saveSettings();
            void this.display();
          })();
        }
      });
    };

    // Image models row
    const imageRow = containerEl.createDiv({
      cls: "canvas-ai-quick-switch-row",
    });
    imageRow.createSpan({
      text: `${t("Quick switch image models")}: `,
      cls: "canvas-ai-quick-switch-label",
    });
    const imageTagsContainer = imageRow.createSpan({
      cls: "canvas-ai-quick-switch-tags",
    });

    if (imageModels.length === 0) {
      imageTagsContainer.createSpan({
        text: t("No quick switch models"),
        cls: "canvas-ai-quick-switch-empty",
      });
    } else {
      imageModels.forEach((model, index) => {
        createDraggableTag(imageTagsContainer, model, index, imageModels);
      });
    }
  }

  /**
   * Get display name for a model ID (from cache or format from ID)
   */
  private getModelDisplayName(modelId: string): string {
    // Try to find in model cache
    const cached = this.modelCache.find((m) => m.id === modelId);
    if (cached) {
      // Remove company prefix like "Google: " if present
      const name = cached.name;
      const colonIndex = name.indexOf(": ");
      if (colonIndex > -1 && colonIndex < 20) {
        return name.substring(colonIndex + 2);
      }
      return name;
    }
    // Fallback: format the model ID nicely
    return modelId.split("/").pop() || modelId;
  }

  /**
   * Render a model selection setting with dropdown/text input toggle
   */
  private renderModelSetting(
    containerEl: HTMLElement,
    options: {
      name: string;
      desc: string;
      modelKey: keyof CanvasAISettings;
      customKey: keyof CanvasAISettings;
      placeholder: string;
      getModels: () => OpenRouterModel[];
    },
  ): void {
    const { name, desc, modelKey, customKey, placeholder, getModels } = options;

    const useCustom = this.plugin.settings[customKey] as boolean;
    const models = getModels();
    const hasModels = models.length > 0;
    const isManualMode = useCustom || !hasModels;

    // 1. Model Selection (Dropdown or Input)
    const modelSetting = new Setting(containerEl).setName(name).setDesc(desc);

    if (isManualMode) {
      // Manual Input Mode
      modelSetting.addText((text) =>
        text
          .setPlaceholder(placeholder)
          .setValue((this.plugin.settings[modelKey] as string) || "")
          .onChange(async (value) => {
            (this.plugin.settings[modelKey] as string) = value;
            await this.plugin.saveSettings();
          }),
      );

      if (!hasModels && !useCustom) {
        modelSetting.descEl.createEl("div", {
          text: t("No models available"),
          cls: "canvas-ai-model-hint",
          attr: { style: "color: var(--text-muted); font-size: 0.8em;" },
        });
      }
    } else {
      // Dropdown Mode
      modelSetting.addDropdown((dropdown) => {
        const currentValue = this.plugin.settings[modelKey] as string;

        // Add current value first if not in list (to preserve custom values)
        const modelIds = models.map((m) => m.id);
        if (currentValue && !modelIds.includes(currentValue)) {
          dropdown.addOption(currentValue, `${currentValue} (Current)`);
        }

        // Add all models from API
        for (const model of models) {
          // Keep option text concise to avoid oversized dropdown rows.
          dropdown.addOption(model.id, model.name || model.id);
        }

        dropdown.setValue(currentValue || "");
        dropdown.onChange(async (value) => {
          (this.plugin.settings[modelKey] as string) = value;
          await this.plugin.saveSettings();
        });

        // Explicit keyboard up/down selection for model dropdowns.
        dropdown.selectEl.addEventListener(
          "keydown",
          (event: KeyboardEvent) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();

            const options = Array.from(dropdown.selectEl.options);
            const currentIndex = dropdown.selectEl.selectedIndex;
            if (options.length === 0 || currentIndex < 0) return;

            const nextIndex =
              event.key === "ArrowDown"
                ? Math.min(options.length - 1, currentIndex + 1)
                : Math.max(0, currentIndex - 1);
            if (nextIndex === currentIndex) return;

            const nextValue = options[nextIndex].value;
            dropdown.setValue(nextValue);
            void (async () => {
              (this.plugin.settings[modelKey] as string) = nextValue;
              await this.plugin.saveSettings();
            })();
          },
        );
      });
    }

    // Add "Add to Quick Switch" button
    const provider = this.plugin.settings.apiProvider;
    const currentModelId = this.plugin.settings[modelKey] as string;
    if (currentModelId) {
      modelSetting.addButton((btn) =>
        btn.setButtonText(t("Add to quick switch")).onClick(async () => {
          // Get current model ID at click time (not closure capture time)
          const modelIdNow = this.plugin.settings[modelKey] as string;
          if (!modelIdNow) {
            new Notice(t("No model selected"));
            return;
          }

          const targetList = this.plugin.settings.quickSwitchImageModels || [];

          const key = `${provider}|${modelIdNow}`;
          if (targetList.some((m) => `${m.provider}|${m.modelId}` === key)) {
            new Notice(t("Model already exists"));
            return;
          }

          targetList.push({
            provider: provider,
            modelId: modelIdNow,
            displayName: this.getModelDisplayName(modelIdNow),
          });

          this.plugin.settings.quickSwitchImageModels = targetList;

          await this.plugin.saveSettings();
          new Notice(t("Model added"));
          this.display();
        }),
      );
    }

    // 2. Manual Input Toggle + Add to Quick Switch Button (Same Line)
    new Setting(containerEl)
      .setName(t("Manually enter model name"))
      .setDesc(
        isManualMode ? t("Disable manual model") : t("Enable manual model"),
      )
      .addToggle((toggle) =>
        toggle.setValue(useCustom || false).onChange(async (value) => {
          (this.plugin.settings[customKey] as boolean) = value;
          await this.plugin.saveSettings();
          // Re-render to switch between dropdown and text input
          this.display();
        }),
      );
  }
}
