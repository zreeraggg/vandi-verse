// Asset build (run once, not part of the game). Needs: npm i @gltf-transform/core @gltf-transform/extensions draco3dgltf sharp
// and FBX2glTF (npm fbx2gltf) to turn the source FBXs into GLBs first:
//   FBX2glTF -b -i "Jogging Stumble.fbx" -o stumble   (same for Drinking.fbx, the dog mesh and each dog clip)
// Usage:
//   node merge-clips.mjs hero <hero.glb> <out.glb> stumble=<stumble.glb> drink=<drink.glb>
//   node merge-clips.mjs dog <dogmesh.glb> <out.glb> <texture B.png> <texture N.png> run=<a.glb> walk=<b.glb> ...
// Clips are retargeted by bone name (Mixamo's "mixamorig:" colon dropped, as three.js does).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});
const [kind, inFile, outFile, ...rest] = process.argv.slice(2);
const clipArgs = rest.filter((a) => a.includes('=')).map((a) => a.split('='));
const doc = await io.read(inFile);
const root = doc.getRoot(), buffer = root.listBuffers()[0];
const key = (n) => n.replace(/:/g, '');
const byName = new Map(root.listNodes().map((n) => [key(n.getName()), n]));
const isHips = (n) => /Hips$/.test(n);

// The hero's clips stand his hips at this height; a new clip's hips get scaled to match (FBX2glTF exports Mixamo cm as 0.01 m).
let heroHipY = null;
if (kind === 'hero') {
  const idle = root.listAnimations().find((a) => a.getName() === 'idle');
  const ch = idle.listChannels().find((c) => isHips(key(c.getTargetNode().getName())) && c.getTargetPath() === 'translation');
  heroHipY = ch.getSampler().getOutput().getArray()[1];
}

for (const [name, file] of clipArgs) {
  const src = (await io.read(file)).getRoot();
  for (const a of src.listAnimations()) {
    const anim = doc.createAnimation(name);
    let hipScale = 1;
    for (const c of a.listChannels()) {
      const target = byName.get(key(c.getTargetNode().getName()));
      if (!target) continue; // bones the mesh doesn't have (the dog's clip ears are named differently)
      const s = c.getSampler();
      let out = Float32Array.from(s.getOutput().getArray());
      if (kind === 'hero' && c.getTargetPath() === 'translation') {
        if (!isHips(key(target.getName()))) continue; // only the hips move by translation in Mixamo
        hipScale = heroHipY / out[1];
        const [x0, , z0] = out;
        for (let i = 0; i < out.length; i += 3) { out[i] = (out[i] - x0) * 0; out[i + 1] *= hipScale; out[i + 2] = (out[i + 2] - z0) * 0; } // in place: the game moves him
      }
      const input = doc.createAccessor().setType('SCALAR').setArray(Float32Array.from(s.getInput().getArray())).setBuffer(buffer);
      const output = doc.createAccessor().setType(s.getOutput().getType()).setArray(out).setBuffer(buffer);
      const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(s.getInterpolation());
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(c.getTargetPath()).setSampler(sampler));
    }
    console.log('added', name, anim.listChannels().length, 'channels', kind === 'hero' ? `hip x${hipScale.toFixed(1)}` : '');
  }
}

if (kind === 'dog') {
  const [bFile, nFile] = rest.filter((a) => !a.includes('='));
  // Lighten the German Shepherd's black saddle toward tan so it reads as a naadan street dog.
  const { data, info } = await sharp(bFile).resize(1024).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const tan = [196, 140, 82];
  for (let i = 0; i < data.length; i += 4) {
    const l = (0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]) / 255, k = Math.max(0, 0.45 - l) * 1.1;
    for (let c = 0; c < 3; c++) data[i + c] = data[i + c] * (1 - k) + tan[c] * k;
  }
  const img = sharp(data, { raw: info });
  const jpg = await img.clone().removeAlpha().jpeg({ quality: 85 }).toBuffer();
  const png = await img.clone().resize(256).png({ compressionLevel: 9 }).toBuffer(); // small cutout copy for the fur cards
  const nrm = await sharp(nFile).resize(512).jpeg({ quality: 82 }).toBuffer();
  const base = doc.createTexture('dog_b').setImage(jpg).setMimeType('image/jpeg');
  const cut = doc.createTexture('dog_cut').setImage(png).setMimeType('image/png');
  const normal = doc.createTexture('dog_n').setImage(nrm).setMimeType('image/jpeg');
  for (const m of root.listMaterials()) {
    m.setBaseColorTexture(base).setNormalTexture(normal).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.85).setMetallicFactor(0);
    if (/Transparent/.test(m.getName())) m.setBaseColorTexture(cut).setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true);
  }
}
await io.write(outFile, doc);
console.log('wrote', outFile);
