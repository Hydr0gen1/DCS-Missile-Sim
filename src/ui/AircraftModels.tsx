/**
 * AircraftModels — distinct 3D meshes for every aircraft and SAM in the sim.
 *
 * All dimensions are in scene units (≈ meters). Models are intentionally
 * oversized (~100–200×) for visibility at engagement ranges of 20–65 nm.
 * Each model targets a recognizable silhouette from above/side.
 *
 * Scale reference (all models):
 *   fuselage length ≈ 4 000–7 000 u  (real: 14–22 m)
 *   wingspan        ≈ 6 000–18 000 u  (real: 10–18 m)
 *   height          ≈ 800–2 000 u
 */
import * as THREE from 'three';

// ─── helper ──────────────────────────────────────────────────────────────────

function mat(color: string, emissive = '#000000', emissiveIntensity = 0) {
  return (
    <meshStandardMaterial
      color={color}
      emissive={emissive}
      emissiveIntensity={emissiveIntensity}
    />
  );
}

// ─── AIRCRAFT ────────────────────────────────────────────────────────────────

/** F-16C Viper — single engine, cropped delta, side intake blister, single tail */
export function F16Mesh({ color }: { color: string }) {
  return (
    <group>
      {/* Fuselage */}
      <mesh><cylinderGeometry args={[180, 260, 4800, 8]} />{mat(color)}</mesh>
      {/* Nose cone */}
      <mesh position={[0, 2600, 0]}><coneGeometry args={[180, 1300, 8]} />{mat(color)}</mesh>
      {/* Side intake blister (left) */}
      <mesh position={[-260, -400, 0]}><boxGeometry args={[220, 400, 1400]} />{mat(color)}</mesh>
      {/* Delta wing — swept trapezoidal */}
      <mesh position={[0, -100, -200]} rotation={[0, 0, 0]}>
        <boxGeometry args={[7800, 100, 2400]} />
        {mat(color)}
      </mesh>
      {/* Wing leading edge sweep (left) */}
      <mesh position={[-3400, -100, 700]} rotation={[0, 0.55, 0]}>
        <boxGeometry args={[2000, 100, 600]} />{mat(color)}
      </mesh>
      {/* Wing leading edge sweep (right) */}
      <mesh position={[3400, -100, 700]} rotation={[0, -0.55, 0]}>
        <boxGeometry args={[2000, 100, 600]} />{mat(color)}
      </mesh>
      {/* Leading-edge strake (LERX) left */}
      <mesh position={[-600, 0, 800]} rotation={[0, 0.9, 0]}>
        <boxGeometry args={[800, 80, 1200]} />{mat(color)}
      </mesh>
      {/* LERX right */}
      <mesh position={[600, 0, 800]} rotation={[0, -0.9, 0]}>
        <boxGeometry args={[800, 80, 1200]} />{mat(color)}
      </mesh>
      {/* Horizontal tail */}
      <mesh position={[0, -80, -1900]}>
        <boxGeometry args={[3600, 80, 900]} />{mat(color)}
      </mesh>
      {/* Single vertical tail */}
      <mesh position={[0, 900, -1800]}>
        <boxGeometry args={[120, 1800, 1100]} />{mat(color)}
      </mesh>
      {/* Engine nozzle */}
      <mesh position={[0, -2500, 0]}>
        <cylinderGeometry args={[220, 220, 180, 10]} />
        {mat('#ff6600', '#ff3300', 0.7)}
      </mesh>
    </group>
  );
}

/** F/A-18C Hornet — twin engines, twin canted tails, LERX, trapezoidal wing */
export function FA18Mesh({ color }: { color: string }) {
  return (
    <group>
      {/* Fuselage */}
      <mesh><cylinderGeometry args={[220, 280, 5200, 8]} />{mat(color)}</mesh>
      {/* Nose */}
      <mesh position={[0, 2800, 0]}><coneGeometry args={[220, 1200, 8]} />{mat(color)}</mesh>
      {/* Large LERX — left */}
      <mesh position={[-700, 80, 600]} rotation={[0, 0.7, 0]}>
        <boxGeometry args={[2800, 120, 2200]} />{mat(color)}
      </mesh>
      {/* Large LERX — right */}
      <mesh position={[700, 80, 600]} rotation={[0, -0.7, 0]}>
        <boxGeometry args={[2800, 120, 2200]} />{mat(color)}
      </mesh>
      {/* Trapezoidal wing */}
      <mesh position={[0, -80, -300]}>
        <boxGeometry args={[8400, 100, 2800]} />{mat(color)}
      </mesh>
      {/* Horizontal stabilizer */}
      <mesh position={[0, -60, -2200]}>
        <boxGeometry args={[5800, 80, 1200]} />{mat(color)}
      </mesh>
      {/* Twin vertical tails — canted outward ~20° */}
      <mesh position={[-1800, 1000, -1800]} rotation={[0, 0, -0.35]}>
        <boxGeometry args={[160, 2000, 1200]} />{mat(color)}
      </mesh>
      <mesh position={[1800, 1000, -1800]} rotation={[0, 0, 0.35]}>
        <boxGeometry args={[160, 2000, 1200]} />{mat(color)}
      </mesh>
      {/* Twin engines */}
      <mesh position={[-900, -2600, 0]}>
        <cylinderGeometry args={[200, 200, 180, 10]} />
        {mat('#ff6600', '#ff3300', 0.7)}
      </mesh>
      <mesh position={[900, -2600, 0]}>
        <cylinderGeometry args={[200, 200, 180, 10]} />
        {mat('#ff6600', '#ff3300', 0.7)}
      </mesh>
    </group>
  );
}

/** F-15C Eagle — twin engines wide-spaced, twin vertical tails, large rectangular wing */
export function F15Mesh({ color }: { color: string }) {
  return (
    <group>
      {/* Fuselage — wide and flat (twin-engine) */}
      <mesh><boxGeometry args={[1200, 600, 6200]} />{mat(color)}</mesh>
      {/* Nose */}
      <mesh position={[0, 0, 3300]} rotation={[Math.PI / 2, 0, 0]}><coneGeometry args={[300, 1400, 8]} />{mat(color)}</mesh>
      {/* Large rectangular wing */}
      <mesh position={[0, -100, -200]}>
        <boxGeometry args={[10800, 100, 3200]} />{mat(color)}
      </mesh>
      {/* Wing leading edge cranked (left) */}
      <mesh position={[-4600, -100, 900]} rotation={[0, 0.4, 0]}>
        <boxGeometry args={[2800, 100, 700]} />{mat(color)}
      </mesh>
      <mesh position={[4600, -100, 900]} rotation={[0, -0.4, 0]}>
        <boxGeometry args={[2800, 100, 700]} />{mat(color)}
      </mesh>
      {/* Horizontal stabilizer */}
      <mesh position={[0, -80, -2600]}>
        <boxGeometry args={[6400, 80, 1400]} />{mat(color)}
      </mesh>
      {/* Twin vertical tails — near-vertical */}
      <mesh position={[-1400, 900, -2000]}>
        <boxGeometry args={[160, 2200, 1400]} />{mat(color)}
      </mesh>
      <mesh position={[1400, 900, -2000]}>
        <boxGeometry args={[160, 2200, 1400]} />{mat(color)}
      </mesh>
      {/* Engine twin nacelles */}
      <mesh position={[-1600, -300, -2400]}>
        <cylinderGeometry args={[320, 320, 3200, 10]} />{mat(color)}
      </mesh>
      <mesh position={[1600, -300, -2400]}>
        <cylinderGeometry args={[320, 320, 3200, 10]} />{mat(color)}
      </mesh>
      {/* Exhausts */}
      <mesh position={[-1600, -300, -4000]}>
        <cylinderGeometry args={[310, 310, 180, 10]} />
        {mat('#ff6600', '#ff3300', 0.7)}
      </mesh>
      <mesh position={[1600, -300, -4000]}>
        <cylinderGeometry args={[310, 310, 180, 10]} />
        {mat('#ff6600', '#ff3300', 0.7)}
      </mesh>
    </group>
  );
}

/** A-10C Thunderbolt II — wide straight wings, rear engines, twin tails, GAU-8 */
export function A10CMesh({ color }: { color: string }) {
  return (
    <group>
      {/* Fuselage */}
      <mesh><boxGeometry args={[900, 700, 5200]} />{mat(color)}</mesh>
      {/* Nose taper with gun */}
      <mesh position={[0, -80, 2800]}>
        <cylinderGeometry args={[120, 350, 1200, 6]} />{mat(color)}
      </mesh>
      {/* GAU-8 barrel */}
      <mesh position={[0, -200, 3600]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[60, 60, 900, 8]} />{mat('#303030')}
      </mesh>
      {/* Very wide straight wings */}
      <mesh position={[0, -120, 400]}>
        <boxGeometry args={[17200, 200, 2800]} />{mat(color)}
      </mesh>
      {/* Wing tips */}
      <mesh position={[-8200, -120, 600]} rotation={[0, 0.12, 0]}>
        <boxGeometry args={[2000, 180, 700]} />{mat(color)}
      </mesh>
      <mesh position={[8200, -120, 600]} rotation={[0, -0.12, 0]}>
        <boxGeometry args={[2000, 180, 700]} />{mat(color)}
      </mesh>
      {/* Engine nacelle left (rear fuselage sides) */}
      <mesh position={[-1800, 600, -1200]}>
        <cylinderGeometry args={[420, 380, 3400, 10]} />
        {mat(color === '#ff4444' ? '#cc3333' : '#0088cc')}
      </mesh>
      <mesh position={[1800, 600, -1200]}>
        <cylinderGeometry args={[420, 380, 3400, 10]} />
        {mat(color === '#ff4444' ? '#cc3333' : '#0088cc')}
      </mesh>
      {/* Engine exhausts */}
      <mesh position={[-1800, 600, -2900]}>
        <cylinderGeometry args={[360, 360, 180, 10]} />
        {mat('#ff6600', '#ff3300', 0.8)}
      </mesh>
      <mesh position={[1800, 600, -2900]}>
        <cylinderGeometry args={[360, 360, 180, 10]} />
        {mat('#ff6600', '#ff3300', 0.8)}
      </mesh>
      {/* Twin tail booms */}
      <mesh position={[-2600, 200, -2200]}>
        <boxGeometry args={[400, 300, 2200]} />{mat(color)}
      </mesh>
      <mesh position={[2600, 200, -2200]}>
        <boxGeometry args={[400, 300, 2200]} />{mat(color)}
      </mesh>
      {/* Vertical stabilizers */}
      <mesh position={[-2600, 900, -3100]}>
        <boxGeometry args={[200, 1600, 1000]} />{mat(color)}
      </mesh>
      <mesh position={[2600, 900, -3100]}>
        <boxGeometry args={[200, 1600, 1000]} />{mat(color)}
      </mesh>
      {/* Horizontal stabilizer */}
      <mesh position={[0, 280, -3000]}>
        <boxGeometry args={[7000, 160, 1400]} />{mat(color)}
      </mesh>
    </group>
  );
}

/** Su-27 Flanker — twin engines, twin tails, long blended body, prominent LERX */
export function Su27Mesh({ color }: { color: string }) {
  return (
    <group>
      {/* Main fuselage */}
      <mesh><cylinderGeometry args={[260, 340, 6800, 8]} />{mat(color)}</mesh>
      {/* Broad flat center section */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[1800, 500, 4000]} />{mat(color)}
      </mesh>
      {/* Long pointed nose */}
      <mesh position={[0, 3800, 0]}><coneGeometry args={[260, 2200, 8]} />{mat(color)}</mesh>
      {/* Massive LERX left */}
      <mesh position={[-1200, 100, 1600]} rotation={[0, 0.75, 0]}>
        <boxGeometry args={[4200, 150, 3000]} />{mat(color)}
      </mesh>
      {/* LERX right */}
      <mesh position={[1200, 100, 1600]} rotation={[0, -0.75, 0]}>
        <boxGeometry args={[4200, 150, 3000]} />{mat(color)}
      </mesh>
      {/* Main wing */}
      <mesh position={[0, -100, -400]}>
        <boxGeometry args={[10800, 100, 3200]} />{mat(color)}
      </mesh>
      {/* Wing sweep */}
      <mesh position={[-4600, -100, 800]} rotation={[0, 0.5, 0]}>
        <boxGeometry args={[3000, 100, 800]} />{mat(color)}
      </mesh>
      <mesh position={[4600, -100, 800]} rotation={[0, -0.5, 0]}>
        <boxGeometry args={[3000, 100, 800]} />{mat(color)}
      </mesh>
      {/* Twin horizontal stabilizers (large) */}
      <mesh position={[0, -80, -2800]}>
        <boxGeometry args={[8200, 80, 2000]} />{mat(color)}
      </mesh>
      {/* Twin vertical tails */}
      <mesh position={[-2400, 1100, -2400]}>
        <boxGeometry args={[180, 2400, 1600]} />{mat(color)}
      </mesh>
      <mesh position={[2400, 1100, -2400]}>
        <boxGeometry args={[180, 2400, 1600]} />{mat(color)}
      </mesh>
      {/* Engine nacelles (widely spaced) */}
      <mesh position={[-2200, -200, -2000]}>
        <cylinderGeometry args={[360, 340, 4200, 10]} />{mat(color)}
      </mesh>
      <mesh position={[2200, -200, -2000]}>
        <cylinderGeometry args={[360, 340, 4200, 10]} />{mat(color)}
      </mesh>
      {/* Exhausts */}
      <mesh position={[-2200, -200, -4200]}>
        <cylinderGeometry args={[340, 340, 180, 10]} />
        {mat('#ff6600', '#ff4400', 0.8)}
      </mesh>
      <mesh position={[2200, -200, -4200]}>
        <cylinderGeometry args={[340, 340, 180, 10]} />
        {mat('#ff6600', '#ff4400', 0.8)}
      </mesh>
    </group>
  );
}

/** MiG-29 Fulcrum — twin engines close-set, twin canted tails, short LERX */
export function MiG29Mesh({ color }: { color: string }) {
  return (
    <group>
      {/* Fuselage */}
      <mesh><cylinderGeometry args={[220, 300, 5200, 8]} />{mat(color)}</mesh>
      {/* Nose */}
      <mesh position={[0, 2900, 0]}><coneGeometry args={[220, 1600, 8]} />{mat(color)}</mesh>
      {/* Center body */}
      <mesh position={[0, 0, 0]}><boxGeometry args={[1400, 400, 3000]} />{mat(color)}</mesh>
      {/* LERX left */}
      <mesh position={[-900, 80, 1100]} rotation={[0, 0.65, 0]}>
        <boxGeometry args={[2600, 120, 2000]} />{mat(color)}
      </mesh>
      {/* LERX right */}
      <mesh position={[900, 80, 1100]} rotation={[0, -0.65, 0]}>
        <boxGeometry args={[2600, 120, 2000]} />{mat(color)}
      </mesh>
      {/* Swept wing */}
      <mesh position={[0, -80, -200]}>
        <boxGeometry args={[8800, 100, 2600]} />{mat(color)}
      </mesh>
      <mesh position={[-3800, -80, 700]} rotation={[0, 0.52, 0]}>
        <boxGeometry args={[2200, 100, 700]} />{mat(color)}
      </mesh>
      <mesh position={[3800, -80, 700]} rotation={[0, -0.52, 0]}>
        <boxGeometry args={[2200, 100, 700]} />{mat(color)}
      </mesh>
      {/* Horizontal tail */}
      <mesh position={[0, -60, -2100]}>
        <boxGeometry args={[5800, 80, 1400]} />{mat(color)}
      </mesh>
      {/* Twin vertical tails — canted out slightly */}
      <mesh position={[-1600, 900, -1800]} rotation={[0, 0, -0.15]}>
        <boxGeometry args={[160, 2000, 1200]} />{mat(color)}
      </mesh>
      <mesh position={[1600, 900, -1800]} rotation={[0, 0, 0.15]}>
        <boxGeometry args={[160, 2000, 1200]} />{mat(color)}
      </mesh>
      {/* Engines close-set */}
      <mesh position={[-700, -200, -1800]}>
        <cylinderGeometry args={[280, 260, 3400, 10]} />{mat(color)}
      </mesh>
      <mesh position={[700, -200, -1800]}>
        <cylinderGeometry args={[280, 260, 3400, 10]} />{mat(color)}
      </mesh>
      <mesh position={[-700, -200, -3500]}>
        <cylinderGeometry args={[260, 260, 180, 10]} />
        {mat('#ff6600', '#ff4400', 0.8)}
      </mesh>
      <mesh position={[700, -200, -3500]}>
        <cylinderGeometry args={[260, 260, 180, 10]} />
        {mat('#ff6600', '#ff4400', 0.8)}
      </mesh>
    </group>
  );
}

/** JF-17 Thunder — single engine, delta-ish wing with LERX, side intake */
export function JF17Mesh({ color }: { color: string }) {
  return (
    <group>
      {/* Fuselage */}
      <mesh><cylinderGeometry args={[190, 260, 4800, 8]} />{mat(color)}</mesh>
      {/* Nose */}
      <mesh position={[0, 2600, 0]}><coneGeometry args={[190, 1400, 8]} />{mat(color)}</mesh>
      {/* Side intake (chin-style) */}
      <mesh position={[0, -320, 600]}><boxGeometry args={[600, 300, 1200]} />{mat(color)}</mesh>
      {/* LERX */}
      <mesh position={[-500, 60, 900]} rotation={[0, 0.8, 0]}>
        <boxGeometry args={[1400, 100, 1400]} />{mat(color)}
      </mesh>
      <mesh position={[500, 60, 900]} rotation={[0, -0.8, 0]}>
        <boxGeometry args={[1400, 100, 1400]} />{mat(color)}
      </mesh>
      {/* Delta wing */}
      <mesh position={[0, -80, -200]}>
        <boxGeometry args={[8200, 100, 2600]} />{mat(color)}
      </mesh>
      <mesh position={[-3400, -80, 900]} rotation={[0, 0.62, 0]}>
        <boxGeometry args={[2000, 100, 600]} />{mat(color)}
      </mesh>
      <mesh position={[3400, -80, 900]} rotation={[0, -0.62, 0]}>
        <boxGeometry args={[2000, 100, 600]} />{mat(color)}
      </mesh>
      {/* Small all-moving horizontal tail */}
      <mesh position={[0, -60, -2000]}>
        <boxGeometry args={[4200, 80, 900]} />{mat(color)}
      </mesh>
      {/* Single vertical tail */}
      <mesh position={[0, 900, -1700]}>
        <boxGeometry args={[140, 1900, 1200]} />{mat(color)}
      </mesh>
      {/* Engine */}
      <mesh position={[0, -2500, 0]}>
        <cylinderGeometry args={[230, 230, 180, 10]} />
        {mat('#ff6600', '#ff3300', 0.7)}
      </mesh>
    </group>
  );
}

/** Mirage 2000 — pure delta, no horizontal tail, single engine */
export function Mirage2000Mesh({ color }: { color: string }) {
  return (
    <group>
      {/* Fuselage */}
      <mesh><cylinderGeometry args={[180, 250, 4600, 8]} />{mat(color)}</mesh>
      {/* Pointed nose */}
      <mesh position={[0, 2600, 0]}><coneGeometry args={[180, 1800, 8]} />{mat(color)}</mesh>
      {/* Pure delta wing — huge, no horizontal tail */}
      <mesh position={[0, -60, -400]}>
        <boxGeometry args={[9200, 80, 3600]} />{mat(color)}
      </mesh>
      {/* Delta leading edge left */}
      <mesh position={[-3800, -60, 1100]} rotation={[0, 0.72, 0]}>
        <boxGeometry args={[3400, 80, 800]} />{mat(color)}
      </mesh>
      {/* Delta leading edge right */}
      <mesh position={[3800, -60, 1100]} rotation={[0, -0.72, 0]}>
        <boxGeometry args={[3400, 80, 800]} />{mat(color)}
      </mesh>
      {/* Small canards (Mirage 2000-5 style, subtle) */}
      <mesh position={[-600, 40, 1800]}>
        <boxGeometry args={[1200, 60, 400]} />{mat(color)}
      </mesh>
      <mesh position={[600, 40, 1800]}>
        <boxGeometry args={[1200, 60, 400]} />{mat(color)}
      </mesh>
      {/* Single vertical tail (tall) */}
      <mesh position={[0, 1000, -1800]}>
        <boxGeometry args={[120, 2200, 1400]} />{mat(color)}
      </mesh>
      {/* No horizontal stabilizer — pure delta */}
      {/* Engine nozzle */}
      <mesh position={[0, -2400, 0]}>
        <cylinderGeometry args={[230, 230, 180, 10]} />
        {mat('#ff6600', '#ff3300', 0.7)}
      </mesh>
    </group>
  );
}

/** Generic fighter fallback */
export function GenericFighterMesh({ color }: { color: string }) {
  return (
    <group>
      <mesh><cylinderGeometry args={[200, 260, 5000, 8]} />{mat(color)}</mesh>
      <mesh position={[0, 2900, 0]}><coneGeometry args={[200, 1400, 8]} />{mat(color)}</mesh>
      <mesh position={[0, -100, 0]}><boxGeometry args={[7800, 100, 2200]} />{mat(color)}</mesh>
      <mesh position={[-3200, -100, 700]} rotation={[0, 0.45, 0]}>
        <boxGeometry args={[2400, 100, 600]} />{mat(color)}
      </mesh>
      <mesh position={[3200, -100, 700]} rotation={[0, -0.45, 0]}>
        <boxGeometry args={[2400, 100, 600]} />{mat(color)}
      </mesh>
      <mesh position={[0, -80, -2200]}><boxGeometry args={[3600, 80, 900]} />{mat(color)}</mesh>
      <mesh position={[0, 1000, -2000]}><boxGeometry args={[120, 2000, 1100]} />{mat(color)}</mesh>
      <mesh position={[0, -2700, 0]}>
        <cylinderGeometry args={[240, 240, 180, 10]} />
        {mat('#ff6600', '#ff3300', 0.6)}
      </mesh>
    </group>
  );
}

/** Route to the right aircraft mesh by aircraft ID */
export function AircraftByType({ id, color }: { id: string; color: string }) {
  switch (id) {
    case 'f-16':    return <F16Mesh color={color} />;
    case 'fa-18':   return <FA18Mesh color={color} />;
    case 'f-15':    return <F15Mesh color={color} />;
    case 'a-10c':   return <A10CMesh color={color} />;
    case 'su-27':   return <Su27Mesh color={color} />;
    case 'mig-29':  return <MiG29Mesh color={color} />;
    case 'jf-17':   return <JF17Mesh color={color} />;
    case 'mirage':  return <Mirage2000Mesh color={color} />;
    default:        return <GenericFighterMesh color={color} />;
  }
}

// ─── SAM LAUNCHERS ───────────────────────────────────────────────────────────

/** S-300PS 5P85 TEL — 8-wheeled truck, 4 vertical canisters */
export function S300Mesh() {
  return (
    <group>
      <mesh><boxGeometry args={[3200, 1200, 9000]} />{mat('#1a3a1a')}</mesh>
      <mesh position={[0, 2200, 800]} rotation={[0.3, 0, 0]}>
        <boxGeometry args={[2400, 300, 6000]} />{mat('#2a5a2a')}
      </mesh>
      {([-900, -300, 300, 900] as number[]).map((xOff, i) => (
        <group key={i}>
          <mesh position={[xOff, 2600, 1200]} rotation={[0.3, 0, 0]}>
            <cylinderGeometry args={[260, 260, 5800, 8]} />{mat('#3a6a3a')}
          </mesh>
          <mesh position={[xOff, 3800, 3100]} rotation={[0.3, 0, 0]}>
            <coneGeometry args={[260, 600, 8]} />{mat('#00aaff')}
          </mesh>
        </group>
      ))}
      <mesh position={[0, 1800, -3500]}>
        <cylinderGeometry args={[800, 800, 200, 12]} />{mat('#555')}
      </mesh>
    </group>
  );
}

/** SA-11 Buk 9A310 TELAR — tracked, 4 missiles on angled rail */
export function SA11Mesh() {
  return (
    <group>
      {/* Tracked chassis */}
      <mesh position={[0, -400, 0]}><boxGeometry args={[3400, 800, 7000]} />{mat('#2a3a1a')}</mesh>
      {/* Track blocks */}
      {([-1800, 1800] as number[]).map((x, i) => (
        <mesh key={i} position={[x, -600, 0]}>
          <boxGeometry args={[400, 400, 7400]} />{mat('#1a2a10')}
        </mesh>
      ))}
      {/* Turret */}
      <mesh position={[0, 400, 0]}><boxGeometry args={[3000, 1000, 4000]} />{mat('#2a3a1a')}</mesh>
      {/* 4 missiles on launcher rail (angled 45°) */}
      {([-1100, -370, 370, 1100] as number[]).map((xOff, i) => (
        <group key={i}>
          <mesh position={[xOff, 1400, 600]} rotation={[-0.7, 0, 0]}>
            <cylinderGeometry args={[200, 200, 3600, 8]} />{mat('#3a5a2a')}
          </mesh>
          <mesh position={[xOff, 2600, -700]} rotation={[-0.7, 0, 0]}>
            <coneGeometry args={[200, 500, 8]} />{mat('#00aaff')}
          </mesh>
        </group>
      ))}
      {/* Radar dish on front */}
      <mesh position={[0, 1200, 2400]}>
        <boxGeometry args={[2000, 1800, 200]} />{mat('#555')}
      </mesh>
    </group>
  );
}

/** SA-6 Kub 2P25 — tracked, 3 missiles on horizontal rail launcher */
export function SA6Mesh() {
  return (
    <group>
      {/* Tracked chassis */}
      <mesh position={[0, -400, 0]}><boxGeometry args={[3000, 800, 6000]} />{mat('#2a3a1a')}</mesh>
      {([-1600, 1600] as number[]).map((x, i) => (
        <mesh key={i} position={[x, -600, 0]}>
          <boxGeometry args={[400, 400, 6400]} />{mat('#1a2a10')}
        </mesh>
      ))}
      {/* Launcher turret */}
      <mesh position={[0, 400, 0]}><cylinderGeometry args={[1400, 1400, 800, 8]} />{mat('#2a3a1a')}</mesh>
      {/* Launcher arm (angled 30°) */}
      <mesh position={[0, 1400, 200]} rotation={[-0.5, 0, 0]}>
        <boxGeometry args={[2200, 300, 5000]} />{mat('#3a5a2a')}
      </mesh>
      {/* 3 missiles on rail */}
      {([-800, 0, 800] as number[]).map((xOff, i) => (
        <group key={i}>
          <mesh position={[xOff, 2000, -200]} rotation={[-0.5, 0, 0]}>
            <cylinderGeometry args={[170, 170, 3600, 8]} />{mat('#3a6a3a')}
          </mesh>
          <mesh position={[xOff, 2800, -1800]} rotation={[-0.5, 0, 0]}>
            <coneGeometry args={[170, 400, 8]} />{mat('#00aaff')}
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** SA-15 Tor 9A331 — boxy tracked vehicle, 8 vertical missile cells */
export function SA15Mesh() {
  return (
    <group>
      {/* Tracked chassis */}
      <mesh position={[0, -400, 0]}><boxGeometry args={[3000, 800, 6000]} />{mat('#2a3a1a')}</mesh>
      {([-1600, 1600] as number[]).map((x, i) => (
        <mesh key={i} position={[x, -600, 0]}>
          <boxGeometry args={[400, 400, 6400]} />{mat('#1a2a10')}
        </mesh>
      ))}
      {/* Large boxy turret */}
      <mesh position={[0, 800, 0]}><boxGeometry args={[3200, 2000, 5000]} />{mat('#2a4a2a')}</mesh>
      {/* 8 missile cells (2 rows × 4) */}
      {([-1100, -370, 370, 1100] as number[]).map((xOff) =>
        ([-1000, 1000] as number[]).map((zOff, j) => (
          <group key={`${xOff}-${j}`}>
            <mesh position={[xOff, 1900, zOff]}>
              <boxGeometry args={[500, 1600, 500]} />{mat('#3a6a3a')}
            </mesh>
            {/* Missile nose peek */}
            <mesh position={[xOff, 2800, zOff]}>
              <coneGeometry args={[140, 300, 6]} />{mat('#00aaff')}
            </mesh>
          </group>
        ))
      )}
      {/* Radar (spinning plate on top) */}
      <mesh position={[0, 2000, 0]}>
        <boxGeometry args={[2400, 200, 1400]} />{mat('#777')}
      </mesh>
    </group>
  );
}

/** MANPAD (Igla-S / Stinger / Mistral) — soldier + tube */
export function ManpadMesh() {
  return (
    <group>
      {/* Operator torso */}
      <mesh position={[0, 600, 0]}>
        <cylinderGeometry args={[300, 300, 1200, 8]} />{mat('#3a5a3a')}
      </mesh>
      {/* Head */}
      <mesh position={[0, 1350, 0]}>
        <sphereGeometry args={[280, 8, 8]} />{mat('#3a5a3a')}
      </mesh>
      {/* Launch tube */}
      <mesh position={[0, 1000, 0]} rotation={[0.5, 0, 0]}>
        <cylinderGeometry args={[90, 90, 2400, 8]} />{mat('#4a6a4a')}
      </mesh>
      {/* Missile tip */}
      <mesh position={[0, 1600, -900]} rotation={[0.5, 0, 0]}>
        <coneGeometry args={[90, 300, 8]} />{mat('#00aaff')}
      </mesh>
    </group>
  );
}

/** Route to correct SAM model by missile ID */
export function SamByMissileId({ missileId }: { missileId: string }) {
  if (missileId === 's-300ps') return <S300Mesh />;
  if (missileId === 'sa-11')   return <SA11Mesh />;
  if (missileId === 'sa-6')    return <SA6Mesh />;
  if (missileId === 'sa-15')   return <SA15Mesh />;
  // MANPADs
  if (missileId === 'igla-s' || missileId === 'stinger' || missileId === 'mistral')
    return <ManpadMesh />;
  // Default — S-300 style for unknown SAMs
  return <S300Mesh />;
}
