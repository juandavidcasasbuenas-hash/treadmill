/**
 * Export functions for TCX and FIT file formats
 */

import { formatFilename, downloadFile } from './utils.js';

// FIT epoch: December 31, 1989 00:00:00 UTC
const FIT_EPOCH_SECONDS = Date.UTC(1989, 11, 31, 0, 0, 0) / 1000;

/**
 * Generate TCX file content
 */
export function generateTCXContent(startTime, trackpoints, laps, hrReadings) {
  const isoStart = startTime.toISOString();

  let lapsXml = '';

  for (let i = 0; i < laps.length; i++) {
    const lap = laps[i];
    const lapStartDate = new Date(startTime.getTime() + lap.startTimeSeconds * 1000);
    const isLastLap = i === laps.length - 1;

    const lapTrackpoints = trackpoints.filter(tp =>
      tp.time >= lap.startTimeSeconds && (isLastLap ? tp.time <= lap.endTimeSeconds : tp.time < lap.endTimeSeconds)
    );

    const lapHRReadings = hrReadings.filter(hr =>
      hr.time >= lap.startTimeSeconds && (isLastLap ? hr.time <= lap.endTimeSeconds : hr.time < lap.endTimeSeconds)
    );

    const avgHR = lapHRReadings.length > 0
      ? Math.round(lapHRReadings.reduce((a, b) => a + b.hr, 0) / lapHRReadings.length)
      : null;
    const maxHR = lapHRReadings.length > 0
      ? Math.max(...lapHRReadings.map(h => h.hr))
      : null;

    const lapSpeeds = lapTrackpoints.map(tp => tp.speedKmh || 0);
    const maxSpeed = lapSpeeds.length > 0 ? Math.max(...lapSpeeds) * 1000 / 3600 : 0;
    const avgSpeed = lap.timeSeconds > 0 ? lap.distanceMeters / lap.timeSeconds : 0;

    let trackpointsXml = '';
    for (const tp of lapTrackpoints) {
      const tpTime = new Date(startTime.getTime() + tp.time * 1000).toISOString();
      trackpointsXml += `
          <Trackpoint>
            <Time>${tpTime}</Time>
            <DistanceMeters>${tp.distanceMeters.toFixed(2)}</DistanceMeters>${tp.hr ? `
            <HeartRateBpm><Value>${tp.hr}</Value></HeartRateBpm>` : ''}
            <Extensions>
              <ns3:TPX>
                <ns3:Speed>${(tp.speedKmh * 1000 / 3600).toFixed(3)}</ns3:Speed>
              </ns3:TPX>
            </Extensions>
          </Trackpoint>`;
    }

    lapsXml += `
      <Lap StartTime="${lapStartDate.toISOString()}">
        <TotalTimeSeconds>${lap.timeSeconds.toFixed(1)}</TotalTimeSeconds>
        <DistanceMeters>${lap.distanceMeters.toFixed(2)}</DistanceMeters>
        <MaximumSpeed>${maxSpeed.toFixed(3)}</MaximumSpeed>
        <Calories>0</Calories>${avgHR ? `
        <AverageHeartRateBpm><Value>${avgHR}</Value></AverageHeartRateBpm>` : ''}${maxHR ? `
        <MaximumHeartRateBpm><Value>${maxHR}</Value></MaximumHeartRateBpm>` : ''}
        <Intensity>Active</Intensity>
        <TriggerMethod>Distance</TriggerMethod>
        <Track>${trackpointsXml}
        </Track>
        <Extensions>
          <ns3:LX>
            <ns3:AvgSpeed>${avgSpeed.toFixed(3)}</ns3:AvgSpeed>
          </ns3:LX>
        </Extensions>
      </Lap>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2"
  xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd">
  <Activities>
    <Activity Sport="Running">
      <Id>${isoStart}</Id>${lapsXml}
      <Creator xsi:type="Device_t">
        <Name>Treadmill Web App</Name>
        <UnitId>0</UnitId>
        <ProductID>0</ProductID>
      </Creator>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;
}

/**
 * Export TCX file
 */
export function exportTCX(startTime, trackpoints, laps, hrReadings, log) {
  if (trackpoints.length < 2) {
    alert('Not enough data to export');
    return;
  }

  log(`Exporting ${laps.length} lap(s)`);
  const tcx = generateTCXContent(startTime, trackpoints, laps, hrReadings);
  downloadFile(tcx, `workout_${formatFilename(startTime)}.tcx`, 'application/xml');
  log('Exported TCX file');
}

/**
 * Create FIT file
 */
export function createFITFile(startTime, trackpoints, laps, totalDistanceMeters, totalTimeSeconds) {
  const fitTimestamp = Math.floor(startTime.getTime() / 1000) - FIT_EPOCH_SECONDS;
  const records = [];

  // File ID message
  records.push(createFileIdMessage(fitTimestamp));

  // Record messages (trackpoints)
  for (const tp of trackpoints) {
    const tpTimestamp = fitTimestamp + Math.floor(tp.time);
    records.push(createRecordMessage(tpTimestamp, tp.distanceMeters, tp.speedKmh, tp.hr));
  }

  // Lap messages
  for (const lap of laps) {
    const lapStartTimestamp = fitTimestamp + Math.floor(lap.startTimeSeconds);
    records.push(createLapMessage(lapStartTimestamp, lap.timeSeconds, lap.distanceMeters));
  }

  // Session message
  records.push(createSessionMessage(fitTimestamp, totalDistanceMeters, totalTimeSeconds, laps.length));

  // Activity message
  records.push(createActivityMessage(fitTimestamp, totalTimeSeconds, laps.length));

  const dataContent = concatArrayBuffers(records);
  const header = createFITHeader(dataContent.byteLength);
  const fileContent = concatArrayBuffers([header, dataContent]);

  const crc = calculateFITCRC(new Uint8Array(fileContent));
  const crcBuffer = new ArrayBuffer(2);
  new DataView(crcBuffer).setUint16(0, crc, true);

  return new Blob([fileContent, crcBuffer], { type: 'application/octet-stream' });
}

/**
 * Export FIT file
 */
export function exportFIT(startTime, trackpoints, laps, totalDistanceMeters, totalTimeSeconds, log) {
  if (trackpoints.length < 2) {
    alert('Not enough data to export');
    return;
  }

  const fitData = createFITFile(startTime, trackpoints, laps, totalDistanceMeters, totalTimeSeconds);
  downloadFile(fitData, `workout_${formatFilename(startTime)}.fit`, 'application/octet-stream');
  log('Exported FIT file');
}

// FIT file helper functions
function createFITHeader(dataSize) {
  const buffer = new ArrayBuffer(14);
  const view = new DataView(buffer);

  view.setUint8(0, 14); // Header size
  view.setUint8(1, 32); // Protocol version (2.0)
  view.setUint16(2, 2132, true); // Profile version
  view.setUint32(4, dataSize, true);

  // ".FIT" signature
  view.setUint8(8, 0x2E);
  view.setUint8(9, 0x46);
  view.setUint8(10, 0x49);
  view.setUint8(11, 0x54);

  const headerCRC = calculateFITCRC(new Uint8Array(buffer, 0, 12));
  view.setUint16(12, headerCRC, true);

  return buffer;
}

function createFileIdMessage(timestamp) {
  const buffer = new ArrayBuffer(20);
  const view = new DataView(buffer);
  let offset = 0;

  // Definition message header
  view.setUint8(offset++, 0x40); // Definition, local type 0
  view.setUint8(offset++, 0);
  view.setUint8(offset++, 0); // Little endian
  view.setUint16(offset, 0, true); offset += 2; // file_id = 0
  view.setUint8(offset++, 2); // 2 fields

  // Field: type (field 0)
  view.setUint8(offset++, 0);
  view.setUint8(offset++, 1);
  view.setUint8(offset++, 0); // enum

  // Field: time_created (field 4)
  view.setUint8(offset++, 4);
  view.setUint8(offset++, 4);
  view.setUint8(offset++, 134); // uint32

  // Data message
  view.setUint8(offset++, 0x00); // Data, local type 0
  view.setUint8(offset++, 4); // type = activity
  view.setUint32(offset, timestamp, true); offset += 4;

  return buffer.slice(0, offset);
}

function createRecordMessage(timestamp, distanceMeters, speedKmh, hr) {
  const buffer = new ArrayBuffer(40);
  const view = new DataView(buffer);
  let offset = 0;

  // Definition message
  view.setUint8(offset++, 0x41); // Definition, local type 1
  view.setUint8(offset++, 0);
  view.setUint8(offset++, 0);
  view.setUint16(offset, 20, true); offset += 2; // record = 20
  view.setUint8(offset++, 4); // 4 fields

  // timestamp (field 253)
  view.setUint8(offset++, 253);
  view.setUint8(offset++, 4);
  view.setUint8(offset++, 134);

  // distance (field 5) - in cm
  view.setUint8(offset++, 5);
  view.setUint8(offset++, 4);
  view.setUint8(offset++, 134);

  // enhanced_speed (field 73) - in mm/s
  view.setUint8(offset++, 73);
  view.setUint8(offset++, 4);
  view.setUint8(offset++, 134);

  // heart_rate (field 3)
  view.setUint8(offset++, 3);
  view.setUint8(offset++, 1);
  view.setUint8(offset++, 2);

  // Data message
  view.setUint8(offset++, 0x01);
  view.setUint32(offset, timestamp, true); offset += 4;
  view.setUint32(offset, Math.round(distanceMeters * 100), true); offset += 4;
  view.setUint32(offset, Math.round((speedKmh || 0) * 1000 / 3.6), true); offset += 4;
  view.setUint8(offset++, hr || 255); // 255 = invalid

  return buffer.slice(0, offset);
}

function createLapMessage(startTimestamp, totalTimeSeconds, distanceMeters) {
  const buffer = new ArrayBuffer(60);
  const view = new DataView(buffer);
  let offset = 0;

  // Definition message
  view.setUint8(offset++, 0x42); // Definition, local type 2
  view.setUint8(offset++, 0);
  view.setUint8(offset++, 0);
  view.setUint16(offset, 19, true); offset += 2; // lap = 19
  view.setUint8(offset++, 6); // 6 fields

  // timestamp (field 253)
  view.setUint8(offset++, 253);
  view.setUint8(offset++, 4);
  view.setUint8(offset++, 134);

  // start_time (field 2)
  view.setUint8(offset++, 2);
  view.setUint8(offset++, 4);
  view.setUint8(offset++, 134);

  // total_elapsed_time (field 7) - in ms
  view.setUint8(offset++, 7);
  view.setUint8(offset++, 4);
  view.setUint8(offset++, 134);

  // total_timer_time (field 8) - in ms
  view.setUint8(offset++, 8);
  view.setUint8(offset++, 4);
  view.setUint8(offset++, 134);

  // total_distance (field 9) - in cm
  view.setUint8(offset++, 9);
  view.setUint8(offset++, 4);
  view.setUint8(offset++, 134);

  // event (field 0) - lap = 9
  view.setUint8(offset++, 0);
  view.setUint8(offset++, 1);
  view.setUint8(offset++, 0);

  // Data message
  view.setUint8(offset++, 0x02);
  const endTimestamp = startTimestamp + Math.floor(totalTimeSeconds);
  view.setUint32(offset, endTimestamp, true); offset += 4;
  view.setUint32(offset, startTimestamp, true); offset += 4;
  view.setUint32(offset, Math.round(totalTimeSeconds * 1000), true); offset += 4;
  view.setUint32(offset, Math.round(totalTimeSeconds * 1000), true); offset += 4;
  view.setUint32(offset, Math.round(distanceMeters * 100), true); offset += 4;
  view.setUint8(offset++, 9); // event = lap

  return buffer.slice(0, offset);
}

function createSessionMessage(timestamp, distanceMeters, timeSeconds, numLaps) {
  const buffer = new ArrayBuffer(60);
  const view = new DataView(buffer);
  let offset = 0;

  // Definition message
  view.setUint8(offset++, 0x43); // Definition, local type 3
  view.setUint8(offset++, 0);
  view.setUint8(offset++, 0);
  view.setUint16(offset, 18, true); offset += 2; // session = 18
  view.setUint8(offset++, 6); // 6 fields

  // timestamp (field 253)
  view.setUint8(offset++, 253);
  view.setUint8(offset++, 4);
  view.setUint8(offset++, 134);

  // total_elapsed_time (field 7)
  view.setUint8(offset++, 7);
  view.setUint8(offset++, 4);
  view.setUint8(offset++, 134);

  // total_timer_time (field 8)
  view.setUint8(offset++, 8);
  view.setUint8(offset++, 4);
  view.setUint8(offset++, 134);

  // total_distance (field 9)
  view.setUint8(offset++, 9);
  view.setUint8(offset++, 4);
  view.setUint8(offset++, 134);

  // sport (field 5)
  view.setUint8(offset++, 5);
  view.setUint8(offset++, 1);
  view.setUint8(offset++, 0);

  // num_laps (field 26)
  view.setUint8(offset++, 26);
  view.setUint8(offset++, 2);
  view.setUint8(offset++, 132);

  // Data message
  view.setUint8(offset++, 0x03);
  const endTimestamp = timestamp + Math.floor(timeSeconds);
  view.setUint32(offset, endTimestamp, true); offset += 4;
  view.setUint32(offset, Math.round(timeSeconds * 1000), true); offset += 4;
  view.setUint32(offset, Math.round(timeSeconds * 1000), true); offset += 4;
  view.setUint32(offset, Math.round(distanceMeters * 100), true); offset += 4;
  view.setUint8(offset++, 1); // Running
  view.setUint16(offset, numLaps, true); offset += 2;

  return buffer.slice(0, offset);
}

function createActivityMessage(timestamp, totalTimeSeconds, numSessions) {
  const buffer = new ArrayBuffer(40);
  const view = new DataView(buffer);
  let offset = 0;

  // Definition message
  view.setUint8(offset++, 0x44); // Definition, local type 4
  view.setUint8(offset++, 0);
  view.setUint8(offset++, 0);
  view.setUint16(offset, 34, true); offset += 2; // activity = 34
  view.setUint8(offset++, 4); // 4 fields

  // timestamp (field 253)
  view.setUint8(offset++, 253);
  view.setUint8(offset++, 4);
  view.setUint8(offset++, 134);

  // total_timer_time (field 0) - in ms
  view.setUint8(offset++, 0);
  view.setUint8(offset++, 4);
  view.setUint8(offset++, 134);

  // num_sessions (field 1)
  view.setUint8(offset++, 1);
  view.setUint8(offset++, 2);
  view.setUint8(offset++, 132);

  // type (field 2) - manual = 0
  view.setUint8(offset++, 2);
  view.setUint8(offset++, 1);
  view.setUint8(offset++, 0);

  // Data message
  view.setUint8(offset++, 0x04);
  const endTimestamp = timestamp + Math.floor(totalTimeSeconds);
  view.setUint32(offset, endTimestamp, true); offset += 4;
  view.setUint32(offset, Math.round(totalTimeSeconds * 1000), true); offset += 4;
  view.setUint16(offset, numSessions, true); offset += 2;
  view.setUint8(offset++, 0); // type = manual

  return buffer.slice(0, offset);
}

function concatArrayBuffers(buffers) {
  const totalLength = buffers.reduce((sum, buf) => sum + buf.byteLength, 0);
  const result = new ArrayBuffer(totalLength);
  const view = new Uint8Array(result);
  let offset = 0;
  for (const buf of buffers) {
    view.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return result;
}

function calculateFITCRC(data) {
  const crcTable = [
    0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
    0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400
  ];

  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    let tmp = crcTable[crc & 0xF];
    crc = (crc >> 4) & 0x0FFF;
    crc = crc ^ tmp ^ crcTable[byte & 0xF];
    tmp = crcTable[crc & 0xF];
    crc = (crc >> 4) & 0x0FFF;
    crc = crc ^ tmp ^ crcTable[(byte >> 4) & 0xF];
  }
  return crc;
}
