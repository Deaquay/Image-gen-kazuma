/**
 * Self-check for the LoRA list route: node server-plugin/loras-route.test.mjs
 * No framework, matching loras.test.mjs. Needs no ComfyUI - a stub stands in for it,
 * which also lets the reverse-proxy prefix case be checked without one.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { init, info } from './index.js';

// Minimal stand-ins for the Express bits the route actually touches.
function makeRouter() {
    const routes = {};
    return { post: (path, handler) => { routes[path] = handler; }, routes };
}
function call(handler, body) {
    return new Promise((resolve) => {
        const res = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            json(payload) { resolve({ status: this.statusCode, payload }); return this; },
        };
        handler({ body }, res);
    });
}

// A stub ComfyUI that records the path asked for, so URL joining is observable.
const asked = [];
const comfy = http.createServer((req, res) => {
    asked.push(req.url);
    if (!req.url.endsWith('/models/loras')) {
        res.writeHead(404).end('nope');
        return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(['a.safetensors', 'nested/b.safetensors']));
});
await new Promise(resolve => comfy.listen(0, resolve));
const port = comfy.address().port;
const base = `http://127.0.0.1:${port}`;

const router = makeRouter();
await init(router);
const handler = router.routes['/list'];
assert.ok(handler, 'the route registers itself at /list');
assert.equal(info.id, 'kazuma-loras', 'id is what the extension fetches and ST mounts on');

// --- happy path ---
{
    const { status, payload } = await call(handler, { url: base });
    assert.equal(status, 200);
    assert.deepEqual(payload, ['a.safetensors', 'nested/b.safetensors']);
}

// --- a trailing slash must not double up ---
{
    asked.length = 0;
    const { status } = await call(handler, { url: `${base}/` });
    assert.equal(status, 200, 'trailing slash still resolves');
    assert.equal(asked[0], '/models/loras', 'no doubled slash');
}

// --- ComfyUI behind a path prefix keeps the prefix ---
{
    asked.length = 0;
    await call(handler, { url: `${base}/comfy` });
    assert.equal(asked[0], '/comfy/models/loras', 'prefix survives; new URL() would have eaten it');
}

// --- bad input and unreachable upstream fail closed, never throw ---
{
    assert.equal((await call(handler, {})).status, 400, 'missing url');
    assert.equal((await call(handler, { url: '   ' })).status, 400, 'blank url');
    assert.equal((await call(handler, undefined)).status, 400, 'missing body entirely');

    const dead = await call(handler, { url: 'http://127.0.0.1:9' });
    assert.equal(dead.status, 500, 'unreachable ComfyUI');
    assert.deepEqual(dead.payload, [], 'callers always get an array');
}

// --- a non-array body from ComfyUI is rejected rather than passed through ---
{
    const weird = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not a list' }));
    });
    await new Promise(resolve => weird.listen(0, resolve));
    const { status, payload } = await call(handler, { url: `http://127.0.0.1:${weird.address().port}` });
    assert.equal(status, 500, 'unexpected shape is an error');
    assert.deepEqual(payload, []);
    weird.close();
}

comfy.close();
console.log('All assertions passed.');
