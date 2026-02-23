/**
 * Gemini Provider
 * 处理 Gemini 原生 API 调用
 */

import { requestUrl, RequestUrlParam } from "obsidian";
import type { CanvasAISettings } from "../../settings/settings";
import type {
  GeminiRequest,
  GeminiResponse,
  GeminiPart,
  GeminiContent,
} from "../types";
import {
  isHttpError,
  getErrorMessage,
  createAbortSignalWithTimeout,
  isAbortError,
} from "../utils";

export class GeminiProvider {
  private settings: CanvasAISettings;

  constructor(settings: CanvasAISettings) {
    this.settings = settings;
  }

  updateSettings(settings: CanvasAISettings): void {
    this.settings = settings;
  }

  private get providerName(): string {
    return "gemini";
  }

  getApiKey(): string {
    return this.settings.geminiApiKey || "";
  }

  getTextModel(): string {
    const model = this.settings.geminiTextModel || "gemini-2.5-flash";
    return this.normalizeModel(model);
  }

  getImageModel(): string {
    const model =
      this.settings.geminiImageModel || "gemini-2.5-flash-preview-05-20";
    return this.normalizeModel(model);
  }

  private getBaseUrl(): string {
    return (
      this.settings.geminiBaseUrl || "https://generativelanguage.googleapis.com"
    );
  }

  private normalizeModel(model: string): string {
    return (model || "").replace(/^google\//, "");
  }

  private getEndpoint(model: string): string {
    const baseUrl = this.getBaseUrl();
    const apiKey = this.getApiKey();
    return `${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`;
  }

  /**
   * Chat completion
   */
  async chatCompletion(
    prompt: string | GeminiContent[],
    systemPrompt?: string,
    temperature: number = 1.0,
  ): Promise<string> {
    const model = this.getTextModel();
    const endpoint = this.getEndpoint(model);

    let contents: GeminiContent[] = [];

    if (typeof prompt === "string") {
      contents = [{ role: "user", parts: [{ text: prompt }] }];
    } else {
      contents = prompt;
    }

    const requestBody: GeminiRequest = {
      contents: contents,
      generationConfig: { temperature: temperature },
    };

    if (systemPrompt) {
      requestBody.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    console.debug(
      `Banana Studio: [${this.providerName}] Sending chat request...`,
    );

    const requestParams: RequestUrlParam = {
      url: endpoint,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    };

    try {
      const response = await requestUrl(requestParams);
      const data = response.json as GeminiResponse;
      return this.extractTextFromResponse(data);
    } catch (error: unknown) {
      this.handleError(error);
    }
  }

  /**
   * Generate image
   */
  async generateImage(
    instruction: string,
    imagesWithRoles: { base64: string; mimeType: string; role: string }[],
    contextText?: string,
    aspectRatio?: string,
    resolution?: string,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const parts: Array<{
      text?: string;
      inlineData?: { mimeType: string; data: string };
    }> = [];

    // System context
    parts.push({
      text:
        this.settings.imageSystemPrompt ||
        "You are an expert creator. Use the following references.",
    });

    // Add images with role annotations
    for (const img of imagesWithRoles) {
      const mime = img.mimeType || "image/png";
      parts.push({ text: `\n[Ref: ${img.role}]` });
      parts.push({ inlineData: { mimeType: mime, data: img.base64 } });
    }

    // Add context text
    if (contextText && contextText.trim()) {
      parts.push({ text: `\n[Context]\n${contextText}` });
    }

    // Add instruction
    parts.push({ text: `\nINSTRUCTION: ${instruction}` });

    const requestBody: GeminiRequest = {
      contents: [{ role: "user", parts: parts }],
      generationConfig: { responseModalities: ["image"] },
    };

    // Add image config
    if (aspectRatio || resolution) {
      if (!requestBody.generationConfig) {
        requestBody.generationConfig = {};
      }
      requestBody.generationConfig.imageConfig = {};
      if (aspectRatio) {
        requestBody.generationConfig.imageConfig.aspectRatio = aspectRatio;
      }
      if (resolution) {
        requestBody.generationConfig.imageConfig.imageSize = resolution;
      }
    }

    console.debug(
      `Banana Studio: [${this.providerName}] Sending image generation request...`,
    );

    const model = this.getImageModel();
    const endpoint = this.getEndpoint(model);

    try {
      const timeoutMs = (this.settings.imageGenerationTimeout || 120) * 1000;
      console.debug(
        `Banana Studio: Image generation timeout set to ${timeoutMs / 1000}s`,
      );
      const { signal, cleanup } = createAbortSignalWithTimeout(
        timeoutMs,
        abortSignal,
      );
      let data: GeminiResponse;
      try {
        const response = await globalThis.fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal,
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        data = (await response.json()) as GeminiResponse;
      } catch (error: unknown) {
        if (isAbortError(error)) {
          throw new DOMException("Image generation aborted", "AbortError");
        }
        throw error;
      } finally {
        cleanup();
      }

      return this.parseGeminiImageResponse(data);
    } catch (error: unknown) {
      const errMsg = getErrorMessage(error);
      if (errMsg.startsWith("TIMEOUT:")) {
        const timeoutSec = parseInt(errMsg.split(":")[1]) / 1000;
        throw new Error(
          `Image generation timed out after ${timeoutSec} seconds.`,
        );
      }
      this.handleError(error);
    }
  }

  /**
   * Multimodal chat - returns content and optional thinking
   */
  async multimodalChat(
    prompt: string,
    mediaList: { base64: string; mimeType: string; type: "image" | "pdf" }[],
    systemPrompt?: string,
    temperature: number = 1.0,
    thinkingConfig?: {
      enabled: boolean;
      budgetTokens?: number;
      level?: "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";
    },
  ): Promise<{ content: string; thinking?: string }> {
    const model = this.getTextModel();
    const endpoint = this.getEndpoint(model);

    const parts: Array<{
      text?: string;
      inlineData?: { mimeType: string; data: string };
    }> = [];

    // Add text prompt first
    parts.push({ text: prompt });

    // Add images and PDFs as inlineData
    for (const media of mediaList) {
      const mime = media.mimeType || "image/png";
      parts.push({ inlineData: { mimeType: mime, data: media.base64 } });
    }

    const requestBody: GeminiRequest = {
      contents: [{ role: "user", parts: parts }],
      generationConfig: { temperature: temperature },
    };

    // Add thinking config - must explicitly set includeThoughts for Gemini 2.5+ models
    // which have thinking enabled by default
    if (thinkingConfig) {
      const genConfig = requestBody.generationConfig!;
      genConfig.thinkingConfig = {
        includeThoughts: thinkingConfig.enabled,
      };
      if (thinkingConfig.enabled && thinkingConfig.level) {
        genConfig.thinkingConfig.thinkingLevel = thinkingConfig.level;
      } else if (thinkingConfig.enabled) {
        genConfig.thinkingConfig.thinkingBudget =
          thinkingConfig.budgetTokens || 8192;
      }
      console.debug(
        `Banana Studio: [${this.providerName}] Multimodal Thinking config:`,
        JSON.stringify(genConfig.thinkingConfig),
      );
    }

    if (systemPrompt) {
      requestBody.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    console.debug(
      `Banana Studio: [${this.providerName}] Sending multimodal chat request...`,
    );

    const requestParams: RequestUrlParam = {
      url: endpoint,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    };

    try {
      const response = await requestUrl(requestParams);
      const data = response.json as GeminiResponse;
      return this.extractTextAndThinkingFromResponse(data);
    } catch (error: unknown) {
      this.handleError(error);
    }
  }

  /**
   * Extract text and thinking from response
   */
  private extractTextAndThinkingFromResponse(data: GeminiResponse): {
    content: string;
    thinking?: string;
    thoughtSignature?: string;
  } {
    const candidates = data.candidates;
    if (!candidates || candidates.length === 0) {
      throw new Error("Gemini returned no candidates");
    }

    const parts = candidates[0]?.content?.parts;
    if (!parts || parts.length === 0) {
      throw new Error("Gemini returned no parts in response");
    }

    // Separate thinking and output parts
    const thinkingParts = parts.filter((p: GeminiPart) => p.text && p.thought);
    const outputParts = parts.filter((p: GeminiPart) => p.text && !p.thought);

    const textPart =
      outputParts.length > 0
        ? outputParts[outputParts.length - 1]
        : parts.find((p: GeminiPart) => p.text);

    if (!textPart?.text) {
      throw new Error("Gemini returned no text in response");
    }

    const thinking = thinkingParts.map((p) => p.text).join("");
    // Extract thought signatures
    const thoughtSignature = parts.find(
      (p) => p.thoughtSignature,
    )?.thoughtSignature;

    console.debug(
      `Banana Studio: [${this.providerName}] Received response (thinking: ${
        thinking.length > 0 ? "yes" : "no"
      }, signature: ${thoughtSignature ? "yes" : "no"})`,
    );

    return {
      content: textPart.text,
      thinking: thinking || undefined,
      thoughtSignature,
    };
  }

  /**
   * Legacy wrapper - extract text only (for backward compatibility)
   */
  private extractTextFromResponse(data: GeminiResponse): string {
    return this.extractTextAndThinkingFromResponse(data).content;
  }

  private async parseGeminiImageResponse(
    data: GeminiResponse,
  ): Promise<string> {
    const candidates = data.candidates;
    if (!candidates || candidates.length === 0) {
      throw new Error("Gemini returned no candidates");
    }

    const parts = candidates[0]?.content?.parts;
    if (!parts || parts.length === 0) {
      throw new Error("Gemini returned no parts in response");
    }

    // Find image part (skip thinking parts)
    for (const part of parts) {
      if (part.thought) continue;

      // Check for inlineData (base64)
      if (part.inlineData) {
        const mimeType = part.inlineData.mimeType || "image/png";
        const base64Data = part.inlineData.data;
        console.debug(
          "Banana Studio: Gemini returned base64 image, mimeType:",
          mimeType,
        );
        return `data:${mimeType};base64,${base64Data}`;
      }

      // Check for file_data (URL)
      if (part.file_data) {
        const url = part.file_data.file_uri;
        console.debug("Banana Studio: Gemini returned URL, fetching:", url);
        return await this.fetchImageAsDataUrl(url);
      }
    }

    // No image found
    const outputParts = parts.filter((p: GeminiPart) => p.text && !p.thought);
    const textPart =
      outputParts.length > 0
        ? outputParts[outputParts.length - 1]
        : parts.find((p: GeminiPart) => p.text);
    const textContent = textPart?.text || "No image returned";
    throw new Error(`Image generation failed: ${textContent}`);
  }

  private async fetchImageAsDataUrl(url: string): Promise<string> {
    try {
      const response = await requestUrl({ url, method: "GET" });
      const arrayBuffer = response.arrayBuffer;

      let mimeType = "image/png";
      const contentType = response.headers["content-type"];
      if (contentType) {
        mimeType = contentType.split(";")[0].trim();
      } else if (url.includes(".jpg") || url.includes(".jpeg")) {
        mimeType = "image/jpeg";
      } else if (url.includes(".webp")) {
        mimeType = "image/webp";
      }

      const uint8Array = new Uint8Array(arrayBuffer);
      const base64Data = this.encodeBytesToBase64(uint8Array);

      console.debug(
        "Banana Studio: Fetched image, mimeType:",
        mimeType,
        "size:",
        arrayBuffer.byteLength,
      );
      return `data:${mimeType};base64,${base64Data}`;
    } catch (error: unknown) {
      throw new Error(`Failed to fetch image: ${getErrorMessage(error)}`);
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
    return window.btoa(parts.join(""));
  }

  private handleError(error: unknown): never {
    if (isHttpError(error)) {
      const errorBody = error.json || { message: error.message };
      const errorMessage =
        (errorBody as Record<string, Record<string, string>>).error?.message ||
        error.message;
      console.error(
        `Banana Studio: ${this.providerName} HTTP Error`,
        error.status,
        errorBody,
      );
      throw new Error(`HTTP ${error.status}: ${errorMessage}`);
    }
    throw error;
  }
  /**
   * Chat completion with streaming
   */
  async *streamChatCompletion(
    prompt: string | GeminiContent[],
    systemPrompt?: string,
    temperature: number = 1.0,
    thinkingConfig?: {
      enabled: boolean;
      budgetTokens?: number;
      level?: "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";
    },
  ): AsyncGenerator<
    { content?: string; thinking?: string; thoughtSignature?: string },
    void,
    unknown
  > {
    const model = this.getTextModel();
    // Append :streamGenerateContent and alt=sse for streaming
    const endpoint = `${this.getBaseUrl()}/v1beta/models/${model}:streamGenerateContent?key=${this.getApiKey()}&alt=sse`;

    let contents: GeminiContent[] = [];

    if (typeof prompt === "string") {
      contents = [{ role: "user", parts: [{ text: prompt }] }];
    } else {
      contents = prompt;
    }

    const requestBody: GeminiRequest = {
      contents: contents,
      generationConfig: { temperature: temperature },
    };

    // Add thinking config - must explicitly set includeThoughts for Gemini 2.5+ models
    // which have thinking enabled by default
    if (thinkingConfig) {
      const genConfig = requestBody.generationConfig!;
      genConfig.thinkingConfig = {
        includeThoughts: thinkingConfig.enabled,
      };
      if (thinkingConfig.enabled && thinkingConfig.level) {
        genConfig.thinkingConfig.thinkingLevel = thinkingConfig.level;
      } else if (thinkingConfig.enabled) {
        genConfig.thinkingConfig.thinkingBudget =
          thinkingConfig.budgetTokens || 8192;
      }
      console.debug(
        `Banana Studio: [${this.providerName}] Thinking config:`,
        JSON.stringify(genConfig.thinkingConfig),
      );
    }

    if (systemPrompt) {
      requestBody.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    console.debug(
      `Banana Studio: [${this.providerName}] Sending stream chat request...`,
    );

    try {
      const response = await globalThis.fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `${this.providerName} API Error: ${response.status} ${errorText}`,
        );
      }

      if (!response.body) {
        throw new Error("Response body is null");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        const lines = buffer.split("\n");

        // Process all complete lines
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith("data: ")) {
            try {
              const dataStr = trimmed.slice(6);
              const data = JSON.parse(dataStr) as GeminiResponse;

              // Extract text from candidates
              if (data.candidates && data.candidates.length > 0) {
                const parts = data.candidates[0].content?.parts;
                if (parts) {
                  for (const part of parts) {
                    if (part.text) {
                      // Check for thought marker
                      if (part.thought) {
                        yield { thinking: part.text };
                      } else {
                        yield { content: part.text };
                      }
                    }

                    // Capture thought signature
                    if (part.thoughtSignature) {
                      yield { thoughtSignature: part.thoughtSignature };
                    }
                  }
                }
              }
            } catch (e) {
              console.warn("Error parsing stream chunk:", e);
            }
          }
        }
      }
    } catch (error) {
      console.error(`Banana Studio: ${this.providerName} Stream Error`, error);
      throw error;
    }
  }
}
