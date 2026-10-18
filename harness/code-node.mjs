// Runs an n8n Code node's source outside n8n, with the few globals these nodes use.
// n8n wraps a Code node in an async function, which is why a top-level `return` works.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

export async function runCodeNode(source, { items = [{ json: {} }], env = {}, httpRequest, replace = {} } = {}) {
  // `replace` swaps one setting line, e.g. a shorter deadline, so a test runs in a second.
  for (const [from, to] of Object.entries(replace)) {
    if (!source.includes(from)) throw new Error(`setting not found in the node source: ${from}`);
    source = source.replace(from, to);
  }
  const $input = { all: () => items, first: () => items[0] };
  const helpers = {
    httpRequest: httpRequest || (async () => { throw new Error('no network in this run'); }),
  };
  const node = new AsyncFunction('$input', '$json', '$env', source);
  return node.call({ helpers }, $input, items[0] ? items[0].json : {}, env);
}
