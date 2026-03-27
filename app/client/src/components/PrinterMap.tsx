import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { Link } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix default marker icons broken by Vite asset handling — reference the CSS-bundled paths directly
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

export interface PrinterPin {
  id: string;
  name: string;
  rating: number;
  lat: number;
  lng: number;
}

interface PrinterMapProps {
  printers: PrinterPin[];
}

export default function PrinterMap({ printers }: PrinterMapProps) {
  if (printers.length === 0) {
    return (
      <div className="h-96 flex items-center justify-center bg-gray-100 rounded-lg text-gray-500">
        No printers with locations found
      </div>
    );
  }

  const center: [number, number] = [printers[0].lat, printers[0].lng];

  return (
    <MapContainer center={center} zoom={10} className="h-96 w-full rounded-lg">
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      {printers.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lng]}>
          <Popup>
            <div className="text-sm">
              <Link to={`/printers/${p.id}`} className="font-semibold text-brand-600">
                {p.name}
              </Link>
              <div className="text-gray-500">
                {p.rating > 0 ? `${p.rating.toFixed(1)}/5` : 'New'}
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
