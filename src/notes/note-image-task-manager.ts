/**
 * Note Image Task Manager
 * 管理 Note 模式下的并发图片生成任务
 * 仅负责任务编排与结果回传，不直接修改笔记内容
 */

import { Notice, TFile } from "obsidian";
import { CanvasAISettings } from "../settings/settings";
import { ApiManager } from "../api/api-manager";
import { t } from "../../lang/helpers";
import type { App } from "obsidian";

// 图片任务状态
type ImageTaskStatus = "generating" | "completed" | "failed" | "timeout";

// 单个图片生成任务
interface ImageTask {
  id: string;
  status: ImageTaskStatus;
  startTime: number;
  abortController: AbortController;
  timeoutId: ReturnType<typeof setTimeout>;
}

// 图片生成选项
interface ImageOptions {
  resolution: string;
  aspectRatio: string;
}

// 输入图片
interface InputImage {
  base64: string;
  mimeType: string;
  role: string;
}

export interface SavedImageInfo {
  fileName: string;
  filePath: string;
}

export interface GeneratedImageCandidate {
  taskId: string;
  fileName: string;
  filePath: string;
  notePath: string;
  createdAt: number;
}

export class NoteImageTaskManager {
  private tasks: Map<string, ImageTask> = new Map();
  private taskCounter = 0;
  private settings: CanvasAISettings;

  // 用于检测 Edit 操作是否进行中
  private _isEditInProgress = false;

  constructor(_app: App, settings: CanvasAISettings) {
    this.settings = settings;
  }

  /**
   * 更新设置引用（配置变更时调用）
   */
  updateSettings(settings: CanvasAISettings): void {
    this.settings = settings;
  }

  /**
   * 设置 Edit 进行中状态
   */
  setEditInProgress(value: boolean): void {
    this._isEditInProgress = value;
  }

  /**
   * 检查是否可以启动新的图片生成任务
   */
  canStartImageTask(): boolean {
    // 与 Sidebar 选择张数保持一致，允许最多 9 个并发生图任务
    const max = 9;
    return this.tasks.size < max && !this._isEditInProgress;
  }

  /**
   * 检查是否应该禁用 Edit 功能
   */
  isEditBlocked(): boolean {
    return this.tasks.size > 0;
  }

  /**
   * 获取当前活跃任务数量
   */
  getActiveTaskCount(): number {
    return this.tasks.size;
  }

  /**
   * 启动一个新的图片生成任务（返回候选图元数据）
   */
  async startTask(
    prompt: string,
    contextText: string,
    inputImages: InputImage[],
    imageOptions: ImageOptions,
    apiManager: ApiManager,
    file: TFile,
    onSaveImage: (base64: string, file: TFile) => Promise<SavedImageInfo>,
  ): Promise<GeneratedImageCandidate> {
    // 检查是否可以启动
    if (!this.canStartImageTask()) {
      const max = 9;
      if (this.tasks.size >= max) {
        new Notice(t("Max parallel tasks reached", { max: String(max) }));
      } else if (this._isEditInProgress) {
        new Notice(t("Generation in progress"));
      }
      throw new Error(t("Generation in progress"));
    }

    const taskNum = String(++this.taskCounter).padStart(2, "0");
    const task: ImageTask = {
      id: taskNum,
      status: "generating",
      startTime: Date.now(),
      abortController: new AbortController(),
      timeoutId: 0 as unknown as ReturnType<typeof setTimeout>,
    };
    this.tasks.set(taskNum, task);

    const timeoutSeconds = this.settings.imageGenerationTimeout || 120;
    const timeoutMs = timeoutSeconds * 1000;
    task.timeoutId = setTimeout(
      () => this.handleTimeout(taskNum, timeoutSeconds),
      timeoutMs,
    );

    try {
      const result = await apiManager.generateImageWithRoles(
        prompt,
        inputImages,
        contextText,
        imageOptions.aspectRatio,
        imageOptions.resolution,
        task.abortController.signal,
      );

      clearTimeout(task.timeoutId);

      const activeTask = this.tasks.get(taskNum);
      if (!activeTask || activeTask.status === "timeout") {
        throw new Error(
          t("Image generation timed out", { seconds: String(timeoutSeconds) }),
        );
      }

      const savedImage = await onSaveImage(result, file);
      activeTask.status = "completed";

      new Notice(t("Image generated"));
      return {
        taskId: taskNum,
        fileName: savedImage.fileName,
        filePath: savedImage.filePath,
        notePath: file.path,
        createdAt: Date.now(),
      };
    } catch (e) {
      clearTimeout(task.timeoutId);

      if (!this.tasks.has(taskNum)) {
        throw e;
      }

      if ((e as Error).name !== "AbortError") {
        task.status = "failed";
        const message = e instanceof Error ? e.message : String(e);
        console.error("Note Image Task: Generation failed:", message);
        new Notice(t("Image generation failed"));
      }
      throw e;
    } finally {
      this.tasks.delete(taskNum);
    }
  }

  /**
   * 处理超时
   */
  private handleTimeout(taskId: string, timeoutSeconds: number): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.abortController.abort();
    task.status = "timeout";
    this.tasks.delete(task.id);
    new Notice(
      t("Image generation timed out", { seconds: String(timeoutSeconds) }),
    );
  }

  /**
   * 取消所有任务
   */
  cancelAllTasks(): void {
    for (const task of this.tasks.values()) {
      clearTimeout(task.timeoutId);
      task.abortController.abort();
    }
    this.tasks.clear();
  }

  /**
   * 销毁管理器
   */
  destroy(): void {
    for (const task of this.tasks.values()) {
      clearTimeout(task.timeoutId);
      task.abortController.abort();
    }
    this.tasks.clear();
  }
}
