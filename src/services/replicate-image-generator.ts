import { Notice, Vault, normalizePath, requestUrl } from "obsidian";
import type { Monster } from "index";
import { VisionAnalysisService, type VisionProvider } from "./vision-analysis";
import { PromptEngineeringService, type PromptProvider, type EnhancedPrompt } from "./prompt-engineering";

/**
 * Replicate Image Generator Service
 * Generates creature images using FLUX.1 Dev API with background removal
 * Supports multi-stage pipeline: vision analysis → prompt engineering → image generation
 * Uses Obsidian's requestUrl to bypass CORS restrictions
 */

export type GenerationMode = "fast" | "quality";

export interface ReplicateImageGenerationOptions {
    apiKey: string;
    style: string;
    saveFolder: string;
    inferenceSteps: number; // Used for regular text-to-image generation (not photo generation)
    removeBackground: boolean; // Used for cleaning miniature photos before vision analysis
    // Vision analysis settings
    enableVisionAnalysis: boolean;
    visionProvider: VisionProvider;
    visionApiKey?: string;
    // Prompt engineering settings
    enablePromptEngineering: boolean;
    promptProvider: PromptProvider;
    promptApiKey?: string;
    // Generation mode
    generationMode: GenerationMode;
}

interface ReplicatePrediction {
    id: string;
    status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
    output?: any;
    error?: string;
}

export class ReplicateImageGenerator {
    private static readonly API_BASE = "https://api.replicate.com/v1";
    private static readonly POLL_INTERVAL = 1000; // 1 second
    private static readonly MAX_POLL_TIME = 180000; // 3 minutes (optimized for balanced quality)

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
     * Create a prediction using Replicate API
     */
    private static async createPrediction(
        modelVersion: string,
        input: any,
        apiKey: string
    ): Promise<ReplicatePrediction> {
        const response = await requestUrl({
            url: `${this.API_BASE}/predictions`,
            method: "POST",
            headers: {
                "Authorization": `Token ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                version: modelVersion,
                input: input
            })
        });

        if (response.status !== 201 && response.status !== 200) {
            const statusCode = response.status;
            const errorDetails = response.json?.error || response.text || "No error details";
            throw new Error(`Request failed, status ${statusCode}: ${errorDetails}`);
        }

        return response.json;
    }

    /**
     * Wait for a prediction to complete
     */
    private static async waitForPrediction(
        predictionId: string,
        apiKey: string
    ): Promise<ReplicatePrediction> {
        const startTime = Date.now();

        while (Date.now() - startTime < this.MAX_POLL_TIME) {
            try {
                const response = await requestUrl({
                    url: `${this.API_BASE}/predictions/${predictionId}`,
                    method: "GET",
                    headers: {
                        "Authorization": `Token ${apiKey}`,
                        "Content-Type": "application/json"
                    }
                });

                if (response.status !== 200) {
                    // Retry on transient server errors (502 Bad Gateway, 503 Service Unavailable, 504 Gateway Timeout)
                    if (response.status >= 502 && response.status <= 504) {
                        console.warn(`Replicate API returned ${response.status} (server error), retrying in ${this.POLL_INTERVAL}ms...`);
                        await new Promise(resolve => setTimeout(resolve, this.POLL_INTERVAL));
                        continue; // Retry the poll
                    }
                    // Fail immediately on client errors (auth, not found, etc.)
                    throw new Error(`Failed to get prediction status: ${response.status}`);
                }

                const prediction: ReplicatePrediction = response.json;

                if (prediction.status === "succeeded") {
                    return prediction;
                } else if (prediction.status === "failed") {
                    throw new Error(`Prediction failed: ${prediction.error || "Unknown error"}`);
                } else if (prediction.status === "canceled") {
                    throw new Error("Prediction was canceled");
                }

                // Still processing, wait and retry
                await new Promise(resolve => setTimeout(resolve, this.POLL_INTERVAL));
            } catch (error: any) {
                // Handle network errors during polling
                if (error.message?.includes("Failed to get prediction status")) {
                    throw error; // Re-throw status errors
                }
                // For network errors, retry if we have time
                console.warn(`Network error while polling Replicate: ${error.message}, retrying...`);
                await new Promise(resolve => setTimeout(resolve, this.POLL_INTERVAL));
            }
        }

        throw new Error("Image generation timed out after 3 minutes. Try reducing inference steps to 25-28 or lowering transformation strength to 0.7 for faster results.");
    }

    /**
     * Generate a FLUX prompt from monster data
     * Emphasizes epic fantasy character portrait/avatar style for TTRPG use
     */
    static generatePromptFromMonster(monster: Partial<Monster>, style: string): string {
        const parts: string[] = [];

        // Base description
        if (monster.name) {
            parts.push(`${monster.name}`);
        }

        // Size and type
        const sizeType: string[] = [];
        if (monster.size) sizeType.push(monster.size.toLowerCase());
        if (monster.type) sizeType.push(monster.type.toLowerCase());
        if (sizeType.length > 0) {
            parts.push(sizeType.join(" "));
        }

        // Prioritize explicit appearance property
        if (monster.appearance) {
            parts.push(monster.appearance);
        } else if (monster.description) {
            // Fallback: Add description if available
            parts.push(monster.description);
        }

        // Build final prompt
        let prompt = parts.join(", ");

        // Add epic fantasy portrait style instructions
        prompt += `, epic fantasy character portrait, professional TTRPG monster artwork, ${style} style, dramatic heroic pose, character avatar, detailed high-quality digital art, cinematic lighting, dynamic composition`;

        // Ensure prompt isn't too long
        if (prompt.length > 1000) {
            prompt = prompt.substring(0, 997) + "...";
        }

        return prompt;
    }

    /**
     * Remove background from an image using Replicate API
     */
    static async removeBackground(
        imageFile: File,
        apiKey: string
    ): Promise<string> {
        if (!apiKey || apiKey.trim() === "") {
            throw new Error("Replicate API key is not configured.");
        }

        try {
            // Convert File to base64 data URL
            const arrayBuffer = await imageFile.arrayBuffer();
            const base64 = btoa(
                new Uint8Array(arrayBuffer).reduce(
                    (data, byte) => data + String.fromCharCode(byte),
                    ""
                )
            );
            const dataUrl = `data:${imageFile.type};base64,${base64}`;

            // Create prediction
            const prediction = await this.createPrediction(
                "95fcc2a26d3899cd6c2691c900465aaeff466285a65c14638cc5f36f34befaf1",
                { image: dataUrl },
                apiKey
            );

            // Wait for completion
            const result = await this.waitForPrediction(prediction.id, apiKey);

            if (!result.output) {
                throw new Error("No output from background removal");
            }

            // Handle array output (some Replicate models return arrays)
            return Array.isArray(result.output) ? result.output[0] : result.output;
        } catch (error: any) {
            throw new Error(`Background removal failed: ${error.message || "Unknown error"}`);
        }
    }

    /**
     * Generate an image using FLUX img2img for image-to-image with text guidance
     * Uses bxclib2/flux_img2img which supports both image input and text prompts
     */
    static async generateImageFromReference(
        prompt: string,
        referenceImageUrl: string,
        apiKey: string,
        strength: number = 0.4,
        inferenceSteps: number = 50,
        negativePrompt?: string
    ): Promise<string> {
        if (!apiKey || apiKey.trim() === "") {
            throw new Error("Replicate API key is not configured.");
        }

        try {
            // Use FLUX img2img for image-to-image transformation with text guidance
            // Model: bxclib2/flux_img2img
            // Version: 0ce45202d83c6bd379dfe58f4c0c41e6cadf93ebbd9d938cc63cc0f2fcb729a5
            const inputParams: any = {
                image: referenceImageUrl,
                positive_prompt: prompt,
                steps: inferenceSteps,
                denoising: strength,
                seed: 0,  // 0 = random seed
                scheduler: "simple",
                sampler_name: "euler"
            };

            // Add negative prompt if provided
            if (negativePrompt && negativePrompt.trim() !== "") {
                inputParams.negative_prompt = negativePrompt;
                console.log("Added negative prompt to FLUX input");
            }

            console.log("Creating FLUX prediction with params:", {
                ...inputParams,
                image: inputParams.image.substring(0, 50) + "..."
            });

            const prediction = await this.createPrediction(
                "0ce45202d83c6bd379dfe58f4c0c41e6cadf93ebbd9d938cc63cc0f2fcb729a5",
                inputParams,
                apiKey
            );
            console.log("FLUX prediction created with ID:", prediction.id);

            // Wait for completion
            console.log("Waiting for FLUX to complete...");
            const result = await this.waitForPrediction(prediction.id, apiKey);
            console.log("FLUX completed with status:", result.status);

            if (!result.output || result.output.length === 0) {
                throw new Error("No image was generated by FLUX img2img");
            }

            return Array.isArray(result.output) ? result.output[0] : result.output;
        } catch (error: any) {
            if (error.message?.includes("401")) {
                throw new Error("Invalid Replicate API key. Please check your settings.");
            } else if (error.message?.includes("422")) {
                throw new Error("Invalid request to FLUX img2img API. The image format or parameters may be incorrect. Try enabling background removal or using a smaller image.");
            } else if (error.message?.includes("429")) {
                throw new Error("Replicate API rate limit exceeded. Please try again later.");
            } else {
                throw new Error(`FLUX img2img API error: ${error.message || "Unknown error"}`);
            }
        }
    }

    /**
     * Download image from URL and save to vault
     */
    static async saveImageToVault(
        imageUrl: string,
        vault: Vault,
        folderPath: string,
        monsterName: string
    ): Promise<string> {
        try {
            // Ensure folder exists
            const normalizedFolder = await this.ensureFolder(
                vault,
                folderPath
            );

            // Download image using Obsidian's requestUrl to bypass CORS
            const response = await requestUrl({
                url: imageUrl,
                method: "GET"
            });

            if (response.status !== 200) {
                throw new Error(`Failed to download image: ${response.status}`);
            }

            // Get the array buffer from the response
            const arrayBuffer = response.arrayBuffer;

            // Generate filename with timestamp to avoid conflicts
            const safeName = monsterName.replace(/[^a-z0-9]/gi, "_").toLowerCase();
            const timestamp = Date.now();
            const filename = `${safeName}_${timestamp}.png`;
            const filePath = normalizePath(`${normalizedFolder}/${filename}`);

            // Save to vault
            await vault.adapter.writeBinary(filePath, arrayBuffer);

            return filePath;
        } catch (error: any) {
            throw new Error(`Failed to save image to vault: ${error.message}`);
        }
    }

    /**
     * Compress and prepare an image for API upload
     * Resizes to 1024x1024 square to ensure compatibility with FLUX models
     * Note: Replicate recommends data URLs for files ≤256KB, HTTP URLs for larger files
     */
    private static async compressImage(
        file: File,
        maxSizeBytes: number = 256 * 1024,  // 256KB per Replicate API recommendations
        targetSize: number = 1024  // Standard size for FLUX models
    ): Promise<File> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);

            img.onload = async () => {
                try {
                    let currentQuality = 0.92;
                    let compressedFile: File | null = null;

                    while (currentQuality >= 0.6 && !compressedFile) {
                        const canvas = document.createElement("canvas");
                        // Use square dimensions for FLUX compatibility
                        canvas.width = targetSize;
                        canvas.height = targetSize;

                        const ctx = canvas.getContext("2d");
                        if (!ctx) {
                            throw new Error("Failed to get canvas context");
                        }

                        // Keep transparent background (don't fill with white)
                        // This allows FLUX to generate environmental backgrounds from prompts

                        // Calculate dimensions to fit image in square while preserving aspect ratio
                        const scale = Math.min(targetSize / img.width, targetSize / img.height);
                        const scaledWidth = img.width * scale;
                        const scaledHeight = img.height * scale;
                        const x = (targetSize - scaledWidth) / 2;
                        const y = (targetSize - scaledHeight) / 2;

                        // Draw image centered and scaled on transparent background
                        ctx.drawImage(img, x, y, scaledWidth, scaledHeight);

                        const blob = await new Promise<Blob>((resolveBlob, rejectBlob) => {
                            canvas.toBlob(
                                (blob) => {
                                    if (!blob) {
                                        rejectBlob(new Error("Failed to create blob"));
                                        return;
                                    }
                                    resolveBlob(blob);
                                },
                                "image/png",
                                currentQuality
                            );
                        });

                        if (blob.size <= maxSizeBytes) {
                            compressedFile = new File(
                                [blob],
                                file.name.replace(/\.[^.]+$/, ".png"),
                                { type: "image/png" }
                            );
                        }

                        currentQuality -= 0.1;
                    }

                    URL.revokeObjectURL(url);

                    if (!compressedFile) {
                        reject(
                            new Error(
                                "Unable to compress image below 256KB. Please try a smaller image or enable background removal."
                            )
                        );
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
                reject(new Error("Failed to load image file"));
            };

            img.src = url;
        });
    }

    /**
     * Download an image from URL, resize to 1024x1024 square, and return as data URL
     * Ensures compatibility with FLUX models by using standard square dimensions
     * Uses Obsidian's requestUrl to bypass CORS
     */
    private static async resizeImageFromUrl(imageUrl: string, targetSize: number = 1024): Promise<string> {
        return new Promise(async (resolve, reject) => {
            try {
                // Download image using Obsidian's requestUrl to bypass CORS
                const response = await requestUrl({
                    url: imageUrl,
                    method: "GET"
                });

                if (response.status !== 200) {
                    throw new Error(`Failed to download image: ${response.status}`);
                }

                // Convert array buffer to blob
                const blob = new Blob([response.arrayBuffer], { type: "image/png" });
                const objectUrl = URL.createObjectURL(blob);

                const img = new Image();

                img.onload = () => {
                    try {
                        const canvas = document.createElement("canvas");
                        // Use square dimensions for FLUX compatibility
                        canvas.width = targetSize;
                        canvas.height = targetSize;

                        const ctx = canvas.getContext("2d");
                        if (!ctx) {
                            URL.revokeObjectURL(objectUrl);
                            throw new Error("Failed to get canvas context");
                        }

                        // Keep transparent background (don't fill with white)
                        // This allows FLUX to generate environmental backgrounds from prompts

                        // Calculate dimensions to fit image in square while preserving aspect ratio
                        const scale = Math.min(targetSize / img.width, targetSize / img.height);
                        const scaledWidth = img.width * scale;
                        const scaledHeight = img.height * scale;
                        const x = (targetSize - scaledWidth) / 2;
                        const y = (targetSize - scaledHeight) / 2;

                        // Draw image centered and scaled on transparent background
                        ctx.drawImage(img, x, y, scaledWidth, scaledHeight);

                        // Convert to data URL
                        const dataUrl = canvas.toDataURL("image/png");
                        URL.revokeObjectURL(objectUrl);
                        resolve(dataUrl);
                    } catch (error) {
                        URL.revokeObjectURL(objectUrl);
                        reject(error);
                    }
                };

                img.onerror = () => {
                    URL.revokeObjectURL(objectUrl);
                    reject(new Error("Failed to load image from downloaded data"));
                };

                img.src = objectUrl;
            } catch (error: any) {
                reject(new Error(`Failed to download and resize image: ${error.message}`));
            }
        });
    }

    /**
     * Main function to generate monster image from reference photo
     * Multi-stage process: vision analysis → prompt engineering → text-to-image generation
     * Uses the photo only for analysis, generates fresh epic fantasy art
     */
    static async generateMonsterImageFromPhoto(
        monster: Partial<Monster>,
        vault: Vault,
        photo: File,
        options: ReplicateImageGenerationOptions
    ): Promise<string> {
        if (!photo) {
            throw new Error("No source photo was provided.");
        }

        if (!options.apiKey || options.apiKey.trim() === "") {
            throw new Error(
                "Replicate API key is not configured. Please add it in Fantasy Statblocks settings."
            );
        }

        const loadingNotice = new Notice("Generating AI image with FLUX...", 0);

        try {
            // Stage 1: Vision Analysis (if enabled)
            let visionAnalysis = null;
            if (options.enableVisionAnalysis && options.visionApiKey) {
                try {
                    loadingNotice.setMessage("Analyzing miniature photo with AI vision...");
                    visionAnalysis = await VisionAnalysisService.analyzeMinaturePhoto(
                        photo,
                        monster,
                        {
                            provider: options.visionProvider,
                            apiKey: options.visionApiKey
                        }
                    );
                    console.log("Vision analysis completed:", visionAnalysis);
                } catch (error: any) {
                    console.warn("Vision analysis failed, falling back to basic prompt:", error.message);
                    new Notice("Vision analysis failed, using basic prompt generation", 5000);
                }
            }

            // Stage 2: Prompt Engineering (if enabled)
            let finalPrompt: string;
            if (options.enablePromptEngineering && options.promptApiKey) {
                try {
                    loadingNotice.setMessage("Crafting optimized prompts with AI...");

                    // If vision analysis is available, use it; otherwise create basic analysis
                    const analysisForPrompt = visionAnalysis || {
                        description: this.generatePromptFromMonster(monster, options.style),
                        detectedFeatures: {}
                    };

                    const enhancedPrompt = await PromptEngineeringService.generateEnhancedPrompt(
                        analysisForPrompt,
                        monster,
                        {
                            provider: options.promptProvider,
                            apiKey: options.promptApiKey,
                            style: options.style,
                            imageModel: "flux"
                        }
                    );
                    console.log("Enhanced prompt generated:", enhancedPrompt);

                    // Use positive prompt (negative prompts not supported in text-to-image)
                    finalPrompt = enhancedPrompt.positivePrompt;
                } catch (error: any) {
                    console.warn("Prompt engineering failed, using fallback:", error.message);
                    new Notice("Prompt engineering failed, using enhanced fallback", 5000);

                    // Use enhanced fallback prompt
                    const description = visionAnalysis?.description || this.generatePromptFromMonster(monster, options.style);
                    const enhancedPrompt = PromptEngineeringService.createFallbackPrompt(
                        description,
                        options.style,
                        "flux"
                    );
                    finalPrompt = enhancedPrompt.positivePrompt;
                }
            } else {
                // Neither service enabled, use basic prompt
                const description = visionAnalysis?.description || this.generatePromptFromMonster(monster, options.style);
                finalPrompt = `${description}, epic fantasy character art, D&D book illustration, dramatic lighting, cinematic composition`;
            }

            // Stage 3: Generate epic fantasy art using FLUX text-to-image
            loadingNotice.setMessage("Generating epic fantasy art with FLUX...");
            console.log("Final prompt:", finalPrompt);

            // Create prediction using FLUX text-to-image
            const prediction = await this.createPrediction(
                "2d27e06ff0ee2494eb3ae8e3da0be637763f59bf6a488b32b2f89cd928c3faba",
                {
                    prompt: finalPrompt,
                    guidance: 3.5,
                    num_inference_steps: 25,
                    output_format: "png",
                    output_quality: 100,
                    num_outputs: 1
                },
                options.apiKey
            );

            loadingNotice.setMessage("Generating image (this may take 1-2 minutes)...");

            // Wait for completion
            const result = await this.waitForPrediction(prediction.id, options.apiKey);

            if (!result.output || result.output.length === 0) {
                throw new Error("No image was generated by FLUX");
            }

            const imageUrl = Array.isArray(result.output) ? result.output[0] : result.output;
            console.log("FLUX returned image URL:", imageUrl);

            // Save to vault
            loadingNotice.setMessage("Saving image to vault...");
            const vaultPath = await this.saveImageToVault(
                imageUrl,
                vault,
                options.saveFolder,
                monster.name || "creature"
            );
            console.log("Image saved to vault at:", vaultPath);

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
     * Generate image from scratch (text-to-image) using FLUX
     */
    static async generateMonsterImage(
        monster: Partial<Monster>,
        vault: Vault,
        options: ReplicateImageGenerationOptions
    ): Promise<string> {
        const loadingNotice = new Notice("Generating AI image with FLUX...", 0);

        try {
            const prompt = this.generatePromptFromMonster(monster, options.style);
            console.log("Generated FLUX prompt:", prompt);

            loadingNotice.setMessage("Requesting image from FLUX...");

            // Create prediction
            const prediction = await this.createPrediction(
                "2d27e06ff0ee2494eb3ae8e3da0be637763f59bf6a488b32b2f89cd928c3faba",
                {
                    prompt: prompt,
                    guidance: 3.5,
                    num_inference_steps: options.inferenceSteps,
                    output_format: "png",
                    output_quality: 100,
                    num_outputs: 1
                },
                options.apiKey
            );

            loadingNotice.setMessage("Generating image (this may take up to 60 seconds)...");

            // Wait for completion
            const result = await this.waitForPrediction(prediction.id, options.apiKey);

            if (!result.output || result.output.length === 0) {
                throw new Error("No image was generated by FLUX");
            }

            const imageUrl = Array.isArray(result.output) ? result.output[0] : result.output;

            // Save to vault
            loadingNotice.setMessage("Saving image to vault...");
            const vaultPath = await this.saveImageToVault(
                imageUrl,
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
}
