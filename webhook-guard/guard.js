// Put this Code node straight after a Webhook node (Run Once for All Items).
// It lets a call through only when its x-hook-secret header matches $env.HOOK_SECRET.

const HEADER = 'x-hook-secret'; // n8n hands over header names in lower case
const SECRET_ENV = 'HOOK_SECRET';

// Looks at every character even after a mismatch, so the time taken does not show
// how much of a guess was right.
function sameSecret(given, expected) {
  let diff = given.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) {
    diff |= (given.charCodeAt(i) | 0) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

let expected;
try { expected = $env[SECRET_ENV]; } catch (e) { expected = undefined; } // n8n can block $env
if (!expected) {
  // Fail closed: a guard with no secret to compare must not let everyone in.
  throw new Error(`Refused: ${SECRET_ENV} is not set, so no call can be checked`);
}

for (const item of $input.all()) {
  const given = String((item.json.headers || {})[HEADER] || '');
  if (!sameSecret(given, String(expected))) {
    throw new Error(`Unauthorized: missing or wrong ${HEADER} header`);
  }
}
return $input.all();
