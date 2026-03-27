import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import PrinterMap, { type PrinterPin } from '../components/PrinterMap';

interface PrinterItem {
  id: string;
  bio: string | null;
  addressCity: string | null;
  addressState: string | null;
  isVerified: boolean;
  averageRating: number;
  latitude: number | null;
  longitude: number | null;
  capabilities: Record<string, unknown>;
  user: { id: string; fullName: string };
}

interface PrinterResponse {
  data: PrinterItem[];
  total: number;
  page: number;
  totalPages: number;
}

const NEAR_ME_RADIUS_MILES = 50;

export default function PrinterList() {
  const [printers, setPrinters] = useState<PrinterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [geoError, setGeoError] = useState<string | null>(null);
  const [nearMeActive, setNearMeActive] = useState(false);

  const fetchPrinters = useCallback((params?: URLSearchParams) => {
    setLoading(true);
    const url = params ? `/printers?${params}` : '/printers';
    api<PrinterResponse>(url)
      .then((res) => setPrinters(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchPrinters();
  }, [fetchPrinters]);

  const handleNearMe = () => {
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by your browser.');
      return;
    }
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const params = new URLSearchParams({
          lat: String(position.coords.latitude),
          lng: String(position.coords.longitude),
          radius: String(NEAR_ME_RADIUS_MILES),
        });
        fetchPrinters(params);
        setNearMeActive(true);
        setViewMode('map');
      },
      (err) => {
        console.warn('[GEOLOCATION]', err);
        setGeoError('Could not get your location. Please allow location access and try again.');
      },
    );
  };

  const handleClearNearMe = () => {
    setNearMeActive(false);
    setGeoError(null);
    fetchPrinters();
  };

  const mapPins: PrinterPin[] = printers
    .filter((p) => p.latitude !== null && p.longitude !== null)
    .map((p) => ({
      id: p.id,
      name: p.user.fullName,
      rating: p.averageRating,
      lat: p.latitude as number,
      lng: p.longitude as number,
    }));

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Find Printers</h1>
        <div className="flex items-center gap-3">
          {nearMeActive ? (
            <button
              onClick={handleClearNearMe}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Clear Location Filter
            </button>
          ) : (
            <button
              onClick={handleNearMe}
              className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors font-medium"
            >
              Near Me
            </button>
          )}
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
            <button
              onClick={() => setViewMode('list')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                viewMode === 'list'
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              List View
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                viewMode === 'map'
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              Map View
            </button>
          </div>
        </div>
      </div>

      {geoError && (
        <div className="mb-4 px-4 py-3 bg-red-50 text-red-700 rounded-lg text-sm">
          {geoError}
        </div>
      )}

      {nearMeActive && (
        <div className="mb-4 px-4 py-3 bg-blue-50 text-blue-700 rounded-lg text-sm">
          Showing printers within {NEAR_ME_RADIUS_MILES} miles of your location.
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
        </div>
      ) : viewMode === 'map' ? (
        <PrinterMap printers={mapPins} />
      ) : printers.length === 0 ? (
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
