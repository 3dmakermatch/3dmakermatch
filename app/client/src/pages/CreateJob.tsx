import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

const MATERIALS = ['PLA', 'PETG', 'ABS', 'TPU', 'Nylon', 'Resin', 'ASA', 'PC', 'Other'];

export default function CreateJob() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [material, setMaterial] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [uploadProgress, setUploadProgress] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a 3D model file');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError('File size exceeds 50MB limit');
      return;
    }
    setError('');
    setUploading(true);

    try {
      // Step 1: Get presigned URL
      setUploadProgress('Getting upload URL...');
      const presign = await api<{ uploadUrl: string; fileKey: string }>('/uploads/presign', {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, fileSize: file.size }),
      });

      // Step 2: Upload file to S3
      setUploadProgress('Uploading file...');
      const uploadRes = await fetch(presign.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });

      if (!uploadRes.ok) {
        throw { error: 'File upload failed' };
      }

      // Step 3: Create job
      setUploadProgress('Creating print job...');
      const job = await api<{ id: string }>('/jobs', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description: description || undefined,
          fileKey: presign.fileKey,
          fileName: file.name,
          materialPreferred: material || undefined,
          quantity,
          expiresInDays,
        }),
      });

      navigate(`/jobs/${job.id}`);
    } catch (err: unknown) {
      const apiError = err as { error?: string };
      setError(apiError.error || 'Failed to create job');
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Post a Print Job</h1>

      {error && (
        <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="file" className="block text-sm font-medium text-gray-700 mb-1">
            3D Model File (STL, 3MF, or OBJ)
          </label>
          <input
            id="file"
            type="file"
            accept=".stl,.3mf,.obj"
            required
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {file && (
            <p className="text-sm text-gray-500 mt-1">
              {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
            </p>
          )}
        </div>

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

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
            Description (optional)
          </label>
          <textarea
            id="description"
            rows={3}
            maxLength={5000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Any specific requirements: tolerances, finish, color preferences..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="material" className="block text-sm font-medium text-gray-700 mb-1">
              Preferred Material
            </label>
            <select
              id="material"
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Any / Not sure</option>
              {MATERIALS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

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

        <button
          type="submit"
          disabled={uploading}
          className="w-full bg-brand-600 text-white py-3 rounded-lg hover:bg-brand-700 disabled:opacity-50 font-medium"
        >
          {uploading ? uploadProgress || 'Processing...' : 'Post Job & Get Bids'}
        </button>
      </form>
    </div>
  );
}
