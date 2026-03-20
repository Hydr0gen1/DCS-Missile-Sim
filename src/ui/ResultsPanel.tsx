import { useSimStore } from '../store/simStore';
import { M_TO_NM } from '../physics/atmosphere';
import { T } from './theme';

const G = 9.80665;

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

          {/* Intercept geometry */}
          <Row label="T+" value={`${frame.time.toFixed(1)} s`} />
          <Row label="RANGE" value={`${(frame.range * M_TO_NM).toFixed(1)} nm`} />
          <Row label="CLOSURE" value={`${(frame.closingVelocity * 1.94384).toFixed(0)} kt`} />
          <Row label="TTI" value={frame.timeToImpact < 9999 ? `${frame.timeToImpact.toFixed(1)} s` : '—'} />

          {/* Missile status */}
          <div style={styles.divider} />
          <Row label="MSL SPD" value={`${(frame.missile.speedMs * 1.94384).toFixed(0)} kt`} />
          <Row label="MSL ALT" value={`${Math.round(frame.missile.altFt).toLocaleString()} ft`} />
          {frame.missile.gLoad !== undefined && (
            <Row label="MSL G" value={
              <span style={{ color: gColor(frame.missile.gLoad) }}>
                {frame.missile.gLoad.toFixed(1)}G
              </span>
            } />
          )}
          <Row label="MSL NRG" value={
            <span style={{ color: energyColor(frame.energyFraction) }}>
              {(frame.energyFraction * 100).toFixed(0)}%
            </span>
          } />
          <Row label="SEEKER" value={frame.missile.active ? <span style={{ color: T.success }}>ACTIVE</span> : 'SILENT'} />
          <Row label="MOTOR" value={frame.missile.motorBurning ? <span style={{ color: T.warning }}>BURNING</span> : 'COAST'} />

          {/* Target status */}
          <div style={styles.divider} />
          <Row label="TGT SPD" value={`${(frame.target.speedMs * 1.94384).toFixed(0)} kt`} />
          {frame.target.currentG > 1.05 && (
            <Row label="TGT G" value={`${frame.target.currentG.toFixed(1)}G`} />
          )}

          {/* Datalink */}
          {frame.datalinkActive !== undefined && (
            <>
              <div style={styles.divider} />
              <Row label="DLINK" value={
                frame.datalinkActive
                  ? <span style={{ color: T.success }}>UP</span>
                  : <span style={{ color: T.danger }}>LOST</span>
              } />
            </>
          )}
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
          <Row label="TERM SPD" value={`M${simResult.terminalSpeedMach.toFixed(2)}`} />
          <Row label="MAX SPD" value={`M${simResult.maxSpeedMach.toFixed(2)}`} />
          <Row label="MAX G" value={`${simResult.maxGLoad.toFixed(1)}G`} />
          <Row label="DIST" value={`${simResult.distanceTraveledNm.toFixed(1)} nm`} />
          {!simResult.hit && (
            <Row label="MISS DIST" value={`${simResult.missDistance.toFixed(0)} m`} />
          )}
          <Row label="F-POLE" value={`${simResult.fPoleNm.toFixed(1)} nm`} />
        </div>
      )}

      {simStatus === 'idle' && !simResult && (
        <div style={styles.idle}>Configure scenario and press LAUNCH to run engagement.</div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
      <span style={{ color: T.textDim, fontSize: 10 }}>{label}</span>
      <span style={{ color: T.text, fontSize: 10, fontFamily: T.fontMono }}>{value}</span>
    </div>
  );
}

function pkColor(pk: number): string {
  if (pk >= 0.8) return T.success;
  if (pk >= 0.5) return T.warning;
  return T.danger;
}

function verdictColor(pk: number): string {
  if (pk >= 0.8) return T.success;
  if (pk >= 0.5) return T.warning;
  return T.danger;
}

function energyColor(e: number): string {
  if (e > 0.6) return T.success;
  if (e > 0.3) return T.warning;
  return T.danger;
}

function gColor(g: number): string {
  if (g < 10) return T.text;
  if (g < 20) return T.warning;
  return T.danger;
}

// Keep G in scope for future use (suppresses unused warning)
void G;

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 200,
    padding: '10px 12px',
    background: T.bgSurface,
    borderLeft: `1px solid ${T.border}`,
    fontFamily: T.fontUI,
    fontSize: 11,
    color: T.text,
    height: '100%',
    overflowY: 'auto',
    boxSizing: 'border-box',
  },
  title: {
    color: T.accentBright,
    fontSize: 11,
    letterSpacing: 1.5,
    marginBottom: 8,
    fontWeight: '600',
    textTransform: 'uppercase' as const,
  },
  section: {
    marginBottom: 12,
    paddingBottom: 8,
    borderBottom: `1px solid ${T.borderDim}`,
  },
  sectionTitle: {
    color: T.textDim,
    fontSize: 9,
    letterSpacing: 1.5,
    marginBottom: 5,
    fontWeight: '600',
    textTransform: 'uppercase' as const,
  },
  verdict: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    letterSpacing: 0.5,
    fontFamily: T.fontMono,
  },
  error: {
    color: T.danger,
    fontSize: 10,
    lineHeight: 1.5,
    background: '#2a1010',
    padding: 6,
    border: `1px solid ${T.dangerDim}`,
    borderRadius: 3,
  },
  idle: {
    color: T.textDim,
    fontSize: 10,
    lineHeight: 1.6,
    marginTop: 10,
  },
  divider: {
    height: 1,
    background: T.borderDim,
    margin: '4px 0',
  },
};
