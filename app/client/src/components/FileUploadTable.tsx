import { useCallback, useRef, useState } from 'react';

export interface MeshScanResult {
  triangleCount: number;
  isManifold: boolean;
  boundingBox?: { min: [number, number, number]; max: [number, number, number] };
  volume?: number;
}

export interface SelectedFile {
  file: File;
  included: boolean;
  status: 'ready' | 'too_large' | 'scanning' | 'needs_repair' | 'needs_simplification';
  errorMessage?: string;
  scanResult?: MeshScanResult;
  repairedFile?: File;
}

interface FileUploadTableProps {
  onFilesChange: (files: SelectedFile[]) => void;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const ACCEPTED_EXTENSIONS = ['.stl', '.3mf', '.obj'];
const HIGH_TRIANGLE_THRESHOLD = 1_000_000;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function getExtension(name: string): string {
  return name.slice(name.lastIndexOf('.')).toLowerCase();
}

function formatTriangleCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}K`;
  return `${count}`;
}

// ---------------------------------------------------------------------------
// STL binary parser
// ---------------------------------------------------------------------------
function parseStlBinary(
  buffer: ArrayBuffer,
): { vertProperties: Float32Array; triVerts: Uint32Array; numTri: number } | null {
  const view = new DataView(buffer);
  if (buffer.byteLength < 84) return null;

  const numTri = view.getUint32(80, true);
  const expectedSize = 84 + numTri * 50;
  if (buffer.byteLength < expectedSize) return null;

  const vertProperties = new Float32Array(numTri * 3 * 3);
  const triVerts = new Uint32Array(numTri * 3);

  let offset = 84;
  for (let i = 0; i < numTri; i++) {
    offset += 12; // skip normal
    for (let v = 0; v < 3; v++) {
      const vertIdx = i * 3 + v;
      vertProperties[vertIdx * 3 + 0] = view.getFloat32(offset, true);
      offset += 4;
      vertProperties[vertIdx * 3 + 1] = view.getFloat32(offset, true);
      offset += 4;
      vertProperties[vertIdx * 3 + 2] = view.getFloat32(offset, true);
      offset += 4;
      triVerts[i * 3 + v] = vertIdx;
    }
    offset += 2; // skip attribute byte count
  }

  return { vertProperties, triVerts, numTri };
}

// ---------------------------------------------------------------------------
// Write repaired mesh back to STL binary
// ---------------------------------------------------------------------------
function meshToStlBinary(
  vertProperties: Float32Array,
  triVerts: Uint32Array,
  numProp: number,
): ArrayBuffer {
  const numTri = triVerts.length / 3;
  const buffer = new ArrayBuffer(84 + numTri * 50);
  const view = new DataView(buffer);

  // 80-byte header (zeros) + triangle count
  view.setUint32(80, numTri, true);

  let offset = 84;
  for (let i = 0; i < numTri; i++) {
    // Normal (0,0,0 — slicers recalculate)
    view.setFloat32(offset, 0, true);
    offset += 4;
    view.setFloat32(offset, 0, true);
    offset += 4;
    view.setFloat32(offset, 0, true);
    offset += 4;

    for (let v = 0; v < 3; v++) {
      const vertIdx = triVerts[i * 3 + v];
      view.setFloat32(offset, vertProperties[vertIdx * numProp + 0], true);
      offset += 4;
      view.setFloat32(offset, vertProperties[vertIdx * numProp + 1], true);
      offset += 4;
      view.setFloat32(offset, vertProperties[vertIdx * numProp + 2], true);
      offset += 4;
    }

    // Attribute byte count
    view.setUint16(offset, 0, true);
    offset += 2;
  }

  return buffer;
}

// ---------------------------------------------------------------------------
// Mesh scanning via manifold-3d WASM (lazy-loaded)
// ---------------------------------------------------------------------------
async function scanMesh(file: File): Promise<MeshScanResult> {
  const buffer = await file.arrayBuffer();
  const ext = getExtension(file.name);

  if (ext !== '.stl') {
    // 3MF and OBJ cannot be easily parsed in the browser for manifold analysis
    return { triangleCount: 0, isManifold: true };
  }

  const parsed = parseStlBinary(buffer);
  if (!parsed) {
    // Likely ASCII STL — report basic info without manifold analysis
    return { triangleCount: 0, isManifold: true };
  }

  try {
    const Module = (await import('manifold-3d')).default;
    const wasm = await Module();
    wasm.setup();

    const mesh = new wasm.Mesh({
      numProp: 3,
      vertProperties: parsed.vertProperties,
      triVerts: parsed.triVerts,
    });

    let isManifold = true;
    let volume = 0;
    let boundingBox: MeshScanResult['boundingBox'];

    try {
      const manifold = new wasm.Manifold(mesh);
      const status = manifold.status();
      isManifold = status === 'NoError';

      if (isManifold) {
        volume = manifold.volume();
        const bbox = manifold.boundingBox();
        boundingBox = {
          min: [bbox.min[0], bbox.min[1], bbox.min[2]],
          max: [bbox.max[0], bbox.max[1], bbox.max[2]],
        };
      }
      manifold.delete();
    } catch {
      isManifold = false;
    }

    return { triangleCount: parsed.numTri, isManifold, boundingBox, volume };
  } catch (err) {
    console.warn('manifold-3d WASM scan failed:', err);
    return { triangleCount: parsed.numTri, isManifold: true };
  }
}

// ---------------------------------------------------------------------------
// Attempt manifold repair, returning a new STL File if successful
// ---------------------------------------------------------------------------
async function repairMesh(file: File): Promise<File | null> {
  const buffer = await file.arrayBuffer();
  const parsed = parseStlBinary(buffer);
  if (!parsed) return null;

  try {
    const Module = (await import('manifold-3d')).default;
    const wasm = await Module();
    wasm.setup();

    const mesh = new wasm.Mesh({
      numProp: 3,
      vertProperties: parsed.vertProperties,
      triVerts: parsed.triVerts,
    });

    const manifold = new wasm.Manifold(mesh);
    const status = manifold.status();

    if (status !== 'NoError') {
      manifold.delete();
      return null; // Repair failed
    }

    const repairedMesh = manifold.getMesh();
    const numProp: number = repairedMesh.numProp;
    const stlBuffer = meshToStlBinary(
      repairedMesh.vertProperties,
      repairedMesh.triVerts,
      numProp,
    );

    manifold.delete();

    if (stlBuffer.byteLength > MAX_FILE_SIZE) {
      return null; // Repaired file exceeds size limit
    }

    const baseName = file.name.replace(/\.stl$/i, '');
    return new File([stlBuffer], `${baseName}_repaired.stl`, {
      type: 'application/octet-stream',
    });
  } catch (err) {
    console.warn('Mesh repair failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Initial file validation (size & extension only — mesh scan happens async)
// ---------------------------------------------------------------------------
function validateFile(file: File): Pick<SelectedFile, 'status' | 'errorMessage'> {
  const ext = getExtension(file.name);
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    return { status: 'too_large', errorMessage: `Unsupported format: ${ext}` };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { status: 'too_large', errorMessage: 'Exceeds 50 MB limit' };
  }
  return { status: 'scanning' };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function FileUploadTable({ onFilesChange }: FileUploadTableProps) {
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [showIssuesBanner, setShowIssuesBanner] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateFiles = useCallback(
    (next: SelectedFile[]) => {
      setSelectedFiles(next);
      onFilesChange(next);
    },
    [onFilesChange],
  );

  // Run mesh scan for a single file and update state
  const runScan = useCallback(
    async (entry: SelectedFile, allFiles: SelectedFile[]) => {
      const result = await scanMesh(entry.file);
      const issues: string[] = [];

      let status: SelectedFile['status'] = 'ready';

      if (!result.isManifold) {
        status = 'needs_repair';
        issues.push('Non-manifold mesh detected');
      }

      if (result.triangleCount > HIGH_TRIANGLE_THRESHOLD) {
        status = status === 'needs_repair' ? 'needs_repair' : 'needs_simplification';
        issues.push(
          `High polygon count (${formatTriangleCount(result.triangleCount)} triangles)`,
        );
      }

      const updated: SelectedFile = {
        ...entry,
        status,
        scanResult: result,
        included: status === 'ready',
        errorMessage: issues.length > 0 ? issues.join('; ') : undefined,
      };

      // Atomically update just this file in the list
      setSelectedFiles((prev) => {
        const next = prev.map((f) => (f.file.name === entry.file.name ? updated : f));
        onFilesChange(next);

        // Show banner if any file has issues
        const hasIssues = next.some(
          (f) => f.status === 'needs_repair' || f.status === 'needs_simplification',
        );
        setShowIssuesBanner(hasIssues);

        return next;
      });
    },
    [onFilesChange],
  );

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(e.target.files ?? []);
    if (incoming.length === 0) return;

    const newEntries: SelectedFile[] = incoming.map((file) => {
      const validation = validateFile(file);
      return {
        file,
        included: false, // Will be set to true after scan completes
        ...validation,
      };
    });

    // Deduplicate by name
    const merged = [...selectedFiles];
    for (const entry of newEntries) {
      const idx = merged.findIndex((f) => f.file.name === entry.file.name);
      if (idx >= 0) {
        merged[idx] = entry;
      } else {
        merged.push(entry);
      }
    }
    updateFiles(merged);

    // Reset input so the same file can be re-added after removal
    if (inputRef.current) inputRef.current.value = '';

    // Kick off async scans for files that passed initial validation
    const toScan = newEntries.filter((e) => e.status === 'scanning');
    for (const entry of toScan) {
      runScan(entry, merged);
    }
  }

  function toggleIncluded(index: number) {
    const entry = selectedFiles[index];
    if (entry.status === 'too_large' || entry.status === 'scanning') return;
    const next = selectedFiles.map((f, i) =>
      i === index ? { ...f, included: !f.included } : f,
    );
    updateFiles(next);
  }

  function removeFile(index: number) {
    const next = selectedFiles.filter((_, i) => i !== index);
    updateFiles(next);
    const hasIssues = next.some(
      (f) => f.status === 'needs_repair' || f.status === 'needs_simplification',
    );
    setShowIssuesBanner(hasIssues);
  }

  async function handleRepairAndSimplify() {
    setRepairing(true);
    try {
      const filesToRepair = selectedFiles.filter((f) => f.status === 'needs_repair');
      const repairResults = await Promise.all(
        filesToRepair.map(async (entry) => {
          const repaired = await repairMesh(entry.file);
          return { fileName: entry.file.name, repaired };
        }),
      );

      setSelectedFiles((prev) => {
        const next = prev.map((f) => {
          if (f.status === 'needs_repair') {
            const result = repairResults.find((r) => r.fileName === f.file.name);
            if (result?.repaired) {
              return {
                ...f,
                status: 'ready' as const,
                repairedFile: result.repaired,
                included: true,
                errorMessage: undefined,
              };
            }
            // Repair failed — keep as needs_repair
            return { ...f, errorMessage: 'Repair failed — upload as-is or replace file' };
          }
          if (f.status === 'needs_simplification') {
            // Cannot simplify client-side — mark ready and let user decide
            return { ...f, status: 'ready' as const, included: true };
          }
          return f;
        });
        onFilesChange(next);
        setShowIssuesBanner(next.some((f) => f.status === 'needs_repair'));
        return next;
      });
    } finally {
      setRepairing(false);
    }
  }

  function handleUploadAsIs() {
    setSelectedFiles((prev) => {
      const next = prev.map((f) => {
        if (f.status === 'needs_repair' || f.status === 'needs_simplification') {
          return { ...f, status: 'ready' as const, included: true };
        }
        return f;
      });
      onFilesChange(next);
      setShowIssuesBanner(false);
      return next;
    });
  }

  const statusBadge = (status: SelectedFile['status'], errorMessage?: string) => {
    switch (status) {
      case 'ready':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
            Ready
          </span>
        );
      case 'scanning':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 animate-pulse">
            Scanning...
          </span>
        );
      case 'needs_repair':
        return (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800"
            title={errorMessage}
          >
            Needs Repair
          </span>
        );
      case 'needs_simplification':
        return (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800"
            title={errorMessage}
          >
            High Polygons
          </span>
        );
      default:
        return (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800"
            title={errorMessage}
          >
            Too Large
          </span>
        );
    }
  };

  const filesWithIssues = selectedFiles.filter(
    (f) => f.status === 'needs_repair' || f.status === 'needs_simplification',
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="block text-sm font-medium text-gray-700">
          3D Model Files
          <span className="ml-1 text-gray-400 font-normal">(STL, 3MF, OBJ — max 50 MB each)</span>
        </label>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="ml-auto text-sm px-3 py-1.5 rounded-lg border border-brand-500 text-brand-600 hover:bg-brand-50 font-medium"
        >
          + Add Files
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".stl,.3mf,.obj"
          multiple
          className="hidden"
          onChange={handleFileInput}
        />
      </div>

      {showIssuesBanner && filesWithIssues.length > 0 && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
          <p className="text-sm font-medium text-orange-800">
            {filesWithIssues.length} file(s) have mesh issues that may affect print quality
          </p>
          <ul className="mt-2 space-y-1">
            {filesWithIssues.map((f) => (
              <li key={f.file.name} className="text-xs text-orange-700">
                <span className="font-mono font-medium">{f.file.name}</span>
                {f.errorMessage && <span className="ml-1">— {f.errorMessage}</span>}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handleRepairAndSimplify}
              disabled={repairing}
              className="text-xs px-3 py-1.5 rounded-md bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50 font-medium"
            >
              {repairing ? 'Repairing...' : 'Repair & Simplify'}
            </button>
            <button
              type="button"
              onClick={handleUploadAsIs}
              disabled={repairing}
              className="text-xs px-3 py-1.5 rounded-md border border-orange-300 text-orange-700 hover:bg-orange-100 disabled:opacity-50 font-medium"
            >
              Upload As-Is
            </button>
          </div>
        </div>
      )}

      {selectedFiles.length === 0 ? (
        <div
          className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-brand-400 transition-colors"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Select 3D model files"
        >
          <p className="text-gray-500 text-sm">Click to select files, or drag-and-drop</p>
          <p className="text-gray-400 text-xs mt-1">Supports .stl, .3mf, .obj</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600 w-8">Include</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">File Name</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 w-24">Size</th>
                <th className="px-3 py-2 text-center font-medium text-gray-600 w-28">Status</th>
                <th className="px-3 py-2 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {selectedFiles.map((entry, i) => (
                <tr
                  key={`${entry.file.name}-${i}`}
                  className={
                    entry.status === 'too_large'
                      ? 'bg-red-50'
                      : entry.status === 'needs_repair'
                        ? 'bg-orange-50'
                        : entry.status === 'needs_simplification'
                          ? 'bg-yellow-50'
                          : ''
                  }
                >
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={entry.included}
                      disabled={entry.status === 'too_large' || entry.status === 'scanning'}
                      onChange={() => toggleIncluded(i)}
                      className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 disabled:opacity-40"
                      aria-label={`Include ${entry.file.name}`}
                    />
                  </td>
                  <td
                    className="px-3 py-2 font-mono text-gray-800 truncate max-w-xs"
                    title={entry.file.name}
                  >
                    {entry.file.name}
                    {entry.scanResult && entry.scanResult.triangleCount > 0 && (
                      <span className="ml-2 text-xs text-gray-400">
                        {formatTriangleCount(entry.scanResult.triangleCount)} tris
                      </span>
                    )}
                    {entry.errorMessage && (
                      <span className="ml-2 text-xs text-red-600">{entry.errorMessage}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600 tabular-nums">
                    {formatSize(entry.file.size)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {statusBadge(entry.status, entry.errorMessage)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="text-gray-400 hover:text-red-500 transition-colors"
                      aria-label={`Remove ${entry.file.name}`}
                    >
                      &times;
                    </button>
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
