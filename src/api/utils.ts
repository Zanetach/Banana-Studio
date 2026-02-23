/**
 * API 工具函数
 */

import { requestUrl, RequestUrlParam, RequestUrlResponse } from "obsidian";
import type { HttpError } from "./types";

/**
 * Type guard for HTTP errors from requestUrl
 */
export function isHttpError(error: unknown): error is HttpError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as HttpError).status === "number"
  );
}

/**
 * Extract error message from unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

/**
 * Wraps requestUrl with a timeout mechanism using Promise.race
 * @param params Request parameters
 * @param timeoutMs Timeout in milliseconds
 * @returns Promise that rejects with timeout error if request takes too long
 */
export async function requestUrlWithTimeout(
  params: RequestUrlParam,
  timeoutMs: number,
): Promise<RequestUrlResponse> {
  let timeoutId: number | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`TIMEOUT:${timeoutMs}`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([requestUrl(params), timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}

/**
 * Create a timeout-backed abort signal.
 * If parentSignal aborts, derived signal aborts too.
 */
export function createAbortSignalWithTimeout(
  timeoutMs: number,
  parentSignal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onParentAbort = (): void => controller.abort();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timer);
      if (parentSignal) {
        parentSignal.removeEventListener("abort", onParentAbort);
      }
    },
  };
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  return false;
}
