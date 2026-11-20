import { type PlanePose, SEAPLANE_BERTH } from './flight.ts';
import { DOCK, WATER } from './terrain.ts';

export type VehicleKind = 'boat' | 'plane';
export const VEHICLE_KINDS: readonly VehicleKind[] = ['boat', 'plane'];

export const VEHICLE_BERTHS: Record<VehicleKind, PlanePose> = {
  boat: {
    x: 13.5,
    y: WATER,
    z: DOCK.z + DOCK.halfWidth + 1.3,
    yaw: Math.PI / 2,
    pitch: 0,
  },
  plane: SEAPLANE_BERTH,
};

export type Vehicle = { pose: PlanePose; driver?: number };
export type RoomVehicles = Record<VehicleKind, Vehicle>;
export type VehicleReport = {
  kind: VehicleKind;
  pose: PlanePose;
  driving: boolean;
};
