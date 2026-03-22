import { useState } from 'react';
import { useSimStore } from '../store/simStore';
import type { ComparisonEntry } from '../store/simStore';
import { T } from './theme';

type SortKey = keyof Pick<ComparisonEntry, 'pk' | 'timeOfFlight' | 'terminalSpeedMach' | 'missDistance' | 'fPoleNm' | 'aPoleNm' | 'rangeNm' | 'aspectAngleDeg'>;

export default function ComparisonPanel() {
  const { simResult, comparisonEntries, addComparisonEntry, removeComparisonEntry, clearComparisonEntries,
    selectedMissileId, missiles, targetManeuver, rangeNm, aspectAngleDeg, targetAlt, targetSpeed, shooterAlt } = useSimStore();

  const [sortKey, setSortKey] = useState<SortKey>('pk');
  const [sortAsc, setSortAsc] = useState(false);

  function handleAdd() {
    if (!simResult) return;
    const missile = missiles.find((m) => m.id === selectedMissileId);
    if (!missile) return;
    addComparisonEntry({
      label: `${missile.name} | ${targetManeuver} | ${rangeNm}nm | ${aspectAngleDeg}°`,
      missileName: missile.name,
      targetManeuver,
      rangeNm,
      aspectAngleDeg,
      targetAlt,
      targetSpeed,
      shooterAlt,
      pk: simResult.pk,
      hit: simResult.hit,
      timeOfFlight: simResult.timeOfFlight,
      terminalSpeedMach: simResult.terminalSpeedMach,
      missDistance: simResult.missDistance,
      fPoleNm: simResult.fPoleNm,
      aPoleNm: simResult.aPoleNm,
      verdict: simResult.verdict,
      chaffSalvosUsed: simResult.chaffSalvosUsed,
      flareSalvosUsed: simResult.flareSalvosUsed,
    });
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === 'missDistance'); // lower is better for miss distance
    }
  }

  function handleExportCsv() {
    if (comparisonEntries.length === 0) return;
    const headers = ['Label', 'Missile', 'Maneuver', 'Range(nm)', 'Aspect(°)', 'Tgt Alt(ft)', 'Tgt Spd(kt)', 'Pk(%)', 'Hit', 'TOF(s)', 'Terminal(M)', 'Miss(m)', 'F-Pole(nm)', 'A-Pole(nm)', 'Verdict'];
    const rows = comparisonEntries.map((e) => [
      `"${e.label}"`,
      `"${e.missileName}"`,
      e.targetManeuver,
      e.rangeNm,
      e.aspectAngleDeg,
      e.targetAlt,
      e.targetSpeed,
      (e.pk * 100).toFixed(0),
      e.hit ? 'Y' : 'N',
      e.timeOfFlight.toFixed(1),
      e.terminalSpeedMach.toFixed(2),
      e.missDistance.toFixed(0),
      e.fPoleNm.toFixed(1),
      e.aPoleNm.toFixed(1),
      `"${e.verdict}"`,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dcs-missile-comparison.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const sorted = [...comparisonEntries].sort((a, b) => {
    const va = a[sortKey] as number;
    const vb = b[sortKey] as number;
    return sortAsc ? va - vb : vb - va;
  });

  const SortBtn = ({ col, label }: { col: SortKey; label: string }) => (
    <th
      style={{ ...styles.th, cursor: 'pointer', color: sortKey === col ? T.accentBright : T.textDim }}
      onClick={() => handleSort(col)}
    >
      {label}{sortKey === col ? (sortAsc ? ' ↑' : ' ↓') : ''}
    </th>
  );

  return (
    <div style={styles.panel}>
      {/* Header controls */}
      <div style={styles.header}>
        <div style={styles.title}>ENGAGEMENT COMPARISON</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            style={{ ...styles.btn, ...(simResult ? {} : styles.btnDisabled) }}
            onClick={handleAdd}
            disabled={!simResult}
            title="Add current simulation result to comparison table"
          >
            + ADD CURRENT
          </button>
          <button
            style={{ ...styles.btn }}
            onClick={handleExportCsv}
            disabled={comparisonEntries.length === 0}
            title="Export comparison table as CSV"
          >
            CSV
          </button>
          <button
            style={{ ...styles.btn, color: T.danger, borderColor: T.dangerDim }}
            onClick={clearComparisonEntries}
            disabled={comparisonEntries.length === 0}
            title="Clear all entries"
          >
            CLEAR
          </button>
        </div>
      </div>

      {comparisonEntries.length === 0 ? (
        <div style={styles.empty}>
          Run simulations in TACTICAL mode, then click "+ ADD CURRENT" to build a comparison table.
        </div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Missile</th>
                <th style={styles.th}>Manvr</th>
                <SortBtn col="rangeNm" label="Rng" />
                <SortBtn col="aspectAngleDeg" label="Asp" />
                <SortBtn col="pk" label="Pk%" />
                <th style={styles.th}>Hit</th>
                <SortBtn col="timeOfFlight" label="TOF" />
                <SortBtn col="terminalSpeedMach" label="M-term" />
                <SortBtn col="missDistance" label="Miss" />
                <SortBtn col="fPoleNm" label="F-pole" />
                <SortBtn col="aPoleNm" label="A-pole" />
                <th style={styles.th}>Verdict</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={e.id} style={{ background: e.hit ? 'rgba(0,255,80,0.04)' : 'rgba(255,50,50,0.04)' }}>
                  <td style={styles.td}><span title={e.label}>{e.missileName}</span></td>
                  <td style={styles.td}>{e.targetManeuver}</td>
                  <td style={styles.tdNum}>{e.rangeNm}</td>
                  <td style={styles.tdNum}>{e.aspectAngleDeg}°</td>
                  <td style={{ ...styles.tdNum, color: pkColor(e.pk) }}>{(e.pk * 100).toFixed(0)}%</td>
                  <td style={{ ...styles.tdNum, color: e.hit ? T.success : T.danger }}>{e.hit ? 'Y' : 'N'}</td>
                  <td style={styles.tdNum}>{e.timeOfFlight.toFixed(1)}s</td>
                  <td style={styles.tdNum}>M{e.terminalSpeedMach.toFixed(2)}</td>
                  <td style={styles.tdNum}>{e.hit ? '—' : `${e.missDistance.toFixed(0)}m`}</td>
                  <td style={styles.tdNum}>{e.fPoleNm.toFixed(1)}</td>
                  <td style={styles.tdNum}>{e.aPoleNm.toFixed(1)}</td>
                  <td style={{ ...styles.td, fontSize: 9, color: verdictColor(e.pk, e.verdict) }}>{e.verdict}</td>
                  <td style={styles.td}>
                    <button
                      style={styles.delBtn}
                      onClick={() => removeComparisonEntry(e.id)}
                      title="Remove"
                    >×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function pkColor(pk: number): string {
  if (pk >= 0.8) return T.success;
  if (pk >= 0.5) return T.warning;
  return T.danger;
}

function verdictColor(pk: number, verdict?: string): string {
  if (verdict?.startsWith('Decoyed')) return '#ff8800';
  if (verdict?.startsWith('No launch')) return T.textDim;
  if (pk >= 0.8) return T.success;
  if (pk >= 0.5) return T.warning;
  return T.danger;
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: '16px 24px',
    background: T.bgBase,
    fontFamily: T.fontUI,
    color: T.text,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    color: T.accentBright,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 2,
  },
  btn: {
    background: T.bgRaised,
    border: `1px solid ${T.border}`,
    color: T.text,
    fontFamily: T.fontUI,
    fontSize: 10,
    fontWeight: '600',
    padding: '4px 12px',
    cursor: 'pointer',
    borderRadius: 3,
    letterSpacing: 0.5,
  },
  btnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  empty: {
    color: T.textDim,
    fontSize: 11,
    lineHeight: 1.6,
    marginTop: 40,
    textAlign: 'center',
  },
  tableWrap: {
    overflowX: 'auto',
    overflowY: 'auto',
    flex: 1,
  },
  table: {
    borderCollapse: 'collapse',
    width: '100%',
    fontSize: 10,
    fontFamily: T.fontMono,
  },
  th: {
    padding: '6px 10px',
    color: T.textDim,
    fontSize: 9,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    borderBottom: `1px solid ${T.border}`,
    textAlign: 'left',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '5px 10px',
    borderBottom: `1px solid ${T.borderDim}`,
    color: T.text,
    whiteSpace: 'nowrap',
  },
  tdNum: {
    padding: '5px 10px',
    borderBottom: `1px solid ${T.borderDim}`,
    color: T.text,
    fontFamily: T.fontMono,
    textAlign: 'right',
    whiteSpace: 'nowrap',
  },
  delBtn: {
    background: 'transparent',
    border: 'none',
    color: T.textDim,
    cursor: 'pointer',
    fontSize: 14,
    padding: '0 4px',
    lineHeight: 1,
  },
};
