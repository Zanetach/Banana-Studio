import { moment } from "obsidian";
import en from "./locale/en.json";
import zhCN from "./locale/zh-cn.json";

// Define the type of our keys based on the English file (source of truth)
export type LocaleKeys = keyof typeof en;

const localeMap: Record<string, Partial<typeof en>> = {
  en: en,
  "zh-cn": zhCN,
  zh: zhCN,
};

function resolveLang(): string {
  let lang = moment.locale();
  if (lang.startsWith("zh")) {
    lang = "zh-cn";
  }
  if (!localeMap[lang]) {
    lang = "en";
  }
  return lang;
}

export function isZhLocale(): boolean {
  return resolveLang() === "zh-cn";
}

/**
 * Get a localized string
 */
export function t(
  key: LocaleKeys,
  params?: Record<string, string | number>,
): string {
  const lang = resolveLang();
  const dict = localeMap[lang];
  let str = dict[key] || en[key] || key;

  if (params) {
    Object.keys(params).forEach((k) => {
      str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(params[k]));
    });
  }

  return str;
}
