import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCrop, computeCropRect, OCR_PASSES } from './labelImageProcessing.js';

test('full crop includes all image pixels', () => {
  assert.deepEqual(computeCropRect(2000,1000),{sx:0,sy:0,sw:2000,sh:1000});
});
test('crop region cannot extend outside the image', () => {
  const rect=computeCropRect(1000,500,{x:85,y:91,width:50,height:50});
  assert.deepEqual(rect,{sx:500,sy:250,sw:500,sh:250});
});
test('narrow crop is enlarged without confusing pixel coordinates', () => {
  const rect=computeCropRect(1200,800,{x:25,y:25,width:50,height:50});
  assert.deepEqual(rect,{sx:300,sy:200,sw:600,sh:400});
});
test('invalid crop controls are normalized to safe bounds',()=>{
  const crop=normalizeCrop({x:-100,y:200,width:0,height:0});
  assert.deepEqual(crop,{x:0,y:88,width:15,height:12});
});
test('local OCR uses original, enlarged gray and high contrast passes',()=>{
  assert.deepEqual(OCR_PASSES.map(x=>x.name),['original','enlarged-gray','high-contrast']);
});

test('image preparation creates three cropped local OCR variants and releases source', async () => {
  const { prepareLabelOcrVariants } = await import('./labelImageProcessing.js');
  const previous = { bitmap: globalThis.createImageBitmap, document: globalThis.document };
  let closed = false;
  const draws = [];
  globalThis.createImageBitmap = async () => ({ width: 1200, height: 600, close: () => { closed = true; } });
  globalThis.document = {createElement: () => ({
    width: 0, height: 0,
    getContext() { return {
      drawImage(...args) { draws.push(args.slice(1,5)); },
      getImageData(_x,_y,width,height) { return { data: new Uint8ClampedArray(width*height*4) }; },
      putImageData() {},
      imageSmoothingEnabled: false
    }; },
    toBlob(callback) { callback(new Blob(['processed'],{type:'image/png'})); }
  })};
  try {
    const variants = await prepareLabelOcrVariants(new Blob(['image'],{type:'image/jpeg'}), {x:25,y:25,width:50,height:50});
    assert.deepEqual(variants.map(x=>x.name),['original','enlarged-gray','high-contrast']);
    assert.deepEqual(draws, Array(3).fill(null).map(()=>[300,150,600,300]));
    assert.equal(closed,true);
  } finally {
    if (previous.bitmap === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap=previous.bitmap;
    if (previous.document === undefined) delete globalThis.document;
    else globalThis.document=previous.document;
  }
});
