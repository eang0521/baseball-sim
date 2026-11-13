// Regression terms shared by calibrate.mjs and import.mjs: 1, z_i, z_i*z_j (i<=j), z = (rating-55)/20.
export function terms(x) {
  const z = x.map((v) => (v - 55) / 20);
  const t = [1, ...z];
  for (let i = 0; i < z.length; i++) for (let j = i; j < z.length; j++) t.push(z[i] * z[j]);
  return t;
}
