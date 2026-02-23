/**
 * 图片工具函数 - 共享于 Notes 和 Sidebar 模块
 */

import { App, TFile, Vault } from "obsidian";
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

  // 解析 ![[image.png]] 语法
  const regex = /!\[\[([^\]]+\.(png|jpg|jpeg|gif|webp|svg|bmp))\]\]/gi;
  const matches: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    matches.push(match[1]);
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

/**
 * 保存生成的图片到 vault（与当前文件相同目录）
 */
export async function saveImageToVault(
  vault: Vault,
  base64DataUrl: string,
  currentFile: TFile,
): Promise<{ fileName: string; filePath: string }> {
  const timestamp = Date.now();
  const fileName = `ai-generated-${timestamp}.png`;

  // 保存到与当前文件相同目录
  const folder = currentFile.parent?.path || "";
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
