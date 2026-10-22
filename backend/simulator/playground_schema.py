from pydantic import BaseModel, Field, model_validator
from typing import Optional, List, Dict, Any

class PathogenParams(BaseModel):
    r0_mode: float = Field(2.5, ge=0.5, le=25.0, description="Basic reproduction number mode")
    r0_min: float = Field(1.8, ge=0.2, le=20.0)
    r0_max: float = Field(3.5, ge=1.0, le=30.0)
    incubation_days: float = Field(5.0, ge=1.0, le=30.0)
    infectious_days: float = Field(7.0, ge=1.0, le=30.0)
    cfr: float = Field(0.02, ge=0.0001, le=0.90, description="CFR between 0.01% and 90%")

    @model_validator(mode="after")
    def validate_triangular_bounds(self):
        if not (self.r0_min <= self.r0_mode <= self.r0_max):
            raise ValueError(f"r0_min ({self.r0_min}) must be <= r0_mode ({self.r0_mode}) <= r0_max ({self.r0_max})")
        return self

class ModalShareOverrides(BaseModel):
    road: float = Field(0.40, ge=0.0, le=1.0)
    rail: float = Field(0.40, ge=0.0, le=1.0)
    air: float = Field(0.20, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def normalize_shares(self):
        # Auto-normalize so users can drag any slider without breaking sum = 1.0
        total = self.road + self.rail + self.air
        if total <= 0:
            raise ValueError("At least one travel mode must be > 0")
        self.road /= total
        self.rail /= total
        self.air /= total
        return self

class VaccinationSchema(BaseModel):
    enabled: bool = False
    start_day: int = Field(30, ge=0, le=365)
    daily_rate: float = Field(0.0015, ge=0.0, le=0.05, description="Fraction of eligible pool vaccinated per day")
    efficacy: float = Field(0.80, ge=0.0, le=1.0, description="Susceptibility reduction against infection")
    waning_mean_days: Optional[int] = Field(None, ge=30, le=1000, description="Mean duration of immunity (1/omega) in days")
    onset_days: int = Field(14, ge=1, le=60, description="Delay from vaccination to full protection")
    severity_efficacy: float = Field(0.95, ge=0.0, le=1.0, description="Reduction in severe disease / IFR among breakthrough cases")

class FestivalSchema(BaseModel):
    id: str = "evt_1"
    name: str = "Mass Gathering"
    city: str = "DELHI"
    start_day: int = Field(30, ge=0, le=365)
    end_day: int = Field(45, ge=0, le=365)
    crowd_mult: float = Field(2.5, ge=1.0, le=10.0, description="Contact rate multiplier during event")
    attendee_frac: float = Field(0.10, ge=0.001, le=1.0, description="Fraction of city population participating")

class PlaygroundPreviewRequest(BaseModel):
    # Preview specific model (No scenario_id needed as it's not saved to db)
    origin_city: str = "DELHI"
    n_days: int = Field(180, ge=14, le=365)
    seed_infections: int = Field(500, ge=1, le=100_000)
    k_sensitivity: float = Field(35.0, ge=0.0, le=150.0)
    
    pathogen: Optional[PathogenParams] = None
    modal_shares: Optional[ModalShareOverrides] = None
    edge_cuts: Optional[List[Dict[str, Any]]] = None
    edge_capacities: Optional[Dict[str, float]] = None
    quarantined_cities: Optional[List[str]] = None
    intervention: str = "none"
    schedule: Optional[List[Dict[str, Any]]] = None
    vaccination: Optional[VaccinationSchema] = None
    festivals: Optional[List[FestivalSchema]] = None

class PlaygroundSimulateRequest(BaseModel):
    scenario_id: str
    is_sandbox: bool = True  # Ephemeral: doesn't pollute canonical tables
    origin_city: str = "DELHI"
    n_days: int = Field(180, ge=14, le=365)
    n_iterations: int = Field(128, ge=16, le=500)
    seed_infections: int = Field(500, ge=1, le=100_000)
    intervention: str = "none"
    schedule: Optional[List[Dict[str, Any]]] = None
    
    pathogen: Optional[PathogenParams] = None
    modal_shares: Optional[ModalShareOverrides] = None
    edge_cuts: Optional[List[Dict[str, Any]]] = None
    edge_capacities: Optional[Dict[str, float]] = None
    quarantined_cities: Optional[List[str]] = None
    vaccination: Optional[VaccinationSchema] = None
    festivals: Optional[List[FestivalSchema]] = None

    @model_validator(mode="after")
    def compute_budget_guard(self):
        # Prevent compute DOS: compute_cost = iterations * days
        max_compute_cost = 500 * 180  # 90,000 unit-days
        cost = self.n_iterations * self.n_days
        if cost > max_compute_cost:
            raise ValueError(f"Requested compute budget ({cost}) exceeds limit ({max_compute_cost}). Lower iterations or days.")
        return self
