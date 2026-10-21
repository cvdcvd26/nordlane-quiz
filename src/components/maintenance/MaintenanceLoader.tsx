"use client";

import { LogoMark } from "@/components/ui/LogoMark";
import "./maintenance.css";

/** Never mounts visitor content before the server confirms that access is open. */
export function MaintenanceLoader({ error, checking, onRetry }: { error: string; checking: boolean; onRetry: () => Promise<void> }) {
  return (
    <main className="ab-access-loader" aria-busy={!error || checking} data-access-loader>
      <div className="ab-access-loader-content">
        <LogoMark className="ab-access-loader-mark" />
        <p role="status" aria-live="polite">{error || "Sprawdzamy dostępność…"}</p>
        {!error || checking ? (
          <div className="ab-access-loader-track" role="progressbar" aria-label="Sprawdzamy dostępność serwisu">
            <span />
          </div>
        ) : (
          <button type="button" className="ab-maintenance-retry" onClick={onRetry}>Spróbuj ponownie</button>
        )}
      </div>
    </main>
  );
}
