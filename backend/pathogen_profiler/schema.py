from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, model_validator


class ProfileType(str, Enum):
    MATCHED = "matched"
    DERIVED = "derived"


class ParameterRange(BaseModel):
    """
    Represents an epidemiological parameter using
    low, most_likely, and high values.
    """

    low: float
    most_likely: float
    high: float

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
    """

    contributing_diseases: list[dict[str, Any]] = Field(
        ...,
        description=(
            "Reference diseases used to derive the profile, "
            "including their similarity weights."
        ),
    )

    weighting_features: dict[str, Any] = Field(
        ...,
        description=(
            "Features used for similarity weighting, such as "
            "transmission route, incubation pattern, and severity."
        ),
    )

    reasoning: str = Field(
        ...,
        description="Explanation of why the reference diseases were selected.",
    )


class ProfileRequest(BaseModel):
    """
    Request received by the Pathogen Profiler.

    The planner must provide either:
    - disease_name for Stage 1
    - description for Stage 2
    """

    scenario_id: str = Field(..., min_length=1)

    version: int = Field(
        default=1,
        ge=1,
    )

    disease_name: str | None = Field(
        default=None,
        description="Known disease name for Stage 1 matching.",
    )

    description: str | None = Field(
        default=None,
        description="Free-text description for Stage 2 derivation.",
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


class EpidemiologicalParameters(BaseModel):
    """
    Simulation-ready epidemiological parameters.
    """

    r0: ParameterRange

    incubation_days: ParameterRange

    cfr: ParameterRange

    infectious_period: ParameterRange


class ProfileResponse(BaseModel):
    """
    Response returned by the Pathogen Profiler.
    """

    profile_id: str

    scenario_id: str

    version: int

    profile_type: ProfileType

    parameters: EpidemiologicalParameters

    is_respiratory: bool

    data_confidence: str

    matched_reference_disease_id: str | None = None

    derivation_basis: DerivationBasis | None = None

    @model_validator(mode="after")
    def validate_provenance(self):
        # Stage 1 must point to its reference disease.
        if (
            self.profile_type == ProfileType.MATCHED
            and self.matched_reference_disease_id is None
        ):
            raise ValueError(
                "Matched profiles must include "
                "matched_reference_disease_id."
            )

        # Stage 2 must explain its derivation.
        if (
            self.profile_type == ProfileType.DERIVED
            and self.derivation_basis is None
        ):
            raise ValueError(
                "Derived profiles must include derivation_basis."
            )

        return self