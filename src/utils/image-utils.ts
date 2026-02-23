/**
 * 图片工具函数 - 共享于 Notes 和 Sidebar 模块
 */

import { App, TFile, TFolder, Vault } from "obsidian";
import type { CanvasAISettings } from "../settings/settings";

/**
 * 生成唯一 ID
 */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
}

/**
 * 解析图片路径（相对于文件所在目录或 vault 根目录）
 */
export function resolveImagePath(
  app: App,
  filePath: string,
  imgPath: string,
): string | null {
  // 先尝试从 vault 根目录查找
  const file = app.vault.getAbstractFileByPath(imgPath);
  if (file) {
    return imgPath;
  }

  // 尝试相对于文件所在目录
  const fileDir = filePath.substring(0, filePath.lastIndexOf("/"));
  const relativePath = fileDir ? `${fileDir}/${imgPath}` : imgPath;
  const relativeFile = app.vault.getAbstractFileByPath(relativePath);
  if (relativeFile) {
    return relativePath;
  }

  return null;
}

/**
 * 提取文档中的内嵌图片 ![[image.png]] 并读取为 base64
 */
export async function extractDocumentImages(
  app: App,
  content: string,
  filePath: string,
  settings: CanvasAISettings,
): Promise<{ base64: string; mimeType: string; type: "image" }[]> {
  const images: { base64: string; mimeType: string; type: "image" }[] = [];

  const matches: string[] = [];

  // 解析 Obsidian 语法 ![[image.png]]
  const obsidianRegex = /!\[\[([^\]]+\.(png|jpg|jpeg|gif|webp|svg|bmp))\]\]/gi;
  let match;
  while ((match = obsidianRegex.exec(content)) !== null) {
    matches.push(match[1]);
  }

  // 解析 Markdown 语法 ![alt](path/image.png) / ![alt](<path/image.png>)
  const markdownRegex =
    /!\[[^\]]*]\(([^)]+\.(?:png|jpg|jpeg|gif|webp|svg|bmp)[^)]*)\)/gi;
  while ((match = markdownRegex.exec(content)) !== null) {
    const rawTarget = (match[1] || "").trim();
    const normalizedTarget = normalizeMarkdownImageTarget(rawTarget);
    if (normalizedTarget) {
      matches.push(normalizedTarget);
    }
  }

  if (matches.length === 0) {
    return images;
  }

  const MAX_IMAGES = 14;

  for (const imgPath of matches) {
    if (images.length >= MAX_IMAGES) {
      console.debug(
        `Image Utils: Image limit (${MAX_IMAGES}) reached, skipping remaining`,
      );
      break;
    }

    // 解析图片路径
    const resolvedPath = resolveImagePath(app, filePath, imgPath);
    if (!resolvedPath) continue;

    try {
      const imgData = await readSingleImageFile(
        app,
        resolvedPath,
        settings.imageCompressionQuality,
        settings.imageMaxSize,
      );
      if (imgData) {
        images.push({
          base64: imgData.base64,
          mimeType: imgData.mimeType,
          type: "image",
        });
      }
    } catch (e) {
      console.warn("Image Utils: Failed to read embedded image:", imgPath, e);
    }
  }

  return images;
}

function normalizeMarkdownImageTarget(rawTarget: string): string {
  if (!rawTarget) return "";

  // 处理 ![alt](<path/to/img.png>)
  if (rawTarget.startsWith("<") && rawTarget.includes(">")) {
    return rawTarget.slice(1, rawTarget.indexOf(">")).trim();
  }

  // 处理 ![alt](path/to/img.png "title")
  return rawTarget.split(/\s+/)[0]?.trim() || "";
}

/**
 * 保存生成的图片到 vault（优先使用设置目录，否则保存到当前文件同目录）
 */
export async function saveImageToVault(
  vault: Vault,
  base64DataUrl: string,
  currentFile: TFile,
  targetFolder?: string,
): Promise<{ fileName: string; filePath: string }> {
  const timestamp = Date.now();
  const fileName = `ai-generated-${timestamp}.png`;

  const preferredFolder = (targetFolder || "").trim();
  // 保存到设置目录（如有），否则回退到当前文件目录
  const rawFolder = preferredFolder || currentFile.parent?.path || "";
  // Obsidian 根目录可能是 "/"，这里统一归一化，避免出现 "//file.png"。
  const folder = normalizeFolderPath(rawFolder);
  if (folder) {
    await ensureFolderExists(vault, folder);
  }
  const filePath = folder ? `${folder}/${fileName}` : fileName;

  // 转换 base64 并写入
  const base64 = base64DataUrl.replace(/^data:image\/\w+;base64,/, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  await vault.createBinary(filePath, bytes.buffer);
  return { fileName, filePath };
}

function normalizeFolderPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed === "/") return "";
  return trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
}

async function ensureFolderExists(
  vault: Vault,
  folderPath: string,
): Promise<void> {
  const normalized = normalizeFolderPath(folderPath);
  if (!normalized) return;

  const existing = vault.getAbstractFileByPath(normalized);
  if (existing instanceof TFolder) {
    return;
  }
  if (existing && !(existing instanceof TFolder)) {
    throw new Error(`保存路径冲突：${normalized} 已存在且不是文件夹`);
  }

  const segments = normalized.split("/").filter(Boolean);
  let current = "";
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    const node = vault.getAbstractFileByPath(current);
    if (node instanceof TFolder) continue;
    if (node && !(node instanceof TFolder)) {
      throw new Error(`保存路径冲突：${current} 已存在且不是文件夹`);
    }
    await vault.createFolder(current);
  }
}

async function readSingleImageFile(
  app: App,
  filePath: string,
  compressionQuality: number = 80,
  maxSize: number = 2048,
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const file = app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      return null;
    }

    const buffer = await app.vault.readBinary(file);
    const compressedBase64 = await compressImageToWebP(
      buffer,
      compressionQuality,
      maxSize,
    );

    return {
      base64: compressedBase64,
      mimeType: "image/webp",
    };
  } catch (error) {
    console.warn(`Image Utils: Failed to read image file ${filePath}`, error);
    return null;
  }
}

async function compressImageToWebP(
  buffer: ArrayBuffer,
  quality: number,
  maxSize: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([buffer]);
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      try {
        let targetWidth = img.width;
        let targetHeight = img.height;

        if (targetWidth > maxSize || targetHeight > maxSize) {
          const scale = Math.min(maxSize / targetWidth, maxSize / targetHeight);
          targetWidth = Math.round(targetWidth * scale);
          targetHeight = Math.round(targetHeight * scale);
        }

        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Failed to get canvas context"));
          return;
        }

        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
        const webpQuality = Math.max(0, Math.min(1, quality / 100));
        const dataUrl = canvas.toDataURL("image/webp", webpQuality);
        const base64 = dataUrl.replace(/^data:image\/webp;base64,/, "");
        resolve(base64);
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };

    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };

    img.src = url;
  });
}
