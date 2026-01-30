/**
 * Bluetooth device connections (Treadmill and HR Monitor)
 */

// Bluetooth service UUIDs
const FTMS_SERVICE = 0x1826;
const TREADMILL_DATA_CHAR = 0x2ACD;
const HR_SERVICE = 0x180D;
const HR_MEASUREMENT_CHAR = 0x2A37;

// Device state
let treadmillDevice = null;
let treadmillChar = null;
let hrDevice = null;
let hrChar = null;

// Callbacks
let onTreadmillDataCallback = null;
let onTreadmillDisconnectCallback = null;
let onHRDataCallback = null;
let onHRDisconnectCallback = null;
let logCallback = null;

// Set callbacks
export function setCallbacks({
  onTreadmillData,
  onTreadmillDisconnect,
  onHRData,
  onHRDisconnect,
  log
}) {
  onTreadmillDataCallback = onTreadmillData;
  onTreadmillDisconnectCallback = onTreadmillDisconnect;
  onHRDataCallback = onHRData;
  onHRDisconnectCallback = onHRDisconnect;
  logCallback = log;
}

function log(...args) {
  if (logCallback) logCallback(...args);
}

// Check if Web Bluetooth is available
export function isBluetoothAvailable() {
  return !!navigator.bluetooth;
}

// Check if treadmill is connected
export function isTreadmillConnected() {
  return treadmillChar !== null;
}

// Check if HR monitor is connected
export function isHRConnected() {
  return hrChar !== null;
}

// Connect to treadmill
export async function connectTreadmill() {
  if (!navigator.bluetooth) {
    log('Web Bluetooth not available');
    throw new Error('Web Bluetooth is not supported in this browser');
  }

  log('Requesting treadmill...');
  treadmillDevice = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [FTMS_SERVICE]
  });

  const deviceName = treadmillDevice.name || 'Unnamed device';
  treadmillDevice.addEventListener('gattserverdisconnected', handleTreadmillDisconnect);

  log('Connecting GATT...');
  const server = await treadmillDevice.gatt.connect();

  log('Getting FTMS service...');
  const service = await server.getPrimaryService(FTMS_SERVICE);

  log('Getting treadmill data characteristic...');
  treadmillChar = await service.getCharacteristic(TREADMILL_DATA_CHAR);

  await treadmillChar.startNotifications();
  treadmillChar.addEventListener('characteristicvaluechanged', handleTreadmillData);

  log('Treadmill connected successfully');
  return deviceName;
}

function handleTreadmillDisconnect() {
  log('Treadmill disconnected');
  treadmillChar = null;
  if (onTreadmillDisconnectCallback) onTreadmillDisconnectCallback();
}

function handleTreadmillData(event) {
  const dataView = event.target.value;
  const nowMs = performance.now();

  // Parse speed from FTMS data (offset 2, uint16, in 0.01 km/h units)
  let speedKmh = null;
  if (dataView.byteLength >= 4) {
    const rawSpeed = dataView.getUint16(2, true);
    speedKmh = rawSpeed / 100;
  }

  if (onTreadmillDataCallback) {
    onTreadmillDataCallback(speedKmh, nowMs);
  }
}

// Disconnect treadmill
export async function disconnectTreadmill() {
  try {
    if (treadmillChar) {
      treadmillChar.removeEventListener('characteristicvaluechanged', handleTreadmillData);
      await treadmillChar.stopNotifications().catch(() => {});
      treadmillChar = null;
    }
    if (treadmillDevice?.gatt?.connected) {
      treadmillDevice.gatt.disconnect();
    }
    log('Treadmill disconnected');
  } catch (err) {
    log('Disconnect error:', err?.message || String(err));
  }
}

// Connect to HR monitor
export async function connectHR() {
  if (!navigator.bluetooth) {
    throw new Error('Web Bluetooth is not supported in this browser');
  }

  log('Requesting HR monitor...');
  hrDevice = await navigator.bluetooth.requestDevice({
    filters: [{ services: [HR_SERVICE] }],
    optionalServices: [HR_SERVICE]
  });

  const deviceName = hrDevice.name || 'Unnamed device';
  hrDevice.addEventListener('gattserverdisconnected', handleHRDisconnect);

  log('Connecting HR GATT...');
  const server = await hrDevice.gatt.connect();

  log('Getting HR service...');
  const service = await server.getPrimaryService(HR_SERVICE);

  log('Getting HR measurement characteristic...');
  hrChar = await service.getCharacteristic(HR_MEASUREMENT_CHAR);

  await hrChar.startNotifications();
  hrChar.addEventListener('characteristicvaluechanged', handleHRData);

  log('HR monitor connected successfully');
  return deviceName;
}

function handleHRDisconnect() {
  log('HR monitor disconnected');
  hrChar = null;
  if (onHRDisconnectCallback) onHRDisconnectCallback();
}

function handleHRData(event) {
  const dataView = event.target.value;
  const flags = dataView.getUint8(0);
  const is16bit = flags & 0x01;
  const hr = is16bit ? dataView.getUint16(1, true) : dataView.getUint8(1);

  if (onHRDataCallback) onHRDataCallback(hr);
}

// Disconnect HR monitor
export async function disconnectHR() {
  try {
    if (hrChar) {
      hrChar.removeEventListener('characteristicvaluechanged', handleHRData);
      await hrChar.stopNotifications().catch(() => {});
      hrChar = null;
    }
    if (hrDevice?.gatt?.connected) {
      hrDevice.gatt.disconnect();
    }
    log('HR monitor disconnected');
  } catch (err) {
    log('HR disconnect error:', err?.message || String(err));
  }
}
