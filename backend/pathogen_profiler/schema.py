from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, model_validator


class ProfileType(str, Enum):
    MATCHED = "matched"
    DERIVED = "derived"


class ParameterRange(BaseModel):
    """
    Represents an epidemiological parameter as a range.

    Example:
        {
            "low": 1.5,
            "most_likely": 2.5,
            "high": 4.0
        }
    """

    low: float = Field(..., description="Lower bound")
    most_likely: float = Field(..., description="Most likely estimate")
    high: float = Field(..., description="Upper bound")

    @model_validator(mode="after")
    def validate_range(self):
        if self.low > self.most_likely:
            raise ValueError(
                "low must be less than or equal to most_likely"
            )

        if self.most_likely > self.high:
            raise ValueError(
                "most_likely must be less than or equal to high"
            )

        return self


class DerivationBasis(BaseModel):
    """
    Explains how a derived pathogen profile was produced.

    This will be populated by Stage 2.
    """

    contributing_diseases: list[dict[str, Any]] = Field(
        ...,
        description=(
            "Reference diseases contributing to the derived profile, "
            "including their similarity weights."
        ),
    )

    weighting_features: dict[str, Any] = Field(
        ...,
        description=(
            "Features that influenced similarity weighting, such as "
            "transmission route, incubation pattern, and severity pattern."
        ),
    )

    reasoning: str = Field(
        ...,
        description="Human-readable explanation of the derivation.",
    )


class ProfileRequest(BaseModel):
    """
    Request sent by the planner to create a pathogen profile.
    """

    scenario_id: str = Field(..., min_length=1)
    version: int = Field(default=1, ge=1)

    disease_name: str | None = Field(
        default=None,
        description="Known disease name for Stage 1 matching.",
    )

    description: str | None = Field(
        default=None,
        description="Free-text pathogen description for Stage 2 derivation.",
    )

    @model_validator(mode="after")
    def validate_input(self):
        if not self.disease_name and not self.description:
            raise ValueError(
                "Either disease_name or description must be provided."
            )

        if self.disease_name and self.description:
            raise ValueError(
                "Provide either disease_name or description, not both."
            )

        return self


class ProfileResponse(BaseModel):
    """
    Response returned by the Pathogen Profiler.
    """

    profile_id: str
    scenario_id: str
    version: int

    profile_type: ProfileType

    matched_reference_disease_id: str | None = None

    r0: ParameterRange | None = None
    incubation_days: ParameterRange | None = None
    cfr: ParameterRange | None = None

    derivation_basis: DerivationBasis | None = None

    @model_validator(mode="after")
    def validate_derivation_basis(self):
        if (
            self.profile_type == ProfileType.DERIVED
            and self.derivation_basis is None
        ):
            raise ValueError(
                "Derived profiles must include derivation_basis."
            )

        return self