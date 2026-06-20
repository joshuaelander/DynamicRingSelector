/**
 * Dynamic Ring Selector
 * A lightweight Foundry VTT v14 module to swap dynamic token ring spritesheets.
 */

// Helper to update the cached list of available rings
async function updateCachedRings() {
    const rings = new Map();

    // 1. Add the core default steel ring
    rings.set("canvas/tokens/rings-steel.json", {
        path: "canvas/tokens/rings-steel.json",
        label: "Default Steel Ring"
    });

    // 2. Scan configured directory (GMs only)
    const dirPath = game.settings.get("dynamicringselector", "ringDirectory");
    if (dirPath && game.user.isGM) {
        try {
            const browseResult = await FilePicker.browse("data", dirPath);
            for (const file of browseResult.files) {
                if (file.endsWith(".json")) {
                    const filename = file.split("/").pop();
                    const label = filename
                        .replace(".json", "")
                        .replace(/[-_]/g, " ")
                        .replace(/\b\w/g, c => c.toUpperCase());
                    rings.set(file, { path: file, label: label });
                }
            }
        } catch (e) {
            console.warn("DynamicRingSelector | Failed to browse directory: " + dirPath, e);
        }
    }

    // 3. Scan common paths for Tokenizer and other popular modules
    const commonPaths = [
        "modules/tokenizer/assets/rings.json",
        "modules/tokenizer/assets/rings-steel.json"
    ];
    for (const path of commonPaths) {
        const parts = path.split("/");
        const moduleId = parts[1];
        if (game.modules.get(moduleId)?.active) {
            const filename = parts.pop();
            const label = `${game.modules.get(moduleId).title} - ${filename.replace(".json", "").replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase())}`;
            rings.set(path, { path: path, label: label });
        }
    }

    // 4. Add additional custom paths from setting
    const additional = game.settings.get("dynamicringselector", "additionalPaths") || "";
    const paths = additional.split(/[\n,]+/).map(p => p.trim()).filter(p => p.length > 0);
    for (const path of paths) {
        const filename = path.split("/").pop();
        const label = filename
            .replace(".json", "")
            .replace(/[-_]/g, " ")
            .replace(/\b\w/g, c => c.toUpperCase());
        rings.set(path, { path: path, label: label });
    }

    const ringList = Array.from(rings.values());
    await game.settings.set("dynamicringselector", "cachedRings", ringList);
    console.log("DynamicRingSelector | Updated cached ring list:", ringList);
    return ringList;
}

// Helper to swap active ring spritesheet globally
function applyRingSpritesheet(ringPath) {
    const targetPath = ringPath || "canvas/tokens/rings-steel.json";

    // Swap the global spritesheet configuration path
    CONFIG.Token.ring.spritesheet = targetPath;

    // Swap active configuration properties to ensure compatibility
    const activeId = CONFIG.Token.ring.activeConfig || "coreSteel";
    const activeConfig = CONFIG.Token.ring.getConfig(activeId);
    if (activeConfig) {
        activeConfig.spritesheet = targetPath;
    }

    console.log(`DynamicRingSelector | Applied dynamic ring spritesheet: ${targetPath}`);
}

// Redraw all dynamic token rings on the canvas to reflect changes
function redrawTokenRings() {
    if (!canvas || !canvas.ready || !canvas.tokens) return;
    for (const t of canvas.tokens.placeables) {
        if (t.ring) {
            if (t.renderFlags?.set) {
                t.renderFlags.set({ redraw: true });
            } else if (typeof t.draw === "function") {
                t.draw();
            }
        }
    }
}

// Init Hook
Hooks.once("init", () => {
    // Register settings
    game.settings.register("dynamicringselector", "ringDirectory", {
        name: "Dynamic Token Ring Directory",
        hint: "A folder path in your user data directory to scan for custom dynamic token ring JSON files.",
        scope: "world",
        config: true,
        type: String,
        default: "canvas/tokens",
        onChange: () => { if (game.user.isGM) updateCachedRings(); }
    });

    game.settings.register("dynamicringselector", "additionalPaths", {
        name: "Additional Ring Paths",
        hint: "Comma or newline separated list of paths to specific ring JSON files (e.g. from other modules or custom locations).",
        scope: "world",
        config: true,
        type: String,
        default: "",
        onChange: () => { if (game.user.isGM) updateCachedRings(); }
    });

    game.settings.register("dynamicringselector", "cachedRings", {
        scope: "world",
        config: false,
        type: Array,
        default: [
            { path: "canvas/tokens/rings-steel.json", label: "Default Steel Ring" }
        ]
    });

    // Expose API for external/macro usage
    const api = {
        updateCachedRings,
        applyRingSpritesheet,
        redrawTokenRings
    };
    globalThis.DynamicRingSelector = api;
    const moduleData = game.modules.get("dynamicringselector");
    if (moduleData) {
        moduleData.api = api;
    }
});

// Ready Hook
Hooks.once("ready", () => {
    if (game.user.isGM) {
        updateCachedRings().catch(err => {
            console.error("DynamicRingSelector | Error updating cached rings during ready:", err);
        });
    }
});

// Canvas Ready Hook - Apply ring path if a token in the scene has one set
Hooks.on("canvasReady", () => {
    const tokenWithRing = canvas.tokens.placeables.find(t => t.document.getFlag("dynamicringselector", "ringPath"));
    if (tokenWithRing) {
        const ringPath = tokenWithRing.document.getFlag("dynamicringselector", "ringPath");
        applyRingSpritesheet(ringPath);
        redrawTokenRings();
    }
});

// Token Update Hook - Update active ring when a token's flag changes
Hooks.on("updateToken", (document, change, options, userId) => {
    if (change.flags?.dynamicringselector?.ringPath !== undefined) {
        const ringPath = document.getFlag("dynamicringselector", "ringPath");
        applyRingSpritesheet(ringPath);
        redrawTokenRings();
    }
});

// Control Token Hook - Swap active style when selecting a token with a custom style
Hooks.on("controlToken", (token, controlled) => {
    if (controlled) {
        const ringPath = token.document.getFlag("dynamicringselector", "ringPath");
        if (ringPath) {
            applyRingSpritesheet(ringPath);
            redrawTokenRings();
        }
    }
});

// Inject Dropdown in Token Configuration
Hooks.on("renderTokenConfig", (app, html, data) => {
    // Resolve standard HTMLElement (handles jQuery or AppV2 raw elements)
    const htmlElement = (html instanceof HTMLElement) ? html : html[0];
    if (!htmlElement) return;

    // Find the Appearance tab
    const appearanceTab = htmlElement.querySelector('.tab[data-tab="appearance"]');
    if (!appearanceTab) return;

    // Get the cached list of rings
    const cachedRings = game.settings.get("dynamicringselector", "cachedRings") || [];

    // Get current token document and active ring path flag
    const tokenDoc = app.token || app.document;
    const currentPath = tokenDoc.getFlag("dynamicringselector", "ringPath") || "";

    // Build the dropdown options
    let optionsHtml = `<option value="">-- Use Default / Unchanged --</option>`;
    for (const ring of cachedRings) {
        const selected = ring.path === currentPath ? "selected" : "";
        optionsHtml += `<option value="${ring.path}" ${selected}>${ring.label}</option>`;
    }

    // Build form group HTML aligned with Foundry VTT styling
    const formGroupHtml = `
        <div class="form-group">
            <label>Dynamic Ring Style</label>
            <div class="form-fields">
                <select name="flags.dynamicringselector.ringPath">
                    ${optionsHtml}
                </select>
            </div>
            <p class="notes">Select a custom dynamic token ring style. When this token is updated, targeted or selected, this style will be set as the active global dynamic ring.</p>
        </div>
    `;

    // Append to appearance tab
    const container = document.createElement("div");
    container.innerHTML = formGroupHtml.trim();
    appearanceTab.appendChild(container.firstChild);

    // Reposition TokenConfig sheet to fit the new field
    app.setPosition();
});
