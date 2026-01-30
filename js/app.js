/**
 * Main application - orchestrates all modules
 */

import { fmtPace, fmtPaceFromTime, fmtTime, fmtSpeed, fmtDistance, debounce } from './utils.js';
import {
  workout,
  resetWorkoutState,
  updateWorkoutData,
  addHRReading,
  triggerLap,
  getLapsForExport,
  getAverageHR,
  getTrackPosition,
  TRACK_LENGTH_METERS,
  TRACK_PATH_LENGTH,
  AUTO_LAP_DISTANCE_KM
} from './workout.js';
import {
  setCallbacks as setBluetoothCallbacks,
  connectTreadmill,
  disconnectTreadmill,
  connectHR,
  disconnectHR
} from './bluetooth.js';
import { exportTCX, exportFIT, generateTCXContent } from './export.js';
import {
  setStravaCallbacks,
  loadStravaConfig,
  handleStravaCallback,
  getStravaToken,
  connectToStrava,
  uploadToStrava,
  savePendingWorkout,
  restorePendingWorkout,
  clearPendingWorkout,
  hasPendingWorkout
} from './strava.js';
import {
  generateWorkout,
  setActiveWorkout,
  getActiveWorkout,
  clearActiveWorkout,
  hasActiveWorkout,
  getCurrentInterval,
  getUpcomingIntervals,
  getIntervalProgress,
  getIntervalTimeRemaining,
  formatIntervalTime,
  updateIntervalTiming,
  getTotalWorkoutDuration,
  isWorkoutComplete,
  renderIntervalsTimeline,
  renderIntervalsList,
  renderUpcomingIntervals,
  updateActiveIntervalDisplay,
  setWorkoutCallbacks
} from './workoutGenerator.js';

// ===== DOM Elements =====
const el = id => document.getElementById(id);

const ui = {
  // Views
  landingPage: el('landingPage'),
  workoutCreator: el('workoutCreator'),
  treadmillApp: el('treadmillApp'),

  // Navigation
  btnCreateWorkout: el('btnCreateWorkout'),
  btnJustRun: el('btnJustRun'),
  btnBackFromCreator: el('btnBackFromCreator'),
  btnBackFromTreadmill: el('btnBackFromTreadmill'),

  // Workout Creator
  workoutPrompt: el('workoutPrompt'),
  btnGenerateWorkout: el('btnGenerateWorkout'),
  generatorStatus: el('generatorStatus'),
  workoutPreview: el('workoutPreview'),
  workoutName: el('workoutName'),
  workoutDescription: el('workoutDescription'),
  workoutDuration: el('workoutDuration'),
  intervalsTimeline: el('intervalsTimeline'),
  intervalsList: el('intervalsList'),
  btnEditWorkout: el('btnEditWorkout'),
  btnStartWorkout: el('btnStartWorkout'),

  // Treadmill Title
  treadmillTitle: el('treadmillTitle'),

  // Device badges
  treadmillBadge: el('treadmillBadge'),
  treadmillDevice: el('treadmillDevice'),
  hrBadge: el('hrBadge'),
  hrDevice: el('hrDevice'),

  // Track
  trackProgress: el('trackProgress'),
  runnerMarker: el('runnerMarker'),
  trackLapNum: el('trackLapNum'),
  trackMeters: el('trackMeters'),

  // Active Interval Panel
  activeIntervalPanel: el('activeIntervalPanel'),
  currentIntervalType: el('currentIntervalType'),
  currentIntervalName: el('currentIntervalName'),
  currentTargetPace: el('currentTargetPace'),
  intervalTimeRemaining: el('intervalTimeRemaining'),
  intervalProgressFill: el('intervalProgressFill'),
  upcomingIntervals: el('upcomingIntervals'),

  // Buttons
  btnConnectTreadmill: el('btnConnectTreadmill'),
  btnDisconnectTreadmill: el('btnDisconnectTreadmill'),
  btnConnectHR: el('btnConnectHR'),
  btnDisconnectHR: el('btnDisconnectHR'),
  btnStartStop: el('btnStartStop'),
  btnLap: el('btnLap'),
  btnReset: el('btnReset'),
  btnExportTCX: el('btnExportTCX'),
  btnExportFIT: el('btnExportFIT'),
  btnUploadStrava: el('btnUploadStrava'),

  // Metrics
  mPace: el('mPace'),
  mSpeed: el('mSpeed'),
  mDistance: el('mDistance'),
  mDuration: el('mDuration'),
  mAvgPace: el('mAvgPace'),
  mAvgSpeed: el('mAvgSpeed'),
  mHR: el('mHR'),
  hrValue: el('hrValue'),
  hrIcon: el('hrIcon'),
  mAvgHR: el('mAvgHR'),

  // Lap
  lapNumber: el('lapNumber'),
  lapModeLabel: el('lapModeLabel'),
  lapDistance: el('lapDistance'),
  lapTime: el('lapTime'),
  lapPace: el('lapPace'),
  lapHistory: el('lapHistory'),

  // Export
  exportSummary: el('exportSummary'),
  stravaStatus: el('stravaStatus'),

  // Layout
  metricsGrid: el('metricsGrid'),

  // Log
  log: el('log')
};

// ===== State =====
let generatedWorkout = null;

// ===== Logging =====
function log(...args) {
  const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  const time = new Date().toLocaleTimeString();
  if (ui.log) {
    ui.log.textContent = `[${time}] ${line}\n` + ui.log.textContent;
  }
  console.log(`[${time}]`, ...args);
}

// ===== View Navigation =====
function showView(viewName) {
  ui.landingPage.style.display = 'none';
  ui.workoutCreator.style.display = 'none';
  ui.treadmillApp.style.display = 'none';

  if (viewName === 'landing') ui.landingPage.style.display = 'flex';
  else if (viewName === 'creator') ui.workoutCreator.style.display = 'block';
  else if (viewName === 'treadmill') ui.treadmillApp.style.display = 'block';
}

// ===== Workout Generator =====
async function handleGenerateWorkout() {
  const prompt = ui.workoutPrompt.value.trim();
  if (!prompt) {
    ui.generatorStatus.textContent = 'Please describe your workout first.';
    ui.generatorStatus.className = 'generator-status error';
    return;
  }

  ui.generatorStatus.textContent = 'Generating your workout...';
  ui.generatorStatus.className = 'generator-status loading';
  ui.btnGenerateWorkout.disabled = true;

  try {
    const workout = await generateWorkout(prompt);
    generatedWorkout = workout;

    // Display the generated workout
    ui.workoutName.textContent = workout.name || 'Custom Workout';
    ui.workoutDescription.textContent = workout.description || '';
    ui.workoutDuration.textContent = workout.totalDuration || formatIntervalTime(getTotalWorkoutDurationFromIntervals(workout.intervals));

    renderIntervalsTimeline(ui.intervalsTimeline, workout.intervals);
    renderIntervalsList(ui.intervalsList, workout.intervals);

    ui.workoutPreview.style.display = 'block';
    ui.generatorStatus.textContent = '';
    ui.generatorStatus.className = 'generator-status';

    log('Workout generated:', workout.name);
  } catch (err) {
    ui.generatorStatus.textContent = `Error: ${err.message}`;
    ui.generatorStatus.className = 'generator-status error';
    log('Workout generation error:', err.message);
  } finally {
    ui.btnGenerateWorkout.disabled = false;
  }
}

function getTotalWorkoutDurationFromIntervals(intervals) {
  if (!intervals) return 0;
  return intervals.reduce((sum, i) => sum + (i.duration || 0), 0);
}

function startStructuredWorkout() {
  if (!generatedWorkout || !generatedWorkout.intervals) {
    log('No workout to start');
    return;
  }

  // Set the active workout
  setActiveWorkout(generatedWorkout);

  // Update UI for structured workout mode
  ui.treadmillTitle.textContent = generatedWorkout.name || 'Structured Workout';
  ui.lapModeLabel.textContent = 'Auto-lap: Intervals';
  ui.activeIntervalPanel.style.display = 'flex';

  // Show treadmill view
  showView('treadmill');

  // Update interval display
  updateIntervalDisplay();

  log('Starting structured workout:', generatedWorkout.name);
}

function updateIntervalDisplay() {
  if (!hasActiveWorkout()) return;

  updateActiveIntervalDisplay({
    typeEl: ui.currentIntervalType,
    nameEl: ui.currentIntervalName,
    paceEl: ui.currentTargetPace,
    timeEl: ui.intervalTimeRemaining,
    progressEl: ui.intervalProgressFill,
    upcomingEl: ui.upcomingIntervals
  });
}

// ===== Bluetooth Callbacks =====
function onTreadmillData(speedKmh, nowMs) {
  workout.currentSpeedKmh = speedKmh || 0;

  if (workout.isRecording && speedKmh !== null) {
    const shouldTriggerLap = updateWorkoutData(speedKmh, nowMs);

    // Check for interval changes if in structured workout mode
    if (hasActiveWorkout()) {
      const intervalChanged = updateIntervalTiming(workout.elapsedSeconds);
      if (intervalChanged) {
        handleLapTrigger(true);
        updateIntervalDisplay();
      } else {
        updateIntervalDisplay();
      }
    } else if (shouldTriggerLap) {
      handleLapTrigger(true);
    }
  }

  updateDisplay();
}

function onTreadmillDisconnect() {
  ui.treadmillBadge.classList.remove('connected');
  ui.treadmillDevice.textContent = 'Disconnected';
  ui.btnConnectTreadmill.disabled = false;
  ui.btnDisconnectTreadmill.disabled = true;
}

function onHRData(hr) {
  workout.currentHR = hr;
  if (workout.isRecording) {
    addHRReading(hr);
  }
  updateDisplay();
}

function onHRDisconnect() {
  ui.hrBadge.classList.remove('connected');
  ui.hrDevice.textContent = 'Disconnected';
  ui.btnConnectHR.disabled = false;
  ui.btnDisconnectHR.disabled = true;
  ui.hrIcon.style.display = 'none';
}

// ===== Recording Control =====
function startRecording() {
  workout.isRecording = true;
  workout.startTime = new Date();
  workout.lastTimestampMs = null;

  ui.btnStartStop.textContent = 'Stop Recording';
  ui.btnStartStop.classList.remove('btn-success');
  ui.btnStartStop.classList.add('btn-danger');
  ui.btnLap.disabled = false;
  ui.btnReset.disabled = true;
  ui.treadmillBadge.classList.add('recording');

  log('Recording started');
}

function stopRecording() {
  workout.isRecording = false;

  ui.btnStartStop.textContent = 'Start Recording';
  ui.btnStartStop.classList.remove('btn-danger');
  ui.btnStartStop.classList.add('btn-success');
  ui.btnLap.disabled = true;
  ui.btnReset.disabled = false;

  const hasData = workout.trackpoints.length >= 2;
  ui.btnExportTCX.disabled = !hasData;
  ui.btnExportFIT.disabled = !hasData;
  ui.btnUploadStrava.disabled = !hasData;
  ui.treadmillBadge.classList.remove('recording');

  log('Recording stopped');
}

function handleLapTrigger(isAuto) {
  const lap = triggerLap(isAuto);
  if (lap) {
    const source = isAuto ? (hasActiveWorkout() ? 'interval' : 'auto') : 'manual';
    log(`Lap ${lap.number}: ${fmtDistance(lap.distanceMeters / 1000)} km in ${fmtTime(lap.timeSeconds)} (${source})`);
    renderLapHistory();
  }
}

function resetWorkout() {
  resetWorkoutState();
  clearActiveWorkout();

  // Reset UI to "Just Run" mode
  ui.treadmillTitle.textContent = 'Just Run';
  ui.lapModeLabel.textContent = 'Auto-lap: 1 km';
  ui.activeIntervalPanel.style.display = 'none';

  ui.btnReset.disabled = true;
  ui.btnExportTCX.disabled = true;
  ui.btnExportFIT.disabled = true;
  ui.btnUploadStrava.disabled = true;
  ui.lapHistory.innerHTML = '';
  ui.hrIcon.style.display = 'none';
  ui.exportSummary.innerHTML = '';
  ui.stravaStatus.textContent = '';

  updateTrack(0);
  updateDisplay();
  log('Workout reset');
}

// ===== Track Visualization =====
function updateTrack(distanceMeters) {
  const totalLaps = Math.floor(distanceMeters / TRACK_LENGTH_METERS);
  const lapProgress = (distanceMeters % TRACK_LENGTH_METERS) / TRACK_LENGTH_METERS;
  const metersInLap = Math.floor(distanceMeters % TRACK_LENGTH_METERS);

  ui.trackLapNum.textContent = totalLaps;
  ui.trackMeters.textContent = metersInLap;

  const dashOffset = TRACK_PATH_LENGTH * (1 - lapProgress);
  ui.trackProgress.style.strokeDashoffset = dashOffset;

  const pos = getTrackPosition(lapProgress);
  ui.runnerMarker.setAttribute('cx', pos.x);
  ui.runnerMarker.setAttribute('cy', pos.y);
}

// ===== Display Updates =====
function updateDisplay() {
  const speed = workout.currentSpeedKmh;
  const distanceKm = workout.distanceMeters / 1000;

  updateTrack(workout.distanceMeters);

  // Current metrics
  ui.mSpeed.textContent = fmtSpeed(speed);
  ui.mPace.textContent = fmtPace(speed);
  ui.mDistance.textContent = fmtDistance(distanceKm);
  ui.mDuration.textContent = fmtTime(workout.elapsedSeconds);

  // Averages
  if (workout.elapsedSeconds > 1 && distanceKm > 0.001) {
    const avgSpeed = distanceKm / (workout.elapsedSeconds / 3600);
    ui.mAvgSpeed.textContent = fmtSpeed(avgSpeed);
    ui.mAvgPace.textContent = fmtPaceFromTime(workout.elapsedSeconds, distanceKm);
  } else {
    ui.mAvgSpeed.textContent = '-.-';
    ui.mAvgPace.textContent = '--:--';
  }

  // HR
  ui.hrValue.textContent = workout.currentHR || '---';

  // Average HR
  const avgHR = getAverageHR();
  ui.mAvgHR.textContent = avgHR || '---';

  // Current lap
  ui.lapNumber.textContent = workout.currentLap.number;
  const lapDistanceKm = (workout.distanceMeters - workout.currentLap.startDistanceMeters) / 1000;
  const lapTimeSeconds = workout.elapsedSeconds - workout.currentLap.startTimeSeconds;
  ui.lapDistance.textContent = fmtDistance(lapDistanceKm);
  ui.lapTime.textContent = fmtTime(lapTimeSeconds);
  ui.lapPace.textContent = fmtPaceFromTime(lapTimeSeconds, lapDistanceKm);

  // Update interval display if in structured workout
  if (hasActiveWorkout() && workout.isRecording) {
    updateIntervalDisplay();
  }

  updateExportSummary();
}

function updateExportSummary() {
  if (workout.trackpoints.length > 0) {
    const currentLapDist = workout.distanceMeters - workout.currentLap.startDistanceMeters;
    const laps = workout.laps.length + (currentLapDist > 10 ? 1 : 0);
    ui.exportSummary.innerHTML = `
      <span>${workout.trackpoints.length} pts</span>
      <span>${laps} lap${laps !== 1 ? 's' : ''}</span>
      <span>${workout.hrReadings.length > 0 ? 'HR ✓' : 'No HR'}</span>
    `;
  } else {
    ui.exportSummary.innerHTML = '';
  }
}

function renderLapHistory() {
  const html = workout.laps.map(lap => `
    <div class="lap-row">
      <span class="lap-num">${lap.number}</span>
      <span>${fmtDistance(lap.distanceMeters / 1000)} km</span>
      <span>${fmtTime(lap.timeSeconds)}</span>
      <span>${fmtPaceFromTime(lap.timeSeconds, lap.distanceMeters / 1000)} /km</span>
    </div>
  `).reverse().join('');
  ui.lapHistory.innerHTML = html;
}

// ===== Metrics Layout (simplified) =====
function loadLayout() {
  // Layout persistence removed - using fixed compact layout
}

function setupMetricsDragDrop() {
  // Drag/drop/resize removed for compact layout
}

// ===== Strava Integration =====
function setupStrava() {
  setStravaCallbacks({
    onStatus: (message, type) => {
      ui.stravaStatus.innerHTML = message;
      ui.stravaStatus.className = 'strava-status' + (type ? ` ${type}` : '');
    },
    onToken: (token, athleteName) => {
      updateStravaButton();

      const pendingData = restorePendingWorkout();
      if (pendingData && pendingData.trackpoints && pendingData.trackpoints.length >= 2) {
        // Restore workout state
        workout.startTime = pendingData.startTime ? new Date(pendingData.startTime) : null;
        workout.distanceMeters = pendingData.distanceMeters || 0;
        workout.elapsedSeconds = pendingData.elapsedSeconds || 0;
        workout.trackpoints = pendingData.trackpoints || [];
        workout.laps = pendingData.laps || [];
        workout.hrReadings = pendingData.hrReadings || [];

        ui.stravaStatus.textContent = `Connected as ${athleteName || 'Strava'}! Uploading workout...`;
        ui.stravaStatus.className = 'strava-status success';

        setTimeout(() => handleStravaUpload(), 500);
      } else {
        ui.stravaStatus.textContent = athleteName ? `Connected as ${athleteName}!` : 'Connected to Strava!';
        ui.stravaStatus.className = 'strava-status success';
      }
    }
  });

  loadStravaConfig();
  handleStravaCallback();
  checkPendingWorkout();
  updateStravaButton();
}

function updateStravaButton() {
  const token = getStravaToken();
  if (token) {
    ui.btnUploadStrava.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M6.731 0L2 9.125h2.788L6.73 5.497l1.93 3.628h2.766L6.731 0zm4.694 9.125l-1.372 2.756L8.66 9.125H6.547L10.053 16l3.506-6.875h-2.134z"/>
      </svg>
      Upload to Strava
    `;
  }
}

function checkPendingWorkout() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('strava_token')) return;

  if (hasPendingWorkout() && getStravaToken()) {
    const data = restorePendingWorkout();
    if (data && data.trackpoints && data.trackpoints.length >= 2) {
      ui.stravaStatus.innerHTML = `
        <strong>Pending workout found!</strong>
        <button id="btnRestoreUpload" style="margin-left:8px;padding:4px 12px;background:var(--accent);color:white;border:none;border-radius:4px;cursor:pointer;">Upload Now</button>
        <button id="btnDismissPending" style="margin-left:4px;padding:4px 8px;background:var(--card-bg);border:1px solid var(--card-border);border-radius:4px;cursor:pointer;">Dismiss</button>
      `;
      ui.stravaStatus.className = 'strava-status';

      document.getElementById('btnRestoreUpload')?.addEventListener('click', () => {
        workout.startTime = data.startTime ? new Date(data.startTime) : null;
        workout.distanceMeters = data.distanceMeters || 0;
        workout.elapsedSeconds = data.elapsedSeconds || 0;
        workout.trackpoints = data.trackpoints || [];
        workout.laps = data.laps || [];
        workout.hrReadings = data.hrReadings || [];
        updateDisplay();
        ui.btnUploadStrava.disabled = false;
        handleStravaUpload();
      });

      document.getElementById('btnDismissPending')?.addEventListener('click', () => {
        clearPendingWorkout();
        ui.stravaStatus.textContent = '';
      });
    }
  }
}

async function handleStravaUpload() {
  const token = getStravaToken();

  if (!token) {
    const workoutData = {
      startTime: workout.startTime ? workout.startTime.toISOString() : null,
      distanceMeters: workout.distanceMeters,
      elapsedSeconds: workout.elapsedSeconds,
      trackpoints: workout.trackpoints,
      laps: workout.laps,
      hrReadings: workout.hrReadings
    };
    connectToStrava(workoutData);
    return;
  }

  const startTime = workout.startTime || new Date();
  const laps = getLapsForExport();
  await uploadToStrava(startTime, workout.trackpoints, laps, workout.hrReadings);
}

// ===== Event Listeners Setup =====
function setupEventListeners() {
  // Navigation
  ui.btnCreateWorkout.addEventListener('click', () => showView('creator'));
  ui.btnJustRun.addEventListener('click', () => {
    clearActiveWorkout();
    ui.treadmillTitle.textContent = 'Just Run';
    ui.lapModeLabel.textContent = 'Auto-lap: 1 km';
    ui.activeIntervalPanel.style.display = 'none';
    showView('treadmill');
  });
  ui.btnBackFromCreator.addEventListener('click', () => showView('landing'));
  ui.btnBackFromTreadmill.addEventListener('click', () => {
    // Warn if recording
    if (workout.isRecording) {
      if (!confirm('Recording in progress. Are you sure you want to go back?')) {
        return;
      }
      stopRecording();
    }
    showView('landing');
  });

  // Workout Creator
  ui.btnGenerateWorkout.addEventListener('click', handleGenerateWorkout);
  ui.btnEditWorkout.addEventListener('click', () => {
    ui.workoutPreview.style.display = 'none';
    generatedWorkout = null;
  });
  ui.btnStartWorkout.addEventListener('click', startStructuredWorkout);

  // Bluetooth connections
  ui.btnConnectTreadmill.addEventListener('click', async () => {
    try {
      const deviceName = await connectTreadmill();
      ui.treadmillDevice.textContent = deviceName;
      ui.treadmillBadge.classList.add('connected');
      ui.btnConnectTreadmill.disabled = true;
      ui.btnDisconnectTreadmill.disabled = false;
      ui.btnStartStop.disabled = false;
    } catch (err) {
      log('Treadmill error:', err?.message || String(err));
      ui.treadmillDevice.textContent = 'Error';
    }
  });

  ui.btnDisconnectTreadmill.addEventListener('click', async () => {
    await disconnectTreadmill();
    ui.treadmillBadge.classList.remove('connected');
    ui.treadmillDevice.textContent = 'No device';
    ui.btnConnectTreadmill.disabled = false;
    ui.btnDisconnectTreadmill.disabled = true;
  });

  ui.btnConnectHR.addEventListener('click', async () => {
    try {
      const deviceName = await connectHR();
      ui.hrDevice.textContent = deviceName;
      ui.hrBadge.classList.add('connected');
      ui.btnConnectHR.disabled = true;
      ui.btnDisconnectHR.disabled = false;
      ui.hrIcon.style.display = 'inline';
    } catch (err) {
      log('HR error:', err?.message || String(err));
      ui.hrDevice.textContent = 'Error';
    }
  });

  ui.btnDisconnectHR.addEventListener('click', async () => {
    await disconnectHR();
    ui.hrBadge.classList.remove('connected');
    ui.hrDevice.textContent = 'No device';
    ui.btnConnectHR.disabled = false;
    ui.btnDisconnectHR.disabled = true;
    ui.hrIcon.style.display = 'none';
  });

  // Recording controls
  ui.btnStartStop.addEventListener('click', () => {
    if (workout.isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });

  ui.btnLap.addEventListener('click', () => handleLapTrigger(false));
  ui.btnReset.addEventListener('click', resetWorkout);

  // Export
  ui.btnExportTCX.addEventListener('click', () => {
    const startTime = workout.startTime || new Date();
    const laps = getLapsForExport();
    exportTCX(startTime, workout.trackpoints, laps, workout.hrReadings, log);
  });

  ui.btnExportFIT.addEventListener('click', () => {
    const startTime = workout.startTime || new Date();
    const laps = getLapsForExport();
    exportFIT(startTime, workout.trackpoints, laps, workout.distanceMeters, workout.elapsedSeconds, log);
  });

  ui.btnUploadStrava.addEventListener('click', handleStravaUpload);
}

// ===== Initialize =====
function init() {
  // Setup Bluetooth callbacks
  setBluetoothCallbacks({
    onTreadmillData,
    onTreadmillDisconnect,
    onHRData,
    onHRDisconnect,
    log
  });

  // Setup workout callbacks
  setWorkoutCallbacks({
    onInterval: (interval, prevIdx, newIdx) => {
      log(`Interval ${newIdx + 1}: ${interval.name}`);
    },
    onComplete: () => {
      log('Workout complete!');
    }
  });

  // Setup event listeners
  setupEventListeners();
  setupMetricsDragDrop();
  setupStrava();

  // Load saved layout
  loadLayout();

  // Initial display
  updateDisplay();

  log('Ready. Connect your treadmill to begin.');
}

// Start the app
init();
