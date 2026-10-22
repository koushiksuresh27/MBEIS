import React, { useMemo } from 'react';

interface RippleLoaderProps {
  message?: string;
  subMessage?: string;
  size?: number;
  gap?: number;
  cols?: number;
  rows?: number;
  className?: string;
}

export default function RippleLoader({
  message,
  subMessage,
  size = 14,
  gap = 8,
  cols = 11,
  rows = 5,
  className = '',
}: RippleLoaderProps) {
  const dots = useMemo(() => {
    const list: Array<{ id: number; delay: string }> = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const dist = Math.hypot(c - (cols - 1) / 2, (r - (rows - 1) / 2) * 1.2);
        list.push({
          id: r * cols + c,
          delay: `${(dist * 0.14).toFixed(3)}s`,
        });
      }
    }
    return list;
  }, [cols, rows]);

  return (
    <div
      className={`flex flex-col items-center justify-center gap-5 p-8 select-none ${className}`}
      role="status"
      aria-label={message || 'Loading'}
    >
      <div
        className="ripple"
        style={
          {
            '--size': `${size}px`,
            '--gap': `${gap}px`,
            '--cols': cols,
            '--rows': rows,
          } as React.CSSProperties
        }
      >
        {dots.map(dot => (
          <i key={dot.id} style={{ '--d': dot.delay } as React.CSSProperties} />
        ))}
      </div>

      {(message || subMessage) && (
        <div className="flex flex-col items-center gap-1.5 text-center mt-2">
          {message && (
            <p className="text-sm font-mono font-bold text-on-surface tracking-wide">
              {message}
            </p>
          )}
          {subMessage && (
            <p className="text-xs font-mono text-on-surface-variant opacity-75">
              {subMessage}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
