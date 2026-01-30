/**
 * Workout generation and execution module
 */

// Active workout state
let activeWorkout = null;
let currentIntervalIndex = 0;
let intervalStartTime = null;
let intervalElapsedSeconds = 0;

// Callbacks
let onIntervalChange = null;
let onWorkoutComplete = null;

export function setWorkoutCallbacks({ onInterval, onComplete }) {
  onIntervalChange = onInterval;
  onWorkoutComplete = onComplete;
}

/**
 * Generate a workout using the Gemini AI API
 */
export async function generateWorkout(prompt) {
  const response = await fetch('/api/generate-workout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt })
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error);
  }

  return data.workout;
}

/**
 * Set the active workout for execution
 */
export function setActiveWorkout(workout) {
  activeWorkout = workout;
  currentIntervalIndex = 0;
  intervalStartTime = null;
  intervalElapsedSeconds = 0;
}

/**
 * Get the active workout
 */
export function getActiveWorkout() {
  return activeWorkout;
}

/**
 * Clear the active workout
 */
export function clearActiveWorkout() {
  activeWorkout = null;
  currentIntervalIndex = 0;
  intervalStartTime = null;
  intervalElapsedSeconds = 0;
}

/**
 * Check if there's an active structured workout
 */
export function hasActiveWorkout() {
  return activeWorkout !== null && activeWorkout.intervals && activeWorkout.intervals.length > 0;
}

/**
 * Get current interval
 */
export function getCurrentInterval() {
  if (!activeWorkout || !activeWorkout.intervals) return null;
  return activeWorkout.intervals[currentIntervalIndex] || null;
}

/**
 * Get upcoming intervals (next 3)
 */
export function getUpcomingIntervals() {
  if (!activeWorkout || !activeWorkout.intervals) return [];
  return activeWorkout.intervals.slice(currentIntervalIndex + 1, currentIntervalIndex + 4);
}

/**
 * Get interval progress (0-1)
 */
export function getIntervalProgress() {
  const interval = getCurrentInterval();
  if (!interval || !interval.duration) return 0;
  return Math.min(intervalElapsedSeconds / interval.duration, 1);
}

/**
 * Get time remaining in current interval (seconds)
 */
export function getIntervalTimeRemaining() {
  const interval = getCurrentInterval();
  if (!interval || !interval.duration) return 0;
  return Math.max(interval.duration - intervalElapsedSeconds, 0);
}

/**
 * Format seconds to mm:ss
 */
export function formatIntervalTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Update interval timing - call this every second during workout
 * Returns true if interval changed (auto-lap should trigger)
 */
export function updateIntervalTiming(elapsedWorkoutSeconds) {
  if (!hasActiveWorkout()) return false;

  // Calculate which interval we should be in based on total elapsed time
  let accumulatedTime = 0;
  let newIntervalIndex = 0;

  for (let i = 0; i < activeWorkout.intervals.length; i++) {
    const interval = activeWorkout.intervals[i];
    if (elapsedWorkoutSeconds < accumulatedTime + interval.duration) {
      newIntervalIndex = i;
      intervalElapsedSeconds = elapsedWorkoutSeconds - accumulatedTime;
      break;
    }
    accumulatedTime += interval.duration;

    // Check if we've completed all intervals
    if (i === activeWorkout.intervals.length - 1) {
      // Workout complete
      if (onWorkoutComplete) {
        onWorkoutComplete();
      }
      return false;
    }
  }

  // Check if interval changed
  if (newIntervalIndex !== currentIntervalIndex) {
    const previousIndex = currentIntervalIndex;
    currentIntervalIndex = newIntervalIndex;

    if (onIntervalChange) {
      onIntervalChange(getCurrentInterval(), previousIndex, newIntervalIndex);
    }

    return true; // Signal that a lap/interval change occurred
  }

  return false;
}

/**
 * Get total workout duration in seconds
 */
export function getTotalWorkoutDuration() {
  if (!activeWorkout || !activeWorkout.intervals) return 0;
  return activeWorkout.intervals.reduce((sum, i) => sum + (i.duration || 0), 0);
}

/**
 * Check if workout is complete
 */
export function isWorkoutComplete(elapsedSeconds) {
  return elapsedSeconds >= getTotalWorkoutDuration();
}

/**
 * Render the intervals timeline (visual bar)
 */
export function renderIntervalsTimeline(container, intervals) {
  if (!container || !intervals) return;

  const totalDuration = intervals.reduce((sum, i) => sum + (i.duration || 0), 0);
  if (totalDuration === 0) return;

  container.innerHTML = intervals.map((interval, index) => {
    const widthPercent = ((interval.duration || 0) / totalDuration) * 100;
    return `<div class="timeline-segment ${interval.type || 'work'}"
                 style="width: ${widthPercent}%"
                 title="${interval.name}: ${formatIntervalTime(interval.duration)}"></div>`;
  }).join('');
}

/**
 * Render the intervals list
 */
export function renderIntervalsList(container, intervals) {
  if (!container || !intervals) return;

  container.innerHTML = intervals.map((interval, index) => `
    <div class="interval-item" data-index="${index}">
      <div class="interval-type-indicator ${interval.type || 'work'}"></div>
      <div class="interval-details">
        <div class="interval-name">${interval.name}</div>
        <div class="interval-meta">${interval.targetPace}/km @ ${interval.targetSpeed} km/h</div>
      </div>
      <div class="interval-duration">${formatIntervalTime(interval.duration)}</div>
    </div>
  `).join('');
}

/**
 * Render upcoming intervals in the active panel
 */
export function renderUpcomingIntervals(container) {
  if (!container) return;

  const upcoming = getUpcomingIntervals();

  if (upcoming.length === 0) {
    container.innerHTML = '<div class="upcoming-item"><span class="upcoming-item-name" style="color: var(--text-muted);">Finishing soon...</span></div>';
    return;
  }

  container.innerHTML = upcoming.map(interval => `
    <div class="upcoming-item">
      <div class="upcoming-item-indicator ${interval.type || 'work'}"></div>
      <span class="upcoming-item-name">${interval.name}</span>
      <span class="upcoming-item-duration">${formatIntervalTime(interval.duration)}</span>
    </div>
  `).join('');
}

/**
 * Update the active interval display
 */
export function updateActiveIntervalDisplay(elements) {
  const interval = getCurrentInterval();
  if (!interval || !elements) return;

  const { typeEl, nameEl, paceEl, timeEl, progressEl, upcomingEl } = elements;

  if (typeEl) {
    typeEl.textContent = (interval.type || 'work').toUpperCase();
    typeEl.className = 'interval-type-badge';
    typeEl.setAttribute('data-type', interval.type || 'work');
  }

  if (nameEl) {
    nameEl.textContent = interval.name;
  }

  if (paceEl) {
    paceEl.textContent = interval.targetPace || '--:--';
  }

  if (timeEl) {
    timeEl.textContent = formatIntervalTime(getIntervalTimeRemaining());
  }

  if (progressEl) {
    progressEl.style.width = `${getIntervalProgress() * 100}%`;
  }

  if (upcomingEl) {
    renderUpcomingIntervals(upcomingEl);
  }
}
