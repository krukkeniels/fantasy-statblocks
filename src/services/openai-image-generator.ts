import { Notice, TFile, Vault, normalizePath, requestUrl, App } from "obsidian";
import type { Monster } from "index";
import OpenAI from "openai";
import { PromptEngineeringService, type EnhancedPrompt, type MonsterDescription } from "./prompt-engineering";

/**
 * OpenAI Image Generator Service
 * Generates creature images using gpt-image-1 API
 */

export type ImageQuality = "low" | "medium" | "high" | "auto";
export type ImageSize = "1024x1024" | "1536x1024" | "1024x1536" | "auto";

export interface ImageGenerationOptions {
    apiKey: string;
    style: string;
    saveFolder: string;
    quality: ImageQuality;
    size: ImageSize;
    enablePromptEngineering?: boolean;
}

export class OpenAIImageGenerator {
    private static async ensureFolder(
        vault: Vault,
        folderPath: string
    ): Promise<string> {
        const normalizedFolder = normalizePath(folderPath);
        const folderExists = await vault.adapter.exists(normalizedFolder);
        if (!folderExists) {
            await vault.adapter.mkdir(normalizedFolder);
        }
        return normalizedFolder;
    }

    /**
     * Generate a prompt from monster data
     */
    static generatePromptFromMonster(monster: Partial<Monster>, style: string): string {
        const parts: string[] = [];

        // Base description
        if (monster.name) {
            parts.push(`A creature named ${monster.name}`);
        }

        // Size and type
        const sizeType: string[] = [];
        if (monster.size) sizeType.push(monster.size.toLowerCase());
        if (monster.type) sizeType.push(monster.type.toLowerCase());
        if (sizeType.length > 0) {
            parts.push(sizeType.join(" "));
        }

        // Alignment for character flavor
        if (monster.alignment && monster.alignment !== "unaligned") {
            const alignmentDescriptors: Record<string, string> = {
                "lawful good": "noble and virtuous",
                "neutral good": "kind and benevolent",
                "chaotic good": "free-spirited and heroic",
                "lawful neutral": "orderly and disciplined",
                "neutral": "balanced",
                "chaotic neutral": "unpredictable and wild",
                "lawful evil": "tyrannical and cruel",
                "neutral evil": "malicious and selfish",
                "chaotic evil": "destructive and malevolent"
            };
            const descriptor = alignmentDescriptors[monster.alignment.toLowerCase()];
            if (descriptor) {
                parts.push(`with a ${descriptor} demeanor`);
            }
        }

        // Prioritize explicit appearance property
        if (monster.appearance) {
            parts.push(monster.appearance);
        } else {
            // Fallback: Add description if available
            if (monster.description) {
                parts.push(monster.description);
            }

            // Fallback: Extract appearance from traits
            if (monster.traits && Array.isArray(monster.traits)) {
                const appearanceTraits = monster.traits
                    .filter((t) =>
                        t.name?.toLowerCase().includes("appearance") ||
                        t.desc?.toLowerCase().includes("looks like") ||
                        t.desc?.toLowerCase().includes("appears as")
                    )
                    .map((t) => t.desc)
                    .slice(0, 2);

                if (appearanceTraits.length > 0) {
                    parts.push(appearanceTraits.join(". "));
                }
            }
        }

        // Build final prompt
        let prompt = parts.join(", ");

        // Add style instruction and explicit no-text directive
        prompt += `. ${style} style, high quality, detailed, fantasy RPG creature portrait, dramatic lighting. NO text, letters, words, or labels should appear in the image`;

        // gpt-image-1 handles longer prompts well
        if (prompt.length > 4000) {
            prompt = prompt.substring(0, 3997) + "...";
        }

        return prompt;
    }

    /**
     * Generate an image using OpenAI gpt-image-1
     */
    static async generateImage(
        prompt: string,
        apiKey: string,
        quality: ImageQuality = "auto",
        size: ImageSize = "1024x1024"
    ): Promise<ArrayBuffer> {
        if (!apiKey || apiKey.trim() === "") {
            throw new Error("OpenAI API key is not configured. Please add it in Fantasy Statblocks settings.");
        }

        try {
            const openai = new OpenAI({
                apiKey: apiKey,
                dangerouslyAllowBrowser: true
            });

            const response = await openai.images.generate({
                model: "gpt-image-1",
                prompt: prompt,
                n: 1,
                size: size,
                quality: quality,
            });

            if (!response.data || response.data.length === 0) {
                throw new Error("No image was generated by OpenAI");
            }

            const imageData = response.data[0];

            if (imageData.b64_json) {
                const byteCharacters = atob(imageData.b64_json);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                return new Uint8Array(byteNumbers).buffer;
            } else if (imageData.url) {
                const downloadResponse = await requestUrl({
                    url: imageData.url,
                    method: "GET"
                });
                if (downloadResponse.status !== 200) {
                    throw new Error(`Failed to download image: ${downloadResponse.status}`);
                }
                return downloadResponse.arrayBuffer;
            } else {
                throw new Error("No usable image data returned from OpenAI");
            }
        } catch (error: any) {
            if (error.status === 401) {
                throw new Error("Invalid OpenAI API key. Please check your settings.");
            } else if (error.status === 429) {
                throw new Error("OpenAI API rate limit exceeded. Please try again later.");
            } else if (error.status === 400) {
                throw new Error("Invalid request to OpenAI. The prompt may contain prohibited content.");
            } else {
                throw new Error(`OpenAI API error: ${error.message || "Unknown error"}`);
            }
        }
    }

    /**
     * Save image bytes to vault
     */
    static async saveImageToVault(
        imageData: ArrayBuffer,
        vault: Vault,
        folderPath: string,
        monsterName: string,
        suffix: string = ""
    ): Promise<string> {
        try {
            const normalizedFolder = await this.ensureFolder(vault, folderPath);

            const safeName = monsterName.replace(/[^a-z0-9]/gi, "_").toLowerCase();
            const filename = `${safeName}${suffix}.png`;
            const filePath = normalizePath(`${normalizedFolder}/${filename}`);

            await vault.adapter.writeBinary(filePath, imageData);

            return filePath;
        } catch (error: any) {
            throw new Error(`Failed to save image to vault: ${error.message}`);
        }
    }

    /**
     * Update the image property in a creature's frontmatter
     */
    static async updateCreatureFrontmatter(
        app: App,
        filePath: string,
        imagePath: string
    ): Promise<boolean> {
        try {
            const file = app.vault.getAbstractFileByPath(filePath);

            if (!file || !(file instanceof TFile)) {
                console.warn(`File not found for frontmatter update: ${filePath}`);
                return false;
            }

            await app.fileManager.processFrontMatter(file, (frontmatter) => {
                frontmatter.image = imagePath;
            });

            return true;
        } catch (error: any) {
            console.error("Failed to update frontmatter:", error);
            return false;
        }
    }

    /**
     * Main function to generate and save monster image (text-to-image)
     */
    static async generateMonsterImage(
        monster: Partial<Monster>,
        vault: Vault,
        options: ImageGenerationOptions
    ): Promise<string> {
        const loadingNotice = new Notice("Generating AI image...", 0);

        try {
            const prompt = this.generatePromptFromMonster(monster, options.style);
            console.log("Generated prompt:", prompt);

            loadingNotice.setMessage("Requesting image from OpenAI...");
            const imageData = await this.generateImage(prompt, options.apiKey, options.quality, options.size);

            loadingNotice.setMessage("Saving image to vault...");
            const vaultPath = await this.saveImageToVault(
                imageData,
                vault,
                options.saveFolder,
                monster.name || "creature"
            );

            loadingNotice.hide();
            new Notice(`AI image generated successfully! Saved to ${vaultPath}`);

            return vaultPath;
        } catch (error: any) {
            loadingNotice.hide();
            const errorMessage = error.message || "Unknown error occurred";
            new Notice(`Failed to generate image: ${errorMessage}`, 10000);
            throw error;
        }
    }

    /**
     * Compress and prepare an image for OpenAI upload
     * Resizes to fit within max dimensions and compresses to be under maxSizeBytes
     */
    private static async compressAndPrepareImage(
        file: File,
        maxSizeBytes: number = 4 * 1024 * 1024,
        maxDimension: number = 2048
    ): Promise<File> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);

            img.onload = async () => {
                try {
                    let currentDimension = Math.min(Math.max(img.width, img.height), maxDimension);
                    let compressedFile: File | null = null;

                    // Try at current resolution first, then reduce
                    while (currentDimension >= 512 && !compressedFile) {
                        const canvas = document.createElement('canvas');

                        // Maintain aspect ratio within the max dimension
                        const scale = Math.min(currentDimension / img.width, currentDimension / img.height);
                        canvas.width = Math.round(img.width * scale);
                        canvas.height = Math.round(img.height * scale);

                        const ctx = canvas.getContext('2d');
                        if (!ctx) {
                            reject(new Error('Failed to get canvas context'));
                            return;
                        }

                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                        const blob = await new Promise<Blob>((resolveBlob, rejectBlob) => {
                            canvas.toBlob(
                                (blob) => {
                                    if (!blob) {
                                        rejectBlob(new Error('Failed to create blob'));
                                        return;
                                    }
                                    resolveBlob(blob);
                                },
                                'image/png'
                            );
                        });

                        if (blob.size <= maxSizeBytes) {
                            compressedFile = new File(
                                [blob],
                                file.name.replace(/\.[^.]+$/, '.png'),
                                { type: 'image/png' }
                            );
                            console.log(`Image prepared: ${canvas.width}x${canvas.height}, ${blob.size} bytes`);
                        } else {
                            currentDimension = Math.floor(currentDimension * 0.75);
                        }
                    }

                    URL.revokeObjectURL(url);

                    if (!compressedFile) {
                        reject(new Error('Unable to compress image below 4MB size limit. Please try a smaller image.'));
                        return;
                    }

                    resolve(compressedFile);
                } catch (error) {
                    URL.revokeObjectURL(url);
                    reject(error);
                }
            };

            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to load image file'));
            };

            img.src = url;
        });
    }

    /**
     * Generate monster image from a reference photo using gpt-image-1 image editing
     * Optionally uses GPT prompt engineering for better results
     */
    static async generateMonsterImageFromPhoto(
        monster: Partial<Monster>,
        vault: Vault,
        photo: File,
        options: ImageGenerationOptions
    ): Promise<string> {
        if (!photo) {
            throw new Error("No source photo was provided.");
        }

        if (!options.apiKey || options.apiKey.trim() === "") {
            throw new Error(
                "OpenAI API key is not configured. Please add it in Fantasy Statblocks settings."
            );
        }

        const loadingNotice = new Notice("Enhancing photo with AI...", 0);

        try {
            // Compress and prepare image
            loadingNotice.setMessage("Preparing image...");
            const preparedPhoto = await this.compressAndPrepareImage(photo);

            // Build prompt - optionally enhanced with GPT prompt engineering
            let prompt: string;

            if (options.enablePromptEngineering) {
                try {
                    loadingNotice.setMessage("Crafting optimized prompt with GPT...");

                    const monsterDescription: MonsterDescription = {
                        description: this.generatePromptFromMonster(monster, options.style),
                    };

                    const enhancedPrompt = await PromptEngineeringService.generateEnhancedPrompt(
                        monsterDescription,
                        monster,
                        {
                            apiKey: options.apiKey,
                            style: options.style,
                        }
                    );
                    console.log("Enhanced prompt generated:", enhancedPrompt);
                    prompt = `${enhancedPrompt.positivePrompt} Transform the provided miniature photograph into a lifelike fantasy creature portrait while keeping the pose and recognizable gear.`;
                } catch (error: any) {
                    console.warn("Prompt engineering failed, using fallback:", error.message);
                    new Notice("Prompt engineering failed, using basic prompt", 5000);

                    const fallback = PromptEngineeringService.createFallbackPrompt(
                        this.generatePromptFromMonster(monster, options.style),
                        options.style
                    );
                    prompt = `${fallback.positivePrompt} Transform the provided miniature photograph into a lifelike fantasy creature portrait while keeping the pose and recognizable gear.`;
                }
            } else {
                prompt = `${this.generatePromptFromMonster(monster, options.style)} Transform the provided miniature photograph into a lifelike fantasy creature portrait while keeping the pose and recognizable gear.`;
            }

            const openai = new OpenAI({
                apiKey: options.apiKey,
                dangerouslyAllowBrowser: true
            });

            loadingNotice.setMessage("Uploading photo to OpenAI...");
            const response = await openai.images.edit({
                model: "gpt-image-1",
                prompt,
                image: preparedPhoto,
                size: options.size === "auto" ? "1024x1024" : options.size,
            });

            if (!response.data || response.data.length === 0) {
                throw new Error("No image was generated by OpenAI");
            }

            const imageResult = response.data[0];
            let imageBuffer: ArrayBuffer;

            loadingNotice.setMessage("Saving image to vault...");

            if (imageResult.b64_json) {
                const byteCharacters = atob(imageResult.b64_json);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                imageBuffer = new Uint8Array(byteNumbers).buffer;
            } else if (imageResult.url) {
                const downloadResponse = await requestUrl({
                    url: imageResult.url,
                    method: "GET"
                });
                if (downloadResponse.status !== 200) {
                    throw new Error(`Failed to download image: ${downloadResponse.status}`);
                }
                imageBuffer = downloadResponse.arrayBuffer;
            } else {
                throw new Error("OpenAI did not return usable image data.");
            }

            const vaultPath = await this.saveImageToVault(
                imageBuffer,
                vault,
                options.saveFolder,
                monster.name || "creature"
            );

            loadingNotice.hide();
            new Notice(`AI image generated successfully! Saved to ${vaultPath}`);

            return vaultPath;
        } catch (error: any) {
            loadingNotice.hide();
            const errorMessage = error.message || "Unknown error occurred";
            new Notice(`Failed to generate image: ${errorMessage}`, 10000);
            throw error;
        }
    }

    /**
     * Convert an ArrayBuffer to a File suitable for images.edit()
     */
    private static arrayBufferToFile(data: ArrayBuffer, name: string): File {
        const blob = new Blob([data], { type: "image/png" });
        return new File([blob], name, { type: "image/png" });
    }

    /**
     * Edit an image using OpenAI gpt-image-1 image editing API
     */
    private static async editImageWithPrompt(
        baseImage: File,
        prompt: string,
        apiKey: string,
        size: ImageSize
    ): Promise<ArrayBuffer> {
        const openai = new OpenAI({
            apiKey: apiKey,
            dangerouslyAllowBrowser: true
        });

        const response = await openai.images.edit({
            model: "gpt-image-1",
            prompt,
            image: baseImage,
            size: size === "auto" ? "1024x1024" : size,
        });

        if (!response.data || response.data.length === 0) {
            throw new Error("No image was generated by OpenAI");
        }

        const imageResult = response.data[0];

        if (imageResult.b64_json) {
            const byteCharacters = atob(imageResult.b64_json);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            return new Uint8Array(byteNumbers).buffer;
        } else if (imageResult.url) {
            const downloadResponse = await requestUrl({
                url: imageResult.url,
                method: "GET"
            });
            if (downloadResponse.status !== 200) {
                throw new Error(`Failed to download image: ${downloadResponse.status}`);
            }
            return downloadResponse.arrayBuffer;
        } else {
            throw new Error("OpenAI did not return usable image data.");
        }
    }

    // Pools of pose variations per health state for visual variety
    private static readonly HURT_POSES = [
        "staggering backward from a hit, off-balance",
        "bracing defensively with one arm raised to shield",
        "clutching a wound on their side with one hand, still gripping weapon",
        "stumbling forward, catching themselves mid-fall",
        "snarling defiantly through the pain, in an aggressive stance",
        "ducking low in a defensive crouch, looking wary",
        "recoiling from an impact, twisted to one side",
        "favoring one leg, shifting weight to compensate for an injury",
    ];

    private static readonly BLOODIED_POSES = [
        "down on one knee, using their weapon to prop themselves up",
        "leaning heavily against their weapon for support, barely upright",
        "hunched over and clutching a deep wound, blood seeping through fingers",
        "reaching out with one hand as if grasping for help, the other pressed against a wound",
        "stumbling with arms hanging limp, head bowed in exhaustion",
        "collapsed to both knees, swaying as if about to fall",
        "dragging themselves forward with grim determination",
        "slumped but still raising a weapon in a last defiant gesture",
    ];

    private static readonly DEAD_POSES = [
        "collapsed face-down on the ground, limbs splayed",
        "lying on their back, eyes staring blankly at the sky, arms outstretched",
        "slumped against a rock or wall, head drooped to one side, lifeless",
        "crumpled in a heap, weapons scattered nearby",
        "fallen to one side in a twisted position, as if mid-collapse",
        "sprawled backward over debris, frozen in their final moment",
        "lying curled on their side, as if they fell trying to crawl away",
        "flat on the ground with one arm reaching forward, motionless",
    ];

    private static randomFrom<T>(arr: T[]): T {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    private static buildHurtPrompt(): string {
        const pose = this.randomFrom(this.HURT_POSES);
        return `Keep this exact character/creature recognizable - same equipment, same colors, same face, same body proportions. Change the pose: the character is now ${pose}. Add minor battle damage: a few visible scratches and shallow cuts on exposed skin, small dents and scuff marks on armor, slightly torn or frayed edges on clothing/cloak, a thin trickle of blood from one small wound, dust and dirt on the lower body. The character should look alert and still combat-ready but clearly has taken some hits. Do NOT change the background style, lighting style, or art style. NO text or labels.`;
    }

    private static buildBloodiedPrompt(): string {
        const pose = this.randomFrom(this.BLOODIED_POSES);
        return `Keep this exact character/creature recognizable - same equipment, same colors, same face, same body proportions. Change the pose: the character is now ${pose}. Add severe battle damage: multiple deep bleeding wounds across the body, significant blood staining on clothing and armor, cracked and broken sections of armor, heavy bruising and swelling on exposed skin, torn clothing revealing wounds underneath, blood dripping, exhausted or pained facial expression. The character should look gravely wounded. Do NOT change the background style, lighting style, or art style. NO text or labels.`;
    }

    private static buildDeadPrompt(): string {
        const pose = this.randomFrom(this.DEAD_POSES);
        return `Keep this exact character/creature recognizable in identity - same equipment, same colors, same face, same body proportions. Show the character/creature ${pose}. Eyes closed or blank and lifeless. Weapons dropped or fallen nearby. A pool of blood spreading beneath the body. No signs of life or movement. The character should look definitively dead and defeated. Do NOT change the background style, lighting style, or art style. NO text or labels.`;
    }

    /**
     * Generate full, hurt, and bloodied health variant images for a monster.
     * Uses image editing to derive variants from the base image for visual consistency.
     */
    static async generateHealthVariants(
        monster: Partial<Monster>,
        vault: Vault,
        options: ImageGenerationOptions,
        onProgress?: (stage: string, current: number, total: number) => void,
        skipVariants?: { full?: boolean; hurt?: boolean; bloodied?: boolean; dead?: boolean }
    ): Promise<{ full: string; hurt: string | null; bloodied: string | null; dead: string | null }> {
        if (!options.apiKey || options.apiKey.trim() === "") {
            throw new Error("OpenAI API key is not configured. Please add it in Fantasy Statblocks settings.");
        }

        const monsterName = monster.name || "creature";
        const toGenerate = 4 - (skipVariants ? Object.values(skipVariants).filter(Boolean).length : 0);
        let step = 0;

        // Step 1: Check if monster already has a full-health image, skip generation if so
        let baseImageData: ArrayBuffer;
        let fullPath: string;

        const existingImage = monster.image;
        if (existingImage) {
            const existingFile = vault.getAbstractFileByPath(existingImage);
            if (existingFile && existingFile instanceof TFile) {
                onProgress?.("Using existing full health image", ++step, toGenerate);
                baseImageData = await vault.readBinary(existingFile);
                fullPath = existingImage;
            }
        }

        if (!fullPath!) {
            onProgress?.("Generating full health image", ++step, toGenerate);
            const prompt = this.generatePromptFromMonster(monster, options.style);
            baseImageData = await this.generateImage(prompt, options.apiKey, options.quality, options.size);
            fullPath = await this.saveImageToVault(baseImageData!, vault, options.saveFolder, monsterName);
        }

        // Convert base image to File for editing API
        const baseFile = this.arrayBufferToFile(baseImageData!, `${monsterName}.png`);

        // Step 2: Generate hurt variant
        let hurtPath: string | null = null;
        if (skipVariants?.hurt && monster.image_hurt) {
            hurtPath = monster.image_hurt;
        } else {
            try {
                onProgress?.("Generating hurt variant", ++step, toGenerate);
                const hurtData = await this.editImageWithPrompt(
                    baseFile, this.buildHurtPrompt(), options.apiKey, options.size
                );
                hurtPath = await this.saveImageToVault(hurtData, vault, options.saveFolder, monsterName, "_hurt");
            } catch (error: any) {
                console.error("Failed to generate hurt variant:", error);
                new Notice(`Hurt variant failed: ${error.message}`, 8000);
            }
        }

        // Step 3: Generate bloodied variant
        let bloodiedPath: string | null = null;
        if (skipVariants?.bloodied && monster.image_bloodied) {
            bloodiedPath = monster.image_bloodied;
        } else {
            try {
                onProgress?.("Generating bloodied variant", ++step, toGenerate);
                const bloodiedData = await this.editImageWithPrompt(
                    baseFile, this.buildBloodiedPrompt(), options.apiKey, options.size
                );
                bloodiedPath = await this.saveImageToVault(bloodiedData, vault, options.saveFolder, monsterName, "_bloodied");
            } catch (error: any) {
                console.error("Failed to generate bloodied variant:", error);
                new Notice(`Bloodied variant failed: ${error.message}`, 8000);
            }
        }

        // Step 4: Generate dead variant
        let deadPath: string | null = null;
        if (skipVariants?.dead && monster.image_dead) {
            deadPath = monster.image_dead;
        } else {
            try {
                onProgress?.("Generating dead variant", ++step, toGenerate);
                const deadData = await this.editImageWithPrompt(
                    baseFile, this.buildDeadPrompt(), options.apiKey, options.size
                );
                deadPath = await this.saveImageToVault(deadData, vault, options.saveFolder, monsterName, "_dead");
            } catch (error: any) {
                console.error("Failed to generate dead variant:", error);
                new Notice(`Dead variant failed: ${error.message}`, 8000);
            }
        }

        return { full: fullPath, hurt: hurtPath, bloodied: bloodiedPath, dead: deadPath };
    }

    /**
     * Update frontmatter with health variant image paths
     */
    static async updateCreatureHealthVariantFrontmatter(
        app: App,
        filePath: string,
        paths: { full: string; hurt: string | null; bloodied: string | null; dead: string | null }
    ): Promise<boolean> {
        try {
            const file = app.vault.getAbstractFileByPath(filePath);

            if (!file || !(file instanceof TFile)) {
                console.warn(`File not found for frontmatter update: ${filePath}`);
                return false;
            }

            await app.fileManager.processFrontMatter(file, (frontmatter) => {
                frontmatter.image = paths.full;
                if (paths.hurt) frontmatter.image_hurt = paths.hurt;
                if (paths.bloodied) frontmatter.image_bloodied = paths.bloodied;
                if (paths.dead) frontmatter.image_dead = paths.dead;
            });

            return true;
        } catch (error: any) {
            console.error("Failed to update frontmatter:", error);
            return false;
        }
    }
}
