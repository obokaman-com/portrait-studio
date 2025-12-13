
import { GoogleGenAI, Part, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { UploadedPhoto, CharacterDetail } from '../types';
import { resizeImageToBase64 } from "../utils/fileUtils";

// Helper to get a fresh AI instance with the current API key
const getAI = () => {
  if (!process.env.API_KEY) {
     throw new Error("API_KEY environment variable is not set. Please select an API key.");
  }
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
}

// Helper to clean up raw API errors into human-readable messages
const cleanError = (error: any): Error => {
  let msg = error instanceof Error ? error.message : String(error);

  // 1. Handle "RESOURCE_EXHAUSTED" / 429 (Quota Limits)
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429') || msg.includes('quota')) {
     return new Error(
       "Quota Exceeded (429).\n" +
       "You have reached the request limit for your API key or Google Cloud Project.\n\n" +
       "• Check your Billing status in Google Cloud Console.\n" +
       "• You may have hit the free tier limits (RPM/TPM).\n" +
       "• Wait a few minutes before trying again."
     );
  }

  // 2. Handle Service Overloaded / 503
  if (msg.includes('503') || msg.includes('Overloaded')) {
      return new Error(
          "Service Overloaded (503).\n" +
          "Gemini is currently experiencing high traffic. Please wait a moment and try again."
      );
  }

  // 3. Handle raw JSON dumps (common with SDK errors)
  if (msg.trim().startsWith('{')) {
      try {
         const parsed = JSON.parse(msg);
         if (parsed.error) {
             const innerMsg = parsed.error.message || JSON.stringify(parsed.error);
             if (parsed.error.code === 429 || parsed.error.status === 'RESOURCE_EXHAUSTED') {
                 return cleanError(new Error("RESOURCE_EXHAUSTED"));
             }
             if (innerMsg.includes('safety')) {
                 return new Error("Blocked by Safety Filters.\nThe content was flagged by safety settings.");
             }
             return new Error(`API Error: ${innerMsg}`);
         }
      } catch (e) {
         // Fallback
      }
  }

  return new Error(msg);
}

export async function generateSinglePortrait(imageParts: Part[], prompt: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) {
    throw new Error("Cancelled");
  }

  const ai = getAI();
  const textPart = { text: prompt };

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview', // KEEPING PRO FOR IMAGE GENERATION QUALITY
      contents: {
        parts: [...imageParts, textPart],
      },
      config: {
        imageConfig: {
          aspectRatio: "3:4", // Optimized for portraits (taller)
          imageSize: "1K", // Gemini 3 Pro supports high res
        },
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
        ],
      },
    });

    if (signal?.aborted) {
      throw new Error("Cancelled");
    }

    const candidate = response.candidates?.[0];

    // Check Block Reasons
    if (response.promptFeedback?.blockReason) {
       throw new Error(`Request Blocked (${response.promptFeedback.blockReason}).\nSafety filters blocked this request.`);
    }

    if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
        const reason = candidate.finishReason;
        let friendlyMsg = `Generation Failed (${reason})`;

        if (reason === 'SAFETY') friendlyMsg = "Blocked by Safety Filters (Content Policy).";
        else if (reason === 'RECITATION') friendlyMsg = "Blocked by Copyright.";
        else if (reason === 'IMAGE_OTHER' || reason === 'OTHER') {
            friendlyMsg = "Policy Restriction.\nThe model refused to generate this specific image. This often happens with real person likenesses (deepfake protection) or child safety filters. Try changing the prompt slightly.";
        }

        throw new Error(friendlyMsg);
    }

    // Extract Image
    const parts = candidate?.content?.parts;
    if (!parts || !Array.isArray(parts) || parts.length === 0) {
      throw new Error("Empty response from model.");
    }
    
    for (const part of parts) {
      if (part.inlineData) {
          return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }

    const textResponse = response.text;
    if (textResponse) {
      throw new Error(`No image generated. Message: "${textResponse.trim()}"`);
    }

    throw new Error("Failed to extract image data.");

  } catch (error: any) {
    if (signal?.aborted) throw new Error("Cancelled");
    throw cleanError(error);
  }
}

export async function analyzePhotoForCharacters(imagePart: Part, fileName: string): Promise<Omit<CharacterDetail, 'id' | 'isDescriptionLoading'>[]> {
  const ai = getAI();
  
  // OPTIMIZATION: Use Flash for analysis. It's faster, cheaper, and excellent at description.
  const prompt = `Act as a casting director. Analyze this photo to identify every distinct person.
  Create a concise but VISUALLY PRECISE description for a text-to-image generator.
  
  CRITICAL INSTRUCTIONS:
  1. DO NOT name celebrities. Focus strictly on physical facial geometry and distinctive features.
  2. Capture IMPERFECTIONS: Mention things like "freckles", "slight asymmetry", "weathered skin", or "messy hair". This adds realism.
  3. Describe clothing textures (e.g., "ribbed cotton", "worn leather").
  4. Ignore background. Focus on the Subject.
  
  Output JSON array with 'name' (generic) and 'description'.`;

  try {
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash', // Switched to Flash for cost/speed
        contents: {
        parts: [imagePart, { text: prompt }],
        },
        config: {
        responseMimeType: 'application/json',
        responseSchema: {
            type: Type.ARRAY,
            items: {
            type: Type.OBJECT,
            properties: {
                name: { type: Type.STRING },
                description: { type: Type.STRING }
            },
            required: ['name', 'description']
            }
        }
        }
    });

    const parsed = JSON.parse(response.text.trim());
    return (Array.isArray(parsed) && parsed.length > 0) ? parsed : [{ name: 'Subject 1', description: 'Analysis unclear.' }];
  } catch (e: any) {
    console.error("Analysis failed:", e);
    if (String(e).includes('429')) throw cleanError(e);
    return [{ name: 'Subject 1', description: 'AI analysis failed.' }];
  }
}

export async function optimizePrompt(userPrompt: string): Promise<string> {
   const ai = getAI();
   try {
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash', // Switched to Flash
        contents: `Act as a Director of Photography for a high-budget film. Rewrite the user's scene description into a "Cinematography Brief".
        
        Style Guide:
        - Use terminology like "Kodak Portra 400", "Arri Alexa", "85mm prime lens", "f/1.8", "soft volumetric lighting".
        - Emphasize TEXTURE: "film grain", "sharp focus on eyes", "atmospheric depth".
        - Avoid generic words like "beautiful" or "cool". Be technical and sensory.
        
        CRITICAL OUTPUT RULE: 
        - Output ONLY the rewritten brief text. 
        - Do NOT write "Here is the brief" or "Certainly". 
        - Just return the description.
        
        User Input: "${userPrompt}"`,
      });
      return response.text.trim();
   } catch (error) {
       throw cleanError(error);
   }
}

export async function generateRandomScenePrompt(): Promise<string> {
    const ai = getAI();
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash', // Switched to Flash
            contents: `Generate a short, evocative description for a portrait setting.
            Focus on lighting and mood (e.g., "Golden hour in a dusty library", "Neon noir rain", "Studio chiaroscuro").
            Do not mention people. Just the scene.
            
            OUTPUT RULE: Return ONLY the scene description text. No chatter.`,
        });
        return response.text.trim();
    } catch (error) {
        throw cleanError(error);
    }
}

export async function generateDynamicScenario(theme: string, numCharacters: number): Promise<string> {
    const ai = getAI();
    const countStr = numCharacters === 1 ? "a solo portrait" : `a group photo of ${numCharacters} people`;
    
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash', // Switched to Flash
            contents: `Act as a Bold Creative Director. Write a highly detailed image generation prompt for ${countStr} based on the request: "${theme}".

            CRITICAL INSTRUCTIONS FOR SPECIFICITY:
            1. BE BOLD AND SPECIFIC. Do NOT use generic terms like "a sci-fi movie" or "a magazine cover".
            2. USE REAL NAMES AND REFERENCES for context (not for the people, but for the world/setting).
               
               - MOVIE SET: Pick a SPECIFIC FILM (e.g. "On the set of Star Wars: A New Hope", "Filming the lobby scene in The Grand Budapest Hotel", "On the deck of the Pearl in Pirates of the Caribbean").
               - TIME TRAVEL: Pick a SPECIFIC HISTORICAL MOMENT (e.g. "Woodstock 1969 Crowd", "Signing the Declaration of Independence", "Victory Day in Times Square 1945", "The Court of Louis XIV").
               - POP CULTURE: Pick a SPECIFIC SHOW/GAME (e.g. "Sitting on the Iron Throne in Game of Thrones", "In the Central Perk coffee shop from Friends", "Wearing Vault 101 suits from Fallout").
               - MAGAZINE COVER: Pick a SPECIFIC MAGAZINE BRAND and describe its iconic layout. (e.g. "TIME Person of the Year with the red border", "National Geographic Portrait with yellow border", "Vogue September Issue Cover", "Rolling Stone Rock Star Cover").
               - COSPLAY: Pick a SPECIFIC FRANCHISE (e.g. "Dressed as members of the Justice League", "Cosplaying as Mario Kart characters", "Dressed as Hogwarts students").
               - IMPOSSIBLE: Pick a SPECIFIC SURREAL CONCEPT (e.g. "Having a tea party on the ceiling", "Inside a giant lava lamp", "Picnic on the rings of Saturn").
               - FINE ART: Pick a SPECIFIC MASTERPIECE style (e.g. "Inside Van Gogh's Starry Night", "Posed like American Gothic", "In the style of a Renaissance oil painting").
               - ALBUM COVER: Pick a SPECIFIC ICONIC ALBUM (e.g. "Walking across Abbey Road like The Beatles", "In the swimming pool from Nirvana's Nevermind", "Queen II Bohemian Rhapsody shadowy pose").

            3. NPCs/CAMEOS: If the scene implies interaction, include the famous characters (NPCs) in the description.
            4. DETAILS: Describe the specific costumes, props, and lighting.
            
            OUTPUT FORMAT RULES:
            - Return ONLY the final prompt description.
            - Do NOT include conversational filler like "Here is your prompt", "Alright", "Sure".
            - Do NOT use markdown bolding for the whole text.
            
            Desired Output Format:
            "[Context/Location/Brand], [Specific Action/Interaction], [Costume Details], [Lighting/Camera style]."
            
            Keep it under 60 words.`,
        });
        return response.text.trim();
    } catch (error) {
        throw cleanError(error);
    }
}

export async function constructPromptPayload(
  photos: UploadedPhoto[],
  scenePrompt: string
): Promise<{ imageParts: Part[], fullPrompt: string }> {

  // OPTIMIZATION: Resize images before creating parts.
  const imageParts: Part[] = await Promise.all(photos.map(async photo => {
    // We utilize the optimized resizing function here
    const base64WithPrefix = await resizeImageToBase64(photo.file, 1536);
    
    // Remove "data:image/xyz;base64," prefix for the API
    const base64Data = base64WithPrefix.split(',')[1];
    
    return {
      inlineData: {
        mimeType: photo.file.type,
        data: base64Data,
      }
    }
  }));

  const allCharacters = photos.flatMap((photo, photoIndex) => 
    photo.characters.map(char => ({ ...char, photoIndex }))
  );

  const inputAssets = photos.map((photo, index) =>
    `[REF_IMG_${index + 1}]`
  ).join(' ');

  const characterManifest = allCharacters.map(char => 
    `Subject (${char.name}) ID_REF_IMG_${char.photoIndex + 1}: ${char.description}`
  ).join('\n');

  // MASTER PROMPT FOR REALISM
  // We force "Raw Photo" aesthetics to avoid the "AI plastic" look.
  const fullPrompt = `
  **Medium:** Raw Analog Photography, 8k Resolution, highly detailed.
  **Camera:** Shot on Fujifilm GFX 100S, 85mm f/1.2 lens.
  **Quality:** Masterpiece, skin texture, subsurface scattering, natural pores, realistic eyes, cinematic lighting, soft shadows.
  **Negative Prompt:** (plastic skin, cgi, 3d render, cartoon, smoothing, blurry, distorted).
  
  **Scene Description:**
  ${scenePrompt}

  **Subjects & References:**
  (Ensure precise anatomical consistency with the reference images provided, specifically facial structure, skin texture, and key landmarks.)
  ${characterManifest}
  
  **Composition:**
  Group portrait, distinct separation, depth of field background, eye contact.
  `;

  return { imageParts, fullPrompt };
}
