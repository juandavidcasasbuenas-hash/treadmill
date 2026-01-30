/**
 * Strava integration for workout uploads
 */

import { generateTCXContent } from './export.js';
import { formatFilename } from './utils.js';

const PENDING_WORKOUT_KEY = 'pending_strava_workout';

let stravaClientId = null;

// UI callbacks
let onStatusUpdate = null;
let onTokenReceived = null;

export function setStravaCallbacks({ onStatus, onToken }) {
  onStatusUpdate = onStatus;
  onTokenReceived = onToken;
}

function setStatus(message, type = '') {
  if (onStatusUpdate) onStatusUpdate(message, type);
}

// Fetch Strava config from server
export async function loadStravaConfig() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    stravaClientId = config.strava_client_id;
    return !!stravaClientId;
  } catch (err) {
    console.log('Could not load Strava config from server');
    return false;
  }
}

// Check for OAuth callback
export function handleStravaCallback() {
  const params = new URLSearchParams(window.location.search);
  const accessToken = params.get('strava_token');
  const athleteName = params.get('strava_athlete');

  if (accessToken) {
    localStorage.setItem('strava_access_token', accessToken);
    history.replaceState(null, '', window.location.pathname);

    if (onTokenReceived) onTokenReceived(accessToken, athleteName);
    return { token: accessToken, athlete: athleteName };
  }
  return null;
}

export function getStravaToken() {
  return localStorage.getItem('strava_access_token');
}

export function clearStravaToken() {
  localStorage.removeItem('strava_access_token');
}

// Save workout before OAuth redirect
export function savePendingWorkout(workoutData) {
  localStorage.setItem(PENDING_WORKOUT_KEY, JSON.stringify(workoutData));
}

// Restore workout after OAuth redirect
export function restorePendingWorkout() {
  const saved = localStorage.getItem(PENDING_WORKOUT_KEY);
  if (!saved) return null;

  try {
    return JSON.parse(saved);
  } catch (e) {
    console.error('Failed to restore workout:', e);
    return null;
  }
}

export function clearPendingWorkout() {
  localStorage.removeItem(PENDING_WORKOUT_KEY);
}

export function hasPendingWorkout() {
  return !!localStorage.getItem(PENDING_WORKOUT_KEY);
}

// Start OAuth flow
export function connectToStrava(workoutData = null) {
  if (!stravaClientId) {
    setStatus(
      '<strong>Server not configured.</strong><br>Make sure the server is running with valid .env credentials.',
      'error'
    );
    return false;
  }

  // Save workout data before redirect
  if (workoutData && workoutData.trackpoints && workoutData.trackpoints.length > 0) {
    savePendingWorkout(workoutData);
  }

  const redirectUri = encodeURIComponent(window.location.origin + '/auth/strava/callback');
  const scope = 'activity:write';
  const authUrl = `https://www.strava.com/oauth/authorize?client_id=${stravaClientId}&response_type=code&redirect_uri=${redirectUri}&scope=${scope}`;

  window.location.href = authUrl;
  return true;
}

// Upload workout to Strava
export async function uploadToStrava(startTime, trackpoints, laps, hrReadings) {
  const token = getStravaToken();

  if (!token) {
    return { success: false, needsAuth: true };
  }

  if (trackpoints.length < 2) {
    setStatus('Not enough workout data to upload.', 'error');
    return { success: false, error: 'Not enough data' };
  }

  setStatus('Uploading to Strava...');

  try {
    const tcxContent = generateTCXContent(startTime, trackpoints, laps, hrReadings);
    const tcxBlob = new Blob([tcxContent], { type: 'application/xml' });

    const formData = new FormData();
    formData.append('file', tcxBlob, `workout_${formatFilename(startTime)}.tcx`);
    formData.append('data_type', 'tcx');
    formData.append('activity_type', 'run');
    formData.append('name', `Treadmill Run - ${startTime.toLocaleDateString()}`);

    const response = await fetch('https://www.strava.com/api/v3/uploads', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    const result = await response.json();

    if (response.ok) {
      setStatus(
        `Upload started! <a href="https://www.strava.com/activities/${result.activity_id || ''}" target="_blank">Check status on Strava</a>`,
        'success'
      );
      clearPendingWorkout();

      if (result.id) {
        pollUploadStatus(result.id, token);
      }
      return { success: true, uploadId: result.id };
    } else if (response.status === 401) {
      clearStravaToken();
      setStatus('Session expired. Click to reconnect.', 'error');
      return { success: false, needsAuth: true };
    } else {
      setStatus(`Upload failed: ${result.message || result.error || 'Unknown error'}`, 'error');
      return { success: false, error: result.message || result.error };
    }
  } catch (err) {
    setStatus(`Upload error: ${err.message}`, 'error');
    return { success: false, error: err.message };
  }
}

async function pollUploadStatus(uploadId, token) {
  let attempts = 0;
  const maxAttempts = 10;

  const checkStatus = async () => {
    try {
      const response = await fetch(`https://www.strava.com/api/v3/uploads/${uploadId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();

      if (result.activity_id) {
        setStatus(
          `Upload complete! <a href="https://www.strava.com/activities/${result.activity_id}" target="_blank">View on Strava</a>`,
          'success'
        );
      } else if (result.error) {
        setStatus(`Upload failed: ${result.error}`, 'error');
      } else if (attempts < maxAttempts) {
        attempts++;
        setTimeout(checkStatus, 2000);
      }
    } catch (err) {
      // Silently fail polling
    }
  };

  setTimeout(checkStatus, 2000);
}
