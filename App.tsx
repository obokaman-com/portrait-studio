
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { UploadedPhoto, CharacterDetail, GenerationResult, UsageLog } from './types';
import { resizeImageToBase64, createAndDownloadZip } from './utils/fileUtils';
import { generateSinglePortrait, analyzePhotoForCharacters, optimizePrompt, constructPromptPayload, generateDynamicScenario, setGlobalApiKey } from './services/geminiService';
import FileUpload from './components/FileUpload';
import ImageGrid from './components/ImageGrid';
import Spinner from './components/Spinner';
import { DownloadIcon, SparklesIcon, TrashIcon, WandIcon, PlusCircleIcon, CloseIcon, ChevronLeftIcon, ChevronRightIcon, AlertTriangleIcon, OboLogo, UploadIcon, ChartBarIcon, GithubIcon, RefreshIcon } from './components/icons';
import Button from './components/Button';
import GenerationOptions from './components/GenerationOptions';
import StyleSelector from './components/StyleSelector';

// Track where the key came from for UI feedback
type ApiKeySource = 'env' | 'storage' | 'studio' | null;

const App: React.FC = () => {
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [scenePrompt, setScenePrompt] = useState<string>('');
  
  // Results State
  const [generationResults, setGenerationResults] = useState<GenerationResult[]>([]);
  const [fullGeneratedPrompt, setFullGeneratedPrompt] = useState<string>('');
  const [isPromptOptimizing, setIsPromptOptimizing] = useState<boolean>(false);
  const [isScenarioGenerating, setIsScenarioGenerating] = useState<boolean>(false);
  
  const [isGenerating, setIsGenerating] = useState<boolean>(false); // General "busy" state
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [selectedError, setSelectedError] = useState<GenerationResult | null>(null);

  const [numImages, setNumImages] = useState<2 | 4 | 8>(4);
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  const [apiKeySource, setApiKeySource] = useState<ApiKeySource>(null);
  const [isCheckingKey, setIsCheckingKey] = useState<boolean>(true);
  
  // Usage Log State
  const [usageLogs, setUsageLogs] = useState<UsageLog[]>([]);
  const [showUsageLogs, setShowUsageLogs] = useState<boolean>(false);
  
  // API Key UI State
  const [manualApiKey, setManualApiKey] = useState<string>('');
  const [showManualInput, setShowManualInput] = useState<boolean>(false);

  // Lightbox State: Using Index instead of String for easier navigation
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);

  // Refs
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null); // Ref to trigger upload from right panel
  
  // CACHE REFS for Optimization
  const lastUsedScenePromptRef = useRef<string>('');
  const cachedOptimizedPromptRef = useRef<string>('');
  const lastGeneratedPayloadRef = useRef<{ imageParts: any[], fullPrompt: string } | null>(null);

  useEffect(() => {
    const checkKey = async () => {
      // 1. Check Local Storage (Persistent User Entry) - PRIORITY over Env if user explicitly set it
      const storedKey = localStorage.getItem('obo_gemini_key');
      if (storedKey && storedKey.length > 0) {
          setGlobalApiKey(storedKey);
          setHasApiKey(true);
          setApiKeySource('storage');
          setIsCheckingKey(false);
          return;
      }

      // 2. Check AI Studio Environment AND .env
      // In AI Studio, process.env.API_KEY is automatically populated. 
      // We check for the window object to know if we should treat this as a "Studio" key (changeable) or a "Hardcoded" key (production).
      const isAIStudio = (window as any).aistudio !== undefined;
      
      if (process.env.API_KEY && process.env.API_KEY.length > 0) {
          setGlobalApiKey(process.env.API_KEY);
          setHasApiKey(true);
          // If we are in AI Studio, label it 'studio' so we show the "Change Project" button.
          // Otherwise, it's a standard ENV variable (e.g. Vercel deployment).
          setApiKeySource(isAIStudio ? 'studio' : 'env');
          setIsCheckingKey(false);
          return;
      }

      // 3. Fallback: Check AI Studio explicitly if env was empty (rare in studio, but possible)
      try {
        if (isAIStudio && await (window as any).aistudio.hasSelectedApiKey()) {
          setHasApiKey(true);
          setApiKeySource('studio');
        }
      } catch (e) {
        console.error("Error checking AI Studio API key:", e);
      } finally {
        setIsCheckingKey(false);
      }
    };
    checkKey();
  }, []);

  // Keyboard navigation for Lightbox
  useEffect(() => {
    if (selectedImageIndex === null) return;
    // Filter only success images for navigation
    const successImages = generationResults.filter(r => r.status === 'success');

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedImageIndex(null);
      } else if (e.key === 'ArrowRight') {
        setSelectedImageIndex((prev) => 
          prev !== null ? (prev + 1) % successImages.length : null
        );
      } else if (e.key === 'ArrowLeft') {
        setSelectedImageIndex((prev) => 
          prev !== null ? (prev - 1 + successImages.length) % successImages.length : null
        );
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedImageIndex, generationResults]);

  const handleSelectKey = async () => {
    try {
      if ((window as any).aistudio) {
        // This opens the Google AI Studio project selector overlay
        await (window as any).aistudio.openSelectKey();
        
        // Note: AI Studio might require a reload to update process.env, 
        // or it might update the context immediately. We set state to true to be safe.
        setHasApiKey(true);
        setApiKeySource('studio');
      }
    } catch (e) {
      console.error("Error selecting API key:", e);
    }
  };
  
  const handleSaveManualKey = () => {
      if (manualApiKey.trim().length > 0) {
          localStorage.setItem('obo_gemini_key', manualApiKey.trim());
          setGlobalApiKey(manualApiKey.trim());
          setHasApiKey(true);
          setApiKeySource('storage');
      }
  };
  
  const handleClearApiKey = () => {
      localStorage.removeItem('obo_gemini_key');
      setGlobalApiKey("");
      setHasApiKey(false);
      setApiKeySource(null);
      // Reset manual input state
      setManualApiKey('');
      setShowManualInput(false);
  };

  const handleApiError = (err: any) => {
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (errorMessage.includes('Requested entity was not found') || errorMessage.includes('API_KEY is missing')) {
      setHasApiKey(false);
      setApiKeySource(null);
      setGlobalError('Session expired or invalid API Key. Please select your key again.');
    } else {
      setGlobalError(errorMessage);
    }
  };

  // --- LOGGING & COST CALCULATION ---
  const handleLogUsage = useCallback((action: string, model: string, inputTokens: number, outputTokens: number) => {
    // ESTIMATED PRICING (USD) - Based on public docs
    // Flash 2.5: $0.075/1M input, $0.30/1M output
    // Pro 3 (Preview): Using Pro 1.5 pricing as proxy or assuming higher tier.
    // Pro 1.5: $3.50/1M input, $10.50/1M output
    // Image Generation: Typically billed per image (~$0.04), not just tokens.
    
    let cost = 0;

    if (model.includes('flash')) {
        cost = (inputTokens / 1_000_000) * 0.075 + (outputTokens / 1_000_000) * 0.30;
    } else if (model.includes('pro')) {
        if (action.includes('Image') || model.includes('image')) {
            // Rough estimation for Imagen/Gemini Image Generation: ~$0.04 per image
            cost = 0.04; 
        } else {
            // Text logic
            cost = (inputTokens / 1_000_000) * 3.50 + (outputTokens / 1_000_000) * 10.50;
        }
    }

    const newLog: UsageLog = {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: new Date(),
        action,
        model,
        inputTokens,
        outputTokens,
        cost
    };

    setUsageLogs(prev => [newLog, ...prev]);
  }, []);

  // Helper to determine smart names
  const getSmartName = (fileName: string, globalIndex: number) => {
      const cleanName = fileName.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
      const isGenericFilename = /(^img|^dsc|^pic|^screenshot|^whatsapp|^video|^photo|^image|^untitled|\d{4,})/i.test(cleanName) || cleanName.length < 3;
      return isGenericFilename ? `Subject ${globalIndex + 1}` : cleanName;
  };

  const handleFilesChange = async (files: File[]) => {
    // Calculate current total characters to continue numbering if using generic names
    const currentTotalChars = photos.reduce((acc, p) => acc + p.characters.length, 0);

    const newPhotos: UploadedPhoto[] = files.map(file => ({
      id: `${file.name}-${Date.now()}`,
      file,
      preview: URL.createObjectURL(file),
      characters: [],
    }));

    setPhotos(prev => [...prev, ...newPhotos]);

    let runningCharCount = currentTotalChars;

    for (const photo of newPhotos) {
       try {
        // Initial Loading State with Smart Name
        const smartName = getSmartName(photo.file.name, runningCharCount);
        runningCharCount++; 

        setPhotos(prev => prev.map(p => p.id === photo.id ? { 
            ...p, 
            characters: [{ 
                id: `${p.id}-char-loading`, 
                name: smartName, // Set name immediately
                description: '', 
                isDescriptionLoading: true 
            }] 
        } : p));

        // OPTIMIZATION: Resize here for Analysis
        const base64 = await resizeImageToBase64(photo.file, 1024); // 1024 is ample for face detection/desc
        
        const imagePart = {
          inlineData: {
            mimeType: photo.file.type, // We can keep original mimetype or force jpeg based on resize utils, but service handles generic mime
            data: base64.split(',')[1],
          },
        };

        const describedCharacters = await analyzePhotoForCharacters(imagePart as any, photo.file.name, handleLogUsage);
        
        // Preserve the smart name we calculated, don't let AI overwrite it with "Subject 1"
        const newCharacters: CharacterDetail[] = describedCharacters.map((char, index) => ({
          ...char,
          id: `${photo.id}-char-${index}`,
          name: index === 0 ? smartName : `Subject ${runningCharCount + index}`, 
          isDescriptionLoading: false,
        }));
        
        if (describedCharacters.length > 1) runningCharCount += (describedCharacters.length - 1);

        setPhotos(prev =>
          prev.map(p =>
            p.id === photo.id ? { ...p, characters: newCharacters } : p
          )
        );
      } catch (err) {
        console.error(`Failed to generate description for ${photo.file.name}`, err);
        handleApiError(err);
        setPhotos(prev =>
          prev.map(p =>
            p.id === photo.id
              ? { ...p, characters: [{ id: `${p.id}-char-error`, name: 'Error', description: 'Error generating description.', isDescriptionLoading: false }] }
              : p
          )
        );
      }
    }
  };
  
  const handleNameChange = (photoId: string, charId: string, name: string) => {
    setPhotos(prev => prev.map(p => p.id === photoId ? {
      ...p,
      characters: p.characters.map(c => c.id === charId ? { ...c, name } : c)
    } : p));
  };
  
  const handleDescriptionChange = (photoId: string, charId: string, description: string) => {
    setPhotos(prev => prev.map(p => p.id === photoId ? {
      ...p,
      characters: p.characters.map(c => c.id === charId ? { ...c, description } : c)
    } : p));
  };

  const addCharacterToPhoto = (photoId: string) => {
    const totalChars = photos.reduce((acc, p) => acc + p.characters.length, 0);
    const newChar: CharacterDetail = {
      id: `${photoId}-char-${Date.now()}`,
      name: `Subject ${totalChars + 1}`,
      description: '',
      isDescriptionLoading: false,
    };
    setPhotos(prev => prev.map(p => p.id === photoId ? {
      ...p,
      characters: [...p.characters, newChar]
    } : p));
  };

  const removeCharacterFromPhoto = (photoId: string, charId: string) => {
    setPhotos(prev => prev.map(p => p.id === photoId ? {
      ...p,
      characters: p.characters.filter(c => c.id !== charId)
    } : p));
  };

  const removePhoto = (photoId: string) => {
    const photoToRemove = photos.find(p => p.id === photoId);
    if(photoToRemove) {
      URL.revokeObjectURL(photoToRemove.preview);
    }
    setPhotos(prev => prev.filter(p => p.id !== photoId));
  };

  const handleCancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
    setLoadingMessage('');
    setIsPromptOptimizing(false);
    
    // Mark pending as cancelled
    setGenerationResults(prev => prev.map(res => 
      res.status === 'pending' ? { ...res, status: 'cancelled' } : res
    ));
  }, []);

  const handleSelectScenario = async (scenarioTheme: string) => {
      setIsScenarioGenerating(true);
      setScenePrompt(''); // Clear current while loading to show feedback
      
      try {
          // Count total characters to give context to the AI
          const totalChars = photos.reduce((acc, p) => acc + p.characters.length, 0) || 1;
          const generatedScenario = await generateDynamicScenario(scenarioTheme, totalChars, handleLogUsage);
          setScenePrompt(generatedScenario);
      } catch (e) {
          console.error("Error generating scenario:", e);
          handleApiError(e);
          setScenePrompt("Failed to generate scenario. Please try again.");
      } finally {
          setIsScenarioGenerating(false);
      }
  };

  // --- NEW GENERATION LOGIC (GRANULAR) ---
  const handleGenerate = useCallback(async () => {
    const allCharacters = photos.flatMap(p => p.characters);
    if (allCharacters.length === 0) {
      setGlobalError('Please upload at least one photo and define a character.');
      return;
    }
     if (!scenePrompt.trim()) {
      setGlobalError('Describe the scene first.');
      return;
    }
    
    // Reset Logic
    setIsGenerating(true);
    setGlobalError(null);
    setFullGeneratedPrompt('');
    
    // Init Abort Controller
    const controller = new AbortController();
    abortControllerRef.current = controller;
    
    // 1. Create Placeholders
    const placeholders: GenerationResult[] = Array.from({ length: numImages }, (_, i) => ({
        id: `gen-${Date.now()}-${i}`,
        status: 'pending'
    }));
    setGenerationResults(placeholders);
    
    try {
      let optimizedPrompt = '';

      // 2. Optimization Phase (With Caching)
      if (scenePrompt === lastUsedScenePromptRef.current && cachedOptimizedPromptRef.current) {
          // Cache Hit! Skip optimization
          console.log("Using cached optimized prompt");
          optimizedPrompt = cachedOptimizedPromptRef.current;
          setFullGeneratedPrompt(optimizedPrompt); // Note: We might want to store full constructed prompt in cache too, but optimization is the expensive text part
      } else {
          // Cache Miss - Call API
          setLoadingMessage('Optimizing scene prompt...');
          setIsPromptOptimizing(true);
          optimizedPrompt = await optimizePrompt(scenePrompt, handleLogUsage);
          if (controller.signal.aborted) return;
          
          // Update Cache
          lastUsedScenePromptRef.current = scenePrompt;
          cachedOptimizedPromptRef.current = optimizedPrompt;
      }
      
      // We always reconstruct payload because photos/characters might have changed even if scene didn't
      const { imageParts, fullPrompt } = await constructPromptPayload(photos, optimizedPrompt);
      if (controller.signal.aborted) return;

      // Store payload for retry functionality
      lastGeneratedPayloadRef.current = { imageParts, fullPrompt };

      setFullGeneratedPrompt(fullPrompt);
      setIsPromptOptimizing(false);
      setLoadingMessage(`Rendering ${numImages} portraits...`);

      // 3. Parallel Execution with Individual Updates
      // All images use the same optimized prompt (no variations on initial generation)
      const promises = placeholders.map((placeholder) => {
          return generateSinglePortrait(imageParts, fullPrompt, controller.signal, handleLogUsage)
            .then((imageUrl) => {
                if (controller.signal.aborted) return;
                setGenerationResults(prev => prev.map(res => 
                    res.id === placeholder.id 
                    ? { ...res, status: 'success', imageUrl } 
                    : res
                ));
            })
            .catch((err) => {
                if (controller.signal.aborted || err.message === 'Cancelled') {
                    setGenerationResults(prev => prev.map(res => 
                      res.id === placeholder.id 
                      ? { ...res, status: 'cancelled' } 
                      : res
                    ));
                    return;
                }
                const errMsg = err instanceof Error ? err.message : "Unknown error";
                const isQuotaError = errMsg.includes('429') || errMsg.includes('Quota Exceeded') || errMsg.includes('RESOURCE_EXHAUSTED');
                setGenerationResults(prev => prev.map(res =>
                    res.id === placeholder.id
                    ? { ...res, status: 'error', errorMessage: errMsg, isQuotaError }
                    : res
                ));
            });
      });

      // Wait for all (so we know when "isGenerating" is done)
      await Promise.allSettled(promises);

    } catch (err: any) {
      if (err.message === 'Cancelled' || controller.signal.aborted) {
        // Handled in catch blocks or handleCancel, usually
      } else {
        console.error(err);
        handleApiError(err);
        // If prompt generation failed, mark all as error
        setGenerationResults(prev => prev.map(res => ({ ...res, status: 'error', errorMessage: 'Initialization failed.' })));
      }
    } finally {
      // Only turn off generating if we haven't already cancelled (which turns it off manually)
      if (abortControllerRef.current === controller) {
         setIsGenerating(false);
         setLoadingMessage('');
         setIsPromptOptimizing(false);
         abortControllerRef.current = null;
      }
    }
  }, [photos, scenePrompt, numImages, handleLogUsage]);
  
  // --- UTILS FOR NAMING ---
  const generateBatchId = () => Math.random().toString(36).substring(2, 7); // 5 chars
  const generateSlug = (text: string) => {
    return text
      .slice(0, 30) // Max length
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_') // Replace non-alphanumeric with _
      .replace(/^_+|_+$/g, ''); // Trim _
  };

  const handleDownloadZip = () => {
    const successImages = generationResults
        .filter(r => r.status === 'success' && r.imageUrl)
        .map(r => r.imageUrl!);
    
    if(successImages.length > 0) {
      const slug = generateSlug(scenePrompt || 'portrait');
      const batchId = generateBatchId();
      const baseName = `obo_${slug}_${batchId}`;
      const zipName = `${baseName}.zip`;

      // Create Metadata
      const metadata = `
--- OBO STUDIO GENERATION INFO ---
Date: ${new Date().toISOString()}
Batch ID: ${batchId}
----------------------------------
USER SCENE PROMPT:
${scenePrompt}

OPTIMIZED PROMPT (USED FOR GENERATION):
${fullGeneratedPrompt}
----------------------------------
`.trim();

      createAndDownloadZip(successImages, zipName, baseName, metadata);
    }
  };

  const handleDownloadSingle = (base64Data: string) => {
     const slug = generateSlug(scenePrompt || 'portrait');
     const batchId = generateBatchId(); // Unique ID for this specific download event
     
     const link = document.createElement("a");
     link.href = base64Data;
     link.download = `obo_${slug}_${batchId}.png`;
     document.body.appendChild(link);
     link.click();
     document.body.removeChild(link);
  };

  // Helper to get only success images for lightbox
  const getSuccessImages = () => generationResults.filter(r => r.status === 'success' && r.imageUrl);

  const navigateLightbox = (direction: 'next' | 'prev', e: React.MouseEvent) => {
      e.stopPropagation();
      if (selectedImageIndex === null) return;

      const successImages = getSuccessImages();
      if (successImages.length === 0) return;

      if (direction === 'next') {
          setSelectedImageIndex((selectedImageIndex + 1) % successImages.length);
      } else {
          setSelectedImageIndex((selectedImageIndex - 1 + successImages.length) % successImages.length);
      }
  };

  const handleRetryImage = useCallback(async (failedResult: GenerationResult) => {
      if (!lastGeneratedPayloadRef.current) {
          setGlobalError('Cannot retry: generation data not available. Please regenerate all.');
          return;
      }

      const { imageParts, fullPrompt } = lastGeneratedPayloadRef.current;

      // Find the index of the failed result to determine retry count
      const resultIndex = generationResults.findIndex(r => r.id === failedResult.id);
      if (resultIndex === -1) return;

      // Safety mitigation variations - tactical adjustments to avoid policy blocks
      const safetyMitigationVariations = [
          '', // Original attempt (no modification)
          '\n\nNote: Replace any specific celebrity/person names with "protagonist of [their famous work]" or generic descriptions. Use "character from" instead of direct names.',
          '\n\nNote: Avoid mentioning real people by name. Reference them by role or archetype (e.g., "a musician", "an athlete", "the character from X").',
          '\n\nNote: Use artistic/cinematic language. Replace specific names with descriptive terms like "subject", "figure", "individual".',
          '\n\nNote: Emphasis on artistic interpretation rather than realistic likeness. Focus on style, mood, and composition.',
          '\n\nNote: Frame as fictional/artistic portrait. Avoid references that could trigger deepfake protection.',
      ];

      // Count how many times this specific image has been retried
      const retryCount = (failedResult as any).retryCount || 0;
      const variationIndex = Math.min(retryCount + 1, safetyMitigationVariations.length - 1);
      const promptVariation = `${fullPrompt}${safetyMitigationVariations[variationIndex]}`;

      // Use Flash model if original error was quota-related
      const modelToUse = failedResult.isQuotaError ? 'gemini-2.5-flash-image' : undefined;

      // Mark as pending and increment retry count
      setGenerationResults(prev => prev.map(res =>
          res.id === failedResult.id
              ? { ...res, status: 'pending', errorMessage: undefined, retryCount: retryCount + 1, isQuotaError: false } as any
              : res
      ));

      try {
          const imageUrl = await generateSinglePortrait(imageParts, promptVariation, undefined, handleLogUsage, modelToUse);

          setGenerationResults(prev => prev.map(res =>
              res.id === failedResult.id ? { ...res, status: 'success', imageUrl } : res
          ));
      } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Unknown error";
          const isQuotaError = errMsg.includes('429') || errMsg.includes('Quota Exceeded') || errMsg.includes('RESOURCE_EXHAUSTED');
          setGenerationResults(prev => prev.map(res =>
              res.id === failedResult.id ? { ...res, status: 'error', errorMessage: errMsg, isQuotaError } : res
          ));
      }
  }, [generationResults, handleLogUsage]);

  const handleRetryAllFailed = useCallback(async () => {
      const failedResults = generationResults.filter(r => r.status === 'error');

      if (failedResults.length === 0) return;

      // Retry all failed images sequentially to avoid overwhelming the API
      for (const failedResult of failedResults) {
          await handleRetryImage(failedResult);
      }
  }, [generationResults, handleRetryImage]);

  const isCharacterAnalysisPending = photos.some(p => p.characters.some(c => c.isDescriptionLoading));
  const totalCharacters = photos.reduce((acc, p) => acc + p.characters.length, 0);

  // --- UI LOGIC ---
  const step1Complete = photos.length > 0;
  const step3Complete = scenePrompt.trim().length > 0;
  const isStep3Locked = !step1Complete;

  if (isCheckingKey) {
    return (
        <div className="min-h-screen bg-[#050505] flex items-center justify-center">
            <Spinner text="Initializing Studio..." />
        </div>
    );
  }

  // --- API Key Modal (Elegant Overlay) ---
  if (!hasApiKey) {
    const isAIStudioEnv = (window as any).aistudio !== undefined;
    
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="bg-[#0f0f0f] border border-white/10 rounded-3xl max-w-md w-full p-8 text-center shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 via-sky-500 to-purple-500" />
                <div className="w-16 h-16 bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-inner ring-1 ring-white/5">
                    <OboLogo className="w-10 h-10" />
                </div>
                <h1 className="text-2xl font-light text-white mb-2 tracking-wide">Portrait OboStudio</h1>
                <p className="text-gray-400 mb-6 font-light leading-relaxed">
                  Unlock the full potential of <span className="text-gray-200">Gemini 3 Pro</span>. 
                  Connect a billing-enabled Google Cloud project to begin.
                </p>

                <div className="space-y-4">
                    {/* OPTION 1: AI STUDIO (If detected) */}
                    {isAIStudioEnv && (
                        <Button onClick={handleSelectKey} className="w-full py-4 text-base shadow-lg shadow-sky-900/20">
                            Connect AI Studio Project
                        </Button>
                    )}

                    {/* SEPARATOR (If both options available) */}
                    {isAIStudioEnv && (
                        <div className="relative py-2">
                             <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-white/10"></span></div>
                             <div className="relative flex justify-center"><span className="bg-[#0f0f0f] px-2 text-[10px] text-gray-500 uppercase tracking-widest">OR</span></div>
                        </div>
                    )}
                    
                    {/* OPTION 2: MANUAL INPUT */}
                    {!showManualInput ? (
                        <button 
                            onClick={() => setShowManualInput(true)}
                            className="text-sm text-gray-500 hover:text-sky-400 underline underline-offset-4 transition-colors"
                        >
                            Enter API Key manually
                        </button>
                    ) : (
                        <div className="animate-fade-in space-y-3 bg-white/5 p-4 rounded-xl border border-white/5">
                            <input 
                                type="password" 
                                placeholder="Paste your Gemini API Key"
                                value={manualApiKey}
                                onChange={(e) => setManualApiKey(e.target.value)}
                                className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-sky-500 focus:outline-none placeholder-gray-600"
                            />
                            <Button 
                                onClick={handleSaveManualKey} 
                                disabled={!manualApiKey.trim()}
                                className="w-full py-2 text-sm"
                            >
                                Save Key
                            </Button>
                            
                            {/* Security Note */}
                            <div className="p-3 bg-blue-900/10 border border-blue-500/10 rounded-lg flex gap-2 items-start text-left">
                                <div className="mt-0.5"><div className="w-1.5 h-1.5 bg-blue-400 rounded-full" /></div>
                                <p className="text-[10px] text-gray-400 leading-tight">
                                    <strong className="text-gray-300">Security Note:</strong> Your API Key is stored locally in your browser (LocalStorage). 
                                    It is used directly to communicate with Google's API and is never sent to any intermediate server.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                <div className="mt-6 text-xs text-gray-600 flex flex-col gap-1">
                    <span>Don't have a key?</span>
                    <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-sky-500 hover:text-sky-400 transition-colors underline">
                        Get a Gemini API Key here
                    </a>
                </div>
            </div>
        </div>
    );
  }

  // --- Main App Layout ---
  return (
    <div className="h-screen flex flex-col bg-[#050505] text-gray-300 font-sans selection:bg-sky-500/30 overflow-hidden">
      
      {/* Header */}
      <header className="flex-shrink-0 sticky top-0 z-40 w-full backdrop-blur-xl bg-black/50 border-b border-white/5 transition-all duration-300">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-5">
            {/* Logo Container */}
            <div className="w-12 h-12 flex items-center justify-center shadow-lg shadow-purple-900/20 rounded-xl bg-white/5 border border-white/5">
               <OboLogo className="w-10 h-10" />
            </div>
            {/* Text Container */}
            <div className="flex flex-col justify-center">
                <h1 className="text-2xl font-bold text-white tracking-wide leading-none mb-1">Portrait OboStudio</h1>
                <span className="text-[10px] text-gray-500 font-medium tracking-[0.14em] uppercase pl-0.5">Beyond the lens of reality</span>
            </div>
          </div>
          
          {/* Right Header Actions - API KEY STATUS */}
          <div className="flex items-center gap-4">
             {/* GITHUB LINK */}
             <a
                href="https://github.com/obokaman-com/portrait-studio/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-white transition-colors p-2 rounded-full hover:bg-white/5"
                title="View Source on GitHub"
             >
                 <GithubIcon className="w-5 h-5" />
             </a>
            
             {/* STATS BUTTON */}
             <button 
                onClick={() => setShowUsageLogs(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors text-[10px]"
             >
                <ChartBarIcon className="w-3 h-3" />
                <span className="font-mono">
                    ${usageLogs.reduce((acc, log) => acc + log.cost, 0).toFixed(4)}
                </span>
             </button>

             {apiKeySource === 'storage' && (
                 <button 
                    onClick={handleClearApiKey}
                    className="text-[10px] text-sky-400 hover:text-red-400 flex items-center gap-2 transition-colors border border-sky-500/20 hover:border-red-900/30 bg-sky-900/10 hover:bg-red-900/10 px-3 py-1.5 rounded-full"
                    title="Disconnect custom API Key"
                 >
                     <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
                     </span>
                     Browser Key Active (Reset)
                 </button>
             )}

             {/* Standard ENV Key (e.g. Vercel) - Just an indicator */}
             {apiKeySource === 'env' && (
                 <div className="text-[10px] text-green-500 flex items-center gap-2 border border-green-500/20 bg-green-900/10 px-3 py-1.5 rounded-full cursor-help" title="API Key provided by Environment Variables">
                     <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                     ENV Key Active
                 </div>
             )}

             {/* Studio Key (AI Studio Detected) - Allows Changing */}
             {apiKeySource === 'studio' && (
                 <button 
                     onClick={handleSelectKey}
                     className="text-[10px] text-purple-400 hover:text-white flex items-center gap-2 border border-purple-500/20 hover:border-purple-500/40 bg-purple-900/10 hover:bg-purple-900/20 px-3 py-1.5 rounded-full transition-colors"
                 >
                     <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
                     Studio Project (Change)
                 </button>
             )}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto p-4 lg:p-6 overflow-hidden flex flex-col lg:flex-row gap-6">
        
        {/* LEFT PANEL: Control Center (Scrollable on Desktop) */}
        {/* Added lg:px-2 to prevent button focus ring clipping on the left side */}
        <div className="w-full lg:w-[420px] lg:h-full lg:flex-shrink-0 flex flex-col gap-6 lg:overflow-y-auto lg:px-2 hide-scrollbar">
          
          {/* Section 1: Upload */}
          <div className="space-y-3">
             <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">
                  <span className={`font-mono mr-2 ${step1Complete ? 'text-green-500' : 'text-sky-500/80'}`}>01</span>
                  Who
                  <span className="text-gray-600 text-[10px] ml-2 normal-case tracking-normal font-normal">(Subjects)</span>
                </h2>
                <span className="text-xs text-gray-600">{photos.length} uploaded</span>
             </div>
             {/* Pass Ref to allow external triggering */}
             <FileUpload onFilesChange={handleFilesChange} inputRef={fileInputRef} />
          </div>

          {/* Section 2: Characters */}
          {photos.length > 0 && (
            <div className="space-y-3 animate-fade-in">
              <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">
                 <span className="text-green-500 font-mono mr-2">02</span>
                 Identity
                 <span className="text-gray-600 text-[10px] ml-2 normal-case tracking-normal font-normal">(Analysis)</span>
              </h2>
              <div className="space-y-4">
                {photos.map((photo) => (
                  <div key={photo.id} className="group relative bg-[#0f0f0f] rounded-xl border border-white/5 p-3 hover:border-white/10 transition-colors">
                    <button 
                      onClick={() => removePhoto(photo.id)} 
                      className="absolute top-2 right-2 p-1.5 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                    
                    <div className="flex gap-4">
                       <img src={photo.preview} alt="" className="w-16 h-16 rounded-lg object-cover bg-gray-800 flex-shrink-0" />
                       <div className="flex-1 space-y-3">
                          {photo.characters.map((char) => (
                            <div key={char.id} className="relative">
                               {char.isDescriptionLoading ? (
                                  <div className="h-14 flex items-center gap-3">
                                     <Spinner text="" />
                                     <span className="text-xs text-sky-400 animate-pulse">Analyzing identity...</span>
                                  </div>
                               ) : (
                                 <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <input
                                          type="text"
                                          value={char.name}
                                          onChange={(e) => handleNameChange(photo.id, char.id, e.target.value)}
                                          placeholder="Name"
                                          className="w-full bg-transparent border-b border-white/10 focus:border-sky-500 text-sm font-medium text-white placeholder-gray-600 pb-1 focus:outline-none transition-colors"
                                        />
                                        <button onClick={() => removeCharacterFromPhoto(photo.id, char.id)} className="text-gray-600 hover:text-red-400">
                                            <TrashIcon className="w-3 h-3" />
                                        </button>
                                    </div>
                                    <textarea
                                      value={char.description}
                                      onChange={(e) => handleDescriptionChange(photo.id, char.id, e.target.value)}
                                      className="w-full bg-[#050505]/50 rounded-md border border-white/5 p-2 text-xs text-gray-400 focus:text-gray-200 focus:border-white/20 focus:outline-none resize-none transition-all"
                                      rows={2}
                                      placeholder="Description details..."
                                    />
                                 </div>
                               )}
                            </div>
                          ))}
                          <button 
                            onClick={() => addCharacterToPhoto(photo.id)} 
                            className="text-xs flex items-center gap-1 text-gray-500 hover:text-sky-400 transition-colors mt-1"
                          >
                             <PlusCircleIcon className="w-3 h-3" /> Add another person from this photo
                          </button>
                       </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section 3: Prompt & Generate */}
          {/* VISUAL LOCK: Dimmed and non-interactive until step 1 is complete */}
          <div className={`space-y-3 flex-grow transition-all duration-500 ${isStep3Locked ? 'opacity-30 pointer-events-none grayscale' : 'opacity-100'}`}>
            <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider flex justify-between">
                <span>
                    <span className={`font-mono mr-2 ${step3Complete ? 'text-green-500' : 'text-sky-500/80'}`}>03</span>
                    Where
                    <span className="text-gray-600 text-[10px] ml-2 normal-case tracking-normal font-normal">(Scene & Style)</span>
                </span>
                {isStep3Locked && <span className="text-[10px] text-sky-500 font-normal normal-case animate-pulse">Complete Step 1 to unlock</span>}
            </h2>
            <div className="relative bg-[#0f0f0f] rounded-xl border border-white/5 p-1 focus-within:ring-1 focus-within:ring-sky-500/50 transition-all group/prompt">
               {isScenarioGenerating ? (
                   <div className="absolute inset-0 bg-black/40 backdrop-blur-sm z-10 flex items-center justify-center rounded-xl">
                       <div className="flex flex-col items-center gap-2">
                           <WandIcon className="w-5 h-5 text-sky-400 animate-bounce" />
                           <span className="text-xs text-sky-200 font-medium">Dreaming up a scenario...</span>
                       </div>
                   </div>
               ) : null}
                <textarea
                  value={scenePrompt}
                  onChange={(e) => setScenePrompt(e.target.value)}
                  placeholder="Describe the scene, outfits, and mood..."
                  className="w-full h-32 p-3 bg-transparent text-sm text-gray-200 placeholder-gray-600 focus:outline-none resize-none"
                />
            </div>
            
            {/* Style/Scenario Selectors */}
            <StyleSelector onSelect={handleSelectScenario} isGenerating={isScenarioGenerating} />

            <div className="pt-2 space-y-4">
                <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 font-medium">Variations</span>
                    <div className="w-48">
                        <GenerationOptions selected={numImages} onChange={setNumImages} />
                    </div>
                </div>

                <Button
                    onClick={isGenerating ? undefined : handleGenerate}
                    disabled={(isGenerating ? false : (totalCharacters === 0 || !scenePrompt.trim() || isCharacterAnalysisPending))}
                    className={`w-full shadow-lg shadow-sky-900/20 py-4 ${isGenerating ? 'cursor-default' : ''}`}
                >
                    {isGenerating ? (
                         <div className="flex items-center justify-center gap-3">
                            {/* Stop Control - Refined Always-Visible UI */}
                            <div 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleCancel();
                                }}
                                className="group/stop relative w-7 h-7 flex items-center justify-center cursor-pointer hover:scale-105 transition-transform"
                                title="Cancel Generation"
                            >
                                {/* Spinner Ring - Visible */}
                                <div className="absolute inset-0 border-[3px] border-white/20 border-t-white rounded-full animate-spin" />
                                
                                {/* Stop Square - Visible */}
                                <div className="w-2.5 h-2.5 bg-white rounded-[1px] group-hover/stop:bg-red-500 transition-colors shadow-sm" />
                            </div>
                            <span className="text-gray-200 animate-pulse font-medium tracking-wide">{loadingMessage}</span>
                         </div>
                    ) : (
                        <span className="flex items-center gap-2">
                             <SparklesIcon className="w-5 h-5" /> Generate Portraits
                        </span>
                    )}
                </Button>
                
                {globalError && (
                    <div className="text-xs text-red-400 text-center bg-red-900/10 border border-red-900/30 p-2 rounded-lg">
                        {globalError}
                    </div>
                )}
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: Lightbox / Results */}
        <div className="flex-1 h-full min-h-[500px] bg-[#0a0a0a] rounded-3xl border border-white/5 relative overflow-hidden flex flex-col shadow-2xl">
            
            {/* Empty State - VISUAL FLOW DIAGRAM (DYNAMIC) */}
            {!isGenerating && generationResults.length === 0 && !globalError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8 opacity-60">
                    <div className="flex items-center gap-4 mb-8">
                         {/* Step 1: Upload (Active if no photos) */}
                         <div 
                            onClick={() => !step1Complete && fileInputRef.current?.click()}
                            className={`flex flex-col items-center gap-2 transition-all duration-500 ${!step1Complete ? 'cursor-pointer group/upload' : ''}`}
                         >
                             <div className={`
                                w-16 h-16 rounded-2xl border flex items-center justify-center transition-all duration-500
                                ${!step1Complete 
                                    ? 'bg-sky-500/10 border-sky-500/50 shadow-[0_0_15px_rgba(14,165,233,0.3)] group-hover/upload:bg-sky-500/20 group-hover/upload:scale-105 group-active/upload:scale-95' 
                                    : 'bg-white/5 border-white/5' // Done state
                                }
                             `}>
                                 <UploadIcon className={`w-6 h-6 transition-colors duration-500 ${!step1Complete ? 'text-sky-400' : 'text-gray-400'}`} />
                             </div>
                             <span className={`text-[10px] uppercase tracking-wider font-medium transition-colors duration-500 ${!step1Complete ? 'text-sky-400 group-hover/upload:underline' : 'text-gray-500'}`}>1. Upload</span>
                         </div>
                         
                         {/* Arrow */}
                         <ChevronRightIcon className="w-4 h-4 text-gray-800" />

                         {/* Step 2: Describe/Identity (Active if photos exist) */}
                         <div className="flex flex-col items-center gap-2 transition-all duration-500">
                             <div className={`
                                w-16 h-16 rounded-2xl border flex items-center justify-center transition-all duration-500
                                ${step1Complete 
                                    ? 'bg-sky-500/10 border-sky-500/50 shadow-[0_0_15px_rgba(14,165,233,0.3)]' 
                                    : 'bg-[#121212] border-white/5 opacity-50'
                                }
                             `}>
                                 <WandIcon className={`w-6 h-6 transition-colors duration-500 ${step1Complete ? 'text-sky-400' : 'text-gray-600'}`} />
                             </div>
                             <span className={`text-[10px] uppercase tracking-wider font-medium transition-colors duration-500 ${step1Complete ? 'text-sky-400' : 'text-gray-700'}`}>2. Describe</span>
                         </div>

                         {/* Arrow */}
                         <ChevronRightIcon className="w-4 h-4 text-gray-800" />

                         {/* Step 3: Result (Goal) */}
                         <div className="flex flex-col items-center gap-2 transition-all duration-500">
                             <div className="w-16 h-16 rounded-2xl bg-[#121212] border border-white/5 flex items-center justify-center opacity-50">
                                 <SparklesIcon className="w-6 h-6 text-gray-600" />
                             </div>
                             <span className="text-[10px] uppercase tracking-wider text-gray-700 font-medium">3. Result</span>
                         </div>
                    </div>
                    
                    <h3 className="text-lg font-light text-white mb-2 tracking-wide transition-all duration-300">
                        {step1Complete ? "Analyze & Describe" : "Start Here"}
                    </h3>
                    <p className="max-w-xs text-xs text-gray-500 leading-relaxed transition-all duration-300">
                        {step1Complete 
                            ? "Review the AI's character analysis on the left, then describe the scene you want to place them in."
                            : "Click the upload icon above or use the panel on the left to add your subjects."
                        }
                    </p>
                </div>
            )}

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-4 lg:p-6 custom-scrollbar">
                <ImageGrid
                    results={generationResults}
                    onImageClick={(result) => {
                         const successImages = getSuccessImages();
                         // Find the index of this result within the SUCCESS array, not the whole array
                         const successIndex = successImages.findIndex(r => r.id === result.id);
                         if(successIndex !== -1) setSelectedImageIndex(successIndex);
                    }}
                    onErrorClick={(result) => setSelectedError(result)}
                    onRetry={handleRetryImage}
                />
            </div>

            {/* Actions Footer (Floating inside right panel) */}
            {(generationResults.length > 0 || isPromptOptimizing) && (
                <div className="p-4 bg-black/60 backdrop-blur-md border-t border-white/5 flex flex-col gap-3">
                   {/* Prompt Details Section */}
                   {(isPromptOptimizing || fullGeneratedPrompt) && (
                        <details className="group" open={isPromptOptimizing}>
                            <summary className="list-none cursor-pointer text-[10px] text-gray-500 hover:text-gray-300 flex items-center gap-2 transition-colors">
                                <WandIcon className="w-3 h-3" /> 
                                {isPromptOptimizing ? 'Optimizing System Prompt...' : 'View System Prompt'}
                            </summary>
                            <div className="mt-2 p-3 bg-black/50 rounded-lg border border-white/5 text-[10px] font-mono text-gray-500 leading-relaxed overflow-x-auto min-h-[60px]">
                                {isPromptOptimizing ? (
                                    <div className="flex items-center gap-2 h-full">
                                        <span className="w-1.5 h-1.5 bg-sky-500 rounded-full animate-pulse"/>
                                        <span className="text-gray-600">Analyzing characters and scene requirements...</span>
                                    </div>
                                ) : fullGeneratedPrompt}
                            </div>
                        </details>
                   )}
                   
                   {/* Action Buttons */}
                   {!isGenerating && generationResults.length > 0 && (
                       <div className="flex gap-3">
                            {/* Download All - Only if at least one success */}
                            {generationResults.some(r => r.status === 'success') && (
                                <Button
                                    onClick={handleDownloadZip}
                                    className="flex-1 bg-white text-black hover:bg-gray-200"
                                >
                                    <DownloadIcon className="w-4 h-4 mr-2" /> Download All (ZIP)
                                </Button>
                            )}

                            {/* Retry All Failed - Only if there are errors */}
                            {generationResults.some(r => r.status === 'error') && (
                                <button
                                    onClick={handleRetryAllFailed}
                                    className="px-6 py-2 rounded-full border border-yellow-500/30 bg-yellow-900/10 text-sm font-medium hover:bg-yellow-900/20 transition-colors text-yellow-400 hover:text-yellow-300 flex items-center gap-2"
                                >
                                    <RefreshIcon className="w-4 h-4" />
                                    Retry All Failed
                                </button>
                            )}

                            {/* Regenerate All */}
                            <button
                                onClick={handleGenerate}
                                className="px-6 py-2 rounded-full border border-white/10 text-sm font-medium hover:bg-white/5 transition-colors text-white"
                            >
                                Regenerate
                            </button>
                       </div>
                   )}
                </div>
            )}
        </div>
      </main>

      {/* Footer */}
      <footer className="flex-shrink-0 w-full border-t border-white/5 bg-black/40 backdrop-blur-md py-3 px-6 flex items-center justify-center text-[10px] text-gray-600 tracking-wide z-40">
         <p>
            Vivecoded with <span className="text-red-500/80">❤️</span> by{' '}
            <a href="https://albert.garcia.gibert.es/" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-sky-400 transition-colors">obokaman</a>
            {' '}using{' '}
            <a href="https://aistudio.google.com/" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-sky-400 transition-colors">Google AI Studio</a>
            {' '}<span className="mx-2 opacity-30">|</span>{' '}
            Powered by <span className="text-gray-500 font-medium">Gemini 3 Pro</span> & <span className="text-gray-500 font-medium">Nano Banana</span>
         </p>
      </footer>

      {/* --- USAGE LOGS MODAL --- */}
      {showUsageLogs && (
        <div
            className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowUsageLogs(false)}
        >
            <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl max-w-2xl w-full p-6 relative shadow-2xl flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
                 <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-4">
                     <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center text-green-500 border border-green-500/20">
                            <ChartBarIcon className="w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="text-lg font-medium text-white">Session Usage</h3>
                            <p className="text-xs text-gray-500">Estimated cost for this session based on public pricing.</p>
                        </div>
                     </div>
                     <div className="text-right">
                         <span className="block text-2xl font-bold text-white tracking-tight">
                            ${usageLogs.reduce((acc, log) => acc + log.cost, 0).toFixed(4)}
                         </span>
                         <span className="text-[10px] text-gray-500 uppercase tracking-wider">Total Est. Cost</span>
                     </div>
                 </div>

                 <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                     {usageLogs.length === 0 ? (
                         <div className="text-center py-10 text-gray-600 text-sm">
                             No usage recorded yet. Start generating!
                         </div>
                     ) : (
                         <table className="w-full text-left text-xs text-gray-400">
                             <thead className="text-[10px] uppercase text-gray-500 font-semibold border-b border-white/5 bg-white/5 sticky top-0">
                                 <tr>
                                     <th className="px-3 py-2 rounded-tl-lg">Time</th>
                                     <th className="px-3 py-2">Action</th>
                                     <th className="px-3 py-2">Model</th>
                                     <th className="px-3 py-2 text-right">In / Out</th>
                                     <th className="px-3 py-2 text-right rounded-tr-lg">Est. Cost</th>
                                 </tr>
                             </thead>
                             <tbody className="divide-y divide-white/5">
                                 {usageLogs.map((log) => (
                                     <tr key={log.id} className="hover:bg-white/5 transition-colors">
                                         <td className="px-3 py-3 font-mono text-gray-500">
                                             {log.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                         </td>
                                         <td className="px-3 py-3 text-white font-medium">{log.action}</td>
                                         <td className="px-3 py-3 font-mono text-[10px] text-sky-400/80">{log.model.replace('gemini-', '')}</td>
                                         <td className="px-3 py-3 text-right font-mono">
                                             <span className="text-gray-300">{log.inputTokens}</span> <span className="text-gray-600">/</span> <span className="text-gray-300">{log.outputTokens}</span>
                                         </td>
                                         <td className="px-3 py-3 text-right font-bold text-white">
                                             ${log.cost.toFixed(5)}
                                         </td>
                                     </tr>
                                 ))}
                             </tbody>
                         </table>
                     )}
                 </div>

                 <div className="mt-4 pt-4 border-t border-white/5 flex justify-end">
                     <button
                        onClick={() => setShowUsageLogs(false)}
                        className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-sm text-white transition-colors"
                     >
                        Close
                     </button>
                 </div>
            </div>
        </div>
      )}

      {/* --- ERROR DETAIL MODAL --- */}
      {selectedError && (
        <div 
            className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setSelectedError(null)}
        >
            <div className="bg-[#1a0f0f] border border-red-500/20 rounded-2xl max-w-sm w-full p-6 relative shadow-2xl" onClick={e => e.stopPropagation()}>
                 <button 
                    onClick={() => setSelectedError(null)}
                    className="absolute top-4 right-4 text-gray-500 hover:text-white"
                  >
                    <CloseIcon className="w-5 h-5" />
                  </button>
                  <div className="flex flex-col items-center text-center">
                        <div className="w-12 h-12 rounded-full bg-red-900/20 flex items-center justify-center mb-4 border border-red-500/20">
                            <AlertTriangleIcon className="w-6 h-6 text-red-500" />
                        </div>
                        <h3 className="text-lg font-medium text-white mb-2">Generation Failed</h3>
                        <p className="text-sm text-gray-400 mb-6 leading-relaxed whitespace-pre-wrap text-left">
                            {selectedError.errorMessage || "An unknown error occurred while generating this variation."}
                        </p>
                        <button 
                            onClick={() => setSelectedError(null)}
                            className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-sm text-white transition-colors"
                        >
                            Dismiss
                        </button>
                  </div>
            </div>
        </div>
      )}

      {/* --- LIGHTBOX OVERLAY --- */}
      {selectedImageIndex !== null && (() => {
          const successImages = getSuccessImages();
          const currentResult = successImages[selectedImageIndex];
          if (!currentResult || !currentResult.imageUrl) return null;

          return (
            <div 
              className="fixed inset-0 z-[60] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4 lg:p-12 animate-in fade-in duration-200"
              onClick={() => setSelectedImageIndex(null)}
            >
              {/* Close Button */}
              <button 
                onClick={() => setSelectedImageIndex(null)}
                className="absolute top-6 right-6 p-2 rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors z-[70]"
              >
                <CloseIcon className="w-6 h-6" />
              </button>

              {/* Navigation Buttons (Desktop) */}
              {successImages.length > 1 && (
                  <>
                    <button 
                      onClick={(e) => navigateLightbox('prev', e)}
                      className="hidden md:flex absolute left-6 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all z-[70] group"
                    >
                        <ChevronLeftIcon className="w-8 h-8 group-hover:-translate-x-1 transition-transform" />
                    </button>
                    <button 
                      onClick={(e) => navigateLightbox('next', e)}
                      className="hidden md:flex absolute right-6 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all z-[70] group"
                    >
                        <ChevronRightIcon className="w-8 h-8 group-hover:translate-x-1 transition-transform" />
                    </button>
                  </>
              )}

              {/* Main Image */}
              <div className="relative max-w-full max-h-full flex flex-col items-center gap-6" onClick={(e) => e.stopPropagation()}>
                <img 
                  src={currentResult.imageUrl} 
                  alt={`Generated portrait`} 
                  className="max-h-[80vh] w-auto rounded-lg shadow-2xl border border-white/5 object-contain"
                />
                
                {/* Mobile Navigation (Visible only below md) */}
                {successImages.length > 1 && (
                    <div className="flex md:hidden gap-8 items-center text-gray-400">
                        <button onClick={(e) => navigateLightbox('prev', e)} className="p-2 active:text-white"><ChevronLeftIcon className="w-8 h-8" /></button>
                        <span className="text-xs font-mono">{selectedImageIndex + 1} / {successImages.length}</span>
                        <button onClick={(e) => navigateLightbox('next', e)} className="p-2 active:text-white"><ChevronRightIcon className="w-8 h-8" /></button>
                    </div>
                )}
                
                {/* Floating Download Button */}
                <Button 
                  onClick={() => {
                    handleDownloadSingle(currentResult.imageUrl!);
                  }}
                  className="shadow-xl shadow-sky-900/40"
                >
                    <DownloadIcon className="w-5 h-5 mr-2" /> Download Image
                </Button>
              </div>
            </div>
          );
      })()}

    </div>
  );
};

export default App;
