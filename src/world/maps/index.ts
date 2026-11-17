import type { Field } from '../env';
import { buildBando } from './bando';
import { buildPracticeField } from './practice';

export type MapId = 'bando' | 'practice';

export const MAPS: Record<MapId, { name: string; description: string; build: (maxAnisotropy: number) => Field }> = {
  bando: {
    name: 'Industrial bando',
    description: 'Factory and warehouse with a skybridge, parking structure, tower crane, silos and conveyor, rail yard, overpass and more, in rolling hills.',
    build: buildBando,
  },
  practice: {
    name: 'Practice field',
    description: 'Open grass field with a few gates, containers, an arch and poles.',
    build: buildPracticeField,
  },
};

export function isMapId(v: unknown): v is MapId {
  return v === 'bando' || v === 'practice';
}
