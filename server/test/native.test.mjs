// Native messaging host: framing, and up/down notifications for the watched port.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';
import { encode, decode } from '../src/native-host.js';
import { extensionIdForPath } from '../src/extension-id.js';

function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } console.log('ok -', msg); }
const here = path.dirname(fileURLToPath(import.meta.url));

const two = Buffer.concat([encode({ a: 1 }), encode({ b: 2 })]);
const d1 = decode(two.subarray(0, two.length - 2));
assert(d1.messages.length === 1 && d1.messages[0].a === 1 && d1.rest.length === encode({ b: 2 }).length - 2, 'decode returns complete frames and keeps the partial one');
assert(decode(two).messages.length === 2, 'decode returns both frames once complete');

// Known vector: this folder's id as shown by chrome://extensions on the author's machine.
assert(extensionIdForPath('/Users/penz/Documents/workspace/browser-agent-kit/extension', 'darwin') === 'fkcdoedmadkdlkeijjnjoimodillfafh', 'extension id derivation matches Chrome for an unpacked folder');
assert(/^[a-p]{32}$/.test(extensionIdForPath('C:\\Users\\Me\\kit\\extension', 'win32')), 'windows ids use the a-p alphabet');

const PORT = 7800 + Math.floor(Math.random() * 100);
const host = spawn(process.execPath, [path.join(here, '..', 'src', 'native-host.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
const got = [];
let buf = Buffer.alloc(0);
const waitFor = (type, ms) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const check = () => {
    const i = got.findIndex((m) => m.type === type);
    if (i >= 0) return resolve(got.splice(i, 1)[0]);
    if (Date.now() - t0 > ms) return reject(new Error(`no ${type} within ${ms}ms`));
    setTimeout(check, 50);
  };
  check();
});
host.stdout.on('data', (c) => { buf = Buffer.concat([buf, c]); const r = decode(buf); buf = r.rest; got.push(...r.messages); });
host.stdin.write(encode({ type: 'watch', port: PORT }));
await waitFor('hello', 3000);
assert(true, 'host says hello');
const down0 = await waitFor('down', 4000);
assert(down0.port === PORT, 'host reports the port down while nothing listens');
const srv = net.createServer(); await new Promise((r) => srv.listen(PORT, '127.0.0.1', r));
const up = await waitFor('up', 5000);
assert(up.port === PORT, 'host reports up once something listens');
srv.close();
await waitFor('down', 5000);
assert(true, 'host reports down again after the server stops');
host.stdin.end();
await new Promise((r) => host.on('exit', r));
assert(true, 'host exits when Chrome closes the pipe');
console.log('\nAll native host tests passed.');
