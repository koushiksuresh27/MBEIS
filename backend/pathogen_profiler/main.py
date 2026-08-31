from fastapi import FastAPI, HTTPException

from .schema import (
    ProfileRequest,
    ProfileResponse,
    ProfileType,
)
from .stage1_match import create_matched_profile
from .stage2_derive import create_derived_profile


app = FastAPI(
    title="Pathogen Profiler Service",
    description=(
        "A service for converting known or emerging pathogen "
        "descriptions into simulation-ready epidemiological parameters "
        "for the Outbreak Response OS."
    ),
    version="1.0.0",
)


@app.get("/", tags=["Root"])
async def root():
    """Basic service information."""
    return {
        "service": "Pathogen Profiler",
        "status": "running",
        "version": "1.0.0",
    }


@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint used by Render and monitoring systems."""
    return {
        "status": "healthy",
        "service": "pathogen_profiler",
    }


def format_profile_response(profile: dict) -> dict:
    """
    Convert the flat Supabase pathogen_profiles row into
    the nested ProfileResponse schema.
    """

    return {
        "profile_id": profile["profile_id"],
        "scenario_id": profile["scenario_id"],
        "version": profile["version"],
        "profile_type": profile["profile_type"],

        "parameters": {
            "r0": {
                "low": profile["r0_low"],
                "most_likely": profile["r0_most_likely"],
                "high": profile["r0_high"],
            },
            "incubation_days": {
                "low": profile["incubation_days_low"],
                "most_likely": profile["incubation_days_most_likely"],
                "high": profile["incubation_days_high"],
            },
            "cfr": {
                "low": profile["cfr_low"],
                "most_likely": profile["cfr_most_likely"],
                "high": profile["cfr_high"],
            },
            "infectious_period": {
                "low": profile["infectious_period_low"],
                "most_likely": profile["infectious_period_most_likely"],
                "high": profile["infectious_period_high"],
            },
        },

        "is_respiratory": profile["is_respiratory"],
        "data_confidence": profile["data_confidence"],

        "matched_reference_disease_id": profile.get(
            "matched_reference_disease_id"
        ),

        "derivation_basis": profile.get(
            "derivation_basis"
        ),
    }


@app.post(
    "/profile",
    response_model=ProfileResponse,
    tags=["Pathogen Profile"],
)
async def create_profile(request: ProfileRequest):
    """
    Create a pathogen profile.

    Stage 1:
        Provide disease_name for a known reference disease.

    Stage 2:
        Provide description for an unknown/emerging pathogen.
    """

    try:

        # ---------------------------------------------------------
        # Stage 1: Known disease
        # ---------------------------------------------------------
        if request.disease_name:

            profile = create_matched_profile(
                scenario_id=request.scenario_id,
                version=request.version,
                disease_name=request.disease_name,
            )

        # ---------------------------------------------------------
        # Stage 2: Unknown / emerging pathogen
        # ---------------------------------------------------------
        elif request.description:

            profile = create_derived_profile(
                scenario_id=request.scenario_id,
                version=request.version,
                pathogen_description=request.description,
            )

        else:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Either disease_name or description "
                    "must be provided."
                ),
            )

        # Convert database format -> API format
        return format_profile_response(profile)

    except HTTPException:
        raise

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create pathogen profile: {exc}",
        ) from exc