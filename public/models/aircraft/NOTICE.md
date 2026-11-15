The aircraft models in this directory are built by `tools/optimize-models.ts`
(`npm run data:models`) from two sets of sources, both under the GNU General
Public License v2; the built models are under the same licence.

**FlightAirMap 3D Models** (https://github.com/Ysurac/FlightAirMap-3dmodels)
and one **Flightradar24** model (b737): the generic models, kept in
`tools/models/source/`, where their origins are listed.

**Flightradar24 3D Models** (https://github.com/Flightradar24/fr24-3d-models),
at commit dd53267690c6a4ecbb290a3acf0284333a5d68a9: the type-specific models
a318, a319, a320, a321, a332, a333, a343, a346, a359, a380, b738, b739, b744,
b748, b752, b753, b762, b763, b764, b772, b773, b788, b789, e170, e190, crj700,
crj900, cs100, cs300, q400, atr42, bae146, citation and pa28. The build fetches
them from that commit.

Changes made in the build, November 2026:

- Flightradar24's models upgraded from glTF 1.0 to 2.0 with gltf-pipeline.
- Textures, materials, normals, skins and animations removed; one neutral
  material.
- Lines, points and zero-area triangles removed (the b737 source carries a
  stray line below it, the a343 source a sliver past its nose).
- Each model joined into a single mesh and its node transforms baked in.
- Simplified with meshoptimizer to two levels of detail, keeping the model's
  outermost points so its bounds are unchanged:
  - `<name>.glb`, about 1,200 triangles, for the map (a few dense models
    keep more: the A380 meshes about 10,000, the 747-8 about 5,000);
  - `<name>-detail.glb`, up to about 8,000 triangles, for first person view.

A copy of the GPL v2 licence: https://www.gnu.org/licenses/old-licenses/gpl-2.0.html
