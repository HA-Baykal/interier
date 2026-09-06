/**
 * Client-side image preparation.
 *
 * Serverless hosts limit the request body (~4.5 MB on Vercel) and the AI
 * providers do not need a 12 MP original: ~2048 px JPEG keeps every detail
 * that matters for a redesign while making uploads reliable on mobile networks.
 */

const MAX_DIM = 2048;
const TARGET_BYTES = 2.8 * 1024 * 1024;

function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

export async function downscaleImage(file: File): Promise<File | null> {
  try {
    const img = await fileToImage(file);
    const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(img.src);
    const baseName = (file.name.replace(/\.[^.]+$/, "") || "room") + ".jpg";
    for (const q of [0.9, 0.8, 0.7, 0.6]) {
      const blob = await canvasToBlob(canvas, q);
      if (blob && blob.size <= TARGET_BYTES) return new File([blob], baseName, { type: "image/jpeg" });
    }
    const blob = await canvasToBlob(canvas, 0.5);
    if (blob) return new File([blob], baseName, { type: "image/jpeg" });
    return null;
  } catch {
    return null;
  }
}
