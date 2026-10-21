"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { maintenanceContent as M } from "@/config/maintenance";
import { LogoMark } from "@/components/ui/LogoMark";
import "./maintenance.css";

type MaintenanceScreenProps = {
  onRetry?: () => void | Promise<void>;
  checking?: boolean;
  notice?: string;
};

/** A quiet, self-contained screen: the letter stays still while the background drifts. */
export function MaintenanceScreen({ onRetry, checking = false, notice = "" }: MaintenanceScreenProps) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const busy = checking || retrying;

  const retry = async () => {
    if (busy) return;
    if (!onRetry) {
      window.location.reload();
      return;
    }
    setRetryError("");
    setRetrying(true);
    try {
      await onRetry();
    } catch {
      setRetryError(M.retryError);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="ab-maintenance" data-maintenance-screen>
      <div className="ab-maintenance-background" aria-hidden="true">
        <span className="ab-maintenance-glow ab-maintenance-glow-primary" />
        <span className="ab-maintenance-glow ab-maintenance-glow-secondary" />
        <div className="ab-maintenance-particles">
          {Array.from({ length: 8 }, (_, index) => <span key={index} />)}
        </div>
      </div>

      <header className="ab-maintenance-header">
        <div className="ab-maintenance-brand">
          <LogoMark className="ab-maintenance-brand-mark" />
          <span>{M.brand}</span>
        </div>
      </header>

      <main className="ab-maintenance-main" aria-labelledby="maintenance-title">
        <div className="ab-maintenance-copy">
          <div className="ab-maintenance-mark" aria-hidden="true">
            <LogoMark className="ab-maintenance-letter" />
          </div>
          <p className="ab-maintenance-kicker">{M.kicker}</p>
          <h1 id="maintenance-title" className="ab-maintenance-title">
            {M.title} <span>{M.titleAccent}</span>
          </h1>
          <p className="ab-maintenance-description">{M.description}</p>
          <button type="button" className="ab-maintenance-retry" onClick={retry} disabled={busy} aria-busy={busy}>
            <RefreshCw size={17} aria-hidden="true" />
            <span>{busy ? M.checking : M.retry}</span>
          </button>
          <p className="ab-maintenance-notice" role="status" aria-live="polite">
            {retryError || notice}
          </p>
        </div>
      </main>

      <footer className="ab-maintenance-footer">
        <span aria-hidden="true" />
        {M.footer}
      </footer>
    </div>
  );
}

export default MaintenanceScreen;
