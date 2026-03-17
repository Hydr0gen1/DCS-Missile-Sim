/**
 * TacticalDisplay3D — 3D engagement visualization using React Three Fiber.
 *
 * Coordinate mapping from world (meters) → Three.js:
 *   world X  → scene X  (east)
 *   world Y  → scene Z  (north, negated because Three.js Z points toward camera)
 *   altFt * FT_TO_M → scene Y (up)
 */
import { useRef, useMemo, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Line, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { useSimStore } from '../store/simStore';
import { M_TO_NM, NM_TO_M } from '../physics/atmosphere';

const FT_TO_M = 0.3048;

/** Convert world coords to Three.js scene coords */
function worldTo3D(x: number, y: number, altFt: number): [number, number, number] {
  return [x, altFt * FT_TO_M, -y];
}

/** Build a circle of points on a horizontal plane at given y */
function circlePoints(cx: number, cy: number, r: number, y: number, segments = 64): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * 2 * Math.PI;
    pts.push([cx + Math.cos(a) * r, y, cy + Math.sin(a) * r]);
  }
  return pts;
}

/** Aircraft mesh — simple elongated body + wings */
function AircraftMesh({ color }: { color: string }) {
  return (
    <group>
      {/* Fuselage */}
      <mesh>
        <cylinderGeometry args={[120, 120, 1800, 6]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {/* Wings */}
      <mesh position={[0, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <boxGeometry args={[3200, 120, 500]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
}

/** One 3D entity that updates its position + rotation each frame */
function AircraftEntity({
  pos,
  headingDeg,
  color,
}: {
  pos: [number, number, number];
  headingDeg: number;
  color: string;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (!groupRef.current) return;
    groupRef.current.position.set(...pos);
    // Heading in world coords: 0=north(+Y), 90=east(+X)
    // In 3D: north = -Z, east = +X → heading rotates around Y axis
    groupRef.current.rotation.set(0, -(headingDeg * Math.PI) / 180, 0);
  });

  return (
    <group ref={groupRef}>
      <AircraftMesh color={color} />
    </group>
  );
}

/** Missile arrow — elongated cone pointing in flight direction */
function MissileEntity({ pos, vx, vy }: { pos: [number, number, number]; vx: number; vy: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const headingDeg = (Math.atan2(vx, vy) * 180) / Math.PI;

  useFrame(() => {
    if (!groupRef.current) return;
    groupRef.current.position.set(...pos);
    groupRef.current.rotation.set(0, -(headingDeg * Math.PI) / 180, 0);
  });

  return (
    <group ref={groupRef}>
      {/* Body */}
      <mesh>
        <cylinderGeometry args={[50, 50, 1200, 6]} />
        <meshStandardMaterial color="#ff8800" />
      </mesh>
      {/* Nose cone */}
      <mesh position={[0, 700, 0]}>
        <coneGeometry args={[80, 400, 6]} />
        <meshStandardMaterial color="#ffbb44" />
      </mesh>
    </group>
  );
}

function SceneContent() {
  const { simFrames, currentFrameIdx, simStatus, maxRangeM, minRangeM, nezM, rangeNm, aspectAngleDeg } = useSimStore();
  const frame = simFrames[currentFrameIdx];

  // Default positions when idle
  const shooterAlt = frame?.shooter.altFt ?? 25000;
  const targetAlt  = frame?.target.altFt  ?? 25000;
  const missileAlt = frame?.missile.altFt  ?? 25000;

  const sx = frame?.shooter.x ?? 0;
  const sy = frame?.shooter.y ?? 0;
  const tx = frame?.target.x  ?? (rangeNm * NM_TO_M * Math.sin((aspectAngleDeg * Math.PI) / 180));
  const ty = frame?.target.y  ?? (rangeNm * NM_TO_M * Math.cos((aspectAngleDeg * Math.PI) / 180));
  const mx = frame?.missile.x ?? sx;
  const my = frame?.missile.y ?? sy;

  const shooterPos = worldTo3D(sx, sy, shooterAlt);
  const targetPos  = worldTo3D(tx, ty, targetAlt);
  const missilePos = worldTo3D(mx, my, missileAlt);

  // Missile trail
  const trailPoints: [number, number, number][] = useMemo(() => {
    if (!frame || frame.missile.trail.length < 2) return [];
    return frame.missile.trail.map(({ x, y }) => worldTo3D(x, y, frame.missile.altFt));
  }, [frame]);

  // Range rings projected on ground plane (Y=0)
  const rMaxPts = useMemo(() => circlePoints(tx, -ty, maxRangeM, 0), [tx, ty, maxRangeM]);
  const nezPts  = useMemo(() => circlePoints(tx, -ty, nezM,    0), [tx, ty, nezM]);
  const rMinPts = useMemo(() => circlePoints(tx, -ty, minRangeM, 0), [tx, ty, minRangeM]);

  // Altitude poles (vertical lines from aircraft to ground)
  const shooterPole: [number, number, number][] = [[shooterPos[0], 0, shooterPos[2]], [shooterPos[0], shooterPos[1], shooterPos[2]]];
  const targetPole:  [number, number, number][] = [[targetPos[0],  0, targetPos[2]],  [targetPos[0],  targetPos[1],  targetPos[2]]];
  const missilePole: [number, number, number][] = [[missilePos[0], 0, missilePos[2]], [missilePos[0], missilePos[1], missilePos[2]]];

  const showRings = simStatus !== 'idle' && maxRangeM > 0;

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.7} />
      <directionalLight position={[50000, 80000, 30000]} intensity={0.8} />

      {/* Ground grid */}
      <Grid
        args={[600000, 600000]}
        cellSize={NM_TO_M * 10}
        cellColor="#1a3a1a"
        sectionColor="#0d1e0d"
        fadeDistance={300000}
        fadeStrength={1}
        infiniteGrid
      />

      {/* Range rings */}
      {showRings && maxRangeM > 0 && (
        <Line points={rMaxPts} color="#00ff50" lineWidth={1.5} />
      )}
      {showRings && nezM > 0 && (
        <Line points={nezPts} color="#ffaa00" lineWidth={1.5} dashed dashSize={1000} gapSize={600} />
      )}
      {showRings && minRangeM > 0 && (
        <Line points={rMinPts} color="#ff3333" lineWidth={1} />
      )}

      {/* Altitude poles */}
      <Line points={shooterPole} color="#00aaff" lineWidth={0.5} />
      <Line points={targetPole}  color="#ff4444" lineWidth={0.5} />
      {frame && <Line points={missilePole} color="#ff8800" lineWidth={0.5} />}

      {/* Shooter */}
      <AircraftEntity
        pos={shooterPos}
        headingDeg={frame?.shooter.headingDeg ?? 0}
        color="#00aaff"
      />

      {/* Target */}
      <AircraftEntity
        pos={targetPos}
        headingDeg={frame?.target.headingDeg ?? 180}
        color="#ff4444"
      />

      {/* Missile */}
      {frame && (
        <MissileEntity
          pos={missilePos}
          vx={frame.missile.vx}
          vy={frame.missile.vy}
        />
      )}

      {/* Missile trail */}
      {trailPoints.length >= 2 && (
        <Line points={trailPoints} color="#ff8800" lineWidth={2} />
      )}

      {/* Camera */}
      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        target={[(sx + tx) / 2, Math.max(shooterAlt, targetAlt) * FT_TO_M * 0.5, -((sy + ty) / 2)]}
      />
    </>
  );
}

function HUDOverlay() {
  const { simFrames, currentFrameIdx } = useSimStore();
  const frame = simFrames[currentFrameIdx];
  if (!frame) return null;

  const cv = frame.closingVelocity;
  const tti = frame.timeToImpact < 9999 ? `${frame.timeToImpact.toFixed(1)}s` : '---';
  const closNm = (cv * 1.94384).toFixed(0);
  const energy = frame.missile.energy;
  const energyColor = energy > 0.6 ? '#00ff80' : energy > 0.3 ? '#ffaa00' : '#ff3333';

  return (
    <div style={hud.overlay}>
      <div style={hud.row}><span style={hud.dim}>T+</span>{frame.time.toFixed(1)}s</div>
      <div style={hud.row}><span style={hud.dim}>CLS </span>{closNm}kt</div>
      <div style={hud.row}><span style={hud.dim}>TTI </span>{tti}</div>
      <div style={{ ...hud.row, color: energyColor }}>
        <span style={hud.dim}>NRG </span>{(energy * 100).toFixed(0)}%
      </div>
      <div style={hud.row}>
        <span style={hud.dim}>MSL </span>{Math.round(frame.missile.altFt).toLocaleString()}ft
      </div>
      <div style={hud.row}>
        <span style={{ color: '#00aaff' }}>SHT </span>{Math.round(frame.shooter.altFt).toLocaleString()}ft
      </div>
      <div style={hud.row}>
        <span style={{ color: '#ff4444' }}>TGT </span>{Math.round(frame.target.altFt).toLocaleString()}ft
      </div>
    </div>
  );
}

const hud: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'absolute',
    top: 8,
    left: 8,
    background: 'rgba(4,10,4,0.8)',
    border: '1px solid #1a3a1a',
    padding: '5px 8px',
    fontFamily: 'Share Tech Mono, monospace',
    fontSize: 10,
    color: '#00ff80',
    pointerEvents: 'none',
    lineHeight: 1.7,
  },
  row: {
    display: 'block',
  },
  dim: {
    color: '#446644',
  },
};

export default function TacticalDisplay3D() {
  return (
    <div style={{ position: 'relative', width: 700, height: 700, flexShrink: 0 }}>
      <Canvas
        style={{ background: '#060a10' }}
        camera={{ position: [0, 25000, -80000], fov: 55, near: 10, far: 2000000 }}
        gl={{ antialias: true }}
      >
        <Suspense fallback={null}>
          <SceneContent />
        </Suspense>
      </Canvas>
      <HUDOverlay />
      <div style={{
        position: 'absolute',
        bottom: 6,
        left: 6,
        fontSize: 8,
        color: '#334433',
        fontFamily: 'Share Tech Mono, monospace',
        pointerEvents: 'none',
      }}>
        DRAG=ORBIT  SCROLL=ZOOM  RMB=PAN
      </div>
    </div>
  );
}
