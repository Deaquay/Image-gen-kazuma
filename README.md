# 🎨 Image Gen Kazuma

**The Ultimate ComfyUI Integration for SillyTavern.**

Image Gen Kazuma is a power-user extension designed to seamlessly bridge **SillyTavern** with **ComfyUI**. It goes beyond simple image generation by giving you full control over workflows, smart prompting logic, and persistent settings—all without leaving your chat window.

> Fork of [Arif-salah/Image-gen-kazuma](https://github.com/Arif-salah/Image-gen-kazuma) — see [Changes from upstream](#-changes-from-upstream).

---

## ✨ Key Features

### 🧠 Smart & Context-Aware
*   **Smart Prompting Logic:** Automatically formats prompts based on your preferred model style (e.g., Booru tags for Pony/Illustrious vs. Natural Language for SDXL/qwen) and camera perspective.
*   **Image Profiles:** A profile is one workflow plus everything that has to travel with it — checkpoint, sampler, scheduler, steps/CFG/denoise/CLIP, resolution, negative prompt and the whole LoRA list. Link a profile to characters (by avatar file, so two Lyras never collide), to groups, or to one specific chat, and it swaps itself in when you open them. Two profiles can share a workflow with completely different parameters.
*   **Diagnostic Mode:** Preview and edit the exact prompt the LLM generated before sending it to the image server.

### 🛠️ Advanced Workflow Studio
*   **Built-in JSON Editor:** Edit ComfyUI workflows directly inside SillyTavern. Includes syntax formatting.
*   **Variable Injection:** Use simple placeholders like `"*seed*"` or `"*lora*"` to let SillyTavern control your Comfy nodes dynamically.
*   **Cloud Saving:** Workflows are saved to your SillyTavern server, so they persist across reloads.

### ⚡ Performance & UX
*   **Zero-Lag Chat:** High-res images are compressed to JPEG or WebP at a quality you pick before being added to the chat history, keeping SillyTavern fast. Turn it off to keep the original PNG.
*   **Live Progress Bar:** a subtle, animated progress bar tracks the generation status (Prompting -> Rendering -> Saving).
*   **Swipe-to-Vary:** Swipe right on any generated image in the chat to instantly trigger a variation of that specific image.

---

## 🔌 Prerequisites & Installation

### 1. ComfyUI Setup (Important!)
Generation runs through the SillyTavern server, so the ComfyUI URL you enter is resolved on the machine running SillyTavern — not in your browser. If both are on the same box, `http://127.0.0.1:8188` works with no ComfyUI flags at all, and you can reach SillyTavern from your phone or another PC without exposing ComfyUI to the network.

The LoRA picker is the one exception: SillyTavern proxies checkpoints, samplers, schedulers and VAEs, but has no equivalent route for LoRAs, so that list is read by your browser talking to ComfyUI directly. On a same-machine setup, add `--enable-cors-header` to your `run_nvidia_gpu.bat` (or equivalent) and it works:

```bat
.\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --enable-cors-header
```

If you browse SillyTavern from a phone or another PC, that flag isn't enough — your browser is asking *itself* for the list, so the dropdown comes back empty. Everything else still works.

Note that reloading or closing the SillyTavern tab cancels an in-flight render: the server interrupts the ComfyUI job when the browser disconnects.

### 2. rgthree-comfy (soft requirement)
Unlimited LoRAs need [rgthree-comfy](https://github.com/rgthree/rgthree-comfy) installed in ComfyUI — the extension drives its **Power Lora Loader** node to write any number of LoRAs into a single slot. Install it from the ComfyUI Manager, or clone it into `ComfyUI/custom_nodes/`.

Without it everything else still works; you fall back to the numbered `*lora2*`, `*lora3*`… placeholders, where each LoRA needs its own hand-wired `LoraLoader` node and the workflow file sets the ceiling.

### 3. Install Extension
1.  Open **SillyTavern**.
2.  Navigate to **Extensions** -> **Install Extension**.
3.  Paste the URL of this repository.
4.  Click **Install**.
5.  **Refresh/Reload** the SillyTavern page.

---

## 📖 The Workflow Studio (Tutorial)

This extension does not use "hardcoded" generation methods. Instead, it injects values into **your** specific ComfyUI workflows.

### Step 1: Prepare Workflow in ComfyUI
1.  Open ComfyUI in your browser.
2.  Enable **Dev Mode Options** (Click the Gear icon -> Turn on "Enable Dev mode Options").
3.  Build your graph normally.
4.  **Crucial:** Click **"Save (API Format)"**. Do not use the standard "Save" button.

### Step 2: Import into SillyTavern
1.  Open the **Image Gen Kazuma** drawer settings.
2.  Under **Image Profile**, look for **Active Workflow**.
3.  Click the **+ (New)** button to create a blank file, or click **Import** inside the editor.
4.  Click the **Pen Icon** to open the **Workflow Studio**.

### Step 3: Inject Placeholders
In the Workflow Studio, you will see the raw JSON. You must replace specific hardcoded numbers or text with **Placeholders**.

**Example:**
*   *Before:* `"inputs": { "text": "1girl, sitting", ... }`
*   *After:* `"inputs": { "text": "*input*", ... }`

**Available Placeholders:**

| Placeholder | Replaces | Description |
| :--- | :--- | :--- |
| `"*input*"` | Positive Prompt | The text generated by the LLM based on chat context. |
| `"*ninput*"` | Negative Prompt | Your custom negative prompt from settings. |
| `"*seed*"` | Seed Number | Allows SillyTavern to randomize/fix seeds. |
| `"*steps*"` | Step Count | Linked to the Steps slider. |
| `"*cfg*"` | CFG Float | Linked to the CFG slider. |
| `"*model*"` | Checkpoint Name | Linked to the Model dropdown. |
| `"*sampler*"` | Sampler Name | Linked to the Sampler dropdown. |
| `"*scheduler*"` | Scheduler Name | Linked to the Scheduler dropdown. |
| `"*width*"` | Width Integer | Image resolution width. |
| `"*height*"` | Height Integer | Image resolution height. |
| `"*lora*"` | LoRA Name | LoRA 1 filename. |
| `"*lorawt*"` | LoRA Strength | LoRA 1 weight (model & clip). |
| `"*lora2*"` / `"*lorawt2*"` | LoRA Name / Strength | LoRA 2, and so on for `*lora3*`, `*lora4*`… |

**For an unlimited number of LoRAs, use [rgthree's](https://github.com/rgthree/rgthree-comfy) Power Lora Loader.** Set only its *first* slot to
`*lora*` / `*lorawt*` and the extension takes over the whole node: every LoRA in the profile is
written into it at generation time, with its own on/off state. Nothing in the JSON caps the count,
so you never touch the file again to add, remove or toggle a LoRA.

The numbered placeholders are for classic `LoraLoader` chains, where each LoRA needs its own node
wired by hand — there the workflow decides the ceiling. A LoRA that is switched off, or a numbered
slot the profile has no LoRA for, is sent as a valid filename at strength `0` (a no-op), because
ComfyUI rejects the entire prompt if `lora_name` is not a file it can see.

5.  Click **Save Changes**.

---

## 🎨 Prompting & Automation Guide

### 1. Smart Prompt Logic
Under the **Prompt Generation** section, you can choose how the extension generates prompts.

*   **Strategy: Use Current Active Preset** (Recommended)
    *   This uses your *current* SillyTavern text generation preset.
    *   **Prompt Builder:** A menu will appear allowing you to select:
        *   **Model Style:** Tells the LLM to write in *Booru Tags* (for Anime/Pony models) or *Natural Prose* (for SDXL/qwen/Realism).
        *   **Camera Perspective:** Forces the image to be *Scene-focused*, *Character-focused*, or *POV*.
    *   The extension constructs a complex system instruction behind the scenes to ensure the LLM adheres to these constraints.

*   **Strategy: Use Specific Preset** (Legacy)
    *   Forces SillyTavern to switch to a specific Chat Completion Presets just for the image prompt generation, then switches back.

### 2. Auto-Generation
*   **Enable:** Automatically generates an image after the character replies.
*   **Frequency:** Set to `1` for every message, or `3` to generate every 3rd message.

### 3. Manual Generation
*   Click the **Paintbrush Icon 🖌️** next to the chat input bar to visualize the most recent message immediately.

### 4. LoRA Lab
*   **Manage LoRAs** opens the editor. Only the LoRAs you picked live there — **Add LoRA** brings up
    the full collection with a search box, and takes as many as you tick in one go. Click a name to
    swap that row for a different file.
*   Each row has its own slider range. A LoRA that only behaves between `0` and `0.4` gets a slider
    for exactly that, instead of a shared `-2 … 2` you have to aim inside of.
*   The drawer keeps the day-to-day controls — one row per LoRA, a checkbox and a weight slider.
    Off means strength `0`, and the row stays put so you can flip it back.
*   **Import from workflow** lifts the LoRAs you hardcoded into a Power Lora Loader into the list,
    so they become toggles instead of JSON edits.
*   The list belongs to the active **Image Profile**, so it follows the character or chat it is
    linked to.

### 5. Image Profiles
*   The profile dropdown at the top holds the workflow, all image parameters and the LoRA list.
*   **Manage profiles** lets you create, duplicate and delete them, and link each one to any number
    of characters, groups or chats. Linked characters show up as thumbnails; click one to unlink.
*   A chat link beats a character link, so one specific chat can override its character's profile.
*   Opening a chat with nothing linked falls back to the profile marked with the crown, so leaving a
    linked character can't leave you generating with its workflow.
*   Your tweaks are stored back into the profile you are leaving, so switching around never loses
    a setting.

---

## 🔀 Changes from upstream

Everything listed here is new in this fork; the rest of the extension is upstream's.

**Added**
*   **Image Profiles.** Upstream remembered settings per workflow file. A profile is now its own thing — workflow, checkpoint, sampler, scheduler, all ten image params, negative prompt and the LoRA list — and can be linked to characters, groups or a single chat. Two profiles can share one workflow with different settings, which the old per-workflow store could not express. Old snapshots migrate automatically.
*   **Unlimited LoRAs.** Upstream had four fixed slots; a fifth meant editing the workflow JSON. LoRAs are now a managed list with a searchable picker, per-LoRA slider ranges and on/off toggles. Point the first slot of an [rgthree-comfy](https://github.com/rgthree/rgthree-comfy) Power Lora Loader at `*lora*`/`*lorawt*` and the extension writes every configured LoRA into the node at generation time — that node is the one soft requirement this fork adds. Numbered `*lora2*` placeholders still drive classic `LoraLoader` chains without it.
*   **Connection profile for prompt generation.** Requests go through `ConnectionManagerRequestService`, so generating an image prompt no longer breaks the prompt cache or forces a chat refresh.
*   **Image gen context presets.** Configurable system prompt, message count and character-info inclusion for the prompt LLM, separate from your chat preset.
*   **Include Tracker.** Optionally prepends the newest [SillyTavern-Tracker-Enhanced](https://github.com/kaldigo/SillyTavern-Tracker-Enhanced) tracker to the scene, which keeps clothing and similar details consistent. Soft dependency — read straight off the message.
*   **AI Role selector.** The instruction was hardcoded to "Write an image generation prompt", which some models refuse outright. Pick *Prompt Engineer* (upstream behaviour) or *Scene Description Writer*.
*   **Scheduler selection**, missing upstream entirely.
*   **krea2 / krea2beta / krea2mini** prompt styles.
*   Macro resolution (`{{char}}`, `{{user}}`, `{{group_info}}`, …) in system prompts, chat history and instructions — upstream only resolved its own placeholders, and only on the specific-preset path.
*   `<think>` block stripping from reasoning models.
*   Regrouped settings drawer: prompt-shaping controls in one place, server address and debug toggles collapsed out of the way.

**Fixed**
*   A generation started in one chat could insert its image into whichever chat was open when it finished. The chat ID is pinned at the start and both write points bail if it changed (the image is still saved to disk).
*   ComfyUI history polling had no exit except success — a prompt that never landed polled until the tab closed. Now capped at 20 minutes, with no overlapping polls.
*   Auto-gen fired on a character's greeting: ST tags those events `first_message` and the handler dropped that argument.
*   Placeholders reached the model verbatim when using a Custom System Prompt Override, or when Include Character Information was unchecked.

**Removed**
*   Per-preset temperature and max-tokens controls — they were never sent with the request. Sampling comes from the completion preset attached to the connection profile.
*   The two separate prompt boxes, collapsed into one with a *Restore built-in default* button. Any non-empty override migrates into it on load.

---

## ❓ Troubleshooting

**Q: The extension connects, but images don't appear.**
A: Check the **Diagnostic Mode**. If the prompt looks correct, open your browser console (F12) and check for "Comfy Error". Usually, this means your workflow JSON is missing a placeholder or has an invalid node.

**Q: "Save (API Format)" isn't visible in ComfyUI.**
A: You must go to ComfyUI Settings (Gear icon) and check "Enable Dev mode Options".

**Q: My settings keep changing when I swap workflows.**
A: This is intended! The **Context Switcher** feature ensures that settings appropriate for one model (e.g., 1024x1024 for SDXL) don't accidentally break another workflow (e.g., 512x512 for SD1.5).

---

## 📜 License

MIT License. Free to use and modify.


