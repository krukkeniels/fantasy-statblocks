import { requestUrl } from "obsidian";
import type { Monster } from "index";

/**
 * Prompt Engineering Service
 * Generates optimized prompts for image generation models
 * using GPT to craft high-quality descriptions
 */

export interface EnhancedPrompt {
    positivePrompt: string;
    negativePrompt: string;
    metadata?: {
        emphasizedFeatures?: string[];
        styleKeywords?: string[];
    };
}

export interface PromptEngineeringOptions {
    apiKey: string;
    style: string;
}

export interface MonsterDescription {
    description: string;
    detectedFeatures?: {
        pose?: string;
        equipment?: string[];
        colors?: string[];
        distinctiveFeatures?: string[];
        composition?: string;
    };
}

export class PromptEngineeringService {
    /**
     * Generate an enhanced prompt from monster data using GPT
     */
    static async generateEnhancedPrompt(
        monsterDescription: MonsterDescription,
        monster: Partial<Monster>,
        options: PromptEngineeringOptions
    ): Promise<EnhancedPrompt> {
        const systemPrompt = this.buildSystemPrompt();
        const userPrompt = this.buildUserPrompt(monsterDescription, monster, options.style);
        return await this.generateWithGPT(systemPrompt, userPrompt, options.apiKey);
    }

    /**
     * Build system prompt for GPT
     */
    private static buildSystemPrompt(): string {
        return `You are an expert prompt engineer specializing in transforming tabletop miniature descriptions into epic fantasy character artwork.

Your goal: Create optimized prompts that will transform a TINY PAINTED MINIATURE into EPIC FANTASY CHARACTER ARTWORK showing a full-sized character/creature, while maintaining the miniature's recognizable features (pose, equipment, colors, distinctive elements).

CRITICAL: The output should be professional fantasy artwork (like D&D book illustrations or concept art), NOT a photograph of a miniature or toy.

The image will be generated with OpenAI's gpt-image-1 model, which excels at:
- Following complex, detailed instructions precisely
- Dramatic fantasy illustration with painterly quality
- Detailed fantasy materials (ornate armor, magical effects, weathered textures)
- Cinematic composition with heroic character poses
- Professional TTRPG artwork aesthetic (like D&D sourcebooks)

You must provide TWO prompts:
1. **Positive Prompt**: Describes what should be in the image (epic fantasy character art in the user's chosen style)
2. **Negative Prompt**: Describes what should NOT be in the image (AGGRESSIVELY exclude all miniature/toy artifacts)

Key principles:
- **SCALE TRANSFORMATION**: Transform from tiny tabletop miniature to FULL-SIZED character
- **ART STYLE**: Output must be rendered entirely in the user's specified art style
- Preserve the miniature's POSE and COMPOSITION
- Keep EQUIPMENT and GEAR recognizable with appropriate textures for the art style
- Maintain COLOR SCHEME from the mini's paint job
- Place character in fantasy environment appropriate to the art style (not on a base, not on a table)
- Add dramatic lighting and atmosphere suitable for the art style
- Add epic composition and environmental context
- COMPLETELY REMOVE all toy/miniature artifacts:
  * NO plastic base, platform, or stand
  * NO toy-like appearance
  * NO painted plastic texture
  * NO small scale appearance
  * NO visible mold lines or miniature imperfections

Respond in this JSON format:
{
    "positivePrompt": "detailed positive prompt here",
    "negativePrompt": "negative prompt here",
    "metadata": {
        "emphasizedFeatures": ["feature1", "feature2"],
        "styleKeywords": ["keyword1", "keyword2"]
    }
}`;
    }

    /**
     * Build user prompt with monster description and context
     */
    private static buildUserPrompt(
        monsterDescription: MonsterDescription,
        monster: Partial<Monster>,
        style: string
    ): string {
        const parts: string[] = [];

        // Monster description
        parts.push("## Miniature Analysis");
        parts.push(monsterDescription.description);

        // Detected features
        const features = monsterDescription.detectedFeatures;
        if (features && Object.keys(features).length > 0) {
            parts.push("\n## Detected Features:");

            if (features.pose) {
                parts.push(`- Pose: ${features.pose}`);
            }
            if (features.equipment && features.equipment.length > 0) {
                parts.push(`- Equipment: ${features.equipment.join(", ")}`);
            }
            if (features.colors && features.colors.length > 0) {
                parts.push(`- Colors: ${features.colors.join(", ")}`);
            }
            if (features.distinctiveFeatures && features.distinctiveFeatures.length > 0) {
                parts.push(`- Distinctive Features: ${features.distinctiveFeatures.join(", ")}`);
            }
            if (features.composition) {
                parts.push(`- Composition: ${features.composition}`);
            }
        }

        // Monster context
        parts.push("\n## Character Context:");
        if (monster.name) {
            parts.push(`- Name: ${monster.name}`);
        }
        if (monster.type) {
            parts.push(`- Type: ${monster.type}`);
        }
        if (monster.size) {
            parts.push(`- Size: ${monster.size}`);
        }
        if (monster.description) {
            parts.push(`- Background: ${monster.description}`);
        }
        if (monster.alignment) {
            parts.push(`- Alignment: ${monster.alignment}`);
        }

        // Style guidance - fixed to epic fantasy illustration
        parts.push("\n## Desired Style: Epic Fantasy Illustration (D&D Book Art / Concept Art)");

        parts.push("\n## Task:");
        parts.push("Transform this MINIATURE into EPIC FANTASY CHARACTER ILLUSTRATION that:");
        parts.push("1. Shows a FULL-SIZED character/creature in professional fantasy artwork (NOT a photo of a miniature)");
        parts.push("2. Maintains the miniature's pose, equipment, and color scheme");
        parts.push("3. Completely removes ALL toy/miniature artifacts:");
        parts.push("   - Remove plastic base, stand, or platform");
        parts.push("   - Remove toy-like features");
        parts.push("   - Remove painted plastic texture");
        parts.push("   - Remove small-scale appearance");
        parts.push("4. Rendered in epic fantasy illustration style with dramatic details:");
        parts.push("   - Painterly fantasy materials (ornate metal armor, leather gear, flowing cloth)");
        parts.push("   - D&D book art aesthetic with rich visual details");
        parts.push("   - Dramatic cinematic lighting with fantasy ambiance");
        parts.push("   - Atmospheric fantasy effects (magical glow, mist, dust, shadows)");
        parts.push("5. Places character in rich fantasy environment:");
        parts.push("   - Epic fantasy terrain (ancient ruins, mystical forests, dungeons, battlefields)");
        parts.push("   - Atmospheric background with depth and mood");
        parts.push("   - Environmental storytelling elements");
        parts.push("6. Must look like professional TTRPG character artwork - this is the PRIMARY directive");

        return parts.join("\n");
    }

    /**
     * Generate prompt using GPT
     */
    private static async generateWithGPT(
        systemPrompt: string,
        userPrompt: string,
        apiKey: string
    ): Promise<EnhancedPrompt> {
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
                            role: "system",
                            content: systemPrompt
                        },
                        {
                            role: "user",
                            content: userPrompt
                        }
                    ],
                    max_tokens: 1500,
                    temperature: 0.8,
                    response_format: { type: "json_object" }
                })
            });

            if (response.status !== 200) {
                throw new Error(`GPT-4 API error: ${response.status}`);
            }

            const data = response.json;
            const content = data.choices[0]?.message?.content;

            if (!content) {
                throw new Error("No content returned from GPT-4");
            }

            return this.parsePromptResponse(content);
        } catch (error: any) {
            if (error.message?.includes("401")) {
                throw new Error("Invalid OpenAI API key for GPT-4");
            } else if (error.message?.includes("429")) {
                throw new Error("OpenAI API rate limit exceeded");
            }
            throw new Error(`GPT-4 prompt generation failed: ${error.message || "Unknown error"}`);
        }
    }

    /**
     * Parse the JSON response from LLMs
     */
    private static parsePromptResponse(content: string): EnhancedPrompt {
        try {
            // Try to extract JSON from markdown code blocks if present
            const jsonMatch = content.match(/```json\s*(\{[\s\S]*\})\s*```/) ||
                            content.match(/(\{[\s\S]*\})/);

            if (!jsonMatch) {
                throw new Error("No JSON found in response");
            }

            const parsed = JSON.parse(jsonMatch[1]);

            return {
                positivePrompt: parsed.positivePrompt || "",
                negativePrompt: parsed.negativePrompt || "",
                metadata: parsed.metadata || {}
            };
        } catch (error) {
            throw new Error(`Failed to parse prompt response: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    }

    /**
     * Create a fallback enhanced prompt without using LLM
     * Used when prompt engineering is disabled or fails
     */
    static createFallbackPrompt(
        description: string,
        style: string
    ): EnhancedPrompt {
        const positivePrompt = `Epic fantasy character illustration: ${description}.
FULL-SIZED character in professional fantasy artwork, D&D book illustration style.
Dramatic fantasy illustration with painterly quality, epic composition, cinematic lighting.
Detailed fantasy materials: ornate metal armor, weathered leather gear, flowing cloth, magical effects.
Atmospheric lighting with fantasy ambiance (torchlight, magical glow, dramatic shadows).
Rich fantasy environment with depth: ancient ruins, mystical forests, epic dungeons, dramatic battlefields.
Character in heroic pose on fantasy terrain, detailed atmospheric background.
Professional TTRPG character art quality, dynamic composition, concept art aesthetic`;

        const negativePrompt = "miniature, toy, plastic, figurine, model, gaming piece, tabletop, painted miniature, small scale, tiny, toy-like, plastic base, platform, stand, simplified features, low quality, blurry, amateur, deformed, disfigured, bad anatomy, worst quality, low res, flat painting, plastic texture";

        return {
            positivePrompt,
            negativePrompt,
            metadata: {
                emphasizedFeatures: ["life-size scale", "epic fantasy illustration", "D&D book art aesthetic", "dramatic composition"],
                styleKeywords: ["epic fantasy art", "D&D illustration", "concept art", "professional TTRPG artwork"]
            }
        };
    }
}
