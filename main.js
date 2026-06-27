/**
 * Dynamic Ring Selector
 * A lightweight Foundry VTT v14 module to natively register and swap dynamic token rings.
 */

// Module-level store for virtual spritesheets (keyed by clean dynamicringselector:// URL)
const virtualSpritesheetStore = new Map();
const customRingConfigStore = new Map();
const CUSTOM_RING_CONFIG_ID = "dynamicringselector-custom";

function normalizeAssetPath(filePath) {
    if (!filePath) return null;
    if (filePath.startsWith("/") || filePath.startsWith("http")) return filePath;
    return `/${filePath}`;
}

function refreshCustomRingConfig() {
    const ringPath = (game.settings.get("dynamicringselector", "customRingImage") || "").trim();
    const backgroundPath = (game.settings.get("dynamicringselector", "customRingBackgroundImage") || "").trim();

    if (!ringPath || !backgroundPath) {
        customRingConfigStore.delete(CUSTOM_RING_CONFIG_ID);
        return null;
    }

    const customConfig = {
        id: CUSTOM_RING_CONFIG_ID,
        label: "Custom Ring",
        ringImagePath: ringPath,
        backgroundImagePath: backgroundPath
    };
    customRingConfigStore.set(CUSTOM_RING_CONFIG_ID, customConfig);
    return customConfig;
}

async function buildCompositeCustomSpritesheet(customConfig) {
    const ringPath = normalizeAssetPath(customConfig.ringImagePath);
    const backgroundPath = normalizeAssetPath(customConfig.backgroundImagePath);

    if (!ringPath || !backgroundPath) {
        throw new Error("Both a ring image and a background image are required for a custom ring.");
    }

    const [ringTexture, backgroundTexture] = await Promise.all([
        PIXI.Assets.load(ringPath),
        PIXI.Assets.load(backgroundPath)
    ]);

    const backgroundWidth = backgroundTexture.width || 512;
    const backgroundHeight = backgroundTexture.height || 512;
    const ringWidth = ringTexture.width || 512;
    const ringHeight = ringTexture.height || 512;

    const padding = 32;
    const frameWidth = Math.max(backgroundWidth, ringWidth) + (padding * 2);
    const frameHeight = Math.max(backgroundHeight, ringHeight) + (padding * 2);
    const canvas = document.createElement("canvas");
    canvas.width = (frameWidth * 2) + padding;
    canvas.height = frameHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
        throw new Error("Unable to create a canvas context for the custom ring spritesheet.");
    }

    const drawScaledImage = (source, targetX, targetY, targetWidth, targetHeight) => {
        const sourceWidth = source.naturalWidth || source.width || targetWidth;
        const sourceHeight = source.naturalHeight || source.height || targetHeight;
        const sourceAspect = sourceWidth / sourceHeight;
        const targetAspect = targetWidth / targetHeight;
        let drawWidth = targetWidth;
        let drawHeight = targetHeight;

        if (sourceAspect > targetAspect) {
            drawHeight = targetWidth / sourceAspect;
        } else {
            drawWidth = targetHeight * sourceAspect;
        }

        const offsetX = targetX + ((targetWidth - drawWidth) / 2);
        const offsetY = targetY + ((targetHeight - drawHeight) / 2);
        ctx.drawImage(source, offsetX, offsetY, drawWidth, drawHeight);
    };

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawScaledImage(backgroundTexture.baseTexture.resource?.source, padding, padding, frameWidth - (padding * 2), frameHeight - (padding * 2));
    drawScaledImage(ringTexture.baseTexture.resource?.source, frameWidth + padding + padding, padding, frameWidth - (padding * 2), frameHeight - (padding * 2));

    const compositeTexture = PIXI.Texture.from(canvas);
    const spritesheetJson = {
        frames: {
            background: {
                frame: { x: 0, y: 0, w: frameWidth, h: frameHeight },
                rotated: false,
                trimmed: false,
                spriteSourceSize: { x: 0, y: 0, w: frameWidth, h: frameHeight },
                sourceSize: { w: frameWidth, h: frameHeight },
                anchor: { x: 0.5, y: 0.5 }
            },
            ring: {
                frame: { x: frameWidth + padding, y: 0, w: frameWidth, h: frameHeight },
                rotated: false,
                trimmed: false,
                spriteSourceSize: { x: 0, y: 0, w: frameWidth, h: frameHeight },
                sourceSize: { w: frameWidth, h: frameHeight },
                anchor: { x: 0.5, y: 0.5 }
            }
        },
        meta: {
            image: customConfig.id,
            format: "RGBA8888",
            size: { w: canvas.width, h: canvas.height },
            scale: "1"
        },
        config: {
            defaultColorBand: {
                startRadius: 0.8,
                endRadius: 1.0
            }
        }
    };

    const spritesheet = new PIXI.Spritesheet(compositeTexture, spritesheetJson);
    await spritesheet.parse();
    return spritesheet;
}

// Helper to resolve an image ring's file path from the cached settings by config ID
function resolveImagePathForId(id) {
    try {
        const cachedRings = game.settings.get("dynamicringselector", "cachedRings") || [];
        const ring = cachedRings.find(r => {
            if (!r.isImage) return false;
            return r.path.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase() === id;
        });
        if (!ring) return null;
        let imagePath = ring.path;
        if (!imagePath.startsWith("/") && !imagePath.startsWith("http")) {
            imagePath = "/" + imagePath;
        }
        return imagePath;
    } catch (e) {
        return null;
    }
}

// Register a custom PixiJS LoaderParser to intercept dynamicringselector:// URLs.
// This MUST run at module evaluation time (before any loading happens)
// so it is registered before the canvas tries to load any spritesheet.
// The parser is fully self-contained: it builds the spritesheet on-demand
// when PixiJS first requests it, avoiding any hook-timing dependencies.
{
    const drsLoaderParser = {
        extension: {
            type: PIXI.ExtensionType.LoadParser,
            name: "drs-virtual-spritesheet",
            priority: 100
        },
        test(url) {
            return typeof url === "string" && url.startsWith("dynamicringselector://");
        },
        async load(url) {
            // Strip query params and hashes that PixiJS/Foundry may append
            const cleanUrl = url.split("?")[0].split("#")[0];

            // Return from cache if already built
            if (virtualSpritesheetStore.has(cleanUrl)) {
                return virtualSpritesheetStore.get(cleanUrl);
            }

            // Extract the config ID from the URL (dynamicringselector://<id>.json)
            const id = cleanUrl.replace("dynamicringselector://", "").replace(".json", "");
            const customConfig = customRingConfigStore.get(id);
            if (customConfig) {
                try {
                    const spritesheet = await buildCompositeCustomSpritesheet(customConfig);
                    virtualSpritesheetStore.set(cleanUrl, spritesheet);
                    console.log(`DynamicRingSelector | Built and cached virtual spritesheet: ${cleanUrl} from paired ring/background assets`);
                    return spritesheet;
                } catch (e) {
                    console.error("DynamicRingSelector | Failed to build virtual spritesheet for custom ring config", e);
                    return null;
                }
            }

            const imagePath = resolveImagePathForId(id);
            if (!imagePath) {
                console.warn(`DynamicRingSelector | Could not resolve image path for config ID: ${id}`);
                return null;
            }

            try {
                // Load the image texture via standard PixiJS asset loading
                const texture = await PIXI.Assets.load(imagePath);
                const w = texture.width || 512;
                const h = texture.height || 512;

                // Build the spritesheet config matching the texture dimensions
                const spritesheetJson = {
                    frames: {
                        ring: {
                            frame: { x: 0, y: 0, w, h },
                            rotated: false,
                            trimmed: false,
                            spriteSourceSize: { x: 0, y: 0, w, h },
                            sourceSize: { w, h }
                        },
                        background: {
                            frame: { x: 0, y: 0, w, h },
                            rotated: false,
                            trimmed: false,
                            spriteSourceSize: { x: 0, y: 0, w, h },
                            sourceSize: { w, h }
                        }
                    },
                    meta: {
                        image: imagePath,
                        format: "RGBA8888",
                        size: { w, h },
                        scale: "1"
                    },
                    config: {
                        defaultColorBand: {
                            startRadius: 0.8,
                            endRadius: 1.0
                        }
                    }
                };

                const spritesheet = new PIXI.Spritesheet(texture, spritesheetJson);
                await spritesheet.parse();

                // Cache for future lookups
                virtualSpritesheetStore.set(cleanUrl, spritesheet);
                console.log(`DynamicRingSelector | Built and cached virtual spritesheet: ${cleanUrl} from ${imagePath}`);
                return spritesheet;
            } catch (e) {
                console.error(`DynamicRingSelector | Failed to build virtual spritesheet for: ${imagePath}`, e);
                return null;
            }
        }
    };
    PIXI.extensions.add(drsLoaderParser);
}

// Helper to update the cached list of available rings
async function updateCachedRings() {
    const rings = new Map();

    // 1. Add the core default steel ring
    rings.set("canvas/tokens/rings-steel.json", {
        path: "canvas/tokens/rings-steel.json",
        label: "Default Steel Ring"
    });

    const customConfig = refreshCustomRingConfig();
    if (customConfig) {
        rings.set(customConfig.id, {
            path: customConfig.id,
            label: customConfig.label,
            isImage: true,
            isCustom: true
        });
    }

    const ringList = Array.from(rings.values());
    const oldRingList = game.settings.get("dynamicringselector", "cachedRings") || [];
    
    // Check if the list actually changed
    const oldPaths = oldRingList.map(r => `${r.path}:${!!r.isImage}`).join(",");
    const newPaths = ringList.map(r => `${r.path}:${!!r.isImage}`).join(",");
    const changed = oldPaths !== newPaths;

    if (changed) {
        await game.settings.set("dynamicringselector", "cachedRings", ringList);
        console.log("DynamicRingSelector | Updated cached ring list:", ringList);
    }
    return changed;
}

// Helper to swap active ring configuration natively
function applyRingId(ringId) {
    if (!ringId) {
        // Revert to core steel default ring if none selected
        CONFIG.Token.ring.useConfig("coreSteel");
        console.log(`DynamicRingSelector | Reverted active dynamic token ring configuration to default (coreSteel).`);
        return;
    }

    if (CONFIG.Token.ring.configIDs.includes(ringId)) {
        CONFIG.Token.ring.useConfig(ringId);
        console.log(`DynamicRingSelector | Applied active dynamic token ring configuration: ${ringId}`);
    } else {
        console.warn(`DynamicRingSelector | Dynamic ring configuration ID "${ringId}" not found in registered configs.`);
    }
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

// Helper to pre-populate the virtual spritesheet store for raw images
async function loadVirtualSpritesheets() {
    const cachedRings = game.settings.get("dynamicringselector", "cachedRings") || [];

    for (const ring of cachedRings) {
        if (!ring.isImage || ring.isCustom) continue;

        const id = ring.path.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
        const spritesheetPath = `dynamicringselector://${id}.json`;

        // Skip if already built
        if (virtualSpritesheetStore.has(spritesheetPath)) continue;

        try {
            // Load the image texture first via standard PixiJS asset loading
            let imagePath = ring.path;
            if (!imagePath.startsWith("/") && !imagePath.startsWith("http")) {
                imagePath = "/" + imagePath;
            }
            const texture = await PIXI.Assets.load(imagePath);
            const w = texture.width || 512;
            const h = texture.height || 512;

            // Build the spritesheet config matching the texture dimensions
            const spritesheetJson = {
                frames: {
                    background: {
                        frame: { x: 0, y: 0, w, h },
                        rotated: false,
                        trimmed: false,
                        spriteSourceSize: { x: 0, y: 0, w, h },
                        sourceSize: { w, h }
                    },
                    ring: {
                        frame: { x: 0, y: 0, w, h },
                        rotated: false,
                        trimmed: false,
                        spriteSourceSize: { x: 0, y: 0, w, h },
                        sourceSize: { w, h }
                    }
                },
                meta: {
                    image: imagePath,
                    format: "RGBA8888",
                    size: { w, h },
                    scale: "1"
                },
                config: {
                    defaultColorBand: {
                        startRadius: 0.8,
                        endRadius: 1.0
                    }
                }
            };

            const spritesheet = new PIXI.Spritesheet(texture, spritesheetJson);
            await spritesheet.parse();

            // Store in the module-level map; the custom LoaderParser will serve this
            virtualSpritesheetStore.set(spritesheetPath, spritesheet);
            console.log(`DynamicRingSelector | Cached virtual spritesheet: ${spritesheetPath} for image ${ring.path}`);
        } catch (e) {
            console.error(`DynamicRingSelector | Failed to cache virtual spritesheet for: ${ring.path}`, e);
        }
    }
}

function registerDynamicRingConfigs(ringConfig) {
    const cachedRings = game.settings.get("dynamicringselector", "cachedRings") || [];
    const DynamicRingData = foundry.canvas.tokens?.DynamicRingData || foundry.canvas.placeables?.tokens?.DynamicRingData;
    if (!DynamicRingData) return;

    const customConfig = refreshCustomRingConfig();
    if (customConfig && !ringConfig.configIDs.includes(CUSTOM_RING_CONFIG_ID)) {
        const customRing = new DynamicRingData({
            id: CUSTOM_RING_CONFIG_ID,
            label: customConfig.label,
            effects: {
                RING_PULSE: "TOKEN.RING.EFFECTS.RING_PULSE",
                RING_GRADIENT: "TOKEN.RING.EFFECTS.RING_GRADIENT",
                BACKGROUND_WAVE: "TOKEN.RING.EFFECTS.BACKGROUND_WAVE"
            },
            spritesheet: `dynamicringselector://${CUSTOM_RING_CONFIG_ID}.json`
        });
        ringConfig.addConfig(CUSTOM_RING_CONFIG_ID, customRing);
        console.log(`DynamicRingSelector | Registered custom ring configuration: ${CUSTOM_RING_CONFIG_ID}`);
    }

    for (const ring of cachedRings) {
        // Skip default steel ring (handled natively by Core)
        if (ring.path === "canvas/tokens/rings-steel.json" || ring.path === "/public/canvas/tokens/rings-steel.json") continue;

        // Use a safe, unique ID for the custom configuration
        const id = ring.path.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
        
        // Prevent duplicate registration
        if (ringConfig.configIDs.includes(id)) continue;

        let spritesheetPath = ring.path;
        if (ring.isImage) {
            spritesheetPath = `dynamicringselector://${id}.json`;
        }

        const customRing = new DynamicRingData({
            id: id,
            label: ring.label,
            effects: {
                RING_PULSE: "TOKEN.RING.EFFECTS.RING_PULSE",
                RING_GRADIENT: "TOKEN.RING.EFFECTS.RING_GRADIENT",
                BACKGROUND_WAVE: "TOKEN.RING.EFFECTS.BACKGROUND_WAVE"
            },
            spritesheet: spritesheetPath
        });
        ringConfig.addConfig(id, customRing);
        console.log(`DynamicRingSelector | Registered native ring configuration: ${id} (${spritesheetPath})`);
    }
}

// Native Dynamic Ring Registration Hook
Hooks.on("initializeDynamicTokenRingConfig", (ringConfig) => {
    registerDynamicRingConfigs(ringConfig);
});

// Init Hook
Hooks.once("init", () => {
    // Register settings
    game.settings.register("dynamicringselector", "customRingImage", {
        name: "Custom Ring Image",
        hint: "Select the ring image to pair with the background image below for a custom dynamic token ring.",
        scope: "world",
        config: true,
        type: String,
        default: "",
        filePicker: "image",
        onChange: () => {
            refreshCustomRingConfig();
            updateCachedRings().catch(err => console.error("DynamicRingSelector | Error refreshing custom ring config:", err));
        }
    });

    game.settings.register("dynamicringselector", "customRingBackgroundImage", {
        name: "Custom Ring Background Image",
        hint: "Select the background image to pair with the ring image above for a custom dynamic token ring.",
        scope: "world",
        config: true,
        type: String,
        default: "",
        filePicker: "image",
        onChange: () => {
            refreshCustomRingConfig();
            updateCachedRings().catch(err => console.error("DynamicRingSelector | Error refreshing custom ring config:", err));
        }
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
        applyRingId,
        redrawTokenRings
    };
    globalThis.DynamicRingSelector = api;
    const moduleData = game.modules.get("dynamicringselector");
    if (moduleData) {
        moduleData.api = api;
    }
});

// Ready Hook
Hooks.once("ready", async () => {
    refreshCustomRingConfig();

    // Players and GMs need to load and cache virtual spritesheets for dynamic token rings
    await loadVirtualSpritesheets();

    if (game.user.isGM) {
        updateCachedRings().catch(err => {
            console.error("DynamicRingSelector | Error updating cached rings during ready:", err);
        });
    }
});

// Canvas Ready Hook - Apply ring ID if a token in the scene has one set
Hooks.on("canvasReady", () => {
    const tokenWithRing = canvas.tokens.placeables.find(t => {
        const doc = t.document;
        return doc.getFlag("dynamicringselector", "ringId") || doc.getFlag("dynamicringselector", "ringPath");
    });
    if (tokenWithRing) {
        const ringId = tokenWithRing.document.getFlag("dynamicringselector", "ringId") || 
                       tokenWithRing.document.getFlag("dynamicringselector", "ringPath")?.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
        applyRingId(ringId);
        redrawTokenRings();
    }
});

// Token Update Hook - Update active ring when a token's flag changes
Hooks.on("updateToken", (document, change, options, userId) => {
    const ringId = change.flags?.dynamicringselector?.ringId || 
                   change.flags?.dynamicringselector?.ringPath?.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
    if (ringId !== undefined) {
        applyRingId(ringId);
        redrawTokenRings();
    }
});

// Control Token Hook - Swap active style when selecting a token with a custom style
Hooks.on("controlToken", (token, controlled) => {
    if (controlled) {
        const ringId = token.document.getFlag("dynamicringselector", "ringId") || 
                       token.document.getFlag("dynamicringselector", "ringPath")?.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
        if (ringId) {
            applyRingId(ringId);
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

    // Get current token document and active ring ID flag
    const tokenDoc = app.token || app.document;
    let currentRingId = tokenDoc.getFlag("dynamicringselector", "ringId") || "";

    // Backward compatibility: Migrate / resolve legacy path flags to config ID
    if (!currentRingId) {
        const legacyPath = tokenDoc.getFlag("dynamicringselector", "ringPath") || "";
        if (legacyPath) {
            currentRingId = legacyPath.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
        }
    }

    // Build the dropdown options using natively registered CONFIG configs
    const configIDs = CONFIG.Token.ring.configIDs;
    let optionsHtml = `<option value="">-- Use Default / Unchanged --</option>`;
    for (const id of configIDs) {
        const config = CONFIG.Token.ring.getConfig(id);
        if (!config) continue;
        const selected = id === currentRingId ? "selected" : "";
        optionsHtml += `<option value="${id}" ${selected}>${config.label} (${id})</option>`;
    }

    // Build form group HTML aligned with Foundry VTT styling
    const formGroupHtml = `
        <div class="form-group">
            <label>Dynamic Ring Style</label>
            <div class="form-fields">
                <select name="flags.dynamicringselector.ringId">
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
