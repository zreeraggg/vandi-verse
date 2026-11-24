# Model credits

None of these models are mine; they belong to their creators.

| File | Source |
|---|---|
| `palm.glb` | "Coconut Palm" by evolveduk, Sketchfab (CC Attribution) |
| `nut.glb` | "Kelapa Ijo (green coconut)", Sketchfab |
| `auto.glb` | "Autorikshaw - Indian Tuk Tuk", Sketchfab |
| `car.glb` | "Maruti 800 lowpoly free download", Sketchfab |
| `dog.glb` | German Shepherd from the RSG Dogs Pack |
| `hero.glb` | Rigged and animated with Mixamo, including the "Jogging Stumble" and "Drinking" clips |

## Changes made for the game

- `palm.glb` and `nut.glb`: textures resized to 512/256 px and the palm mesh simplified to 45%, to keep downloads small.
- `car.glb`: ground plane removed.
- `dog.glb`: recoloured toward tan and downscaled; its walk, run, idle and run-lean clips merged with `tools/merge-clips.mjs`.
- `hero.glb`: the stumble and drinking clips merged with `tools/merge-clips.mjs`.
- All models are Draco-compressed.
