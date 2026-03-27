import { useRef, useCallback, useMemo } from 'react';
import { Canvas, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface BuildPlatePart {
  id: string;
  geometry: THREE.BufferGeometry;
  position: [number, number, number];
  rotation: [number, number, number];
  color?: string;
  isColliding?: boolean;
  isOutOfBounds?: boolean;
}

export interface BuildPlateSceneProps {
  plateWidth: number; // mm
  plateDepth: number; // mm
  plateHeight: number; // mm
  parts: BuildPlatePart[];
  onPartClick?: (partId: string) => void;
  interactive?: boolean; // reserved for future drag support
}

/* ------------------------------------------------------------------ */
/*  Collision / bounds detection helpers                                */
/* ------------------------------------------------------------------ */

interface AABB {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

function getWorldAABB(
  geometry: THREE.BufferGeometry,
  position: [number, number, number],
  rotation: [number, number, number],
): AABB {
  const euler = new THREE.Euler(...rotation);
  const matrix = new THREE.Matrix4().makeRotationFromEuler(euler);
  matrix.setPosition(...position);

  const cloned = geometry.clone();
  cloned.applyMatrix4(matrix);
  cloned.computeBoundingBox();

  const box = cloned.boundingBox!;
  cloned.dispose();

  return { min: box.min, max: box.max };
}

function aabbOverlap(a: AABB, b: AABB, gap: number = 0): boolean {
  return (
    a.min.x - gap < b.max.x &&
    a.max.x + gap > b.min.x &&
    a.min.y - gap < b.max.y &&
    a.max.y + gap > b.min.y &&
    a.min.z - gap < b.max.z &&
    a.max.z + gap > b.min.z
  );
}

/**
 * Detect which parts collide with each other or are out of the plate bounds.
 */
export function detectIssues(
  parts: BuildPlatePart[],
  plateWidth: number,
  plateDepth: number,
  plateHeight: number,
): { colliding: Set<string>; outOfBounds: Set<string> } {
  const colliding = new Set<string>();
  const outOfBounds = new Set<string>();

  const boxes: Array<{ id: string; aabb: AABB }> = parts.map((p) => ({
    id: p.id,
    aabb: getWorldAABB(p.geometry, p.position, p.rotation),
  }));

  // Plate bounds (origin at center-bottom of plate)
  const halfW = plateWidth / 2;
  const halfD = plateDepth / 2;

  for (const { id, aabb } of boxes) {
    if (
      aabb.min.x < -halfW ||
      aabb.max.x > halfW ||
      aabb.min.z < -halfD ||
      aabb.max.z > halfD ||
      aabb.min.y < 0 ||
      aabb.max.y > plateHeight
    ) {
      outOfBounds.add(id);
    }
  }

  // Pairwise collision
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (aabbOverlap(boxes[i].aabb, boxes[j].aabb)) {
        colliding.add(boxes[i].id);
        colliding.add(boxes[j].id);
      }
    }
  }

  return { colliding, outOfBounds };
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function PlateBox({
  width,
  depth,
  height,
}: {
  width: number;
  depth: number;
  height: number;
}) {
  return (
    <group>
      {/* Semi-transparent plate body */}
      <mesh position={[0, -0.5, 0]}>
        <boxGeometry args={[width, 1, depth]} />
        <meshStandardMaterial
          color="#94a3b8"
          transparent
          opacity={0.25}
        />
      </mesh>

      {/* Wireframe outline for the build volume */}
      <lineSegments position={[0, height / 2, 0]}>
        <edgesGeometry
          args={[new THREE.BoxGeometry(width, height, depth)]}
        />
        <lineBasicMaterial color="#64748b" linewidth={1} />
      </lineSegments>
    </group>
  );
}

function PartMesh({
  part,
  onClick,
}: {
  part: BuildPlatePart;
  onClick?: (partId: string) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  const hasIssue = part.isColliding || part.isOutOfBounds;
  const color = hasIssue ? '#ef4444' : (part.color ?? '#6366f1');

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      onClick?.(part.id);
    },
    [onClick, part.id],
  );

  return (
    <mesh
      ref={meshRef}
      geometry={part.geometry}
      position={part.position}
      rotation={part.rotation}
      onClick={handleClick}
    >
      <meshStandardMaterial
        color={color}
        metalness={0.1}
        roughness={0.6}
        transparent={hasIssue}
        opacity={hasIssue ? 0.7 : 1}
      />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/*  Main scene component                                               */
/* ------------------------------------------------------------------ */

function SceneContent({
  plateWidth,
  plateDepth,
  plateHeight,
  parts,
  onPartClick,
}: BuildPlateSceneProps) {
  // Camera distance based on plate size
  const camDist = useMemo(
    () => Math.max(plateWidth, plateDepth, plateHeight) * 1.5,
    [plateWidth, plateDepth, plateHeight],
  );

  return (
    <>
      <perspectiveCamera position={[camDist * 0.6, camDist * 0.5, camDist * 0.6]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[camDist, camDist, camDist * 0.5]} intensity={1} />
      <directionalLight position={[-camDist * 0.5, camDist * 0.3, -camDist]} intensity={0.3} />

      {/* Build plate */}
      <PlateBox width={plateWidth} depth={plateDepth} height={plateHeight} />

      {/* Grid on plate surface */}
      <Grid
        args={[plateWidth, plateDepth]}
        position={[0, 0.01, 0]}
        cellSize={10}
        cellThickness={0.5}
        cellColor="#cbd5e1"
        sectionSize={50}
        sectionThickness={1}
        sectionColor="#94a3b8"
        fadeDistance={plateWidth * 2}
        infiniteGrid={false}
      />

      {/* Parts */}
      {parts.map((part) => (
        <PartMesh key={part.id} part={part} onClick={onPartClick} />
      ))}

      <OrbitControls
        enableDamping
        dampingFactor={0.1}
        target={[0, plateHeight * 0.25, 0]}
      />
    </>
  );
}

export default function BuildPlateScene(props: BuildPlateSceneProps) {
  const camDist = Math.max(props.plateWidth, props.plateDepth, props.plateHeight) * 1.5;

  return (
    <Canvas
      camera={{
        position: [camDist * 0.6, camDist * 0.5, camDist * 0.6],
        fov: 50,
        near: 0.1,
        far: camDist * 10,
      }}
      style={{ width: '100%', height: '100%' }}
    >
      <SceneContent {...props} />
    </Canvas>
  );
}
