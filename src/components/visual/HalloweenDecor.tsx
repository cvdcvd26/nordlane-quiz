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

/** Four separate legs on each side keep the small silhouette recognizably a spider. */
function Spider({ side }: { side: "left" | "right" }) {
  return (
    <div className={`ab-halloween__spider-track ab-halloween__spider-track--${side}`} data-halloween-spider={side}>
      <div className="ab-halloween__pendulum">
        <span className="ab-halloween__thread" />
        <svg className="ab-halloween__spider" viewBox="0 0 64 60" fill="none" aria-hidden="true" focusable="false">
          <g className="ab-halloween__legs">
            <path d="M25 18 16 11 5 17" />
            <path d="M23 25 13 22 4 29" />
            <path d="M23 32 12 35 5 45" />
            <path d="M27 38 18 44 15 54" />
            <path d="M39 18 48 11 59 17" />
            <path d="M41 25 51 22 60 29" />
            <path d="M41 32 52 35 59 45" />
            <path d="M37 38 46 44 49 54" />
          </g>
          <ellipse className="ab-halloween__abdomen" cx="32" cy="25" rx="10.5" ry="14" />
          <path className="ab-halloween__body-mark" d="M28 18Q32 15 36 18M29 22Q32 20 35 22" />
          <ellipse className="ab-halloween__head" cx="32" cy="41" rx="7.5" ry="7" />
          <g className="ab-halloween__eyes">
            <circle cx="29.3" cy="41.5" r="1.25" />
            <circle cx="34.7" cy="41.5" r="1.25" />
          </g>
        </svg>
      </div>
    </div>
  );
}

/** Root owns seasonal availability and can hide the layer for a published outcome. */
export function HalloweenDecor({ hidden = false }: { hidden?: boolean }) {
  if (hidden) return null;

  return (
    <div className="ab-halloween" aria-hidden="true" data-testid="halloween-decor" data-halloween-decor="">
      <CornerWeb side="left" />
      <CornerWeb side="right" />
      <Spider side="left" />
      <Spider side="right" />
    </div>
  );
}
