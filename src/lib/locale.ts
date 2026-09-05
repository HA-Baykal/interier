import { cookies } from "next/headers";
import { Locale } from "./types";

const COOKIE = "lang";

export function getLocale(): Locale {
  const v = cookies().get(COOKIE)?.value;
  return v === "en" ? "en" : "ru";
}

export function setLocale(locale: Locale, isSecure = false) {
  cookies().set(COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: isSecure ? "none" : "lax",
    secure: isSecure,
  });
}
