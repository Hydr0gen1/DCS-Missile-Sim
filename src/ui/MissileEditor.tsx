import { useRef } from 'react';
import { useSimStore } from '../store/simStore';
import type { MissileData } from '../data/types';
import { getMissingFields } from '../physics/missile';

type NullableNumKey = {
  [K in keyof MissileData]: MissileData[K] extends number | null ? K : never;
}[keyof MissileData];

const FIELDS: Array<{ key: NullableNumKey; label: string; unit: string; tip: string }> = [
  { key: 'motorBurnTime_s',         label: 'Motor Burn Time',     unit: 's',   tip: 'Duration of motor burn in seconds' },
  { key: 'thrust_N',                label: 'Thrust',              unit: 'N',   tip: 'Average thrust during burn phase (Newtons)' },
  { key: 'mass_kg',                 label: 'Launch Mass',         unit: 'kg',  tip: 'Total mass at launch including propellant' },
  { key: 'massBurnout_kg',          label: 'Burnout Mass',        unit: 'kg',  tip: 'Mass after motor burnout' },
  { key: 'dragCoefficient',         label: 'Drag Coefficient',    unit: 'Cd',  tip: 'Aerodynamic drag coefficient' },
  { key: 'referenceArea_m2',        label: 'Reference Area',      unit: 'm²',  tip: 'Cross-section reference area for drag calculation' },
  { key: 'maxSpeed_mach',           label: 'Max Speed',           unit: 'M',   tip: 'Maximum achievable Mach number' },
  { key: 'maxRange_nm',             label: 'Max Range',           unit: 'nm',  tip: 'Kinematic max range (hot aspect, co-altitude)' },
  { key: 'gLimit',                  label: 'G Limit',             unit: 'G',   tip: 'Maximum structural G load' },
  { key: 'seekerAcquisitionRange_nm', label: 'Seeker Acq Range',  unit: 'nm',  tip: 'Range at which seeker activates or locks' },
  { key: 'loftAngle_deg',           label: 'Loft Angle',          unit: '°',   tip: 'Pitch-up angle during loft phase (0 = no loft)' },
  { key: 'guidanceNav',             label: 'ProNav Constant (N)', unit: '',    tip: 'Proportional navigation constant, typically 3–5' },
];

export default function MissileEditor() {
  const { missiles, updateMissile, setMissiles, selectedMissileId, setScenario } = useSimStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selected = missiles.find((m) => m.id === selectedMissileId) ?? missiles[0];
  const missing = getMissingFields(selected);

  function handleChange(key: NullableNumKey, raw: string) {
    const val = raw.trim() === '' ? null : parseFloat(raw);
    if (raw.trim() !== '' && isNaN(val as number)) return;
    updateMissile(selected.id, { [key as string]: val } as Partial<MissileData>);
  }

  function handleExport() {
    const json = JSON.stringify(missiles, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'missiles.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string) as MissileData[];
        setMissiles(data);
      } catch {
        alert('Invalid missiles.json format.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.title}>MISSILE EDITOR</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={styles.btn} onClick={handleExport} title="Export missiles.json">EXPORT</button>
          <button style={styles.btn} onClick={() => fileInputRef.current?.click()} title="Import missiles.json">IMPORT</button>
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
        </div>
      </div>

      {/* Missile selector */}
      <div style={styles.row}>
        <span style={styles.label}>Missile</span>
        <select
          style={styles.select}
          value={selectedMissileId}
          onChange={(e) => setScenario({ selectedMissileId: e.target.value })}
        >
          {missiles.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}{m.isSynthetic ? ' [SYN]' : ''}{getMissingFields(m).length > 0 ? ' ⚠' : ' ✓'}
            </option>
          ))}
        </select>
      </div>

      {selected.isSynthetic && (
        <div style={styles.warning}>⚠ SYNTHETIC — placeholder values for testing only</div>
      )}

      {missing.length > 0 && (
        <div style={styles.missing}>
          Missing required fields: {missing.join(', ')}
        </div>
      )}

      {/* Static fields */}
      <div style={styles.row}>
        <span style={styles.label}>Name</span>
        <input
          style={styles.input}
          value={selected.name}
          onChange={(e) => updateMissile(selected.id, { name: e.target.value })}
        />
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Type</span>
        <select
          style={styles.select}
          value={selected.type}
          onChange={(e) => updateMissile(selected.id, { type: e.target.value as MissileData['type'] })}
        >
          <option value="ARH">ARH (Active Radar)</option>
          <option value="SARH">SARH (Semi-Active Radar)</option>
          <option value="IR">IR (Infrared)</option>
        </select>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>Seeker</span>
        <input
          style={styles.input}
          value={selected.seeker}
          onChange={(e) => updateMissile(selected.id, { seeker: e.target.value })}
        />
      </div>

      <div style={styles.divider} />

      {/* Numeric fields */}
      {FIELDS.map(({ key, label, unit, tip }) => {
        const val = (selected as unknown as Record<string, unknown>)[key as string] as number | null;
        const isRequired = ['motorBurnTime_s','thrust_N','mass_kg','massBurnout_kg','dragCoefficient','referenceArea_m2','guidanceNav'].includes(key as string);
        const isEmpty = val === null;
        return (
          <div key={key} style={styles.row} title={tip}>
            <span style={{ ...styles.label, color: isEmpty && isRequired ? '#aa3333' : '#88aa88' }}>
              {label}{unit ? ` (${unit})` : ''}
            </span>
            <input
              style={{ ...styles.input, width: 80, color: isEmpty ? '#556655' : '#aaccaa' }}
              value={val === null ? '' : val}
              placeholder="—"
              onChange={(e) => handleChange(key, e.target.value)}
            />
          </div>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    overflowY: 'auto',
    padding: '10px 14px',
    background: '#080c08',
    fontFamily: 'Share Tech Mono, monospace',
    fontSize: 11,
    color: '#aaccaa',
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingBottom: 8,
    borderBottom: '1px solid #1a3a1a',
  },
  title: {
    color: '#00ff80',
    fontSize: 13,
    letterSpacing: 2,
    fontWeight: 'bold',
  },
  btn: {
    background: '#0d1a0d',
    border: '1px solid #2a4a2a',
    color: '#aaccaa',
    fontFamily: 'Share Tech Mono, monospace',
    fontSize: 10,
    padding: '3px 8px',
    cursor: 'pointer',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 5,
    gap: 8,
  },
  label: {
    color: '#88aa88',
    fontSize: 10,
    flex: 1,
  },
  input: {
    background: '#0d1a0d',
    border: '1px solid #2a4a2a',
    color: '#aaccaa',
    fontFamily: 'Share Tech Mono, monospace',
    fontSize: 10,
    padding: '2px 5px',
    width: 120,
    boxSizing: 'border-box',
  },
  select: {
    background: '#0d1a0d',
    border: '1px solid #2a4a2a',
    color: '#aaccaa',
    fontFamily: 'Share Tech Mono, monospace',
    fontSize: 10,
    padding: '2px 4px',
    width: 160,
  },
  warning: {
    background: '#2a1a00',
    border: '1px solid #aa6600',
    color: '#ffaa44',
    padding: '4px 6px',
    fontSize: 9,
    marginBottom: 8,
  },
  missing: {
    background: '#1a0000',
    border: '1px solid #aa2222',
    color: '#ff6666',
    padding: '4px 6px',
    fontSize: 9,
    marginBottom: 8,
    lineHeight: 1.4,
  },
  divider: {
    height: 1,
    background: '#1a2a1a',
    margin: '8px 0',
  },
};
