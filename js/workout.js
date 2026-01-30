/**
 * Workout state and logic
 */

// Constants
export const AUTO_LAP_DISTANCE_KM = 1.0;
export const TRACK_LENGTH_METERS = 400;
export const TRACK_PATH_LENGTH = 383; // SVG path length
const MAX_HR_READINGS = 36000; // Cap at ~1 hour of readings (1 per 100ms)

// Workout state
export const workout = {
  isRecording: false,
  startTime: null,
  distanceMeters: 0,
  elapsedSeconds: 0,
  lastTimestampMs: null,
  currentSpeedKmh: 0,
  currentHR: null,
  hrReadings: [],
  speedReadings: [],
  trackpoints: [],
  laps: [],
  currentLap: {
    startDistanceMeters: 0,
    startTimeSeconds: 0,
    number: 1
  }
};

// Reset workout to initial state
export function resetWorkoutState() {
  workout.distanceMeters = 0;
  workout.elapsedSeconds = 0;
  workout.lastTimestampMs = null;
  workout.hrReadings = [];
  workout.speedReadings = [];
  workout.trackpoints = [];
  workout.laps = [];
  workout.currentLap = { startDistanceMeters: 0, startTimeSeconds: 0, number: 1 };
  workout.startTime = null;
  workout.currentHR = null;
  workout.isRecording = false;
  workout.currentSpeedKmh = 0;
}

// Update workout data from treadmill reading
export function updateWorkoutData(speedKmh, nowMs) {
  if (workout.lastTimestampMs === null) {
    workout.lastTimestampMs = nowMs;
    return false; // No lap triggered
  }

  const dtSeconds = Math.max(0, (nowMs - workout.lastTimestampMs) / 1000);
  workout.lastTimestampMs = nowMs;
  workout.elapsedSeconds += dtSeconds;

  if (speedKmh > 0.1) {
    const speedMps = speedKmh * 1000 / 3600;
    workout.distanceMeters += speedMps * dtSeconds;
    workout.speedReadings.push({ time: workout.elapsedSeconds, speed: speedKmh });
  }

  // Record trackpoint every ~1 second for export
  const lastTrackpoint = workout.trackpoints[workout.trackpoints.length - 1];
  if (!lastTrackpoint || (workout.elapsedSeconds - lastTrackpoint.time) >= 1) {
    workout.trackpoints.push({
      time: workout.elapsedSeconds,
      distanceMeters: workout.distanceMeters,
      speedKmh: speedKmh,
      hr: workout.currentHR
    });
  }

  // Auto-lap check
  const currentLapDistance = workout.distanceMeters - workout.currentLap.startDistanceMeters;
  return currentLapDistance >= AUTO_LAP_DISTANCE_KM * 1000;
}

// Add HR reading with memory cap
export function addHRReading(hr) {
  // Cap readings to prevent memory leak in long sessions
  if (workout.hrReadings.length >= MAX_HR_READINGS) {
    // Keep every other reading to halve the array while preserving history
    workout.hrReadings = workout.hrReadings.filter((_, i) => i % 2 === 0);
  }
  workout.hrReadings.push({ time: workout.elapsedSeconds, hr });
}

// Trigger a lap (manual or auto)
export function triggerLap(isAuto = false) {
  const lapDistanceMeters = workout.distanceMeters - workout.currentLap.startDistanceMeters;
  const lapTimeSeconds = workout.elapsedSeconds - workout.currentLap.startTimeSeconds;

  if (lapDistanceMeters < 10) return null; // Ignore tiny laps

  // Store lap with explicit start/end times for reliable export
  const lap = {
    number: workout.currentLap.number,
    startTimeSeconds: workout.currentLap.startTimeSeconds,
    endTimeSeconds: workout.elapsedSeconds,
    startDistMeters: workout.currentLap.startDistanceMeters,
    endDistMeters: workout.distanceMeters,
    distanceMeters: lapDistanceMeters,
    timeSeconds: lapTimeSeconds,
    avgSpeedKmh: (lapDistanceMeters / 1000) / (lapTimeSeconds / 3600),
    isAuto
  };

  workout.laps.push(lap);

  // Start new lap
  workout.currentLap = {
    startDistanceMeters: workout.distanceMeters,
    startTimeSeconds: workout.elapsedSeconds,
    number: workout.currentLap.number + 1
  };

  return lap;
}

// Get all laps for export (including current incomplete lap)
export function getLapsForExport() {
  const allLaps = [];

  // Use the stored start/end times directly from each lap
  for (const lap of workout.laps) {
    allLaps.push({
      number: lap.number,
      startTimeSeconds: lap.startTimeSeconds,
      endTimeSeconds: lap.endTimeSeconds,
      startDistMeters: lap.startDistMeters,
      endDistMeters: lap.endDistMeters,
      timeSeconds: lap.timeSeconds,
      distanceMeters: lap.distanceMeters
    });
  }

  // Add current incomplete lap if there's meaningful distance
  const currentLapDist = workout.distanceMeters - workout.currentLap.startDistanceMeters;
  const currentLapTime = workout.elapsedSeconds - workout.currentLap.startTimeSeconds;
  if (currentLapDist > 10) {
    allLaps.push({
      number: workout.currentLap.number,
      startTimeSeconds: workout.currentLap.startTimeSeconds,
      endTimeSeconds: workout.elapsedSeconds,
      startDistMeters: workout.currentLap.startDistanceMeters,
      endDistMeters: workout.distanceMeters,
      timeSeconds: currentLapTime,
      distanceMeters: currentLapDist
    });
  }

  // If no laps at all, create one for the whole workout
  if (allLaps.length === 0 && workout.distanceMeters > 10) {
    allLaps.push({
      number: 1,
      startTimeSeconds: 0,
      endTimeSeconds: workout.elapsedSeconds,
      startDistMeters: 0,
      endDistMeters: workout.distanceMeters,
      timeSeconds: workout.elapsedSeconds,
      distanceMeters: workout.distanceMeters
    });
  }

  return allLaps;
}

// Calculate average HR
export function getAverageHR() {
  if (workout.hrReadings.length === 0) return null;
  return Math.round(workout.hrReadings.reduce((a, b) => a + b.hr, 0) / workout.hrReadings.length);
}

// Get track position for runner marker
export function getTrackPosition(progress) {
  const p = progress % 1;

  // Track shape: start at (50,10), go right to (150,10), curve down to (150,90),
  // go left to (50,90), curve up back to (50,10)
  // Straight top: 0 to ~0.26, Curve right: ~0.26 to ~0.50
  // Straight bottom: ~0.50 to ~0.76, Curve left: ~0.76 to 1.0

  if (p < 0.261) {
    const t = p / 0.261;
    return { x: 50 + t * 100, y: 10 };
  } else if (p < 0.5) {
    const t = (p - 0.261) / 0.239;
    const angle = -Math.PI / 2 + t * Math.PI;
    return { x: 150 + 40 * Math.cos(angle), y: 50 + 40 * Math.sin(angle) };
  } else if (p < 0.761) {
    const t = (p - 0.5) / 0.261;
    return { x: 150 - t * 100, y: 90 };
  } else {
    const t = (p - 0.761) / 0.239;
    const angle = Math.PI / 2 + t * Math.PI;
    return { x: 50 + 40 * Math.cos(angle), y: 50 + 40 * Math.sin(angle) };
  }
}
