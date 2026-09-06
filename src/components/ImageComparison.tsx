"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "./locale-context";
import { comparisonClip, comparisonKey, dragComparison, fitImage } from "@/lib/image-viewer";

type Pictures = { before: string; after: string; title?: string };
type Size = { width: number; height: number };

function ComparisonCanvas({ before, after, position, onPosition, onSize }: Pictures & {
  position: number; onPosition: (value: number) => void; onSize?: (size: Size) => void;
}) {
  const { t } = useLocale();
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; position: number; width: number } | null>(null);
  const [size, setSize] = useState<Size>({ width: 1024, height: 1024 });
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [before, after]);
  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    drag.current = { x: event.clientX, position, width: canvas.current?.getBoundingClientRect().width || 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  return (
    <div className="comparison-canvas" ref={canvas} style={{ aspectRatio: `${size.width} / ${size.height}` }}>
      <img className="comparison-image" src={after} alt={t("viewer_after")} draggable={false}
        onError={() => setFailed(true)} onLoad={(event) => {
          const next = { width: event.currentTarget.naturalWidth || 1024, height: event.currentTarget.naturalHeight || 1024 };
          setSize(next); onSize?.(next);
        }} />
      <div className="comparison-before" style={{ clipPath: comparisonClip(position) }}>
        <img className="comparison-image" src={before} alt={t("viewer_before")} draggable={false} onError={() => setFailed(true)} />
      </div>
      <span className="comparison-label comparison-label-before" style={{ opacity: position > 4 ? 1 : 0 }}>{t("viewer_before")}</span>
      <span className="comparison-label comparison-label-after" style={{ opacity: position < 96 ? 1 : 0 }}>{t("viewer_after")}</span>
      <div className="comparison-divider" style={{ left: `${position}%` }} aria-hidden="true" />
      <div className="comparison-handle" style={{ left: `clamp(24px, ${position}%, calc(100% - 24px))` }}
        role="slider" tabIndex={0} aria-label={t("viewer_compare")}
        aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(position)}
        aria-valuetext={t("viewer_position", { before: Math.round(position), after: 100 - Math.round(position) })}
        onPointerDown={start} onPointerMove={(event) => {
          if (drag.current) onPosition(dragComparison(drag.current.position, event.clientX - drag.current.x, drag.current.width));
        }} onPointerUp={(event) => {
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
        onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
          const next = comparisonKey(position, event.key, event.shiftKey);
          if (next !== null) { event.preventDefault(); event.stopPropagation(); onPosition(next); }
        }}>
        <span className="comparison-thumb" aria-hidden="true">
          <svg width="26" height="24" viewBox="0 0 26 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 6-6 6 6 6M17 6l6 6-6 6M13 3v18" /></svg>
        </span>
      </div>
      {failed && <span className="comparison-error" role="status">{t("viewer_image_error")}</span>}
    </div>
  );
}

function PositionButtons({ setPosition }: { setPosition: (value: number) => void }) {
  const { t } = useLocale();
  return <div className="comparison-presets" aria-label={t("viewer_compare")}>
    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPosition(100)}>{t("viewer_before")}</button>
    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPosition(50)}>50 / 50</button>
    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPosition(0)}>{t("viewer_after")}</button>
  </div>;
}

/** Client-only viewing: no generation, upscaling, API calls or balance changes. */
export function ImageLightbox({ before, after, title, onClose, initialPosition = 50 }: Pictures & {
  onClose: () => void; initialPosition?: number;
}) {
  const { t } = useLocale();
  const heading = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [position, setPosition] = useState(initialPosition);
  const [zoom, setZoom] = useState(1);
  const [image, setImage] = useState<Size>({ width: 1024, height: 1024 });
  const [space, setSpace] = useState<Size>({ width: 640, height: 480 });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus({ preventScroll: true });
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); close.current(); return; }
      if (event.key !== "Tab") return;
      const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex="0"]') || []).filter((item) => item.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", key);
    const measure = () => {
      if (viewport.current) setSpace({ width: Math.max(1, viewport.current.clientWidth - 32), height: Math.max(1, viewport.current.clientHeight - 32) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    return () => {
      observer.disconnect(); document.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  const fitted = fitImage(image.width, image.height, space.width, space.height);
  const width = fitted.width * zoom, height = fitted.height * zoom;
  function changeZoom(value: number, absolute = false) {
    const element = viewport.current;
    const x = element ? (element.scrollLeft + element.clientWidth / 2) / element.scrollWidth : .5;
    const y = element ? (element.scrollTop + element.clientHeight / 2) / element.scrollHeight : .5;
    setZoom(previous => Math.min(4, Math.max(1, absolute ? value : previous + value)));
    requestAnimationFrame(() => {
      if (element) { element.scrollLeft = x * element.scrollWidth - element.clientWidth / 2; element.scrollTop = y * element.scrollHeight - element.clientHeight / 2; }
    });
  }
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="image-viewer-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="image-viewer-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={heading}>
        <header className="image-viewer-heading">
          <div><h2 id={heading}>{title || t("viewer_compare")}</h2><p className="small muted">{t("viewer_hint")}</p></div>
          <button type="button" ref={closeButton} className="btn btn-ghost" onClick={onClose} aria-label={t("viewer_close")}>✕</button>
        </header>
        <div ref={viewport} className={`image-viewer-viewport${zoom > 1 ? " is-zoomed" : ""}`}
          onPointerDown={(event) => {
            if (zoom <= 1 || event.button !== 0 || (event.target as HTMLElement).closest('[role="slider"], button, a')) return;
            event.preventDefault();
            pan.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
            event.currentTarget.setPointerCapture(event.pointerId);
          }} onPointerMove={(event) => {
            if (pan.current) { event.currentTarget.scrollLeft = pan.current.left - (event.clientX - pan.current.x); event.currentTarget.scrollTop = pan.current.top - (event.clientY - pan.current.y); }
          }} onPointerUp={(event) => {
            pan.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }} onPointerCancel={() => { pan.current = null; }} onLostPointerCapture={() => { pan.current = null; }}>
          <div className="image-viewer-content" style={{ width: Math.max(space.width, width), height: Math.max(space.height, height) }}>
            <div style={{ width, height, flexShrink: 0 }}>
              <ComparisonCanvas before={before} after={after} position={position} onPosition={setPosition} onSize={setImage} />
            </div>
          </div>
        </div>
        <footer className="image-viewer-controls">
          <PositionButtons setPosition={setPosition} />
          <div className="comparison-presets">
            <button type="button" className="btn btn-sm btn-ghost" disabled={zoom <= 1} onClick={() => changeZoom(-.5)} aria-label={t("viewer_zoom_out")}>−</button>
            <span className="image-viewer-scale" aria-live="polite">×{zoom}</span>
            <button type="button" className="btn btn-sm btn-ghost" disabled={zoom >= 4} onClick={() => changeZoom(.5)} aria-label={t("viewer_zoom_in")}>+</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => changeZoom(1, true)}>{t("viewer_fit")}</button>
            <a className="btn btn-sm" href={after} download target="_blank" rel="noopener noreferrer">↓ {t("studio_download")}</a>
          </div>
        </footer>
      </div>
    </div>, document.body,
  );
}

export default function ImageComparison({ before, after, title }: Pictures) {
  const { t } = useLocale();
  const [position, setPosition] = useState(50);
  const [open, setOpen] = useState(false);
  return <div className="image-comparison">
    <ComparisonCanvas before={before} after={after} position={position} onPosition={setPosition} />
    <div className="comparison-toolbar">
      <PositionButtons setPosition={setPosition} />
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>{t("viewer_expand")}</button>
    </div>
    {open && <ImageLightbox before={before} after={after} title={title} initialPosition={position} onClose={() => setOpen(false)} />}
  </div>;
}
