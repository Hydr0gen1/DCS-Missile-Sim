import { useEffect, useRef, useCallback, useState } from 'react';
import { useSimStore } from '../store/simStore';
import { M_TO_NM, NM_TO_M } from '../physics/atmosphere';

const CANVAS_SIZE = 700;  // px
const VIEW_RANGE_NM = 60; // nm visible radius
const NM_PX = CANVAS_SIZE / (VIEW_RANGE_NM * 2); // pixels per nm

function nmToPx(nm: number): number {
  return nm * NM_PX;
}

function worldToCanvas(
  worldX: number,
  worldY: number,
  cx: number,
  cy: number,
  scale: number,
): [number, number] {
  return [
    cx + (worldX * M_TO_NM) * scale,
    cy - (worldY * M_TO_NM) * scale, // y flipped
  ];
}

export default function TacticalDisplay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [profileView, setProfileView] = useState(false);
  const {
    simFrames, currentFrameIdx, simStatus, appMode,
    maxRangeM, minRangeM, nezM,
    addTargetWaypoint, targetManeuver, setScenario, clearTargetWaypoints,
    rangeNm, aspectAngleDeg, shooterStartX, shooterStartY,
    shooterRole,
    shooterAlt: storeShooterAlt,
    targetAlt: storeTargetAlt,
  } = useSimStore();

  // Toggle profile view on 'P' keypress
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'p' || e.key === 'P') setProfileView(v => !v);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const scale = NM_PX; // px per nm

  // ── Side profile view: range-from-shooter (X) vs altitude (Y) ────────────
  const drawProfile = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;

    ctx.fillStyle = '#080c10';
    ctx.fillRect(0, 0, W, H);

    const frame = simFrames[currentFrameIdx];
    const shooterAlt = frame?.shooter.altFt ?? storeShooterAlt;
    const targetAlt  = frame?.target.altFt  ?? storeTargetAlt;

    // Compute display range: up to the initial engagement range + 20%
    const maxDispNm = rangeNm * 1.3;
    const maxAltFt  = Math.max(shooterAlt, targetAlt, frame?.missile.altFt ?? 0, 5000) * 1.4;
    const padL = 52, padR = 16, padT = 16, padB = 36;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    function toCanvas(rangeNmVal: number, altFtVal: number): [number, number] {
      const px = padL + (rangeNmVal / maxDispNm) * plotW;
      const py = padT + plotH - (altFtVal / maxAltFt) * plotH;
      return [px, py];
    }

    // Grid lines
    ctx.strokeStyle = '#1a2a1a';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 4]);
    ctx.font = '9px Share Tech Mono, monospace';
    ctx.fillStyle = '#2a4a2a';
    for (let r = 0; r <= Math.ceil(maxDispNm); r += 10) {
      const [px] = toCanvas(r, 0);
      ctx.beginPath(); ctx.moveTo(px, padT); ctx.lineTo(px, padT + plotH); ctx.stroke();
      ctx.fillText(`${r}nm`, px - 8, padT + plotH + 14);
    }
    for (let a = 0; a <= Math.ceil(maxAltFt / 1000) * 1000; a += 10000) {
      const [, py] = toCanvas(0, a);
      if (py < padT || py > padT + plotH) continue;
      ctx.beginPath(); ctx.moveTo(padL, py); ctx.lineTo(padL + plotW, py); ctx.stroke();
      ctx.fillText(`${(a / 1000).toFixed(0)}k`, 2, py + 3);
    }
    ctx.setLineDash([]);

    // Axis labels
    ctx.fillStyle = '#3a5a3a';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText('ALT (ft)', 2, padT - 4);
    ctx.fillText('RANGE (nm)', padL + plotW / 2 - 30, H - 4);

    // Title
    ctx.fillStyle = '#4a8a4a';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText('PROFILE VIEW  [P] = plan', W - 170, 14);

    if (!frame) {
      // Static view: shooter and target at initial positions
      const sx0 = 0;
      const tgtInitRangeNm = rangeNm;
      const [sxC, syC] = toCanvas(sx0, storeShooterAlt);
      const [txC, tyC] = toCanvas(tgtInitRangeNm, storeTargetAlt);
      ctx.beginPath(); ctx.arc(sxC, syC, 5, 0, 2 * Math.PI); ctx.fillStyle = '#00aaff'; ctx.fill();
      ctx.fillStyle = '#00aaff'; ctx.font = '10px Share Tech Mono, monospace';
      ctx.fillText('SHOOTER', sxC + 7, syC + 4);
      ctx.beginPath(); ctx.arc(txC, tyC, 5, 0, 2 * Math.PI); ctx.fillStyle = '#ff4444'; ctx.fill();
      ctx.fillStyle = '#ff4444';
      ctx.fillText('TARGET', txC + 7, tyC + 4);
      return;
    }

    // Missile trails in profile (all salvo missiles)
    const profileMissiles = frame.missiles ?? [frame.missile];
    for (let mi = 0; mi < profileMissiles.length; mi++) {
      const msl = profileMissiles[mi];
      if (msl.trail.length > 1) {
        const { shooter: sh } = frame;
        ctx.beginPath();
        let first = true;
        for (const pt of msl.trail) {
          const rNm = Math.hypot(pt.x - sh.x, pt.y - sh.y) * M_TO_NM;
          const [px, py] = toCanvas(rNm, pt.alt);
          if (first) { ctx.moveTo(px, py); first = false; } else { ctx.lineTo(px, py); }
        }
        ctx.strokeStyle = mi === 0 ? 'rgba(255,165,0,0.6)' : 'rgba(255,140,60,0.4)';
        ctx.lineWidth = mi === 0 ? 1.5 : 1;
        ctx.stroke();
      }
    }

    // Current missile dot (lead)
    const leadMsl = profileMissiles[0];
    const mrNm = Math.hypot(leadMsl.x - frame.shooter.x, leadMsl.y - frame.shooter.y) * M_TO_NM;
    const [mxP, myP] = toCanvas(mrNm, leadMsl.altFt);
    ctx.beginPath(); ctx.arc(mxP, myP, 4, 0, 2 * Math.PI);
    ctx.fillStyle = energyToColor(leadMsl.energy); ctx.fill();

    // Shooter icon
    const srNm = 0; // shooter at range 0
    const [sxP, syP] = toCanvas(srNm, frame.shooter.altFt);
    ctx.beginPath(); ctx.arc(sxP, syP, 5, 0, 2 * Math.PI); ctx.fillStyle = '#00aaff'; ctx.fill();
    ctx.fillStyle = '#00aaff'; ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText(`${Math.round(frame.shooter.altFt / 1000)}k ft`, sxP + 7, syP + 4);

    // Target icon
    const trNm = Math.hypot(frame.target.x - frame.shooter.x, frame.target.y - frame.shooter.y) * M_TO_NM;
    const [txP, tyP] = toCanvas(trNm, frame.target.altFt);
    ctx.beginPath(); ctx.arc(txP, tyP, 5, 0, 2 * Math.PI); ctx.fillStyle = '#ff4444'; ctx.fill();
    ctx.fillStyle = '#ff4444'; ctx.font = '10px Share Tech Mono, monospace';
    ctx.fillText(`${Math.round(frame.target.altFt / 1000)}k ft`, txP + 7, tyP + 4);

    // Missile altitude label
    ctx.fillStyle = '#ffaa00';
    ctx.fillText(`MSL ${Math.round(leadMsl.altFt / 1000)}k ft`, mxP + 6, myP - 6);
  }, [simFrames, currentFrameIdx, simStatus, rangeNm, storeShooterAlt, storeTargetAlt]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;

    // Background
    ctx.fillStyle = '#080c10';
    ctx.fillRect(0, 0, W, H);

    // Grid — range rings every 10 nm
    ctx.strokeStyle = '#1a2a1a';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 4]);
    for (let r = 10; r <= VIEW_RANGE_NM; r += 10) {
      const rPx = nmToPx(r);
      ctx.beginPath();
      ctx.arc(cx, cy, rPx, 0, 2 * Math.PI);
      ctx.stroke();
      // Label
      ctx.setLineDash([]);
      ctx.fillStyle = '#2a4a2a';
      ctx.font = '9px Share Tech Mono, monospace';
      ctx.fillText(`${r}nm`, cx + rPx + 2, cy);
      ctx.setLineDash([4, 4]);
    }

    // Cross-hair lines
    ctx.setLineDash([2, 6]);
    ctx.strokeStyle = '#1a2a1a';
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
    ctx.setLineDash([]);

    const frame = simFrames[currentFrameIdx];

    // If we have a frame, draw LAR around target start position
    if (simStatus !== 'idle' && maxRangeM > 0) {
      // Target position from current frame (or initial pos)
      const tgt = frame ? frame.target : null;
      const baseX = tgt ? tgt.x : (rangeNm * NM_TO_M * Math.sin((aspectAngleDeg * Math.PI) / 180));
      const baseY = tgt ? tgt.y : (rangeNm * NM_TO_M * Math.cos((aspectAngleDeg * Math.PI) / 180));
      const [bx, by] = worldToCanvas(baseX, baseY, cx, cy, scale);

      const rMaxPx = maxRangeM * M_TO_NM * scale;
      const rMinPx = minRangeM * M_TO_NM * scale;
      const nezPx = nezM * M_TO_NM * scale;

      // Rmax — green
      ctx.beginPath();
      ctx.arc(bx, by, rMaxPx, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(0,255,80,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // NEZ — amber
      ctx.beginPath();
      ctx.arc(bx, by, nezPx, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(255,180,0,0.45)';
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);

      // Rmin — red
      ctx.beginPath();
      ctx.arc(bx, by, rMinPx, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(255,50,50,0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    if (!frame) {
      // Draw default positions before simulation
      // Shooter at origin
      const [sx, sy] = worldToCanvas(0, 0, cx, cy, scale);
      if (shooterRole === 'ground') {
        drawSamSite(ctx, sx, sy, '#00aaff');
      } else {
        drawAircraft(ctx, sx, sy, 0, '#00aaff', '⬤');
      }

      // Target
      const tgtInitX = rangeNm * NM_TO_M * Math.sin((aspectAngleDeg * Math.PI) / 180);
      const tgtInitY = rangeNm * NM_TO_M * Math.cos((aspectAngleDeg * Math.PI) / 180);
      const [tx, ty] = worldToCanvas(tgtInitX, tgtInitY, cx, cy, scale);
      drawAircraft(ctx, tx, ty, 180, '#ff4444', '⬤');

      // Labels
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.fillStyle = '#00aaff';
      ctx.fillText(shooterRole === 'ground' ? 'SAM SITE' : 'SHOOTER', sx + 8, sy - 8);
      ctx.fillStyle = '#ff4444';
      ctx.fillText('TARGET', tx + 8, ty - 8);
      return;
    }

    const { missiles, shooter, target } = frame;
    const missile = missiles[0]; // lead missile for HUD and datalink

    // Draw trails for all salvo missiles
    for (let mi = 0; mi < missiles.length; mi++) {
      const msl = missiles[mi];
      if (msl.trail.length > 1) {
        ctx.beginPath();
        const [tx0, ty0] = worldToCanvas(msl.trail[0].x, msl.trail[0].y, cx, cy, scale);
        ctx.moveTo(tx0, ty0);
        for (let i = 1; i < msl.trail.length; i++) {
          const [tx1, ty1] = worldToCanvas(msl.trail[i].x, msl.trail[i].y, cx, cy, scale);
          ctx.lineTo(tx1, ty1);
        }
        ctx.strokeStyle = mi === 0 ? 'rgba(255,165,0,0.5)' : 'rgba(255,140,60,0.35)';
        ctx.lineWidth = mi === 0 ? 1.5 : 1;
        ctx.stroke();
      }
    }

    // Datalink line: shooter → lead missile (green = active, red dashed = lost)
    const [mx, my] = worldToCanvas(missile.x, missile.y, cx, cy, scale);
    const [dlsx, dlsy] = worldToCanvas(shooter.x, shooter.y, cx, cy, scale);
    if (shooterRole !== 'ground') {
      ctx.beginPath();
      ctx.moveTo(dlsx, dlsy);
      ctx.lineTo(mx, my);
      if (frame.datalinkActive === false) {
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(255,60,60,0.5)';
      } else {
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(0,200,80,0.35)';
      }
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // CM objects (flares = yellow squares, chaff = cyan squares)
    if (frame.countermeasures) {
      for (const cm of frame.countermeasures) {
        const [cmx, cmy] = worldToCanvas(cm.x, cm.y, cx, cy, scale);
        const sz = cm.type === 'flare' ? 4 : 3;
        ctx.globalAlpha = cm.opacity * 0.85;
        ctx.fillStyle = cm.type === 'flare' ? '#ffee44' : '#44ccff';
        ctx.fillRect(cmx - sz / 2, cmy - sz / 2, sz, sz);
      }
      ctx.globalAlpha = 1.0;
    }

    // Missile dots (all salvo missiles)
    for (let mi = 0; mi < missiles.length; mi++) {
      const msl = missiles[mi];
      if (mi > 0 && !msl.motorBurning && !msl.active && msl.speedMs < 1) continue; // pre-launch
      const [mmx, mmy] = worldToCanvas(msl.x, msl.y, cx, cy, scale);
      ctx.beginPath();
      ctx.arc(mmx, mmy, mi === 0 ? 4 : 3, 0, 2 * Math.PI);
      ctx.fillStyle = energyToColor(msl.energy);
      ctx.fill();
    }

    // Shooter
    const [sx, sy] = worldToCanvas(shooter.x, shooter.y, cx, cy, scale);
    if (shooterRole === 'ground') {
      drawSamSite(ctx, sx, sy, '#00aaff');
    } else {
      drawAircraft(ctx, sx, sy, shooter.headingDeg, '#00aaff', '⬤');
    }

    // Target
    const [ttx, tty] = worldToCanvas(target.x, target.y, cx, cy, scale);
    drawAircraft(ctx, ttx, tty, target.headingDeg, '#ff4444', '⬤');

    // Velocity vectors
    drawVelocityVector(ctx, sx, sy, shooter.vx, shooter.vy, scale, '#00aaff');
    drawVelocityVector(ctx, ttx, tty, target.vx, target.vy, scale, '#ff4444');

    // HUD text overlays
    ctx.font = '11px Share Tech Mono, monospace';

    // Shooter alt
    ctx.fillStyle = '#00aaff';
    ctx.fillText(`${Math.round(shooter.altFt).toLocaleString()} ft`, sx + 10, sy + 4);

    // Target alt
    ctx.fillStyle = '#ff4444';
    ctx.fillText(`${Math.round(target.altFt).toLocaleString()} ft`, ttx + 10, tty + 4);

    // Closure + TTI
    ctx.fillStyle = '#00ff80';
    const closNm = (frame.closingVelocity * 1.94384).toFixed(0); // m/s to kts
    const tti = frame.timeToImpact < 9999 ? `${frame.timeToImpact.toFixed(1)}s` : '---';
    ctx.fillText(`CLS: ${closNm}kt  TTI: ${tti}`, cx - 80, 18);
    ctx.fillText(`T+${frame.time.toFixed(1)}s`, cx - 25, 34);

    // Missile altitude
    ctx.fillStyle = '#ffaa00';
    ctx.fillText(`MSL: ${Math.round(missile.altFt).toLocaleString()} ft`, mx + 8, my - 6);

  }, [simFrames, currentFrameIdx, simStatus, maxRangeM, minRangeM, nezM, rangeNm, aspectAngleDeg, scale, shooterRole]);

  useEffect(() => {
    if (profileView) drawProfile();
    else draw();
  }, [draw, drawProfile, profileView]);

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (targetManeuver !== 'custom') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const worldX = ((px - cx) / scale) * NM_TO_M;
    const worldY = (-(py - cy) / scale) * NM_TO_M;
    addTargetWaypoint({ x: worldX, y: worldY });
  }

  return (
    <div style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        onClick={handleCanvasClick}
        style={{
          border: '1px solid #1a3a1a',
          cursor: targetManeuver === 'custom' ? 'crosshair' : 'default',
          display: 'block',
        }}
      />
      <button
        onClick={() => setProfileView(v => !v)}
        style={{
          position: 'absolute', top: 6, right: 6,
          background: profileView ? 'rgba(0,180,80,0.18)' : 'rgba(0,0,0,0.5)',
          border: `1px solid ${profileView ? '#00ff80' : '#2a4a2a'}`,
          color: profileView ? '#00ff80' : '#4a8a4a',
          cursor: 'pointer', fontSize: 9,
          fontFamily: 'Share Tech Mono, monospace',
          padding: '2px 6px',
        }}
      >{profileView ? '[PROFILE]' : '[PLAN]'} P</button>
      {targetManeuver === 'custom' && (
        <div style={{ position: 'absolute', top: 6, left: 6, color: '#ffaa00', fontSize: 10, fontFamily: 'Share Tech Mono, monospace' }}>
          CLICK TO SET WAYPOINTS
          <button
            onClick={() => clearTargetWaypoints()}
            style={{ marginLeft: 8, background: 'transparent', border: '1px solid #555', color: '#aaa', cursor: 'pointer', fontSize: 9 }}
          >CLEAR</button>
        </div>
      )}
    </div>
  );
}

function drawAircraft(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  headingDeg: number,
  color: string,
  _icon: string,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((headingDeg * Math.PI) / 180);

  // Simple aircraft silhouette
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;

  // Body
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(0, 8);
  ctx.stroke();

  // Wings
  ctx.beginPath();
  ctx.moveTo(-7, 2);
  ctx.lineTo(7, 2);
  ctx.stroke();

  // Tail
  ctx.beginPath();
  ctx.moveTo(-4, 8);
  ctx.lineTo(4, 8);
  ctx.stroke();

  ctx.restore();
}

function drawSamSite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;

  // Launcher pad (filled square)
  ctx.fillRect(x - 6, y - 5, 12, 10);

  // Upright launcher arm
  ctx.beginPath();
  ctx.moveTo(x, y - 5);
  ctx.lineTo(x, y - 14);
  ctx.stroke();

  // Missile tip (small circle)
  ctx.beginPath();
  ctx.arc(x, y - 16, 2.5, 0, 2 * Math.PI);
  ctx.fill();

  ctx.restore();
}

function drawVelocityVector(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  vx: number,
  vy: number,
  scale: number,
  color: string,
) {
  const vecLen = 5; // seconds of projection
  const ex = x + (vx * M_TO_NM * scale * vecLen);
  const ey = y - (vy * M_TO_NM * scale * vecLen);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(ex, ey);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function energyToColor(energy: number): string {
  if (energy > 0.6) return '#00ff80';
  if (energy > 0.3) return '#ffaa00';
  return '#ff3333';
}
