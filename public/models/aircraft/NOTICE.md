The aircraft models in this directory are built by `tools/optimize-models.ts`
(`npm run data:models`) from the sources in `tools/models/source/`, where their
origins are listed (FlightAirMap 3D Models and Flightradar24 3D Models, both
GNU General Public License v2). The built models are under the same licence.

Changes made in the build, November 2026:

- Textures, skins and animations removed; one neutral material.
- Lines and points removed (the b737 source carries a stray line below it).
- Each model joined into a single mesh and its node transforms baked in.
- Simplified with meshoptimizer to two levels of detail, keeping the model's
  outermost points so its bounds are unchanged:
  - `<name>.glb`, about 1,200 triangles, for the map (the A380 mesh, built
    from separate panels, about 10,000);
  - `<name>-detail.glb`, up to about 8,000 triangles, for first person view.

A copy of the GPL v2 licence: https://www.gnu.org/licenses/old-licenses/gpl-2.0.html
