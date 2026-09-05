/** Hosting panels sometimes leave quotes, CR/LF or whitespace around values. */
export function cleanConfigValue(value: string | null | undefined): string {
  let result = (value ?? "").replace(/[\r\n]/g, "").trim();
  while (result.length >= 2 &&
    ((result.startsWith('"') && result.endsWith('"')) ||
      (result.startsWith("'") && result.endsWith("'")) ||
      (result.startsWith("`") && result.endsWith("`")))) {
    result = result.slice(1, -1).trim();
  }
  return result;
}

/** Tokens/URLs/model IDs cannot contain whitespace, unlike user passwords. */
export function cleanConnectionValue(value: string | null | undefined): string {
  return cleanConfigValue(value).replace(/\s/g, "");
}
