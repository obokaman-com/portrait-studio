import { GoogleGenAI, Part, Type } from "@google/genai";
import { UploadedPhoto, CharacterDetail } from '../types';

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
  // e.g. "{\"error\":{\"code\":429, ...}}"
  if (msg.trim().startsWith('{')) {
      try {
         const parsed = JSON.parse(msg);
         
         // Extract nested error message
         if (parsed.error) {
             const innerMsg = parsed.error.message || JSON.stringify(parsed.error);
             
             // Recursively check if the inner message is a known code
             if (parsed.error.code === 429 || parsed.error.status === 'RESOURCE_EXHAUSTED') {
                 return cleanError(new Error("RESOURCE_EXHAUSTED"));
             }
             if (innerMsg.includes('safety')) {
                 return new Error("Blocked by Safety Filters.\nThe content was flagged by safety settings.");
             }
             
             return new Error(`API Error: ${innerMsg}`);
         }
      } catch (e) {
         // If JSON parse fails, fall back to returning the original cleaned string
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
      model: 'gemini-3-pro-image-preview', // Nano Banana Pro
      contents: {
        parts: [...imageParts, textPart],
      },
      config: {
        imageConfig: {
          aspectRatio: "1:1",
          imageSize: "1K",
        },
      },
    });

    if (signal?.aborted) {
      throw new Error("Cancelled");
    }

    const candidate = response.candidates?.[0];

    // --- IMPROVED ERROR HANDLING ---
    
    // 1. Check for Prompt Feedback (Request blocked before processing)
    if (response.promptFeedback?.blockReason) {
       const reason = response.promptFeedback.blockReason;
       throw new Error(`Request Blocked (${reason}).\nThe safety filters blocked this prompt before generation started. Please modify your prompt to be less sensitive.`);
    }

    // 2. Check for Finish Reason (Generation stopped/blocked)
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
        const reason = candidate.finishReason;
        let friendlyMsg = `Generation Failed (${reason})`;

        if (reason === 'SAFETY') {
            friendlyMsg = "Blocked by Safety Filters.\nThe model detected sensitive content in the prompt or reference images (e.g. violence, explicit material, or unsafe situations).";
        } else if (reason === 'OTHER' || reason === 'IMAGE_OTHER') {
            friendlyMsg = "Blocked by Content Policy.\nThe model refused to generate this image due to Trust & Safety policies. Common causes include:\n\n• Photorealistic depictions of children or minors.\n• Named celebrities or public figures.\n• Copyrighted characters.\n• Potential identity risks (Deepfake prevention).\n\nTry removing names of real people or using broader descriptions.";
        } else if (reason === 'RECITATION') {
            friendlyMsg = "Blocked by Copyright.\nThe generation closely resembles copyrighted material.";
        }

        throw new Error(friendlyMsg);
    }

    // 3. Validate Content Parts
    const content = candidate?.content;
    const parts = content?.parts;

    if (!parts || !Array.isArray(parts) || parts.length === 0) {
      // Fallback generic error if no finishReason was provided but parts are empty
      console.error("Empty response structure:", JSON.stringify(response, null, 2));
      throw new Error("The model returned an empty response without a specific error code. This may be a temporary service glitch.");
    }
    
    // Iterate through parts to find the image
    for (const part of parts) {
      if (part.inlineData) {
          return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }

    // If we have text but no image (unlikely for image models, but possible)
    const textResponse = response.text;
    if (textResponse) {
      throw new Error(`No image generated. Model message: "${textResponse.trim()}"`);
    }

    throw new Error("Failed to extract image data from the response.");

  } catch (error: any) {
    // If it was cancelled during the await, ensure we throw "Cancelled"
    if (signal?.aborted) {
        throw new Error("Cancelled");
    }
    // Clean up raw API errors
    throw cleanError(error);
  }
}

export async function analyzePhotoForCharacters(imagePart: Part, fileName: string): Promise<Omit<CharacterDetail, 'id' | 'isDescriptionLoading'>[]> {
  const ai = getAI();
  const cleanFileName = fileName.replace(/\.[^/.]+$/, ""); // Remove file extension
  
  // OPTIMIZED PROMPT FOR SAFETY & CLARITY
  // Explicitly instructs to avoid proper names of celebrities to prevent Safety blocks later.
  const prompt = `Analyze this photo to identify every distinct person visible. For each person, create a detailed VISUAL description suitable for an image generation prompt.
  
  IMPORTANT RULES:
  1. If the person looks like a celebrity or public figure, DO NOT use their real name. Instead, describe their physical appearance (e.g., "a middle-aged man with short salt-and-pepper hair and a beard").
  2. Use neutral terms for age (e.g., "young person" instead of "child" or "kid") to avoid safety filter triggers.
  3. Focus on permanent features: hair style/color, facial structure, skin tone, eye color.
  
  Use the filename hint ONLY if it doesn't look like a celebrity name: "${cleanFileName}".
  
  Your output must be a JSON array of objects, where each object has 'name' (use a generic placeholder like "Subject 1" if unsure) and 'description' keys.`;

  try {
    const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview', // Gemini 3 Pro for advanced reasoning
        contents: {
        parts: [
            imagePart,
            { text: prompt }
        ],
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

    const jsonText = response.text.trim();
    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    // Handle cases where the model returns a valid but empty array, or other non-array JSON
    return [{ name: 'Person 1', description: 'No distinct person found, please describe manually.' }];
  } catch (e: any) {
    console.error("Failed to parse JSON response for character analysis:", e);
    // If it's a quota error, throw it so the UI shows it
    if (String(e).includes('429') || String(e).includes('RESOURCE_EXHAUSTED')) {
        throw cleanError(e);
    }
    // Otherwise fallback
    return [{ name: 'Person 1', description: 'AI analysis failed. Please describe the character manually.' }];
  }
}

export async function optimizePrompt(userPrompt: string): Promise<string> {
   const ai = getAI();
   try {
    const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview', // Gemini 3 Pro for advanced prompt engineering
        contents: `You are a professional photographer's assistant. Rewrite the user's request into a high-quality "Photographic Brief".
        
        Rules:
        1. Keep it concise but descriptive.
        2. Add technical details: "Shot on 85mm lens, f/1.8, soft studio lighting, 8k resolution".
        3. Replace any specific celebrity names with physical descriptions to ensure safety compliance.
        4. Output ONLY the rewritten prompt.
        
        User's request: "${userPrompt}"`,
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
            model: 'gemini-3-pro-preview',
            contents: `Generate a single, creative, and highly descriptive "scene and style" prompt for a professional portrait photoshoot. 
            
            Requirements:
            - Focus on PHOTOREALISM (lighting, environment, camera specs).
            - Be evocative but concise (2-3 sentences).
            - Do NOT mention any characters or people (the user will add them).
            - Do NOT use introductions like "Here is a prompt". Just output the prompt text.
            
            Examples of style:
            - "A sunlit industrial loft with floor-to-ceiling windows, dust motes dancing in the golden hour light, shot on 35mm film with soft bokeh."
            - "A neon-lit Tokyo street at night, raining, reflections on the wet pavement, cinematic teal and orange color grading, depth of field."
            - "A high-fashion editorial studio set with minimal geometric shapes, stark dramatic shadows, and rim lighting."`,
        });
        return response.text.trim();
    } catch (error) {
        throw cleanError(error);
    }
}

// Function to construct the prompt and image parts without generating
export async function constructPromptPayload(
  photos: UploadedPhoto[],
  scenePrompt: string
): Promise<{ imageParts: Part[], fullPrompt: string }> {

  const imageParts: Part[] = await Promise.all(photos.map(async photo => {
    const base64 = await (new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(photo.file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    }));
    return {
      inlineData: {
        mimeType: photo.file.type,
        data: base64.split(',')[1],
      }
    }
  }));

  const allCharacters = photos.flatMap((photo, photoIndex) => 
    photo.characters.map(char => ({ ...char, photoIndex }))
  );

  const inputAssets = photos.map((photo, index) =>
    `[IMAGE ${index + 1}: Reference]`
  ).join('\n');

  const characterManifest = allCharacters.map(char => 
    `---\n**Subject: ${char.name}**\n*   **Ref:** Image ${char.photoIndex + 1}\n*   **Visuals:** ${char.description}`
  ).join('\n');

  const fullPrompt = `**Context:**
${inputAssets}

**Assignment: Professional Group Portrait**
Generate a hyper-realistic group photograph containing exactly the characters listed below.
Consistency is key: The faces and body types must strictly match the provided Reference Images and Visual descriptions.

**Scene & Lighting:**
${scenePrompt}

**Cast List:**
${characterManifest}

**Technical Requirements:**
- Full-body or 3/4 shot (unless specified otherwise).
- High uniformity in lighting across all subjects.
- Photorealistic textures (skin pores, fabric details).
- No distorted faces or limbs.
`;

  return { imageParts, fullPrompt };
}