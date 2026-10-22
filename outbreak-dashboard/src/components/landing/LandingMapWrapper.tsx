import { useState, useMemo } from 'react';
import BubbleMap from '../analyst-view/BubbleMap';
import { getHardcodedCityData } from '../../data/hardcodedSpreadData';

export default function LandingMapWrapper() {
  const [simulationDay, setSimulationDay] = useState(180);
  const [activeIntervention, setActiveIntervention] = useState('none');

  const hardcodedData = useMemo(() => {
    return getHardcodedCityData();
  }, []);

  return (
    <div className="relative w-full h-full">
      <BubbleMap
        cityData={hardcodedData}
        resourceData={{}}
        activeIntervention={activeIntervention}
        simulationDay={simulationDay}
        onDayChange={setSimulationDay}
        onInterventionChange={setActiveIntervention}
        originCity="KOCHI"
        isLandingMini={true}
      />
    </div>
  );
}
