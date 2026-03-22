const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

export async function geocodeAddress(city: string, state: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const query = `${city}, ${state}, US`;
    const res = await fetch(`${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1`, {
      headers: { 'User-Agent': '3dMakerMatch/1.0' },
    });
    if (!res.ok) {
      console.warn(`[GEOCODING] Nominatim returned ${res.status}`);
      return null;
    }
    const data = await res.json() as Array<{ lat: string; lon: string }>;
    if (data.length === 0) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch (err) {
    console.warn('[GEOCODING] Failed to geocode:', err);
    return null;
  }
}
