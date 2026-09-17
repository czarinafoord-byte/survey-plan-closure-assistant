(function () {
  'use strict';

  function dmsToDecimal(dms) {
    const value = String(dms).trim();
    const match = value.match(/^(\d{1,3})(?:\.(\d{0,4}))?$/);
    if (!match) throw new Error(`Invalid bearing "${value}". Use D.MMSS format.`);

    const degrees = Number(match[1]);
    const digits = (match[2] || '').padEnd(4, '0');
    const minutes = Number(digits.slice(0, 2));
    const seconds = Number(digits.slice(2, 4));

    if (degrees > 360 || minutes > 59 || seconds > 59 ||
        (degrees === 360 && (minutes !== 0 || seconds !== 0))) {
      throw new Error(`Invalid bearing "${value}". Minutes and seconds must each be less than 60.`);
    }
    return degrees + minutes / 60 + seconds / 3600;
  }

  function decimalToDmsInput(decimalDegrees) {
    const fullCircleSeconds = 360 * 60 * 60;
    const rawSeconds = Math.round(decimalDegrees * 3600);
    let seconds = ((rawSeconds % fullCircleSeconds) + fullCircleSeconds) % fullCircleSeconds;
    if (seconds === 0 && rawSeconds > 0) seconds = fullCircleSeconds;

    const degrees = Math.floor(seconds / 3600);
    const remainder = seconds % 3600;
    const minutes = Math.floor(remainder / 60);
    const finalSeconds = remainder % 60;
    return `${degrees}.${String(minutes).padStart(2, '0')}${String(finalSeconds).padStart(2, '0')}`;
  }

  function formatDms(decimalDegrees) {
    let degrees = Math.floor(decimalDegrees);
    let remainder = decimalDegrees - degrees;
    let minutes = Math.floor(remainder * 60);
    let seconds = Math.round(((remainder * 60) - minutes) * 60);
    if (seconds === 60) { seconds = 0; minutes += 1; }
    if (minutes === 60) { minutes = 0; degrees += 1; }
    return `${degrees}°${String(minutes).padStart(2, '0')}'${String(seconds).padStart(2, '0')}"`;
  }

  function adjustBearing(dms, adjustment) {
    return decimalToDmsInput(dmsToDecimal(dms) + adjustment);
  }

  function bearingFromDelta(deltaEast, deltaNorth) {
    let angle = Math.atan2(deltaEast, deltaNorth) * 180 / Math.PI;
    if (angle < 0) angle += 360;
    return angle;
  }

  function validateLeg(raw, index) {
    const leg = {
      type: raw.type === 'Curve' ? 'Curve' : 'Straight',
      bearing: String(raw.bearing || '').trim(),
      distance: Number(raw.distance),
      radius: raw.radius === '' || raw.radius == null ? NaN : Number(raw.radius),
      direction: String(raw.direction || '').trim().toUpperCase(),
      page: raw.page || ''
    };
    dmsToDecimal(leg.bearing);
    if (!Number.isFinite(leg.distance) || leg.distance <= 0) {
      throw new Error(`Leg ${index + 1}: enter a positive distance or arc length.`);
    }
    if (leg.type === 'Curve') {
      if (!Number.isFinite(leg.radius) || leg.radius <= 0) {
        throw new Error(`Leg ${index + 1}: enter a positive curve radius.`);
      }
      if (!['L', 'R'].includes(leg.direction)) {
        throw new Error(`Leg ${index + 1}: curve direction must be L or R.`);
      }
    }
    return leg;
  }

  function calculateTraverse(rawLegs, startNorth = 500000, startEast = 100000) {
    if (!Array.isArray(rawLegs) || rawLegs.length === 0) throw new Error('Add at least one traverse leg.');
    const legs = rawLegs.map(validateLeg);
    const coordinates = [{ north: startNorth, east: startEast }];
    const segments = [];
    let totalDistance = 0;
    let arcAreaCorrection = 0;

    legs.forEach((leg, index) => {
      const start = coordinates[coordinates.length - 1];
      const bearing = dmsToDecimal(leg.bearing);
      let end;

      if (leg.type === 'Straight') {
        const radians = bearing * Math.PI / 180;
        end = {
          north: start.north + leg.distance * Math.cos(radians),
          east: start.east + leg.distance * Math.sin(radians)
        };
        totalDistance += leg.distance;
        segments.push({ type: 'Straight', start, end, bearing, length: leg.distance, legIndex: index });
      } else {
        const sign = leg.direction === 'R' ? 1 : -1;
        const deltaRadians = leg.distance / leg.radius;
        const deltaDegrees = deltaRadians * 180 / Math.PI;
        const chordLength = 2 * leg.radius * Math.sin(deltaRadians / 2);
        let chordBearing = leg.direction === 'R'
          ? bearing - (90 - deltaDegrees / 2)
          : bearing + (90 - deltaDegrees / 2);
        chordBearing = ((chordBearing % 360) + 360) % 360;
        const chordRadians = chordBearing * Math.PI / 180;
        const deltaEast = chordLength * Math.sin(chordRadians);
        const deltaNorth = chordLength * Math.cos(chordRadians);
        end = { north: start.north + deltaNorth, east: start.east + deltaEast };

        const middleEast = (start.east + end.east) / 2;
        const middleNorth = (start.north + end.north) / 2;
        const chordUnitEast = deltaEast / chordLength;
        const chordUnitNorth = deltaNorth / chordLength;
        const perpendicularEast = leg.direction === 'R' ? chordUnitNorth : -chordUnitNorth;
        const perpendicularNorth = leg.direction === 'R' ? -chordUnitEast : chordUnitEast;
        const middleToCenter = leg.radius * Math.cos(deltaRadians / 2);
        const center = {
          east: middleEast + perpendicularEast * middleToCenter,
          north: middleNorth + perpendicularNorth * middleToCenter
        };
        const startAngle = Math.atan2(start.north - center.north, start.east - center.east);
        const endAngle = Math.atan2(end.north - center.north, end.east - center.east);
        const segmentArea = sign * 0.5 * leg.radius * leg.radius * (deltaRadians - Math.sin(deltaRadians));
        let radialEndBearing = bearing - 180 + sign * deltaDegrees;
        radialEndBearing = ((radialEndBearing % 360) + 360) % 360;

        totalDistance += leg.distance;
        arcAreaCorrection += segmentArea;
        segments.push({
          type: 'Curve', start, end, bearing, length: chordLength, arc: leg.distance,
          radius: leg.radius, direction: leg.direction, deltaRadians, deltaDegrees,
          chordBearing, center, startAngle, endAngle, segmentArea, radialEndBearing,
          legIndex: index
        });
      }
      coordinates.push(end);
    });

    let shoelace = 0;
    for (let index = 0; index < coordinates.length; index += 1) {
      const next = (index + 1) % coordinates.length;
      shoelace += coordinates[index].east * coordinates[next].north
        - coordinates[next].east * coordinates[index].north;
    }
    const chordArea = Math.abs(shoelace / 2);
    const area = chordArea + arcAreaCorrection;
    const end = coordinates[coordinates.length - 1];
    const closureEast = startEast - end.east;
    const closureNorth = startNorth - end.north;
    const misclosure = Math.hypot(closureEast, closureNorth);
    const closureBearing = bearingFromDelta(closureEast, closureNorth);
    const errorOfClosure = misclosure > 0 ? totalDistance / misclosure : Infinity;

    return {
      legs, coordinates, segments, totalDistance, chordArea, arcAreaCorrection, area,
      end, closureEast, closureNorth, misclosure, closureBearing, errorOfClosure,
      startNorth, startEast
    };
  }

  function buildReport(result) {
    const lines = [];
    lines.push('Leg  Segment  Azimuth       Length   End_Northing   End_Easting   Page');
    lines.push('---  -------  -------       ------   ------------   -----------   ----');
    result.segments.forEach((segment, index) => {
      const bearing = segment.type === 'Curve' ? segment.chordBearing : segment.bearing;
      const page = result.legs[index].page || '—';
      lines.push(
        `${String(index + 1).padStart(3)}  ${segment.type.padEnd(7)}  ${formatDms(bearing).padStart(11)}  ` +
        `${segment.length.toFixed(3).padStart(8)}  ${segment.end.north.toFixed(3).padStart(13)}  ` +
        `${segment.end.east.toFixed(3).padStart(12)}  ${String(page).padStart(4)}`
      );
      if (segment.type === 'Curve') {
        lines.push(`     ARC=${segment.arc.toFixed(3)}  RAD=${segment.radius.toFixed(3)}  ` +
          `DELTA=${formatDms(segment.deltaDegrees)}  DIR=${segment.direction}`);
        lines.push(`     BC_TO_RAD=${formatDms(segment.bearing)}  RAD_TO_EC=${formatDms(segment.radialEndBearing)}`);
      }
    });
    lines.push('');
    lines.push(`Ending location (North, East): (${result.end.north.toFixed(3)}, ${result.end.east.toFixed(3)})`);
    lines.push(`Total Distance               : ${result.totalDistance.toFixed(3)}`);
    lines.push(`Total Traverse Stations      : ${result.legs.length + 1}`);
    lines.push(`Misclosure Direction         : ${formatDms(result.closureBearing)}`);
    lines.push(`Misclosure Distance          : ${result.misclosure.toFixed(3)}`);
    lines.push(`Error of Closure             : ${Number.isFinite(result.errorOfClosure) ? `1:${result.errorOfClosure.toFixed(1)}` : 'Closed'}`);
    lines.push(`AREA                         : ${result.area.toFixed(3)} sq. m.`);
    lines.push(`                               ${(result.area / 10000).toFixed(6)} hectares`);
    return lines.join('\n');
  }

  function sampleCurve(segment, count = 60) {
    const points = [];
    const sweep = segment.direction === 'R' ? -segment.deltaRadians : segment.deltaRadians;
    for (let index = 0; index <= count; index += 1) {
      const angle = segment.startAngle + sweep * index / count;
      points.push({
        east: segment.center.east + segment.radius * Math.cos(angle),
        north: segment.center.north + segment.radius * Math.sin(angle)
      });
    }
    return points;
  }

  function drawTraverse(canvas, result) {
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    const allPoints = result.coordinates.map(point => ({ ...point }));
    result.segments.forEach(segment => {
      if (segment.type === 'Curve') allPoints.push(...sampleCurve(segment));
    });

    const eastValues = allPoints.map(point => point.east);
    const northValues = allPoints.map(point => point.north);
    const minEast = Math.min(...eastValues);
    const maxEast = Math.max(...eastValues);
    const minNorth = Math.min(...northValues);
    const maxNorth = Math.max(...northValues);
    const spanEast = maxEast - minEast || 1;
    const spanNorth = maxNorth - minNorth || 1;
    const padding = 45;
    const scale = Math.min((canvas.width - padding * 2) / spanEast, (canvas.height - padding * 2) / spanNorth);
    const centerEast = (minEast + maxEast) / 2;
    const centerNorth = (minNorth + maxNorth) / 2;
    const toX = east => canvas.width / 2 + (east - centerEast) * scale;
    const toY = north => canvas.height / 2 - (north - centerNorth) * scale;

    result.segments.forEach(segment => {
      if (segment.type === 'Curve') {
        context.beginPath();
        context.moveTo(toX(segment.start.east), toY(segment.start.north));
        context.lineTo(toX(segment.end.east), toY(segment.end.north));
        context.strokeStyle = '#df861c';
        context.lineWidth = 2;
        context.stroke();

        const points = sampleCurve(segment);
        context.beginPath();
        points.forEach((point, index) => {
          if (index === 0) context.moveTo(toX(point.east), toY(point.north));
          else context.lineTo(toX(point.east), toY(point.north));
        });
        context.strokeStyle = '#1668cc';
        context.lineWidth = 2.5;
        context.stroke();
      } else {
        context.beginPath();
        context.moveTo(toX(segment.start.east), toY(segment.start.north));
        context.lineTo(toX(segment.end.east), toY(segment.end.north));
        context.strokeStyle = '#1668cc';
        context.lineWidth = 2.5;
        context.stroke();
      }
    });

    result.coordinates.forEach((point, index) => {
      context.beginPath();
      context.arc(toX(point.east), toY(point.north), 4, 0, Math.PI * 2);
      context.fillStyle = '#c73532';
      context.fill();
      context.fillStyle = '#26343e';
      context.font = '12px Calibri, sans-serif';
      context.fillText(String(index + 1), toX(point.east) + 7, toY(point.north) - 7);
    });
  }

  window.TraverseEngine = {
    dmsToDecimal,
    decimalToDmsInput,
    formatDms,
    adjustBearing,
    calculateTraverse,
    buildReport,
    drawTraverse
  };
}());
