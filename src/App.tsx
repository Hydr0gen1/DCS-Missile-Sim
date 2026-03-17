import { useEffect } from 'react';
import { useSimStore } from './store/simStore';
import SetupPanel from './ui/SetupPanel';
import TacticalDisplay from './ui/TacticalDisplay';
import ResultsPanel from './ui/ResultsPanel';
import PlaybackBar from './ui/PlaybackBar';
import MissileEditor from './ui/MissileEditor';
import EnvelopePlot from './ui/EnvelopePlot';

export default function App() {
  const { appMode, setAppMode, setIsPlaying, resetSim, setPlaybackSpeed, setCurrentFrameIdx, simFrames, currentFrameIdx, isPlaying } =
    useSimStore();

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
        <div style={styles.hint}>SPACE=play/pause  R=reset  +/-=speed</div>
      </div>

      {/* Main content */}
      <div style={styles.main}>
        {appMode === 'tactical' && (
          <>
            <SetupPanel />
            <div style={styles.center}>
              <TacticalDisplay />
            </div>
            <ResultsPanel />
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
