import { useMemo } from 'react';
import { useSimStore } from '../store/simStore';
import { runSimulation } from '../physics/engagement';
import { getMissingFields } from '../physics/missile';
import type { ScenarioConfig } from '../physics/engagement';
import { NM_TO_M, M_TO_NM } from '../physics/atmosphere';

const CANVAS_W = 680;
const CANVAS_H = 420;

interface EnvelopePoint {
  aspectDeg: number;
  rMaxNm: number;
  nezNm: number;
  rMinNm: number;
}

function computeEnvelope(
  cfg: Omit<ScenarioConfig, 'aspectAngleDeg' | 'rangeNm'>,
  aspects: number[],
  testRangeNm: number,
): EnvelopePoint[] {
  return aspects.map((aspectDeg) => {
    try {
      const result = runSimulation({ ...cfg, aspectAngleDeg: aspectDeg, rangeNm: testRangeNm });
      return {
        aspectDeg,
        rMaxNm: result.maxRangeM * M_TO_NM,
        nezNm: result.nezM * M_TO_NM,
        rMinNm: result.minRangeM * M_TO_NM,
      };
    } catch {
      return { aspectDeg, rMaxNm: 0, nezNm: 0, rMinNm: 0 };
    }
  });
}

export default function EnvelopePlot() {
  const {
    missiles, aircraft,
    shooterAircraftId, shooterAlt, shooterSpeed, shooterHeading,
    targetAircraftId, targetAlt, targetSpeed, targetHeading,
    selectedMissileId,
  } = useSimStore();

  const missile = missiles.find((m) => m.id === selectedMissileId);
  const missing = missile ? getMissingFields(missile) : ['(no missile selected)'];
  const canPlot = missing.length === 0 && missile !== undefined;

  const aspects = useMemo(() => Array.from({ length: 19 }, (_, i) => i * 10), []);

  const envelope = useMemo(() => {
    if (!canPlot || !missile) return null;
    const cfg: Omit<ScenarioConfig, 'aspectAngleDeg' | 'rangeNm'> = {
      shooterType: shooterAircraftId,
      shooterAlt,
      shooterSpeed,
      shooterHeading,
      targetType: aircraft[targetAircraftId]?.id ?? 'generic',
      targetAlt,
      targetSpeed,
      targetHeading,
      targetManeuver: 'none',
      targetChaffCount: 0,
      targetFlareCount: 0,
      targetWaypoints: [],
      missile,
    };
    return computeEnvelope(cfg, aspects, 60);
  }, [canPlot, missile, shooterAircraftId, shooterAlt, shooterSpeed, shooterHeading, targetAircraftId, targetAlt, targetSpeed, targetHeading, aircraft, aspects]);

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

  return (
    <div style={styles.container}>
      <div style={styles.header}>LAUNCH ENVELOPE — {missile?.name ?? 'No missile'}</div>

      {!canPlot && (
        <div style={styles.noData}>
          {missile ? `Missing data: ${missing.join(', ')}` : 'Select a missile with complete data to plot envelope.'}
        </div>
      )}

      <svg width={CANVAS_W} height={CANVAS_H} style={{ display: 'block', background: '#080c10' }}>
        {/* Grid */}
        {Array.from({ length: 6 }, (_, i) => {
          const r = (i / 5) * maxR;
          const [, y] = toXY(0, r);
          return (
            <g key={i}>
              <line x1={PAD_L} y1={y} x2={PAD_L + plotW} y2={y} stroke="#1a2a1a" strokeWidth={0.5} />
              <text x={PAD_L - 5} y={y + 3} textAnchor="end" fill="#2a4a2a" fontSize={9} fontFamily="Share Tech Mono, monospace">
                {r.toFixed(0)}
              </text>
            </g>
          );
        })}
        {aspects.map((a) => {
          const [x] = toXY(a, 0);
          return (
            <g key={a}>
              <line x1={x} y1={PAD_T} x2={x} y2={PAD_T + plotH} stroke="#1a2a1a" strokeWidth={0.5} />
              {a % 30 === 0 && (
                <text x={x} y={PAD_T + plotH + 15} textAnchor="middle" fill="#2a4a2a" fontSize={9} fontFamily="Share Tech Mono, monospace">
                  {a === 0 ? 'HOT' : a === 90 ? 'BEAM' : a === 180 ? 'COLD' : `${a}°`}
                </text>
              )}
            </g>
          );
        })}

        {/* Axis labels */}
        <text x={PAD_L + plotW / 2} y={CANVAS_H - 4} textAnchor="middle" fill="#556655" fontSize={10} fontFamily="Share Tech Mono, monospace">
          TARGET ASPECT ANGLE (°)
        </text>
        <text
          x={12}
          y={PAD_T + plotH / 2}
          textAnchor="middle"
          fill="#556655"
          fontSize={10}
          fontFamily="Share Tech Mono, monospace"
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
              fill="rgba(0,200,80,0.08)"
              stroke="none"
            />
            {/* NEZ fill */}
            <polygon
              points={[
                ...envelope.map((p) => toXY(p.aspectDeg, p.nezNm)),
                ...envelope.slice().reverse().map((p) => toXY(p.aspectDeg, p.rMinNm)),
              ].map(([x, y]) => `${x},${y}`).join(' ')}
              fill="rgba(255,140,0,0.12)"
              stroke="none"
            />

            {/* Rmax line */}
            <polyline
              points={envelope.map((p) => toXY(p.aspectDeg, p.rMaxNm)).map(([x, y]) => `${x},${y}`).join(' ')}
              fill="none"
              stroke="#00ff80"
              strokeWidth={2}
            />
            {/* NEZ line */}
            <polyline
              points={envelope.map((p) => toXY(p.aspectDeg, p.nezNm)).map(([x, y]) => `${x},${y}`).join(' ')}
              fill="none"
              stroke="#ffaa00"
              strokeWidth={1.5}
              strokeDasharray="6,3"
            />
            {/* Rmin line */}
            <polyline
              points={envelope.map((p) => toXY(p.aspectDeg, p.rMinNm)).map(([x, y]) => `${x},${y}`).join(' ')}
              fill="none"
              stroke="#ff4444"
              strokeWidth={1.5}
            />
          </>
        )}

        {/* Legend */}
        <g transform={`translate(${PAD_L + plotW - 120}, ${PAD_T + 10})`}>
          <rect x={0} y={0} width={115} height={58} fill="#080c10" stroke="#1a3a1a" />
          <line x1={8} y1={14} x2={26} y2={14} stroke="#00ff80" strokeWidth={2} />
          <text x={30} y={17} fill="#88aa88" fontSize={9} fontFamily="Share Tech Mono, monospace">Rmax</text>
          <line x1={8} y1={29} x2={26} y2={29} stroke="#ffaa00" strokeWidth={1.5} strokeDasharray="4,2" />
          <text x={30} y={32} fill="#88aa88" fontSize={9} fontFamily="Share Tech Mono, monospace">NEZ</text>
          <line x1={8} y1={44} x2={26} y2={44} stroke="#ff4444" strokeWidth={1.5} />
          <text x={30} y={47} fill="#88aa88" fontSize={9} fontFamily="Share Tech Mono, monospace">Rmin</text>
        </g>
      </svg>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '12px 16px',
    background: '#080c08',
    height: '100%',
    overflowY: 'auto',
    boxSizing: 'border-box',
    fontFamily: 'Share Tech Mono, monospace',
  },
  header: {
    color: '#00ff80',
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
};
