import { useState, useEffect, useCallback, useMemo } from 'react';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';
import PartOrientationTool from './PartOrientationTool';
import BuildPlateScene, { type BuildPlatePart } from './BuildPlateScene';
import { autoLayout, type PartFootprint } from './AutoLayoutEngine';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface BuildPlanFile {
  id: string;
  fileName: string;
  fileUrl: string;
}

export interface BuildPlanMachine {
  id: string;
  name: string;
  type: string;
  buildVolume: { x: number; y: number; z: number };
}

export interface PlacedPartPlan {
  fileId: string;
  position: [number, number, number];
  rotation: [number, number, number];
}

export interface BuildPlate {
  machineId: string;
  machineName: string;
  parts: PlacedPartPlan[];
}

export interface BuildPlan {
  plates: BuildPlate[];
}

export interface BuildPlatePlannerProps {
  files: BuildPlanFile[];
  machines: BuildPlanMachine[];
  onBuildPlanChange: (plan: BuildPlan | null) => void;
}

/* ------------------------------------------------------------------ */
/*  Internal state types                                               */
/* ------------------------------------------------------------------ */

interface PartState {
  fileId: string;
  fileName: string;
  geometry: THREE.BufferGeometry | null;
  rotation: [number, number, number];
  machineId: string;
  footprint: { width: number; depth: number; height: number } | null;
}

interface PlateResult {
  machineId: string;
  machineName: string;
  buildVolume: { x: number; y: number; z: number };
  parts: Array<{
    fileId: string;
    position: [number, number, number];
    rotation: [number, number, number];
    geometry: THREE.BufferGeometry;
  }>;
}

/* ------------------------------------------------------------------ */
/*  Steps                                                              */
/* ------------------------------------------------------------------ */

type Step = 'orient' | 'assign' | 'layout';

const STEP_LABELS: Record<Step, string> = {
  orient: '1. Orient Parts',
  assign: '2. Assign Machines',
  layout: '3. Review Layout',
};

const STEPS: Step[] = ['orient', 'assign', 'layout'];

/* ------------------------------------------------------------------ */
/*  Helper: compute bounding box from geometry + rotation              */
/* ------------------------------------------------------------------ */

function getRotatedBounds(
  geometry: THREE.BufferGeometry,
  rotation: [number, number, number],
): { width: number; depth: number; height: number } {
  const geo = geometry.clone();
  const euler = new THREE.Euler(...rotation);
  const mat = new THREE.Matrix4().makeRotationFromEuler(euler);
  geo.applyMatrix4(mat);
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const size = new THREE.Vector3();
  box.getSize(size);
  geo.dispose();
  return { width: size.x, depth: size.z, height: size.y };
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function BuildPlatePlanner({
  files,
  machines,
  onBuildPlanChange,
}: BuildPlatePlannerProps) {
  const [step, setStep] = useState<Step>('orient');
  const [parts, setParts] = useState<PartState[]>([]);
  const [loadingGeometries, setLoadingGeometries] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [plates, setPlates] = useState<PlateResult[]>([]);
  const [activePlateIndex, setActivePlateIndex] = useState(0);
  const [orientPartIndex, setOrientPartIndex] = useState(0);

  const defaultMachineId = machines[0]?.id ?? '';

  // Load STL geometries for all files
  useEffect(() => {
    if (files.length === 0) return;
    setLoadingGeometries(true);
    setLoadError(null);

    const loader = new STLLoader();
    const promises = files.map(
      (f) =>
        new Promise<{ fileId: string; geometry: THREE.BufferGeometry }>((resolve, reject) => {
          loader.load(
            f.fileUrl,
            (geo) => {
              geo.computeBoundingBox();
              geo.center();
              resolve({ fileId: f.id, geometry: geo });
            },
            undefined,
            () => reject(new Error(`Failed to load ${f.fileName}`)),
          );
        }),
    );

    Promise.all(promises)
      .then((results) => {
        const initial: PartState[] = results.map((r) => {
          const file = files.find((f) => f.id === r.fileId)!;
          const rotation: [number, number, number] = [0, 0, 0];
          const footprint = getRotatedBounds(r.geometry, rotation);
          return {
            fileId: r.fileId,
            fileName: file.fileName,
            geometry: r.geometry,
            rotation,
            machineId: defaultMachineId,
            footprint,
          };
        });
        setParts(initial);
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoadingGeometries(false));
  }, [files, defaultMachineId]);

  // Update footprint when rotation changes
  const updatePartRotation = useCallback(
    (index: number, rotation: [number, number, number]) => {
      setParts((prev) => {
        const next = [...prev];
        const part = { ...next[index] };
        part.rotation = rotation;
        if (part.geometry) {
          part.footprint = getRotatedBounds(part.geometry, rotation);
        }
        next[index] = part;
        return next;
      });
    },
    [],
  );

  const updatePartMachine = useCallback((index: number, machineId: string) => {
    setParts((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], machineId };
      return next;
    });
  }, []);

  // Auto-layout: group parts by machine, run layout, handle overflow to extra plates
  const runAutoLayout = useCallback(() => {
    const byMachine = new Map<string, PartState[]>();
    for (const part of parts) {
      if (!part.geometry || !part.footprint) continue;
      const list = byMachine.get(part.machineId) || [];
      list.push(part);
      byMachine.set(part.machineId, list);
    }

    const newPlates: PlateResult[] = [];

    for (const [machineId, machineParts] of byMachine) {
      const machine = machines.find((m) => m.id === machineId);
      if (!machine) continue;

      const { x: plateWidth, y: plateDepth } = machine.buildVolume;

      // Build footprints for the layout engine
      let remaining: Array<{ part: PartState; footprint: PartFootprint }> = machineParts.map(
        (p) => ({
          part: p,
          footprint: {
            id: p.fileId,
            width: p.footprint!.width,
            depth: p.footprint!.depth,
            height: p.footprint!.height,
          },
        }),
      );

      let plateNum = 0;
      while (remaining.length > 0) {
        plateNum++;
        const result = autoLayout(
          remaining.map((r) => r.footprint),
          plateWidth,
          plateDepth,
        );

        const placedIds = new Set(result.placed.map((p) => p.id));
        const plateParts = remaining
          .filter((r) => placedIds.has(r.footprint.id))
          .map((r) => {
            const placed = result.placed.find((p) => p.id === r.footprint.id)!;
            // Position: center-relative to plate
            // autoLayout returns positions from top-left corner, convert to center-origin
            const posX = placed.x + placed.width / 2 - plateWidth / 2;
            const posZ = placed.y + placed.depth / 2 - plateDepth / 2;
            return {
              fileId: r.part.fileId,
              position: [posX, 0, posZ] as [number, number, number],
              rotation: r.part.rotation,
              geometry: r.part.geometry!,
            };
          });

        newPlates.push({
          machineId: machine.id,
          machineName: `${machine.name}${plateNum > 1 ? ` (Plate ${plateNum})` : ''}`,
          buildVolume: machine.buildVolume,
          parts: plateParts,
        });

        // Overflow becomes remaining for next plate
        const overflowIds = new Set(result.overflow.map((o) => o.id));
        remaining = remaining.filter((r) => overflowIds.has(r.footprint.id));

        // Safety: if nothing was placed, break to avoid infinite loop
        if (result.placed.length === 0) {
          break;
        }
      }
    }

    setPlates(newPlates);
    setActivePlateIndex(0);

    // Build the plan output
    const plan: BuildPlan = {
      plates: newPlates.map((plate) => ({
        machineId: plate.machineId,
        machineName: plate.machineName,
        parts: plate.parts.map((p) => ({
          fileId: p.fileId,
          position: p.position,
          rotation: p.rotation,
        })),
      })),
    };
    onBuildPlanChange(plan);
  }, [parts, machines, onBuildPlanChange]);

  // Run layout when entering layout step
  const goToStep = useCallback(
    (next: Step) => {
      if (next === 'layout') {
        runAutoLayout();
      }
      setStep(next);
    },
    [runAutoLayout],
  );

  const stepIndex = STEPS.indexOf(step);
  const canGoBack = stepIndex > 0;
  const canGoNext = stepIndex < STEPS.length - 1;

  // Build scene parts for the active plate preview
  const sceneParts: BuildPlatePart[] = useMemo(() => {
    const plate = plates[activePlateIndex];
    if (!plate) return [];
    const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'];
    return plate.parts.map((p, i) => ({
      id: p.fileId,
      geometry: p.geometry,
      position: p.position,
      rotation: p.rotation,
      color: colors[i % colors.length],
    }));
  }, [plates, activePlateIndex]);

  const activePlate = plates[activePlateIndex];

  // Loading / error states
  if (loadingGeometries) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500 mr-3" />
        Loading 3D models...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="bg-red-50 text-red-700 p-4 rounded-lg text-sm">
        {loadError}
      </div>
    );
  }

  if (parts.length === 0 || machines.length === 0) {
    return (
      <div className="text-gray-500 text-sm p-4">
        {parts.length === 0
          ? 'No STL files available for build planning.'
          : 'No machines configured. Add machines in your printer profile.'}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Step indicator */}
      <div className="flex gap-1">
        {STEPS.map((s, i) => (
          <button
            key={s}
            onClick={() => goToStep(s)}
            className={`flex-1 text-xs py-2 px-1 rounded-lg font-medium transition-colors ${
              s === step
                ? 'bg-indigo-600 text-white'
                : i < stepIndex
                  ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                  : 'bg-gray-100 text-gray-500'
            }`}
          >
            {STEP_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Step content */}
      {step === 'orient' && (
        <div className="space-y-4">
          {parts.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {parts.map((p, i) => (
                <button
                  key={p.fileId}
                  onClick={() => setOrientPartIndex(i)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-lg border text-sm font-mono truncate max-w-[160px] transition-colors ${
                    i === orientPartIndex
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                  title={p.fileName}
                >
                  {p.fileName}
                </button>
              ))}
            </div>
          )}
          {parts[orientPartIndex]?.geometry && (
            <div>
              <p className="text-sm text-gray-600 mb-2">
                Rotate the part or click "Select Bottom Face" to choose which face sits on the build plate.
              </p>
              <PartOrientationTool
                geometry={parts[orientPartIndex].geometry!}
                rotation={parts[orientPartIndex].rotation}
                onRotationChange={(r) => updatePartRotation(orientPartIndex, r)}
              />
              {parts[orientPartIndex].footprint && (
                <div className="mt-2 text-xs text-gray-500">
                  Footprint: {parts[orientPartIndex].footprint!.width.toFixed(1)} x{' '}
                  {parts[orientPartIndex].footprint!.depth.toFixed(1)} mm, Height:{' '}
                  {parts[orientPartIndex].footprint!.height.toFixed(1)} mm
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {step === 'assign' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Assign each part to a machine. Parts on the same machine will be auto-arranged together.
          </p>
          {parts.map((part, i) => (
            <div key={part.fileId} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              <span className="text-sm font-mono truncate flex-1" title={part.fileName}>
                {part.fileName}
              </span>
              <select
                value={part.machineId}
                onChange={(e) => updatePartMachine(i, e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.type}) — {m.buildVolume.x}x{m.buildVolume.y}mm
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {step === 'layout' && (
        <div className="space-y-3">
          {plates.length === 0 ? (
            <div className="text-gray-500 text-sm">
              No layout generated. Go back and ensure parts are assigned to machines.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  {plates.length} plate{plates.length !== 1 ? 's' : ''} across{' '}
                  {new Set(plates.map((p) => p.machineId)).size} machine
                  {new Set(plates.map((p) => p.machineId)).size !== 1 ? 's' : ''}
                </p>
                <button
                  type="button"
                  onClick={runAutoLayout}
                  className="px-3 py-1.5 text-sm bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition-colors"
                >
                  Re-arrange
                </button>
              </div>

              {plates.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {plates.map((plate, i) => (
                    <button
                      key={`${plate.machineId}-${i}`}
                      onClick={() => setActivePlateIndex(i)}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                        i === activePlateIndex
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {plate.machineName} ({plate.parts.length} part
                      {plate.parts.length !== 1 ? 's' : ''})
                    </button>
                  ))}
                </div>
              )}

              {activePlate && (
                <div>
                  <div className="text-sm font-medium text-gray-700 mb-1">
                    {activePlate.machineName} — {activePlate.parts.length} part
                    {activePlate.parts.length !== 1 ? 's' : ''}
                  </div>
                  <div className="w-full h-72 bg-gray-50 rounded-lg border overflow-hidden">
                    <BuildPlateScene
                      plateWidth={activePlate.buildVolume.x}
                      plateDepth={activePlate.buildVolume.y}
                      plateHeight={activePlate.buildVolume.z}
                      parts={sceneParts}
                    />
                  </div>
                  <div className="mt-2 text-xs text-gray-500">
                    Build volume: {activePlate.buildVolume.x} x {activePlate.buildVolume.y} x{' '}
                    {activePlate.buildVolume.z} mm
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <button
          type="button"
          onClick={() => goToStep(STEPS[stepIndex - 1])}
          disabled={!canGoBack}
          className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Back
        </button>
        {canGoNext ? (
          <button
            type="button"
            onClick={() => goToStep(STEPS[stepIndex + 1])}
            className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
          >
            Next
          </button>
        ) : (
          <div className="text-sm text-green-600 font-medium flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Plan ready
          </div>
        )}
      </div>
    </div>
  );
}
