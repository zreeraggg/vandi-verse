
# Sounds: which file plays when

The slots are defined in `src/sounds.js` (`SOUNDS`). To swap a sound, drop an mp3 with the same file name in this folder.
If a file is missing, the game plays a synth beep instead, or stays silent where noted.
**Voice** clips are the meme lines: only one plays at a time, and the music goes quieter while it plays.

## Files in this folder

| File | Slot | When it plays | Notes |
|---|---|---|---|
| `bgm.mp3` | `bgm` | Background music, loops during a run | vol 0.25 |
| `start.mp3` | `start` | You tap ODU / Innathe Road | voice, first 2.5 s |
| `jump.mp3` | `jump` | Every jump | |
| `slide.mp3` | `slide` | Slide with a normal (tied) mundu | first 0.7 s |
| `loose.mp3` | `loose` | Mundu comes loose (azhinju) after too many slides while folded | voice, 2.5 s |
| `retie.mp3` | `retie` | Mundu tied back ("Ready! Mundu set 👍") | voice, 2.5 s |
| `coin5.mp3` | `coin5` | Picking up a ₹5 coin | 0.95 s cha-ching |
| `horn1.mp3` … `horn7.mp3` | `horn` | Every charging KSRTC and 2 in 3 other buses as they pass you, one picked at random. Starts ~1 s before the bus reaches you, fades in as it nears, fades out as it passes, with Doppler pitch | ≤3 s each |
| `shivaneee.mp3` | `bus_dodge` | About half the buses that pass you, on top of the horn | voice |
| `chath-chath-chath.mp3` | `pothole_jump` | You jump cleanly over a pothole | voice, starts 1 s in |
| `crash_coconut.mp3` | `coconut_land` and `crash_coconut` | A falling coconut hits the road, **and** a coconut hits you | voice, **first 0.5 s only** |
| `crash_bus.mp3` | `crash_bus` | Hit by a bus | voice |
| `crash_auto.mp3` | `crash_auto` | Hit by an auto rickshaw | voice |
| `malayalam-actor-lal.mp3` | `crash` | Any crash with no clip of its own (bike, pothole, flex board) | voice |
| `gameover1.mp3` … `gameover4.mp3` | `gameover` | Game-over screen, one picked at random | voice, first 4 s |
| `new_best.mp3` | `new_best` | Game-over screen when you beat your best | voice, plays instead of `gameover` |
| `coin1.mp3` | `coin1` | Picking up a ₹1 coin | 0.42 s steel clink |
| `land.mp3` | `land` | Landing after a jump | 0.4 s thud |
| `auto_horn.mp3` | `auto_horn` | An auto starts swerving into your lane | first 1 s of a 3.25 s air horn, vol 0.3 |
| `puff.mp3` | `puff` | Legendary motta puffs picked up | 1.6 s magic reward chime |
| `bike_pass.mp3` | `bike_pass` | A bike roars past in the next lane | 2.1 s pass-by |
| `bus_brake.mp3` | `bus_brake` | Air-brake hiss when a bus hits you (under the crash line) | 1 s |
| `whistle.mp3` | `whistle` | Conductor's whistle when a run starts (with `start`) | 0.45 s |

## Where the YouTube clips came from (added 2026-11-23)

Downloaded with yt-dlp, trimmed with ffmpeg (short fades, loudness-normalised to -14 LUFS, mono 96 kbps).
Most are uploaded as "free / no copyright", but YouTube uploads are not a licence: replace them before any commercial release.

| File | Video | Cut |
|---|---|---|
| `auto_horn.mp3` | youtube.com/watch?v=7sKOt7gdfhU (auto air horn fitting, opening blast) | 1.85 – 5.1 s |
| `horn1.mp3` … `horn7.mp3` | youtu.be/TO9YCQeDoKg (Top 10 horns, Bus Simulator Indonesia), split at the silences, first 3 s of each | 13.8, 41.3, 55.0, 70.3, 85.9, 116.9, 160.7 s |
| `coin1.mp3` | youtube.com/watch?v=67nLQ3Zl4_s (Silver Coin Clink Sound Effects) | 0.18 – 0.6 s |
| `coin5.mp3` | youtube.com/watch?v=avmSSmRAyYo (Cha-Ching Sound Effects, no copyright) | 0.55 – 1.5 s |
| `land.mp3` | youtube.com/watch?v=9e1YXIVAG0c (Jump Landing - Gentle Thud) | 1.85 – 2.25 s |
| `puff.mp3` | youtube.com/watch?v=CQ2WZ49_RjM (Treasure Chest Opening, VibeDrops) | 0 – 1.6 s |
| `bus_brake.mp3` | youtube.com/watch?v=7gVbP8gd4GQ (Bus Air Breaks Sound Effect) | 2.05 – 3.1 s |
| `bike_pass.mp3` | youtube.com/watch?v=J_Ly3mDKrqA (Motorcycle Passing by, royalty free) | 1.9 – 4.0 s |
| `whistle.mp3` | youtube.com/watch?v=Id558uHXejM (Indian Bus conductor Whistle, royalty free) | 0 – 0.45 s |
| `dog_bark1.mp3` | youtube.com/watch?v=c13MliefckM (Labrador Dog Barking Sound) | |
| `dog_bark3.mp3` | youtube.com/watch?v=zcnzn3z_1TY (Angry DOG Bark & Growl, Sound Effects) | |

## Trimming options (in `src/sounds.js`)

- `max: N` plays only the first N seconds, with a short fade so it doesn't click.
- `from: N` starts N seconds into the file. Silence at the start is skipped automatically.
- Voice lines stop after 3 s unless `max` says otherwise.

## Dog barks

| File | Slot | When it plays |
|---|---|---|
| `dog_bark1.mp3`, `dog_bark3.mp3` | `dog_bark` | The intro, every stumble or scrape, and once when you crash (random pick of the two) |

## Moments with no clip

These have no sound file; the game plays a synth beep (or the generic crash line, or nothing) instead:
chaya sip, steel glass clang, stumble, dog growl / snarl / bite, "Ayyo!" when bitten, mundu fold, pothole crash, flex-board crash.
To give one a clip, add a slot for it in `src/sounds.js` and drop the mp3 here.
