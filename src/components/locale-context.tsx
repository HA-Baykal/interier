"use client";

import { createContext, useContext } from "react";
import { Locale } from "@/lib/types";
import { t } from "@/lib/i18n";

type LocaleValue = {
  locale: Locale;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Present when the app is wrapped in a provider that can switch language. */
  setLocale?: (locale: Locale) => void;
};

export const LocaleContext = createContext<LocaleValue>({
  locale: "ru",
  t: (key, vars) => t("ru", key, vars),
});

export function useLocale(): LocaleValue {
  return useContext(LocaleContext);
}
