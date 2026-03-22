import { useEffect, useRef } from 'react';
import { T } from './theme';
import { useSimStore, COMPARISON_COLORS } from '../store/simStore';
import type { ComparisonResult } from '../store/simStore';
import { validateScenario, runSimulation } from '../physics/engagement';
import { KTS_TO_MS } from '../physics/atmosphere';
import type { ScenarioConfig } from '../physics/engagement';
import { DT } from '../physics/engagement';
import { fillMissingFields } from '../physics/missile';
import { initRWRAudio, stopAllLoops } from '../audio/rwrAudio';

interface Props {
  mobile?: boolean;
}

export default function PlaybackBar({ mobile }: Props) {
  const store = useSimStore();
  const {
    missiles, aircraft,
    shooterRole,
    shooterAircraftId, shooterAlt, shooterSpeed, shooterHeading,
    targetAircraftId, targetAlt, targetSpeed, targetHeading,
    targetManeuver, targetChaffCount, targetFlareCount, targetWaypoints,
    targetHasMaws, targetReactOnDetect,
    rangeNm, aspectAngleDeg, selectedMissileId,
    shooterManeuver, salvoCount, salvoInterval_s, lockTime_s, manualLoftAngle_deg, salvoMissileIds,
    comparisonMode, comparisonMissileIds,
    simFrames, currentFrameIdx, simStatus, simResult,
    playbackSpeed, isPlaying,
    setSimFrames, setSimError, setCurrentFrameIdx, setIsPlaying,
    setPlaybackSpeed, resetSim, setMobileTab, setComparisonResults,
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

  function buildBaseCfg(): ScenarioConfig | null {
    const rawMissile = missiles.find((m) => m.id === selectedMissileId);
    if (!rawMissile) return null;
    const missile = fillMissingFields(rawMissile);
    const shooterAircraft = aircraft.find((a) => a.id === shooterAircraftId);
    const targetAircraft = aircraft[targetAircraftId];
    return {
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
      shooterManeuver,
      salvoCount,
      salvoInterval_s,
      lockTime_s,
      manualLoftAngle_deg,
      salvoMissiles: salvoMissileIds.map((id) => {
        if (!id) return null;
        const raw = missiles.find((ms) => ms.id === id) ?? null;
        return raw ? fillMissingFields(raw) : null;
      }),
    };
  }

  function handleLaunch() {
    initRWRAudio(); // iOS Safari: create/resume AudioContext inside user gesture
    stopAllLoops();
    // Don't call resetSim() — setSimFrames already clears all state and increments simVersion
    // in a single atomic update. Calling resetSim() first caused a double simVersion bump and
    // an intermediate empty-state render that confused the camera reset and playback.

    if (comparisonMode && comparisonMissileIds.length > 0) {
      // Run one simulation per comparison missile, all with the same scenario
      const baseCfg = buildBaseCfg();
      if (!baseCfg) return;
      try {
        const results: ComparisonResult[] = [];
        let firstMaxRangeM = 0, firstMinRangeM = 0, firstNezM = 0, firstSX = 0, firstSY = 0;
        for (let i = 0; i < comparisonMissileIds.length; i++) {
          const mslId = comparisonMissileIds[i];
          const rawMsl = missiles.find((m) => m.id === mslId);
          if (!rawMsl) continue;
          const msl = fillMissingFields(rawMsl);
          const mslCfg: ScenarioConfig = { ...baseCfg, missile: msl, salvoCount: 1, salvoMissiles: [null, null, null] };
          const err = validateScenario(mslCfg);
          if (err) { setSimError(`${rawMsl.name}: ${err}`); return; }
          const sim = runSimulation(mslCfg);
          if (i === 0) {
            firstMaxRangeM = sim.maxRangeM;
            firstMinRangeM = sim.minRangeM;
            firstNezM = sim.nezM;
            firstSX = sim.shooterStartX;
            firstSY = sim.shooterStartY;
          }
          results.push({
            missileId: mslId,
            missileName: rawMsl.name,
            color: COMPARISON_COLORS[i % COMPARISON_COLORS.length],
            frames: sim.frames,
            result: sim.result,
          });
        }
        setComparisonResults(results);
        // Use the longest simulation for the primary playback timeline
        const longest = results.reduce((a, b) => a.frames.length > b.frames.length ? a : b);
        setSimFrames(longest.frames, longest.result, firstMaxRangeM, firstMinRangeM, firstNezM, firstSX, firstSY);
        setCurrentFrameIdx(0);
        setIsPlaying(true);
        if (mobile) setMobileTab('view');
        lastTimeRef.current = performance.now();
        accumRef.current = 0;
      } catch (e) {
        setSimError(String(e));
      }
      return;
    }

    // Normal (single) launch
    const cfg = buildBaseCfg();
    if (!cfg) return;
    setComparisonResults([]);

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
      if (mobile) setMobileTab('view');
      lastTimeRef.current = performance.now();
      accumRef.current = 0;
    } catch (e) {
      setSimError(String(e));
    }
  }

  function handlePlayPause() {
    initRWRAudio(); // also resume audio context on play (iOS may re-suspend)
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
    stopAllLoops();
    resetSim();
  }

  const totalTime = simFrames.length > 0 ? simFrames[simFrames.length - 1].time : 0;
  const currentTime = simFrames[currentFrameIdx]?.time ?? 0;

  if (mobile) {
    return (
      <div style={mobileBarStyles.container}>
        {/* Row 1: Launch + controls + speed + status */}
        <div style={mobileBarStyles.row}>
          <button style={mobileBarStyles.launchBtn} onClick={handleLaunch}>
            LAUNCH
          </button>
          <button style={mobileBarStyles.btn} onClick={handlePlayPause}>
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button style={mobileBarStyles.btn} onClick={handleReset}>⟳</button>
          <select
            style={mobileBarStyles.speedSelect}
            value={playbackSpeed}
            onChange={(e) => setPlaybackSpeed(+e.target.value)}
          >
            {[1, 2, 4, 8].map((s) => (
              <option key={s} value={s}>{s}×</option>
            ))}
          </select>
          <span style={{ ...mobileBarStyles.status, color: statusColor(simStatus), marginLeft: 'auto' }}>
            {statusText(simStatus, simResult?.verdict)}
          </span>
        </div>
        {/* Row 2: Scrubber + time */}
        <div style={mobileBarStyles.row}>
          <input
            type="range"
            min={0}
            max={Math.max(0, simFrames.length - 1)}
            value={currentFrameIdx}
            onChange={(e) => { setCurrentFrameIdx(+e.target.value); setIsPlaying(false); }}
            style={{ flex: 1, accentColor: T.accent }}
          />
          <span style={mobileBarStyles.time}>T+{currentTime.toFixed(1)}s</span>
        </div>
      </div>
    );
  }

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

const mobileBarStyles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    padding: '7px 10px',
    background: T.bgSurface,
    borderTop: `1px solid ${T.border}`,
    fontFamily: T.fontUI,
    fontSize: 11,
    flexShrink: 0,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  launchBtn: {
    background: '#1a2a10',
    border: `1px solid ${T.accent}`,
    color: T.accentBright,
    fontFamily: T.fontUI,
    fontSize: 12,
    fontWeight: '600',
    padding: '8px 14px',
    borderRadius: 4,
    cursor: 'pointer',
    letterSpacing: 1,
  },
  btn: {
    background: T.bgRaised,
    border: `1px solid ${T.border}`,
    color: T.text,
    fontFamily: T.fontUI,
    fontSize: 14,
    padding: '7px 10px',
    borderRadius: 4,
    cursor: 'pointer',
    minWidth: 38,
    textAlign: 'center' as const,
  },
  speedSelect: {
    background: T.bgRaised,
    border: `1px solid ${T.border}`,
    color: T.text,
    fontFamily: T.fontUI,
    fontSize: 11,
    padding: '6px 6px',
    borderRadius: 3,
  },
  status: {
    fontSize: 10,
    fontFamily: T.fontMono,
    letterSpacing: 0.5,
    fontWeight: '600',
    whiteSpace: 'nowrap' as const,
  },
  time: {
    color: T.textDim,
    fontSize: 10,
    fontFamily: T.fontMono,
    whiteSpace: 'nowrap' as const,
    minWidth: 60,
    textAlign: 'right' as const,
  },
};

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
