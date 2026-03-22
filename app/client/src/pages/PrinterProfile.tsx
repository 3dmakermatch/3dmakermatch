import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

interface PrinterMachine {
  id: string;
  name: string;
  type: string;
  materials: string[];
  buildVolume: { x: number; y: number; z: number };
}

interface PrinterDetail {
  id: string;
  userId: string;
  bio: string | null;
  addressCity: string | null;
  addressState: string | null;
  isVerified: boolean;
  averageRating: number;
  trustScore: number;
  capabilities: {
    machines?: Array<{ name: string; type: string; materials: string[] }>;
    materials?: string[];
  };
  machines: PrinterMachine[];
  user: { id: string; fullName: string; createdAt: string };
}

interface ReviewData {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  reviewer: { id: string; fullName: string };
  order: { job: { id: string; title: string } };
}

export default function PrinterProfile() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [printer, setPrinter] = useState<PrinterDetail | null>(null);
  const [reviews, setReviews] = useState<ReviewData[]>([]);
  const [machines, setMachines] = useState<PrinterMachine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingMachineId, setDeletingMachineId] = useState<string | null>(null);

  const isOwner = user && printer && user.printer?.id === printer.id;

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api<PrinterDetail>(`/printers/${id}`),
      api<{ data: ReviewData[] }>(`/printers/${id}/reviews`).catch(() => ({ data: [] as ReviewData[] })),
    ])
      .then(([printerData, reviewData]) => {
        setPrinter(printerData);
        setMachines(printerData.machines ?? []);
        setReviews(reviewData.data);
      })
      .catch(() => setError('Printer not found'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleDeleteMachine = async (machineId: string) => {
    if (!id || !window.confirm('Delete this machine?')) return;
    setDeletingMachineId(machineId);
    try {
      await api(`/printers/${id}/machines/${machineId}`, { method: 'DELETE' });
      setMachines((prev) => prev.filter((m) => m.id !== machineId));
    } catch {
      alert('Failed to delete machine');
    } finally {
      setDeletingMachineId(null);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" /></div>;
  }
  if (error || !printer) {
    return <div className="max-w-3xl mx-auto px-4 py-16 text-center text-gray-500">{error || 'Printer not found'}</div>;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">{printer.user.fullName}</h1>
          <div className="flex items-center gap-2">
            {printer.isVerified && <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">Verified</span>}
            <span className="text-sm text-gray-500">Trust: {printer.trustScore}/1000</span>
          </div>
        </div>

        {printer.addressCity && <p className="text-gray-500 mb-4">{printer.addressCity}, {printer.addressState}</p>}
        {printer.bio && <p className="text-gray-700 mb-6">{printer.bio}</p>}

        <div className="border-t pt-4 mt-4">
          <h2 className="font-semibold mb-2">Rating</h2>
          <p className="text-2xl font-bold text-brand-600">
            {printer.averageRating > 0 ? `${printer.averageRating.toFixed(1)}/5` : 'No reviews yet'}
          </p>
        </div>
      </div>

      {/* Machines */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Machines</h2>
        {machines.length === 0 ? (
          <p className="text-gray-500 text-sm">No machines listed yet.</p>
        ) : (
          <div className="space-y-3">
            {machines.map((machine) => (
              <div key={machine.id} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">{machine.name}</span>
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{machine.type}</span>
                    </div>
                    {machine.materials.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {machine.materials.map((mat) => (
                          <span key={mat} className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">{mat}</span>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-gray-500">
                      Build volume: {machine.buildVolume.x}&times;{machine.buildVolume.y}&times;{machine.buildVolume.z} mm
                    </p>
                  </div>
                  {isOwner && (
                    <button
                      onClick={() => handleDeleteMachine(machine.id)}
                      disabled={deletingMachineId === machine.id}
                      className="ml-3 text-xs text-red-600 hover:text-red-700 disabled:opacity-50 shrink-0"
                    >
                      {deletingMachineId === machine.id ? 'Deleting...' : 'Delete'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reviews */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Reviews ({reviews.length})</h2>
        {reviews.length === 0 ? (
          <p className="text-gray-500">No reviews yet.</p>
        ) : (
          <div className="space-y-4">
            {reviews.map((review) => (
              <div key={review.id} className="border-b last:border-0 pb-4 last:pb-0">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-yellow-400">{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span>
                    <span className="text-sm font-medium">{review.reviewer.fullName}</span>
                  </div>
                  <span className="text-xs text-gray-400">{new Date(review.createdAt).toLocaleDateString()}</span>
                </div>
                <p className="text-xs text-gray-500 mb-1">Job: {review.order.job.title}</p>
                {review.comment && <p className="text-sm text-gray-700">{review.comment}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
