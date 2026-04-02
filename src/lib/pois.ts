import type { PoiType } from '@/types/mapEditor';

interface PoiTone {
  label: string;
  emoji: string;
  dot: string;
  description: string;
}

const POI_TONES: Record<PoiType, PoiTone> = {
  start: { label: 'Start', emoji: '🟢', dot: '#16a34a', description: 'Where runners begin the race' },
  finish: { label: 'Finish', emoji: '🏁', dot: '#dc2626', description: 'The race finish line' },
  water: { label: 'Water', emoji: '💧', dot: '#0ea5e9', description: 'Hydration & aid station' },
  medical: { label: 'Medical', emoji: '🏥', dot: '#ef4444', description: 'First aid & medical support' },
  registration: { label: 'Registration', emoji: '📋', dot: '#8b5cf6', description: 'Check-in & bib pickup' },
  sponsor: { label: 'Sponsor', emoji: '⭐', dot: '#f59e0b', description: 'Sponsor activation area' },
  parking: { label: 'Parking', emoji: '🅿️', dot: '#6b7280', description: 'Designated parking area' },
  restroom: { label: 'Restroom', emoji: '🚻', dot: '#06b6d4', description: 'Portable restroom location' },
  'aid-station': { label: 'Aid Station', emoji: '⛑️', dot: '#f97316', description: 'On-course support stop' },
  custom: { label: 'Custom', emoji: '📌', dot: '#64748b', description: 'Custom point of interest' },
};

export function poiTone(type: PoiType): PoiTone {
  return POI_TONES[type] ?? POI_TONES.custom;
}

export const POI_TYPES: PoiType[] = [
  'start', 'finish', 'water', 'medical', 'registration',
  'sponsor', 'parking', 'restroom', 'aid-station', 'custom',
];
