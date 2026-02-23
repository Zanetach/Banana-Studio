import type { CanvasAISettings } from "../../settings/settings";
import type {
  OpenRouterContentPart,
  OpenRouterMessage,
  OpenRouterRequest,
  OpenRouterResponse,
} from "../types";
import {
  isHttpError,
  getErrorMessage,
  requestUrlWithTimeout,
  createAbortSignalWithTimeout,
  isAbortError,
} from "../utils";

export class OpenAIProvider {
  private settings: CanvasAISettings;

  constructor(settings: CanvasAISettings) {
    this.settings = settings;
  }

  updateSettings(settings: CanvasAISettings): void {
    this.settings = settings;
  }

  getApiKey(): string {
    return this.settings.openAIApiKey || "";
  }

  getTextModel(): string {
    return this.settings.openAITextModel || "gpt-4o-mini";
  }

  getImageModel(): string {
    return this.settings.openAIImageModel || "gpt-image-1";
  }

  private getChatEndpoint(): string {
    const base = this.settings.openAIBaseUrl || "https://api.openai.com";
    return `${base.replace(/\/+$/, "")}/v1/chat/completions`;
  }

  private getImageEndpoint(): string {
    const base = this.settings.openAIBaseUrl || "https://api.openai.com";
    return `${base.replace(/\/+$/, "")}/v1/images/generations`;
  }

  async chatCompletion(
    prompt: string,
    systemPrompt?: string,
    temperature: number = 0.5,
  ): Promise<string> {
    const messages: OpenRouterMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const requestBody: OpenRouterRequest = {
      model: this.getTextModel(),
      messages,
      temperature,
    };

    const response = await this.sendChatRequest(requestBody);
    if (!response.choices || response.choices.length === 0) {
      throw new Error("OpenAI returned no choices");
    }
    const content = response.choices[0].message.content;
    return typeof content === "string"
      ? content
      : content.map((p) => p.text || "").join("");
  }

  async *streamChatCompletion(
    prompt: string,
    systemPrompt?: string,
    temperature: number = 0.5,
  ): AsyncGenerator<{ content?: string; thinking?: string }, void, unknown> {
    const messages: OpenRouterMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const requestBody: OpenRouterRequest & { stream: boolean } = {
      model: this.getTextModel(),
      messages,
      temperature,
      stream: true,
    };

    const response = await globalThis.fetch(this.getChatEndpoint(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API Error: ${response.status} ${errorText}`);
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

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;

        try {
          const data = JSON.parse(trimmed.slice(6));
          const delta = data.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            yield { content: delta };
          }
        } catch {
          // ignore malformed partial chunk
        }
      }
    }
  }

  async generateImage(
    instruction: string,
    imagesWithRoles: { base64: string; mimeType: string; role: string }[],
    contextText?: string,
    aspectRatio?: string,
    resolution?: string,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const promptParts: string[] = [];
    if (this.settings.imageSystemPrompt) {
      promptParts.push(this.settings.imageSystemPrompt);
    }
    if (contextText && contextText.trim()) {
      promptParts.push(`[Context]\n${contextText.trim()}`);
    }
    // OpenAI images API 暂不直接传入参考图二进制，这里将数量信息写入提示词。
    if (imagesWithRoles.length > 0) {
      promptParts.push(
        `参考图数量：${imagesWithRoles.length}（请尽量贴近参考图风格与构图）`,
      );
    }
    promptParts.push(`INSTRUCTION: ${instruction}`);

    const size = this.mapImageSize(aspectRatio, resolution);
    const body: {
      model: string;
      prompt: string;
      size?: string;
      quality?: string;
    } = {
      model: this.getImageModel(),
      prompt: promptParts.join("\n\n"),
      quality: "auto",
    };
    if (size) {
      body.size = size;
    }

    const timeoutMs = (this.settings.imageGenerationTimeout || 120) * 1000;
    const { signal, cleanup } = createAbortSignalWithTimeout(
      timeoutMs,
      abortSignal,
    );
    let data:
      | {
          data?: Array<{ b64_json?: string; url?: string }>;
          error?: { message?: string };
        }
      | undefined;
    try {
      const res = await globalThis.fetch(this.getImageEndpoint(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.getApiKey()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`OpenAI API Error (${res.status}): ${errorText}`);
      }
      data = (await res.json()) as {
        data?: Array<{ b64_json?: string; url?: string }>;
        error?: { message?: string };
      };
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw new DOMException("Image generation aborted", "AbortError");
      }
      throw error;
    } finally {
      cleanup();
    }

    if (data.error?.message) {
      throw new Error(`OpenAI API Error: ${data.error.message}`);
    }

    const first = data.data?.[0];
    if (!first) {
      throw new Error("OpenAI returned no image");
    }

    if (first.b64_json) {
      return `data:image/png;base64,${first.b64_json}`;
    }
    if (first.url) {
      return first.url;
    }

    throw new Error("OpenAI image response missing b64_json/url");
  }

  async multimodalChat(
    prompt: string,
    mediaList: { base64: string; mimeType: string; type: "image" | "pdf" }[],
    systemPrompt?: string,
    temperature: number = 0.5,
  ): Promise<{ content: string; thinking?: string }> {
    const messages: OpenRouterMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }

    const contentParts: OpenRouterContentPart[] = [];
    contentParts.push({ type: "text", text: prompt });

    for (const media of mediaList) {
      if (media.type !== "image") continue;
      contentParts.push({
        type: "image_url",
        image_url: { url: `data:${media.mimeType};base64,${media.base64}` },
      });
    }

    messages.push({ role: "user", content: contentParts });

    const requestBody: OpenRouterRequest = {
      model: this.getTextModel(),
      messages,
      temperature,
    };

    const response = await this.sendChatRequest(requestBody);
    if (!response.choices || response.choices.length === 0) {
      throw new Error("OpenAI returned no choices");
    }

    const content = response.choices[0].message.content;
    const text =
      typeof content === "string"
        ? content
        : content.map((p) => p.text || "").join("");

    return { content: text };
  }

  private mapImageSize(
    aspectRatio?: string,
    resolution?: string,
  ): string | undefined {
    const quality = (resolution || "").toUpperCase();
    if (aspectRatio === "9:16") return "1024x1536";
    if (aspectRatio === "16:9") return "1536x1024";
    if (aspectRatio === "1:1") {
      if (quality === "2K" || quality === "4K") return "1536x1536";
      return "1024x1024";
    }
    if (aspectRatio === "4:3") return "1536x1024";
    if (aspectRatio === "3:4") return "1024x1536";
    return undefined;
  }

  private async sendChatRequest(
    requestBody: OpenRouterRequest,
  ): Promise<OpenRouterResponse> {
    const timeoutMs = (this.settings.imageGenerationTimeout || 120) * 1000;
    const requestParams = {
      url: this.getChatEndpoint(),
      method: "POST" as const,
      headers: {
        Authorization: `Bearer ${this.getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    };

    try {
      const response = await requestUrlWithTimeout(requestParams, timeoutMs);
      return response.json as OpenRouterResponse;
    } catch (error: unknown) {
      if (isHttpError(error)) {
        throw new Error(`OpenAI API Error (${error.status}): ${error.message}`);
      }
      throw new Error(`OpenAI API request failed: ${getErrorMessage(error)}`);
    }
  }
}
