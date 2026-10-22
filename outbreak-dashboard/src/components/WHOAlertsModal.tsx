import type { WHOAlert } from "../hooks/useWHODon";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  alerts: WHOAlert[];
  loading: boolean;
  onSimulate: (alert: WHOAlert) => void;
}

export default function WHOAlertsModal({ isOpen, onClose, alerts, loading, onSimulate }: Props) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center">
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-surface border border-outline rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-outline bg-surface-container/50">
          <h2 className="text-on-background text-sm font-semibold tracking-wide flex items-center gap-2 font-heading">
            <span className="text-amber-500">🌐</span> WHO Active Alerts
          </h2>
          <button 
            onClick={onClose}
            className="text-on-surface-variant hover:text-on-background transition-colors p-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-0 flex-1 bg-surface">
          {loading && (
            <p className="text-on-surface-variant text-xs text-center py-8">
              Fetching WHO data…
            </p>
          )}

          {!loading && alerts.length === 0 && (
            <p className="text-on-surface-variant text-xs text-center py-8">
              No active alerts found.
            </p>
          )}

          {!loading && alerts.map((alert, i) => (
            <div
              key={i}
              className="border-b border-outline/50 px-4 py-4 last:border-b-0 hover:bg-surface-variant/30 transition-colors"
            >
              <div className="flex items-start gap-3">
                <span className="text-amber-500 mt-0.5 text-sm">⚠</span>
                <div className="flex-1 min-w-0">
                  <p className="text-on-background text-sm font-semibold leading-snug line-clamp-2">
                    {alert.title}
                  </p>
                  <p className="text-on-surface-variant font-mono text-[11px] mt-1">
                    {alert.country ?? "Global"} · {alert.ago}
                  </p>
                  {alert.summary && (
                    <p className="text-on-surface text-[12px] mt-2 line-clamp-3 leading-relaxed opacity-90">
                      {alert.summary}
                    </p>
                  )}
                  <div className="flex gap-3 mt-3 items-center">
                    {alert.country && (
                      <button
                        onClick={() => {
                          onSimulate(alert);
                        }}
                        className="text-[11px] font-medium bg-amber-500/10 hover:bg-amber-500/20 
                                   text-amber-600 dark:text-amber-400 border border-amber-500/30 
                                   rounded px-2.5 py-1 transition-colors"
                      >
                        Simulate →
                      </button>
                    )}
                    <a
                      href={alert.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-medium text-primary hover:opacity-80
                                 underline underline-offset-2 transition-opacity"
                    >
                      WHO report ↗
                    </a>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-outline bg-surface-container/30">
          <p className="text-on-surface-variant text-[10px] text-center font-mono">
            Source: WHO Disease Outbreak News
          </p>
        </div>
      </div>
    </div>
  );
}
