"use client";
import { useEffect, useRef } from "react";

type Particle = { x: number; y: number; c: string; ox: number; oy: number; a: number; delay: number; sx: number; sy: number };

const PAD = 48; // room around the text for scattered pixels
const INTRO_MS = 450;
const INTRO_STAGGER_MS = 120;
const POINTER_IDLE_MS = 90;
const RADIUS = 55; // cursor influence, px

/**
 * Heading drawn as a grid of small squares on a canvas (after the DeLorean marketplace hero):
 * pixels assemble briefly on load, react to pointer movement and settle back to crisp DOM text.
 * A stationary pointer never keeps the heading distorted.
 * Falls back to plain text with reduced motion or without canvas.
 */
export function PixelHeading({
  as: Tag = "h1",
  id,
  className = "",
  wrapperClassName = "",
  style,
  children,
}: {
  as?: "h1" | "h2";
  id?: string;
  className?: string;
  /** Margins and entrance animation go on the wrapper so the canvas stays aligned with the text. */
  wrapperClassName?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const heading = headingRef.current;
    const canvas = canvasRef.current;
    if (!heading || !canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let particles: Particle[] = [];
    let cell = 3;
    let dpr = 1;
    let raf = 0;
    let start = 0;
    let lastFrame = 0;
    let lastPointerMove = 0;
    let pointer: { x: number; y: number } | null = null;
    let disposed = false;
    let introDone = false;

    const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-paint").trim() || "#2ee6a0";

    /** Renders the heading's words offscreen at their on-screen positions, then samples a pixel grid. */
    const build = () => {
      const box = heading.getBoundingClientRect();
      if (!box.width || !box.height) return false;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.ceil(box.width + PAD * 2);
      const h = Math.ceil(box.height + PAD * 2);
      canvas.style.left = `${-PAD}px`;
      canvas.style.top = `${-PAD}px`;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);

      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const o = off.getContext("2d", { willReadFrequently: true });
      if (!o) return false;

      const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
      let fontSize = 48;
      const colors: string[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement!;
        const cs = getComputedStyle(el);
        fontSize = parseFloat(cs.fontSize);
        const color = el.closest(".accent-text") ? accent : getComputedStyle(document.documentElement).getPropertyValue("--color-ink").trim() || "#ecf5f0";
        o.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        if ("letterSpacing" in o) (o as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing;
        o.textBaseline = "alphabetic";
        const colorIndex = colors.indexOf(color) >= 0 ? colors.indexOf(color) : colors.push(color) - 1;
        o.fillStyle = `rgb(${colorIndex + 1},0,0)`; // colour index encoded in the red channel
        const text = node.textContent ?? "";
        const re = /\S+/g;
        for (let m = re.exec(text); m; m = re.exec(text)) {
          const range = document.createRange();
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          const rects = range.getClientRects();
          if (!rects.length) continue;
          const r = rects[0];
          const metrics = o.measureText(m[0]);
          const asc = metrics.fontBoundingBoxAscent ?? fontSize * 0.8;
          const desc = metrics.fontBoundingBoxDescent ?? fontSize * 0.2;
          const baseline = r.top - box.top + (r.height - (asc + desc)) / 2 + asc;
          o.fillText(m[0], r.left - box.left + PAD, baseline + PAD);
        }
      }

      cell = Math.max(2, Math.round(fontSize / 30));
      const data = o.getImageData(0, 0, w, h).data;
      const next: Particle[] = [];
      const half = cell >> 1;
      for (let y = 0; y + half < h; y += cell) {
        for (let x = 0; x + half < w; x += cell) {
          const i = ((y + half) * w + x + half) * 4;
          if (!(data[i + 3] >= 110)) continue;
          const c = colors[Math.max(0, data[i] - 1)] ?? accent;
          next.push({
            x,
            y,
            c,
            ox: 0,
            oy: 0,
            a: 1,
            delay: (x / w) * 90 + Math.random() * 30,
            sx: (Math.random() - 0.5) * 24,
            sy: (Math.random() - 0.5) * 12,
          });
        }
      }
      particles = next;
      return next.length > 0;
    };

    const draw = (now: number) => {
      const t = now - start;
      const dt = Math.min(64, Math.max(0, now - lastFrame));
      lastFrame = now;
      if (pointer && now - lastPointerMove >= POINTER_IDLE_MS) pointer = null;
      const returning = 1 - Math.exp(-dt / 55);
      let moving = false;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const size = cell * 0.88;
      let fill = "";
      for (const p of particles) {
        let tx = 0;
        let ty = 0;
        let ta = 1;
        if (!introDone) {
          const k = Math.min(1, Math.max(0, (t - p.delay) / (INTRO_MS - INTRO_STAGGER_MS)));
          const e = 1 - Math.pow(1 - k, 3);
          p.ox = p.sx * (1 - e);
          p.oy = p.sy * (1 - e);
          p.a = e;
          if (k < 1) moving = true;
        } else {
          if (pointer) {
            const dx = p.x - pointer.x;
            const dy = p.y - pointer.y;
            const d = Math.hypot(dx, dy);
            if (d < RADIUS) {
              const f = 1 - d / RADIUS;
              tx = (dx / (d || 1)) * f * 6 + (Math.random() - 0.5) * 6 * f;
              ty = (dy / (d || 1)) * f * 6 + (Math.random() - 0.5) * 6 * f;
              ta = 1 - f * 0.15;
            }
          }
          const ease = tx || ty ? 0.35 : returning;
          p.ox += (tx - p.ox) * ease;
          p.oy += (ty - p.oy) * ease;
          p.a += (ta - p.a) * returning;
          if (Math.abs(p.ox) > 0.2 || Math.abs(p.oy) > 0.2 || Math.abs(1 - p.a) > 0.02) moving = true;
        }
        if (p.a <= 0.01) continue;
        if (fill !== p.c) {
          fill = p.c;
          ctx.fillStyle = fill;
        }
        ctx.globalAlpha = p.a;
        ctx.fillRect(p.x + p.ox, p.y + p.oy, size, size);
      }
      ctx.globalAlpha = 1;
      if (!introDone && t >= INTRO_MS) introDone = true;
      if (moving || pointer || !introDone) raf = requestAnimationFrame(draw);
      else {
        raf = 0;
        // Restore the native glyphs at rest, especially for smaller, multiline headings.
        heading.classList.remove("is-pixel");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };

    const kick = () => {
      if (!raf && !disposed) {
        lastFrame = performance.now();
        raf = requestAnimationFrame(draw);
      }
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const box = heading.getBoundingClientRect();
      const inside = e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;
      if (inside) {
        const r = canvas.getBoundingClientRect();
        pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
        lastPointerMove = performance.now();
        heading.classList.add("is-pixel");
        kick();
      } else if (pointer) {
        pointer = null;
        kick();
      }
    };
    const onLeave = () => {
      pointer = null;
      kick();
    };

    const init = () => {
      if (disposed || !build()) return;
      heading.classList.add("is-pixel");
      start = performance.now();
      kick();
    };

    void document.fonts.ready.then(init);

    let lastWidth = 0;
    const ro = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      if (!particles.length || width === lastWidth) {
        lastWidth = width;
        return;
      }
      lastWidth = width;
      if (build()) kick();
    });
    ro.observe(heading);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      heading.classList.remove("is-pixel");
    };
  }, []);

  return (
    <div className={`relative ${wrapperClassName}`} style={style}>
      <Tag ref={headingRef} id={id} className={`pixel-heading ${className}`}>
        {children}
      </Tag>
      <canvas ref={canvasRef} aria-hidden className="pixel-canvas" />
    </div>
  );
}
