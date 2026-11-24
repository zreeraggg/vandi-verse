// The street dog that chases the hero (assets/models/dog.glb: RSG German Shepherd recoloured tan, see tools/merge-clips.mjs).
// Clips: walk, run, idle, leanL, leanR. No bark/bite clips exist, so the jaw bone is opened in code on top of the mixer.
import * as THREE from 'three';
import { gltfLoader } from './fx.js';

const LENGTH = 1.25; // nose to tail in game units (the hero is 2.1 tall)
const FADE = 0.2, BARK = 0.28;
export const JAW_AXIS = new THREE.Vector3(1, 0, 0); // local axis the jaw hinges on (checked in the browser)
const q = new THREE.Quaternion();

export function createDog(scene) {
  const root = new THREE.Group(); // faces -z (the way the hero runs); position = between the paws on the road
  root.visible = false;
  scene.add(root);
  let mixer = null, actions = {}, current = null, jaw = null, jawRest = null, barkT = 0, hold = false;

  const ready = gltfLoader.loadAsync('assets/models/dog.glb').then((gltf) => {
    const model = gltf.scene;
    model.traverse((o) => { if (o.isSkinnedMesh) { o.castShadow = true; o.frustumCulled = false; } });
    jaw = model.getObjectByName('DEF-jaw');
    jawRest = jaw?.quaternion.clone();
    // Scale to LENGTH, then turn so the head points to -z (found from the jaw, so the export axes don't matter).
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model, true), size = box.getSize(new THREE.Vector3());
    const k = LENGTH / Math.max(size.x, size.z);
    model.scale.multiplyScalar(k);
    const head = jaw ? jaw.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 0, 1);
    const mid = box.getCenter(new THREE.Vector3());
    model.rotation.y = Math.PI - Math.atan2(head.x - mid.x, head.z - mid.z); // head direction → -z
    const holder = new THREE.Group();
    holder.add(model);
    model.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(holder, true);
    model.position.set(-(b2.min.x + b2.max.x) / 2, -b2.min.y, -(b2.min.z + b2.max.z) / 2);
    root.add(holder);
    mixer = new THREE.AnimationMixer(model);
    actions = Object.fromEntries(gltf.animations.map((c) => [c.name, mixer.clipAction(c)]));
    play('idle');
  }).catch((e) => console.warn('dog.glb failed to load; no dog this time', e));

  function play(name) {
    const next = actions[name];
    if (!next || next === current) return;
    next.reset().play();
    if (current) current.crossFadeTo(next, FADE, false);
    current = next;
  }

  // mode: 'idle' | 'walk' | 'run' | 'leanL' | 'leanR'; rate scales the clip (a faster road = faster paws).
  function update(dt, mode, rate = 1) {
    if (!mixer) return;
    play(mode);
    current?.setEffectiveTimeScale(rate);
    if (jaw) jaw.quaternion.copy(jawRest); // the clips may not key the jaw; never let the bark offset pile up
    mixer.update(dt);
    if (jaw) { // bark: the jaw drops open and snaps shut; bite: held wide open
      barkT = Math.max(0, barkT - dt);
      const open = hold ? 0.7 : barkT > 0 ? Math.sin((1 - barkT / BARK) * Math.PI) * 0.6 : 0;
      if (open) jaw.quaternion.multiply(q.setFromAxisAngle(JAW_AXIS, open));
    }
  }
  const bark = () => { barkT = BARK; };
  const bite = (on) => { hold = on; };
  return { root, ready, update, bark, bite };
}
