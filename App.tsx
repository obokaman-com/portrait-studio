
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { UploadedPhoto, CharacterDetail, GenerationResult } from './types';
import { resizeImageToBase64, createAndDownloadZip } from './utils/fileUtils';
import { generateSinglePortrait, analyzePhotoForCharacters, optimizePrompt, constructPromptPayload, generateDynamicScenario } from './services/geminiService';
import FileUpload from './components/FileUpload';
import ImageGrid from './components/ImageGrid';
import Spinner from './components/Spinner';
import { DownloadIcon, SparklesIcon, TrashIcon, WandIcon, PlusCircleIcon, CloseIcon, ChevronLeftIcon, ChevronRightIcon, AlertTriangleIcon, OboLogo, UploadIcon } from './components/icons';
import Button from './components/Button';
import GenerationOptions from './components/GenerationOptions';
import StyleSelector from './components/StyleSelector';

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
  const [isCheckingKey, setIsCheckingKey] = useState<boolean>(true);
  
  // Lightbox State: Using Index instead of String for easier navigation
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);

  // Refs
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null); // Ref to trigger upload from right panel
  
  // CACHE REFS for Optimization
  const lastUsedScenePromptRef = useRef<string>('');
  const cachedOptimizedPromptRef = useRef<string>('');

  useEffect(() => {
    const checkKey = async () => {
      try {
        if ((window as any).aistudio && await (window as any).aistudio.hasSelectedApiKey()) {
          setHasApiKey(true);
        }
      } catch (e) {
        console.error("Error checking API key:", e);
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
        await (window as any).aistudio.openSelectKey();
        setHasApiKey(true);
      }
    } catch (e) {
      console.error("Error selecting API key:", e);
    }
  };

  const handleApiError = (err: any) => {
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (errorMessage.includes('Requested entity was not found')) {
      setHasApiKey(false);
      setGlobalError('Session expired or invalid API Key. Please select your key again.');
    } else {
      setGlobalError(errorMessage);
    }
  };

  // Helper to determine smart names
  const getSmartName = (fileName: string, globalIndex: number) => {
      const cleanName = fileName.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
      // Heuristic: If name looks like a generic camera dump (IMG, DSC, digits, too short), use Subject X
      const isGenericFilename = /(^img|^dsc|^pic|^screenshot|^whatsapp|^video|\d{4,})/i.test(cleanName) || cleanName.length < 3;
      
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
        // Increment for next file just in case, though usually 1 file = 1 person initially
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

        const describedCharacters = await analyzePhotoForCharacters(imagePart as any, photo.file.name);
        
        // Preserve the smart name we calculated, don't let AI overwrite it with "Subject 1"
        // unless we want to support multi-person detection naming (which is hard to map).
        // For now, we assume if AI finds multiple, we append generic names, but for the first one, keep ours.
        const newCharacters: CharacterDetail[] = describedCharacters.map((char, index) => ({
          ...char,
          id: `${photo.id}-char-${index}`,
          name: index === 0 ? smartName : `Subject ${runningCharCount + index}`, // Use smart name for primary, generic for others found
          isDescriptionLoading: false,
        }));
        
        // Update running count if multiple people were found in one photo
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
          const generatedScenario = await generateDynamicScenario(scenarioTheme, totalChars);
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
          optimizedPrompt = await optimizePrompt(scenePrompt);
          if (controller.signal.aborted) return;
          
          // Update Cache
          lastUsedScenePromptRef.current = scenePrompt;
          cachedOptimizedPromptRef.current = optimizedPrompt;
      }
      
      // We always reconstruct payload because photos/characters might have changed even if scene didn't
      const { imageParts, fullPrompt } = await constructPromptPayload(photos, optimizedPrompt);
      if (controller.signal.aborted) return;
      
      setFullGeneratedPrompt(fullPrompt);
      setIsPromptOptimizing(false);
      setLoadingMessage(`Rendering ${numImages} portraits...`);

      const creativeVariations = [
        '(Creative variation 1)', '(Creative variation 2, different camera angle)',
        '(Creative variation 3, different expressions)', '(Creative variation 4, dynamic group pose)',
        '(Creative variation 5, slightly different lighting)', '(Creative variation 6, cinematic style)',
        '(Creative variation 7, candid moment)', '(Creative variation 8, formal portrait style)',
      ];

      // 3. Parallel Execution with Individual Updates
      const promises = placeholders.map((placeholder, index) => {
          const promptVariation = `${fullPrompt}\n${creativeVariations[index % creativeVariations.length]}`;
          
          return generateSinglePortrait(imageParts, promptVariation, controller.signal)
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
                setGenerationResults(prev => prev.map(res => 
                    res.id === placeholder.id 
                    ? { ...res, status: 'error', errorMessage: errMsg } 
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
  }, [photos, scenePrompt, numImages]);
  
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

  const isCharacterAnalysisPending = photos.some(p => p.characters.some(c => c.isDescriptionLoading));
  const totalCharacters = photos.reduce((acc, p) => acc + p.characters.length, 0);

  // --- UI LOGIC ---
  const step1Complete = photos.length > 0;
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
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="bg-[#0f0f0f] border border-white/10 rounded-3xl max-w-md w-full p-8 text-center shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 via-sky-500 to-purple-500" />
                <div className="w-16 h-16 bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-inner ring-1 ring-white/5">
                    <OboLogo className="w-10 h-10" />
                </div>
                <h1 className="text-2xl font-light text-white mb-2 tracking-wide">Studio Access</h1>
                <p className="text-gray-400 mb-8 font-light leading-relaxed">
                  Unlock the full potential of <span className="text-gray-200">Gemini 3 Pro</span>. 
                  Connect a billing-enabled Google Cloud project to begin.
                </p>
                <Button onClick={handleSelectKey} className="w-full py-4 text-base shadow-lg shadow-sky-900/20">
                    Connect Project API Key
                </Button>
                <div className="mt-6 text-xs text-gray-600">
                    <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="hover:text-gray-400 transition-colors">
                        View Billing Documentation
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
                    <span className="text-sky-500/80 font-mono mr-2">03</span>
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
                   
                   {/* Download All Button (Only shows if at least one success) */}
                   {!isGenerating && generationResults.some(r => r.status === 'success') && (
                       <div className="flex gap-3">
                            <Button 
                                onClick={handleDownloadZip} 
                                className="flex-1 bg-white text-black hover:bg-gray-200"
                            >
                                <DownloadIcon className="w-4 h-4 mr-2" /> Download All (ZIP)
                            </Button>
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
