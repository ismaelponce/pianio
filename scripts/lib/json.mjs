import { readFile } from 'node:fs/promises';

/** Parse JSON with a recursive token walk before JSON.parse can discard duplicate keys.
 * Keys are compared after decoding, including Unicode escapes; every object is checked.
 */
export function parseJsonStrict(raw, label = 'JSON') {
  let offset = 0;
  const fail = (message) => { throw new Error(`${label}: ${message} at offset ${offset}`); };
  const whitespace = () => { while (/[\t\n\r ]/.test(raw[offset] ?? '\0')) offset++; };
  function string() {
    const start = offset++;
    while (offset < raw.length) {
      const c = raw[offset++];
      if (c === '\\') offset++;
      else if (c === '"') return JSON.parse(raw.slice(start, offset));
    }
    fail('Unterminated string');
  }
  function value() {
    whitespace();
    const c = raw[offset];
    if (c === '{' || c === '[') {
      offset++;
      const object = c === '{';
      const end = object ? '}' : ']';
      const keys = new Set();
      whitespace();
      if (raw[offset] === end) { offset++; return; }
      while (offset < raw.length) {
        if (object) {
          whitespace();
          if (raw[offset] !== '"') fail('Expected object key');
          const key = string();
          if (keys.has(key)) fail(`Duplicate key ${JSON.stringify(key)}`);
          keys.add(key);
          whitespace();
          if (raw[offset++] !== ':') fail('Expected colon');
        }
        value();
        whitespace();
        const next = raw[offset++];
        if (next === end) return;
        if (next !== ',') fail('Expected comma');
      }
      fail('Unterminated container');
    } else if (c === '"') string();
    else {
      const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(offset));
      if (!token) fail('Expected JSON value');
      offset += token[0].length;
    }
  }
  try {
    value();
    whitespace();
    if (offset !== raw.length) fail('Unexpected trailing data');
    return JSON.parse(raw);
  } catch (error) {
    if (error.message.startsWith(`${label}:`)) throw error;
    throw new Error(`${label}: ${error.message}`);
  }
}
export async function readJsonStrict(file) {
  return parseJsonStrict(await readFile(file, 'utf8'), file);
}
