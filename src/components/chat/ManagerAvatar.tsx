import Image from "next/image";
import type { ManagerProfile } from "@/config/managers";

// Crop the supplied photographs in the viewport; keep every source image unchanged.
const framing: Record<string, { zoom: number; x: number; y: number }> = {
  aneta: { zoom: 3, x: 80, y: 34 },
  maja: { zoom: 1.8, x: 50, y: 38 },
  hanna: { zoom: 1.8, x: 52, y: 40 },
  agnieszka: { zoom: 1.8, x: 53, y: 47 },
};

export function ManagerAvatar({ manager, size = 48 }: { manager: ManagerProfile; size?: number }) {
  const crop = framing[manager.id] ?? { zoom: 1, x: 50, y: 50 };
  const dimension = Math.round(size * crop.zoom);
  return (
    <span aria-hidden className="relative inline-block shrink-0 overflow-hidden rounded-full border border-paint/30 bg-paint/10" style={{ width: size, height: size }}>
      <Image
        src={manager.avatar}
        alt=""
        width={dimension}
        height={dimension}
        className="absolute top-1/2 left-1/2 max-w-none object-cover"
        style={{ width: dimension, height: dimension, transform: `translate(-${crop.x}%, -${crop.y}%)` }}
      />
    </span>
  );
}
