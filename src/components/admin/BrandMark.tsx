import Image from "next/image";

/** The same green AlleyBiz mark used in the visitor header. */
export function BrandMark({ className = "size-7" }: { className?: string }) {
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-md border border-[#2ee6a04d] bg-gradient-to-br from-[#133a2b] to-[#12221b] ${className}`}>
      <Image src="/alleybiz-mark.svg" alt="" width={32} height={32} className="size-[80%]" unoptimized />
    </span>
  );
}
