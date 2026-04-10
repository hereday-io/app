import type { PoiType } from '@/types/mapEditor';

// POI categories group the flat PoiType union into three semantic
// buckets for the picker UI. We do NOT narrow the underlying union —
// existing published events still carry the original string values, so
// the category is purely presentational metadata on each tone.
export type PoiCategory = 'course' | 'logistics' | 'support';

interface PoiTone {
  label: string;
  emoji: string;
  dot: string;
  description: string;
  category: PoiCategory;
}

const POI_TONES: Record<PoiType, PoiTone> = {
  // On-course — what runners encounter during the race
  start:         { label: 'Start',        emoji: '🟢', dot: '#16a34a', description: 'Where runners begin the race',     category: 'course' },
  finish:        { label: 'Finish',       emoji: '🏁', dot: '#dc2626', description: 'The race finish line',              category: 'course' },
  'aid-station': { label: 'Aid Station',  emoji: '⛑️', dot: '#f97316', description: 'Water, snacks, first aid',          category: 'course' },
  water:         { label: 'Water Only',   emoji: '💧', dot: '#0ea5e9', description: 'Hydration-only stop',               category: 'course' },
  medical:       { label: 'Medical',      emoji: '🏥', dot: '#ef4444', description: 'First aid & medical support',       category: 'course' },
  sponsor:       { label: 'Sponsor',      emoji: '⭐', dot: '#f59e0b', description: 'Sponsor activation area',           category: 'course' },

  // Logistics — getting there and getting registered
  registration:  { label: 'Registration', emoji: '📋', dot: '#8b5cf6', description: 'Check-in & bib pickup',             category: 'logistics' },
  parking:       { label: 'Parking',      emoji: '🅿️', dot: '#6b7280', description: 'Designated parking area',           category: 'logistics' },

  // Amenities — spectator / bystander facilities
  restroom:      { label: 'Restroom',     emoji: '🚻', dot: '#06b6d4', description: 'Portable restroom location',        category: 'support' },
  custom:        { label: 'Custom Pin',   emoji: '📌', dot: '#64748b', description: 'Anything else worth marking',       category: 'support' },
};

export function poiTone(type: PoiType): PoiTone {
  return POI_TONES[type] ?? POI_TONES.custom;
}

// Legacy flat list kept for code paths that still need the full set
// (filter panel, gpx export, tour). New picker UI should use
// POI_CATEGORY_ORDER + poisByCategory() instead.
export const POI_TYPES: PoiType[] = [
  'start', 'finish', 'aid-station', 'water', 'medical', 'sponsor',
  'registration', 'parking', 'restroom', 'custom',
];

export const POI_CATEGORIES: Record<PoiCategory, { label: string; order: number }> = {
  course:    { label: 'On course', order: 0 },
  logistics: { label: 'Logistics', order: 1 },
  support:   { label: 'Amenities', order: 2 },
};

export const POI_CATEGORY_ORDER: PoiCategory[] = ['course', 'logistics', 'support'];

/**
 * Group POI types by category, preserving the order defined in POI_TYPES
 * within each category bucket. Used by the grouped picker dropdown to
 * render sections without re-specifying the full type list.
 */
export function poisByCategory(): Record<PoiCategory, PoiType[]> {
  const grouped: Record<PoiCategory, PoiType[]> = {
    course: [],
    logistics: [],
    support: [],
  };
  for (const type of POI_TYPES) {
    grouped[POI_TONES[type].category].push(type);
  }
  return grouped;
}
