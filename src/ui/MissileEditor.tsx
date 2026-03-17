import { useRef, useState } from 'react';
import { useSimStore } from '../store/simStore';
import type { MissileData } from '../data/types';
import { getMissingFields } from '../physics/missile';

type NullableNumKey = {
  [K in keyof MissileData]: MissileData[K] extends number | null ? K : never;
}[keyof MissileData] & string;

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
  { key: 'ccm_k0',                  label: 'CM Vulnerability (ccm_k0)', unit: '', tip: 'DCS ccm_k0: lower = more resistant to countermeasures. IR: flare resist. Radar: chaff resist. AIM-9X≈0.1, R-77≈0.2, AIM-7≈0.55, R-73≈0.75.' },
];

// ── Template presets ──────────────────────────────────────────────────────────

interface Template {
  label: string;
  type: MissileData['type'];
  seeker: string;
  fields: Partial<Record<NullableNumKey, number>>;
}

const TEMPLATES: Template[] = [
  {
    label: 'Short-Range IR AAM',
    type: 'IR',
    seeker: 'Infrared (all-aspect)',
    fields: {
      motorBurnTime_s: 3,    thrust_N: 2600,  mass_kg: 85,   massBurnout_kg: 60,
      dragCoefficient: 0.4,  referenceArea_m2: 0.0078, maxSpeed_mach: 3.0, maxRange_nm: 5,
      gLimit: 40, seekerAcquisitionRange_nm: 5, loftAngle_deg: 0, guidanceNav: 4, ccm_k0: 0.55,
    },
  },
  {
    label: 'Medium-Range ARH AAM',
    type: 'ARH',
    seeker: 'Active Radar',
    fields: {
      motorBurnTime_s: 8,    thrust_N: 4500,  mass_kg: 152,  massBurnout_kg: 90,
      dragCoefficient: 0.35, referenceArea_m2: 0.0113, maxSpeed_mach: 4.0, maxRange_nm: 30,
      gLimit: 35, seekerAcquisitionRange_nm: 16, loftAngle_deg: 5, guidanceNav: 4, ccm_k0: 0.30,
    },
  },
  {
    label: 'Long-Range ARH AAM',
    type: 'ARH',
    seeker: 'Active Radar (long-range)',
    fields: {
      motorBurnTime_s: 10,   thrust_N: 6000,  mass_kg: 175,  massBurnout_kg: 100,
      dragCoefficient: 0.32, referenceArea_m2: 0.0113, maxSpeed_mach: 4.5, maxRange_nm: 60,
      gLimit: 30, seekerAcquisitionRange_nm: 20, loftAngle_deg: 8, guidanceNav: 4, ccm_k0: 0.25,
    },
  },
  {
    label: 'SARH AAM',
    type: 'SARH',
    seeker: 'Semi-Active Radar',
    fields: {
      motorBurnTime_s: 4,    thrust_N: 11000, mass_kg: 230,  massBurnout_kg: 140,
      dragCoefficient: 0.38, referenceArea_m2: 0.0201, maxSpeed_mach: 3.7, maxRange_nm: 25,
      gLimit: 25, seekerAcquisitionRange_nm: 25, loftAngle_deg: 3, guidanceNav: 3.5, ccm_k0: 0.50,
    },
  },
  {
    label: 'MANPAD (IR)',
    type: 'IR',
    seeker: 'Infrared (rear-aspect)',
    fields: {
      motorBurnTime_s: 5,    thrust_N: 550,   mass_kg: 11,   massBurnout_kg: 7,
      dragCoefficient: 0.45, referenceArea_m2: 0.0038, maxSpeed_mach: 2.2, maxRange_nm: 4,
      gLimit: 12, seekerAcquisitionRange_nm: 4, loftAngle_deg: 0, guidanceNav: 3, ccm_k0: 0.65,
    },
  },
  {
    label: 'Short-Range SAM (ARH)',
    type: 'ARH',
    seeker: 'Active Radar (SAM)',
    fields: {
      motorBurnTime_s: 5,    thrust_N: 20000, mass_kg: 165,  massBurnout_kg: 110,
      dragCoefficient: 0.38, referenceArea_m2: 0.0434, maxSpeed_mach: 2.8, maxRange_nm: 10,
      gLimit: 30, seekerAcquisitionRange_nm: 10, loftAngle_deg: 0, guidanceNav: 4, ccm_k0: 0.35,
    },
  },
  {
    label: 'Medium-Range SAM (SARH)',
    type: 'SARH',
    seeker: 'Semi-Active Radar (SAM)',
    fields: {
      motorBurnTime_s: 7,    thrust_N: 20000, mass_kg: 250,  massBurnout_kg: 160,
      dragCoefficient: 0.40, referenceArea_m2: 0.0707, maxSpeed_mach: 2.8, maxRange_nm: 20,
      gLimit: 22, seekerAcquisitionRange_nm: 20, loftAngle_deg: 0, guidanceNav: 4, ccm_k0: 0.45,
    },
  },
  {
    label: 'Long-Range SAM (ARH)',
    type: 'ARH',
    seeker: 'Active Radar (long-range SAM)',
    fields: {
      motorBurnTime_s: 12,   thrust_N: 150000, mass_kg: 1500, massBurnout_kg: 950,
      dragCoefficient: 0.30, referenceArea_m2: 0.1590, maxSpeed_mach: 6.0, maxRange_nm: 65,
      gLimit: 20, seekerAcquisitionRange_nm: 30, loftAngle_deg: 0, guidanceNav: 4, ccm_k0: 0.25,
    },
  },
];

function makeId(name: string): string {
  return (
    'custom-' +
    Date.now() +
    '-' +
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20)
  );
}

function draftFromTemplate(tpl: Template): MissileData {
  return {
    id: makeId(tpl.label),
    name: tpl.label,
    type: tpl.type,
    seeker: tpl.seeker,
    motorBurnTime_s: tpl.fields.motorBurnTime_s ?? null,
    thrust_N: tpl.fields.thrust_N ?? null,
    mass_kg: tpl.fields.mass_kg ?? null,
    massBurnout_kg: tpl.fields.massBurnout_kg ?? null,
    dragCoefficient: tpl.fields.dragCoefficient ?? null,
    referenceArea_m2: tpl.fields.referenceArea_m2 ?? null,
    maxSpeed_mach: tpl.fields.maxSpeed_mach ?? null,
    maxRange_nm: tpl.fields.maxRange_nm ?? null,
    gLimit: tpl.fields.gLimit ?? null,
    seekerAcquisitionRange_nm: tpl.fields.seekerAcquisitionRange_nm ?? null,
    loftAngle_deg: tpl.fields.loftAngle_deg ?? null,
    guidanceNav: tpl.fields.guidanceNav ?? null,
    ccm_k0: tpl.fields.ccm_k0 ?? null,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MissileEditor() {
  const { missiles, updateMissile, setMissiles, addMissile, deleteMissile, selectedMissileId, setScenario } = useSimStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState<MissileData>(() => draftFromTemplate(TEMPLATES[0]));
  const [templateIdx, setTemplateIdx] = useState(0);

  const selected = missiles.find((m) => m.id === selectedMissileId) ?? missiles[0];
  const missing = getMissingFields(selected);

  // ── Existing missile editing ──────────────────────────────────────────────

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

  // ── NEW panel actions ─────────────────────────────────────────────────────

  function handleOpenNew() {
    const tpl = TEMPLATES[templateIdx];
    setDraft(draftFromTemplate(tpl));
    setShowNew(true);
  }

  function handleTemplateChange(idx: number) {
    setTemplateIdx(idx);
    setDraft(draftFromTemplate(TEMPLATES[idx]));
  }

  function handleDraftChange(key: NullableNumKey, raw: string) {
    const val = raw.trim() === '' ? null : parseFloat(raw);
    if (raw.trim() !== '' && isNaN(val as number)) return;
    setDraft((d) => ({ ...d, [key]: val }));
  }

  function handleCreate() {
    if (!draft.name.trim()) { alert('Name is required.'); return; }
    const newMissile: MissileData = { ...draft, id: makeId(draft.name) };
    addMissile(newMissile);
    setScenario({ selectedMissileId: newMissile.id });
    setShowNew(false);
  }

  // ── DUPE ──────────────────────────────────────────────────────────────────

  function handleDupe() {
    const copy: MissileData = {
      ...selected,
      id: makeId(selected.name),
      name: selected.name + ' (Copy)',
    };
    addMissile(copy);
    setScenario({ selectedMissileId: copy.id });
  }

  // ── DELETE ────────────────────────────────────────────────────────────────

  function handleDelete() {
    if (!window.confirm(`Delete "${selected.name}"? This cannot be undone.`)) return;
    deleteMissile(selected.id);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.title}>MISSILE EDITOR</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button style={{ ...styles.btn, ...styles.btnGreen }} onClick={handleOpenNew} title="Create a new custom missile">NEW</button>
          <button style={styles.btn} onClick={handleDupe} title="Duplicate selected missile">DUPE</button>
          <button
            style={{ ...styles.btn, ...styles.btnRed, opacity: missiles.length <= 1 ? 0.4 : 1 }}
            onClick={handleDelete}
            disabled={missiles.length <= 1}
            title="Delete selected missile"
          >DELETE</button>
          <div style={styles.dividerV} />
          <button style={styles.btn} onClick={handleExport} title="Export missiles.json">EXPORT</button>
          <button style={styles.btn} onClick={() => fileInputRef.current?.click()} title="Import missiles.json">IMPORT</button>
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
        </div>
      </div>

      {/* ── Creation panel ── */}
      {showNew && (
        <div style={styles.newPanel}>
          <div style={styles.newPanelTitle}>NEW MISSILE</div>

          {/* Template */}
          <div style={styles.row}>
            <span style={styles.label}>Template</span>
            <select
              style={styles.select}
              value={templateIdx}
              onChange={(e) => handleTemplateChange(+e.target.value)}
            >
              {TEMPLATES.map((t, i) => (
                <option key={t.label} value={i}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Name */}
          <div style={styles.row}>
            <span style={{ ...styles.label, color: '#ffaa44' }}>Name *</span>
            <input
              style={styles.input}
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="My Custom Missile"
            />
          </div>

          {/* Type */}
          <div style={styles.row}>
            <span style={styles.label}>Type</span>
            <select
              style={styles.select}
              value={draft.type}
              onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as MissileData['type'] }))}
            >
              <option value="ARH">ARH (Active Radar)</option>
              <option value="SARH">SARH (Semi-Active Radar)</option>
              <option value="IR">IR (Infrared)</option>
            </select>
          </div>

          {/* Seeker */}
          <div style={styles.row}>
            <span style={styles.label}>Seeker</span>
            <input
              style={styles.input}
              value={draft.seeker}
              onChange={(e) => setDraft((d) => ({ ...d, seeker: e.target.value }))}
            />
          </div>

          <div style={styles.divider} />

          {/* Numeric fields */}
          {FIELDS.map(({ key, label, unit, tip }) => {
            const val = (draft as unknown as Record<string, unknown>)[key] as number | null;
            return (
              <div key={key} style={styles.row} title={tip}>
                <span style={styles.label}>{label}{unit ? ` (${unit})` : ''}</span>
                <input
                  style={{ ...styles.input, width: 80, color: val === null ? '#556655' : '#aaccaa' }}
                  value={val === null ? '' : val}
                  placeholder="—"
                  onChange={(e) => handleDraftChange(key, e.target.value)}
                />
              </div>
            );
          })}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <button style={{ ...styles.btn, ...styles.btnGreen, flex: 1 }} onClick={handleCreate}>CREATE</button>
            <button style={{ ...styles.btn, flex: 1 }} onClick={() => setShowNew(false)}>CANCEL</button>
          </div>
        </div>
      )}

      {/* ── Edit existing missile ── */}
      {!showNew && (
        <>
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
            const isRequired = ['motorBurnTime_s','thrust_N','mass_kg','massBurnout_kg','dragCoefficient','referenceArea_m2','guidanceNav'].includes(key);
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
        </>
      )}
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
    flexWrap: 'wrap',
    gap: 6,
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
  btnGreen: {
    borderColor: '#00aa44',
    color: '#00ff80',
    background: '#0a1a0a',
  },
  btnRed: {
    borderColor: '#aa2222',
    color: '#ff6666',
    background: '#1a0a0a',
  },
  dividerV: {
    width: 1,
    height: 18,
    background: '#1a3a1a',
    margin: '0 2px',
    alignSelf: 'center',
  },
  newPanel: {
    border: '1px solid #aa6600',
    background: '#0e0c08',
    padding: '8px 10px',
    marginBottom: 10,
  },
  newPanelTitle: {
    color: '#ffaa44',
    fontSize: 10,
    letterSpacing: 2,
    marginBottom: 8,
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
