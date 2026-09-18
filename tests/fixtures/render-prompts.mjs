// Renders every prompt builder against the hostile fixtures and returns a
// stable {name: text} map. Shared by the golden generator and the test, so the
// two can never drift apart by rendering different things.
import {
  HOSTILE_RECOGNITION, HOSTILE_CANDIDATES, HOSTILE_CORRECTIONS,
  HOSTILE_VISION, HOSTILE_FASTPATH, HOSTILE_RESCUE_CTX, ANCHORED_RESCUE_CTX,
} from './prompt-cases.mjs';

export async function renderAll() {
  process.env.SUPABASE_URL ||= 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_KEY ||= 'service-key';
  process.env.SUPABASE_ANON_KEY ||= 'anon-key';
  process.env.SUPABASE_JWT_SECRET ||= 'test-secret';
  process.env.ANTHROPIC_API_KEY ||= 'sk-ant-test';
  const m = await import('../../api/analyze.js');

  const out = {};
  for (const lang of ['he', 'en']) {
    out[`recognition:${lang}`] = m.buildRecognitionPrompt(lang);
    out[`verification:${lang}`] = m.buildVerificationPrompt(
      HOSTILE_RECOGNITION, HOSTILE_CANDIDATES, HOSTILE_CORRECTIONS, lang, HOSTILE_VISION, true);
    out[`verification-noforensics:${lang}`] = m.buildVerificationPrompt(
      HOSTILE_RECOGNITION, HOSTILE_CANDIDATES, HOSTILE_CORRECTIONS, lang, HOSTILE_VISION, false);
    out[`verification-novision:${lang}`] = m.buildVerificationPrompt(
      HOSTILE_RECOGNITION, HOSTILE_CANDIDATES, HOSTILE_CORRECTIONS, lang, null, true);
    out[`verification-empty:${lang}`] = m.buildVerificationPrompt(
      HOSTILE_RECOGNITION, [], [], lang, null, true);
    out[`rescue:${lang}`] = m.buildRescuePricingPrompt({ ...HOSTILE_RESCUE_CTX, lang });
    out[`rescue-anchored:${lang}`] = m.buildRescuePricingPrompt({ ...ANCHORED_RESCUE_CTX, lang });
    out[`fastpath:${lang}`] = JSON.stringify(
      m.buildFastPathVerification(HOSTILE_RECOGNITION, HOSTILE_FASTPATH, lang), null, 1);
  }
  return out;
}
