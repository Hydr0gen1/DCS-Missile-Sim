/**
 * RWRDisplay — Radar Warning Receiver + MAWS scope for the target aircraft.
 *
 * RWR (radar threats only): shows strobe lines for SARH illumination and ARH
 * active-seeker detections. IR missiles are SILENT to RWR.
 *
 * MAWS (all missile types, only if aircraft equipped): shows coarse 8-sector
 * warning when a missile motor is burning. No precise bearing — sectors only.
 */
import { useSimStore } from '../store/simStore';
import type { RWRThreat, MAWSSector } from '../data/types';
import type React from 'react';

const R = 70;          // scope radius px
const CX = R + 10;     // center x
const CY = R + 10;     // center y
const SIZE = (R + 10) * 2;

const THREAT_COLORS: Record<string, string> = {
  search:  '#dddd00',
  track:   '#ffaa00',
  launch:  '#ff2222',
  active:  '#ff2222',
};

function bearing2xy(bearing: number, radius: number): [number, number] {
  // bearing 0 = nose (up on scope), 90 = right
  const rad = (bearing - 90) * Math.PI / 180;
  return [
    CX + Math.cos(rad) * radius,
    CY + Math.sin(rad) * radius,
  ];
}

function RWRScope({ threats }: { threats: RWRThreat[] }) {
  return (
    <svg width={SIZE} height={SIZE} style={{ display: 'block' }}>
      {/* Background */}
      <circle cx={CX} cy={CY} r={R} fill="#040a04" stroke="#1a3a1a" strokeWidth={1} />
      {/* Inner rings */}
      <circle cx={CX} cy={CY} r={R * 0.5} fill="none" stroke="#0d1e0d" strokeWidth={0.5} />
      {/* Cross-hairs */}
      <line x1={CX} y1={CY - R} x2={CX} y2={CY + R} stroke="#0d1e0d" strokeWidth={0.5} />
      <line x1={CX - R} y1={CY} x2={CX + R} y2={CY} stroke="#0d1e0d" strokeWidth={0.5} />
      {/* Cardinal labels */}
      <text x={CX} y={CY - R + 9} textAnchor="middle" fill="#2a5a2a" fontSize={8} fontFamily="Share Tech Mono, monospace">N</text>
      <text x={CX} y={CY + R - 2} textAnchor="middle" fill="#2a5a2a" fontSize={8} fontFamily="Share Tech Mono, monospace">S</text>
      <text x={CX + R - 2} y={CY + 3} textAnchor="end" fill="#2a5a2a" fontSize={8} fontFamily="Share Tech Mono, monospace">E</text>
      <text x={CX - R + 2} y={CY + 3} textAnchor="start" fill="#2a5a2a" fontSize={8} fontFamily="Share Tech Mono, monospace">W</text>
      {/* Own aircraft dot */}
      <circle cx={CX} cy={CY} r={3} fill="#00ff80" />
      {/* Threat strobes */}
      {threats.length === 0 && (
        <text x={CX} y={CY + 18} textAnchor="middle" fill="#1a3a1a" fontSize={9} fontFamily="Share Tech Mono, monospace">– –</text>
      )}
      {threats.map((t, i) => {
        const color = THREAT_COLORS[t.type] ?? '#ffaa00';
        // Strobe from inner radius to 78% — label at 92% (outside strobe, no overlap)
        const [lx, ly] = bearing2xy(t.bearing, R * 0.2);
        const [tx, ty] = bearing2xy(t.bearing, R * 0.78);
        const [labelX, labelY] = bearing2xy(t.bearing, R * 0.94);
        const isActive = t.type === 'active' || t.type === 'launch';
        return (
          <g key={i}>
            <line
              x1={lx} y1={ly} x2={tx} y2={ty}
              stroke={color}
              strokeWidth={isActive ? 1.8 : 1.2}
              strokeOpacity={0.6 + t.intensity * 0.4}
              style={isActive ? { animation: 'rwr-blink 0.6s step-start infinite' } : undefined}
            />
            {/* Small dot at strobe tip */}
            <circle cx={tx} cy={ty} r={2.5} fill={color}
              opacity={0.6 + t.intensity * 0.4}
              style={isActive ? { animation: 'rwr-blink 0.6s step-start infinite' } : undefined}
            />
            <text
              x={labelX} y={labelY}
              textAnchor="middle" dominantBaseline="middle"
              fill={color} fontSize={7}
              fontFamily="Share Tech Mono, monospace"
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
      <rect width={totalSize} height={totalSize} fill="#040a04" />
      {!hasMaws ? (
        <>
          <text x={mc} y={mc - 4} textAnchor="middle" fill="#223322" fontSize={8} fontFamily="Share Tech Mono, monospace">NO</text>
          <text x={mc} y={mc + 6} textAnchor="middle" fill="#223322" fontSize={8} fontFamily="Share Tech Mono, monospace">MAWS</text>
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
            // Label position (midpoint of arc)
            const midAngle = ((i * 45 + 22.5) - 90) * Math.PI / 180;
            const lx = mc + Math.cos(midAngle) * (mr * 0.65);
            const ly = mc + Math.sin(midAngle) * (mr * 0.65);
            return (
              <g key={i}>
                <path
                  d={`M${mc},${mc} L${x1},${y1} A${mr},${mr} 0 0,1 ${x2},${y2} Z`}
                  fill={isActive ? 'rgba(255,120,0,0.55)' : 'rgba(20,40,20,0.4)'}
                  stroke={isActive ? '#ff7800' : '#1a3a1a'}
                  strokeWidth={0.5}
                  style={isActive ? { animation: 'rwr-blink 0.5s step-start infinite' } : undefined}
                />
                <text
                  x={lx} y={ly + 2}
                  textAnchor="middle" dominantBaseline="middle"
                  fill={isActive ? '#ff7800' : '#1a3a1a'}
                  fontSize={6}
                  fontFamily="Share Tech Mono, monospace"
                >
                  {SECTOR_LABELS[i]}
                </text>
              </g>
            );
          })}
          {/* Center dot */}
          <circle cx={mc} cy={mc} r={4} fill="#224422" stroke="#1a5a1a" strokeWidth={0.5} />
        </>
      )}
    </svg>
  );
}

export default function RWRDisplay() {
  const { simFrames, currentFrameIdx, targetHasMaws } = useSimStore();
  const frame = simFrames[currentFrameIdx];
  const rwr = frame?.rwr;

  const radarThreats = rwr?.radarThreats ?? [];
  const mawsSectors  = rwr?.mawsSectors  ?? [];

  const radarWarning  = rwr?.radarWarning  ?? false;
  const launchWarning = rwr?.launchWarning ?? false;
  const mawsWarning   = rwr?.mawsWarning   ?? false;

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
        <span style={{ ...styles.statusItem, color: radarWarning ? '#ffaa00' : '#1a3a1a' }}>
          {radarWarning ? '◆ RADAR' : '◇ RADAR'}
        </span>
        <span style={{ ...styles.statusItem, color: launchWarning ? '#ff2222' : '#1a3a1a' }}>
          {launchWarning ? '▲ LAUNCH' : '△ LAUNCH'}
        </span>
        <span style={{ ...styles.statusItem, color: mawsWarning ? '#ff7800' : '#1a3a1a' }}>
          {mawsWarning ? '● MAWS' : '○ MAWS'}
        </span>
      </div>

      {/* ── Legend ── */}
      <div style={styles.legend}>
        <span style={{ color: '#dddd00' }}>■</span> SEARCH&nbsp;
        <span style={{ color: '#ffaa00' }}>■</span> TRACK&nbsp;
        <span style={{ color: '#ff2222' }}>■</span> ACT/LCH
      </div>
      <div style={{ ...styles.legend, color: '#1a3a1a', marginTop: 1 }}>
        IR = RWR SILENT · ARH ACTIVE = spike
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    background: '#060a06',
    border: '1px solid #1a3a1a',
    padding: '6px 8px',
    fontFamily: 'Share Tech Mono, monospace',
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
    color: '#44aa44',
    letterSpacing: 2,
    borderBottom: '1px solid #1a3a1a',
    paddingBottom: 1,
  },
  statusBar: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    borderTop: '1px solid #1a3a1a',
    paddingTop: 4,
  },
  statusItem: {
    fontSize: 9,
    letterSpacing: 1,
  },
  legend: {
    fontSize: 7,
    color: '#334433',
    letterSpacing: 0.5,
  },
};
