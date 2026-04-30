Place MagicaVoxel `.vox` files for decorative detail props in this directory.

Current expected sample filenames:

- `ice-spire.vox`
- `amber-reactor.vox`
- `moss-bloom.vox`
- `machine-tower.vox`

Notes:

- These assets are decorative only.
- They should be authored as small voxel objects, not smooth polygon models.
- They are loaded at startup, converted into merged micro-voxel meshes, and added to the static detail-prop layer.
- Missing files are allowed. If no `.vox` files are present, no decorative props are rendered.
