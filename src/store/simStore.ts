import { create } from 'zustand';
import missilesJson from '../data/missiles.json';
import aircraftJson from '../data/aircraft.json';
import type { MissileData, AircraftData } from '../data/types';
import type { ScenarioConfig, SimFrame, EngagementResult, SimStatus } from '../physics/engagement';
import type { ManeuverType } from '../physics/aircraft';

export type AppMode = 'tactical' | 'envelope' | 'editor';
export type ShooterRole = 'aircraft' | 'ground';

interface SimStore {
  // Data
  missiles: MissileData[];
  aircraft: AircraftData[];

  // Scenario
  shooterRole: ShooterRole;
  shooterAircraftId: string;
  shooterAlt: number;
  shooterSpeed: number;
  shooterHeading: number;
  targetAircraftId: number;
  targetAlt: number;
  targetSpeed: number;
  targetHeading: number;
  targetManeuver: ManeuverType;
  /** Number of chaff salvos available (each salvo = one burst of chaff bundles) */
  targetChaffCount: number;
  /** Number of flare salvos available */
  targetFlareCount: number;
  targetWaypoints: Array<{ x: number; y: number }>;
  /** Derived from the selected target aircraft's hasMaws field */
  targetHasMaws: boolean;
  rangeNm: number;
  aspectAngleDeg: number;
  selectedMissileId: string;

  // Playback
  simFrames: SimFrame[];
  currentFrameIdx: number;
  simStatus: SimStatus;
  simResult: EngagementResult | null;
  simError: string | null;
  playbackSpeed: number;
  isPlaying: boolean;
  maxRangeM: number;
  minRangeM: number;
  nezM: number;
  shooterStartX: number;
  shooterStartY: number;

  // Mode
  appMode: AppMode;

  // Actions
  setMissiles: (m: MissileData[]) => void;
  updateMissile: (id: string, patch: Partial<MissileData>) => void;
  setScenario: (patch: Partial<SimStore>) => void;
  setSimFrames: (
    frames: SimFrame[],
    result: EngagementResult,
    maxRangeM: number,
    minRangeM: number,
    nezM: number,
    sX: number,
    sY: number,
  ) => void;
  setSimError: (msg: string) => void;
  setCurrentFrameIdx: (idx: number) => void;
  setIsPlaying: (v: boolean) => void;
  setPlaybackSpeed: (v: number) => void;
  resetSim: () => void;
  setShooterRole: (role: ShooterRole) => void;
  addMissile: (m: MissileData) => void;
  deleteMissile: (id: string) => void;
  setAppMode: (mode: AppMode) => void;
  addTargetWaypoint: (wp: { x: number; y: number }) => void;
  clearTargetWaypoints: () => void;
}

export const useSimStore = create<SimStore>((set) => ({
  missiles: missilesJson as MissileData[],
  aircraft: aircraftJson as AircraftData[],

  // Default scenario
  shooterRole: 'aircraft',
  shooterAircraftId: 'f-16',
  shooterAlt: 25000,
  shooterSpeed: 450,
  shooterHeading: 0,
  targetAircraftId: 0,
  targetAlt: 25000,
  targetSpeed: 450,
  targetHeading: 180,
  targetManeuver: 'none',
  targetChaffCount: 0,
  targetFlareCount: 0,
  targetWaypoints: [],
  targetHasMaws: false,
  rangeNm: 20,
  aspectAngleDeg: 0,
  selectedMissileId: 'test-round',

  simFrames: [],
  currentFrameIdx: 0,
  simStatus: 'idle',
  simResult: null,
  simError: null,
  playbackSpeed: 1,
  isPlaying: false,
  maxRangeM: 0,
  minRangeM: 0,
  nezM: 0,
  shooterStartX: 0,
  shooterStartY: 0,

  appMode: 'tactical',

  setMissiles: (m) => set({ missiles: m }),
  updateMissile: (id, patch) =>
    set((s) => ({
      missiles: s.missiles.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),
  setScenario: (patch) => set((s) => {
    const next = { ...s, ...patch };
    // Keep targetHasMaws in sync with the selected target aircraft
    next.targetHasMaws = next.aircraft[next.targetAircraftId]?.hasMaws ?? false;
    return next;
  }),
  setSimFrames: (frames, result, maxRangeM, minRangeM, nezM, sX, sY) =>
    set({
      simFrames: frames,
      simResult: result,
      simStatus: result.hit ? 'hit' : 'miss',
      simError: null,
      currentFrameIdx: 0,
      maxRangeM,
      minRangeM,
      nezM,
      shooterStartX: sX,
      shooterStartY: sY,
    }),
  setSimError: (msg) => set({ simError: msg, simStatus: 'error' }),
  setCurrentFrameIdx: (idx) => set({ currentFrameIdx: idx }),
  setIsPlaying: (v) => set({ isPlaying: v }),
  setPlaybackSpeed: (v) => set({ playbackSpeed: v }),
  resetSim: () =>
    set({
      simFrames: [],
      currentFrameIdx: 0,
      simStatus: 'idle',
      simResult: null,
      simError: null,
      isPlaying: false,
    }),
  setShooterRole: (role) => set({ shooterRole: role, ...(role === 'ground' ? { shooterSpeed: 0 } : {}) }),
  addMissile: (m) => set((s) => ({ missiles: [...s.missiles, m] })),
  deleteMissile: (id) =>
    set((s) => ({
      missiles: s.missiles.filter((m) => m.id !== id),
      selectedMissileId:
        s.selectedMissileId === id
          ? (s.missiles.find((m) => m.id !== id)?.id ?? s.selectedMissileId)
          : s.selectedMissileId,
    })),
  setAppMode: (mode) => set({ appMode: mode }),
  addTargetWaypoint: (wp) =>
    set((s) => ({ targetWaypoints: [...s.targetWaypoints, wp] })),
  clearTargetWaypoints: () => set({ targetWaypoints: [] }),
}));
