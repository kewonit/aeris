export function snapLngToReference(lng: number, refLng: number): number {
  let x = lng;
  while (x - refLng > 180) x -= 360;
  while (x - refLng < -180) x += 360;
  return x;
}

export function unwrapLngPath(
  path: Array<[lng: number, lat: number]>,
): Array<[lng: number, lat: number]> {
  if (path.length < 2) return path;
  const out: Array<[number, number]> = [path[0]];
  let refLng = path[0][0];
  for (let i = 1; i < path.length; i++) {
    const [lng, lat] = path[i];
    const nextLng = snapLngToReference(lng, refLng);
    out.push([nextLng, lat]);
    refLng = nextLng;
  }
  return out;
}
