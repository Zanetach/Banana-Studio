import type { CanvasAISettings } from '../../settings/settings';
import { isHttpError, getErrorMessage, requestUrlWithTimeout } from '../utils';

export class ZenMuxProvider {
  private settings: CanvasAISettings;

  constructor(settings: CanvasAISettings) {
    this.settings = settings;
  }

  updateSettings(settings: CanvasAISettings): void {
    this.settings = settings;
  }

  getApiKey(): string {
    return this.settings.zenmuxApiKey || '';
  }

  getTextModel(): string {
    return this.settings.zenmuxTextModel || 'google/gemini-2.5-flash';
  }

  getImageModel(): string {
    return this.settings.zenmuxImageModel || 'google/gemini-3-pro-image-preview';
  }

  private getBaseUrl(): string {
    return (this.settings.zenmuxBaseUrl || 'https://zenmux.ai/api/vertex-ai').replace(/\/+$/, '');
  }

  private parseModel(model: string): { provider: string; modelName: string } {
    const [provider, ...rest] = model.split('/');
    if (rest.length === 0) {
      return { provider: 'google', modelName: provider };
    }
    return { provider, modelName: rest.join('/') };
  }

  private getGenerateEndpoint(model: string, stream: boolean = false): string {
    const { provider, modelName } = this.parseModel(model);
    const op = stream ? 'streamGenerateContent' : 'generateContent';
    return `${this.getBaseUrl()}/v1/publishers/${provider}/models/${modelName}:${op}`;
  }

  async chatCompletion(
    prompt: string,
    systemPrompt?: string,
    temperature: number = 0.7,
  ): Promise<string> {
    const parts: Array<{ text: string }> = [];
    if (systemPrompt?.trim()) {
      parts.push({ text: `[System]\n${systemPrompt.trim()}` });
    }
    parts.push({ text: prompt });

    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature,
        responseModalities: ['TEXT'],
      },
    };

    const data = await this.sendRequest(this.getTextModel(), body);
    const partsOut = data?.candidates?.[0]?.content?.parts || [];
    const text = partsOut
      .map((p: { text?: string }) => p.text || '')
      .join('')
      .trim();

    if (!text) {
      throw new Error('ZenMux returned no text content');
    }
    return text;
  }

  async *streamChatCompletion(
    prompt: string,
    systemPrompt?: string,
    temperature: number = 0.7,
  ): AsyncGenerator<{ content?: string; thinking?: string }, void, unknown> {
    // Fallback: return full response once, keeps behavior stable across providers.
    const full = await this.chatCompletion(prompt, systemPrompt, temperature);
    yield { content: full };
  }

  async generateImage(
    instruction: string,
    imagesWithRoles: { base64: string; mimeType: string; role: string }[],
    contextText?: string,
    aspectRatio?: string,
    resolution?: string,
  ): Promise<string> {
    const parts: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    > = [];

    if (this.settings.imageSystemPrompt?.trim()) {
      parts.push({ text: this.settings.imageSystemPrompt.trim() });
    }

    for (const img of imagesWithRoles) {
      parts.push({ text: `\n[Ref: ${img.role}]` });
      parts.push({
        inlineData: {
          mimeType: img.mimeType || 'image/png',
          data: img.base64,
        },
      });
    }

    if (contextText?.trim()) {
      parts.push({ text: `\n[Context]\n${contextText.trim()}` });
    }

    parts.push({ text: `\nINSTRUCTION: ${instruction}` });

    const generationConfig: {
      responseModalities: string[];
      imageConfig?: { aspectRatio?: string; imageSize?: string };
    } = {
      // ZenMux image generation requires both TEXT and IMAGE modalities.
      responseModalities: ['TEXT', 'IMAGE'],
    };

    if (aspectRatio || resolution) {
      generationConfig.imageConfig = {};
      if (aspectRatio) generationConfig.imageConfig.aspectRatio = aspectRatio;
      if (resolution) generationConfig.imageConfig.imageSize = resolution;
    }

    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig,
    };

    const data = await this.sendRequest(this.getImageModel(), body);
    const responseParts = data?.candidates?.[0]?.content?.parts || [];

    for (const part of responseParts) {
      const inlineData = part?.inlineData;
      if (inlineData?.data) {
        const mimeType = inlineData.mimeType || 'image/png';
        return `data:${mimeType};base64,${inlineData.data}`;
      }
    }

    const text = responseParts
      .map((p: { text?: string }) => p.text || '')
      .join('')
      .trim();
    throw new Error(text || 'ZenMux returned no image content');
  }

  async multimodalChat(
    prompt: string,
    mediaList: { base64: string; mimeType: string; type: 'image' | 'pdf' }[],
    systemPrompt?: string,
    temperature: number = 0.7,
  ): Promise<{ content: string; thinking?: string }> {
    const parts: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    > = [];

    if (systemPrompt?.trim()) {
      parts.push({ text: `[System]\n${systemPrompt.trim()}` });
    }

    for (const media of mediaList) {
      if (media.type !== 'image') continue;
      parts.push({
        inlineData: {
          mimeType: media.mimeType,
          data: media.base64,
        },
      });
    }

    parts.push({ text: prompt });

    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature,
        responseModalities: ['TEXT'],
      },
    };

    const data = await this.sendRequest(this.getTextModel(), body);
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p: { text?: string }) => p.text || '')
      .join('')
      .trim();

    return { content: text };
  }

  private async sendRequest(model: string, body: object): Promise<any> {
    const timeoutMs = (this.settings.imageGenerationTimeout || 120) * 1000;
    const requestParams = {
      url: this.getGenerateEndpoint(model, false),
      method: 'POST' as const,
      headers: {
        Authorization: `Bearer ${this.getApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    };

    try {
      const response = await requestUrlWithTimeout(requestParams, timeoutMs);
      return response.json;
    } catch (error: unknown) {
      if (isHttpError(error)) {
        throw new Error(`ZenMux API Error (${error.status}): ${error.message}`);
      }
      throw new Error(`ZenMux API request failed: ${getErrorMessage(error)}`);
    }
  }
}
