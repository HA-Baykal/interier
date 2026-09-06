const TARGET_BYTES = 2.8 * 1024 * 1024;
const MAX_DIM = 2048;

/** Browser-only normalisation shared by the studio and model lab. */
export async function preparePhoto(file: File, jpegOnly = false): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml" || !file.size || file.size > 20 * 1024 * 1024) throw new Error("invalid_image");
  if (!jpegOnly && file.size <= TARGET_BYTES && ["image/jpeg", "image/png", "image/webp"].includes(file.type)) return file;
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("invalid_image")); img.src = url;
    });
    const scale = Math.min(1, MAX_DIM / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("image_conversion_failed");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [.9, .8, .7, .6, .5]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= TARGET_BYTES) return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "room"}.jpg`, { type: "image/jpeg" });
    }
    throw new Error("image_too_large");
  } finally { URL.revokeObjectURL(url); }
}

/**
 * Backwards-compatible name used by the shopping/editor UI: same pipeline, but
 * `null` instead of a throw, because the studio only needs "couldn't prepare it".
 */
export async function downscaleImage(file: File): Promise<File | null> {
  try {
    return await preparePhoto(file);
  } catch {
    return null;
  }
}
