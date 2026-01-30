/**
 * Utility functions for formatting and file operations
 */

// Format pace from speed (min:sec per km)
export function fmtPace(speedKmh) {
  if (!Number.isFinite(speedKmh) || speedKmh < 0.1) return '--:--';
  const totalMin = 60 / speedKmh;
  const mm = Math.floor(totalMin);
  const ss = Math.round((totalMin - mm) * 60);
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

// Format pace from time and distance
export function fmtPaceFromTime(timeSeconds, distanceKm) {
  if (!distanceKm || distanceKm < 0.001) return '--:--';
  const paceMin = (timeSeconds / 60) / distanceKm;
  if (!Number.isFinite(paceMin)) return '--:--';
  const mm = Math.floor(paceMin);
  const ss = Math.round((paceMin - mm) * 60);
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

// Format time as H:MM:SS or M:SS
export function fmtTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const s = Math.floor(seconds);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (hh > 0) return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

// Format speed with one decimal
export function fmtSpeed(speedKmh) {
  if (!Number.isFinite(speedKmh)) return '-.-';
  return speedKmh.toFixed(1);
}

// Format distance with two decimals
export function fmtDistance(distanceKm) {
  if (!Number.isFinite(distanceKm)) return '0.00';
  return distanceKm.toFixed(2);
}

// Format date for filename
export function formatFilename(date) {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// Download a file
export function downloadFile(content, filename, mimeType) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Debounce function to limit rapid calls
export function debounce(fn, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}
