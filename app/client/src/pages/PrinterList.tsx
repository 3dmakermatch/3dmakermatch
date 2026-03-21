import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

interface PrinterItem {
  id: string;
  bio: string | null;
  addressCity: string | null;
  addressState: string | null;
  isVerified: boolean;
  averageRating: number;
  capabilities: Record<string, unknown>;
  user: { id: string; fullName: string };
}

interface PrinterResponse {
  data: PrinterItem[];
  total: number;
  page: number;
  totalPages: number;
}

export default function PrinterList() {
  const [printers, setPrinters] = useState<PrinterItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<PrinterResponse>('/printers')
      .then((res) => setPrinters(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Find Printers</h1>

      {printers.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No printers registered yet. Be the first!
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {printers.map((printer) => (
            <Link
              key={printer.id}
              to={`/printers/${printer.id}`}
              className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-lg">{printer.user.fullName}</h3>
                {printer.isVerified && (
                  <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">
                    Verified
                  </span>
                )}
              </div>
              {printer.addressCity && (
                <p className="text-sm text-gray-500 mb-2">
                  {printer.addressCity}, {printer.addressState}
                </p>
              )}
              {printer.bio && (
                <p className="text-sm text-gray-600 line-clamp-2">{printer.bio}</p>
              )}
              <div className="mt-3 text-sm text-gray-500">
                Rating: {printer.averageRating > 0 ? `${printer.averageRating.toFixed(1)}/5` : 'New'}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
