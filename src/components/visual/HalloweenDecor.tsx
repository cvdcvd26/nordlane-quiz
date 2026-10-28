import "./halloween.css";

function CornerWeb({ side }: { side: "left" | "right" }) {
  return (
    <svg
      className={`ab-halloween__web ab-halloween__web--${side}`}
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 117V3H117M3 3 110 47M3 3 85 85M3 3 47 110" />
      <path d="M27 3Q21 7 25 12Q17 13 20 20Q13 17 12 25Q7 21 3 27" />
      <path d="M51 3Q40 12 47 21Q32 25 37 37Q25 32 21 47Q12 40 3 51" />
      <path d="M75 3Q60 16 70 31Q46 35 54 54Q35 46 31 70Q16 60 3 75" />
      <path d="M99 3Q80 20 92 40Q62 47 71 71Q47 62 40 92Q20 80 3 99" />
      <path d="M117 3Q97 25 110 47Q76 56 85 85Q56 76 47 110Q25 97 3 117" />
    </svg>
  );
}

/** Curved legs and a polished titanium shell keep the silhouette organic and restrained. */
function Spider({ position }: { position: "left" | "right" | "center" }) {
  const bodyGradient = `ab-halloween-${position}-titanium-body`;
  const headGradient = `ab-halloween-${position}-titanium-head`;
  const legGradient = `ab-halloween-${position}-titanium-legs`;
  const sheenGradient = `ab-halloween-${position}-titanium-sheen`;
  const mintGradient = `ab-halloween-${position}-mint-glow`;

  return (
    <div className={`ab-halloween__spider-track ab-halloween__spider-track--${position}`} data-halloween-spider={position}>
      <div className="ab-halloween__pendulum">
        <span className="ab-halloween__thread" />
        <svg className="ab-halloween__spider" viewBox="0 0 80 74" fill="none" aria-hidden="true" focusable="false">
          <defs>
            <radialGradient id={bodyGradient} cx="35" cy="21" r="29" gradientUnits="userSpaceOnUse">
              <stop className="ab-halloween__metal-light" offset="0" />
              <stop className="ab-halloween__metal-mid" offset="0.27" />
              <stop className="ab-halloween__metal-shadow" offset="0.62" />
              <stop className="ab-halloween__metal-mid" offset="0.87" />
              <stop className="ab-halloween__metal-shadow" offset="1" />
            </radialGradient>
            <radialGradient id={headGradient} cx="37" cy="45" r="12" gradientUnits="userSpaceOnUse">
              <stop className="ab-halloween__metal-light" offset="0" />
              <stop className="ab-halloween__metal-mid" offset="0.35" />
              <stop className="ab-halloween__metal-shadow" offset="0.8" />
              <stop className="ab-halloween__metal-mid" offset="1" />
            </radialGradient>
            <linearGradient id={legGradient} x1="9" y1="19" x2="69" y2="61" gradientUnits="userSpaceOnUse">
              <stop className="ab-halloween__metal-mid" offset="0" />
              <stop className="ab-halloween__metal-light" offset="0.22" />
              <stop className="ab-halloween__metal-shadow" offset="0.43" />
              <stop className="ab-halloween__metal-light" offset="0.67" />
              <stop className="ab-halloween__metal-mid" offset="1" />
            </linearGradient>
            <linearGradient id={sheenGradient} x1="32" y1="20" x2="45" y2="31" gradientUnits="userSpaceOnUse">
              <stop stopColor="var(--ab-halloween-metal-glint)" stopOpacity="0.35" offset="0" />
              <stop className="ab-halloween__metal-light" stopOpacity="0.08" offset="0.45" />
              <stop className="ab-halloween__metal-light" stopOpacity="0" offset="1" />
            </linearGradient>
            <radialGradient id={mintGradient}>
              <stop className="ab-halloween__mint-stop" stopOpacity="0.75" offset="0" />
              <stop className="ab-halloween__mint-stop" stopOpacity="0.25" offset="0.4" />
              <stop className="ab-halloween__mint-stop" stopOpacity="0" offset="1" />
            </radialGradient>
          </defs>
          <g className="ab-halloween__legs" stroke={`url(#${legGradient})`}>
            <path d="M36 43C29 37 29 28 23 22S15 12 11 6" />
            <path d="M35 45C28 42 22 34 17 33S9 35 4 38" />
            <path d="M35 48C28 47 21 48 17 54S12 63 8 67" />
            <path d="M37 51C32 54 28 58 29 62S28 68 25 71" />
            <path d="M44 43C51 37 51 28 57 22S65 12 69 6" />
            <path d="M45 45C52 42 58 34 63 33S71 35 76 38" />
            <path d="M45 48C52 47 59 48 63 54S68 63 72 67" />
            <path d="M43 51C48 54 52 58 51 62S52 68 55 71" />
          </g>
          <path
            className="ab-halloween__abdomen"
            fill={`url(#${bodyGradient})`}
            d="M40 11C48 11 51 22 49 32C47.7 39.4 44.4 44 40 44S32.3 39.4 31 32C29 22 32 11 40 11Z"
          />
          <path fill={`url(#${sheenGradient})`} d="M40 12.5C34.2 12.5 31.4 21.3 32.2 29C33 36 35.6 40.1 38.5 41C35.9 34.9 36.1 26.4 39.4 19.9C41.4 16 43.5 14.2 40 12.5Z" />
          <path className="ab-halloween__shell-shadow" d="M46.9 18.9C51 32 46.9 41.5 40.9 43.1C44.3 37.3 46.8 29.9 46.9 18.9Z" />
          <path
            className="ab-halloween__head"
            fill={`url(#${headGradient})`}
            d="M40 41C44.3 41 46.5 44.3 46 48.3C45.6 52 43.2 55.1 40 56C36.8 55.1 34.4 52 34 48.3C33.5 44.3 35.7 41 40 41Z"
          />
          <path className="ab-halloween__specular" d="M36.7 14.7C33.1 17.2 32.1 23.3 32.7 28.2M36.1 44.6C35.2 46.1 35.3 48.3 36 49.7M21.7 23.5C25.1 27.3 26.4 33.3 29.4 37.1M58.3 23.5C54.9 27.3 53.6 33.3 50.6 37.1" />
          <path className="ab-halloween__reflected-edge" d="M45.8 15.3C48.5 19.1 49.3 25.9 48.1 31.9" />
          <ellipse className="ab-halloween__accent-glow" cx="43.5" cy="25.8" rx="3.6" ry="6.3" fill={`url(#${mintGradient})`} />
          <path className="ab-halloween__accent" d="M43.3 22.6C44 24.4 44.2 26.7 43.9 28.6C43.8 29.1 43.4 29.2 43.3 28.6C43.6 26.5 43.2 24.5 42.8 23C42.7 22.6 43.1 22.3 43.3 22.6Z" />
        </svg>
      </div>
    </div>
  );
}

/** Root owns seasonal availability and can hide the layer for a published outcome. */
export function HalloweenDecor({ hidden = false, theme = "dark" }: { hidden?: boolean; theme?: "dark" | "light" }) {
  if (hidden) return null;

  return (
    <div className={`ab-halloween${theme === "light" ? " ab-halloween--light" : ""}`} aria-hidden="true" data-testid="halloween-decor" data-halloween-decor="">
      <CornerWeb side="left" />
      <CornerWeb side="right" />
      <Spider position="left" />
      <Spider position="right" />
      <Spider position="center" />
    </div>
  );
}
