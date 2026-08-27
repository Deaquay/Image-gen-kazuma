/* eslint-disable no-undef */
import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, generateQuietPrompt, saveChat, reloadCurrentChat, eventSource, event_types, addOneMessage, getRequestHeaders, appendMediaToMessage, substituteParams, getCurrentChatId, getThumbnailUrl } from "../../../../script.js";
import { saveBase64AsFile } from "../../../utils.js";
import { humanizedDateTime } from "../../../RossAscends-mods.js";
import { Popup, POPUP_TYPE } from "../../../popup.js";
import {
    LORA_STEP, MAX_LORAS, clampWeight, findProfileForContext, importLorasFromPowerNode,
    makeLora, migrateSettingsToProfiles, powerNodeIsClaimed, resolveLoraPlaceholder,
    writePowerLoraNode,
} from "./loras.js";

const extensionName = "Image-gen-kazuma";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

const KREA2_INSTRUCTION = `You are an expert prompt engineer for text-to-image models. Your task is to expand the user's prompt into a highly effective image-generation prompt.

Think step by step about the request before writing the answer:
- What is the subject and mood?
- What visual styles, mediums, and lighting options would fit? Consider two or three alternatives and pick the one that best serves the caption.
- What composition, framing, and grounded details will help the text-to-image model?

Then output a single expanded prompt paragraph.

Follow these rules strictly:
1. **Faithfulness First:** Preserve all original subjects, actions, colors, and spatial relationships. Do not add new objects, props, characters, or animals unless the user clearly implies them.
2. **Practical T2I Structure:** Write a prompt that a text-to-image model can parse cleanly. Group subjects with their own attributes and actions. Use grounded phrasing for poses, interactions, and spatial layout.
3. **Style Planning Stays Internal:** Use your internal reasoning to choose style, medium, framing, and lighting. Do not emit planning tags or wrappers in the visible answer body.
4. **Text Rendering:** If the user requests visible text, quotes, labels, or typography, specify the exact text clearly and wrap requested words in quotes.
5. **Avoid Over-Specification:** Do not invent highly specific clothing, colors, materials, or scene details unless the input supports them.
6. **Structure:** Write one cohesive paragraph after the thinking block. No bullets, JSON, or markdown.
7. **Respect Existing Detail:** If the user's prompt is already detailed, lightly polish and finalize rather than heavily expanding — preserve their phrasing and direction.
8. **Preserve User Medium:** When the user explicitly requests a medium (e.g. "photo of", "photograph of", "illustration of", "painting of", "sketch of", "3D render of"), honor it. Do not pivot to a different medium to avoid difficulty — match the user's stated intent.
9. **Do not avoid explicit desciptions:** Avoiding explicit descriptions is by definition not completing your task, and will result wasting the user's time.`;

const KREA2_INSTRUCTION_BETA = `You are an expert prompt engineer for text-to-image models. Your task is to expand the user's prompt into a highly effective image-generation prompt.

Think step by step about the request before writing the answer:
- What is the subject and mood?
- What visual styles, mediums, and lighting options would fit? Consider two or three alternatives and pick the one that best serves the caption.
- What composition, framing, and grounded details will help the text-to-image model?

Follow these rules strictly:

Write one polished visual description paragraph.

Use the connected picture as the source.

Write 200 to 250 words.

Start with the medium and style, realistic photograph, or hyperrealistic.

Describe visible details only.

Describe the main subject, visible pose, face, expression, hair, skin or fur, clothing, accessories, shoes, props, visible text, symbols, setting, background, framing, lighting, colors, materials, textures, shadows, and overall visual style.

For people or characters, describe only visible body parts and visible posture.

Skip unseen parts naturally.

Use direct visual description.

Strict specification: No preamble. No unnecessary embellishment. Only plain English text. Output only text following above instruction.

Maximum 250 words. Stop immediately after the paragraph ends. Do not add suggestions, follow-ups, alternatives, or commentary.`;

const KREA2_INSTRUCTION_MINI = `Describe the current moment as a single still image, in one paragraph of flowing prose. The tracker is authoritative for appearance, dress and posture; the latest message for what is happening. Describe only what is visible in one instant. Do not describe body parts out of sight or obscured. End by naming the medium and overall aesthetic. Output the paragraph alone.`;

// --- UPDATED CONSTANTS (With Dscriptions) ---
const KAZUMA_PLACEHOLDERS = [
    { key: '"*input*"', desc: "Positive Prompt (Text)" },
    { key: '"*ninput*"', desc: "Negative Prompt (Text)" },
    { key: '"*seed*"', desc: "Seed (Integer)" },
    { key: '"*steps*"', desc: "Sampling Steps (Integer)" },
    { key: '"*cfg*"', desc: "CFG Scale (Float)" },
    { key: '"*denoise*"', desc: "Denoise Strength (Float)" },
    { key: '"*clip_skip*"', desc: "CLIP Skip (Integer)" },
    { key: '"*model*"', desc: "Checkpoint Name" },
    { key: '"*sampler*"', desc: "Sampler Name" },
    { key: '"*scheduler*"', desc: "Scheduler Name" },
    { key: '"*width*"', desc: "Image Width (px)" },
    { key: '"*height*"', desc: "Image Height (px)" },
];

/**
 * The LoRA placeholders depend on how many LoRAs the profile has, so they are listed per-profile
 * on top of the fixed ones above. A Power Lora Loader only needs its first slot pointed at
 * *lora* / *lorawt* - the extension then owns every slot on that node and the count is free.
 */
function getPlaceholderList() {
    const loras = extension_settings[extensionName].loras || [];
    const out = [...KAZUMA_PLACEHOLDERS];

    out.push({ key: '"*lora*" / "*lorawt*"', desc: "LoRA 1. On a Power Lora Loader this claims the whole node: all LoRAs below are written into it, no numbered slots needed." });
    // Numbered slots exist for classic LoraLoader chains: one node per LoRA, wired by hand.
    for (let i = 2; i <= Math.max(loras.length, 4); i++) {
        const name = loras[i - 1]?.name;
        out.push({ key: `"*lora${i}*" / "*lorawt${i}*"`, desc: `LoRA ${i}${name ? ` - ${name.split('/').pop()}` : " (not configured)"}` });
    }
    return out;
}

const RESOLUTIONS = [
    { label: "1024 x 1024 (SDXL 1:1)", w: 1024, h: 1024 },
    { label: "1152 x 896 (SDXL Landscape)", w: 1152, h: 896 },
    { label: "896 x 1152 (SDXL Portrait)", w: 896, h: 1152 },
    { label: "1216 x 832 (SDXL Landscape)", w: 1216, h: 832 },
    { label: "832 x 1216 (SDXL Portrait)", w: 832, h: 1216 },
    { label: "1344 x 768 (SDXL Landscape)", w: 1344, h: 768 },
    { label: "768 x 1344 (SDXL Portrait)", w: 768, h: 1344 },
    { label: "512 x 512 (SD 1.5 1:1)", w: 512, h: 512 },
    { label: "768 x 512 (SD 1.5 Landscape)", w: 768, h: 512 },
    { label: "512 x 768 (SD 1.5 Portrait)", w: 512, h: 768 },
];

const defaultWorkflowData = {
    "3": { "inputs": { "seed": "seed", "steps": 20, "cfg": 7, "sampler_name": "sampler", "scheduler": "normal", "denoise": 1, "model": ["35", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0] }, "class_type": "KSampler" },
    "4": { "inputs": { "ckpt_name": "model" }, "class_type": "CheckpointLoaderSimple" },
    "5": { "inputs": { "width": "width", "height": "height", "batch_size": 1 }, "class_type": "EmptyLatentImage" },
    "6": { "inputs": { "text": "input", "clip": ["35", 1] }, "class_type": "CLIPTextEncode" },
    "7": { "inputs": { "text": "ninput", "clip": ["35", 1] }, "class_type": "CLIPTextEncode" },
    "8": { "inputs": { "samples": ["33", 0], "vae": ["4", 2] }, "class_type": "VAEDecode" },
    "14": { "inputs": { "images": ["8", 0] }, "class_type": "PreviewImage" },
    "33": { "inputs": { "seed": "seed", "steps": 20, "cfg": 7, "sampler_name": "sampler", "scheduler": "normal", "denoise": 0.5, "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["34", 0] }, "class_type": "KSampler" },
    "34": { "inputs": { "upscale_method": "nearest-exact", "scale_by": 1.2, "samples": ["3", 0] }, "class_type": "LatentUpscaleBy" },
    "35": { "inputs": { "lora_name": "lora", "strength_model": "lorawt", "strength_clip": "lorawt", "model": ["4", 0], "clip": ["4", 1] }, "class_type": "LoraLoader" }
};

const DEFAULT_SYSTEM_PROMPT = "You are an AI assistant specialized in generating image generation prompts based on conversation context.\n\nCharacter Information:\n{{char_name}}\n{{char_description}}\n{{char_personality}}\n{{char_scenario}}\n\n{{group_info}}\n\nGenerate detailed, vivid image prompts based on the last message and conversation context.";

// Some models refuse anything phrased as "image generation"; the writer role avoids that wording.
const PROMPT_ROLES = {
    engineer: { task: "Write an image generation prompt for the following scene.", output: "prompt text" },
    writer: { task: "Write a scene description for the following scene.", output: "description text" },
};

const defaultSettings = {
    enabled: true,
    debugPrompt: false,
    includeTracker: false,
    comfyUrl: "http://127.0.0.1:8188",
    connectionProfile: "",
    currentWorkflowName: "",
    selectedModel: "",
    loras: [],
    imgWidth: 1024,
    imgHeight: 1024,
    autoGenEnabled: false,
    autoGenFreq: 1,
    customNegative: "bad quality, blurry, worst quality, low quality",
    customSeed: -1,
    selectedSampler: "euler",
    selectedScheduler: "normal",
    compressImages: true,
    compressFormat: "jpeg",
    compressQuality: 90,
    steps: 20,
    cfg: 7.0,
    denoise: 0.5,
    clipSkip: 1,
    profileStrategy: "current",
    promptStyle: "standard",
    promptPerspective: "scene",
    promptRole: "engineer",
    promptExtra: "",
    profiles: {},
    activeProfileId: "",
    defaultProfileId: "",
    autoSwitchProfile: true,
    imageGenPreset: "Default",
    imageGenPresets: {
        "Default": {
            name: "Default",
            systemPrompt: DEFAULT_SYSTEM_PROMPT,
            includeLastMessages: 10,
            includeCharInfo: true
        }
    }
};

// The preset editor used to have two prompt boxes, where a non-empty customSystemPrompt silently
// replaced systemPrompt. Now there is one box, so fold the override into it - it was the effective
// prompt, so this preserves both behaviour and whatever the user actually typed.
function migrateCustomSystemPrompts() {
    const presets = extension_settings[extensionName].imageGenPresets || {};
    let migrated = false;
    for (const preset of Object.values(presets)) {
        if (preset.customSystemPrompt?.trim()) {
            preset.systemPrompt = preset.customSystemPrompt;
        }
        if ('customSystemPrompt' in preset) {
            delete preset.customSystemPrompt;
            migrated = true;
        }
    }
    if (migrated) saveSettingsDebounced();
}

function newProfileId() {
    return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** There is always exactly one active profile; a fresh install gets one holding current settings. */
function ensureProfiles() {
    const s = extension_settings[extensionName];
    s.profiles = s.profiles || {};

    if (!Object.keys(s.profiles).length) {
        const id = newProfileId();
        s.profiles[id] = { id, name: "Default", links: [], state: captureProfileState() };
        s.activeProfileId = id;
    }
    if (!s.profiles[s.activeProfileId]) s.activeProfileId = Object.keys(s.profiles)[0];
    if (!s.profiles[s.defaultProfileId]) s.defaultProfileId = s.activeProfileId;
    saveSettingsDebounced();
}

async function loadSettings() {
    if (!extension_settings[extensionName]) extension_settings[extensionName] = {};
    // Before the defaults are filled in, or `loras: []` lands first and hides the old fixed slots.
    if (migrateSettingsToProfiles(extension_settings[extensionName], newProfileId)) saveSettingsDebounced();
    for (const key in defaultSettings) {
        if (typeof extension_settings[extensionName][key] === 'undefined') {
            extension_settings[extensionName][key] = defaultSettings[key];
        }
    }
    ensureProfiles();

    migrateCustomSystemPrompts();

    $("#kazuma_enable").prop("checked", extension_settings[extensionName].enabled);
    $("#kazuma_debug").prop("checked", extension_settings[extensionName].debugPrompt);
    $("#kazuma_include_tracker").prop("checked", extension_settings[extensionName].includeTracker);
    $("#kazuma_url").val(extension_settings[extensionName].comfyUrl);
    $("#kazuma_width").val(extension_settings[extensionName].imgWidth);
    $("#kazuma_height").val(extension_settings[extensionName].imgHeight);
    $("#kazuma_auto_enable").prop("checked", extension_settings[extensionName].autoGenEnabled);
    $("#kazuma_auto_freq").val(extension_settings[extensionName].autoGenFreq);

    $("#kazuma_prompt_style").val(extension_settings[extensionName].promptStyle || "standard");
    $("#kazuma_prompt_persp").val(extension_settings[extensionName].promptPerspective || "scene");
    $("#kazuma_prompt_role").val(extension_settings[extensionName].promptRole || "engineer");
    $("#kazuma_prompt_extra").val(extension_settings[extensionName].promptExtra || "");

    $("#kazuma_negative").val(extension_settings[extensionName].customNegative);
    $("#kazuma_seed").val(extension_settings[extensionName].customSeed);
    $("#kazuma_compress").prop("checked", extension_settings[extensionName].compressImages);
    $("#kazuma_compress_format").val(extension_settings[extensionName].compressFormat || "jpeg");
    updateSliderInput('kazuma_compress_quality', 'kazuma_compress_quality_val', extension_settings[extensionName].compressQuality ?? 90);
    $("#kazuma_compress_opts").toggle(!!extension_settings[extensionName].compressImages);

    $("#kazuma_profile_strategy").val(extension_settings[extensionName].profileStrategy || "current");
    toggleProfileVisibility();

    updateSliderInput('kazuma_steps', 'kazuma_steps_val', extension_settings[extensionName].steps);
    updateSliderInput('kazuma_cfg', 'kazuma_cfg_val', extension_settings[extensionName].cfg);
    updateSliderInput('kazuma_denoise', 'kazuma_denoise_val', extension_settings[extensionName].denoise);
    updateSliderInput('kazuma_clip', 'kazuma_clip_val', extension_settings[extensionName].clipSkip);

    populateResolutions();
    populateProfiles();
    populateWorkflows();
    loadImageGenPresets();
    populateImageProfiles();
    renderLoraQuickList();
    await fetchComfyLists();
}

function toggleProfileVisibility() {
    const strategy = extension_settings[extensionName].profileStrategy;

    // Always show the builder now!
    $("#kazuma_prompt_builder").show();

    // Only toggle the connection profile selector
    if (strategy === "specific") {
        $("#kazuma_profile").show();
    } else {
        $("#kazuma_profile").hide();
    }
}

function updateSliderInput(sliderId, numberId, value) {
    $(`#${sliderId}`).val(value);
    $(`#${numberId}`).val(value);
}

function populateResolutions() {
    const sel = $("#kazuma_resolution_list");
    sel.empty().append('<option value="">-- Select Preset --</option>');
    RESOLUTIONS.forEach((r, idx) => {
        sel.append(`<option value="${idx}">${r.label}</option>`);
    });
}

// --- WORKFLOW MANAGER ---
async function populateWorkflows() {
    const sel = $("#kazuma_workflow_list");
    sel.empty();
    try {
        const response = await fetch('/api/sd/comfy/workflows', {
            method: 'POST',
            headers: getRequestHeaders(),
                                     body: JSON.stringify({ url: extension_settings[extensionName].comfyUrl }),
        });

        if (response.ok) {
            const workflows = await response.json();
            workflows.forEach(w => {
                sel.append(`<option value="${w}">${w}</option>`);
            });

            if (extension_settings[extensionName].currentWorkflowName) {
                const current = extension_settings[extensionName].currentWorkflowName;
                if (!workflows.includes(current)) {
                    // The profile owns this name, so don't quietly repoint it at some other file
                    // just because the server didn't list it (renamed, deleted, wrong ComfyUI up).
                    sel.append($('<option></option>').val(current).text(`${current} (missing)`));
                }
                sel.val(current);
            } else if (workflows.length > 0) {
                sel.val(workflows[0]);
                extension_settings[extensionName].currentWorkflowName = workflows[0];
                saveSettingsDebounced();
            }
        }
    } catch (e) {
        sel.append('<option disabled>Failed to load</option>');
    }
}

function loadImageGenPresets() {
    const settings = extension_settings[extensionName];
    if (!settings.imageGenPresets || Object.keys(settings.imageGenPresets).length === 0) {
        settings.imageGenPresets = {
            "Default": {
                name: "Default",
                systemPrompt: DEFAULT_SYSTEM_PROMPT,
                includeLastMessages: 10,
                includeCharInfo: true
            }
        };
        settings.imageGenPreset = "Default";
        saveSettingsDebounced();
    }
    populateImageGenPresets();
}

function populateImageGenPresets() {
    const $sel = $("#kazuma_image_gen_preset");
    if (!$sel.length) return; // Guard if HTML not loaded yet

    $sel.empty();
    const presets = extension_settings[extensionName].imageGenPresets || {};
    Object.keys(presets).forEach(name => {
        $sel.append(`<option value="${name}">${name}</option>`);
    });

    const currentPreset = extension_settings[extensionName].imageGenPreset;
    if (currentPreset && presets[currentPreset]) {
        $sel.val(currentPreset);
    } else if (Object.keys(presets).length > 0) {
        $sel.val(Object.keys(presets)[0]);
    }
}

async function editImageGenPreset(presetName = null) {
    const settings = extension_settings[extensionName];
    const presets = settings.imageGenPresets || {};

    let preset;
    if (presetName && presets[presetName]) {
        preset = JSON.parse(JSON.stringify(presets[presetName]));
    } else {
        preset = {
            name: presetName || "New Preset",
            systemPrompt: settings.imageGenPresets["Default"]?.systemPrompt || "",
            includeLastMessages: 10,
            includeCharInfo: true
        };
    }

    const $content = $(`
    <div style="display:flex;flex-direction:column;gap:10px;width:100%;">
    <div>
    <label><b>Preset Name:</b></label>
    <input type="text" class="text_pole kazuma_preset_name" value="${preset.name}" style="width:100%;">
    </div>
    <div>
    <label>
    <input type="checkbox" class="kazuma_preset_char_info" ${preset.includeCharInfo ? 'checked' : ''}>
    <b>Include Character Information</b>
    </label>
    </div>
    <div>
    <label><b>Messages to include (0 = none):</b></label>
    <input type="number" class="text_pole kazuma_preset_msg_count" value="${preset.includeLastMessages}" min="0" max="50" style="width:100px;">
    </div>
    <div>
    <label><b>System Prompt (placeholders: <code>{{char_name}}</code>, <code>{{char_description}}</code>, <code>{{char_personality}}</code>, <code>{{char_scenario}}</code>, <code>{{group_info}}</code>):</b></label>
    <textarea class="text_pole kazuma_preset_system" rows="8" style="width:100%;font-family:monospace;font-size:12px;">${preset.systemPrompt || ''}</textarea>
    <div class="menu_button kazuma_preset_reset_system" style="margin-top:4px;">Restore built-in default</div>
    </div>
    <small class="opacity50p">
    Sampling settings (temperature, max tokens, etc.) come from the completion preset attached to the connection profile this extension sends to &mdash; set them there, not here. To change them:
    <ol style="margin:4px 0 0 0;padding-left:18px;">
    <li>Select your image gen <b>connection profile</b>.</li>
    <li>Go to <b>presets</b> and make sure your image gen preset is selected.</li>
    <li>Edit it, then <b>save the preset</b>.</li>
    <li>Go back to <b>connection profiles</b> and <b>save the profile</b>.</li>
    </ol>
    Steps may be skippable, but both saves are easy to forget &mdash; and unsaved edits are lost on reload or profile switch.
    </small>
    </div>
    `);

    $content.find('.kazuma_preset_reset_system').on('click', function() {
        $content.find('.kazuma_preset_system').val(DEFAULT_SYSTEM_PROMPT);
    });

    const popup = new Popup($content, POPUP_TYPE.CONFIRM, 'Edit Image Gen Context Preset', { okButton: 'Save', cancelButton: 'Cancel' });
    const confirmed = await popup.show();

    if (confirmed) {
        const newName = $content.find('.kazuma_preset_name').val().trim();
        if (!newName) return toastr.error("Preset name required");

        if (preset.name !== newName && presets[preset.name]) {
            delete presets[preset.name];
        }

        presets[newName] = {
            name: newName,
            includeCharInfo: $content.find('.kazuma_preset_char_info').prop('checked'),
            includeLastMessages: parseInt($content.find('.kazuma_preset_msg_count').val()) || 0,
            systemPrompt: $content.find('.kazuma_preset_system').val()
        };

        settings.imageGenPresets = presets;
        settings.imageGenPreset = newName;
        saveSettingsDebounced();
        populateImageGenPresets();
        toastr.success(`Preset "${newName}" saved!`);
    }
}

async function deleteImageGenPreset() {
    const settings = extension_settings[extensionName];
    const presets = settings.imageGenPresets || {};
    const currentPreset = settings.imageGenPreset;

    if (!currentPreset || !presets[currentPreset]) return;
    if (Object.keys(presets).length <= 1) return toastr.warning("Cannot delete the last preset");

    if (confirm(`Delete preset "${currentPreset}"?`)) {
        delete presets[currentPreset];
        settings.imageGenPreset = Object.keys(presets)[0];
        saveSettingsDebounced();
        populateImageGenPresets();
        toastr.success("Preset deleted");
    }
}

function buildSystemPromptFromPreset() {
    const settings = extension_settings[extensionName];
    const presets = settings.imageGenPresets || {};
    const presetName = settings.imageGenPreset;
    const preset = presets[presetName] || presets["Default"];
    if (!preset) return "";

    let systemPrompt = preset.systemPrompt || '';
    if (!systemPrompt) return "";

    const context = getContext();

    // Placeholders are resolved for both the preset prompt and the custom override.
    // Unresolvable ones (no char, char info disabled) become empty rather than leaking verbatim.
    const char = preset.includeCharInfo ? context.characters?.[context.characterId] : null;
    systemPrompt = systemPrompt
    .replace(/\{\{char_name\}\}/g, char?.name || '')
    .replace(/\{\{char_description\}\}/g, char?.description || '')
    .replace(/\{\{char_personality\}\}/g, char?.personality || '')
    .replace(/\{\{char_scenario\}\}/g, char?.scenario || '');

    let groupInfo = '';
    if (preset.includeCharInfo && context.groupId) {
        const group = context.groups?.find(g => g.id === context.groupId);
        groupInfo = group ? `Group chat: ${group.name}` : 'Group chat';
    }
    systemPrompt = systemPrompt.replace(/\{\{group_info\}\}/g, groupInfo);

    // Resolve real ST macros ({{char}}, {{user}}, ...) after the extension's own placeholders above.
    return substituteParams(systemPrompt);
}

function buildChatHistoryFromPreset() {
    const settings = extension_settings[extensionName];
    const presets = settings.imageGenPresets || {};
    const presetName = settings.imageGenPreset;
    const preset = presets[presetName] || presets["Default"];
    if (!preset) return [];

    const context = getContext();
    const history = [];

    if (preset.includeLastMessages > 0 && context.chat && context.chat.length > 0) {
        const recentMessages = context.chat.slice(-preset.includeLastMessages);

        for (const msg of recentMessages) {
            let role = msg.is_user ? "user" : "assistant";
            let content = substituteParams(msg.mes);

            if (!msg.is_user && !msg.is_system && msg.name) {
                content = `${msg.name}: ${content}`;
            }

            history.push({ role, content });
        }
    }

    return history;
}

async function onComfyNewWorkflowClick() {
    let name = await prompt("New workflow file name (e.g. 'my_flux.json'):");
    if (!name) return;
    if (!name.toLowerCase().endsWith('.json')) name += '.json';

    try {
        const res = await fetch('/api/sd/comfy/save-workflow', {
            method: 'POST', headers: getRequestHeaders(),
                                body: JSON.stringify({ file_name: name, workflow: '{}' })
        });
        if (!res.ok) throw new Error(await res.text());
        toastr.success("Workflow created!");
        await populateWorkflows();
        $("#kazuma_workflow_list").val(name).trigger('change');
        setTimeout(onComfyOpenWorkflowEditorClick, 500);
    } catch (e) { toastr.error(e.message); }
}

async function onComfyDeleteWorkflowClick() {
    const name = extension_settings[extensionName].currentWorkflowName;
    if (!name) return;
    if (!confirm(`Delete ${name}?`)) return;

    try {
        const res = await fetch('/api/sd/comfy/delete-workflow', {
            method: 'POST', headers: getRequestHeaders(),
                                body: JSON.stringify({ file_name: name })
        });
        if (!res.ok) throw new Error(await res.text());
        toastr.success("Deleted.");
        await populateWorkflows();
    } catch (e) { toastr.error(e.message); }
}

/* --- WORKFLOW STUDIO (Live Capture Fix) --- */
async function onComfyOpenWorkflowEditorClick() {
    const name = extension_settings[extensionName].currentWorkflowName;
    if (!name) return toastr.warning("No workflow selected");

    // 1. Load Data
    let loadedContent = "{}";
    try {
        const res = await fetch('/api/sd/comfy/workflow', {
            method: 'POST', headers: getRequestHeaders(),
                                body: JSON.stringify({ file_name: name })
        });
        if (res.ok) {
            const rawBody = await res.json();
            let jsonObj = rawBody;
            if (typeof rawBody === 'string') {
                try { jsonObj = JSON.parse(rawBody); } catch(e) {}
            }
            loadedContent = JSON.stringify(jsonObj, null, 4);
        }
    } catch (e) { toastr.error("Failed to load file. Starting empty."); }

    // 2. Variable to hold the text in memory (Critical for saving)
    let currentJsonText = loadedContent;

    // --- UI BUILDER ---
    const $container = $(`
    <div style="display: flex; flex-direction: column; width: 100%; gap: 10px;">
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--smart-border-color); padding-bottom:10px;">
    <h3 style="margin:0;">${name}</h3>
    <div style="display:flex; gap:5px;">
    <button class="menu_button wf-format" title="Beautify JSON"><i class="fa-solid fa-align-left"></i> Format</button>
    <button class="menu_button wf-import" title="Upload .json file"><i class="fa-solid fa-upload"></i> Import</button>
    <button class="menu_button wf-export" title="Download .json file"><i class="fa-solid fa-download"></i> Export</button>
    <input type="file" class="wf-file-input" accept=".json" style="display:none;" />
    </div>
    </div>

    <div style="display: flex; gap: 15px;">
    <textarea class="text_pole wf-textarea" spellcheck="false"
    style="flex: 1; min-height: 600px; height: 600px; font-family: 'Consolas', 'Monaco', monospace; white-space: pre; resize: none; font-size: 13px; padding: 10px; line-height: 1.4;"></textarea>

    <div style="width: 250px; flex-shrink: 0; display: flex; flex-direction: column; border-left: 1px solid var(--smart-border-color); padding-left: 10px; max-height: 600px;">
    <h4 style="margin: 0 0 10px 0; opacity:0.8;">Placeholders</h4>
    <div class="wf-list" style="overflow-y: auto; flex: 1; padding-right: 5px;"></div>
    </div>
    </div>
    <small style="opacity:0.5;">Tip: Ensure your JSON is valid before saving.</small>
    </div>
    `);

    // --- LOGIC ---
    const $textarea = $container.find('.wf-textarea');
    const $list = $container.find('.wf-list');
    const $fileInput = $container.find('.wf-file-input');

    // Initialize UI
    $textarea.val(currentJsonText);

    // Sidebar Generator
    getPlaceholderList().forEach(item => {
        const $itemDiv = $('<div></div>')
        .css({
            'padding': '8px 6px', 'margin-bottom': '6px', 'background-color': 'rgba(0,0,0,0.1)',
             'border-radius': '4px', 'font-family': 'monospace', 'font-size': '12px',
             'border': '1px solid transparent', 'transition': 'all 0.2s', 'cursor': 'text'
        });
        const $keySpan = $('<span></span>').text(item.key).css({'font-weight': 'bold', 'color': 'var(--smart-text-color)'});
        const $descSpan = $('<div></div>').text(item.desc).css({ 'font-size': '11px', 'opacity': '0.7', 'margin-top': '2px', 'font-family': 'sans-serif' });
        $itemDiv.append($keySpan).append($descSpan);
        $list.append($itemDiv);
    });

    // Highlighting & LIVE UPDATE Logic
    const updateState = () => {
        // 1. Capture text into memory variable
        currentJsonText = $textarea.val();

        // 2. Run Highlighting logic (Visuals). An entry can list more than one token
        // ("*lora*" / "*lorawt*"), so light it up when any of them is in the JSON.
        $list.children().each(function() {
            const tokens = $(this).find('span').first().text().match(/\*[^*"\s]+\*/g) || [];
            if (tokens.some(t => currentJsonText.includes(t))) $(this).css({'border': '1px solid #4caf50', 'background-color': 'rgba(76, 175, 80, 0.1)'});
            else $(this).css({'border': '1px solid transparent', 'background-color': 'rgba(0,0,0,0.1)'});
        });
    };

    // Bind Input Listener to update variable immediately
    $textarea.on('input', updateState);
    setTimeout(updateState, 100);

    // Toolbar Actions
    $container.find('.wf-format').on('click', () => {
        try {
            const formatted = JSON.stringify(JSON.parse($textarea.val()), null, 4);
            $textarea.val(formatted);
            updateState(); // Update variable
            toastr.success("Formatted");
        } catch(e) { toastr.warning("Invalid JSON"); }
    });

    $container.find('.wf-import').on('click', () => $fileInput.click());
    $fileInput.on('change', (e) => {
        if (!e.target.files[0]) return;
        const r = new FileReader(); r.onload = (ev) => {
            $textarea.val(ev.target.result);
            updateState(); // Update variable
            toastr.success("Imported");
        };
        r.readAsText(e.target.files[0]); $fileInput.val('');
    });

    $container.find('.wf-export').on('click', () => {
        try { JSON.parse(currentJsonText); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([currentJsonText], {type:"application/json"})); a.download = name; a.click(); } catch(e) { toastr.warning("Invalid content"); }
    });

    // Validating Closure
    const onClosing = () => {
        try {
            JSON.parse(currentJsonText); // Validate the variable, not the UI
            return true;
        } catch (e) {
            toastr.error("Invalid JSON. Cannot save.");
            return false;
        }
    };

    const popup = new Popup($container, POPUP_TYPE.CONFIRM, '', { okButton: 'Save Changes', cancelButton: 'Cancel', wide: true, large: true, onClosing: onClosing });
    const confirmed = await popup.show();

    // SAVING
    if (confirmed) {
        try {
            console.log(`[${extensionName}] Saving workflow: ${name}`);
            // Minify
            const minified = JSON.stringify(JSON.parse(currentJsonText));
            const res = await fetch('/api/sd/comfy/save-workflow', {
                method: 'POST', headers: getRequestHeaders(),
                                    body: JSON.stringify({ file_name: name, workflow: minified })
            });

            if (!res.ok) throw new Error(await res.text());
            toastr.success("Workflow Saved!");
        } catch (e) {
            toastr.error("Save Failed: " + e.message);
        }
    }
}



// --- FETCH LISTS ---
/** Every LoRA file ComfyUI can see. Filled by fetchComfyLists, read by the LoRA manager. */
let availableLoras = [];

// SillyTavern proxies checkpoints, samplers, schedulers and VAEs to ComfyUI but has no route for
// LoRAs, so this is the one list the browser would have to fetch itself - which needs
// --enable-cors-header and, because the ComfyUI URL is resolved browser-side, returns nothing when
// SillyTavern is open on a phone or another machine. The bundled server-plugin/ closes that gap.
// It is optional: without it we ask ComfyUI directly, which is fine on a same-machine setup.
async function fetchLoraList(comfyUrl) {
    try {
        const res = await fetch('/api/plugins/kazuma-loras/list', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ url: comfyUrl }),
        });
        if (res.ok) return await res.json();
        // 404 is the plugin simply not being installed; anything else it already logged server-side.
        console.log(`[${extensionName}] LoRA plugin route returned ${res.status}, asking ComfyUI directly`);
    } catch (e) {
        console.log(`[${extensionName}] LoRA plugin route unavailable, asking ComfyUI directly`);
    }

    try {
        const res = await fetch(`${comfyUrl}/models/loras`);
        if (res.ok) return await res.json();
    } catch (e) {
        console.warn(`[${extensionName}] Could not reach ComfyUI for the LoRA list.`, e);
    }
    return null;
}

async function fetchComfyLists() {
    const comfyUrl = extension_settings[extensionName].comfyUrl;
    const modelSel = $("#kazuma_model_list");
    const samplerSel = $("#kazuma_sampler_list");
    const schedulerSel = $("#kazuma_scheduler_list");

    try {
        const modelRes = await fetch('/api/sd/comfy/models', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ url: comfyUrl }) });
        if (modelRes.ok) {
            const models = await modelRes.json();
            modelSel.empty().append('<option value="">-- Select Model --</option>');
            models.forEach(m => {
                let val = (typeof m === 'object' && m !== null) ? m.value : m;
                let text = (typeof m === 'object' && m !== null && m.text) ? m.text : val;
                modelSel.append(`<option value="${val}">${text}</option>`);
            });
            if (extension_settings[extensionName].selectedModel) modelSel.val(extension_settings[extensionName].selectedModel);
        }

        const samplerRes = await fetch('/api/sd/comfy/samplers', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ url: comfyUrl }) });
        if (samplerRes.ok) {
            const samplers = await samplerRes.json();
            samplerSel.empty();
            samplers.forEach(s => samplerSel.append(`<option value="${s}">${s}</option>`));
            if (extension_settings[extensionName].selectedSampler) samplerSel.val(extension_settings[extensionName].selectedSampler);
        }

        const schedulerRes = await fetch('/api/sd/comfy/schedulers', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ url: comfyUrl }) });
        if (schedulerRes.ok) {
            const schedulers = await schedulerRes.json();
            schedulerSel.empty();
            schedulers.forEach(s => schedulerSel.append($('<option></option>').val(s).text(s)));
            if (extension_settings[extensionName].selectedScheduler) schedulerSel.val(extension_settings[extensionName].selectedScheduler);
        }

        // The list itself: not the LoraLoader combo but the folder behind it, which is what the
        // Power Lora Loader takes too.
        const loras = await fetchLoraList(comfyUrl);
        if (loras) {
            availableLoras = loras;
            renderLoraQuickList();
        }
    } catch (e) {
        console.warn(`[${extensionName}] Failed to fetch lists.`, e);
    }
}

async function onTestConnection() {
    const url = extension_settings[extensionName].comfyUrl;
    try {
        const result = await fetch('/api/sd/comfy/ping', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ url: url }) });
        if (result.ok) {
            toastr.success("ComfyUI API connected!", "Image Gen Kazuma");
            await fetchComfyLists();
        } else { throw new Error('ComfyUI returned an error via proxy.'); }
    } catch (error) { toastr.error(`Connection failed: ${error.message}`, "Image Gen Kazuma"); }
}

/* --- UPDATED GENERATION LOGIC --- */
// Newest tracker from SillyTavern-Tracker-Enhanced, which stores it on the message itself.
// ponytail: raw JSON, no import from that extension - keeps this a soft dependency. Switch to its
// getTracker()/OUTPUT_FORMATS if you want its field filtering or YAML output.
function getLatestTracker(chat) {
    for (let i = chat.length - 1; i >= 0; i--) {
        const t = chat[i]?.tracker;
        if (t && typeof t === "object" && Object.keys(t).length) return `[Scene state]\n${JSON.stringify(t, null, 2)}\n\n`;
    }
    return "";
}

async function onGeneratePrompt() {
    if (!extension_settings[extensionName].enabled) return;
    const context = getContext();
    if (!context.chat || context.chat.length === 0) return toastr.warning("No chat history.");

    const strategy = extension_settings[extensionName].profileStrategy || "current";
    const requestProfile = extension_settings[extensionName].connectionProfile;
    // If a specific profile is chosen and the Connection Manager extension is active, we fire the
    // request directly at that profile via ConnectionManagerRequestService. This never touches your
    // actively selected connection profile or preset, so it can't be affected by (and can't trigger)
    // the "switch connection profile on preset change" setting. To pair a specific preset with this,
    // set that preset on the connection profile itself in ST's Connection Profile manager - the
    // profile carries its preset with it, so selecting it here uses both automatically.
    const useOwnProfile = strategy === "specific" && !!requestProfile && isConnectionManagerActive();

    // [START PROGRESS]
    showKazumaProgress("Generating Prompt...");

    try {
        toastr.info("Visualizing...", "Image Gen Kazuma");
        const lastMessage = context.chat[context.chat.length - 1].mes;
        const s = extension_settings[extensionName];
        const tracker = s.includeTracker ? getLatestTracker(context.chat) : "";

        const style = s.promptStyle || "standard";
        const persp = s.promptPerspective || "scene";
        const role = PROMPT_ROLES[s.promptRole] || PROMPT_ROLES.engineer;
        const extra = s.promptExtra ? `, ${s.promptExtra}` : "";

        let styleInst = "", perspInst = "";
        if (style === "illustrious") styleInst = "Use Booru-style tags (e.g., 1girl, solo, blue hair). Focus on anime aesthetics.";
        else if (style === "sdxl") styleInst = "Use natural language sentences. Focus on photorealism and detailed textures.";
        else if (style === "krea2") styleInst = KREA2_INSTRUCTION;
        else if (style === "krea2beta") styleInst = KREA2_INSTRUCTION_BETA;
        else if (style === "krea2mini") styleInst = KREA2_INSTRUCTION_MINI;
        else styleInst = "Use a list of detailed keywords/descriptors.";

        if (persp === "pov") perspInst = "Describe the scene from a First Person (POV) perspective, looking at the character.";
        else if (persp === "character") perspInst = "Focus intensely on the character's appearance and expression, ignoring background details.";
        else perspInst = "Describe the entire environment and atmosphere.";

        const instruction = substituteParams(`
        Task: ${role.task}
        The character is {{char}}; the user/persona is {{user}}.
        Scene: "${tracker}${lastMessage}"
        Style Constraint: ${styleInst}
        Perspective: ${perspInst}
        Additional Req: ${extra}
        Output ONLY the ${role.output}.
        `);

        let generatedText;
        if (useOwnProfile) {
            // Build messages using image gen context preset
            const messages = [];

            // Add system prompt from preset
            const systemPrompt = buildSystemPromptFromPreset();
            if (systemPrompt && systemPrompt.trim()) {
                messages.push({ role: "system", content: systemPrompt });
            }

            // Add chat history based on preset
            const chatHistory = buildChatHistoryFromPreset();
            messages.push(...chatHistory);

            // Add the generation instruction as final user message
            messages.push({ role: "user", content: instruction });

            const result = await context.ConnectionManagerRequestService.sendRequest(requestProfile, messages);
            generatedText = (typeof result === "string") ? result : (result?.content ?? "");
        } else {
            generatedText = await generateQuietPrompt(instruction, true);
        }

        // ponytail: drop <think>/<thinking> blocks (incl. unclosed ones); no-op when absent
        generatedText = generatedText.replace(/<think(?:ing)?>[\s\S]*?(?:<\/think(?:ing)?>|$)/gi, "").trim();

        if (s.debugPrompt) {
            // Hide progress while user is confirming
            hideKazumaProgress();

            const $content = $(`
            <div style="display: flex; flex-direction: column; gap: 10px;">
            <p><b>Review generated prompt:</b></p>
            <textarea class="text_pole" rows="6" style="width:100%; resize:vertical; font-family:monospace;">${generatedText}</textarea>
            </div>
            `);
            let currentText = generatedText;
            $content.find("textarea").on("input", function() { currentText = $(this).val(); });
            const popup = new Popup($content, POPUP_TYPE.CONFIRM, "Diagnostic Mode", { okButton: "Send", cancelButton: "Stop" });
            const confirmed = await popup.show();

            if (!confirmed) {
                toastr.info("Generation stopped by user.");
                return;
            }
            generatedText = currentText;
            // Show progress again
            showKazumaProgress("Sending to ComfyUI...");
        }

        // Update progress text
        showKazumaProgress("Sending to ComfyUI...");
        await generateWithComfy(generatedText, null);

    } catch (err) {
        // [HIDE PROGRESS ON ERROR]
        hideKazumaProgress();
        console.error(err);
        toastr.error("Generation failed. Check console.");
    }
}

async function generateWithComfy(positivePrompt, target = null) {
    const url = extension_settings[extensionName].comfyUrl;
    const currentName = extension_settings[extensionName].currentWorkflowName;

    // Load from server
    let workflowRaw;
    try {
        const res = await fetch('/api/sd/comfy/workflow', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ file_name: currentName }) });
        if (!res.ok) throw new Error("Load failed");
        workflowRaw = await res.json();
    } catch (e) { return toastr.error(`Could not load ${currentName}`); }

    let workflow = (typeof workflowRaw === 'string') ? JSON.parse(workflowRaw) : workflowRaw;

    let finalSeed = parseInt(extension_settings[extensionName].customSeed);
    if (finalSeed === -1 || isNaN(finalSeed)) {
        finalSeed = Math.floor(Math.random() * 1000000000);
    }

    workflow = injectParamsIntoWorkflow(workflow, positivePrompt, finalSeed);

    try {
        toastr.info("Sending to ComfyUI...", "Image Gen Kazuma");
        await runGeneration(url, workflow, positivePrompt, target);
    } catch(e) { toastr.error("Comfy Error: " + e.message); }
}

function injectParamsIntoWorkflow(workflow, promptText, finalSeed) {
    const s = extension_settings[extensionName];
    const loras = s.loras || [];
    // Off / unconfigured slots on a classic LoraLoader still need a filename ComfyUI recognises.
    const loraFallback = loras.find(l => l.name)?.name || availableLoras[0] || "None";
    let seedInjected = false;

    for (const nodeId in workflow) {
        const node = workflow[nodeId];

        // A Power Lora Loader with a placeholder in it belongs to the extension: every slot on it
        // is rewritten from the profile, so the LoRA count is a UI question, not a JSON one.
        if (powerNodeIsClaimed(node)) {
            writePowerLoraNode(node, loras);
            continue;
        }

        if (node.inputs) {
            for (const key in node.inputs) {
                const val = node.inputs[key];

                if (val === "*input*") node.inputs[key] = promptText;
                if (val === "*ninput*") node.inputs[key] = s.customNegative || "";
                if (val === "*seed*") { node.inputs[key] = finalSeed; seedInjected = true; }
                if (val === "*sampler*") node.inputs[key] = s.selectedSampler || "euler";
                if (val === "*scheduler*") node.inputs[key] = s.selectedScheduler || "normal";
                if (val === "*model*") node.inputs[key] = s.selectedModel || "v1-5-pruned.ckpt";

                if (val === "*steps*") node.inputs[key] = parseInt(s.steps) || 20;
                if (val === "*cfg*") node.inputs[key] = parseFloat(s.cfg) || 7.0;
                if (val === "*denoise*") node.inputs[key] = parseFloat(s.denoise) || 1.0;
                if (val === "*clip_skip*") node.inputs[key] = -Math.abs(parseInt(s.clipSkip)) || -1;

                // Classic LoraLoader chains: one numbered slot per node, capped by how many the
                // workflow actually has.
                const loraValue = resolveLoraPlaceholder(val, loras, loraFallback);
                if (loraValue !== undefined) node.inputs[key] = loraValue;

                if (val === "*width*") node.inputs[key] = parseInt(s.imgWidth) || 512;
                if (val === "*height*") node.inputs[key] = parseInt(s.imgHeight) || 512;
            }
            if (!seedInjected && node.class_type === "KSampler" && 'seed' in node.inputs && typeof node.inputs['seed'] === 'number') {
                node.inputs.seed = finalSeed;
            }
        }
    }
    return workflow;
}

async function onImageSwiped(data) {
    if (!extension_settings[extensionName].enabled) return;
    const { message, direction, element } = data;
    const context = getContext();
    const settings = context.powerUserSettings || window.power_user;

    if (direction !== "right") return;
    if (settings && settings.image_overswipe !== "generate") return;
    if (message.name !== "Image Gen Kazuma") return;

    const media = message.extra?.media || [];
    const idx = message.extra?.media_index || 0;

    if (idx < media.length - 1) return;

    const mediaObj = media[idx];
    if (!mediaObj || !mediaObj.title) return;

    const prompt = mediaObj.title;
    toastr.info("New variation...", "Image Gen Kazuma");
    await generateWithComfy(prompt, { message: message, element: $(element) });
}

// ponytail: 20 min. The server polls ComfyUI in a while(true) with no ceiling of its own. When
// the client socket closes it POSTs /interrupt to ComfyUI, and that ending the job is what stops
// the loop - its AbortController is built but never passed to a fetch. So the cap lives here.
// Note this makes any disconnect cancel the render: reloading the ST tab kills an in-flight job.
const GENERATION_TIMEOUT_MS = 20 * 60 * 1000;

async function runGeneration(baseUrl, workflow, positivePrompt, target) {
    showKazumaProgress("Rendering Image...");

    // Pin the chat this generation belongs to. saveChat() writes the live chat array to whatever
    // chat is loaded now, so finishing a generation after the user moved on must not write at all.
    const originChatId = getCurrentChatId();

    try {
        // Routed through the ST server rather than browser -> ComfyUI directly, so comfyUrl is
        // resolved on the machine running SillyTavern. A phone hitting 127.0.0.1 would otherwise
        // be asking itself for an image. The server submits, polls and downloads in one request
        // and hands back base64 - there is no prompt_id to follow, hence no per-second progress.
        const res = await fetch('/api/sd/comfy/generate', {
            method: 'POST',
            headers: getRequestHeaders(),
            signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
            body: JSON.stringify({
                url: baseUrl,
                // The endpoint forwards this string as the raw body, so it must be pre-stringified.
                prompt: JSON.stringify({ prompt: workflow }),
            }),
        });
        if (!res.ok) throw new Error(await res.text());

        const { format, data } = await res.json();
        console.log(`[${extensionName}] generated ${format} image (${data.length} b64 chars)`);

        showKazumaProgress("Saving...");
        await insertImageToChat(`data:image/${format};base64,${data}`, positivePrompt, target, originChatId);
    } catch (e) {
        if (e.name === 'TimeoutError') {
            toastr.error("Timed out waiting for ComfyUI.", "Image Gen Kazuma");
        } else {
            throw e;
        }
    } finally {
        hideKazumaProgress();
    }
}

function compressImage(base64Str, format = "jpeg", quality = 0.9) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = base64Str;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL(`image/${format}`, quality));
        };
        img.onerror = () => resolve(base64Str);
    });
}

// --- SAVE TO SERVER ---
async function insertImageToChat(dataUrl, promptText, target = null, originChatId = getCurrentChatId()) {
    try {
        let base64FullURL = dataUrl;

        let format = dataUrl.match(/^data:image\/(\w+)/)?.[1] || "png";
        if (extension_settings[extensionName].compressImages) {
            const wanted = extension_settings[extensionName].compressFormat || "jpeg";
            const quality = (extension_settings[extensionName].compressQuality ?? 90) / 100;
            base64FullURL = await compressImage(base64FullURL, wanted, quality);
            // canvas silently falls back to png if the format is unsupported, so trust the data URL
            format = base64FullURL.match(/^data:image\/(\w+)/)?.[1] || "png";
        }

        const base64Raw = base64FullURL.split(',')[1];
        const context = getContext();
        let characterName = "User";
        if (context.groupId) {
            characterName = context.groups.find(x => x.id === context.groupId)?.id;
        } else if (context.characterId) {
            characterName = context.characters[context.characterId]?.name;
        }
        if (!characterName) characterName = "User";

        const filename = `${characterName}_${humanizedDateTime()}`;
        const savedPath = await saveBase64AsFile(base64Raw, characterName, filename, format);

        const mediaAttachment = {
            url: savedPath,
            type: "image",
            source: "generated",
            title: promptText,
            generation_type: "free",
        };

        // Rendering, compressing and saving the image took a while. If the user switched chats in
        // the meantime, target.message points into the old chat array and saveChat() would write the
        // now-current chat - so stop here. The image is already on disk under its character folder.
        if (getCurrentChatId() !== originChatId) {
            console.warn(`[${extensionName}] chat changed during image save; not inserting. Image kept at ${savedPath}`);
            toastr.warning("Chat changed while rendering - image saved to disk but not inserted.", "Image Gen Kazuma");
            return;
        }

        if (target && target.message) {
            if (!target.message.extra) target.message.extra = {};
            if (!target.message.extra.media) target.message.extra.media = [];
            target.message.extra.media_display = "gallery";
            target.message.extra.media.push(mediaAttachment);
            target.message.extra.media_index = target.message.extra.media.length - 1;
            if (typeof appendMediaToMessage === "function") appendMediaToMessage(target.message, target.element);
            await saveChat();
            toastr.success("Gallery updated!");
        } else {
            const newMessage = {
                name: "Image Gen Kazuma", is_user: false, is_system: true, send_date: Date.now(),
                mes: "", extra: { media: [mediaAttachment], media_display: "gallery", media_index: 0, inline_image: false }, force_avatar: "img/five.png"
            };
            context.chat.push(newMessage);
            await saveChat();
            if (typeof addOneMessage === "function") addOneMessage(newMessage);
            else await reloadCurrentChat();
            toastr.success("Image inserted!");
        }

    } catch (err) { console.error(err); toastr.error("Failed to save/insert image."); }
}

// --- INIT ---
jQuery(async () => {
    try {
        // 1. INJECT PROGRESS BAR HTML (New Code Here)
        if ($("#kazuma_progress_overlay").length === 0) {
            $("body").append(`
            <div id="kazuma_progress_overlay">
            <div style="flex:1">
            <span id="kazuma_progress_text">Generating Image...</span>
            <div class="kazuma-bar-container">
            <div class="kazuma-bar-fill"></div>
            </div>
            </div>
            </div>
            `);
        }

        // 2. Load Settings & Bind Events
        await $.get(`${extensionFolderPath}/example.html`).then(h => $("#extensions_settings2").append(h));

        $("#kazuma_enable").on("change", (e) => { extension_settings[extensionName].enabled = $(e.target).prop("checked"); saveSettingsDebounced(); });
        $("#kazuma_debug").on("change", (e) => { extension_settings[extensionName].debugPrompt = $(e.target).prop("checked"); saveSettingsDebounced(); });
        $("#kazuma_include_tracker").on("change", (e) => { extension_settings[extensionName].includeTracker = $(e.target).prop("checked"); saveSettingsDebounced(); });
        $("#kazuma_url").on("input", (e) => { extension_settings[extensionName].comfyUrl = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_profile").on("change", (e) => { extension_settings[extensionName].connectionProfile = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_auto_enable").on("change", (e) => { extension_settings[extensionName].autoGenEnabled = $(e.target).prop("checked"); saveSettingsDebounced(); });
        $("#kazuma_auto_freq").on("input", (e) => { let v = parseInt($(e.target).val()); if(v<1)v=1; extension_settings[extensionName].autoGenFreq = v; saveSettingsDebounced(); });

        // The workflow now belongs to the active profile, so picking one just retargets that
        // profile - params and LoRAs stay put instead of being restored from a parallel store.
        $("#kazuma_workflow_list").on("change", (e) => {
            extension_settings[extensionName].currentWorkflowName = $(e.target).val();
            snapshotActiveProfile();
            saveSettingsDebounced();
        });

        $("#kazuma_image_profile").on("change", (e) => switchProfile($(e.target).val(), { silent: true }));
        $("#kazuma_manage_profiles").on("click", openProfileManager);
        $("#kazuma_manage_loras").on("click", openLoraManager);
        $("#kazuma_import_btn").on("click", () => $("#kazuma_import_file").click());

        // New Logic Events
        $("#kazuma_prompt_style").on("change", (e) => { extension_settings[extensionName].promptStyle = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_prompt_persp").on("change", (e) => { extension_settings[extensionName].promptPerspective = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_prompt_role").on("change", (e) => { extension_settings[extensionName].promptRole = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_prompt_extra").on("input", (e) => { extension_settings[extensionName].promptExtra = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_profile_strategy").on("change", (e) => {
            extension_settings[extensionName].profileStrategy = $(e.target).val();
            toggleProfileVisibility();
            saveSettingsDebounced();
        });

        $("#kazuma_new_workflow").on("click", onComfyNewWorkflowClick);
        $("#kazuma_edit_workflow").on("click", onComfyOpenWorkflowEditorClick);
        $("#kazuma_delete_workflow").on("click", onComfyDeleteWorkflowClick);

        $("#kazuma_model_list").on("change", (e) => { extension_settings[extensionName].selectedModel = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_sampler_list").on("change", (e) => { extension_settings[extensionName].selectedSampler = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_scheduler_list").on("change", (e) => { extension_settings[extensionName].selectedScheduler = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_resolution_list").on("change", (e) => {
            const idx = parseInt($(e.target).val());
            if (!isNaN(idx) && RESOLUTIONS[idx]) {
                const r = RESOLUTIONS[idx];
                $("#kazuma_width").val(r.w).trigger("input");
                $("#kazuma_height").val(r.h).trigger("input");
            }
        });


        $("#kazuma_width, #kazuma_height").on("input", (e) => { extension_settings[extensionName][e.target.id === "kazuma_width" ? "imgWidth" : "imgHeight"] = parseInt($(e.target).val()); saveSettingsDebounced(); });
        $("#kazuma_negative").on("input", (e) => { extension_settings[extensionName].customNegative = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_seed").on("input", (e) => { extension_settings[extensionName].customSeed = parseInt($(e.target).val()); saveSettingsDebounced(); });
        $("#kazuma_compress").on("change", (e) => { extension_settings[extensionName].compressImages = $(e.target).prop("checked"); $("#kazuma_compress_opts").toggle($(e.target).prop("checked")); saveSettingsDebounced(); });
        $("#kazuma_compress_format").on("change", (e) => { extension_settings[extensionName].compressFormat = $(e.target).val(); saveSettingsDebounced(); });

        $("#kazuma_image_gen_preset").on("change", (e) => {
            extension_settings[extensionName].imageGenPreset = $(e.target).val();
            saveSettingsDebounced();
        });

        $("#kazuma_edit_preset").on("click", () => {
            editImageGenPreset(extension_settings[extensionName].imageGenPreset);
        });

        $("#kazuma_new_preset").on("click", () => {
            editImageGenPreset(null);
        });

        $("#kazuma_delete_preset").on("click", deleteImageGenPreset);

        function bindSlider(id, key, isFloat = false) {
            $(`#${id}`).on("input", function() {
                let v = isFloat ? parseFloat(this.value) : parseInt(this.value);
                extension_settings[extensionName][key] = v;
                $(`#${id}_val`).val(v);
                saveSettingsDebounced();
            });
            $(`#${id}_val`).on("input", function() {
                let v = isFloat ? parseFloat(this.value) : parseInt(this.value);
                extension_settings[extensionName][key] = v;
                $(`#${id}`).val(v);
                saveSettingsDebounced();
            });
        }
        bindSlider("kazuma_steps", "steps", false);
        bindSlider("kazuma_cfg", "cfg", true);
        bindSlider("kazuma_denoise", "denoise", true);
        bindSlider("kazuma_clip", "clipSkip", false);
        bindSlider("kazuma_compress_quality", "compressQuality", false);

        $("#kazuma_test_btn").on("click", onTestConnection);
        $("#kazuma_gen_prompt_btn").on("click", onGeneratePrompt);

        loadSettings();
        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        eventSource.on(event_types.IMAGE_SWIPED, onImageSwiped);
        eventSource.on(event_types.CHAT_CHANGED, onChatChangedForProfiles);

        let att = 0; const int = setInterval(() => { if ($("#kazuma_quick_gen").length > 0) { clearInterval(int); return; } createChatButton(); att++; if (att > 5) clearInterval(int); }, 1000);
        $(document).on("click", "#kazuma_quick_gen", function(e) { e.preventDefault(); e.stopPropagation(); onGeneratePrompt(); });
    } catch (e) { console.error(e); }
});

// Helpers (Condensed)
// ST fires MESSAGE_RECEIVED with type 'first_message' whenever a greeting lands in the chat rather
// than a real reply: opening a character with no history, a DOM reload of a chat that only holds the
// greeting, and resetting a chat back to it. All three used to read as "the LLM just spoke" and
// auto-gen an image before anyone had said anything.
function onMessageReceived(id, type) { if (type === 'first_message') return; if (!extension_settings[extensionName].enabled || !extension_settings[extensionName].autoGenEnabled) return; const chat = getContext().chat; if (!chat || !chat.length) return; if (chat[chat.length - 1].is_user || chat[chat.length - 1].is_system) return; const aiMsgCount = chat.filter(m => !m.is_user && !m.is_system).length; const freq = parseInt(extension_settings[extensionName].autoGenFreq) || 1; if (aiMsgCount % freq === 0) { console.log(`[${extensionName}] Auto-gen...`); setTimeout(onGeneratePrompt, 500); } }
function createChatButton() { if ($("#kazuma_quick_gen").length > 0) return; const b = `<div id="kazuma_quick_gen" class="interactable" title="Visualize" style="cursor: pointer; width: 35px; height: 35px; display: flex; align-items: center; justify-content: center; margin-right: 5px; opacity: 0.7;"><i class="fa-solid fa-paintbrush fa-lg"></i></div>`; let t = $("#send_but_sheld"); if (!t.length) t = $("#send_textarea"); if (t.length) { t.attr("id") === "send_textarea" ? t.before(b) : t.prepend(b); } }

// --- CONNECTION PROFILES (real ST profiles, not completion presets) ---
function isConnectionManagerActive() {
    // The Connection Manager extension stores its profile list here when active.
    return Array.isArray(getContext()?.extensionSettings?.connectionManager?.profiles);
}

function getConnectionProfiles() {
    if (!isConnectionManagerActive()) return [];
    return getContext().extensionSettings.connectionManager.profiles;
}

function populateProfiles() {
    const $sel = $("#kazuma_profile");
    $sel.empty().append('<option value="">-- Use Current Connection --</option>');

    if (!isConnectionManagerActive()) {
        $sel.append('<option value="" disabled>(Connection Profiles extension not active)</option>');
        return;
    }

    getConnectionProfiles().forEach((p) => {
        $sel.append(`<option value="${p.id}">${p.name}</option>`);
    });

    if (extension_settings[extensionName].connectionProfile) {
        $sel.val(extension_settings[extensionName].connectionProfile);
    }
}

async function onFileSelected(e) { const f=e.target.files[0];if(!f)return;const t=await f.text();try{const j=JSON.parse(t),n=prompt("Name:",f.name.replace(".json",""));if(n){extension_settings[extensionName].savedWorkflows[n]=j;extension_settings[extensionName].currentWorkflowName=n;saveSettingsDebounced();populateWorkflows();}}catch{toastr.error("Invalid JSON");}$(e.target).val('');}
function showKazumaProgress(text = "Processing...") {
    $("#kazuma_progress_text").text(text);
    $("#kazuma_progress_overlay").css("display", "flex");
}

function hideKazumaProgress() {
    $("#kazuma_progress_overlay").hide();
}

/* --- IMAGE PROFILES ---
 * A profile is one workflow plus everything that has to move with it: the checkpoint, sampler,
 * scheduler, steps/cfg/denoise/clip, resolution, negative prompt and the LoRA list. Two profiles
 * can point at the same workflow file with completely different params, which is the point - an
 * anime character and a realistic one share a node map but nothing else.
 *
 * The live settings object stays the source of truth for generation; a profile is a snapshot of it,
 * refreshed whenever you switch away. Profiles link to characters (by avatar filename), groups and
 * individual chats, and the linked one is applied automatically on chat change.
 */
const PROFILE_STATE_KEYS = [
    'currentWorkflowName',
    'selectedModel', 'selectedSampler', 'selectedScheduler',
    'steps', 'cfg', 'denoise', 'clipSkip',
    'imgWidth', 'imgHeight', 'customSeed', 'customNegative',
    'promptStyle', 'promptPerspective', 'promptRole', 'promptExtra',
    'loras',
];

function captureProfileState() {
    const s = extension_settings[extensionName];
    const state = {};
    for (const key of PROFILE_STATE_KEYS) state[key] = s[key];
    state.loras = structuredClone(s.loras || []);
    return state;
}

function getActiveProfile() {
    const s = extension_settings[extensionName];
    return s.profiles?.[s.activeProfileId] || null;
}

/** Fold live settings back into the profile they came from, so switching away never loses edits. */
function snapshotActiveProfile() {
    const profile = getActiveProfile();
    if (profile) profile.state = captureProfileState();
}

function switchProfile(id, { silent = false } = {}) {
    const s = extension_settings[extensionName];
    const profile = s.profiles?.[id];
    if (!profile || id === s.activeProfileId) return;

    snapshotActiveProfile();
    s.activeProfileId = id;
    applyProfileState(profile.state || {});
    populateImageProfiles();
    saveSettingsDebounced();
    if (!silent) toastr.info(`Image profile: ${profile.name}`, "Image Gen Kazuma");
}

function applyProfileState(state) {
    const s = extension_settings[extensionName];
    // 1. Update Global Settings. A key the profile predates (it was saved before that setting
    // existed) falls back to the default instead of writing undefined over a working value.
    for (const key of PROFILE_STATE_KEYS) {
        const value = state[key];
        s[key] = value === undefined ? defaultSettings[key] : structuredClone(value);
    }
    if (!Array.isArray(s.loras)) s.loras = [];

    // 2. Update UI Elements
    $("#kazuma_workflow_list").val(s.currentWorkflowName);
    $("#kazuma_model_list").val(s.selectedModel);
    $("#kazuma_sampler_list").val(s.selectedSampler);
    $("#kazuma_scheduler_list").val(s.selectedScheduler);
    renderLoraQuickList();

    updateSliderInput('kazuma_steps', 'kazuma_steps_val', s.steps);
    updateSliderInput('kazuma_cfg', 'kazuma_cfg_val', s.cfg);
    updateSliderInput('kazuma_denoise', 'kazuma_denoise_val', s.denoise);
    updateSliderInput('kazuma_clip', 'kazuma_clip_val', s.clipSkip);

    $("#kazuma_width").val(s.imgWidth);
    $("#kazuma_height").val(s.imgHeight);
    $("#kazuma_seed").val(s.customSeed);
    $("#kazuma_negative").val(s.customNegative);

    // Smart Prompt UI
    $("#kazuma_prompt_style").val(s.promptStyle || "standard");
    $("#kazuma_prompt_persp").val(s.promptPerspective || "scene");
    $("#kazuma_prompt_role").val(s.promptRole || "engineer");
    $("#kazuma_prompt_extra").val(s.promptExtra || "");

}

/* --- PROFILE UI --- */
function populateImageProfiles() {
    const s = extension_settings[extensionName];
    const $sel = $("#kazuma_image_profile");
    if (!$sel.length) return;

    $sel.empty();
    for (const p of Object.values(s.profiles || {})) {
        const suffix = p.id === s.defaultProfileId ? " (default)" : "";
        $sel.append($('<option></option>').val(p.id).text(`${p.name}${suffix}`));
    }
    $sel.val(s.activeProfileId);
    renderProfileLinks();
}

/** Linked characters/chats as thumbnails, same idea as the persona connections row. */
function renderProfileLinks() {
    const $box = $("#kazuma_profile_links");
    if (!$box.length) return;
    const profile = getActiveProfile();
    $box.empty();

    const links = profile?.links || [];
    if (!links.length) {
        $box.append($('<small class="opacity50p"></small>').text("Not linked - used only when picked by hand, or as the fallback if it is the default."));
        return;
    }

    const context = getContext();
    for (const link of links) {
        const $item = $('<div class="kazuma-link-chip" title="Click to unlink"></div>');
        if (link.type === 'character') {
            const char = context.characters?.find(c => c.avatar === link.id);
            $item.append($('<img>').attr('src', getThumbnailUrl('avatar', link.id)).attr('alt', char?.name || link.id));
            $item.attr('title', `${char?.name || link.id} - click to unlink`);
        } else {
            $item.append($('<i></i>').addClass(link.type === 'chat' ? 'fa-solid fa-comment' : 'fa-solid fa-users'));
            $item.attr('title', `${link.type}: ${link.id} - click to unlink`);
        }
        $item.on('click', () => {
            profile.links = profile.links.filter(l => !(l.type === link.type && l.id === link.id));
            saveSettingsDebounced();
            renderProfileLinks();
        });
        $box.append($item);
    }
}

/** What the current chat is, in link terms. */
function getCurrentLinkTargets() {
    const context = getContext();
    return {
        chatId: getCurrentChatId(),
        characterAvatar: context.groupId ? null : context.characters?.[context.characterId]?.avatar,
        groupId: context.groupId || null,
    };
}

function onChatChangedForProfiles() {
    const s = extension_settings[extensionName];
    if (!s.enabled || !s.autoSwitchProfile) return;

    const match = findProfileForContext(s.profiles, getCurrentLinkTargets());
    // Nothing linked falls back to the default profile, so leaving a linked character can't leave
    // you generating with its workflow.
    switchProfile(match?.id || s.defaultProfileId);
    renderProfileLinks();
}

async function openProfileManager() {
    const s = extension_settings[extensionName];
    const context = getContext();

    const $content = $(`
    <div style="display:flex;flex-direction:column;gap:10px;width:100%;text-align:left;">
        <div style="display:flex;gap:5px;align-items:center;">
            <select class="text_pole pm-list" style="flex:1;"></select>
            <div class="menu_button pm-new" title="New profile"><i class="fa-solid fa-plus"></i></div>
            <div class="menu_button pm-copy" title="Duplicate"><i class="fa-solid fa-clone"></i></div>
            <div class="menu_button pm-default" title="Use as fallback when nothing is linked"><i class="fa-solid fa-crown"></i></div>
            <div class="menu_button pm-delete" title="Delete"><i class="fa-solid fa-trash"></i></div>
        </div>
        <div>
            <label><b>Name</b></label>
            <input type="text" class="text_pole pm-name" style="width:100%;">
        </div>
        <div class="pm-summary opacity50p" style="font-size:12px;"></div>
        <hr style="opacity:0.2;margin:2px 0;">
        <div><b>Linked to</b></div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;">
            <div class="menu_button pm-link-char"><i class="fa-solid fa-user"></i> Link current character</div>
            <div class="menu_button pm-link-chat"><i class="fa-solid fa-comment"></i> Link current chat</div>
        </div>
        <div class="pm-links" style="display:flex;gap:6px;flex-wrap:wrap;"></div>
        <div>
            <label><b>Link any character</b></label>
            <div style="display:flex;gap:5px;">
                <select class="text_pole pm-char-list" style="flex:1;"></select>
                <div class="menu_button pm-link-picked">Link</div>
            </div>
        </div>
        <small class="opacity50p">A chat link wins over a character link, so one specific chat can override its character's profile. Switching chats applies the linked profile and stores your current tweaks back into the one you are leaving.</small>
    </div>
    `);

    // The character picker is one string: a few thousand options built one jQuery node at a time is
    // the difference between instant and a visible freeze.
    const charOptions = (context.characters || [])
        .map((c, i) => `<option value="${i}">${$('<div>').text(c.name).html()}</option>`).join('');
    $content.find('.pm-char-list').html(charOptions);

    let editingId = s.activeProfileId;

    const refresh = () => {
        const $list = $content.find('.pm-list').empty();
        for (const p of Object.values(s.profiles)) {
            const suffix = p.id === s.defaultProfileId ? " (default)" : "";
            $list.append($('<option></option>').val(p.id).text(`${p.name}${suffix}`));
        }
        $list.val(editingId);

        const profile = s.profiles[editingId];
        $content.find('.pm-name').val(profile?.name || '');
        const st = profile?.state || {};
        $content.find('.pm-summary').text(
            `Workflow: ${st.currentWorkflowName || '(none)'} - ${(st.loras || []).length} LoRAs - ${st.selectedModel || 'no checkpoint'} - ${st.selectedSampler || '?'}/${st.selectedScheduler || '?'} - ${st.steps ?? '?'} steps, cfg ${st.cfg ?? '?'}`);

        const $links = $content.find('.pm-links').empty();
        for (const link of profile?.links || []) {
            const $chip = $('<div class="kazuma-link-chip" title="Click to unlink"></div>');
            if (link.type === 'character') {
                const char = context.characters?.find(c => c.avatar === link.id);
                $chip.append($('<img>').attr('src', getThumbnailUrl('avatar', link.id)));
                $chip.attr('title', `${char?.name || link.id} - click to unlink`);
            } else {
                $chip.append($('<i></i>').addClass(link.type === 'chat' ? 'fa-solid fa-comment' : 'fa-solid fa-users'));
                $chip.attr('title', `${link.type}: ${link.id} - click to unlink`);
            }
            $chip.on('click', () => {
                profile.links = profile.links.filter(l => !(l.type === link.type && l.id === link.id));
                saveSettingsDebounced();
                refresh();
            });
            $links.append($chip);
        }
    };

    /** One link target belongs to one profile, otherwise which one wins is a coin toss. */
    const addLink = (type, id) => {
        if (!id) return toastr.warning(`No ${type} open right now.`);
        for (const p of Object.values(s.profiles)) {
            p.links = (p.links || []).filter(l => !(l.type === type && l.id === id));
        }
        s.profiles[editingId].links.push({ type, id });
        saveSettingsDebounced();
        refresh();
    };

    $content.find('.pm-list').on('change', function () {
        // Switch for real so the panel and the popup can't disagree about what is active.
        switchProfile($(this).val(), { silent: true });
        editingId = s.activeProfileId;
        refresh();
    });

    $content.find('.pm-name').on('input', function () {
        s.profiles[editingId].name = $(this).val();
        saveSettingsDebounced();
        populateImageProfiles();
    });

    $content.find('.pm-new').on('click', () => {
        snapshotActiveProfile();
        const id = newProfileId();
        s.profiles[id] = { id, name: `Profile ${Object.keys(s.profiles).length + 1}`, links: [], state: captureProfileState() };
        s.activeProfileId = id;
        editingId = id;
        saveSettingsDebounced();
        populateImageProfiles();
        refresh();
    });

    $content.find('.pm-copy').on('click', () => {
        snapshotActiveProfile();
        const source = s.profiles[editingId];
        const id = newProfileId();
        s.profiles[id] = { id, name: `${source.name} copy`, links: [], state: structuredClone(source.state) };
        editingId = id;
        s.activeProfileId = id;
        saveSettingsDebounced();
        populateImageProfiles();
        refresh();
    });

    $content.find('.pm-default').on('click', () => {
        s.defaultProfileId = editingId;
        saveSettingsDebounced();
        populateImageProfiles();
        refresh();
    });

    $content.find('.pm-delete').on('click', () => {
        if (Object.keys(s.profiles).length <= 1) return toastr.warning("That's the last profile.");
        delete s.profiles[editingId];
        if (s.defaultProfileId === editingId) s.defaultProfileId = Object.keys(s.profiles)[0];
        s.activeProfileId = "";
        editingId = Object.keys(s.profiles)[0];
        switchProfile(editingId, { silent: true });
        saveSettingsDebounced();
        populateImageProfiles();
        refresh();
    });

    $content.find('.pm-link-char').on('click', () => {
        const { characterAvatar, groupId } = getCurrentLinkTargets();
        addLink(groupId ? 'group' : 'character', groupId || characterAvatar);
    });
    $content.find('.pm-link-chat').on('click', () => addLink('chat', getCurrentLinkTargets().chatId));
    $content.find('.pm-link-picked').on('click', () => {
        const char = context.characters?.[parseInt($content.find('.pm-char-list').val())];
        addLink('character', char?.avatar);
    });

    // Fold live edits in first, or the summary describes the profile as it was when last switched to.
    snapshotActiveProfile();
    refresh();
    await new Popup($content, POPUP_TYPE.TEXT, '', { okButton: 'Close', wide: true, allowVerticalScrolling: true }).show();
    populateImageProfiles();
    renderLoraQuickList();
}

/* --- LORA UI ---
 * The drawer holds the day-to-day controls (toggle + weight per LoRA); the manager popup holds the
 * structure (which LoRAs exist, their slider range). Both edit the live list directly - there is no
 * cancel, same as the persona menu.
 */
function shortLoraName(name) {
    return name ? name.split('/').pop().replace(/\.(safetensors|ckpt|pt)$/i, '') : "(empty slot)";
}

function renderLoraQuickList() {
    const $box = $("#kazuma_lora_quick");
    if (!$box.length) return;
    const loras = extension_settings[extensionName].loras || [];

    $box.empty();
    if (!loras.length) {
        $box.append($('<small class="opacity50p"></small>').text("No LoRAs yet. Manage LoRAs to add some."));
        return;
    }

    loras.forEach((lora, i) => {
        const $row = $(`
        <div class="kazuma-lora-row">
            <input type="checkbox" class="kz-on" title="Active">
            <span class="kazuma-lora-name"></span>
            <input type="range" class="kz-wt">
            <input type="number" class="text_pole kz-wt-num" style="width:56px;">
        </div>`);

        $row.find('.kazuma-lora-name').text(shortLoraName(lora.name)).attr('title', lora.name || '');
        $row.find('.kz-on').prop('checked', !!lora.enabled);
        $row.find('.kz-wt, .kz-wt-num').attr({ min: lora.min, max: lora.max, step: LORA_STEP }).val(lora.weight);
        $row.toggleClass('kazuma-lora-off', !lora.enabled);

        const setWeight = (v) => {
            lora.weight = clampWeight({ ...lora, weight: v });
            $row.find('.kz-wt, .kz-wt-num').val(lora.weight);
            saveSettingsDebounced();
        };
        $row.find('.kz-on').on('change', function () {
            lora.enabled = $(this).prop('checked');
            $row.toggleClass('kazuma-lora-off', !lora.enabled);
            saveSettingsDebounced();
        });
        $row.find('.kz-wt').on('input', function () { setWeight(parseFloat(this.value)); });
        $row.find('.kz-wt-num').on('change', function () { setWeight(parseFloat(this.value)); });

        $box.append($row);
    });
}

/**
 * Searchable LoRA picker. A dropdown per row does not survive a real collection - a thousand files
 * on a hundred rows is a hundred thousand DOM nodes - so the profile list only ever holds the LoRAs
 * you picked, and this is how you add more.
 *
 * Resolves to the chosen filenames, or [] if cancelled.
 */
async function pickLoras({ exclude = [], single = false, limit = MAX_LORAS } = {}) {
    if (!availableLoras.length) await fetchComfyLists();
    if (!availableLoras.length) {
        toastr.error("No LoRAs came back from ComfyUI. Check the server URL and hit Test Connection.");
        return [];
    }

    const hidden = new Set(exclude);
    const choices = availableLoras.filter(f => !hidden.has(f));
    const selected = new Set();

    const $content = $(`
    <div style="display:flex;flex-direction:column;gap:8px;width:100%;text-align:left;">
        <input type="search" class="text_pole lp-search" placeholder="Search ${choices.length} LoRAs..." style="width:100%;">
        <div class="lp-list" style="max-height:55vh;overflow-y:auto;border:1px solid var(--smart-border-color);border-radius:4px;"></div>
        <div class="lp-status opacity50p" style="font-size:12px;"></div>
    </div>
    `);

    const $list = $content.find('.lp-list');
    const escape = (t) => $('<div>').text(t).html();

    // One innerHTML write per keystroke: a thousand rows built node-by-node is a visible stall.
    const render = () => {
        const query = $content.find('.lp-search').val().toLowerCase().trim();
        const terms = query.split(/\s+/).filter(Boolean);
        const matches = choices
            .map((f, i) => [f, i])
            .filter(([f]) => terms.every(t => f.toLowerCase().includes(t)));

        $list.html(matches.map(([f, i]) => {
            const folder = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
            const file = f.split('/').pop();
            return `<div class="kazuma-pick-row${selected.has(f) ? ' selected' : ''}" data-idx="${i}">
                ${single ? '' : `<input type="checkbox" ${selected.has(f) ? 'checked' : ''} tabindex="-1">`}
                <span class="kazuma-pick-name">${escape(file)}</span>
                <span class="kazuma-pick-folder">${escape(folder)}</span>
            </div>`;
        }).join('') || '<div class="opacity50p" style="padding:10px;">Nothing matches.</div>');

        $content.find('.lp-status').text(
            `${matches.length} shown${hidden.size ? `, ${hidden.size} already in this profile` : ''}`
            + (single ? '' : ` - ${selected.size} picked`));
    };

    let resolveSingle = null;
    const singlePicked = new Promise(resolve => { resolveSingle = resolve; });

    $list.on('click', '.kazuma-pick-row', function () {
        const file = choices[parseInt(this.dataset.idx, 10)];
        if (single) return resolveSingle(file);

        if (selected.has(file)) selected.delete(file);
        else if (selected.size >= limit) return toastr.warning(`${limit} is the cap for this profile.`);
        else selected.add(file);

        $(this).toggleClass('selected', selected.has(file)).find('input').prop('checked', selected.has(file));
        $content.find('.lp-status').text(
            `${$list.children('.kazuma-pick-row').length} shown${hidden.size ? `, ${hidden.size} already in this profile` : ''} - ${selected.size} picked`);
    });

    $content.find('.lp-search').on('input', render);
    render();

    const popup = new Popup($content, POPUP_TYPE.CONFIRM, '', {
        okButton: single ? 'Cancel' : 'Add selected', cancelButton: single ? false : 'Cancel',
        wide: true, large: true, allowVerticalScrolling: true,
    });

    if (single) {
        // Clicking a row is the answer here, so whichever settles first wins.
        const file = await Promise.race([singlePicked.then(f => (popup.completeCancelled(), f)), popup.show().then(() => null)]);
        return file ? [file] : [];
    }

    const confirmed = await popup.show();
    return confirmed ? [...selected] : [];
}

async function openLoraManager() {
    const s = extension_settings[extensionName];
    if (!availableLoras.length) await fetchComfyLists();

    const $content = $(`
    <div style="display:flex;flex-direction:column;gap:8px;width:100%;text-align:left;">
        <div class="lm-profile opacity50p" style="font-size:12px;"></div>
        <div class="lm-rows" style="display:flex;flex-direction:column;gap:6px;max-height:55vh;overflow-y:auto;"></div>
        <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;">
            <div class="menu_button lm-add"><i class="fa-solid fa-plus"></i> Add LoRA</div>
            <div class="menu_button lm-import" title="Pull the LoRAs hardcoded in this workflow's Power Lora Loader into the list"><i class="fa-solid fa-file-import"></i> Import from workflow</div>
            <span class="lm-count opacity50p" style="font-size:12px;"></span>
        </div>
        <small class="opacity50p">Only the LoRAs you pick live here - <b>Add LoRA</b> opens the full searchable list and takes as many as you tick at once. Min/max set that row's slider range, so a LoRA that only behaves between 0 and 0.4 gets a slider for exactly that. Off sends it at strength 0, which changes nothing in the image, and the row stays so you can flip it back. Click a name to swap it for a different file.</small>
    </div>
    `);

    const $rows = $content.find('.lm-rows');

    const refresh = () => {
        const profile = getActiveProfile();
        $content.find('.lm-profile').text(`Profile: ${profile?.name || '?'} - workflow: ${s.currentWorkflowName || '(none)'}`);
        $content.find('.lm-count').text(`${s.loras.length} / ${MAX_LORAS}`);
        $content.find('.lm-add').toggleClass('disabled', s.loras.length >= MAX_LORAS);
        $rows.empty();

        s.loras.forEach((lora, i) => {
            const $row = $(`
            <div class="kazuma-lora-edit">
                <input type="checkbox" class="kz-on" title="Active">
                <span class="kz-name" title="Click to swap this LoRA for another"></span>
                <label class="kz-lbl">min<input type="number" class="text_pole kz-min" step="0.05" style="width:60px;"></label>
                <label class="kz-lbl">max<input type="number" class="text_pole kz-max" step="0.05" style="width:60px;"></label>
                <label class="kz-lbl">wt<input type="number" class="text_pole kz-wt" style="width:60px;"></label>
                <div class="menu_button kz-up" title="Move up"><i class="fa-solid fa-arrow-up"></i></div>
                <div class="menu_button kz-del" title="Remove"><i class="fa-solid fa-trash"></i></div>
            </div>`);

            const missing = lora.name && availableLoras.length && !availableLoras.includes(lora.name);
            $row.find('.kz-name')
                .text(shortLoraName(lora.name) + (missing ? " (missing)" : ""))
                .attr('title', `${lora.name || 'no file picked'} - click to swap`)
                .toggleClass('kz-missing', !!missing);
            $row.find('.kz-on').prop('checked', !!lora.enabled);
            $row.find('.kz-min').val(lora.min);
            $row.find('.kz-max').val(lora.max);
            $row.find('.kz-wt').attr({ min: lora.min, max: lora.max, step: LORA_STEP }).val(lora.weight);

            $row.find('.kz-name').on('click', async function () {
                const [picked] = await pickLoras({ single: true, exclude: s.loras.map(l => l.name).filter(n => n && n !== lora.name) });
                if (!picked) return;
                lora.name = picked;
                lora.enabled = true;
                saveSettingsDebounced();
                refresh();
            });
            $row.find('.kz-on').on('change', function () { lora.enabled = $(this).prop('checked'); saveSettingsDebounced(); });
            $row.find('.kz-min').on('change', function () {
                lora.min = parseFloat(this.value);
                if (!(lora.min < lora.max)) lora.max = lora.min + 1;
                lora.weight = clampWeight(lora);
                saveSettingsDebounced();
                refresh();
            });
            $row.find('.kz-max').on('change', function () {
                lora.max = parseFloat(this.value);
                if (!(lora.max > lora.min)) lora.min = lora.max - 1;
                lora.weight = clampWeight(lora);
                saveSettingsDebounced();
                refresh();
            });
            $row.find('.kz-wt').on('change', function () {
                lora.weight = clampWeight({ ...lora, weight: parseFloat(this.value) });
                saveSettingsDebounced();
                refresh();
            });
            $row.find('.kz-up').toggleClass('disabled', i === 0).on('click', () => {
                if (i === 0) return;
                [s.loras[i - 1], s.loras[i]] = [s.loras[i], s.loras[i - 1]];
                saveSettingsDebounced();
                refresh();
            });
            $row.find('.kz-del').on('click', () => {
                s.loras.splice(i, 1);
                saveSettingsDebounced();
                refresh();
            });

            $rows.append($row);
        });
    };

    $content.find('.lm-add').on('click', async () => {
        if (s.loras.length >= MAX_LORAS) return toastr.warning(`${MAX_LORAS} is the cap.`);
        const picked = await pickLoras({
            exclude: s.loras.map(l => l.name).filter(Boolean),
            limit: MAX_LORAS - s.loras.length,
        });
        if (!picked.length) return;
        s.loras.push(...picked.map(name => makeLora(name)));
        saveSettingsDebounced();
        refresh();
        $rows.scrollTop($rows[0].scrollHeight);
    });

    $content.find('.lm-import').on('click', async () => {
        const imported = await importLorasFromWorkflow();
        if (!imported.length) return toastr.info("No hardcoded LoRAs found in this workflow's Power Lora Loader.");
        s.loras.push(...imported.slice(0, MAX_LORAS - s.loras.length));
        saveSettingsDebounced();
        refresh();
        toastr.success(`Imported ${imported.length} LoRAs. They are managed here now - the workflow JSON no longer decides.`);
    });

    refresh();
    await new Popup($content, POPUP_TYPE.TEXT, '', { okButton: 'Close', wide: true, large: true, allowVerticalScrolling: true }).show();
    renderLoraQuickList();
}

/** Read the active workflow off the server and lift its hand-written Power Lora Loader slots. */
async function importLorasFromWorkflow() {
    const name = extension_settings[extensionName].currentWorkflowName;
    if (!name) return [];
    try {
        const res = await fetch('/api/sd/comfy/workflow', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ file_name: name }) });
        if (!res.ok) throw new Error(await res.text());
        const raw = await res.json();
        const workflow = (typeof raw === 'string') ? JSON.parse(raw) : raw;
        return Object.values(workflow).flatMap(node => importLorasFromPowerNode(node));
    } catch (e) {
        toastr.error(`Could not read ${name}: ${e.message}`);
        return [];
    }
}
