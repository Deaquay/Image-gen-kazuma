/* eslint-disable no-undef */
import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, generateQuietPrompt, saveChat, reloadCurrentChat, eventSource, event_types, addOneMessage, getRequestHeaders, appendMediaToMessage, substituteParams, getCurrentChatId } from "../../../../script.js";
import { saveBase64AsFile } from "../../../utils.js";
import { humanizedDateTime } from "../../../RossAscends-mods.js";
import { Popup, POPUP_TYPE } from "../../../popup.js";

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
    { key: '"*width*"', desc: "Image Width (px)" },
    { key: '"*height*"', desc: "Image Height (px)" },
    { key: '"*lora*"', desc: "LoRA 1 Filename" },
    { key: '"*lorawt*"', desc: "LoRA 1 Weight (Float)" },
    { key: '"*lora2*"', desc: "LoRA 2 Filename" },
    { key: '"*lorawt2*"', desc: "LoRA 2 Weight (Float)" },
    { key: '"*lora3*"', desc: "LoRA 3 Filename" },
    { key: '"*lorawt3*"', desc: "LoRA 3 Weight (Float)" },
    { key: '"*lora4*"', desc: "LoRA 4 Filename" },
    { key: '"*lorawt4*"', desc: "LoRA 4 Weight (Float)" }
];

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

const defaultSettings = {
    enabled: true,
    debugPrompt: false,
    includeTracker: false,
    comfyUrl: "http://127.0.0.1:8188",
    connectionProfile: "",
    currentWorkflowName: "",
    selectedModel: "",
    selectedLora: "",
    selectedLora2: "",
    selectedLora3: "",
    selectedLora4: "",
    selectedLoraWt: 1.0,
    selectedLoraWt2: 1.0,
    selectedLoraWt3: 1.0,
    selectedLoraWt4: 1.0,
    imgWidth: 1024,
    imgHeight: 1024,
    autoGenEnabled: false,
    autoGenFreq: 1,
    customNegative: "bad quality, blurry, worst quality, low quality",
    customSeed: -1,
    selectedSampler: "euler",
    compressImages: true,
    steps: 20,
    cfg: 7.0,
    denoise: 0.5,
    clipSkip: 1,
    profileStrategy: "current",
    promptStyle: "standard",
    promptPerspective: "scene",
    promptExtra: "",
    savedWorkflowStates: {},
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

async function loadSettings() {
    if (!extension_settings[extensionName]) extension_settings[extensionName] = {};
    for (const key in defaultSettings) {
        if (typeof extension_settings[extensionName][key] === 'undefined') {
            extension_settings[extensionName][key] = defaultSettings[key];
        }
    }

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
    $("#kazuma_prompt_extra").val(extension_settings[extensionName].promptExtra || "");

    $("#kazuma_lora_wt").val(extension_settings[extensionName].selectedLoraWt);
    $("#kazuma_lora_wt_display").text(extension_settings[extensionName].selectedLoraWt);
    $("#kazuma_lora_wt_2").val(extension_settings[extensionName].selectedLoraWt2);
    $("#kazuma_lora_wt_display_2").text(extension_settings[extensionName].selectedLoraWt2);
    $("#kazuma_lora_wt_3").val(extension_settings[extensionName].selectedLoraWt3);
    $("#kazuma_lora_wt_display_3").text(extension_settings[extensionName].selectedLoraWt3);
    $("#kazuma_lora_wt_4").val(extension_settings[extensionName].selectedLoraWt4);
    $("#kazuma_lora_wt_display_4").text(extension_settings[extensionName].selectedLoraWt4);

    $("#kazuma_negative").val(extension_settings[extensionName].customNegative);
    $("#kazuma_seed").val(extension_settings[extensionName].customSeed);
    $("#kazuma_compress").prop("checked", extension_settings[extensionName].compressImages);

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
                if (workflows.includes(extension_settings[extensionName].currentWorkflowName)) {
                    sel.val(extension_settings[extensionName].currentWorkflowName);
                } else if (workflows.length > 0) {
                    sel.val(workflows[0]);
                    extension_settings[extensionName].currentWorkflowName = workflows[0];
                    saveSettingsDebounced();
                }
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
    KAZUMA_PLACEHOLDERS.forEach(item => {
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

        // 2. Run Highlighting logic (Visuals)
        $list.children().each(function() {
            const cleanKey = $(this).find('span').first().text().replace(/"/g, '');
            if (currentJsonText.includes(cleanKey)) $(this).css({'border': '1px solid #4caf50', 'background-color': 'rgba(76, 175, 80, 0.1)'});
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
async function fetchComfyLists() {
    const comfyUrl = extension_settings[extensionName].comfyUrl;
    const modelSel = $("#kazuma_model_list");
    const samplerSel = $("#kazuma_sampler_list");
    const loraSelectors = [ $("#kazuma_lora_list"), $("#kazuma_lora_list_2"), $("#kazuma_lora_list_3"), $("#kazuma_lora_list_4") ];

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

        const loraRes = await fetch(`${comfyUrl}/object_info/LoraLoader`);
        if (loraRes.ok) {
            const json = await loraRes.json();
            const files = json['LoraLoader'].input.required.lora_name[0];
            loraSelectors.forEach((sel, i) => {
                const k = i === 0 ? "selectedLora" : `selectedLora${i + 1}`;
                const v = extension_settings[extensionName][k];
                sel.empty().append('<option value="">-- No LoRA --</option>');
                files.forEach(f => sel.append(`<option value="${f}">${f}</option>`));
                if (v) sel.val(v);
            });
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
        const extra = s.promptExtra ? `, ${s.promptExtra}` : "";

        let styleInst = "", perspInst = "";
        if (style === "illustrious") styleInst = "Use Booru-style tags (e.g., 1girl, solo, blue hair). Focus on anime aesthetics.";
        else if (style === "sdxl") styleInst = "Use natural language sentences. Focus on photorealism and detailed textures.";
        else if (style === "krea2") styleInst = KREA2_INSTRUCTION;
        else styleInst = "Use a list of detailed keywords/descriptors.";

        if (persp === "pov") perspInst = "Describe the scene from a First Person (POV) perspective, looking at the character.";
        else if (persp === "character") perspInst = "Focus intensely on the character's appearance and expression, ignoring background details.";
        else perspInst = "Describe the entire environment and atmosphere.";

        const instruction = substituteParams(`
        Task: Write an image generation prompt for the following scene.
        The character is {{char}}; the user/persona is {{user}}.
        Scene: "${tracker}${lastMessage}"
        Style Constraint: ${styleInst}
        Perspective: ${perspInst}
        Additional Req: ${extra}
        Output ONLY the prompt text.
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
        const res = await fetch(`${url}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: workflow }) });
        if(!res.ok) throw new Error("Failed");
        const data = await res.json();
        console.log(`[${extensionName}] queued prompt_id=${data.prompt_id}`);
        await waitForGeneration(url, data.prompt_id, positivePrompt, target);
    } catch(e) { toastr.error("Comfy Error: " + e.message); }
}

function injectParamsIntoWorkflow(workflow, promptText, finalSeed) {
    const s = extension_settings[extensionName];
    let seedInjected = false;

    for (const nodeId in workflow) {
        const node = workflow[nodeId];
        if (node.inputs) {
            for (const key in node.inputs) {
                const val = node.inputs[key];

                if (val === "*input*") node.inputs[key] = promptText;
                if (val === "*ninput*") node.inputs[key] = s.customNegative || "";
                if (val === "*seed*") { node.inputs[key] = finalSeed; seedInjected = true; }
                if (val === "*sampler*") node.inputs[key] = s.selectedSampler || "euler";
                if (val === "*model*") node.inputs[key] = s.selectedModel || "v1-5-pruned.ckpt";

                if (val === "*steps*") node.inputs[key] = parseInt(s.steps) || 20;
                if (val === "*cfg*") node.inputs[key] = parseFloat(s.cfg) || 7.0;
                if (val === "*denoise*") node.inputs[key] = parseFloat(s.denoise) || 1.0;
                if (val === "*clip_skip*") node.inputs[key] = -Math.abs(parseInt(s.clipSkip)) || -1;

                if (val === "*lora*") node.inputs[key] = s.selectedLora || "None";
                if (val === "*lora2*") node.inputs[key] = s.selectedLora2 || "None";
                if (val === "*lora3*") node.inputs[key] = s.selectedLora3 || "None";
                if (val === "*lora4*") node.inputs[key] = s.selectedLora4 || "None";
                if (val === "*lorawt*") node.inputs[key] = parseFloat(s.selectedLoraWt) || 1.0;
                if (val === "*lorawt2*") node.inputs[key] = parseFloat(s.selectedLoraWt2) || 1.0;
                if (val === "*lorawt3*") node.inputs[key] = parseFloat(s.selectedLoraWt3) || 1.0;
                if (val === "*lorawt4*") node.inputs[key] = parseFloat(s.selectedLoraWt4) || 1.0;

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

// ponytail: 20 min at 1s ticks. Without a cap a prompt that never lands (ComfyUI restarted,
// queue cleared) polls until the tab closes.
const MAX_POLL_TICKS = 1200;

async function waitForGeneration(baseUrl, promptId, positivePrompt, target) {
    // [UPDATE TEXT]
    showKazumaProgress("Rendering Image...");

    // Pin the chat this generation belongs to. saveChat() writes the live chat array to whatever
    // chat is loaded now, so finishing a generation after the user moved on must not write at all.
    const originChatId = getCurrentChatId();

    // ponytail: async ticks overlap when ComfyUI is busy (e.g. rendering video), so guard both ends
    let polling = false, finished = false, ticks = 0;
    const checkInterval = setInterval(async () => {
        if (polling || finished) return;

        if (getCurrentChatId() !== originChatId) {
            finished = true;
            clearInterval(checkInterval);
            hideKazumaProgress();
            console.warn(`[${extensionName}] chat changed while rendering prompt_id=${promptId}; abandoning insert`);
            toastr.warning("Chat changed while the image was rendering - it was not inserted.", "Image Gen Kazuma");
            return;
        }

        if (++ticks > MAX_POLL_TICKS) {
            finished = true;
            clearInterval(checkInterval);
            hideKazumaProgress();
            toastr.error("Timed out waiting for ComfyUI.", "Image Gen Kazuma");
            return;
        }

        polling = true;
        try {
            const h = await (await fetch(`${baseUrl}/history/${promptId}`)).json();
            if (h[promptId] && !finished) {
                finished = true;
                clearInterval(checkInterval);
                const outputs = h[promptId].outputs;
                let finalImage = null;
                for (const nodeId in outputs) {
                    const nodeOutput = outputs[nodeId];
                    if (nodeOutput.images && nodeOutput.images.length > 0) {
                        finalImage = nodeOutput.images[0];
                        break;
                    }
                }
                if (finalImage) {
                    // [UPDATE TEXT]
                    showKazumaProgress("Downloading...");

                    console.log(`[${extensionName}] complete prompt_id=${promptId} file=${finalImage.filename}`);
                    const imgUrl = `${baseUrl}/view?filename=${finalImage.filename}&subfolder=${finalImage.subfolder}&type=${finalImage.type}`;
                    await insertImageToChat(imgUrl, positivePrompt, target, originChatId);

                    // [HIDE WHEN DONE]
                    hideKazumaProgress();
                } else {
                    hideKazumaProgress();
                }
            }
        } catch (e) { } finally { polling = false; }
    }, 1000);
}

function blobToBase64(blob) { return new Promise((resolve) => { const reader = new FileReader(); reader.onloadend = () => resolve(reader.result); reader.readAsDataURL(blob); }); }

function compressImage(base64Str, quality = 0.9) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = base64Str;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = () => resolve(base64Str);
    });
}

// --- SAVE TO SERVER ---
async function insertImageToChat(imgUrl, promptText, target = null, originChatId = getCurrentChatId()) {
    try {
        toastr.info("Downloading image...", "Image Gen Kazuma");
        const response = await fetch(imgUrl);
        const blob = await response.blob();
        let base64FullURL = await blobToBase64(blob);

        let format = "png";
        if (extension_settings[extensionName].compressImages) {
            base64FullURL = await compressImage(base64FullURL, 0.9);
            format = "jpeg";
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

        // Downloading, compressing and saving the image took a while. If the user switched chats in
        // the meantime, target.message points into the old chat array and saveChat() would write the
        // now-current chat - so stop here. The image is already on disk under its character folder.
        if (getCurrentChatId() !== originChatId) {
            console.warn(`[${extensionName}] chat changed during image save; not inserting. Image kept at ${savedPath}`);
            toastr.warning("Chat changed during download - image saved to disk but not inserted.", "Image Gen Kazuma");
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

        // SMART WORKFLOW SWITCHER
        $("#kazuma_workflow_list").on("change", (e) => {
            const newWorkflow = $(e.target).val();
            const oldWorkflow = extension_settings[extensionName].currentWorkflowName;

            // 1. Snapshot OLD workflow settings
            if (oldWorkflow) {
                if (!extension_settings[extensionName].savedWorkflowStates) extension_settings[extensionName].savedWorkflowStates = {};
                extension_settings[extensionName].savedWorkflowStates[oldWorkflow] = getWorkflowState();
                console.log(`[${extensionName}] Saved context for ${oldWorkflow}`);
            }

            // 2. Load NEW workflow settings (if they exist)
            if (extension_settings[extensionName].savedWorkflowStates && extension_settings[extensionName].savedWorkflowStates[newWorkflow]) {
                applyWorkflowState(extension_settings[extensionName].savedWorkflowStates[newWorkflow]);
                toastr.success(`Restored settings for ${newWorkflow}`);
            } else {
                // If no saved state, we keep current values (Inheritance) - smoother UX
                toastr.info(`New workflow context active`);
            }

            // 3. Update Pointer
            extension_settings[extensionName].currentWorkflowName = newWorkflow;
            saveSettingsDebounced();
        });
        $("#kazuma_import_btn").on("click", () => $("#kazuma_import_file").click());

        // New Logic Events
        $("#kazuma_prompt_style").on("change", (e) => { extension_settings[extensionName].promptStyle = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_prompt_persp").on("change", (e) => { extension_settings[extensionName].promptPerspective = $(e.target).val(); saveSettingsDebounced(); });
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
        $("#kazuma_resolution_list").on("change", (e) => {
            const idx = parseInt($(e.target).val());
            if (!isNaN(idx) && RESOLUTIONS[idx]) {
                const r = RESOLUTIONS[idx];
                $("#kazuma_width").val(r.w).trigger("input");
                $("#kazuma_height").val(r.h).trigger("input");
            }
        });

        $("#kazuma_lora_list").on("change", (e) => { extension_settings[extensionName].selectedLora = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_lora_list_2").on("change", (e) => { extension_settings[extensionName].selectedLora2 = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_lora_list_3").on("change", (e) => { extension_settings[extensionName].selectedLora3 = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_lora_list_4").on("change", (e) => { extension_settings[extensionName].selectedLora4 = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_lora_wt").on("input", (e) => { let v = parseFloat($(e.target).val()); extension_settings[extensionName].selectedLoraWt = v; $("#kazuma_lora_wt_display").text(v); saveSettingsDebounced(); });
        $("#kazuma_lora_wt_2").on("input", (e) => { let v = parseFloat($(e.target).val()); extension_settings[extensionName].selectedLoraWt2 = v; $("#kazuma_lora_wt_display_2").text(v); saveSettingsDebounced(); });
        $("#kazuma_lora_wt_3").on("input", (e) => { let v = parseFloat($(e.target).val()); extension_settings[extensionName].selectedLoraWt3 = v; $("#kazuma_lora_wt_display_3").text(v); saveSettingsDebounced(); });
        $("#kazuma_lora_wt_4").on("input", (e) => { let v = parseFloat($(e.target).val()); extension_settings[extensionName].selectedLoraWt4 = v; $("#kazuma_lora_wt_display_4").text(v); saveSettingsDebounced(); });

        $("#kazuma_width, #kazuma_height").on("input", (e) => { extension_settings[extensionName][e.target.id === "kazuma_width" ? "imgWidth" : "imgHeight"] = parseInt($(e.target).val()); saveSettingsDebounced(); });
        $("#kazuma_negative").on("input", (e) => { extension_settings[extensionName].customNegative = $(e.target).val(); saveSettingsDebounced(); });
        $("#kazuma_seed").on("input", (e) => { extension_settings[extensionName].customSeed = parseInt($(e.target).val()); saveSettingsDebounced(); });
        $("#kazuma_compress").on("change", (e) => { extension_settings[extensionName].compressImages = $(e.target).prop("checked"); saveSettingsDebounced(); });

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

        $("#kazuma_test_btn").on("click", onTestConnection);
        $("#kazuma_gen_prompt_btn").on("click", onGeneratePrompt);

        loadSettings();
        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        eventSource.on(event_types.IMAGE_SWIPED, onImageSwiped);

        let att = 0; const int = setInterval(() => { if ($("#kazuma_quick_gen").length > 0) { clearInterval(int); return; } createChatButton(); att++; if (att > 5) clearInterval(int); }, 1000);
        $(document).on("click", "#kazuma_quick_gen", function(e) { e.preventDefault(); e.stopPropagation(); onGeneratePrompt(); });
    } catch (e) { console.error(e); }
});

// Helpers (Condensed)
function onMessageReceived(id) { if (!extension_settings[extensionName].enabled || !extension_settings[extensionName].autoGenEnabled) return; const chat = getContext().chat; if (!chat || !chat.length) return; if (chat[chat.length - 1].is_user || chat[chat.length - 1].is_system) return; const aiMsgCount = chat.filter(m => !m.is_user && !m.is_system).length; const freq = parseInt(extension_settings[extensionName].autoGenFreq) || 1; if (aiMsgCount % freq === 0) { console.log(`[${extensionName}] Auto-gen...`); setTimeout(onGeneratePrompt, 500); } }
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

/* --- WORKFLOW CONTEXT MANAGERS --- */
function getWorkflowState() {
    const s = extension_settings[extensionName];
    // Capture all image-related parameters
    return {
        selectedModel: s.selectedModel,
        selectedSampler: s.selectedSampler,
        steps: s.steps,
        cfg: s.cfg,
        denoise: s.denoise,
        clipSkip: s.clipSkip,
        imgWidth: s.imgWidth,
        imgHeight: s.imgHeight,
        customSeed: s.customSeed,
        customNegative: s.customNegative,
        // Smart Prompts
        promptStyle: s.promptStyle,
        promptPerspective: s.promptPerspective,
        promptExtra: s.promptExtra,
        // LoRAs
        selectedLora: s.selectedLora, selectedLoraWt: s.selectedLoraWt,
        selectedLora2: s.selectedLora2, selectedLoraWt2: s.selectedLoraWt2,
        selectedLora3: s.selectedLora3, selectedLoraWt3: s.selectedLoraWt3,
        selectedLora4: s.selectedLora4, selectedLoraWt4: s.selectedLoraWt4,
    };
}

function applyWorkflowState(state) {
    const s = extension_settings[extensionName];
    // 1. Update Global Settings
    Object.assign(s, state);

    // 2. Update UI Elements
    $("#kazuma_model_list").val(s.selectedModel);
    $("#kazuma_sampler_list").val(s.selectedSampler);

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
    $("#kazuma_prompt_extra").val(s.promptExtra || "");

    // LoRA UI
    $("#kazuma_lora_list").val(s.selectedLora);
    $("#kazuma_lora_list_2").val(s.selectedLora2);
    $("#kazuma_lora_list_3").val(s.selectedLora3);
    $("#kazuma_lora_list_4").val(s.selectedLora4);

    // LoRA Weights UI
    $("#kazuma_lora_wt").val(s.selectedLoraWt); $("#kazuma_lora_wt_display").text(s.selectedLoraWt);
    $("#kazuma_lora_wt_2").val(s.selectedLoraWt2); $("#kazuma_lora_wt_display_2").text(s.selectedLoraWt2);
    $("#kazuma_lora_wt_3").val(s.selectedLoraWt3); $("#kazuma_lora_wt_display_3").text(s.selectedLoraWt3);
    $("#kazuma_lora_wt_4").val(s.selectedLoraWt4); $("#kazuma_lora_wt_display_4").text(s.selectedLoraWt4);
}
