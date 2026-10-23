/**
 * Unified Backend Configuration for MBEIS:
 * Seamlessly supports both the deployed Render backend (https://mbeis-backend.onrender.com)
 * and the local development server (http://127.0.0.1:8000 / http://localhost:8000).
 */

export const RENDER_BACKEND_URL = 'https://mbeis-backend.onrender.com';
export const LOCAL_BACKEND_URL = 'http://127.0.0.1:8000';

/**
 * Resolves the active backend URL:
 * 1. If VITE_BACKEND_URL is explicitly set, use it.
 * 2. If running in a browser on localhost / 127.0.0.1:
 *    - Defaults to local backend (http://127.0.0.1:8000)
 *    - Can fall back to Render if local is offline.
 * 3. In production (Vercel / cloud):
 *    - Automatically points to https://mbeis-backend.onrender.com
 */
export function getBackendUrl(): string {
  // Check for explicit runtime override in localStorage (allows easy testing in UI)
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('mbeis_backend_url');
    if (saved && saved.trim()) {
      return saved.trim().replace(/\/+$/, '');
    }
  }

  // Check Vite environment variable
  const envUrl = import.meta.env.VITE_BACKEND_URL;
  if (envUrl && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, '');
  }

  // Detect local environment vs production deployment
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
    if (isLocalhost) {
      return LOCAL_BACKEND_URL;
    }
  }

  // Production default
  return RENDER_BACKEND_URL;
}

export const BACKEND_URL = getBackendUrl();
