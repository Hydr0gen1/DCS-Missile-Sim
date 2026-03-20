/**
 * TacticalDisplay3D — polished 3D engagement visualization.
 *
 * Coordinate mapping: world (m) → Three.js scene
 *   world X (east)  → scene X
 *   world Y (north) → scene -Z
 *   altFt           → scene Y  (via FT_TO_M)
 *
 * Shooter sits at origin. Target starts down the -Z axis.
 * Free-fly camera: WASD/QE to move, hold LMB + drag to look.
 */
import { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { useSimStore } from '../store/simStore';
import { M_TO_NM, NM_TO_M } from '../physics/atmosphere';

const FT_TO_M = 0.3048;

function worldTo3D(x: number, y: number, altFt: number): [number, number, number] {
  return [x, altFt * FT_TO_M, -y];
}

function circlePoints(cx: number, cz: number, r: number, y: number, segments = 80): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * 2 * Math.PI;
    pts.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]);
  }
  return pts;
}

// ─── Aircraft dot ────────────────────────────────────────────────────────────

function AircraftEntity({ pos, color }: { pos: [number, number, number]; color: string }) {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame(() => { if (meshRef.current) meshRef.current.position.set(...pos); });
  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[150, 12, 12]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
    </mesh>
  );
}

// ─── Ground launcher dot ──────────────────────────────────────────────────────

function GroundLauncherEntity({ pos }: { pos: [number, number, number] }) {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame(() => { if (meshRef.current) meshRef.current.position.set(...pos); });
  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[200, 150, 200]} />
      <meshStandardMaterial color="#00aaff" emissive="#004488" emissiveIntensity={0.4} />
    </mesh>
  );
}

// ─── Missile cone ─────────────────────────────────────────────────────────────
// ConeGeometry tip (+Y default) rotated to point along the 3-D velocity vector.

const _up = new THREE.Vector3(0, 1, 0);
const _vel = new THREE.Vector3();

function MissileEntity({ pos, vx, vy, vz }: {
  pos: [number, number, number]; vx: number; vy: number; vz: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!meshRef.current) return;
    meshRef.current.position.set(...pos);
    // Three.js coords: X=east(vx), Y=up(vz), -Z=north(vy)
    _vel.set(vx, vz, -vy);
    if (_vel.length() > 0.1) {
      meshRef.current.quaternion.setFromUnitVectors(_up, _vel.normalize());
    }
  });

  return (
    <mesh ref={meshRef}>
      <coneGeometry args={[60, 200, 16]} />
      <meshStandardMaterial color="#ff8800" emissive="#ff4400" emissiveIntensity={0.8} />
    </mesh>
  );
}

// ─── Ground grid (manual lines — more robust than drei Grid) ─────────────────

function GroundGrid({ rangeM }: { rangeM: number }) {
  const lines = useMemo(() => {
    const stepMinor = NM_TO_M * 5;   // 5 nm minor
    const stepMajor = NM_TO_M * 20;  // 20 nm major
    const extent = Math.max(rangeM * 2.5, NM_TO_M * 60);
    const count = Math.ceil(extent / stepMinor);
    const result: Array<{ pts: [number, number, number][]; major: boolean }> = [];
    for (let i = -count; i <= count; i++) {
      const pos = i * stepMinor;
      const major = Math.round(pos / stepMajor) * stepMajor === Math.round(pos) * 1 ||
        Math.abs(pos % stepMajor) < 100;
      result.push({ pts: [[pos, 1, -extent], [pos, 1, extent]], major });
      result.push({ pts: [[-extent, 1, pos], [extent, 1, pos]], major });
    }
    return result;
  }, [rangeM]);

  return (
    <>
      {lines.map(({ pts, major }, i) => (
        <Line key={i} points={pts} color={major ? '#1a4a1a' : '#0d2a0d'} lineWidth={major ? 1 : 0.5} />
      ))}
    </>
  );
}

// ─── Free-fly camera ─────────────────────────────────────────────────────────

const MOVE_SPEED = 400; // m/s base move speed
const LOOK_SENSITIVITY = 0.002;

function FlyCamera({ initialPos, lookAt }: { initialPos: THREE.Vector3; lookAt: THREE.Vector3 }) {
  const { camera, gl } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const isDragging = useRef(false);
  const yaw = useRef(0);
  const pitch = useRef(0);
  const initialized = useRef(false);

  // Set initial camera position + orientation once
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    camera.position.copy(initialPos);
    // Compute initial yaw/pitch from lookAt
    const dir = new THREE.Vector3().subVectors(lookAt, initialPos).normalize();
    yaw.current = Math.atan2(dir.x, -dir.z);
    pitch.current = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw.current;
    camera.rotation.x = pitch.current;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = gl.domElement;

    const onKeyDown = (e: KeyboardEvent) => { keys.current[e.code] = true; };
    const onKeyUp   = (e: KeyboardEvent) => { keys.current[e.code] = false; };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) isDragging.current = true;
    };
    const onMouseUp = () => { isDragging.current = false; };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      yaw.current   -= e.movementX * LOOK_SENSITIVITY;
      pitch.current -= e.movementY * LOOK_SENSITIVITY;
      pitch.current = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch.current));
      camera.rotation.order = 'YXZ';
      camera.rotation.y = yaw.current;
      camera.rotation.x = pitch.current;
    };

    const onWheel = (e: WheelEvent) => {
      const fwd = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
      camera.position.addScaledVector(fwd, -e.deltaY * 20);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('wheel', onWheel, { passive: true });

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [camera, gl]);

  useFrame((_, delta) => {
    const speed = MOVE_SPEED * (keys.current['ShiftLeft'] || keys.current['ShiftRight'] ? 8 : 1);
    const fwd   = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
    const right = new THREE.Vector3(1, 0, 0).applyEuler(camera.rotation);
    const up    = new THREE.Vector3(0, 1, 0);

    if (keys.current['KeyW'] || keys.current['ArrowUp'])   camera.position.addScaledVector(fwd,   speed * delta);
    if (keys.current['KeyS'] || keys.current['ArrowDown']) camera.position.addScaledVector(fwd,  -speed * delta);
    if (keys.current['KeyA'] || keys.current['ArrowLeft']) camera.position.addScaledVector(right,-speed * delta);
    if (keys.current['KeyD'] || keys.current['ArrowRight'])camera.position.addScaledVector(right, speed * delta);
    if (keys.current['KeyQ'] || keys.current['PageDown'])  camera.position.addScaledVector(up,   -speed * delta);
    if (keys.current['KeyE'] || keys.current['PageUp'])    camera.position.addScaledVector(up,    speed * delta);
  });

  return null;
}

// ─── Main scene ──────────────────────────────────────────────────────────────

function SceneContent() {
  const {
    simFrames, currentFrameIdx, simStatus,
    maxRangeM, minRangeM, nezM,
    rangeNm, aspectAngleDeg, shooterRole,
    shooterAlt: storeShooterAlt,
    targetAlt: storeTargetAlt,
  } = useSimStore();

  const frame = simFrames[currentFrameIdx];

  const shooterAlt = frame?.shooter.altFt ?? storeShooterAlt;
  const targetAlt  = frame?.target.altFt  ?? storeTargetAlt;
  const missileAlt = frame?.missile.altFt  ?? 0;

  const sx = frame?.shooter.x ?? 0;
  const sy = frame?.shooter.y ?? 0;
  const tx = frame?.target.x  ?? (rangeNm * NM_TO_M * Math.sin((aspectAngleDeg * Math.PI) / 180));
  const ty = frame?.target.y  ?? (rangeNm * NM_TO_M * Math.cos((aspectAngleDeg * Math.PI) / 180));
  const mx = frame?.missiles[0]?.x ?? frame?.missile.x ?? sx;
  const my = frame?.missiles[0]?.y ?? frame?.missile.y ?? sy;

  const shooterPos = worldTo3D(sx, sy, shooterAlt);
  const targetPos  = worldTo3D(tx, ty, targetAlt);
  const missilePos = worldTo3D(mx, my, missileAlt);

  // Missile trail with altitude-aware points (lead missile)
  const trailPoints: [number, number, number][] = useMemo(() => {
    const lead = frame?.missiles?.[0] ?? frame?.missile;
    if (!lead || lead.trail.length < 2) return [];
    return lead.trail.map(({ x, y, alt }) => worldTo3D(x, y, alt));
  }, [frame]);

  // Range rings on ground (centered on target start position)
  const targetStartZ = -(rangeNm * NM_TO_M * Math.cos((aspectAngleDeg * Math.PI) / 180));
  const targetStartX =   rangeNm * NM_TO_M * Math.sin((aspectAngleDeg * Math.PI) / 180);

  const rMaxPts = useMemo(() => circlePoints(targetStartX, targetStartZ, maxRangeM, 2), [targetStartX, targetStartZ, maxRangeM]);
  const nezPts  = useMemo(() => circlePoints(targetStartX, targetStartZ, nezM,      2), [targetStartX, targetStartZ, nezM]);
  const rMinPts = useMemo(() => circlePoints(targetStartX, targetStartZ, minRangeM, 2), [targetStartX, targetStartZ, minRangeM]);

  const showRings = simStatus !== 'idle' && maxRangeM > 0;

  // Altitude poles
  const shooterPole: [number, number, number][] = [[shooterPos[0], 0, shooterPos[2]], shooterPos];
  const targetPole:  [number, number, number][] = [[targetPos[0],  0, targetPos[2]],  targetPos];
  const missilePole: [number, number, number][] = [[missilePos[0], 0, missilePos[2]], missilePos];

  // Initial camera: side-on view showing full engagement
  const rangeM = rangeNm * NM_TO_M;
  const midAltM = targetAlt * FT_TO_M * 0.5;
  const initialCamPos = useMemo(() =>
    new THREE.Vector3(-rangeM * 0.55, Math.max(midAltM + 8000, 15000), -rangeM * 0.1),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const lookAtPt = useMemo(() =>
    new THREE.Vector3(0, midAltM, -rangeM * 0.5),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[80000, 120000, 60000]} intensity={1.0} castShadow />
      <hemisphereLight args={['#0a1a3a', '#0a1a0a', 0.4]} />

      {/* Ground grid */}
      <GroundGrid rangeM={rangeM} />

      {/* Range rings */}
      {showRings && maxRangeM > 0 && <Line points={rMaxPts} color="#00ff50" lineWidth={2} />}
      {showRings && nezM > 0       && <Line points={nezPts}  color="#ffaa00" lineWidth={1.5} dashed dashSize={NM_TO_M * 0.5} gapSize={NM_TO_M * 0.3} />}
      {showRings && minRangeM > 0  && <Line points={rMinPts} color="#ff3333" lineWidth={1} />}

      {/* Shooter-to-target engagement line (on ground) */}
      {showRings && (
        <Line
          points={[[0, 1, 0], [targetStartX, 1, targetStartZ]]}
          color="#224422"
          lineWidth={1}
          dashed
          dashSize={NM_TO_M * 0.8}
          gapSize={NM_TO_M * 0.4}
        />
      )}

      {/* Altitude poles */}
      <Line points={shooterPole} color="#4488ff" lineWidth={0.8} />
      <Line points={targetPole}  color="#ff6644" lineWidth={0.8} />
      {frame && <Line points={missilePole} color="#ff8800" lineWidth={0.6} />}

      {/* Shooter */}
      {shooterRole === 'ground'
        ? <GroundLauncherEntity pos={[shooterPos[0], 0, shooterPos[2]]} />
        : <AircraftEntity pos={shooterPos} color="#00aaff" />
      }

      {/* Target */}
      <AircraftEntity pos={targetPos} color="#ff4444" />

      {/* Missiles (all salvo) */}
      {frame && (frame.missiles ?? [frame.missile]).map((msl, mi) => {
        if (mi > 0 && !msl.motorBurning && !msl.active && msl.speedMs < 1) return null;
        const mPos = worldTo3D(msl.x, msl.y, msl.altFt);
        return (
          <MissileEntity key={mi} pos={mPos} vx={msl.vx} vy={msl.vy} vz={msl.vz} />
        );
      })}

      {/* Missile trail */}
      {trailPoints.length >= 2 && (
        <Line points={trailPoints} color="#ff8800" lineWidth={2.5} />
      )}

      {/* Countermeasures (flares = yellow, chaff = cyan) */}
      {frame?.countermeasures?.map((cm) => {
        const cmPos = worldTo3D(cm.x, cm.y, cm.altFt);
        const color = cm.type === 'flare' ? '#ffee44' : '#44ccff';
        return (
          <mesh key={cm.id} position={cmPos}>
            <boxGeometry args={[30, 30, 30]} />
            <meshBasicMaterial color={color} transparent opacity={cm.opacity * 0.9} />
          </mesh>
        );
      })}

      {/* Free camera */}
      <FlyCamera initialPos={initialCamPos} lookAt={lookAtPt} />
    </>
  );
}

// ─── HUD overlay ─────────────────────────────────────────────────────────────

function HUDOverlay() {
  const { simFrames, currentFrameIdx, simStatus, simResult } = useSimStore();
  const frame = simFrames[currentFrameIdx];

  const isDone = simStatus === 'hit' || simStatus === 'miss';

  return (
    <div style={hud.overlay}>
      {frame ? (
        <>
          <div style={hud.row}><span style={hud.dim}>T+ </span>{frame.time.toFixed(1)}<span style={hud.unit}>s</span></div>
          <div style={hud.row}><span style={hud.dim}>CLS </span>{(frame.closingVelocity * 1.94384).toFixed(0)}<span style={hud.unit}>kt</span></div>
          <div style={hud.row}><span style={hud.dim}>TTI </span>{frame.timeToImpact < 9999 ? `${frame.timeToImpact.toFixed(1)}s` : '---'}</div>
          <div style={{ ...hud.row, color: energyColor((frame.missiles?.[0] ?? frame.missile).energy) }}>
            <span style={hud.dim}>NRG </span>{((frame.missiles?.[0] ?? frame.missile).energy * 100).toFixed(0)}<span style={hud.unit}>%</span>
          </div>
          <div style={hud.sep} />
          <div style={hud.row}><span style={hud.dim}>MSL </span>{Math.round((frame.missiles?.[0] ?? frame.missile).altFt).toLocaleString()}<span style={hud.unit}>ft</span></div>
          <div style={{ ...hud.row, color: '#4488ff' }}><span style={hud.dim}>SHT </span>{Math.round(frame.shooter.altFt).toLocaleString()}<span style={hud.unit}>ft</span></div>
          <div style={{ ...hud.row, color: '#ff6644' }}><span style={hud.dim}>TGT </span>{Math.round(frame.target.altFt).toLocaleString()}<span style={hud.unit}>ft</span></div>
          <div style={hud.row}><span style={hud.dim}>RNG </span>{(frame.range * M_TO_NM).toFixed(1)}<span style={hud.unit}>nm</span></div>
        </>
      ) : (
        <div style={{ color: '#334433', fontSize: 9 }}>AWAITING SIM</div>
      )}
      {isDone && simResult && (
        <>
          <div style={hud.sep} />
          <div style={{ color: simStatus === 'hit' ? '#00ff80' : '#ff4444', letterSpacing: 1 }}>
            {simResult.verdict}
          </div>
          {simResult.pk > 0 && (
            <div style={hud.row}><span style={hud.dim}>Pk </span>{(simResult.pk * 100).toFixed(0)}<span style={hud.unit}>%</span></div>
          )}
        </>
      )}
      <div style={hud.sep} />
      <div style={{ color: '#223322', fontSize: 8, lineHeight: 1.8 }}>
        LMB+DRAG LOOK<br />WASD MOVE<br />QE UP/DN<br />SHIFT FAST<br />SCROLL ZOOM
      </div>
    </div>
  );
}

function energyColor(e: number): string {
  if (e > 0.6) return '#00ff80';
  if (e > 0.3) return '#ffaa00';
  return '#ff3333';
}

const hud: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'absolute',
    top: 8,
    left: 8,
    background: 'rgba(2,6,2,0.85)',
    border: '1px solid #1a3a1a',
    padding: '6px 9px',
    fontFamily: 'Share Tech Mono, monospace',
    fontSize: 11,
    color: '#00ff80',
    pointerEvents: 'none',
    lineHeight: 1.8,
    backdropFilter: 'blur(2px)',
  },
  row: { display: 'block' },
  dim: { color: '#336633' },
  unit: { color: '#557755', fontSize: 9 },
  sep: { height: 5, borderBottom: '1px solid #1a3a1a', marginBottom: 4, marginTop: 2 },
};

// ─── Compass rose overlay ─────────────────────────────────────────────────────

function CompassOverlay() {
  return (
    <div style={{
      position: 'absolute', top: 8, right: 8,
      background: 'rgba(2,6,2,0.75)',
      border: '1px solid #1a3a1a',
      padding: '5px 8px',
      fontFamily: 'Share Tech Mono, monospace',
      fontSize: 9, color: '#336633',
      pointerEvents: 'none',
      lineHeight: 1.8,
    }}>
      <div style={{ color: '#00ff80', letterSpacing: 1, marginBottom: 2 }}>ORIENT</div>
      <div>N ↑ -Z</div>
      <div>E → +X</div>
      <div>↑ ALT +Y</div>
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export default function TacticalDisplay3D() {
  return (
    <div style={{ position: 'relative', width: 700, height: 700, flexShrink: 0 }}>
      <Canvas
        style={{ background: 'linear-gradient(to bottom, #040810 0%, #060d06 60%, #080c08 100%)' }}
        camera={{ fov: 65, near: 10, far: 3000000 }}
        gl={{ antialias: true }}
      >
        <SceneContent />
      </Canvas>
      <HUDOverlay />
      <CompassOverlay />
    </div>
  );
}
