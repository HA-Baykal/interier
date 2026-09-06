/** Pure interaction geometry, reusable by web/native viewers. */
export function clampComparison(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 50;
}
export function comparisonClip(position: number): string {
  return `inset(0 ${100 - clampComparison(position)}% 0 0)`;
}
export function dragComparison(start: number, deltaX: number, width: number): number {
  return width > 0 ? clampComparison(start + deltaX / width * 100) : clampComparison(start);
}
export function comparisonKey(position: number, key: string, largeStep = false): number | null {
  const step = largeStep ? 10 : 1;
  if (key === "Home") return 0;
  if (key === "End") return 100;
  if (key === "ArrowLeft" || key === "ArrowDown") return clampComparison(position - step);
  if (key === "ArrowRight" || key === "ArrowUp") return clampComparison(position + step);
  return null;
}
export function fitImage(width: number, height: number, availableWidth: number, availableHeight: number) {
  if (![width, height, availableWidth, availableHeight].every(Number.isFinite) || width <= 0 || height <= 0 || availableWidth <= 0 || availableHeight <= 0) return { width: 1, height: 1 };
  const scale = Math.min(availableWidth / width, availableHeight / height, 1);
  return { width: Math.max(1, width * scale), height: Math.max(1, height * scale) };
}
