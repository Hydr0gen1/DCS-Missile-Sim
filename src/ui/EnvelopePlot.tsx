import { useMemo } from 'react';
import { useSimStore } from '../store/simStore';
import { runSimulation } from '../physics/engagement';
import { getMissingFields } from '../physics/missile';
import type { ScenarioConfig } from '../physics/engagement';
import { M_TO_NM } from '../physics/atmosphere';

const CANVAS_W = 680;
const CANVAS_H = 420;

interface EnvelopePoint {
  aspectDeg: number;
  rMaxNm: number;
  nezNm: number;
  rMinNm: number;
}

/**
 * Binary-search for the maximum range at which the missile achieves a hit.
 * Runs up to `iters` bisections between `loNm` and `hiNm`.
 * Returns the highest range that still hits (or 0 if no hit found).
 */
function findRmax(
  cfg: Omit<ScenarioConfig, 'aspectAngleDeg' | 'rangeNm'>,
  aspectDeg: number,
  iters = 10,
  loNm = 1,
  hiNm = (cfg.missile.maxRange_nm ?? 80) * 1.05,
): number {
  // Quick check: can it hit at any range?
  try {
    const probe = runSimulation({ ...cfg, aspectAngleDeg: aspectDeg, rangeNm: loNm + 0.5 });
    if (!probe.result.hit) return 0;
  } catch { return 0; }

  let bestHitNm = 0;
  for (let i = 0; i < iters; i++) {
    const mid = (loNm + hiNm) / 2;
    try {
      const res = runSimulation({ ...cfg, aspectAngleDeg: aspectDeg, rangeNm: mid });
      if (res.result.hit) {
        bestHitNm = mid;
        loNm = mid;
      } else {
        hiNm = mid;
      }
    } catch {
      hiNm = mid;
    }
  }
  return bestHitNm;
}

/**
 * Compute the full aspect-dependent engagement envelope.
 * Rmax  = max range with no maneuver
 * NEZ   = max range where break-turn still results in a kill
 * Rmin  = min range (missile needs time to arm + guide; ~5% of Rmax kinematically)
 */
function computeEnvelope(
  cfg: Omit<ScenarioConfig, 'aspectAngleDeg' | 'rangeNm'>,
  aspects: number[],
): EnvelopePoint[] {
  return aspects.map((aspectDeg) => {
    const rMaxNm  = findRmax({ ...cfg, targetManeuver: 'none'  }, aspectDeg, 10);
    // NEZ: missile can still hit even with max-g break turn
    const nezNm   = rMaxNm > 0
      ? findRmax({ ...cfg, targetManeuver: 'break' }, aspectDeg, 9, 1, rMaxNm)
      : 0;
    // Rmin: kinematic minimum — missile needs ~5% of Rmax to arm & guide
    const rMinNm  = rMaxNm > 0 ? Math.max(0.3, rMaxNm * 0.05) : 0;

    return { aspectDeg, rMaxNm, nezNm, rMinNm };
  });
}

export default function EnvelopePlot() {
  const {
    missiles, aircraft,
    shooterRole,
    shooterAircraftId, shooterAlt, shooterSpeed, shooterHeading,
    targetAircraftId, targetAlt, targetSpeed, targetHeading,
    targetHasMaws,
    selectedMissileId,
  } = useSimStore();

  const missile = missiles.find((m) => m.id === selectedMissileId);
  const missing = missile ? getMissingFields(missile) : ['(no missile selected)'];
  const canPlot = missing.length === 0 && missile !== undefined;

  const aspects = useMemo(() => Array.from({ length: 19 }, (_, i) => i * 10), []);

  const envelope = useMemo(() => {
    if (!canPlot || !missile) return null;
    const cfg: Omit<ScenarioConfig, 'aspectAngleDeg' | 'rangeNm'> = {
      shooterRole,
      shooterType: shooterAircraftId,
      shooterAlt,
      shooterSpeed: shooterRole === 'ground' ? 0 : shooterSpeed,
      shooterHeading,
      targetType: aircraft[targetAircraftId]?.id ?? 'generic',
      targetAlt,
      targetSpeed,
      targetHeading,
      targetManeuver: 'none', // overridden per-call in computeEnvelope
      targetChaffCount: 0,
      targetFlareCount: 0,
      targetWaypoints: [],
      targetHasMaws,
      missile,
    };
    return computeEnvelope(cfg, aspects);
  }, [
    canPlot, missile, shooterRole, shooterAircraftId, shooterAlt, shooterSpeed,
    shooterHeading, targetAircraftId, targetAlt, targetSpeed, targetHeading,
    targetHasMaws, aircraft, aspects,
  ]);

  const maxR = envelope ? Math.max(...envelope.map((p) => p.rMaxNm), 5) : 50;

  const PAD_L = 50;
  const PAD_B = 40;
  const PAD_T = 20;
  const PAD_R = 20;
  const plotW = CANVAS_W - PAD_L - PAD_R;
  const plotH = CANVAS_H - PAD_T - PAD_B;

  function toXY(aspectDeg: number, rangeNm: number): [number, number] {
    const x = PAD_L + (aspectDeg / 180) * plotW;
    const y = PAD_T + plotH - (rangeNm / maxR) * plotH;
    return [x, y];
  }

  // Peak Rmax for annotation
  const peakRmax = envelope ? Math.max(...envelope.map((p) => p.rMaxNm)) : 0;
  const hotRmax  = envelope?.[0]?.rMaxNm ?? 0;
  const coldRmax = envelope?.[18]?.rMaxNm ?? 0;

  return (
    <div style={styles.container}>
      <div style={styles.header}>LAUNCH ENVELOPE — {missile?.name ?? 'No missile'}</div>

      {!canPlot && (
        <div style={styles.noData}>
          {missile ? `Missing data: ${missing.join(', ')}` : 'Select a missile with complete data to plot envelope.'}
        </div>
      )}

      {canPlot && !envelope && (
        <div style={styles.computing}>Computing envelope… (runs ~400 simulations)</div>
      )}

      <svg width={CANVAS_W} height={CANVAS_H} style={{ display: 'block', background: '#0d1117' }}>
        {/* Grid */}
        {Array.from({ length: 7 }, (_, i) => {
          const r = (i / 6) * maxR;
          const [, y] = toXY(0, r);
          return (
            <g key={i}>
              <line x1={PAD_L} y1={y} x2={PAD_L + plotW} y2={y} stroke="#1e2d1e" strokeWidth={0.5} />
              <text x={PAD_L - 5} y={y + 3} textAnchor="end" fill="#3a5a3a" fontSize={9} fontFamily="Share Tech Mono, monospace">
                {r.toFixed(0)}
              </text>
            </g>
          );
        })}
        {aspects.map((a) => {
          const [x] = toXY(a, 0);
          return (
            <g key={a}>
              <line x1={x} y1={PAD_T} x2={x} y2={PAD_T + plotH} stroke="#1e2d1e" strokeWidth={0.5} />
              {a % 30 === 0 && (
                <text x={x} y={PAD_T + plotH + 15} textAnchor="middle" fill="#3a5a3a" fontSize={9} fontFamily="Share Tech Mono, monospace">
                  {a === 0 ? 'HOT' : a === 90 ? 'BEAM' : a === 180 ? 'COLD' : `${a}°`}
                </text>
              )}
            </g>
          );
        })}

        {/* Axis labels */}
        <text x={PAD_L + plotW / 2} y={CANVAS_H - 4} textAnchor="middle" fill="#6a8a6a" fontSize={10} fontFamily="Share Tech Mono, monospace">
          TARGET ASPECT ANGLE (°)
        </text>
        <text
          x={12} y={PAD_T + plotH / 2}
          textAnchor="middle" fill="#6a8a6a" fontSize={10} fontFamily="Share Tech Mono, monospace"
          transform={`rotate(-90, 12, ${PAD_T + plotH / 2})`}
        >
          RANGE (nm)
        </text>

        {envelope && (
          <>
            {/* Rmax fill */}
            <polygon
              points={[
                ...envelope.map((p) => toXY(p.aspectDeg, p.rMaxNm)),
                ...envelope.slice().reverse().map((p) => toXY(p.aspectDeg, 0)),
              ].map(([x, y]) => `${x},${y}`).join(' ')}
              fill="rgba(0,200,80,0.07)"
            />
            {/* NEZ fill */}
            <polygon
              points={[
                ...envelope.map((p) => toXY(p.aspectDeg, p.nezNm)),
                ...envelope.slice().reverse().map((p) => toXY(p.aspectDeg, p.rMinNm)),
              ].map(([x, y]) => `${x},${y}`).join(' ')}
              fill="rgba(255,140,0,0.10)"
            />

            {/* Rmax line */}
            <polyline
              points={envelope.map((p) => toXY(p.aspectDeg, p.rMaxNm)).map(([x, y]) => `${x},${y}`).join(' ')}
              fill="none" stroke="#00e870" strokeWidth={2}
            />
            {/* NEZ line */}
            <polyline
              points={envelope.map((p) => toXY(p.aspectDeg, p.nezNm)).map(([x, y]) => `${x},${y}`).join(' ')}
              fill="none" stroke="#ffaa00" strokeWidth={1.5} strokeDasharray="6,3"
            />
            {/* Rmin line */}
            <polyline
              points={envelope.map((p) => toXY(p.aspectDeg, p.rMinNm)).map(([x, y]) => `${x},${y}`).join(' ')}
              fill="none" stroke="#ff4444" strokeWidth={1.5}
            />

            {/* Annotations */}
            {hotRmax > 0 && (() => {
              const [x, y] = toXY(0, hotRmax);
              return <text x={x + 5} y={y - 4} fill="#00e870" fontSize={9} fontFamily="Share Tech Mono, monospace">HOT {hotRmax.toFixed(1)}nm</text>;
            })()}
            {coldRmax > 0 && (() => {
              const [x, y] = toXY(180, coldRmax);
              return <text x={x - 5} y={y - 4} fill="#00e870" fontSize={9} fontFamily="Share Tech Mono, monospace" textAnchor="end">COLD {coldRmax.toFixed(1)}nm</text>;
            })()}
          </>
        )}

        {/* Legend */}
        <g transform={`translate(${PAD_L + plotW - 130}, ${PAD_T + 10})`}>
          <rect x={0} y={0} width={125} height={58} fill="#0d1117" stroke="#1e3a1e" />
          <line x1={8} y1={14} x2={26} y2={14} stroke="#00e870" strokeWidth={2} />
          <text x={30} y={17} fill="#8aaa8a" fontSize={9} fontFamily="Share Tech Mono, monospace">Rmax (no manuv)</text>
          <line x1={8} y1={29} x2={26} y2={29} stroke="#ffaa00" strokeWidth={1.5} strokeDasharray="4,2" />
          <text x={30} y={32} fill="#8aaa8a" fontSize={9} fontFamily="Share Tech Mono, monospace">NEZ (break turn)</text>
          <line x1={8} y1={44} x2={26} y2={44} stroke="#ff4444" strokeWidth={1.5} />
          <text x={30} y={47} fill="#8aaa8a" fontSize={9} fontFamily="Share Tech Mono, monospace">Rmin</text>
        </g>

        {/* Stats callout */}
        {envelope && peakRmax > 0 && (
          <g transform={`translate(${PAD_L + 8}, ${PAD_T + 10})`}>
            <text fill="#4a6a4a" fontSize={9} fontFamily="Share Tech Mono, monospace">
              PEAK Rmax {peakRmax.toFixed(1)}nm
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '12px 16px',
    background: '#0d1117',
    height: '100%',
    overflowY: 'auto',
    boxSizing: 'border-box',
    fontFamily: 'Share Tech Mono, monospace',
  },
  header: {
    color: '#00e870',
    fontSize: 14,
    letterSpacing: 2,
    marginBottom: 10,
    fontWeight: 'bold',
  },
  noData: {
    color: '#ff6655',
    fontSize: 11,
    background: '#1a0000',
    border: '1px solid #aa2222',
    padding: '8px 10px',
    marginBottom: 10,
  },
  computing: {
    color: '#ffaa00',
    fontSize: 11,
    marginBottom: 8,
    letterSpacing: 1,
  },
};
