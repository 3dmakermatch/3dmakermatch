import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getAccessToken } from '../lib/api';
import FileUploadTable, { type SelectedFile } from '../components/FileUploadTable';

const COMMON_MATERIALS = ['PLA', 'ABS', 'PETG', 'TPU', 'Nylon', 'Resin', 'Other'] as const;

interface PresignResponse {
  uploadUrl: string;
  fileKey: string;
  mode: 'local' | 's3';
  maxSize: number;
  expiresIn: number;
}

interface FileProgress {
  fileName: string;
  progress: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

export default function CreateJob() {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [materials, setMaterials] = useState<Set<string>>(new Set());
  const [otherMaterial, setOtherMaterial] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [expiresInDays, setExpiresInDays] = useState(7);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [fileProgress, setFileProgress] = useState<FileProgress[]>([]);
  const [globalStatus, setGlobalStatus] = useState('');

  const navigate = useNavigate();

  function toggleMaterial(material: string) {
    setMaterials((prev) => {
      const next = new Set(prev);
      if (next.has(material)) {
        next.delete(material);
      } else {
        next.add(material);
      }
      return next;
    });
  }

  function buildMaterialList(): string[] {
    const list = [...materials].filter((m) => m !== 'Other');
    if (materials.has('Other') && otherMaterial.trim()) {
      list.push(otherMaterial.trim());
    }
    return list;
  }

  function setFileProgressEntry(index: number, update: Partial<FileProgress>) {
    setFileProgress((prev) =>
      prev.map((fp, i) => (i === index ? { ...fp, ...update } : fp)),
    );
  }

  async function uploadFile(file: File, presign: PresignResponse): Promise<void> {
    if (presign.mode === 's3') {
      const res = await fetch(presign.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      if (!res.ok) throw new Error('S3 upload failed');
    } else {
      const res = await fetch(presign.uploadUrl, {
        method: 'POST',
        body: file,
        headers: {
          'Content-Type': 'application/octet-stream',
          Authorization: `Bearer ${getAccessToken()}`,
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error((err as { error?: string }).error ?? 'Upload failed');
      }
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    const includedFiles = files.filter((f) => f.included && f.status === 'ready');
    if (includedFiles.length === 0) {
      setError('Please add at least one valid file and mark it for inclusion.');
      return;
    }

    setError('');
    setSubmitting(true);

    // Initialise per-file progress rows
    const initialProgress: FileProgress[] = includedFiles.map((f) => ({
      fileName: f.file.name,
      progress: 'pending',
    }));
    setFileProgress(initialProgress);

    try {
      const uploadedFiles: { fileKey: string; fileName: string; displayOrder: number }[] = [];

      for (let i = 0; i < includedFiles.length; i++) {
        const { file } = includedFiles[i];
        setGlobalStatus(`Uploading file ${i + 1} of ${includedFiles.length}…`);
        setFileProgressEntry(i, { progress: 'uploading' });

        let presign: PresignResponse;
        try {
          presign = await api<PresignResponse>('/uploads/presign', {
            method: 'POST',
            body: JSON.stringify({ fileName: file.name, fileSize: file.size }),
          });
        } catch (err: unknown) {
          const msg = (err as { error?: string }).error ?? 'Failed to get upload URL';
          setFileProgressEntry(i, { progress: 'error', error: msg });
          throw new Error(msg);
        }

        try {
          await uploadFile(file, presign);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Upload failed';
          setFileProgressEntry(i, { progress: 'error', error: msg });
          throw new Error(msg);
        }

        setFileProgressEntry(i, { progress: 'done' });
        uploadedFiles.push({ fileKey: presign.fileKey, fileName: file.name, displayOrder: i });
      }

      setGlobalStatus('Creating print job…');
      const materialPreferred = buildMaterialList();
      const job = await api<{ id: string }>('/jobs', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description: description || undefined,
          files: uploadedFiles,
          materialPreferred: materialPreferred.length > 0 ? materialPreferred : undefined,
          quantity,
          expiresInDays,
        }),
      });

      navigate(`/jobs/${job.id}`);
    } catch (err: unknown) {
      const apiError = err as { error?: string; message?: string };
      setError(apiError.error ?? apiError.message ?? 'Failed to create job');
    } finally {
      setSubmitting(false);
      setGlobalStatus('');
    }
  };

  const includedCount = files.filter((f) => f.included && f.status === 'ready').length;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Post a Print Job</h1>

      {error && (
        <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* File upload */}
        <FileUploadTable onFilesChange={setFiles} />

        {/* Per-file upload progress (shown during submission) */}
        {fileProgress.length > 0 && (
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 text-sm">
            {fileProgress.map((fp) => (
              <div key={fp.fileName} className="flex items-center gap-3 px-3 py-2">
                {fp.progress === 'done' && (
                  <span className="text-green-600 font-bold" aria-hidden>&#10003;</span>
                )}
                {fp.progress === 'uploading' && (
                  <span className="text-yellow-600 animate-pulse">&#8635;</span>
                )}
                {fp.progress === 'error' && (
                  <span className="text-red-600 font-bold" aria-hidden>&times;</span>
                )}
                {fp.progress === 'pending' && (
                  <span className="text-gray-400">&#8226;</span>
                )}
                <span className="flex-1 font-mono truncate">{fp.fileName}</span>
                {fp.error && <span className="text-red-500 text-xs">{fp.error}</span>}
              </div>
            ))}
          </div>
        )}

        {/* Job title */}
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
            Job Title
          </label>
          <input
            id="title"
            type="text"
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Custom bracket for drone mount"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
            Description <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            id="description"
            rows={3}
            maxLength={5000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Any specific requirements: tolerances, finish, color preferences…"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* Materials */}
        <div>
          <fieldset>
            <legend className="block text-sm font-medium text-gray-700 mb-2">
              Preferred Material <span className="text-gray-400 font-normal">(select all that apply)</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {COMMON_MATERIALS.map((m) => (
                <label
                  key={m}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border cursor-pointer text-sm select-none transition-colors ${
                    materials.has(m)
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-gray-300 text-gray-600 hover:border-gray-400'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={materials.has(m)}
                    onChange={() => toggleMaterial(m)}
                  />
                  {m}
                </label>
              ))}
            </div>
            {materials.has('Other') && (
              <input
                type="text"
                value={otherMaterial}
                onChange={(e) => setOtherMaterial(e.target.value)}
                placeholder="Specify material…"
                maxLength={100}
                className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            )}
          </fieldset>
        </div>

        {/* Quantity + expiry */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="quantity" className="block text-sm font-medium text-gray-700 mb-1">
              Quantity
            </label>
            <input
              id="quantity"
              type="number"
              min={1}
              max={10000}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div>
            <label htmlFor="expires" className="block text-sm font-medium text-gray-700 mb-1">
              Accept bids for
            </label>
            <select
              id="expires"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value={3}>3 days</option>
              <option value={5}>5 days</option>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting || includedCount === 0}
          className="w-full bg-brand-600 text-white py-3 rounded-lg hover:bg-brand-700 disabled:opacity-50 font-medium transition-colors"
        >
          {submitting
            ? globalStatus || 'Processing…'
            : `Post Job & Get Bids${includedCount > 0 ? ` (${includedCount} file${includedCount !== 1 ? 's' : ''})` : ''}`}
        </button>
      </form>
    </div>
  );
}
