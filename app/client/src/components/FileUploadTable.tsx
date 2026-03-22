import { useRef, useState } from 'react';

export interface SelectedFile {
  file: File;
  included: boolean;
  status: 'ready' | 'too_large' | 'scanning';
  errorMessage?: string;
}

interface FileUploadTableProps {
  onFilesChange: (files: SelectedFile[]) => void;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const ACCEPTED_EXTENSIONS = ['.stl', '.3mf', '.obj'];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function getExtension(name: string): string {
  return name.slice(name.lastIndexOf('.')).toLowerCase();
}

// TODO: Add manifold-3d WASM mesh scanning when browser support is stable
function validateFile(file: File): Pick<SelectedFile, 'status' | 'errorMessage'> {
  const ext = getExtension(file.name);
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    return { status: 'too_large', errorMessage: `Unsupported format: ${ext}` };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { status: 'too_large', errorMessage: 'Exceeds 50 MB limit' };
  }
  return { status: 'ready' };
}

export default function FileUploadTable({ onFilesChange }: FileUploadTableProps) {
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  function updateFiles(next: SelectedFile[]) {
    setSelectedFiles(next);
    onFilesChange(next);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(e.target.files ?? []);
    if (incoming.length === 0) return;

    const newEntries: SelectedFile[] = incoming.map((file) => {
      const validation = validateFile(file);
      return {
        file,
        included: validation.status === 'ready',
        ...validation,
      };
    });

    // Deduplicate by name — replace existing entry if same filename
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
  }

  function toggleIncluded(index: number) {
    const entry = selectedFiles[index];
    if (entry.status === 'too_large') return;
    const next = selectedFiles.map((f, i) =>
      i === index ? { ...f, included: !f.included } : f,
    );
    updateFiles(next);
  }

  function removeFile(index: number) {
    const next = selectedFiles.filter((_, i) => i !== index);
    updateFiles(next);
  }

  const statusBadge = (status: SelectedFile['status'], errorMessage?: string) => {
    if (status === 'ready') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
          Ready
        </span>
      );
    }
    if (status === 'scanning') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
          Scanning…
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800"
        title={errorMessage}
      >
        Too Large
      </span>
    );
  };

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
                <th className="px-3 py-2 text-center font-medium text-gray-600 w-24">Status</th>
                <th className="px-3 py-2 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {selectedFiles.map((entry, i) => (
                <tr key={`${entry.file.name}-${i}`} className={entry.status === 'too_large' ? 'bg-red-50' : ''}>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={entry.included}
                      disabled={entry.status === 'too_large'}
                      onChange={() => toggleIncluded(i)}
                      className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 disabled:opacity-40"
                      aria-label={`Include ${entry.file.name}`}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-gray-800 truncate max-w-xs" title={entry.file.name}>
                    {entry.file.name}
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
