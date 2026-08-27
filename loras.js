/**
 * Pure LoRA / profile model helpers.
 *
 * Deliberately free of SillyTavern imports so loras.test.mjs can run this file under plain node.
 * Anything that touches the DOM, settings, or fetch belongs in index.js instead.
 */

// ponytail: arbitrary cap. Nothing breaks above it - rgthree's Power Lora Loader declares no
// validated slot inputs, so ComfyUI never checks the count - it just stops a stuck "+" button
// from making a million rows. Raise it if anyone asks.
export const MAX_LORAS = 100;

export const DEFAULT_LORA_MIN = -2;
export const DEFAULT_LORA_MAX = 2;
// ponytail: one global step. Add a per-LoRA step field if some workflow ever needs coarser.
export const LORA_STEP = 0.05;

/** Matches "*lora*", "*lora3*", "*lorawt*", "*lorawt12*". */
const LORA_PLACEHOLDER = /^\*lora(wt)?(\d*)\*$/;

export function makeLora(name = '', weight = 1.0) {
    return {
        name,
        weight,
        min: DEFAULT_LORA_MIN,
        max: DEFAULT_LORA_MAX,
        enabled: !!name,
    };
}

/**
 * Trigger words of every LoRA that is actually on, in list order, ready to append to the prompt.
 * A LoRA the model was never told to invoke does nothing, so its triggers travel with its toggle
 * instead of being pasted into the prompt suffix by hand every time.
 *
 * Keyed by filename, and stored outside the profiles on purpose: the trigger belongs to the file,
 * not to one profile's use of it. Type it once and every profile that loads that LoRA gets it,
 * and swapping a row for a different file picks up the right words instead of the old ones.
 */
export function collectLoraTriggers(loras, triggers) {
    return (loras || [])
        .filter(l => l?.enabled && l.name)
        .map(l => (triggers?.[l.name] || '').trim())
        .filter(Boolean)
        .join(', ');
}

export function clampWeight(lora) {
    const w = parseFloat(lora?.weight);
    if (isNaN(w)) return 0;
    const min = Number.isFinite(Number(lora.min)) ? Number(lora.min) : DEFAULT_LORA_MIN;
    const max = Number.isFinite(Number(lora.max)) ? Number(lora.max) : DEFAULT_LORA_MAX;
    return Math.min(max, Math.max(min, w));
}

/**
 * Settings used to carry four fixed slots (selectedLora..selectedLora4 + weights). Fold whatever
 * the user had into the array form. Slots that were never filled are dropped, not kept as blanks.
 */
export function migrateLegacyLoras(obj) {
    const out = [];
    for (let i = 1; i <= 4; i++) {
        const name = obj?.[i === 1 ? 'selectedLora' : `selectedLora${i}`];
        const weight = obj?.[i === 1 ? 'selectedLoraWt' : `selectedLoraWt${i}`];
        if (!name) continue;
        out.push(makeLora(name, typeof weight === 'number' ? weight : 1.0));
    }
    return out;
}

export function stripLegacyLoras(obj) {
    for (let i = 1; i <= 4; i++) {
        delete obj[i === 1 ? 'selectedLora' : `selectedLora${i}`];
        delete obj[i === 1 ? 'selectedLoraWt' : `selectedLoraWt${i}`];
    }
    return obj;
}

/**
 * Resolve one "*lora3*" / "*lorawt3*" placeholder against the configured list.
 * Returns undefined when val is not a LoRA placeholder at all.
 *
 * This is the classic LoraLoader path, where lora_name is a combo input ComfyUI validates against
 * its on-disk list - a miss rejects the whole prompt, not just the node. So an off or unconfigured
 * slot still emits a real filename, at strength 0, which is a no-op through LoraLoader.
 */
export function resolveLoraPlaceholder(val, loras, fallbackName = 'None') {
    if (typeof val !== 'string') return undefined;
    const m = LORA_PLACEHOLDER.exec(val);
    if (!m) return undefined;

    const index = m[2] ? parseInt(m[2], 10) - 1 : 0;
    const lora = index >= 0 ? loras?.[index] : undefined;
    const active = !!(lora && lora.enabled && lora.name);

    if (m[1]) return active ? clampWeight(lora) : 0;
    return lora?.name || fallbackName;
}

/** rgthree's Power Lora Loader keeps its slots as lora_1..lora_N objects on node.inputs. */
export function isPowerLoraNode(node) {
    if (!node?.inputs) return false;
    return Object.entries(node.inputs).some(([k, v]) => /^lora_\d+$/.test(k) && v && typeof v === 'object');
}

/** True if the user pointed one of its slots at a placeholder, i.e. handed the node to us. */
export function powerNodeIsClaimed(node) {
    if (!isPowerLoraNode(node)) return false;
    return Object.entries(node.inputs).some(([k, v]) =>
        /^lora_\d+$/.test(k) && typeof v?.lora === 'string' && LORA_PLACEHOLDER.test(v.lora));
}

/**
 * Replace every lora_N slot on a Power Lora Loader with the configured list. Other inputs
 * (model, clip, the header widget, the "add lora" button) are left alone.
 * Returns how many slots were written.
 */
export function writePowerLoraNode(node, loras) {
    for (const k of Object.keys(node.inputs)) {
        if (/^lora_\d+$/.test(k)) delete node.inputs[k];
    }
    let n = 0;
    for (const lora of loras || []) {
        if (!lora?.name) continue;
        node.inputs[`lora_${++n}`] = {
            on: !!lora.enabled,
            lora: lora.name,
            strength: clampWeight(lora),
        };
    }
    return n;
}

/**
 * Pull hardcoded slots out of a Power Lora Loader so they can be managed in the UI instead of by
 * hand-editing JSON. Placeholder slots are skipped - those are already ours.
 */
export function importLorasFromPowerNode(node) {
    if (!isPowerLoraNode(node)) return [];
    return Object.entries(node.inputs)
        .filter(([k]) => /^lora_\d+$/.test(k))
        .sort((a, b) => parseInt(a[0].slice(5), 10) - parseInt(b[0].slice(5), 10))
        .map(([, v]) => v)
        .filter(v => typeof v?.lora === 'string' && v.lora && !LORA_PLACEHOLDER.test(v.lora))
        .map(v => {
            const lora = makeLora(v.lora, typeof v.strength === 'number' ? v.strength : 1.0);
            lora.enabled = v.on !== false;
            // A hardcoded strength outside the default span would otherwise clamp on first render.
            lora.min = Math.min(lora.min, lora.weight);
            lora.max = Math.max(lora.max, lora.weight);
            return lora;
        });
}

/**
 * Settings used to hold four fixed LoRA slots plus a per-workflow snapshot of the image params
 * (savedWorkflowStates). Both become profiles: a workflow + its LoRAs + its params, linkable to
 * characters and chats. Every old workflow snapshot turns into a profile of the same name, so
 * nothing that was tuned is lost - this is the one step in the change that can't be undone by
 * reloading, which is why it lives here where the test can run it.
 *
 * Returns true if anything changed.
 */
export function migrateSettingsToProfiles(settings, makeId) {
    let migrated = false;

    if (!Array.isArray(settings.loras)) {
        settings.loras = migrateLegacyLoras(settings);
        stripLegacyLoras(settings);
        migrated = true;
    }
    if (!settings.savedWorkflowStates) return migrated;

    settings.profiles = settings.profiles || {};
    for (const [workflow, state] of Object.entries(settings.savedWorkflowStates)) {
        if (!Array.isArray(state.loras)) {
            state.loras = migrateLegacyLoras(state);
            stripLegacyLoras(state);
        }
        const id = makeId();
        settings.profiles[id] = {
            id,
            name: workflow.replace(/\.json$/i, ''),
            links: [],
            state: { ...state, currentWorkflowName: workflow },
        };
    }
    delete settings.savedWorkflowStates;
    return true;
}

/**
 * Which profile owns the current chat. Chat links beat character/group links, so pinning one
 * specific chat overrides the character-wide default.
 */
export function findProfileForContext(profiles, { chatId, characterAvatar, groupId } = {}) {
    const list = Object.values(profiles || {});
    const linked = (p, type, id) => !!id && p.links?.some(l => l.type === type && l.id === id);

    return list.find(p => linked(p, 'chat', chatId))
        || list.find(p => linked(p, 'character', characterAvatar) || linked(p, 'group', groupId))
        || null;
}
