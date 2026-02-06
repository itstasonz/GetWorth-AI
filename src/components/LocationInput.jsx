import React, { useState } from 'react';
import { MapPin, Loader2, LocateFixed, AlertCircle } from 'lucide-react';

const LocationInput = ({ label, value, onChange, rtl, placeholder }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const getLocation = async () => {
    if (!navigator.geolocation) {
      setError(rtl ? 'הדפדפן לא תומך במיקום' : 'Geolocation not supported');
      return;
    }

    setLoading(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=14&addressdetails=1`,
            { headers: { 'Accept-Language': rtl ? 'he' : 'en' } }
          );
          const data = await response.json();
          const city = data.address?.city || data.address?.town || data.address?.village || data.address?.suburb || data.address?.municipality || '';
          const area = data.address?.state || data.address?.county || '';
          const locationName = city || area || (rtl ? 'מיקום נמצא' : 'Location found');
          onChange({ target: { value: locationName } });
        } catch (e) {
          setError(rtl ? 'שגיאה בזיהוי מיקום' : 'Failed to get location');
        }
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setError(rtl ? 'הגישה למיקום נדחתה' : 'Location access denied');
            break;
          case err.POSITION_UNAVAILABLE:
            setError(rtl ? 'מיקום לא זמין' : 'Location unavailable');
            break;
          case err.TIMEOUT:
            setError(rtl ? 'הזמן הקצוב פג' : 'Request timeout');
            break;
          default:
            setError(rtl ? 'שגיאה בזיהוי מיקום' : 'Failed to get location');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  return (
    <div className="space-y-2">
      {label && <label className="text-sm text-slate-400 font-medium">{label}</label>}
      <div className="relative">
        <MapPin className={`absolute top-1/2 -translate-y-1/2 ${rtl ? 'right-4' : 'left-4'} w-5 h-5 text-slate-500`} />
        <input 
          className={`w-full px-4 py-4 ${rtl ? 'pr-12 pl-14' : 'pl-12 pr-14'} rounded-2xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 focus:bg-white/10 transition-all`}
          dir={rtl ? 'rtl' : 'ltr'}
          value={value}
          onChange={onChange}
          placeholder={placeholder || (rtl ? 'הכנס מיקום' : 'Enter location')}
        />
        <button
          type="button"
          onClick={getLocation}
          disabled={loading}
          className={`absolute top-1/2 -translate-y-1/2 ${rtl ? 'left-3' : 'right-3'} w-9 h-9 rounded-xl bg-blue-500/20 hover:bg-blue-500/30 flex items-center justify-center transition-all active:scale-95 disabled:opacity-50`}
          title={rtl ? 'השתמש במיקום נוכחי' : 'Use current location'}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
          ) : (
            <LocateFixed className="w-4 h-4 text-blue-400" />
          )}
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />{error}
        </p>
      )}
    </div>
  );
};

export default LocationInput;
