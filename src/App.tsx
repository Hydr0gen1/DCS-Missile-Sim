import { useEffect, useState } from 'react';
import { T } from './ui/theme';
import { useSimStore } from './store/simStore';
import SetupPanel from './ui/SetupPanel';
import TacticalDisplay from './ui/TacticalDisplay';
import TacticalDisplay3D from './ui/TacticalDisplay3D';
import RWRDisplay from './ui/RWRDisplay';
import ResultsPanel from './ui/ResultsPanel';
import PlaybackBar from './ui/PlaybackBar';
import MissileEditor from './ui/MissileEditor';
import EnvelopePlot from './ui/EnvelopePlot';
import SimSummaryModal from './ui/SimSummaryModal';
import ComparisonPanel from './ui/ComparisonPanel';

export default function App() {
  const { appMode, setAppMode, setIsPlaying, resetSim, setPlaybackSpeed, setCurrentFrameIdx, simFrames, currentFrameIdx, isPlaying, simStatus, simResult } =
    useSimStore();
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
  const [showSummary, setShowSummary] = useState(false);

  // Auto-open summary when sim completes
  useEffect(() => {
    if (simStatus === 'hit' || simStatus === 'miss') {
      setShowSummary(true);
    }
  }, [simStatus]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (simFrames.length > 0) {
          if (currentFrameIdx >= simFrames.length - 1) {
            setCurrentFrameIdx(0);
          }
          setIsPlaying(!isPlaying);
        }
      }
      if (e.key === 'r' || e.key === 'R') {
        resetSim();
      }
      if (e.key === '+' || e.key === '=') {
        const { playbackSpeed } = useSimStore.getState();
        setPlaybackSpeed(Math.min(playbackSpeed * 2, 8));
      }
      if (e.key === '-') {
        const { playbackSpeed } = useSimStore.getState();
        setPlaybackSpeed(Math.max(playbackSpeed / 2, 1));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPlaying, simFrames.length, currentFrameIdx]);

  return (
    <div style={styles.root}>
      {/* Top nav */}
      <div style={styles.topBar}>
        <div style={styles.appTitle}>DCS MISSILE SIM</div>
        <div style={styles.nav}>
          {(['tactical', 'envelope', 'compare', 'editor'] as const).map((mode) => (
            <button
              key={mode}
              style={{ ...styles.navBtn, ...(appMode === mode ? styles.navBtnActive : {}) }}
              onClick={() => setAppMode(mode)}
            >
              {mode === 'tactical' ? 'TACTICAL' : mode === 'envelope' ? 'ENVELOPE' : mode === 'compare' ? 'COMPARE' : 'MISSILE EDITOR'}
            </button>
          ))}
        </div>
        {simResult && appMode === 'tactical' && (
          <button
            style={{ ...styles.navBtn, borderColor: T.success, color: T.success, marginLeft: 8 }}
            onClick={() => setShowSummary(true)}
          >
            RESULTS
          </button>
        )}
        <div style={styles.hint}>SPACE=play/pause  R=reset  +/-=speed</div>
      </div>

      {/* Main content */}
      <div style={styles.main}>
        {appMode === 'tactical' && (
          <>
            <SetupPanel />
            <div style={styles.center}>
              {/* 2D / 3D view toggle */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                <button
                  style={{ ...styles.viewBtn, ...(viewMode === '2d' ? styles.viewBtnActive : {}) }}
                  onClick={() => setViewMode('2d')}
                >2D</button>
                <button
                  style={{ ...styles.viewBtn, ...(viewMode === '3d' ? styles.viewBtnActive : {}) }}
                  onClick={() => setViewMode('3d')}
                >3D</button>
              </div>
              {viewMode === '2d' ? <TacticalDisplay /> : <TacticalDisplay3D />}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <ResultsPanel />
              <RWRDisplay />
            </div>
          </>
        )}
        {appMode === 'envelope' && (
          <>
            <SetupPanel />
            <div style={styles.center}>
              <EnvelopePlot />
            </div>
          </>
        )}
        {appMode === 'compare' && (
          <ComparisonPanel />
        )}
        {appMode === 'editor' && (
          <div style={{ flex: 1 }}>
            <MissileEditor />
          </div>
        )}
      </div>

      {/* Bottom playback bar */}
      {appMode === 'tactical' && <PlaybackBar />}

      {/* Engagement summary modal */}
      {showSummary && <SimSummaryModal onClose={() => setShowSummary(false)} />}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: T.bgBase,
    color: T.text,
    fontFamily: T.fontUI,
    userSelect: 'none',
    overflow: 'hidden',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 16px',
    background: T.bgSurface,
    borderBottom: `1px solid ${T.border}`,
    gap: 16,
    flexShrink: 0,
  },
  appTitle: {
    color: T.accentBright,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 2,
    whiteSpace: 'nowrap',
    fontFamily: T.fontUI,
  },
  nav: {
    display: 'flex',
    gap: 4,
  },
  navBtn: {
    background: 'transparent',
    border: `1px solid ${T.border}`,
    color: T.textDim,
    fontFamily: T.fontUI,
    fontSize: 11,
    fontWeight: '500',
    padding: '4px 14px',
    cursor: 'pointer',
    letterSpacing: 0.5,
    borderRadius: 4,
    transition: 'background 0.15s, color 0.15s',
  },
  navBtnActive: {
    background: T.bgRaised,
    borderColor: T.accent,
    color: T.accentBright,
  },
  hint: {
    marginLeft: 'auto',
    color: T.textFaint,
    fontSize: 9,
    letterSpacing: 0.5,
    fontFamily: T.fontMono,
  },
  viewBtn: {
    background: 'transparent',
    border: `1px solid ${T.border}`,
    color: T.textDim,
    fontFamily: T.fontUI,
    fontSize: 10,
    fontWeight: '500',
    padding: '3px 12px',
    cursor: 'pointer',
    borderRadius: 3,
  },
  viewBtnActive: {
    background: T.bgRaised,
    borderColor: T.accent,
    color: T.accentBright,
  },
  main: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  center: {
    flex: 1,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '8px',
    overflowY: 'auto',
  },
};
