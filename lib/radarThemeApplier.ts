import { RadarThemeMode, CLASSIC_REFLECTIVITY_COLORS, CLASSIC_VELOCITY_COLORS, GUTOSCOPE_REFLECTIVITY, GUTOSCOPE_VELOCITY } from './radarThemeColors';

function colorDistanceSq(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) {
  return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
}

export function applyThemeToReflectivity(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue; // transparent
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    let closestDbz = 0;
    let minDist = Infinity;
    
    // Find closest classic color
    for (const c of CLASSIC_REFLECTIVITY_COLORS) {
      const d = colorDistanceSq(r, g, b, c.r, c.g, c.b);
      if (d < minDist) {
        minDist = d;
        closestDbz = c.dBZ;
      }
    }
    
    // Don't recolor if it's too far from any known color (might be an edge/artifact)
    if (minDist > 10000) continue;

    // Find the corresponding GutoScope color
    let gutoColor = GUTOSCOPE_REFLECTIVITY[0].color; // default to transparent
    for (const gc of GUTOSCOPE_REFLECTIVITY) {
      if (closestDbz <= gc.threshold) {
        gutoColor = gc.color;
        break;
      }
    }

    if (gutoColor.r === 0 && gutoColor.g === 0 && gutoColor.b === 0 && closestDbz <= 0) {
        data[i + 3] = 0; // Make transparent
    } else {
        data[i] = gutoColor.r;
        data[i + 1] = gutoColor.g;
        data[i + 2] = gutoColor.b;
    }
  }
}

export function applyThemeToVelocity(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue; // transparent
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    let closestVel = 0;
    let minDist = Infinity;
    
    // Find closest classic color
    for (const c of CLASSIC_VELOCITY_COLORS) {
      const d = colorDistanceSq(r, g, b, c.r, c.g, c.b);
      if (d < minDist) {
        minDist = d;
        closestVel = c.vel;
      }
    }
    
    // Don't recolor if it's too far from any known color
    if (minDist > 10000) continue;

    // Find the corresponding GutoScope color
    let gutoColor = GUTOSCOPE_VELOCITY[GUTOSCOPE_VELOCITY.length - 1].color; 
    for (const gc of GUTOSCOPE_VELOCITY) {
      if (closestVel <= gc.threshold) {
        gutoColor = gc.color;
        break;
      }
    }

    data[i] = gutoColor.r;
    data[i + 1] = gutoColor.g;
    data[i + 2] = gutoColor.b;
  }
}
