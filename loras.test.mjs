/**
 * Self-check for the LoRA model helpers: node loras.test.mjs
 * No framework on purpose - these are pure functions, assert is enough.
 */
import assert from 'node:assert/strict';
import {
    clampWeight, collectLoraTriggers, findProfileForContext, importLorasFromPowerNode, isPowerLoraNode, makeLora,
    appearanceKey, migrateAppearanceToCharacters, speakerAvatar,
    migrateLegacyLoras, migrateSettingsToProfiles, powerNodeIsClaimed, resolveLoraPlaceholder,
    writePowerLoraNode,
} from './loras.js';

// --- legacy 4-slot settings fold into the array ---
{
    const legacy = {
        selectedLora: 'a.safetensors', selectedLoraWt: 0.8,
        selectedLora2: '', selectedLoraWt2: 1.0,
        selectedLora3: 'c.safetensors', selectedLoraWt3: -0.5,
        selectedLora4: '', selectedLoraWt4: 1.0,
    };
    const out = migrateLegacyLoras(legacy);
    assert.equal(out.length, 2, 'empty slots are dropped');
    assert.deepEqual(out.map(l => l.name), ['a.safetensors', 'c.safetensors']);
    assert.equal(out[1].weight, -0.5);
    assert.ok(out.every(l => l.enabled), 'migrated slots come back on');
    assert.deepEqual(migrateLegacyLoras({}), [], 'fresh install migrates to nothing');
}

// --- placeholder resolution (classic LoraLoader path) ---
{
    const loras = [
        { name: 'one.safetensors', weight: 0.7, min: -2, max: 2, enabled: true },
        { name: 'two.safetensors', weight: 1.0, min: -2, max: 2, enabled: false },
        { name: 'three.safetensors', weight: 9.0, min: 0, max: 1.5, enabled: true },
    ];

    // The unnumbered pair is slot 1. Every pre-existing workflow JSON uses it.
    assert.equal(resolveLoraPlaceholder('*lora*', loras), 'one.safetensors');
    assert.equal(resolveLoraPlaceholder('*lorawt*', loras), 0.7);
    assert.equal(resolveLoraPlaceholder('*lora1*', loras), 'one.safetensors');

    assert.equal(resolveLoraPlaceholder('*lora3*', loras), 'three.safetensors');
    assert.equal(resolveLoraPlaceholder('*lorawt3*', loras), 1.5, 'weight clamps to the slot max');

    // Off keeps a valid filename so ComfyUI's combo validation still passes; the weight goes to 0.
    assert.equal(resolveLoraPlaceholder('*lora2*', loras), 'two.safetensors');
    assert.equal(resolveLoraPlaceholder('*lorawt2*', loras), 0);

    // Slots the workflow has but the profile doesn't.
    assert.equal(resolveLoraPlaceholder('*lora9*', loras, 'fallback.safetensors'), 'fallback.safetensors');
    assert.equal(resolveLoraPlaceholder('*lorawt9*', loras), 0);

    // Not our placeholders.
    assert.equal(resolveLoraPlaceholder('*model*', loras), undefined);
    assert.equal(resolveLoraPlaceholder('*loras*', loras), undefined);
    assert.equal(resolveLoraPlaceholder(4, loras), undefined);
    assert.equal(resolveLoraPlaceholder(['35', 0], loras), undefined);

    assert.equal(clampWeight({ weight: 'x', min: -2, max: 2 }), 0, 'unparseable weight is inert');
}

// --- Power Lora Loader rewrite ---
{
    const node = {
        class_type: 'Power Lora Loader (rgthree)',
        inputs: {
            PowerLoraLoaderHeaderWidget: { type: 'PowerLoraLoaderHeaderWidget' },
            lora_1: { on: true, lora: '*lora*', strength: '*lorawt*' },
            lora_2: { on: true, lora: '*lora2*', strength: '*lorawt2*' },
            lora_5: { on: false, lora: 'hardcoded.safetensors', strength: 1 },
            '➕ Add Lora': '',
            model: ['761', 0],
            clip: ['755', 0],
        },
    };
    assert.ok(isPowerLoraNode(node));
    assert.ok(powerNodeIsClaimed(node), 'a placeholder slot hands the node to us');

    const imported = importLorasFromPowerNode(node);
    assert.deepEqual(imported.map(l => l.name), ['hardcoded.safetensors'], 'placeholder slots are not imported');
    assert.equal(imported[0].enabled, false, 'on:false survives the import');

    const written = writePowerLoraNode(node, [
        { name: 'x.safetensors', weight: 1.1, min: -2, max: 2, enabled: true },
        { name: '', weight: 1.0, min: -2, max: 2, enabled: true },
        { name: 'y.safetensors', weight: 0.5, min: -2, max: 2, enabled: false },
    ]);
    assert.equal(written, 2, 'unnamed rows are skipped, not emitted as blanks');
    assert.deepEqual(node.inputs.lora_1, { on: true, lora: 'x.safetensors', strength: 1.1 });
    assert.deepEqual(node.inputs.lora_2, { on: false, lora: 'y.safetensors', strength: 0.5 });
    assert.equal(node.inputs.lora_5, undefined, 'old slots are gone, not left dangling');
    assert.deepEqual(node.inputs.model, ['761', 0], 'wiring survives');
    assert.deepEqual(node.inputs.clip, ['755', 0]);
    assert.ok(node.inputs.PowerLoraLoaderHeaderWidget, 'other widgets survive');

    // Cleared list leaves a valid pass-through node rather than a broken one.
    assert.equal(writePowerLoraNode(node, []), 0);
    assert.deepEqual(node.inputs.model, ['761', 0]);

    const classic = { class_type: 'LoraLoader', inputs: { lora_name: '*lora*', strength_model: '*lorawt*' } };
    assert.equal(isPowerLoraNode(classic), false, 'classic loaders keep the placeholder path');
    assert.equal(powerNodeIsClaimed(classic), false);
}

// --- profile lookup ---
{
    const profiles = {
        a: { id: 'a', name: 'Anime', links: [{ type: 'character', id: 'Lyra.png' }] },
        b: { id: 'b', name: 'Realistic', links: [{ type: 'chat', id: 'Lyra - 2026-01-01' }, { type: 'group', id: 'g1' }] },
        c: { id: 'c', name: 'Unlinked', links: [] },
    };
    assert.equal(findProfileForContext(profiles, { characterAvatar: 'Lyra.png' })?.id, 'a');
    assert.equal(findProfileForContext(profiles, { groupId: 'g1' })?.id, 'b');
    assert.equal(
        findProfileForContext(profiles, { characterAvatar: 'Lyra.png', chatId: 'Lyra - 2026-01-01' })?.id, 'b',
        'a chat link beats the character link');
    assert.equal(findProfileForContext(profiles, { characterAvatar: 'Other.png' }), null);
    // No character loaded must not match a profile that happens to hold an empty link id.
    assert.equal(findProfileForContext({ d: { links: [{ type: 'character', id: undefined }] } }, {}), null);
    assert.equal(findProfileForContext({}, { characterAvatar: 'Lyra.png' }), null);
}

// --- settings migration: the one step a reload can't undo ---
{
    const settings = {
        comfyUrl: 'http://127.0.0.1:8188',
        currentWorkflowName: 'krea2.json',
        selectedLora: 'live.safetensors', selectedLoraWt: -2,
        selectedLora2: '', selectedLoraWt2: 1,
        savedWorkflowStates: {
            'krea2.json': { selectedModel: 'krea.safetensors', steps: 10, cfg: 8.5, selectedLora: 'a.safetensors', selectedLoraWt: 0.4 },
            'pony.json': { selectedModel: 'pony.safetensors', steps: 24, cfg: 7 },
        },
    };
    const before = structuredClone(settings);

    let n = 0;
    assert.equal(migrateSettingsToProfiles(settings, () => `id${++n}`), true);

    const profiles = Object.values(settings.profiles);
    assert.equal(profiles.length, 2, 'one profile per saved workflow');
    const krea = profiles.find(p => p.state.currentWorkflowName === 'krea2.json');
    assert.equal(krea.name, 'krea2', 'named after the workflow, without the extension');
    assert.equal(krea.state.steps, 10, 'tuned params come across');
    assert.equal(krea.state.cfg, 8.5);
    assert.deepEqual(krea.state.loras.map(l => l.name), ['a.safetensors'], 'that workflow\'s LoRAs come across');
    assert.equal(krea.state.loras[0].weight, 0.4);
    assert.deepEqual(krea.links, [], 'migrated profiles start unlinked');
    assert.deepEqual(profiles.find(p => p.name === 'pony').state.loras, [], 'no LoRAs stays no LoRAs');

    assert.deepEqual(settings.loras.map(l => l.name), ['live.safetensors'], 'the live slots migrate too');
    assert.equal(settings.loras[0].weight, -2);
    assert.equal(settings.savedWorkflowStates, undefined, 'old store is gone');
    assert.equal('selectedLora' in settings, false, 'old slot keys are gone');
    assert.equal(settings.comfyUrl, before.comfyUrl, 'unrelated settings are untouched');

    // Running again on already-migrated settings must not duplicate profiles or clear the list.
    const snapshot = structuredClone(settings);
    assert.equal(migrateSettingsToProfiles(settings, () => 'never'), false);
    assert.deepEqual(settings, snapshot, 'migration is idempotent');

    // Fresh install: nothing to migrate, but the array still gets created.
    const fresh = {};
    assert.equal(migrateSettingsToProfiles(fresh, () => 'x'), true);
    assert.deepEqual(fresh.loras, []);
    assert.equal(fresh.profiles, undefined, 'no phantom profiles for a fresh install');
}

// --- shape guarantees the UI leans on ---
{
    const l = makeLora('n.safetensors');
    assert.equal(l.enabled, true);
    assert.equal(makeLora('').enabled, false, 'an empty row starts off');
    assert.ok(l.min < l.max);
}

// --- per-LoRA trigger words ---
{
    const triggers = { 'a.safetensors': 'lyra_v2, blue hair', 'b.safetensors': 'ohwx dog', 'c.safetensors': '  ' };
    const loras = [
        { name: 'a.safetensors', enabled: true },
        { name: 'b.safetensors', enabled: false },
        { name: 'c.safetensors', enabled: true },
        { name: 'd.safetensors', enabled: true },
    ];

    assert.equal(collectLoraTriggers(loras, triggers), 'lyra_v2, blue hair',
        'only enabled LoRAs contribute, blank and unknown ones add nothing');

    loras[1].enabled = true;
    assert.equal(collectLoraTriggers(loras, triggers), 'lyra_v2, blue hair, ohwx dog', 'list order is kept');

    // The trigger follows the file: swapping a row picks up the new file's words, not the old ones.
    loras[0].name = 'b.safetensors';
    assert.equal(collectLoraTriggers([loras[0]], triggers), 'ohwx dog');

    assert.equal(collectLoraTriggers(loras, undefined), '', 'no map configured yet');
    assert.equal(collectLoraTriggers(undefined, triggers), '');
    assert.equal(collectLoraTriggers([{ name: '', enabled: true }], triggers), '', 'empty slot is skipped');
}

// --- appearance moves from the profile to the character ---
{
    assert.equal(appearanceKey({ characterAvatar: 'makima.png' }), 'makima.png');
    assert.equal(appearanceKey({ characterAvatar: 'makima.png', groupId: 'g1' }), 'group:g1', 'a group chat has no single character');
    assert.equal(appearanceKey({}), '', 'no chat open yet');
    assert.equal(appearanceKey(), '');

    const settings = {
        charAppearance: 'live text',
        activeProfileId: 'a',
        profiles: {
            a: { id: 'a', links: [{ type: 'character', id: 'makima.png' }], state: { charAppearance: 'stale', steps: 20 } },
            b: { id: 'b', links: [{ type: 'character', id: 'power.png' }, { type: 'chat', id: 'c1' }], state: { charAppearance: 'power text' } },
            c: { id: 'c', links: [], state: { charAppearance: 'homeless' } },
            d: { id: 'd', links: [{ type: 'group', id: 'g1' }], state: {} },
        },
    };
    assert.equal(migrateAppearanceToCharacters(settings), true);

    assert.equal(settings.charAppearances['makima.png'], 'live text', 'the live value beats the active profile\'s stale snapshot');
    assert.equal(settings.charAppearances['power.png'], 'power text', 'other profiles use their snapshot');
    assert.equal('c1' in settings.charAppearances, false, 'chat links are not characters');
    assert.deepEqual(Object.keys(settings.charAppearances).sort(), ['makima.png', 'power.png'],
        'text on a profile linked to nothing has no character to belong to');
    assert.equal('charAppearance' in settings, false, 'old key is gone, so the migration cannot run twice');
    assert.equal('charAppearance' in settings.profiles.b.state, false, 'and gone from the snapshots');
    assert.equal(settings.profiles.a.state.steps, 20, 'the rest of the profile state is untouched');

    const snapshot = structuredClone(settings);
    assert.equal(migrateAppearanceToCharacters(settings), false, 'idempotent');
    assert.deepEqual(settings, snapshot);

    // An existing per-character entry is never overwritten by a migrating profile.
    const partial = { charAppearance: 'new', activeProfileId: 'a', charAppearances: { 'makima.png': 'kept' },
        profiles: { a: { id: 'a', links: [{ type: 'character', id: 'makima.png' }], state: {} } } };
    migrateAppearanceToCharacters(partial);
    assert.equal(partial.charAppearances['makima.png'], 'kept');

    const fresh = {};
    assert.equal(migrateAppearanceToCharacters(fresh), false, 'nothing to do on a fresh install');
    assert.deepEqual(fresh, {});
}

// --- in a group, the speaker's own appearance wins ---
{
    const characters = [{ name: 'Makima', avatar: 'makima.png' }, { name: 'Power', avatar: 'power.png' }];

    assert.equal(speakerAvatar({ name: 'Power', original_avatar: 'power.png' }, characters), 'power.png');
    assert.equal(speakerAvatar({ name: 'Makima' }, characters), 'makima.png',
        'a message from before original_avatar existed falls back to the name');
    assert.equal(speakerAvatar({ name: 'Makima', original_avatar: 'makima.png', is_user: true }, characters), '',
        'the user is not a character');
    assert.equal(speakerAvatar({ name: 'Ghost' }, characters), '', 'an unknown name resolves to nobody');
    assert.equal(speakerAvatar({ name: 'System', is_system: true }, characters), '');
    assert.equal(speakerAvatar(undefined, characters), '', 'an empty chat has no speaker');
    assert.equal(speakerAvatar({ name: 'Power', original_avatar: 'power.png' }, undefined), 'power.png');
}

console.log('loras.test.mjs: all assertions passed');
