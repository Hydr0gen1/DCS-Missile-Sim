import { useEffect, useRef } from 'react';
import { T } from './theme';
import { useSimStore } from '../store/simStore';
import { validateScenario, runSimulation } from '../physics/engagement';
import { KTS_TO_MS } from '../physics/atmosphere';
import type { ScenarioConfig } from '../physics/engagement';
import { DT } from '../physics/engagement';

export default function PlaybackBar() {
  const store = useSimStore();
  const {
    missiles, aircraft,
    shooterRole,
    shooterAircraftId, shooterAlt, shooterSpeed, shooterHeading,
    targetAircraftId, targetAlt, targetSpeed, targetHeading,
    targetManeuver, targetChaffCount, targetFlareCount, targetWaypoints,
    targetHasMaws, targetReactOnDetect,
    rangeNm, aspectAngleDeg, selectedMissileId,
    simFrames, currentFrameIdx, simStatus, simResult,
    playbackSpeed, isPlaying,
    setSimFrames, setSimError, setCurrentFrameIdx, setIsPlaying,
    setPlaybackSpeed, resetSim,
  } = store;

  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const accumRef = useRef<number>(0);

  // Animation loop
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    const step = (now: number) => {
      const elapsed = now - lastTimeRef.current;
      lastTimeRef.current = now;
      accumRef.current += (elapsed / 1000) * playbackSpeed;

      const framesPerStep = Math.floor(accumRef.current / DT);
      if (framesPerStep > 0) {
        accumRef.current -= framesPerStep * DT;
        setCurrentFrameIdx(Math.min(currentFrameIdx + framesPerStep, simFrames.length - 1));
      }

      if (currentFrameIdx >= simFrames.length - 1) {
        setIsPlaying(false);
        return;
      }

      rafRef.current = requestAnimationFrame(step);
    };

    lastTimeRef.current = performance.now();
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, playbackSpeed, currentFrameIdx, simFrames.length]);

  function handleLaunch() {
    resetSim();
    const missile = missiles.find((m) => m.id === selectedMissileId);
    if (!missile) return;

    const shooterAircraft = aircraft.find((a) => a.id === shooterAircraftId);
    const targetAircraft = aircraft[targetAircraftId];

    const cfg: ScenarioConfig = {
      shooterRole,
      shooterType: shooterAircraftId,
      shooterAlt,
      shooterSpeed: shooterRole === 'ground' ? 0 : shooterSpeed,
      shooterHeading,
      targetType: targetAircraft?.id ?? 'generic',
      targetAlt,
      targetSpeed,
      targetHeading,
      targetManeuver,
      targetChaffCount,
      targetFlareCount,
      targetWaypoints,
      targetHasMaws,
      targetReactOnDetect,
      rangeNm,
      aspectAngleDeg,
      missile,
      shooterAircraftData: shooterAircraft,
      targetAircraftData: targetAircraft,
    };

    const err = validateScenario(cfg);
    if (err) {
      setSimError(err);
      return;
    }

    try {
      const { frames, result, maxRangeM, minRangeM, nezM, shooterStartX, shooterStartY } = runSimulation(cfg);
      setSimFrames(frames, result, maxRangeM, minRangeM, nezM, shooterStartX, shooterStartY);
      setCurrentFrameIdx(0);
      setIsPlaying(true);
      lastTimeRef.current = performance.now();
      accumRef.current = 0;
    } catch (e) {
      setSimError(String(e));
    }
  }

  function handlePlayPause() {
    if (simFrames.length === 0) return;
    if (currentFrameIdx >= simFrames.length - 1) {
      setCurrentFrameIdx(0);
    }
    lastTimeRef.current = performance.now();
    accumRef.current = 0;
    setIsPlaying(!isPlaying);
  }

  function handleStep() {
    if (currentFrameIdx < simFrames.length - 1) {
      setCurrentFrameIdx(currentFrameIdx + 1);
    }
  }

  function handleReset() {
    resetSim();
  }

  const totalTime = simFrames.length > 0 ? simFrames[simFrames.length - 1].time : 0;
  const currentTime = simFrames[currentFrameIdx]?.time ?? 0;

  return (
    <div style={styles.bar}>
      {/* Launch button */}
      <button
        style={{ ...styles.btn, ...styles.launchBtn }}
        onClick={handleLaunch}
        title="Compute and run engagement simulation"
      >
        LAUNCH
      </button>

      <div style={styles.divider} />

      {/* Playback controls */}
      <button style={styles.btn} onClick={handlePlayPause} title="Play/Pause (Space)">
        {isPlaying ? '⏸' : '▶'}
      </button>
      <button style={styles.btn} onClick={handleStep} title="Step one frame forward">
        ⏭
      </button>
      <button style={styles.btn} onClick={handleReset} title="Reset simulation (R)">
        ⟳
      </button>

      <div style={styles.divider} />

      {/* Speed */}
      <span style={styles.label}>SPEED</span>
      {[1, 2, 4, 8].map((s) => (
        <button
          key={s}
          style={{ ...styles.btn, ...(playbackSpeed === s ? styles.btnActive : {}) }}
          onClick={() => setPlaybackSpeed(s)}
          title={`${s}× playback speed`}
        >
          {s}×
        </button>
      ))}

      <div style={styles.divider} />

      {/* Timeline scrubber */}
      <input
        type="range"
        min={0}
        max={Math.max(0, simFrames.length - 1)}
        value={currentFrameIdx}
        onChange={(e) => { setCurrentFrameIdx(+e.target.value); setIsPlaying(false); }}
        style={{ ...styles.slider, width: 120 }}
        title="Scrub through engagement timeline"
      />
      <span style={styles.time}>
        T+{currentTime.toFixed(1)}s / {totalTime.toFixed(1)}s
      </span>

      <div style={styles.divider} />

      {/* Status */}
      <span style={{ ...styles.status, color: statusColor(simStatus) }}>
        {statusText(simStatus, simResult?.verdict)}
      </span>
    </div>
  );
}

function statusColor(s: string): string {
  if (s === 'hit') return T.success;
  if (s === 'miss') return T.danger;
  if (s === 'error') return T.warning;
  if (s === 'running') return T.accentBright;
  return T.textDim;
}

function statusText(s: string, verdict?: string | null): string {
  if (s === 'idle') return 'READY';
  if (s === 'running') return 'RUNNING...';
  if (s === 'error') return 'ERROR';
  if (s === 'hit') return verdict ?? 'KILL';
  if (s === 'miss') return verdict ?? 'MISS';
  return s.toUpperCase();
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 14px',
    background: T.bgSurface,
    borderTop: `1px solid ${T.border}`,
    fontFamily: T.fontUI,
    fontSize: 11,
    color: T.text,
    flexWrap: 'wrap',
  },
  btn: {
    background: T.bgRaised,
    border: `1px solid ${T.border}`,
    color: T.text,
    fontFamily: T.fontUI,
    fontSize: 11,
    fontWeight: '500',
    padding: '4px 12px',
    cursor: 'pointer',
    borderRadius: 4,
  },
  btnActive: {
    background: T.bgHover,
    borderColor: T.accent,
    color: T.accentBright,
  },
  launchBtn: {
    background: '#2a1010',
    borderColor: T.danger,
    color: T.danger,
    letterSpacing: 1.5,
    fontWeight: '600',
    padding: '5px 18px',
    borderRadius: 4,
  },
  divider: {
    width: 1,
    height: 20,
    background: T.border,
    margin: '0 2px',
  },
  label: {
    color: T.textDim,
    fontSize: 9,
    letterSpacing: 0.5,
    fontWeight: '600',
    textTransform: 'uppercase' as const,
  },
  slider: {
    accentColor: T.accent,
  },
  time: {
    color: T.textDim,
    fontSize: 10,
    minWidth: 110,
    fontFamily: T.fontMono,
  },
  status: {
    fontSize: 11,
    letterSpacing: 0.5,
    minWidth: 120,
    fontFamily: T.fontMono,
    fontWeight: '600',
  },
};
