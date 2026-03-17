import { useSimStore } from '../store/simStore';
import { M_TO_NM } from '../physics/atmosphere';
import type { CMEvent } from '../physics/engagement';

export default function ResultsPanel() {
  const { simResult, simError, simStatus, simFrames, currentFrameIdx } = useSimStore();

  const frame = simFrames[currentFrameIdx];

  if (simError) {
    return (
      <div style={styles.panel}>
        <div style={styles.title}>ENGAGEMENT STATUS</div>
        <div style={styles.error}>{simError}</div>
      </div>
    );
  }

  return (
    <div style={styles.panel}>
      <div style={styles.title}>ENGAGEMENT STATUS</div>

      {/* Live telemetry during playback */}
      {frame && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>LIVE</div>
          <Row label="T+" value={`${frame.time.toFixed(1)} s`} />
          <Row label="MSL SPD" value={`${(frame.missile.speedMs * 1.94384).toFixed(0)} kt`} />
          <Row label="MSL ALT" value={`${Math.round(frame.missile.altFt).toLocaleString()} ft`} />
          <Row label="CLOSURE" value={`${(frame.closingVelocity * 1.94384).toFixed(0)} kt`} />
          <Row label="TTI" value={frame.timeToImpact < 9999 ? `${frame.timeToImpact.toFixed(1)} s` : '—'} />
          <Row label="RANGE" value={`${(frame.range * M_TO_NM).toFixed(1)} nm`} />
          <Row label="ENERGY" value={
            <span style={{ color: energyColor(frame.energyFraction) }}>
              {(frame.energyFraction * 100).toFixed(0)}%
            </span>
          } />
          <Row label="SEEKER" value={frame.missile.active ? <span style={{ color: '#00ff80' }}>ACTIVE</span> : 'SILENT'} />
          <Row label="MOTOR" value={frame.missile.motorBurning ? <span style={{ color: '#ffaa00' }}>BURNING</span> : 'COAST'} />
          {frame.cmEvent && <CMEventBadge event={frame.cmEvent} />}
        </div>
      )}

      {/* Post-engagement results */}
      {simResult && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>RESULT</div>
          <div style={{ ...styles.verdict, color: verdictColor(simResult.pk) }}>
            {simResult.verdict}
          </div>
          <Row label="Pk" value={
            <span style={{ color: pkColor(simResult.pk) }}>
              {(simResult.pk * 100).toFixed(0)}%
            </span>
          } />
          <Row label="TOF" value={`${simResult.timeOfFlight.toFixed(1)} s`} />
          <Row label="TERM SPD" value={`M${(simResult.terminalSpeedMs / 340).toFixed(2)}`} />
          {!simResult.hit && (
            <Row label="MISS DIST" value={`${simResult.missDistance.toFixed(0)} m`} />
          )}
          <Row label="F-POLE" value={`${simResult.fPoleNm.toFixed(1)} nm`} />
          <Row label="A-POLE" value={`${simResult.aPoleNm.toFixed(1)} nm`} />
          {simResult.chaffSalvosUsed > 0 && (
            <Row label="CHAFF" value={<span style={{ color: '#00aaff' }}>{simResult.chaffSalvosUsed} salvos</span>} />
          )}
          {simResult.flareSalvosUsed > 0 && (
            <Row label="FLARES" value={<span style={{ color: '#ff8800' }}>{simResult.flareSalvosUsed} salvos</span>} />
          )}
          {simResult.seductionEvents.length > 0 && (
            <div style={{ marginTop: 4 }}>
              {simResult.seductionEvents.map((ev, i) => (
                <CMEventBadge key={i} event={ev} />
              ))}
            </div>
          )}
        </div>
      )}

      {simStatus === 'idle' && !simResult && (
        <div style={styles.idle}>Configure scenario and press LAUNCH to run engagement.</div>
      )}
    </div>
  );
}

function CMEventBadge({ event }: { event: CMEvent }) {
  const color =
    event.type === 'flare_seduced' ? '#ff8800' :
    event.type === 'chaff_seduced' ? '#00aaff' :
    event.type === 'reacquired' ? '#00ff80' : '#888888';
  const label =
    event.type === 'flare_seduced' ? `FLARE SEDUCED (P=${(event.probability * 100).toFixed(0)}%)` :
    event.type === 'chaff_seduced' ? `CHAFF SEDUCED (P=${(event.probability * 100).toFixed(0)}%)` :
    event.type === 'reacquired' ? 'REACQUIRED' :
    `CM DEFEATED (P=${(event.probability * 100).toFixed(0)}%)`;
  return (
    <div style={{ color, fontSize: 9, fontWeight: 'bold', marginBottom: 2, letterSpacing: 1 }}>
      ▶ {label}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
      <span style={{ color: '#556655', fontSize: 10 }}>{label}</span>
      <span style={{ color: '#aaccaa', fontSize: 10 }}>{value}</span>
    </div>
  );
}

function pkColor(pk: number): string {
  if (pk >= 0.8) return '#00ff80';
  if (pk >= 0.5) return '#ffaa00';
  return '#ff4444';
}

function verdictColor(pk: number): string {
  if (pk >= 0.8) return '#00ff80';
  if (pk >= 0.5) return '#ffaa00';
  return '#ff4444';
}

function energyColor(e: number): string {
  if (e > 0.6) return '#00ff80';
  if (e > 0.3) return '#ffaa00';
  return '#ff3333';
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 190,
    padding: '8px 10px',
    background: '#0a0e0a',
    borderLeft: '1px solid #1a3a1a',
    fontFamily: 'Share Tech Mono, monospace',
    fontSize: 11,
    color: '#aaccaa',
    height: '100%',
    overflowY: 'auto',
    boxSizing: 'border-box',
  },
  title: {
    color: '#00ff80',
    fontSize: 11,
    letterSpacing: 2,
    marginBottom: 8,
    fontWeight: 'bold',
  },
  section: {
    marginBottom: 12,
    paddingBottom: 8,
    borderBottom: '1px solid #1a2a1a',
  },
  sectionTitle: {
    color: '#557755',
    fontSize: 9,
    letterSpacing: 2,
    marginBottom: 5,
  },
  verdict: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 6,
    letterSpacing: 1,
  },
  error: {
    color: '#ff6655',
    fontSize: 10,
    lineHeight: 1.5,
    background: '#1a0000',
    padding: 6,
    border: '1px solid #aa2222',
  },
  idle: {
    color: '#446644',
    fontSize: 10,
    lineHeight: 1.5,
    marginTop: 10,
  },
};
