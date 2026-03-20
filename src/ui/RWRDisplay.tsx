/**
 * RWRDisplay — Radar Warning Receiver + MAWS scope for the target aircraft.
 *
 * RWR (radar threats only): shows contacts for SARH illumination and ARH
 * active-seeker detections. IR missiles are SILENT to RWR.
 *
 * MAWS (all missile types, only if aircraft equipped): shows coarse 8-sector
 * warning when a missile motor is burning. No precise bearing — sectors only.
 */
import { useEffect, useRef } from 'react';
import { useSimStore } from '../store/simStore';
import type { RWRThreat, MAWSSector } from '../data/types';
import type React from 'react';
import { T } from './theme';
import {
  initRWRAudio,
  playNewContact,
  playPitbullChirp,
  startLockTone, stopLockTone,
  startLaunchWarble, stopLaunchWarble,
  startMAWSAlarm, stopMAWSAlarm,
  startSearchPing, stopSearchPing,
  stopAllLoops,
} from '../audio/rwrAudio';

const R = 70;          // scope radius px
const CX = R + 10;     // center x
const CY = R + 10;     // center y
const SIZE = (R + 10) * 2;

const THREAT_COLORS: Record<string, string> = {
  search:  T.textDim,
  track:   T.typeSARH,
  launch:  T.danger,
  active:  T.danger,
  maws:    T.accent,   // orange — MAWS passive IR detection
};

function bearing2xy(bearing: number, radius: number): [number, number] {
  // bearing 0 = nose (up on scope), 90 = right
  const rad = (bearing - 90) * Math.PI / 180;
  return [
    CX + Math.cos(rad) * radius,
    CY + Math.sin(rad) * radius,
  ];
}

/** Priority rank for selecting the "most dangerous" threat for the diamond */
function threatPriority(t: RWRThreat): number {
  if (t.type === 'active') return 4;
  if (t.type === 'launch') return 3;
  if (t.type === 'track')  return 2;
  if (t.type === 'search') return 1;
  return 0; // maws = lowest priority (passive IR, not a radar spike)
}

function RWRScope({ threats }: { threats: RWRThreat[] }) {
  // Pick highest-priority threat for the diamond overlay
  const priority = threats.reduce<RWRThreat | null>((best, t) =>
    best === null || threatPriority(t) > threatPriority(best) ? t : best, null);

  return (
    <svg width={SIZE} height={SIZE} style={{ display: 'block' }}>
      {/* Background */}
      <circle cx={CX} cy={CY} r={R} fill={T.bgBase} stroke={T.border} strokeWidth={1} />
      {/* Inner ring */}
      <circle cx={CX} cy={CY} r={R * 0.5} fill="none" stroke={T.borderDim} strokeWidth={0.5} />
      {/* Cross-hairs */}
      <line x1={CX} y1={CY - R} x2={CX} y2={CY + R} stroke={T.borderDim} strokeWidth={0.5} />
      <line x1={CX - R} y1={CY} x2={CX + R} y2={CY} stroke={T.borderDim} strokeWidth={0.5} />
      {/* Cardinal labels */}
      <text x={CX} y={CY - R + 9} textAnchor="middle" fill={T.textFaint} fontSize={8} fontFamily={T.fontMono}>N</text>
      <text x={CX} y={CY + R - 2} textAnchor="middle" fill={T.textFaint} fontSize={8} fontFamily={T.fontMono}>S</text>
      <text x={CX + R - 2} y={CY + 3} textAnchor="end" fill={T.textFaint} fontSize={8} fontFamily={T.fontMono}>E</text>
      <text x={CX - R + 2} y={CY + 3} textAnchor="start" fill={T.textFaint} fontSize={8} fontFamily={T.fontMono}>W</text>
      {/* Heading bug — green triangle at 12-o-clock (nose direction) */}
      <polygon
        points={`${CX},${CY - R + 3} ${CX - 4},${CY - R + 9} ${CX + 4},${CY - R + 9}`}
        fill={T.success}
        opacity={0.9}
      />
      {/* Own aircraft dot */}
      <circle cx={CX} cy={CY} r={3} fill={T.success} />
      {/* Threat contacts */}
      {threats.length === 0 && (
        <text x={CX} y={CY + 18} textAnchor="middle" fill={T.textFaint} fontSize={9} fontFamily={T.fontMono}>– –</text>
      )}
      {threats.map((t, i) => {
        const color = THREAT_COLORS[t.type] ?? T.typeSARH;
        const [dotX, dotY] = bearing2xy(t.bearing, R * 0.78);
        const [labelX, labelY] = bearing2xy(t.bearing, R * 0.94);
        const isActive = t.type === 'active' || t.type === 'launch';
        const opacity = 0.4 + t.intensity * 0.6;
        const isPriority = priority === t;
        return (
          <g key={i}>
            {/* Priority diamond outline around the most dangerous contact */}
            {isPriority && (
              <polygon
                points={`${dotX},${dotY - 7} ${dotX + 7},${dotY} ${dotX},${dotY + 7} ${dotX - 7},${dotY}`}
                fill="none"
                stroke={color}
                strokeWidth={1}
                opacity={opacity}
                style={isActive ? { animation: 'rwr-blink 0.6s step-start infinite' } : undefined}
              />
            )}
            {/* Contact dot at bearing */}
            <circle
              cx={dotX} cy={dotY} r={isActive ? 4 : 3}
              fill={color}
              opacity={opacity}
              style={isActive ? { animation: 'rwr-blink 0.6s step-start infinite' } : undefined}
            />
            <text
              x={labelX} y={labelY}
              textAnchor="middle" dominantBaseline="middle"
              fill={color} fontSize={7}
              fontFamily={T.fontMono}
              opacity={opacity}
              style={isActive ? { animation: 'rwr-blink 0.6s step-start infinite' } : undefined}
            >
              {t.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function MAWSRing({ sectors, hasMaws }: { sectors: MAWSSector[]; hasMaws: boolean }) {
  const mr = 32; // ring radius
  const mc = 44; // center
  const totalSize = mc * 2;
  const SECTOR_LABELS = ['F', 'FR', 'R', 'RR', 'A', 'RL', 'L', 'FL'];
  const activeSectors = new Set(sectors.map(s => s.sectorIdx));

  return (
    <svg width={totalSize} height={totalSize} style={{ display: 'block' }}>
      <rect width={totalSize} height={totalSize} fill={T.bgBase} />
      {!hasMaws ? (
        <>
          <text x={mc} y={mc - 4} textAnchor="middle" fill={T.textFaint} fontSize={8} fontFamily={T.fontMono}>NO</text>
          <text x={mc} y={mc + 6} textAnchor="middle" fill={T.textFaint} fontSize={8} fontFamily={T.fontMono}>MAWS</text>
        </>
      ) : (
        <>
          {/* 8 sectors */}
          {Array.from({ length: 8 }, (_, i) => {
            const startAngle = (i * 45 - 90 - 22.5) * Math.PI / 180;
            const endAngle   = ((i + 1) * 45 - 90 - 22.5) * Math.PI / 180;
            const x1 = mc + Math.cos(startAngle) * mr;
            const y1 = mc + Math.sin(startAngle) * mr;
            const x2 = mc + Math.cos(endAngle) * mr;
            const y2 = mc + Math.sin(endAngle) * mr;
            const isActive = activeSectors.has(i);
            const midAngle = ((i * 45 + 22.5) - 90) * Math.PI / 180;
            const lx = mc + Math.cos(midAngle) * (mr * 0.65);
            const ly = mc + Math.sin(midAngle) * (mr * 0.65);
            return (
              <g key={i}>
                <path
                  d={`M${mc},${mc} L${x1},${y1} A${mr},${mr} 0 0,1 ${x2},${y2} Z`}
                  fill={isActive ? 'rgba(212,132,90,0.35)' : 'rgba(30,30,46,0.6)'}
                  stroke={isActive ? T.accent : T.borderDim}
                  strokeWidth={0.5}
                  style={isActive ? { animation: 'rwr-blink 0.5s step-start infinite' } : undefined}
                />
                <text
                  x={lx} y={ly + 2}
                  textAnchor="middle" dominantBaseline="middle"
                  fill={isActive ? T.accentBright : T.textFaint}
                  fontSize={6}
                  fontFamily={T.fontMono}
                >
                  {SECTOR_LABELS[i]}
                </text>
              </g>
            );
          })}
          {/* Center dot */}
          <circle cx={mc} cy={mc} r={4} fill={T.bgRaised} stroke={T.border} strokeWidth={0.5} />
        </>
      )}
    </svg>
  );
}

export default function RWRDisplay() {
  const { simFrames, currentFrameIdx, targetHasMaws, isPlaying, rwrAudioMuted, setRwrAudioMuted } = useSimStore();
  const frame = simFrames[currentFrameIdx];
  const rwr = frame?.rwr;

  const radarThreats = rwr?.radarThreats ?? [];
  const mawsSectors  = rwr?.mawsSectors  ?? [];

  const radarWarning  = rwr?.radarWarning  ?? false;
  const launchWarning = rwr?.launchWarning ?? false;
  const mawsWarning   = rwr?.mawsWarning   ?? false;

  // Refs for transition detection (one-shot events)
  const prevThreatsRef = useRef<RWRThreat[]>([]);
  const audioInitRef = useRef(false);

  function ensureAudio() {
    if (!audioInitRef.current) {
      initRWRAudio();
      audioInitRef.current = true;
    }
  }

  // ── Stop all loops when paused, muted, or unmounted ─────────────────────────
  useEffect(() => {
    if (!isPlaying || rwrAudioMuted) {
      stopAllLoops();
      return;
    }
    return () => stopAllLoops();
  }, [isPlaying, rwrAudioMuted]);

  // ── Manage looping tones based on current threat state ───────────────────────
  useEffect(() => {
    if (!isPlaying || rwrAudioMuted) return;

    const hasActive = radarThreats.some(t => t.type === 'active');
    const hasLaunch = radarThreats.some(t => t.type === 'launch');
    const hasTrack  = radarThreats.some(t => t.type === 'track');
    const hasSearch = radarThreats.some(t => t.type === 'search');

    // Active seeker or launch warning = warble (highest priority)
    if (hasActive || hasLaunch) {
      stopLockTone();
      stopSearchPing();
      ensureAudio();
      startLaunchWarble();
    } else {
      stopLaunchWarble();
    }

    // STT lock = repeating lock tone (only when no active/launch)
    if (hasTrack && !hasActive && !hasLaunch) {
      stopSearchPing();
      ensureAudio();
      startLockTone();
    } else if (!hasTrack) {
      stopLockTone();
    }

    // Search only = periodic ping
    if (hasSearch && !hasTrack && !hasActive && !hasLaunch) {
      ensureAudio();
      startSearchPing();
    } else if (!hasSearch) {
      stopSearchPing();
    }

    // MAWS alarm
    if (mawsWarning) {
      ensureAudio();
      startMAWSAlarm();
    } else {
      stopMAWSAlarm();
    }
  }, [radarThreats, mawsWarning, isPlaying, rwrAudioMuted]);

  // ── One-shot chirps for new-contact and pitbull transitions ──────────────────
  useEffect(() => {
    if (!isPlaying || rwrAudioMuted) {
      prevThreatsRef.current = radarThreats;
      return;
    }

    const prev = prevThreatsRef.current;
    const prevIds = new Set(prev.map(t => t.emitterId));
    const prevTypes = new Map(prev.map(t => [t.emitterId, t.type]));

    for (const t of radarThreats) {
      if (t.type === 'maws') continue; // MAWS passive detections don't trigger RWR audio
      if (!prevIds.has(t.emitterId)) {
        // Brand-new contact
        ensureAudio();
        if (t.type === 'active') playPitbullChirp();
        else playNewContact();
      } else {
        const pt = prevTypes.get(t.emitterId);
        if (pt !== 'active' && t.type === 'active') {
          ensureAudio();
          playPitbullChirp();
        }
      }
    }

    prevThreatsRef.current = radarThreats;
  }, [radarThreats, isPlaying, rwrAudioMuted]);

  return (
    <div style={styles.panel}>
      <style>{`
        @keyframes rwr-blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
      `}</style>

      {/* ── RWR Scope ── */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>RWR</div>
        <RWRScope threats={radarThreats} />
      </div>

      {/* ── MAWS Display ── */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>MAWS</div>
        <MAWSRing sectors={mawsSectors} hasMaws={targetHasMaws} />
      </div>

      {/* ── Status bar ── */}
      <div style={styles.statusBar}>
        <span style={{ ...styles.statusItem, color: radarWarning ? T.typeSARH : T.textFaint }}>
          {radarWarning ? '◆ RADAR' : '◇ RADAR'}
        </span>
        <span style={{ ...styles.statusItem, color: launchWarning ? T.danger : T.textFaint }}>
          {launchWarning ? '▲ LAUNCH' : '△ LAUNCH'}
        </span>
        <span style={{ ...styles.statusItem, color: mawsWarning ? T.accent : T.textFaint }}>
          {mawsWarning ? '● MAWS' : '○ MAWS'}
        </span>
      </div>

      {/* ── Audio mute toggle ── */}
      <button
        style={{
          ...styles.muteBtn,
          color: rwrAudioMuted ? T.textFaint : T.accent,
          borderColor: rwrAudioMuted ? T.borderDim : T.accent,
        }}
        onClick={() => {
          ensureAudio();
          setRwrAudioMuted(!rwrAudioMuted);
        }}
        title={rwrAudioMuted ? 'Unmute RWR audio' : 'Mute RWR audio'}
      >
        {rwrAudioMuted ? '🔇 AUDIO OFF' : '🔊 AUDIO ON'}
      </button>

      {/* ── Legend ── */}
      <div style={styles.legend}>
        <span style={{ color: T.textDim }}>■</span> SEARCH&nbsp;
        <span style={{ color: T.typeSARH }}>■</span> TRACK&nbsp;
        <span style={{ color: T.danger }}>■</span> ACT/LCH&nbsp;
        <span style={{ color: T.accent }}>■</span> MAWS
      </div>
      <div style={{ ...styles.legend, color: T.textFaint, marginTop: 1 }}>
        IR = RWR SILENT · MAWS = passive IR
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    background: T.bgSurface,
    border: `1px solid ${T.border}`,
    padding: '6px 8px',
    fontFamily: T.fontMono,
    userSelect: 'none',
    minWidth: 108,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  sectionHeader: {
    fontSize: 9,
    color: T.accent,
    letterSpacing: 2,
    borderBottom: `1px solid ${T.borderDim}`,
    paddingBottom: 1,
  },
  statusBar: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    borderTop: `1px solid ${T.borderDim}`,
    paddingTop: 4,
  },
  statusItem: {
    fontSize: 9,
    letterSpacing: 1,
  },
  muteBtn: {
    background: 'transparent',
    border: '1px solid',
    borderRadius: 2,
    fontSize: 8,
    letterSpacing: 0.5,
    padding: '2px 4px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'center',
  },
  legend: {
    fontSize: 7,
    color: T.textFaint,
    letterSpacing: 0.5,
  },
};
