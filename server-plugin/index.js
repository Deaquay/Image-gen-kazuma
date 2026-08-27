/**
 * Image Gen Kazuma - LoRA list server plugin
 *
 * Everything else the extension needs from ComfyUI already goes through
 * SillyTavern: it proxies checkpoints, samplers, schedulers and VAEs, and
 * generation posts to /api/sd/comfy/generate. There is no equivalent route for
 * LoRAs, so that one list is the last call made by the browser talking to
 * ComfyUI directly - which means it needs --enable-cors-header, and returns
 * nothing at all when SillyTavern is open on a phone or a second machine,
 * because the ComfyUI URL is resolved by the browser rather than the server.
 *
 * This plugin closes that gap. It lives in plugins/ rather than in SillyTavern
 * itself so it survives updates.
 *
 * Not required for a same-machine setup: the extension calls this first and
 * falls back to asking ComfyUI directly when the route is not mounted.
 */

const pluginName = 'kazuma-loras';

/**
 * Initialize the plugin.
 * @param {import('express').Router} router - Express router for plugin endpoints
 */
export async function init(router) {
    /**
     * POST /api/plugins/kazuma-loras/list  body: { url }
     * Returns ComfyUI's LoRA filenames as a flat array of strings.
     */
    router.post('/list', async (req, res) => {
        try {
            const baseUrl = String(req.body?.url || '').trim();
            if (!baseUrl) {
                return res.status(400).json([]);
            }

            // ponytail: /models/loras only. /object_info/LoraLoader carries an identical list and
            // exists on older ComfyUI builds that predate /models/{folder} - add it as a fallback
            // if anyone actually hits that, it is a three-line branch.
            // Concatenated, not new URL('/models/loras', base): the URL constructor treats a
            // leading-slash path as absolute and would discard a path prefix, breaking ComfyUI
            // behind a reverse proxy at e.g. http://host/comfy/. ST reaches for url-join here,
            // which a plugin loaded through a symlink cannot resolve.
            const target = `${baseUrl.replace(/\/+$/, '')}/models/loras`;
            const result = await fetch(target);
            if (!result.ok) {
                throw new Error(`ComfyUI returned ${result.status}`);
            }

            const loras = await result.json();
            if (!Array.isArray(loras)) {
                throw new Error('ComfyUI returned an unexpected shape');
            }

            return res.json(loras);
        } catch (error) {
            console.error(`[${pluginName}] Failed to list LoRAs:`, error.message);
            return res.status(500).json([]);
        }
    });

    console.log(`[${pluginName}] Plugin loaded`);
}

export async function exit() {
    return Promise.resolve();
}

export const info = {
    id: pluginName,
    name: 'Image Gen Kazuma LoRA list',
    description: 'Fetches the ComfyUI LoRA list server-side so the picker works without CORS or a browser-reachable ComfyUI.',
};

export default { init, exit, info };
