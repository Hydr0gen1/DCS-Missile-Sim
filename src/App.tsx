import { useEffect, useState } from 'react';
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
          {(['tactical', 'envelope', 'editor'] as const).map((mode) => (
            <button
              key={mode}
              style={{ ...styles.navBtn, ...(appMode === mode ? styles.navBtnActive : {}) }}
              onClick={() => setAppMode(mode)}
            >
              {mode === 'tactical' ? 'TACTICAL' : mode === 'envelope' ? 'ENVELOPE' : 'MISSILE EDITOR'}
            </button>
          ))}
        </div>
        {simResult && appMode === 'tactical' && (
          <button
            style={{ ...styles.navBtn, borderColor: '#00aa44', color: '#00cc66', marginLeft: 8 }}
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
    background: '#060a06',
    color: '#aaccaa',
    fontFamily: 'Share Tech Mono, monospace',
    userSelect: 'none',
    overflow: 'hidden',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    padding: '5px 14px',
    background: '#080c08',
    borderBottom: '1px solid #1a3a1a',
    gap: 16,
    flexShrink: 0,
  },
  appTitle: {
    color: '#00ff80',
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 3,
    whiteSpace: 'nowrap',
  },
  nav: {
    display: 'flex',
    gap: 4,
  },
  navBtn: {
    background: 'transparent',
    border: '1px solid #1a3a1a',
    color: '#557755',
    fontFamily: 'Share Tech Mono, monospace',
    fontSize: 11,
    padding: '4px 12px',
    cursor: 'pointer',
    letterSpacing: 1,
  },
  navBtnActive: {
    background: '#0d1a0d',
    borderColor: '#00aa44',
    color: '#00ff80',
  },
  hint: {
    marginLeft: 'auto',
    color: '#334433',
    fontSize: 9,
    letterSpacing: 1,
  },
  viewBtn: {
    background: 'transparent',
    border: '1px solid #1a3a1a',
    color: '#557755',
    fontFamily: 'Share Tech Mono, monospace',
    fontSize: 10,
    padding: '2px 10px',
    cursor: 'pointer',
    letterSpacing: 1,
  },
  viewBtnActive: {
    background: '#0d1a0d',
    borderColor: '#00aa44',
    color: '#00ff80',
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
