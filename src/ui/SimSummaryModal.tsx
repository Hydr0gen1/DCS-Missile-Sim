/**
 * SimSummaryModal — Post-engagement summary popup.
 * Auto-opens when a simulation completes. Dismissable, re-openable via RESULTS button.
 */
import { useSimStore } from '../store/simStore';

interface Props {
  onClose: () => void;
}

export default function SimSummaryModal({ onClose }: Props) {
  const { simResult } = useSimStore();
  if (!simResult) return null;

  const r = simResult;

  const verdictIsKill = r.pk >= 0.85 && r.hit;
  const verdictIsProbable = r.pk >= 0.65 && r.hit;
  const verdictIsMarginal = r.pk >= 0.35 && r.hit;
  const verdictColor = r.verdict?.startsWith('Decoyed')
    ? '#ff8800'
    : r.verdict?.startsWith('No launch')
    ? '#888888'
    : verdictIsKill
    ? '#00ff80'
    : verdictIsProbable
    ? '#88ff44'
    : verdictIsMarginal
    ? '#ffaa00'
    : '#ff3333';

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.headerTitle}>ENGAGEMENT SUMMARY</span>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Outcome */}
        <div style={styles.section}>
          <div style={{ ...styles.verdictBanner, color: verdictColor, borderColor: verdictColor }}>
            {r.verdict.toUpperCase()}
          </div>
          <div style={styles.row}>
            <span style={styles.label}>Pk</span>
            <span style={{ ...styles.value, color: verdictColor }}>{(r.pk * 100).toFixed(0)}%</span>
          </div>
        </div>

        <div style={styles.divider} />

        {/* Flight performance */}
        <div style={styles.sectionHeader}>FLIGHT PERFORMANCE</div>
        <div style={styles.section}>
          <Row label="Max Speed" value={`Mach ${r.maxSpeedMach.toFixed(2)}`} />
          <Row label="Max G-Load" value={`${r.maxGLoad.toFixed(1)} G`} />
          <Row label="Distance Traveled" value={`${r.distanceTraveledNm.toFixed(1)} nm`} />
          <Row label="Time of Flight" value={`${r.timeOfFlight.toFixed(1)} s`} />
          <Row label="Terminal Speed" value={`Mach ${r.terminalSpeedMach.toFixed(2)}`} />
        </div>

        <div style={styles.divider} />

        {/* Geometry */}
        <div style={styles.sectionHeader}>GEOMETRY</div>
        <div style={styles.section}>
          <Row label="A-Pole" value={`${r.aPoleNm.toFixed(1)} nm`} />
          <Row label="F-Pole" value={`${r.fPoleNm.toFixed(1)} nm`} />
          {!r.hit && (
            <Row label="Miss Distance" value={`${r.missDistance.toFixed(0)} m`} dim />
          )}
        </div>

        {/* Exit speeds */}
        <div style={styles.divider} />
        <div style={styles.sectionHeader}>EXIT CONDITIONS</div>
        <div style={styles.section}>
          <Row label="A-Pole" value={`${r.aPoleNm.toFixed(1)} nm`} dim />
          <Row label="Target Exit Speed" value={`${r.targetExitSpeedKts.toFixed(0)} kts`} />
          <Row label="Shooter Exit Speed" value={`${r.shooterExitSpeedKts.toFixed(0)} kts`} />
        </div>

        {/* Countermeasures — only show if any were used */}
        {(r.chaffSalvosUsed > 0 || r.flareSalvosUsed > 0) && (
          <>
            <div style={styles.divider} />
            <div style={styles.sectionHeader}>COUNTERMEASURES</div>
            <div style={styles.section}>
              {r.flareSalvosUsed > 0 && (
                <Row label="Flares Used" value={`${r.flareSalvosUsed} salvo${r.flareSalvosUsed !== 1 ? 's' : ''}`} />
              )}
              {r.chaffSalvosUsed > 0 && (
                <Row label="Chaff Used" value={`${r.chaffSalvosUsed} salvo${r.chaffSalvosUsed !== 1 ? 's' : ''}`} />
              )}
              {r.seductionEvents.filter(e => e.type === 'flare_seduced' || e.type === 'chaff_seduced').length > 0 && (
                <Row
                  label="Seduction Events"
                  value={`${r.seductionEvents.filter(e => e.type === 'flare_seduced' || e.type === 'chaff_seduced').length}`}
                  dim
                />
              )}
            </div>
          </>
        )}

        {/* Detection timeline — only show if there are events beyond launch */}
        {r.detectionTimeline.length > 1 && (
          <>
            <div style={styles.divider} />
            <div style={styles.sectionHeader}>DETECTION TIMELINE</div>
            <div style={{ ...styles.section, paddingTop: 4 }}>
              {r.detectionTimeline.map((ev, i) => (
                <div key={i} style={styles.timelineRow}>
                  <span style={{ color: timelineColor(ev.type), minWidth: 36, display: 'inline-block' }}>
                    {ev.time.toFixed(1)}s
                  </span>
                  <span style={{ color: '#557755', fontSize: 9, marginLeft: 6 }}>
                    {ev.description}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function timelineColor(type: string): string {
  if (type === 'launch') return '#00cc60';
  if (type === 'search_detected') return '#557755';
  if (type === 'stt_lock') return '#ffaa00';
  if (type === 'missile_active') return '#ff4444';
  if (type === 'datalink_lost') return '#ff4444';
  if (type === 'datalink_restored') return '#00cc44';
  return '#aaccaa';
}

function Row({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div style={styles.row}>
      <span style={styles.label}>{label}</span>
      <span style={{ ...styles.value, color: dim ? '#557755' : '#aaccaa' }}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.78)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#070d07',
    border: '1px solid #1a4a1a',
    fontFamily: 'Share Tech Mono, monospace',
    color: '#aaccaa',
    minWidth: 300,
    maxWidth: 380,
    width: '100%',
    boxShadow: '0 0 40px rgba(0,180,60,0.12)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid #1a4a1a',
    background: '#080f08',
  },
  headerTitle: {
    fontSize: 11,
    letterSpacing: 2,
    color: '#00cc60',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: '#557755',
    fontFamily: 'Share Tech Mono, monospace',
    fontSize: 13,
    cursor: 'pointer',
    padding: '0 2px',
    lineHeight: 1,
  },
  verdictBanner: {
    fontSize: 15,
    letterSpacing: 3,
    textAlign: 'center',
    padding: '8px 0',
    border: '1px solid',
    marginBottom: 8,
  },
  section: {
    padding: '6px 12px',
  },
  sectionHeader: {
    fontSize: 9,
    letterSpacing: 2,
    color: '#335533',
    padding: '4px 12px 2px',
    borderBottom: '1px solid #0f2a0f',
  },
  divider: {
    height: 1,
    background: '#0f2a0f',
    margin: '2px 0',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '3px 0',
    fontSize: 11,
  },
  label: {
    color: '#557755',
    letterSpacing: 0.5,
  },
  value: {
    color: '#aaccaa',
    letterSpacing: 1,
  },
  timelineRow: {
    display: 'flex',
    alignItems: 'baseline',
    marginBottom: 3,
    fontSize: 10,
  },
};
