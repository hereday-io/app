export type Coord = [number, number]; // [lng, lat]

export interface EventRoute {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  waypoints: Coord[];
  routeCoords: Coord[];
}

export type PoiType =
  | 'start'
  | 'finish'
  | 'water'
  | 'medical'
  | 'registration'
  | 'sponsor'
  | 'parking'
  | 'restroom'
  | 'aid-station'
  | 'custom';

export interface RoutePoi {
  id: string;
  type: PoiType;
  title: string;
  description: string;
  coordinates: Coord;
  imageUrl?: string;
  webLink?: string;
  imageDataUrl?: string;
}

export interface BasemapOption {
  id: string;
  label: string;
  style: string;
}
