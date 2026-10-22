// hooks/useWHODon.ts
import { useEffect, useState } from "react";

export interface WHOAlert {
  title: string;
  summary: string;
  date: string;
  ago: string;
  url: string;
  country: string | null;
  lat: number | null;
  lng: number | null;
}

export function useWHODon() {
  const [alerts, setAlerts] = useState<WHOAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch("http://127.0.0.1:8000/api/v1/who-don")
      .then((r) => r.json())
      .then((data) => {
        setAlerts(data.alerts || []);
        setError(data.error || null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { alerts, loading, error };
}
