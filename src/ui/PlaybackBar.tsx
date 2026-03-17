import { useEffect, useRef } from 'react';
import { useSimStore } from '../store/simStore';
import { validateScenario, runSimulation } from '../physics/engagement';
import { KTS_TO_MS } from '../physics/atmosphere';
import type { ScenarioConfig } from '../physics/engagement';
import { DT } from '../physics/engagement';

export default function PlaybackBar() {
  const store = useSimStore();
  const {
    missiles, aircraft,
    shooterAircraftId, shooterAlt, shooterSpeed, shooterHeading,
    targetAircraftId, targetAlt, targetSpeed, targetHeading,
    targetManeuver, targetChaffCount, targetFlareCount, targetWaypoints,
    targetHasMaws,
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

    const cfg: ScenarioConfig = {
      shooterType: shooterAircraftId,
      shooterAlt,
      shooterSpeed,
      shooterHeading,
      targetType: aircraft[targetAircraftId]?.id ?? 'generic',
      targetAlt,
      targetSpeed,
      targetHeading,
      targetManeuver,
      targetChaffCount,
      targetFlareCount,
      targetWaypoints,
      targetHasMaws,
      rangeNm,
      aspectAngleDeg,
      missile,
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
  if (s === 'hit') return '#00ff80';
  if (s === 'miss') return '#ff4444';
  if (s === 'error') return '#ff8800';
  if (s === 'running') return '#ffaa00';
  return '#556655';
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
    padding: '6px 12px',
    background: '#080c08',
    borderTop: '1px solid #1a3a1a',
    fontFamily: 'Share Tech Mono, monospace',
    fontSize: 11,
    color: '#aaccaa',
    flexWrap: 'wrap',
  },
  btn: {
    background: '#0d1a0d',
    border: '1px solid #2a4a2a',
    color: '#aaccaa',
    fontFamily: 'Share Tech Mono, monospace',
    fontSize: 11,
    padding: '4px 10px',
    cursor: 'pointer',
  },
  btnActive: {
    background: '#1a3a1a',
    borderColor: '#00aa44',
    color: '#00ff80',
  },
  launchBtn: {
    background: '#1a0000',
    borderColor: '#aa2222',
    color: '#ff4444',
    letterSpacing: 2,
    fontWeight: 'bold',
    padding: '4px 16px',
  },
  divider: {
    width: 1,
    height: 20,
    background: '#1a3a1a',
    margin: '0 2px',
  },
  label: {
    color: '#556655',
    fontSize: 9,
    letterSpacing: 1,
  },
  slider: {
    accentColor: '#00aa44',
  },
  time: {
    color: '#557755',
    fontSize: 10,
    minWidth: 110,
  },
  status: {
    fontSize: 11,
    letterSpacing: 1,
    minWidth: 120,
  },
};
