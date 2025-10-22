import { requestUrl } from "obsidian";
import type { Monster } from "index";

/**
 * Vision Analysis Service
 * Analyzes miniature photos using vision models (GPT-4V or Claude Vision)
 * to generate detailed descriptions for better image generation
 */

export interface VisionAnalysisResult {
    description: string;
    detectedFeatures: {
        pose?: string;
        equipment?: string[];
        colors?: string[];
        distinctiveFeatures?: string[];
        composition?: string;
    };
}

export type VisionProvider = "gpt4v" | "claude";

export interface VisionAnalysisOptions {
    provider: VisionProvider;
    apiKey: string;
}

export class VisionAnalysisService {
    /**
     * Analyze a miniature photo to extract visual details
     */
    static async analyzeMinaturePhoto(
        photo: File,
        monster: Partial<Monster>,
        options: VisionAnalysisOptions
    ): Promise<VisionAnalysisResult> {
        // Convert image to base64
        const base64Image = await this.fileToBase64(photo);

        // Build analysis prompt
        const prompt = this.buildAnalysisPrompt(monster);

        // Call appropriate vision API
        switch (options.provider) {
            case "gpt4v":
                return await this.analyzeWithGPT4V(base64Image, prompt, options.apiKey);
            case "claude":
                return await this.analyzeWithClaude(base64Image, prompt, options.apiKey);
            default:
                throw new Error(`Unsupported vision provider: ${options.provider}`);
        }
    }

    /**
     * Convert File to base64 data URL
     */
    private static async fileToBase64(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                resolve(result);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    /**
     * Build the analysis prompt with context from Monster data
     */
    private static buildAnalysisPrompt(monster: Partial<Monster>): string {
        const context: string[] = [];

        if (monster.name) {
            context.push(`This is a miniature representing: ${monster.name}`);
        }
        if (monster.type) {
            context.push(`Creature type: ${monster.type}`);
        }
        if (monster.size) {
            context.push(`Size: ${monster.size}`);
        }

        const contextStr = context.length > 0 ? context.join(". ") + ".\n\n" : "";

        return `${contextStr}Analyze this tabletop gaming miniature photo and provide a detailed description focusing on:

1. **Pose & Stance**: Describe the miniature's pose, body position, and action (standing, attacking, casting, etc.)
2. **Equipment & Gear**: List all visible weapons, armor, accessories, and items
3. **Colors & Materials**: Identify the primary colors used in the paint job (armor, clothing, skin, hair, etc.)
4. **Distinctive Features**: Note any unique or notable visual elements (scars, patterns, symbols, facial features, etc.)
5. **Composition**: Describe the base, background elements, and overall presentation

Be specific and detailed - this description will be used to generate a life-like fantasy character portrait that maintains the miniature's appearance.

Provide your response in the following JSON format:
{
    "description": "A comprehensive paragraph describing the miniature",
    "detectedFeatures": {
        "pose": "brief pose description",
        "equipment": ["item1", "item2", ...],
        "colors": ["color1", "color2", ...],
        "distinctiveFeatures": ["feature1", "feature2", ...],
        "composition": "base and background description"
    }
}`;
    }

    /**
     * Analyze with GPT-4 Vision
     */
    private static async analyzeWithGPT4V(
        base64Image: string,
        prompt: string,
        apiKey: string
    ): Promise<VisionAnalysisResult> {
        try {
            const response = await requestUrl({
                url: "https://api.openai.com/v1/chat/completions",
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "gpt-4o",
                    messages: [
                        {
                            role: "user",
                            content: [
                                {
                                    type: "text",
                                    text: prompt
                                },
                                {
                                    type: "image_url",
                                    image_url: {
                                        url: base64Image,
                                        detail: "high"
                                    }
                                }
                            ]
                        }
                    ],
                    max_tokens: 1000,
                    temperature: 0.7
                })
            });

            if (response.status !== 200) {
                throw new Error(`GPT-4V API error: ${response.status}`);
            }

            const data = response.json;
            const content = data.choices[0]?.message?.content;

            if (!content) {
                throw new Error("No content returned from GPT-4V");
            }

            // Parse JSON response
            return this.parseVisionResponse(content);
        } catch (error: any) {
            if (error.message?.includes("401")) {
                throw new Error("Invalid OpenAI API key for GPT-4V");
            } else if (error.message?.includes("429")) {
                throw new Error("OpenAI API rate limit exceeded");
            }
            throw new Error(`GPT-4V analysis failed: ${error.message || "Unknown error"}`);
        }
    }

    /**
     * Analyze with Claude Vision
     */
    private static async analyzeWithClaude(
        base64Image: string,
        prompt: string,
        apiKey: string
    ): Promise<VisionAnalysisResult> {
        try {
            // Extract base64 data and media type from data URL
            const matches = base64Image.match(/^data:([^;]+);base64,(.+)$/);
            if (!matches) {
                throw new Error("Invalid image data URL format");
            }

            const mediaType = matches[1];
            const base64Data = matches[2];

            const response = await requestUrl({
                url: "https://api.anthropic.com/v1/messages",
                method: "POST",
                headers: {
                    "x-api-key": apiKey,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "claude-3-5-sonnet-20241022",
                    max_tokens: 1000,
                    messages: [
                        {
                            role: "user",
                            content: [
                                {
                                    type: "image",
                                    source: {
                                        type: "base64",
                                        media_type: mediaType,
                                        data: base64Data
                                    }
                                },
                                {
                                    type: "text",
                                    text: prompt
                                }
                            ]
                        }
                    ]
                })
            });

            if (response.status !== 200) {
                throw new Error(`Claude API error: ${response.status}`);
            }

            const data = response.json;
            const content = data.content[0]?.text;

            if (!content) {
                throw new Error("No content returned from Claude");
            }

            // Parse JSON response
            return this.parseVisionResponse(content);
        } catch (error: any) {
            if (error.message?.includes("401")) {
                throw new Error("Invalid Anthropic API key for Claude");
            } else if (error.message?.includes("429")) {
                throw new Error("Anthropic API rate limit exceeded");
            }
            throw new Error(`Claude analysis failed: ${error.message || "Unknown error"}`);
        }
    }

    /**
     * Parse the JSON response from vision models
     */
    private static parseVisionResponse(content: string): VisionAnalysisResult {
        try {
            // Try to extract JSON from markdown code blocks if present
            const jsonMatch = content.match(/```json\s*(\{[\s\S]*\})\s*```/) ||
                            content.match(/(\{[\s\S]*\})/);

            if (!jsonMatch) {
                // Fallback: use raw content as description
                return {
                    description: content.trim(),
                    detectedFeatures: {}
                };
            }

            const parsed = JSON.parse(jsonMatch[1]);

            return {
                description: parsed.description || content,
                detectedFeatures: parsed.detectedFeatures || {}
            };
        } catch (error) {
            // If JSON parsing fails, use raw content
            return {
                description: content.trim(),
                detectedFeatures: {}
            };
        }
    }

    /**
     * Merge vision analysis with monster data for context
     */
    static mergeWithMonsterContext(
        visionResult: VisionAnalysisResult,
        monster: Partial<Monster>
    ): string {
        const parts: string[] = [];

        // Start with vision description
        parts.push(visionResult.description);

        // Add monster context that might not be visible in photo
        if (monster.name && !visionResult.description.toLowerCase().includes(monster.name.toLowerCase())) {
            parts.push(`Character name: ${monster.name}`);
        }

        // Add lore/description if available
        if (monster.description) {
            parts.push(`Background: ${monster.description}`);
        }

        // Add alignment for character personality hints
        if (monster.alignment && monster.alignment !== "unaligned") {
            const alignmentDescriptors: Record<string, string> = {
                "lawful good": "noble and virtuous nature",
                "neutral good": "kind and benevolent nature",
                "chaotic good": "free-spirited and heroic nature",
                "lawful neutral": "orderly and disciplined nature",
                "neutral": "balanced nature",
                "chaotic neutral": "unpredictable and wild nature",
                "lawful evil": "tyrannical and cruel nature",
                "neutral evil": "malicious and selfish nature",
                "chaotic evil": "destructive and malevolent nature"
            };
            const descriptor = alignmentDescriptors[monster.alignment.toLowerCase()];
            if (descriptor) {
                parts.push(`Character has a ${descriptor}`);
            }
        }

        return parts.join(". ");
    }
}
