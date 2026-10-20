import Image from "next/image";

/** The letter stays still; only the decorative vapor moves to the right. */
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`logo-mark ${className}`}>
      <span className="logo-vapor">
        <span className="logo-wisp">
          <svg viewBox="0 0 80 40" fill="currentColor">
            <path d="M0 22c13-11 23 5 36-3 11-7 17-6 26 0-11-3-15 4-26 4-15 1-21-9-36 3Z" />
          </svg>
        </span>
        <span className="logo-wisp">
          <svg viewBox="0 0 80 40" fill="currentColor">
            <path d="M0 16c15 8 22-4 36 2 11 5 18 6 28-1-8 10-20 10-31 5-14-7-21 5-33-2Z" />
          </svg>
        </span>
        <span className="logo-wisp">
          <svg viewBox="0 0 80 40" fill="currentColor">
            <path d="M0 25c14-6 20-2 31 1 12 4 20-9 32-5-14 0-18 13-33 9-13-3-17-5-30-1Z" />
          </svg>
        </span>
      </span>
      <Image src="/alleybiz-mark.svg" alt="" width={32} height={32} className="logo-letter" unoptimized />
    </span>
  );
}
