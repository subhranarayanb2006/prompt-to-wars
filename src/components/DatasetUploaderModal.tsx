import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Download,
  FileJson,
  MapPin,
  Upload,
  X,
} from 'lucide-react';
import { Airport, NetworkDataset } from '../types/network';
import { parseTime } from '../utils/time';

interface DatasetUploaderModalProps {
  isOpen: boolean;
  currentDataset: NetworkDataset;
  onClose: () => void;
  onImportDataset: (dataset: NetworkDataset) => void;
}

/**
 * Automatic coordinate catalog for 36+ Indian domestic airports so organizer JSON files
 * that omit lat/lon map seamlessly onto the India Airspace SVG Map.
 */
const INDIA_AIRPORT_COORDS: Record<string, { city: string; lat: number; lon: number; tier: Airport['tier'] }> = {
  BOM: { city: 'Mumbai', lat: 19.0896, lon: 72.8656, tier: 'hub' },
  DEL: { city: 'Delhi', lat: 28.5562, lon: 77.1, tier: 'hub' },
  BLR: { city: 'Bengaluru', lat: 13.1986, lon: 77.7066, tier: 'hub' },
  HYD: { city: 'Hyderabad', lat: 17.2403, lon: 78.4294, tier: 'hub' },
  CCU: { city: 'Kolkata', lat: 22.6547, lon: 88.4467, tier: 'regional' },
  MAA: { city: 'Chennai', lat: 12.9941, lon: 80.1709, tier: 'regional' },
  AMD: { city: 'Ahmedabad', lat: 23.0732, lon: 72.6347, tier: 'regional' },
  PNQ: { city: 'Pune', lat: 18.5821, lon: 73.9197, tier: 'regional' },
  COK: { city: 'Kochi', lat: 10.152, lon: 76.4019, tier: 'regional' },
  GOI: { city: 'Goa', lat: 15.3808, lon: 73.8314, tier: 'spoke' },
  GOX: { city: 'Goa Mopa', lat: 15.7311, lon: 73.8682, tier: 'spoke' },
  JAI: { city: 'Jaipur', lat: 26.8242, lon: 75.8122, tier: 'spoke' },
  LKO: { city: 'Lucknow', lat: 26.7606, lon: 80.8893, tier: 'spoke' },
  GAU: { city: 'Guwahati', lat: 26.1061, lon: 91.5859, tier: 'spoke' },
  PAT: { city: 'Patna', lat: 25.5913, lon: 85.088, tier: 'spoke' },
  BBI: { city: 'Bhubaneswar', lat: 20.2444, lon: 85.8178, tier: 'spoke' },
  IXC: { city: 'Chandigarh', lat: 30.6735, lon: 76.7885, tier: 'spoke' },
  NAG: { city: 'Nagpur', lat: 21.0922, lon: 79.0472, tier: 'spoke' },
  IDR: { city: 'Indore', lat: 22.7218, lon: 75.8011, tier: 'spoke' },
  SXR: { city: 'Srinagar', lat: 33.9871, lon: 74.7742, tier: 'spoke' },
  TRV: { city: 'Thiruvananthapuram', lat: 8.4821, lon: 76.92, tier: 'spoke' },
  VNS: { city: 'Varanasi', lat: 25.4524, lon: 82.8593, tier: 'spoke' },
  ATQ: { city: 'Amritsar', lat: 31.7096, lon: 74.7973, tier: 'spoke' },
  IXB: { city: 'Bagdogra', lat: 26.6812, lon: 88.3286, tier: 'spoke' },
  CJB: { city: 'Coimbatore', lat: 11.03, lon: 77.0434, tier: 'spoke' },
  VTZ: { city: 'Visakhapatnam', lat: 17.7212, lon: 83.2245, tier: 'spoke' },
  IXR: { city: 'Ranchi', lat: 23.3143, lon: 85.3217, tier: 'spoke' },
  RPR: { city: 'Raipur', lat: 21.1804, lon: 81.7388, tier: 'spoke' },
  BHO: { city: 'Bhopal', lat: 23.2875, lon: 77.3374, tier: 'spoke' },
  UDR: { city: 'Udaipur', lat: 24.6177, lon: 73.8961, tier: 'spoke' },
  STV: { city: 'Surat', lat: 21.1141, lon: 72.7418, tier: 'spoke' },
  BDQ: { city: 'Vadodara', lat: 22.3362, lon: 73.2263, tier: 'spoke' },
  IXE: { city: 'Mangaluru', lat: 12.9613, lon: 74.89, tier: 'spoke' },
  IXM: { city: 'Madurai', lat: 9.8345, lon: 78.0934, tier: 'spoke' },
  TRZ: { city: 'Tiruchirappalli', lat: 10.7654, lon: 78.7097, tier: 'spoke' },
  IXJ: { city: 'Jammu', lat: 32.6891, lon: 74.8374, tier: 'spoke' },
};

function normalizeMinuteValue(val: unknown, fallback: number): number {
  if (typeof val === 'number' && Number.isFinite(val)) return Math.round(val);
  if (typeof val === 'string' && /^\d{1,2}:\d{2}/.test(val.trim())) {
    return parseTime(val.trim().slice(0, 5));
  }
  return fallback;
}

interface ValidationReport {
  dataset: NetworkDataset;
  autoMappedCoords: string[];
  warnings: string[];
}

function validateAndNormalizeDataset(rawText: string): ValidationReport {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(rawText);
  } catch {
    throw new Error('Malformed JSON syntax. Check brackets, quotes, and trailing commas.');
  }

  if (!raw || typeof raw !== 'object') {
    throw new Error('Root JSON value must be an object containing airports, aircraft, flights, crews, connections, and spares.');
  }

  const requiredKeys = ['airports', 'aircraft', 'flights', 'crews', 'connections', 'spares'] as const;
  for (const key of requiredKeys) {
    if (!Array.isArray(raw[key])) {
      throw new Error(`Missing or invalid required array: "${key}".`);
    }
  }

  const autoMappedCoords: string[] = [];
  const warnings: string[] = [];

  const airports: Airport[] = (raw.airports as Record<string, unknown>[]).map((a, idx) => {
    const code = String(a.code ?? '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      throw new Error(`airports[${idx}]: invalid 3-letter IATA code "${a.code}".`);
    }
    const catalog = INDIA_AIRPORT_COORDS[code];
    let lat = typeof a.lat === 'number' && Number.isFinite(a.lat) ? a.lat : NaN;
    let lon = typeof a.lon === 'number' && Number.isFinite(a.lon) ? a.lon : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      if (catalog) {
        lat = catalog.lat;
        lon = catalog.lon;
        autoMappedCoords.push(code);
      } else {
        lat = 21.0;
        lon = 78.9;
        autoMappedCoords.push(`${code} (central India fallback)`);
        warnings.push(`Airport ${code} omitted lat/lon and wasn't in catalog; placed at central India.`);
      }
    }
    return {
      code,
      name: String(a.name ?? `${catalog?.city ?? code} Airport`),
      city: String(a.city ?? catalog?.city ?? code),
      tier: a.tier === 'hub' || a.tier === 'regional' || a.tier === 'spoke' ? a.tier : catalog?.tier ?? 'spoke',
      lat,
      lon,
      mctMinutes: typeof a.mctMinutes === 'number' && a.mctMinutes > 0 ? Math.round(a.mctMinutes) : 40,
    };
  });

  const airportSet = new Set(airports.map((a) => a.code));

  const aircraft = (raw.aircraft as Record<string, unknown>[]).map((ac, idx) => {
    const id = String(ac.id ?? '').trim();
    if (!id) throw new Error(`aircraft[${idx}]: missing "id".`);
    return {
      id,
      model: String(ac.model ?? 'A320neo'),
      capacity: typeof ac.capacity === 'number' && ac.capacity > 0 ? Math.round(ac.capacity) : 180,
      homeBase: String(ac.homeBase ?? airports[0]?.code ?? 'BOM').toUpperCase(),
      minTurnaroundMin:
        typeof ac.minTurnaroundMin === 'number' && ac.minTurnaroundMin >= 15
          ? Math.round(ac.minTurnaroundMin)
          : 35,
    };
  });

  const crews = (raw.crews as Record<string, unknown>[]).map((c, idx) => {
    const id = String(c.id ?? '').trim();
    if (!id) throw new Error(`crews[${idx}]: missing "id".`);
    return {
      id,
      name: String(c.name ?? `Crew ${id}`),
      base: String(c.base ?? airports[0]?.code ?? 'BOM').toUpperCase(),
      maxDutyMinutes: typeof c.maxDutyMinutes === 'number' && c.maxDutyMinutes > 120 ? Math.round(c.maxDutyMinutes) : 720,
      reportBeforeFirstFlightMin:
        typeof c.reportBeforeFirstFlightMin === 'number' ? Math.round(c.reportBeforeFirstFlightMin) : 45,
      debriefAfterLastFlightMin:
        typeof c.debriefAfterLastFlightMin === 'number' ? Math.round(c.debriefAfterLastFlightMin) : 15,
    };
  });

  const flights = (raw.flights as Record<string, unknown>[]).map((f, idx) => {
    const id = String(f.id ?? '').trim();
    const origin = String(f.origin ?? '').trim().toUpperCase();
    const dest = String(f.dest ?? '').trim().toUpperCase();
    if (!id || !origin || !dest) {
      throw new Error(`flights[${idx}]: requires id, origin, and dest.`);
    }
    if (!airportSet.has(origin) || !airportSet.has(dest)) {
      warnings.push(`Flight ${id} references airport outside airports list (${origin}→${dest}).`);
    }
    const schedDep = normalizeMinuteValue(f.schedDep, 480);
    const schedArr = normalizeMinuteValue(f.schedArr, schedDep + 90);
    return {
      id,
      origin,
      dest,
      aircraftId: String(f.aircraftId ?? aircraft[0]?.id ?? 'VT-01'),
      crewId: String(f.crewId ?? crews[0]?.id ?? 'CR-01'),
      schedDep,
      schedArr: schedArr > schedDep ? schedArr : schedDep + 60,
      passengers: typeof f.passengers === 'number' && f.passengers >= 0 ? Math.round(f.passengers) : 150,
    };
  });

  const connections = (raw.connections as Record<string, unknown>[]).map((c, idx) => ({
    id: String(c.id ?? `CONN-${idx + 1}`),
    fromFlightId: String(c.fromFlightId ?? ''),
    toFlightId: String(c.toFlightId ?? ''),
    airportCode: String(c.airportCode ?? '').toUpperCase(),
    passengers: typeof c.passengers === 'number' && c.passengers >= 0 ? Math.round(c.passengers) : 20,
    mctMinutes: typeof c.mctMinutes === 'number' && c.mctMinutes > 0 ? Math.round(c.mctMinutes) : 45,
  }));

  const spares = (raw.spares as Record<string, unknown>[]).map((s, idx) => ({
    id: String(s.id ?? `SP-${idx + 1}`),
    model: String(s.model ?? 'A320neo'),
    capacity: typeof s.capacity === 'number' ? Math.round(s.capacity) : 180,
    baseAirport: String(s.baseAirport ?? airports[0]?.code ?? 'BOM').toUpperCase(),
    readyFrom: normalizeMinuteValue(s.readyFrom, 480),
    includesFreshCrew: s.includesFreshCrew !== false,
    operatingCostInrLakhs: typeof s.operatingCostInrLakhs === 'number' ? s.operatingCostInrLakhs : 2.8,
  }));

  const standbyCrews = Array.isArray(raw.standbyCrews)
    ? (raw.standbyCrews as Record<string, unknown>[]).map((sc, idx) => ({
        id: String(sc.id ?? `SB-${idx + 1}`),
        name: String(sc.name ?? `Standby Crew ${idx + 1}`),
        baseAirport: String(sc.baseAirport ?? airports[0]?.code ?? 'BOM').toUpperCase(),
        readyFrom: normalizeMinuteValue(sc.readyFrom, 480),
        maxDutyMinutes: typeof sc.maxDutyMinutes === 'number' ? Math.round(sc.maxDutyMinutes) : 660,
      }))
    : [];

  return {
    dataset: {
      name: String(raw.name ?? `Uploaded Network (${airports.length} Airports · ${flights.length} Flights)`),
      airports,
      aircraft,
      flights,
      crews,
      connections,
      spares,
      standbyCrews,
    },
    autoMappedCoords,
    warnings,
  };
}

export const DatasetUploaderModal: React.FC<DatasetUploaderModalProps> = ({
  isOpen,
  currentDataset,
  onClose,
  onImportDataset,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [rawText, setRawText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);

  if (!isOpen) return null;

  const runValidation = (text: string, name?: string) => {
    setRawText(text);
    if (name !== undefined) setFileName(name);
    if (!text.trim()) {
      setError(null);
      setReport(null);
      return;
    }
    try {
      const validated = validateAndNormalizeDataset(text);
      setReport(validated);
      setError(null);
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : 'Validation failed.');
    }
  };

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      runValidation(String(reader.result ?? ''), file.name);
    };
    reader.onerror = () => setError('Unable to read the selected file.');
    reader.readAsText(file);
  };

  const handleDownloadSchemaTemplate = () => {
    const blob = new Blob([JSON.stringify(currentDataset, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'domino-sky-schema-template.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <Database className="w-4 h-4 text-blue-700" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">Upload & Validate Custom Network JSON</h3>
              <p className="text-[11px] text-slate-500">
                Drop any organizer dataset JSON — supports &quot;HH:MM&quot; or minute timestamps &amp; auto-maps Indian airport coordinates.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close uploader"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Drag-and-Drop Zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) handleFile(file);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors cursor-pointer ${
              isDragging
                ? 'border-blue-600 bg-blue-50/70'
                : 'border-slate-300 bg-slate-50/60 hover:border-slate-400'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            <Upload className="w-6 h-6 text-blue-700 mx-auto" />
            <div className="mt-2 text-xs font-semibold text-slate-900">
              {fileName ? `Loaded: ${fileName}` : 'Drag & drop organizer dataset .json file here, or click to browse'}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              Validates airports, aircraft, flights, crews, connections, spares, and standby reserves instantly
            </div>
          </div>

          {/* Or Paste JSON */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="dataset-json-paste" className="font-medium text-slate-700 flex items-center gap-1.5">
                <FileJson className="w-3.5 h-3.5 text-slate-500" />
                Or Paste Raw JSON
              </label>
              <button
                type="button"
                onClick={handleDownloadSchemaTemplate}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-800 cursor-pointer"
              >
                <Download className="w-3 h-3" />
                Download Reference Schema JSON
              </button>
            </div>
            <textarea
              id="dataset-json-paste"
              rows={5}
              value={rawText}
              onChange={(e) => runValidation(e.target.value)}
              placeholder='{ "airports": [...], "aircraft": [...], "flights": [...], "crews": [...], "connections": [...], "spares": [...] }'
              className="w-full p-3 text-xs font-mono border border-slate-200 rounded-xl bg-slate-50/50 focus:bg-white focus:outline-none focus:border-blue-600"
            />
          </div>

          {/* Instant Validation Feedback */}
          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 flex items-start gap-2 text-xs text-rose-800">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Schema Error:</span> {error}
              </div>
            </div>
          )}

          {report && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5 space-y-2 text-xs">
              <div className="flex items-center gap-2 font-semibold text-emerald-900">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Schema Validated — Ready for Deterministic Simulation</span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 font-mono tabular-nums text-[11px] text-emerald-950 bg-white/80 border border-emerald-200/80 rounded-lg p-2.5 text-center">
                <div>
                  <div className="text-[10px] font-sans text-slate-500">Airports</div>
                  <div className="font-bold">{report.dataset.airports.length}</div>
                </div>
                <div>
                  <div className="text-[10px] font-sans text-slate-500">Flights</div>
                  <div className="font-bold">{report.dataset.flights.length}</div>
                </div>
                <div>
                  <div className="text-[10px] font-sans text-slate-500">Aircraft</div>
                  <div className="font-bold">{report.dataset.aircraft.length}</div>
                </div>
                <div>
                  <div className="text-[10px] font-sans text-slate-500">Crews</div>
                  <div className="font-bold">{report.dataset.crews.length}</div>
                </div>
                <div>
                  <div className="text-[10px] font-sans text-slate-500">Conns</div>
                  <div className="font-bold">{report.dataset.connections.length}</div>
                </div>
                <div>
                  <div className="text-[10px] font-sans text-slate-500">Spares</div>
                  <div className="font-bold">{report.dataset.spares.length}</div>
                </div>
              </div>
              {report.autoMappedCoords.length > 0 && (
                <div className="flex items-center gap-1.5 text-[11px] text-emerald-800">
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span>Auto-mapped India coordinates for: {report.autoMappedCoords.join(', ')}</span>
                </div>
              )}
              {report.warnings.length > 0 && (
                <div className="text-[11px] text-amber-800">
                  Notes: {report.warnings.slice(0, 3).join(' · ')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50/80 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 rounded-lg border border-slate-200 bg-white cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!report}
            onClick={() => {
              if (!report) return;
              onImportDataset(report.dataset);
              onClose();
            }}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-45 rounded-lg transition-colors cursor-pointer"
          >
            Load Validated Dataset into Simulator
          </button>
        </div>
      </div>
    </div>
  );
};
