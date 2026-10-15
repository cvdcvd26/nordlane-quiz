/**
 * Fixed decorative layer: a faint square grid that fades out towards the edges,
 * over the mint light defined on body::before. Static — no lines, dots or particles.
 */
export function Backdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-[1]"
      style={{
        backgroundImage:
          "linear-gradient(to right, rgb(255 255 255 / 0.035) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.035) 1px, transparent 1px)",
        backgroundSize: "72px 72px",
        backgroundPosition: "center top",
        maskImage: "radial-gradient(ellipse 75% 65% at 50% 40%, #000 30%, transparent 100%)",
        WebkitMaskImage: "radial-gradient(ellipse 75% 65% at 50% 40%, #000 30%, transparent 100%)",
      }}
    />
  );
}
