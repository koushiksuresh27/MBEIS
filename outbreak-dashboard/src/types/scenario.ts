export interface ScenarioConfig {
  scenarioId: string
  originCity: string
  nIterations: number
  scenarioLabel: string
  pathogenName: string
  seedInfections?: number   // default 500
  kSensitivity?: number     // default 35
}
