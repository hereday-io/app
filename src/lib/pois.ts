import type { PoiType } from '@/types/mapEditor';

interface PoiTone {
  label: string;
  emoji: string;
  dot: string;
}

const POI_TONES: Record<PoiType, PoiTone> = {
  start: { label: 'Start', emoji: '🟢', dot: '#16a34a' },
  finish: { label: 'Finish', emoji: '🏁', dot: '#dc2626' },
  water: { label: 'Water', emoji: '💧', dot: '#0ea5e9' },
  medical: { label: 'Medical', emoji: '🏥', dot: '#ef4444' },
  registration: { label: 'Registration', emoji: '📋', dot: '#8b5cf6' },
  sponsor: { label: 'Sponsor', emoji: '⭐', dot: '#f59e0b' },
  parking: { label: 'Parking', emoji: '🅿️', dot: '#6b7280' },
  restroom: { label: 'Restroom', emoji: '🚻', dot: '#06b6d4' },
  'aid-station': { label: 'Aid Station', emoji: '⛑️', dot: '#f97316' },
  custom: { label: 'Custom', emoji: '📌', dot: '#64748b' },
};

export function poiTone(type: PoiType): PoiTone {
  return POI_TONES[type] ?? POI_TONES.custom;
}

export const POI_TYPES: PoiType[] = [
  'start', 'finish', 'water', 'medical', 'registration',
  'sponsor', 'parking', 'restroom', 'aid-station', 'custom',
];
