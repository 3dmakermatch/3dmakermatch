import { useState, useRef, useCallback, useMemo } from 'react';
import { Canvas, useThree, ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface PartOrientationToolProps {
  geometry: THREE.BufferGeometry;
  rotation: [number, number, number];
  onRotationChange: (rotation: [number, number, number]) => void;
  onSelectBottomFace?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helper: compute rotation to align a face normal to -Y             */
/* ------------------------------------------------------------------ */

function computeDownwardRotation(
  faceNormal: THREE.Vector3,
  currentRotation: [number, number, number],
): [number, number, number] {
  // We want to rotate the part so that `faceNormal` (in object space)
  // ends up pointing in the -Y direction (downward) in world space.
  //
  // First, apply current rotation to get the world-space normal.
  const currentEuler = new THREE.Euler(...currentRotation);
  const currentQuat = new THREE.Quaternion().setFromEuler(currentEuler);
  const worldNormal = faceNormal.clone().applyQuaternion(currentQuat).normalize();

  // Compute quaternion that rotates worldNormal to -Y
  const down = new THREE.Vector3(0, -1, 0);
  const alignQuat = new THREE.Quaternion().setFromUnitVectors(worldNormal, down);

  // Compose: alignQuat * currentQuat
  const finalQuat = alignQuat.multiply(currentQuat);
  const finalEuler = new THREE.Euler().setFromQuaternion(finalQuat, 'XYZ');

  return [finalEuler.x, finalEuler.y, finalEuler.z];
}

/* ------------------------------------------------------------------ */
/*  3D mesh with optional face-picking raycaster                       */
/* ------------------------------------------------------------------ */

function OrientableMesh({
  geometry,
  rotation,
  selectingFace,
  onFaceSelected,
}: {
  geometry: THREE.BufferGeometry;
  rotation: [number, number, number];
  selectingFace: boolean;
  onFaceSelected: (normal: THREE.Vector3) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { gl } = useThree();

  // Ensure the geometry has computed data we need
  const preparedGeometry = useMemo(() => {
    const geo = geometry.clone();
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.center();
    return geo;
  }, [geometry]);

  // Change cursor when in face-select mode
  useMemo(() => {
    gl.domElement.style.cursor = selectingFace ? 'crosshair' : 'auto';
  }, [selectingFace, gl.domElement.style]);

  const handleClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      if (!selectingFace) return;
      event.stopPropagation();

      const intersection = event.intersections[0];
      if (!intersection || intersection.face == null) return;

      // Get the face normal in object space
      const faceNormal = intersection.face.normal.clone();
      onFaceSelected(faceNormal);
    },
    [selectingFace, onFaceSelected],
  );

  return (
    <mesh
      ref={meshRef}
      geometry={preparedGeometry}
      rotation={rotation}
      onClick={handleClick}
    >
      <meshStandardMaterial
        color={selectingFace ? '#818cf8' : '#6366f1'}
        metalness={0.1}
        roughness={0.6}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/*  Scene content                                                      */
/* ------------------------------------------------------------------ */

function SceneContent({
  geometry,
  rotation,
  selectingFace,
  onFaceSelected,
}: {
  geometry: THREE.BufferGeometry;
  rotation: [number, number, number];
  selectingFace: boolean;
  onFaceSelected: (normal: THREE.Vector3) => void;
}) {
  // Estimate camera distance from geometry bounds
  const camDist = useMemo(() => {
    const geo = geometry.clone();
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    const size = new THREE.Vector3();
    box.getSize(size);
    geo.dispose();
    return Math.max(size.x, size.y, size.z) * 2;
  }, [geometry]);

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[camDist, camDist, camDist * 0.5]} intensity={1} />
      <directionalLight position={[-camDist * 0.3, camDist * 0.5, -camDist]} intensity={0.3} />

      <OrientableMesh
        geometry={geometry}
        rotation={rotation}
        selectingFace={selectingFace}
        onFaceSelected={onFaceSelected}
      />

      {/* Reference ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -camDist * 0.3, 0]}>
        <planeGeometry args={[camDist * 2, camDist * 2]} />
        <meshStandardMaterial color="#e2e8f0" transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>

      <OrbitControls enableDamping dampingFactor={0.1} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Rotation slider                                                    */
/* ------------------------------------------------------------------ */

function RotationSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const degrees = Math.round((value * 180) / Math.PI) % 360;
  const displayDegrees = degrees < 0 ? degrees + 360 : degrees;

  return (
    <div className="flex items-center gap-2">
      <label className="w-8 text-sm font-medium text-gray-600">{label}</label>
      <input
        type="range"
        min={0}
        max={360}
        value={displayDegrees}
        onChange={(e) => {
          const deg = Number(e.target.value);
          onChange((deg * Math.PI) / 180);
        }}
        className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-500"
      />
      <span className="w-10 text-right text-xs text-gray-500 tabular-nums">
        {displayDegrees}&deg;
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function PartOrientationTool({
  geometry,
  rotation,
  onRotationChange,
  onSelectBottomFace,
}: PartOrientationToolProps) {
  const [selectingFace, setSelectingFace] = useState(false);

  const handleAxisChange = useCallback(
    (axis: 0 | 1 | 2, value: number) => {
      const next: [number, number, number] = [...rotation];
      next[axis] = value;
      onRotationChange(next);
    },
    [rotation, onRotationChange],
  );

  const handleFaceSelected = useCallback(
    (normal: THREE.Vector3) => {
      const newRotation = computeDownwardRotation(normal, rotation);
      onRotationChange(newRotation);
      setSelectingFace(false);
      onSelectBottomFace?.();
    },
    [rotation, onRotationChange, onSelectBottomFace],
  );

  const handleSelectBottomFaceClick = useCallback(() => {
    setSelectingFace((prev) => !prev);
  }, []);

  // Camera distance for canvas
  const camDist = useMemo(() => {
    const geo = geometry.clone();
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    const size = new THREE.Vector3();
    box.getSize(size);
    geo.dispose();
    return Math.max(size.x, size.y, size.z) * 2;
  }, [geometry]);

  return (
    <div className="flex flex-col gap-3">
      {/* 3D Preview */}
      <div className="w-full h-64 bg-gray-50 rounded-lg border overflow-hidden">
        <Canvas
          camera={{
            position: [camDist * 0.6, camDist * 0.5, camDist * 0.6],
            fov: 50,
            near: 0.1,
            far: camDist * 10,
          }}
        >
          <SceneContent
            geometry={geometry}
            rotation={rotation}
            selectingFace={selectingFace}
            onFaceSelected={handleFaceSelected}
          />
        </Canvas>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-2 px-1">
        <RotationSlider
          label="X"
          value={rotation[0]}
          onChange={(v) => handleAxisChange(0, v)}
        />
        <RotationSlider
          label="Y"
          value={rotation[1]}
          onChange={(v) => handleAxisChange(1, v)}
        />
        <RotationSlider
          label="Z"
          value={rotation[2]}
          onChange={(v) => handleAxisChange(2, v)}
        />
      </div>

      {/* Bottom Face Selection */}
      <button
        type="button"
        onClick={handleSelectBottomFaceClick}
        className={`
          w-full px-4 py-2 text-sm font-medium rounded-lg transition-colors
          ${
            selectingFace
              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
          }
        `}
      >
        {selectingFace ? 'Click a face on the model...' : 'Select Bottom Face'}
      </button>
    </div>
  );
}
