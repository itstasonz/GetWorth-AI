// ══════════════════════════════════════════════════════════════════════════════
// IMAGE INTEGRITY — THE BLACK-FRAME CLASS
//
// THE WITNESS. A phone photographed a Logitech mouse on build ce91796 and the
// engine received a completely black frame. Phase A: category Other, no brand,
// no model, empty OCR. Phase B: "the photograph appears completely black".
// Five provider calls and 27.8 seconds spent on an image with nothing in it.
//
// WHERE IT TURNS BLACK, and it is not a browser bug:
//
//   canvas.width = w                  resizing RESETS the canvas to
//                                     TRANSPARENT black
//   ctx.drawImage(video, ...)         if this paints nothing, those
//                                     transparent pixels survive
//   canvas.toDataURL('image/jpeg')    JPEG HAS NO ALPHA. Transparent is
//                                     composited to OPAQUE BLACK.
//
// Every check downstream passed it, and the tests below pin each one so the
// combination cannot quietly return:
//
//   rawImg.length > 100         a black 1280×720 JPEG is several KB
//   compressImage rawKB < 150   a solid-colour JPEG skips compression, so the
//                               only place that decoded pixels never ran
//   validateImages (server)     magic bytes and size; a black JPEG is a
//                               structurally perfect JPEG
//
//   node --test tests/image-integrity.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const REPO = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolvePath(REPO, rel), 'utf8');
const CONTEXT = 'src/contexts/AppContext.jsx';

/**
 * The pixel assessor, lifted out of the client module and evaluated here.
 *
 * `AppContext.jsx` cannot be imported into a plain node test — it is JSX and
 * it pulls in React, supabase and the DOM. Extracting the function by source
 * and running it against a fake canvas tests THE SHIPPED IMPLEMENTATION rather
 * than a copy of it: if the thresholds or the conjunction change in the file,
 * they change here, and a divergent reimplementation would be worse than no
 * test at all.
 */
function loadAssessor() {
  const src = read(CONTEXT);
  const fn = /function assessCanvasPixels\(canvas\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(fn, 'assessCanvasPixels must exist in the client module');
  const consts = /const BLACK_MEAN_LUMA_MAX[\s\S]*?const UNIFORM_STDDEV_MAX = [\d.]+;/.exec(src);
  assert.ok(consts, 'the thresholds must be named constants, not inline numbers');
  // eslint-disable-next-line no-new-func
  return new Function(`${consts[0]}\n${fn[0]}\nreturn assessCanvasPixels;`)();
}

/** A canvas stand-in that serves one flat RGBA row, plus optional noise. */
function fakeCanvas({ width, height, r = 0, g = 0, b = 0, a = 255, noise = 0, seed = 1 }) {
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s / 0x7fffffff) * 2 - 1; };
  return {
    width,
    height,
    getContext: () => ({
      getImageData: (_x, _y, w) => {
        const data = new Uint8ClampedArray(w * 4);
        for (let i = 0; i < w; i++) {
          const j = rand() * noise;
          data[i * 4] = Math.max(0, Math.min(255, r + j));
          data[i * 4 + 1] = Math.max(0, Math.min(255, g + j));
          data[i * 4 + 2] = Math.max(0, Math.min(255, b + j));
          data[i * 4 + 3] = a;
        }
        return { data };
      },
    }),
  };
}

const assess = loadAssessor();

// ════════════════════════════════════════════════════════════════════════════
// II-1 · THE DEAD FRAME IS DETECTED
// ════════════════════════════════════════════════════════════════════════════
describe('II-1 a frame with nothing in it is rejected', () => {
  test('II-1a the witness: an unpainted canvas encoded as opaque black', () => {
    const r = assess(fakeCanvas({ width: 1280, height: 720, r: 0, g: 0, b: 0, a: 255 }));
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'black_frame');
  });

  test('II-1b a canvas drawImage never painted, still transparent', () => {
    // Caught BEFORE toDataURL, which is the only moment the alpha still
    // exists. One line later it is indistinguishable from a real black photo.
    const r = assess(fakeCanvas({ width: 1280, height: 720, a: 0 }));
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'fully_transparent');
  });

  test('II-1c a zero-size canvas is not a photograph', () => {
    assert.equal(assess(fakeCanvas({ width: 0, height: 0 })).reason, 'zero_dimensions');
    assert.equal(assess(fakeCanvas({ width: 1280, height: 0 })).reason, 'zero_dimensions');
  });

  test('II-1d a blank frame of ANY colour is rejected, not just black', () => {
    // A white-out, a lens cap on a bright day, a flat grey suspended stream.
    for (const [label, c] of [
      ['white', { r: 255, g: 255, b: 255 }],
      ['mid grey', { r: 128, g: 128, b: 128 }],
      ['flat blue', { r: 20, g: 40, b: 200 }],
    ]) {
      const r = assess(fakeCanvas({ width: 640, height: 480, ...c }));
      assert.equal(r.ok, false, `${label} frame was accepted`);
      assert.equal(r.reason, 'uniform_frame', label);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// II-2 · A REAL PHOTOGRAPH IS NOT REJECTED
//
// The half that decides whether this fix can ship. A marketplace for
// second-hand goods is full of dark objects photographed indoors, and a
// darkness threshold alone would refuse exactly those.
// ════════════════════════════════════════════════════════════════════════════
describe('II-2 dark photographs are still photographs', () => {
  test('II-2a a genuinely dark frame WITH variance is accepted', () => {
    // A black mouse on a dark desk: low mean, real sensor noise and edges.
    const r = assess(fakeCanvas({ width: 1280, height: 720, r: 14, g: 14, b: 16, noise: 26 }));
    assert.equal(r.ok, true, `rejected a dark photograph: ${JSON.stringify(r)}`);
    assert.ok(r.mean_luma < 40, 'the fixture must actually be dark for this to mean anything');
  });

  test('II-2b an ordinary exposure is accepted', () => {
    const r = assess(fakeCanvas({ width: 1280, height: 720, r: 120, g: 110, b: 100, noise: 70 }));
    assert.equal(r.ok, true);
  });

  test('II-2c darkness alone never rejects — the rule is a CONJUNCTION', () => {
    // Sweep the mean downward while keeping variance. Nothing here may be
    // refused: the only rejection is dark AND flat.
    for (let mean = 2; mean <= 30; mean += 4) {
      const r = assess(fakeCanvas({ width: 320, height: 240, r: mean, g: mean, b: mean, noise: 24 }));
      assert.equal(r.ok, true,
        `a dark-but-textured frame at mean~${mean} was refused: ${JSON.stringify(r)}`);
    }
  });

  test('II-2d an unreadable canvas is UNKNOWN, never a rejection', () => {
    // A tainted canvas throws SecurityError on getImageData. Our inability to
    // look must not block a scan.
    const tainted = {
      width: 100, height: 100,
      getContext: () => ({ getImageData: () => { throw new Error('SecurityError'); } }),
    };
    assert.equal(assess(tainted), null, 'an unreadable canvas must return null, not ok:false');
    assert.equal(assess({ width: 10, height: 10, getContext: () => null }), null);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// II-3 · NOTHING IS PAID FOR A DEAD FRAME
// ════════════════════════════════════════════════════════════════════════════
describe('II-3 the check runs before any provider call', () => {
  test('II-3a the pipeline rejects before analyzeWithRetry', () => {
    const src = read(CONTEXT);
    const probe = src.indexOf('const pixels = await assessImageDataUrl(probeImage);');
    const call = src.indexOf('await analyzeWithRetry(analyzeInput');
    assert.ok(probe > 0, 'the pipeline must assess the image');
    assert.ok(call > probe,
      'the image assessment must happen BEFORE the first paid call, not after');
    const between = src.slice(probe, call);
    assert.match(between, /return;/, 'a bad frame must return, not fall through');
    assert.match(between, /Photo capture failed\. Please retake the photo\./);
  });

  test('II-3b both camera captures check the canvas before toDataURL', () => {
    // CODE ONLY. The module's own header comment draws the failing sequence
    // (`ctx.drawImage(video, ...)` → `toDataURL`) in order to explain it, and a
    // matcher that reads comments finds a third "site" that is prose — then
    // fails on the one file that documents the bug most carefully.
    const src = read(CONTEXT).split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    // toDataURL('image/jpeg') is where alpha is destroyed, so the read-back
    // has to come first at EVERY site that encodes a captured frame.
    const sites = [...src.matchAll(/drawImage\(video[\s\S]{0,2600}?toDataURL\('image\/jpeg'/g)];
    assert.equal(sites.length, 2, `expected both capture sites, found ${sites.length}`);
    for (const [i, m] of sites.entries()) {
      assert.match(m[0], /assessCanvasPixels\(canvas\)/,
        `capture site ${i + 1} encodes a JPEG without checking the canvas first`);
    }
  });

  test('II-3c the check fails OPEN, so it cannot block a real scan', () => {
    const src = read(CONTEXT);
    const at = src.indexOf('const pixels = await assessImageDataUrl(probeImage);');
    const block = src.slice(at, at + 400);
    assert.match(block, /pixels && pixels\.ok === false/,
      'only an EXPLICIT ok:false may stop a scan; a null verdict means "could not look"');
    assert.ok(!/!pixels\.ok/.test(block),
      '`!pixels.ok` would treat an unreadable image as a bad one and refuse real photographs');
  });

  test('II-3d /api/enrich refuses a non-image before it builds any adapter', () => {
    const src = read('api/enrich.js');
    const guard = src.indexOf('MIN_IMAGE_BYTES');
    const flag = src.indexOf('const mode = resolveEnrichmentMode(process.env);');
    const run = src.indexOf('await runPhaseB({');
    assert.ok(guard > 0 && guard > flag && guard < run,
      'the structural image guard must sit after the flag and before the pipeline');
    assert.match(src.slice(guard, run), /IMAGE_MAGIC/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// II-4 · ONE IMAGE, FOLLOWED ACROSS THE BOUNDARIES
// ════════════════════════════════════════════════════════════════════════════
describe('II-4 the same photo is traceable from client to Phase B', () => {
  test('II-4a a fingerprint is emitted at both payload boundaries', () => {
    const src = read(CONTEXT);
    assert.match(src, /\[Image\] phase-a payload fp=/,
      'the Phase A boundary must emit a fingerprint');
    assert.match(src, /fp=\$\{fp\} bytes=/,
      'the Phase B boundary must emit the same kind of fingerprint');
  });

  test('II-4b the fingerprint identifies an image and never reveals one', () => {
    const src = read(CONTEXT);
    const fn = /async function imageFingerprint\(base64\) \{[\s\S]*?\n\}/.exec(src);
    assert.ok(fn, 'imageFingerprint must exist');
    // 6 bytes of digest is plenty to tell two images apart in one scan, and
    // the payload itself must never appear in a log line.
    assert.match(fn[0], /slice\(0, 6\)/);
    assert.ok(!/console\.(log|warn|error)/.test(fn[0]),
      'the fingerprint function must not log anything itself');
    const logs = [...src.matchAll(/console\.log\(\s*`\[Image\][^`]*`/g)].map((m) => m[0]);
    assert.ok(logs.length > 0, 'there must be boundary logging to check');
    for (const l of logs) {
      assert.ok(!/\$\{b64\}|\$\{probeImage\}|\$\{dataUrl\}/.test(l),
        `a boundary log interpolates a payload: ${l.slice(0, 120)}`);
    }
  });

  test('II-4c the same bytes fingerprint identically, different bytes do not', () => {
    const src = read(CONTEXT);
    const fn = /async function imageFingerprint\(base64\) \{[\s\S]*?\n\}/.exec(src)[0];
    // eslint-disable-next-line no-new-func
    const make = new Function(`${fn}; return imageFingerprint;`)();
    return Promise.all([make('AAAqqq'), make('AAAqqq'), make('AAAqqr'), make('')])
      .then(([a, b, c, empty]) => {
        assert.equal(a, b, 'identical payloads must fingerprint identically');
        assert.notEqual(a, c, 'different payloads must differ');
        assert.equal(empty, 'empty');
      });
  });
});
