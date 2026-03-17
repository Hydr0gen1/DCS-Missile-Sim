import { useSimStore } from '../store/simStore';
import type { ShooterRole } from '../store/simStore';
import type { ManeuverType } from '../physics/aircraft';
import { getMissingFields } from '../physics/missile';

const label = (text: string, tip: string) => (
  <label title={tip} style={styles.label}>{text}</label>
);

export default function SetupPanel() {
  const store = useSimStore();
  const {
    aircraft, missiles,
    shooterRole, setShooterRole,
    shooterAircraftId, shooterAlt, shooterSpeed, shooterHeading,
    targetAircraftId, targetAlt, targetSpeed, targetHeading,
    targetManeuver, targetChaffCount, targetFlareCount,
    rangeNm, aspectAngleDeg, selectedMissileId,
    setScenario,
  } = store;

  const selectedMissile = missiles.find((m) => m.id === selectedMissileId);
  const missing = selectedMissile ? getMissingFields(selectedMissile) : [];
  const canSim = missing.length === 0;

  return (
    <div style={styles.panel}>
      <div style={styles.section}>
        <div style={styles.sectionTitle}>SHOOTER</div>
        {/* Role toggle */}
        <div style={{ display: 'flex', gap: 3, marginBottom: 6 }}>
          {(['aircraft', 'ground'] as ShooterRole[]).map((role) => (
            <button
              key={role}
              style={{
                ...styles.roleBtn,
                ...(shooterRole === role ? styles.roleBtnActive : {}),
              }}
              onClick={() => setShooterRole(role)}
            >
              {role === 'aircraft' ? 'AIRCRAFT' : 'GROUND'}
            </button>
          ))}
        </div>

        {shooterRole === 'aircraft' && (
          <>
            {label('Aircraft', 'Shooter aircraft type')}
            <select
              style={styles.select}
              value={shooterAircraftId}
              onChange={(e) => setScenario({ shooterAircraftId: e.target.value })}
            >
              {aircraft.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </>
        )}

        {shooterRole === 'ground'
          ? label(`Site Alt: ${shooterAlt.toLocaleString()} ft`, 'SAM site elevation in feet')
          : label(`Altitude: ${shooterAlt.toLocaleString()} ft`, 'Shooter altitude in feet AGL')
        }
        <input
          type="range"
          min={0}
          max={shooterRole === 'ground' ? 2000 : 60000}
          step={shooterRole === 'ground' ? 100 : 500}
          value={shooterAlt}
          onChange={(e) => setScenario({ shooterAlt: +e.target.value })}
          style={styles.slider}
        />

        {shooterRole === 'aircraft' && (
          <>
            {label(`Speed: ${shooterSpeed} kts`, 'Shooter true airspeed in knots')}
            <input type="range" min={100} max={1200} step={10} value={shooterSpeed}
              onChange={(e) => setScenario({ shooterSpeed: +e.target.value })}
              style={styles.slider} />

            {label(`Heading: ${shooterHeading}°`, 'Shooter heading in degrees')}
            <input type="range" min={0} max={359} step={1} value={shooterHeading}
              onChange={(e) => setScenario({ shooterHeading: +e.target.value })}
              style={styles.slider} />
          </>
        )}
        {shooterRole === 'ground' && (
          <div style={{ color: '#446644', fontSize: 9, marginTop: 3 }}>
            Speed: 0 kts — Heading: auto-aimed
          </div>
        )}
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>TARGET</div>
        {label('Aircraft', 'Target aircraft type')}
        <select
          style={styles.select}
          value={aircraft[targetAircraftId]?.id ?? 'generic'}
          onChange={(e) => setScenario({ targetAircraftId: aircraft.findIndex((a) => a.id === e.target.value) })}
        >
          {aircraft.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>

        {label(`Altitude: ${targetAlt.toLocaleString()} ft`, 'Target altitude in feet AGL')}
        <input type="range" min={0} max={60000} step={500} value={targetAlt}
          onChange={(e) => setScenario({ targetAlt: +e.target.value })}
          style={styles.slider} />

        {label(`Speed: ${targetSpeed} kts`, 'Target true airspeed in knots')}
        <input type="range" min={100} max={1200} step={10} value={targetSpeed}
          onChange={(e) => setScenario({ targetSpeed: +e.target.value })}
          style={styles.slider} />

        {label(`Heading: ${targetHeading}°`, 'Target heading in degrees')}
        <input type="range" min={0} max={359} step={1} value={targetHeading}
          onChange={(e) => setScenario({ targetHeading: +e.target.value })}
          style={styles.slider} />

        {label('Defensive Maneuver', 'Target defensive response after missile goes active')}
        <select
          style={styles.select}
          value={targetManeuver}
          onChange={(e) => setScenario({ targetManeuver: e.target.value as ManeuverType })}
        >
          <option value="none">None — Straight & Level</option>
          <option value="crank">Crank (40–60° off bearing)</option>
          <option value="notch">Notch (Beam + Descend)</option>
          <option value="bunt">Bunt & Drag (Dive + Accel)</option>
          <option value="break">Break Turn (Max-G perp.)</option>
          <option value="custom">Custom Waypoints (click map)</option>
        </select>

        <div style={styles.cmBox}>
          <div style={styles.cmTitle}>COUNTERMEASURES</div>
          {label(
            `Chaff salvos: ${targetChaffCount}`,
            'Chaff bundles dispensed against radar-guided missiles (ARH/SARH). Each salvo is one burst. Effectiveness depends on missile ccm_k0 — lower ccm_k0 = more resistant.',
          )}
          <input type="range" min={0} max={30} step={1} value={targetChaffCount}
            onChange={(e) => setScenario({ targetChaffCount: +e.target.value })}
            style={{ ...styles.slider, accentColor: '#00aaff' }} />
          <div style={styles.cmHint}>→ ARH / SARH missiles only</div>

          {label(
            `Flare salvos: ${targetFlareCount}`,
            'Flares dispensed against IR-guided missiles (AIM-9X, R-73). Effectiveness depends on missile ccm_k0. AIM-9X Block II imaging seeker (ccm_k0=0.1) is nearly flare-immune.',
          )}
          <input type="range" min={0} max={30} step={1} value={targetFlareCount}
            onChange={(e) => setScenario({ targetFlareCount: +e.target.value })}
            style={{ ...styles.slider, accentColor: '#ff8800' }} />
          <div style={styles.cmHint}>→ IR missiles only</div>

          {selectedMissile && (selectedMissile.ccm_k0 !== null && selectedMissile.ccm_k0 !== undefined) && (
            <div style={styles.ccmInfo}>
              {selectedMissile.name} ccm_k0: {selectedMissile.ccm_k0}
              {' '}({ccmLabel(selectedMissile.ccm_k0)})
            </div>
          )}
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>GEOMETRY</div>
        {label(`Range: ${rangeNm} nm`, 'Initial range between shooter and target at launch')}
        <input type="range" min={1} max={80} step={1} value={rangeNm}
          onChange={(e) => setScenario({ rangeNm: +e.target.value })}
          style={styles.slider} />

        {label(`Aspect: ${aspectAngleDeg}° (${aspectLabel(aspectAngleDeg)})`, '0° = target flying toward shooter (hot); 180° = cold')}
        <input type="range" min={0} max={180} step={5} value={aspectAngleDeg}
          onChange={(e) => setScenario({ aspectAngleDeg: +e.target.value })}
          style={styles.slider} />
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>MISSILE</div>
        <select
          style={styles.select}
          value={selectedMissileId}
          onChange={(e) => setScenario({ selectedMissileId: e.target.value })}
        >
          {missiles.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}{m.isSynthetic ? ' [SYNTHETIC]' : ''}{getMissingFields(m).length > 0 ? ' ⚠' : ''}
            </option>
          ))}
        </select>

        {selectedMissile?.isSynthetic && (
          <div style={styles.warningBox}>
            ⚠ SYNTHETIC TEST ROUND — not a real weapon. For development use only.
          </div>
        )}

        {!canSim && missing.length > 0 && (
          <div style={styles.errorBox}>
            Missing data: {missing.join(', ')}
            <br />Use Missile Editor to populate.
          </div>
        )}

        {selectedMissile && (
          <div style={styles.missileInfo}>
            <div>Type: <span style={{ color: typeColor(selectedMissile.type) }}>{selectedMissile.type}</span></div>
            <div>Seeker: {selectedMissile.seeker}</div>
            <div>Max Range: {selectedMissile.maxRange_nm !== null ? `${selectedMissile.maxRange_nm} nm` : '—'}</div>
            <div>Max Speed: {selectedMissile.maxSpeed_mach !== null ? `M${selectedMissile.maxSpeed_mach}` : '—'}</div>
            <div>G-Limit: {selectedMissile.gLimit !== null ? `${selectedMissile.gLimit}G` : '—'}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function aspectLabel(deg: number): string {
  if (deg <= 20) return 'HOT';
  if (deg <= 70) return 'FLANKING';
  if (deg <= 110) return 'BEAM';
  if (deg <= 160) return 'FLANKING';
  return 'COLD';
}

function ccmLabel(k: number): string {
  if (k <= 0.15) return 'CM-resistant';
  if (k <= 0.35) return 'Moderate resistance';
  if (k <= 0.6) return 'Susceptible';
  return 'Highly susceptible';
}

function typeColor(type: string): string {
  if (type === 'ARH') return '#00aaff';
  if (type === 'SARH') return '#ffaa00';
  return '#ff6688';
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 220,
    overflowY: 'auto',
    padding: '8px 10px',
    background: '#0a0e0a',
    borderRight: '1px solid #1a3a1a',
    fontFamily: 'Share Tech Mono, monospace',
    fontSize: 11,
    color: '#aaccaa',
    height: '100%',
    boxSizing: 'border-box',
  },
  section: {
    marginBottom: 14,
    paddingBottom: 10,
    borderBottom: '1px solid #1a2a1a',
  },
  sectionTitle: {
    color: '#00ff80',
    fontSize: 12,
    letterSpacing: 2,
    marginBottom: 6,
    fontWeight: 'bold',
  },
  label: {
    display: 'block',
    color: '#88aa88',
    fontSize: 10,
    marginTop: 5,
    cursor: 'default',
  },
  slider: {
    width: '100%',
    accentColor: '#00aa44',
    margin: '2px 0',
  },
  select: {
    width: '100%',
    background: '#0d1a0d',
    border: '1px solid #2a4a2a',
    color: '#aaccaa',
    fontFamily: 'Share Tech Mono, monospace',
    fontSize: 11,
    padding: '3px 4px',
    marginTop: 3,
  },
  roleBtn: {
    flex: 1,
    background: 'transparent',
    border: '1px solid #1a3a1a',
    color: '#557755',
    fontFamily: 'Share Tech Mono, monospace',
    fontSize: 9,
    padding: '3px 4px',
    cursor: 'pointer',
    letterSpacing: 1,
  },
  roleBtnActive: {
    background: '#0d1a0d',
    borderColor: '#00aa44',
    color: '#00ff80',
  },
  warningBox: {
    background: '#2a1a00',
    border: '1px solid #aa6600',
    color: '#ffaa44',
    padding: '4px 6px',
    fontSize: 9,
    marginTop: 5,
    lineHeight: 1.4,
  },
  errorBox: {
    background: '#1a0000',
    border: '1px solid #aa2222',
    color: '#ff6666',
    padding: '4px 6px',
    fontSize: 9,
    marginTop: 5,
    lineHeight: 1.4,
  },
  missileInfo: {
    marginTop: 6,
    fontSize: 10,
    color: '#88aa88',
    lineHeight: 1.6,
    borderLeft: '2px solid #1a3a1a',
    paddingLeft: 6,
  },
  cmBox: {
    marginTop: 8,
    padding: '6px 8px',
    border: '1px solid #1a2a1a',
    background: '#060e06',
  },
  cmTitle: {
    color: '#557755',
    fontSize: 9,
    letterSpacing: 2,
    marginBottom: 4,
  },
  cmHint: {
    color: '#446644',
    fontSize: 9,
    marginBottom: 4,
    marginLeft: 2,
  },
  ccmInfo: {
    marginTop: 4,
    color: '#888866',
    fontSize: 9,
    borderTop: '1px solid #1a2a1a',
    paddingTop: 4,
  },
};
