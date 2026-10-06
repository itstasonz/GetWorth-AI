// ══════════════════════════════════════════════════════════════════════════════
// SCAN LAB — THE CAPTURE SETS
//
// What the lab asks to be photographed. DATA, per set: a new set (the 44-item
// benchmark) is a new entry here and no new code.
//
// A slot says what KIND of object to pick and never names a product. The
// definitions are served to the authorized account by the endpoint; they are
// not in the client bundle.
//
// The preflight slots mirror tests/fixtures/scan-v2/preflight-5.json, id for id
// and note for note (tests/scan-lab-server.test.mjs holds the two together).
// They are EXCLUDED from the benchmark and stay excluded: the flag travels with
// every record the lab writes.
// ══════════════════════════════════════════════════════════════════════════════

const NATURAL_PHOTO_RULE = 'one photograph as a normal seller would take it: ordinary light, ordinary background, handheld phone; no label, sticker, barcode or underside is to be exposed on purpose. Whether the engine then needs a label is a measurement, not an instruction.';

const slot = (id, cohort, title, hint) => Object.freeze({ id, cohort, title, hint });

export const LAB_SETS = Object.freeze({
  'preflight-5': Object.freeze({
    name: 'preflight-5',
    title: 'Preflight set',
    excluded_from_benchmark: true,
    natural_photo_rule: NATURAL_PHOTO_RULE,
    slots: Object.freeze([
      slot('pf-appliance', 'A', 'Branded appliance', 'any obvious branded appliance you have at hand (blender, coffee machine, vacuum, kettle with a brand); one ordinary photograph, as a seller would take it'),
      slot('pf-electronics', 'A', 'Branded electronics', 'any obvious branded electronics product you have at hand (headphones, speaker, console, phone); one ordinary photograph'),
      slot('pf-consumer', 'A', 'Branded consumer product', 'any obvious branded consumer product (perfume, sneakers, a kitchen gadget); one ordinary photograph'),
      slot('pf-generic', 'C', 'Generic object', 'any unbranded everyday object (a mug, a cushion, a basket); one ordinary photograph'),
      slot('pf-configuration', 'D', 'Configuration / adversarial', 'a configuration or adversarial case: an accessory alone (a charger, a remote, a case), a box without its product, or two objects in one frame'),
    ]),
  }),
});

/** The set by name, or null. Own keys only: `constructor` is not a set. */
export function getLabSet(name) {
  return typeof name === 'string' && Object.hasOwn(LAB_SETS, name) ? LAB_SETS[name] : null;
}

/** The slot of a set by id, or null. */
export function getLabSlot(set, itemId) {
  return set?.slots.find((s) => s.id === itemId) ?? null;
}
