// Pitch type definitions. Spin axes are for a right-handed pitcher (x is mirrored for lefties).
// Spin vector units: fraction of spin rate; sim coords (+x = 1B side, +y = toward CF, +z = up).
// A ball moving toward home (-y): backspin (-x) lifts, +z spin moves it toward 3B (RHP arm side).
export const PITCH_TYPES = {
  FF: { name: 'Four-Seam Fastball', short: '4-Seam', speed: 1.0, rpm: 2300, axis: [-0.92, 0.1, -0.38], perceive: 0.9, color: '#e0493f' },
  SI: { name: 'Sinker', short: 'Sinker', speed: 0.975, rpm: 2150, axis: [-0.5, 0.2, -0.84], perceive: 1.0, color: '#f08a3c' },
  FC: { name: 'Cutter', short: 'Cutter', speed: 0.94, rpm: 2350, axis: [-0.62, -0.55, 0.52], perceive: 1.05, color: '#b36b3d' },
  SL: { name: 'Slider', short: 'Slider', speed: 0.87, rpm: 2450, axis: [0.18, -0.82, 0.55], perceive: 1.25, color: '#e8c547' },
  CU: { name: 'Curveball', short: 'Curve', speed: 0.8, rpm: 2550, axis: [0.84, 0.15, 0.5], perceive: 1.3, color: '#4aa3df' },
  CH: { name: 'Changeup', short: 'Change', speed: 0.86, rpm: 1750, axis: [-0.6, 0.15, -0.78], perceive: 1.2, color: '#58c46b' },
  FS: { name: 'Splitter', short: 'Splitter', speed: 0.88, rpm: 1300, axis: [-0.45, 0.2, -0.45], perceive: 1.25, color: '#43c0b0' },
};

export const PITCH_ORDER = ['FF', 'SI', 'FC', 'SL', 'CU', 'CH', 'FS'];
export const FASTBALLS = new Set(['FF', 'SI', 'FC']);
export const BREAKING = new Set(['SL', 'CU']);
export const OFFSPEED = new Set(['CH', 'FS']);
