"""
Shared Supabase connection for backend services (simulator, and later profiler).

Uses the SERVICE ROLE key — this bypasses RLS entirely (Section 11 of the plan),
which is correct for a backend Python service but means this key must NEVER be
committed to git or used in frontend code. It's loaded from a .env file that
must be in .gitignore.

Usage from your simulator code:

    from supabase_client import get_client
    supabase = get_client()
    supabase.table("seird_results").insert({...}).execute()
"""

import os
from dotenv import load_dotenv
from supabase import create_client, Client

# Resolve the absolute path to the repo root (3 levels up from this file)
root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
env_path = os.path.join(root_dir, ".env")
load_dotenv(env_path)

_client: Client | None = None


def get_client() -> Client:
    """
    Returns a singleton Supabase client authenticated with the service role key.
    Raises a clear error immediately if required env vars are missing, rather
    than failing confusingly later on the first actual query.
    """
    global _client
    if _client is not None:
        return _client

    url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not service_key:
        raise RuntimeError(
            "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. "
            "Check that your .env file exists in the repo root and contains both, "
            "and that you're running this script from a location where .env is loadable."
        )

    _client = create_client(url, service_key)
    return _client
