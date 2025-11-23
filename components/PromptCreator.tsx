

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { geminiService } from '../services/geminiService';
import LoadingSpinner from './LoadingSpinner';
import { languageOptions } from '../utils/appUtils';

// Image type options for the dropdown
const IMAGE_TYPE_OPTIONS = [
  { value: 'Realistic Full HD', label: 'Realista Full HD' },
  { value: 'Watercolor Painting', label: 'Pintura em Aquarela' },
  { value: 'Oil Painting', label: 'Pintura a Óleo' },
  { value: 'Cartoon Style', label: 'Estilo Desenho Animado' },
  { value: 'Sci-Fi', label: 'Ficção Científica' },
  { value: 'Fantasy Art', label: 'Arte Fantástica' },
  { value: 'Concept Art', label: 'Arte Conceitual' },
  { value: 'Cyberpunk', label: 'Cyberpunk' },
  { value: 'Abstract Art', label: 'Arte Abstrata' },
  { value: 'Vintage Photography', label: 'Fotografia Vintage' },
  { value: 'Sketch Drawing', label: 'Desenho a Lápis' },
  { value: 'Anime Style', label: 'Estilo Anime' },
  { value: 'Pixel Art', label: 'Pixel Art' },
];

// Helper function to convert File to Base64
const fileToBase64 = (file: File): Promise<{ base64: string; mimeType: string; blobUrl: string }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const [mimePart, dataPart] = reader.result.split(',');
        const mimeType = mimePart.split(':')[1].split(';')[0];
        const blobUrl = URL.createObjectURL(file); // Create object URL for thumbnail
        resolve({ base64: dataPart, mimeType, blobUrl });
      } else {
        reject(new Error("Falha ao ler o arquivo como URL de dados."));
      }
    };
    reader.onerror = (error) => reject(error);
  });
};

const PromptCreator: React.FC = () => {
  const [selectedImage, setSelectedImage] = useState<{ base64: string; mimeType: string; blobUrl: string } | null>(null);
  const [textPrompt, setTextPrompt] = useState<string>(''); // NEW: State for text input
  const [generatedPrompts, setGeneratedPrompts] = useState<string[]>([]); // Changed from single string to array
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('en'); // Default to English as requested
  const [selectedImageType, setSelectedImageType] = useState<string>('Realistic Full HD'); // Default to "Realistic Full HD"
  const [numScenes, setNumScenes] = useState<number>(5); // NEW: State for number of scene prompts
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // NEW: States for character and action inputs
  const [character1, setCharacter1] = useState<string>('');
  const [character2, setCharacter2] = useState<string>('');
  const [character3, setCharacter3] = useState<string>('');
  const [character4, setCharacter4] = useState<string>('');
  const [character5, setCharacter5] = useState<string>('');
  const [actionPrompt, setActionPrompt] = useState<string>('');

  // NEW: State for selected aspect ratio for generated images
  const [selectedImageAspectRatio, setSelectedImageAspectRatio] = useState<'1:1' | '16:9' | '9:16'>('1:1');

  // NEW: States for image generation per prompt. Will store data:image/png;base64 strings directly.
  const [generatedImages, setGeneratedImages] = useState<Record<number, string | null>>({});
  const [imageLoadingStates, setImageLoadingStates] = useState<Record<number, boolean>>({});
  const [imageErrors, setImageErrors] = useState<Record<number, string | null>>({});
  const [isGeneratingAllImages, setIsGeneratingAllImages] = useState<boolean>(false); // NEW: State for "Generate All Images"

  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null); // Ref for the main container to attach paste listener

  // Derived state to check if any character or action input is active
  const hasCharacterOrActionInput =
    !!character1.trim() ||
    !!character2.trim() ||
    !!character3.trim() ||
    !!character4.trim() ||
    !!character5.trim() ||
    !!actionPrompt.trim();

  // Clean up Blob URLs on component unmount or image change for the selected image.
  // Generated images (data:image/png;base64) do not need manual revocation.
  useEffect(() => {
    return () => {
      if (selectedImage?.blobUrl) {
        URL.revokeObjectURL(selectedImage.blobUrl);
      }
    };
  }, [selectedImage]);

  // Effect to handle paste events
  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
      if (isLoading || isGeneratingAllImages) return; // Do not process paste if already loading

      const items = event.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith('image/')) {
            event.preventDefault(); // Prevent default paste behavior
            setError(null);
            try {
              const file = item.getAsFile();
              if (file) {
                const { base64, mimeType, blobUrl } = await fileToBase64(file);
                // Revoke previous blob URL if exists
                if (selectedImage?.blobUrl) {
                  URL.revokeObjectURL(selectedImage.blobUrl);
                }
                setSelectedImage({ base64, mimeType, blobUrl });
                setTextPrompt(''); // Clear text prompt when image is pasted
                setCharacter1(''); // Clear character inputs
                setCharacter2('');
                setCharacter3('');
                setCharacter4('');
                setCharacter5('');
                setActionPrompt(''); // Clear action input
              }
            } catch (e: any) {
              setError(`Erro ao colar a imagem: ${e.message}`);
              setSelectedImage(null);
            }
            return; // Process only the first image found
          }
        }
      }
    };

    // Attach paste listener to the document body
    document.body.addEventListener('paste', handlePaste);

    // Clean up event listener
    return () => {
      document.body.removeEventListener('paste', handlePaste);
    };
  }, [isLoading, isGeneratingAllImages, selectedImage]); // Re-run if isLoading, isGeneratingAllImages or selectedImage changes to update closures

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      setError(null);
      try {
        const { base64, mimeType, blobUrl } = await fileToBase64(files[0]);
        // Revoke previous blob URL if exists
        if (selectedImage?.blobUrl) {
          URL.revokeObjectURL(selectedImage.blobUrl);
        }
        setSelectedImage({ base64, mimeType, blobUrl });
        setTextPrompt(''); // Clear text prompt when image is uploaded
        setCharacter1(''); // Clear character inputs
        setCharacter2('');
        setCharacter3('');
        setCharacter4('');
        setCharacter5('');
        setActionPrompt(''); // Clear action input
      } catch (e: any) {
        setError(`Erro ao carregar a imagem: ${e.message}`);
        setSelectedImage(null);
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''; // Reset input to allow re-uploading the same file
    }
  }, [selectedImage]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true); // Set dragging state to true
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false); // Set dragging state to false
  }, []);

  const handleDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false); // Reset dragging state
    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      setError(null);
      try {
        const { base64, mimeType, blobUrl } = await fileToBase64(files[0]);
        if (selectedImage?.blobUrl) {
          URL.revokeObjectURL(selectedImage.blobUrl);
        }
        setSelectedImage({ base64, mimeType, blobUrl });
        setTextPrompt(''); // Clear text prompt when image is dropped
        setCharacter1(''); // Clear character inputs
        setCharacter2('');
        setCharacter3('');
        setCharacter4('');
        setCharacter5('');
        setActionPrompt(''); // Clear action input
      } catch (e: any) {
        setError(`Erro ao carregar a imagem: ${e.message}`);
        setSelectedImage(null);
      }
    }
  }, [selectedImage]);

  const handleClearImage = useCallback(() => {
    if (selectedImage?.blobUrl) {
      URL.revokeObjectURL(selectedImage.blobUrl);
    }
    setSelectedImage(null);
    setGeneratedPrompts([]); // Clear previous prompts
    setGeneratedImages({}); // Clear previous images
    setImageLoadingStates({});
    setImageErrors({});
  }, [selectedImage]);

  const handleGeneratePrompt = useCallback(async () => {
    if (isLoading || isGeneratingAllImages) return;
    setError(null);
    setGeneratedPrompts([]); // Clear previous prompts
    setGeneratedImages({}); // Clear previous images
    setImageLoadingStates({});
    setImageErrors({});
    setIsLoading(true);

    if (!selectedImage && !textPrompt.trim() && !hasCharacterOrActionInput) { // Updated validation
      setError("Por favor, carregue uma imagem OU insira um texto para gerar o prompt. Ou descreva personagens e ação.");
      setIsLoading(false);
      return;
    }
    if (numScenes < 1 || numScenes > 10) {
      setError("A quantidade de cenas/prompts deve ser entre 1 e 10.");
      setIsLoading(false);
      return;
    }

    try {
      const activeCharacters = [character1, character2, character3, character4, character5].filter(c => c.trim());

      const result = await geminiService.generateImagePrompt(
        selectedImage?.base64 || null, // Pass null if no image
        selectedImage?.mimeType || null, // Pass null if no image
        selectedLanguage,
        selectedImageType,
        numScenes, // Pass numScenes to the service
        textPrompt, // Pass textPrompt to the service (will be ignored if characters/action provided by service)
        activeCharacters.length > 0 ? activeCharacters : undefined, // Pass characters if any
        actionPrompt.trim() ? actionPrompt : undefined // Pass action if present
      );

      // result can be a string (for numScenes=1) or string[] (for numScenes > 1)
      if (Array.isArray(result)) {
        setGeneratedPrompts(result);
      } else {
        setGeneratedPrompts([result]); // Wrap single prompt in an array for consistent state
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Ocorreu um erro inesperado ao gerar o prompt.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, isGeneratingAllImages, selectedImage, textPrompt, selectedLanguage, selectedImageType, numScenes,
    character1, character2, character3, character4, character5, actionPrompt, hasCharacterOrActionInput]); // Added all new states to dependencies

  const handleCopySinglePrompt = useCallback((promptToCopy: string) => {
    if (promptToCopy) {
      navigator.clipboard.writeText(promptToCopy).then(() => {
        console.log('Prompt copied to clipboard!');
        // Optionally, provide user feedback, e.g., a temporary "Copiado!" message
      }).catch(err => {
        console.error('Failed to copy prompt:', err);
        setError('Falha ao copiar o prompt.');
      });
    }
  }, []);

  const handleGenerateImageForPrompt = useCallback(async (promptString: string, index: number) => {
    // Prevent multiple image generations for the same prompt simultaneously
    if (imageLoadingStates[index]) return;

    setImageLoadingStates(prev => ({ ...prev, [index]: true }));
    setImageErrors(prev => ({ ...prev, [index]: null }));
    setGeneratedImages(prev => {
      // No URL.revokeObjectURL needed here as generatedImages now stores data: URLs.
      return { ...prev, [index]: null };
    }); // Clear previous image for this prompt

    try {
      // geminiService.generateImage already returns a data:image/png;base64 string
      const dataUrl = await geminiService.generateImage(promptString, selectedImageAspectRatio); // Pass selectedImageAspectRatio
      // Store the data URL directly
      setGeneratedImages(prev => ({ ...prev, [index]: dataUrl }));
    } catch (err: unknown) {
      let errorMessage = err instanceof Error ? err.message : "Ocorreu um erro inesperado ao gerar a imagem.";
      if (errorMessage.includes("Requested entity was not found.") || errorMessage.includes("Imagen API is only accessible to billed users")) {
          // Provide specific guidance for API key/billing issues
          errorMessage = "A geração de imagens (Imagen API) requer uma chave de API válida e uma conta com faturamento configurado. Por favor, verifique sua conta. Link para documentação: ai.google.dev/gemini-api/docs/billing";
      }
      setImageErrors(prev => ({ ...prev, [index]: errorMessage }));
      setError(errorMessage); // Also set global error for overall visibility
    } finally {
      setImageLoadingStates(prev => ({ ...prev, [index]: false }));
    }
  }, [imageLoadingStates, selectedImageAspectRatio]); // Depend on imageLoadingStates and selectedImageAspectRatio

  const handleGenerateAllImagesForPrompts = useCallback(async () => {
    if (isGeneratingAllImages || isLoading || generatedPrompts.length === 0) return;

    setIsGeneratingAllImages(true);
    setError(null);
    setGeneratedImages({}); // Clear all previous images
    setImageErrors({}); // Clear all previous image errors
    setImageLoadingStates({}); // Clear all previous image loading states

    try {
      for (let i = 0; i < generatedPrompts.length; i++) {
        const prompt = generatedPrompts[i];
        await handleGenerateImageForPrompt(prompt, i); // Generate image for each prompt
        // Small delay between calls to avoid hitting rate limits too quickly, if any, and for better UI feedback
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (err: unknown) {
      // Errors are already handled by handleGenerateImageForPrompt for individual images
      console.error("Erro ao gerar todas as imagens:", err);
      // No need to set global error here again, as individual errors are handled.
    } finally {
      setIsGeneratingAllImages(false);
    }
  }, [isGeneratingAllImages, isLoading, generatedPrompts, handleGenerateImageForPrompt]);

  const handleDownloadImage = useCallback((imageUrl: string, index: number) => {
    if (imageUrl) {
      const filename = `imagem_cena_${index + 1}_${Date.now()}.png`;
      const a = document.createElement('a');
      a.href = imageUrl; // imageUrl is already a data:image/png;base64 string
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // No URL.revokeObjectURL here, as data: URLs do not require it.
    }
  }, []);

  // Helper to render error message with clickable link if it contains the billing URL
  const renderErrorContent = (message: string) => {
    const billingUrl = "ai.google.dev/gemini-api/docs/billing";
    if (message.includes(billingUrl)) {
      const parts = message.split(billingUrl);
      return (
        <>
          {parts[0]}
          <a href={`https://${billingUrl}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline font-bold">
            {billingUrl}
          </a>
          {parts.slice(1).join(billingUrl)}
        </>
      );
    }
    return message;
  };


  // Determine if the general text prompt input should be disabled
  const isTextPromptInputDisabled = isLoading || isGeneratingAllImages || hasCharacterOrActionInput;
  // Determine if character/action inputs should be disabled
  const isCharacterActionInputDisabled = isLoading || isGeneratingAllImages || !!textPrompt.trim();


  const isFormInvalid = (!selectedImage && !textPrompt.trim() && !hasCharacterOrActionInput) || numScenes < 1 || numScenes > 10; // Updated validation

  return (
    <div className="flex flex-col h-full" ref={containerRef}>
      <h2 className="text-3xl sm:text-4xl font-extrabold text-fuchsia-300 leading-tight drop-shadow-md text-center mb-8">
        Criador de Prompt
      </h2>

      {/* Image Input Area */}
      <div
        className={`mb-6 p-6 border-2 rounded-lg text-center cursor-pointer transition-all duration-300
          ${isDragging ? 'border-fuchsia-400 bg-purple-900' : selectedImage ? 'border-purple-700 bg-gray-800' : 'border-dashed border-purple-600 bg-gray-800'}
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        aria-label="Área para arrastar e soltar imagens, clicar para selecionar ou colar (Ctrl+V)"
        role="button"
        tabIndex={0}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
          accept="image/png, image/jpeg, image/webp"
          disabled={isLoading || isGeneratingAllImages}
        />
        {selectedImage ? (
          <div className="flex flex-col items-center">
            <img src={selectedImage.blobUrl} alt="Imagem selecionada para análise" className="max-w-full h-auto max-h-48 rounded-lg shadow-md mb-4" />
            <p className="text-lg font-semibold text-fuchsia-200 mb-2">Imagem carregada.</p>
            <button
              onClick={(e) => { e.stopPropagation(); handleClearImage(); }}
              className="px-4 py-2 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors shadow-md mt-2"
              disabled={isLoading || isGeneratingAllImages}
              aria-label="Remover imagem selecionada"
            >
              Remover Imagem
            </button>
          </div>
        ) : (
          <>
            <p className="text-xl font-semibold text-fuchsia-200 mb-2">🖼️ Arraste e solte uma imagem aqui</p>
            <p className="text-purple-400">ou clique para selecionar / cole (Ctrl+V)</p>
          </>
        )}
      </div>

      {/* NEW: Text Input Field */}
      <div className="mb-6">
        <label htmlFor="textPromptInput" className="block text-xl font-semibold text-purple-300 mb-2">
          Descreva sua Ideia ou Objeto (Opcional):
        </label>
        <textarea
          id="textPromptInput"
          value={textPrompt}
          onChange={(e) => {
            setTextPrompt(e.target.value);
            // Clear other inputs if this one is actively being used.
            if (hasCharacterOrActionInput && e.target.value.length > 0) {
              setCharacter1('');
              setCharacter2('');
              setCharacter3('');
              setCharacter4('');
              setCharacter5('');
              setActionPrompt('');
            }
          }}
          className="w-full p-3 border border-purple-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-400 text-lg bg-gray-800 disabled:bg-gray-700 disabled:text-gray-400 shadow-sm text-white placeholder-purple-400 min-h-[100px]"
          placeholder="Ex: Um gato cibernético com óculos de sol em uma cidade futurista."
          rows={4}
          disabled={isTextPromptInputDisabled}
          aria-label="Descrição da ideia para gerar prompt"
        />
        <p className="text-sm text-purple-400 mt-2">
          Adicione uma descrição textual para guiar a criação do prompt, ou para gerar um prompt apenas com base no texto.
        </p>
      </div>

      {/* NEW SECTION: Generate Through Characters */}
      <div className="mb-6 p-6 bg-gray-800 rounded-xl shadow-inner border border-purple-700">
        <h3 className="text-2xl font-bold text-fuchsia-300 mb-4 text-center">Gerar Através de Personagens e Ação</h3>
        <p className="text-md text-purple-300 mb-4 text-center">Descreva os personagens e a ação para gerar prompts mais detalhados.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {[
            { label: 'Personagem 1', value: character1, setter: setCharacter1 },
            { label: 'Personagem 2', value: character2, setter: setCharacter2 },
            { label: 'Personagem 3', value: character3, setter: setCharacter3 },
            { label: 'Personagem 4', value: character4, setter: setCharacter4 },
            { label: 'Personagem 5', value: character5, setter: setCharacter5 },
          ].map((field, index) => (
            <div key={index}>
              <label htmlFor={`character-${index + 1}`} className="block text-md font-semibold text-purple-300 mb-1">
                {field.label}:
              </label>
              <input
                id={`character-${index + 1}`}
                type="text"
                value={field.value}
                onChange={(e) => {
                  field.setter(e.target.value);
                  // Clear textPrompt if any character input is actively being used
                  if (!!textPrompt.trim() && e.target.value.length > 0) {
                    setTextPrompt('');
                  }
                }}
                className="w-full p-2 border border-purple-600 rounded-lg focus:outline-none focus:ring-1 focus:ring-fuchsia-400 text-base bg-gray-800 disabled:bg-gray-700 disabled:text-gray-400 shadow-sm text-white placeholder-purple-400"
                placeholder={`Nome ou breve descrição do ${field.label.toLowerCase()}`}
                disabled={isCharacterActionInputDisabled}
                aria-label={field.label}
              />
            </div>
          ))}
        </div>

        <div>
          <label htmlFor="actionPromptInput" className="block text-xl font-semibold text-purple-300 mb-2">
            Ação Principal:
          </label>
          <textarea
            id="actionPromptInput"
            value={actionPrompt}
            onChange={(e) => {
              setActionPrompt(e.target.value);
              // Clear textPrompt if action input is actively being used
              if (!!textPrompt.trim() && e.target.value.length > 0) {
                setTextPrompt('');
              }
            }}
            className="w-full p-3 border border-purple-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-400 text-lg bg-gray-800 disabled:bg-gray-700 disabled:text-gray-400 shadow-sm text-white placeholder-purple-400 min-h-[100px]"
            placeholder="Ex: Os heróis embarcam em uma nave espacial em direção a um planeta desconhecido."
            rows={4}
            disabled={isCharacterActionInputDisabled}
            aria-label="Descrição da ação principal"
          />
          <p className="text-sm text-purple-400 mt-2">Descreva a ação ou o evento central da cena que você deseja gerar.</p>
        </div>
      </div>


      {/* Options Section */}
      <div className="mb-6 flex flex-col sm:flex-row gap-4">
        {/* Language Dropdown */}
        <div className="flex-1">
          <label htmlFor="promptLanguage" className="block text-xl font-semibold text-purple-300 mb-2">
            Idioma do Prompt:
          </label>
          <select
            id="promptLanguage"
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value)}
            className="w-full p-3 border border-purple-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-400 text-lg bg-gray-800 disabled:bg-gray-700 disabled:text-gray-400 shadow-sm text-white"
            disabled={isLoading || isGeneratingAllImages}
            aria-label="Selecione o idioma para o prompt gerado"
          >
            {languageOptions.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.name}
              </option>
            ))}
          </select>
        </div>

        {/* Image Type Dropdown */}
        <div className="flex-1">
          <label htmlFor="imageType" className="block text-xl font-semibold text-purple-300 mb-2">
            Tipo de Imagem:
          </label>
          <select
            id="imageType"
            value={selectedImageType}
            onChange={(e) => setSelectedImageType(e.target.value)}
            className="w-full p-3 border border-purple-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-400 text-lg bg-gray-800 disabled:bg-gray-700 disabled:text-gray-400 shadow-sm text-white"
            disabled={isLoading || isGeneratingAllImages}
            aria-label="Selecione o estilo ou tipo de imagem"
          >
            {IMAGE_TYPE_OPTIONS.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* NEW: Number of Scenes Input */}
      <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <label htmlFor="numScenes" className="block text-xl font-semibold text-purple-300 min-w-max">
          Quantidade de Cenas/Prompts:
        </label>
        <input
          id="numScenes"
          type="number"
          value={numScenes}
          onChange={(e) => setNumScenes(Number(e.target.value))}
          className="w-28 p-3 border border-purple-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-400 text-lg bg-gray-800 disabled:bg-gray-700 disabled:text-gray-400 shadow-sm text-white text-center"
          min="1"
          max="10"
          disabled={isLoading || isGeneratingAllImages}
          aria-label="Quantidade de prompts de cena a gerar"
        />
        <span className="text-sm text-purple-400">(1 a 10)</span>
      </div>

      {/* NEW: Aspect Ratio Selector for generated images */}
      <div className="mb-6">
        <label htmlFor="generatedImageAspectRatio" className="block text-xl font-semibold text-purple-300 mb-2">
          Proporção da Imagem Gerada:
        </label>
        <select
          id="generatedImageAspectRatio"
          value={selectedImageAspectRatio}
          onChange={(e) => setSelectedImageAspectRatio(e.target.value as '1:1' | '16:9' | '9:16')}
          className="w-full p-3 border border-purple-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-400 text-lg bg-gray-800 disabled:bg-gray-700 disabled:text-gray-400 shadow-sm text-white"
          disabled={isLoading || isGeneratingAllImages}
          aria-label="Selecione a proporção das imagens geradas"
        >
          <option value="1:1">Quadrado (1:1)</option>
          <option value="16:9">Paisagem (16:9)</option>
          <option value="9:16">Reels/Retrato (9:16)</option>
        </select>
      </div>


      {error && (
        <div className="bg-red-800 border border-red-600 text-red-200 px-4 py-3 rounded-lg relative mb-6" role="alert">
          <strong className="font-bold">Erro: </strong>
          <span className="block sm:inline">{renderErrorContent(error)}</span>
        </div>
      )}

      {isLoading && <LoadingSpinner message="Analisando imagem e criando prompts de cena..." />}
      {isGeneratingAllImages && <LoadingSpinner message="Gerando todas as imagens (aguarde)..." />}


      {generatedPrompts.length > 0 && !(isLoading || isGeneratingAllImages) && (
        <div className="mb-4 flex justify-center">
          <button
            onClick={handleGenerateAllImagesForPrompts}
            disabled={isLoading || isGeneratingAllImages || generatedPrompts.length === 0}
            className={`px-8 py-4 rounded-full text-white font-semibold text-xl shadow-lg hover:shadow-xl transform transition-all duration-300 hover:scale-105 active:scale-95
              ${isLoading || isGeneratingAllImages || generatedPrompts.length === 0
                ? 'bg-gradient-to-r from-gray-600 to-gray-700 cursor-not-allowed shadow-md'
                : 'bg-gradient-to-r from-fuchsia-500 to-pink-600 hover:from-fuchsia-600 hover:to-pink-700 focus:outline-none focus:ring-4 focus:ring-pink-300'
              }`}
            aria-label="Gerar todas as imagens para os prompts"
          >
            Gerar Todas Imagens de Todos os Prompts
          </button>
        </div>
      )}

      {generatedPrompts.length > 0 && !isLoading && (
        <div className="bg-gray-800 p-6 rounded-xl shadow-inner mb-6 border border-purple-700 flex-grow overflow-y-auto">
          <h3 className="text-2xl font-bold text-fuchsia-300 mb-4">Prompts de Cena Gerados:</h3>
          <div className="space-y-4">
            {generatedPrompts.map((prompt, index) => (
              <div key={index} className="relative group p-4 bg-gray-900 rounded-lg shadow-sm border border-purple-700">
                <label htmlFor={`scene-prompt-${index}`} className="block text-xl font-semibold text-purple-300 mb-2">
                  Cena {index + 1}:
                </label>
                <textarea
                  id={`scene-prompt-${index}`}
                  readOnly
                  value={prompt}
                  className="w-full p-3 border border-purple-600 rounded-lg bg-gray-800 text-white min-h-[120px] resize-y focus:outline-none focus:ring-1 focus:ring-fuchsia-400"
                  aria-label={`Prompt para cena ${index + 1}`}
                />
                <button
                  onClick={() => handleCopySinglePrompt(prompt)}
                  className="absolute top-4 right-4 p-2 bg-purple-500 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 focus:outline-none focus:ring-2 focus:ring-purple-400"
                  aria-label={`Copiar prompt da cena ${index + 1}`}
                  title="Copiar prompt"
                >
                  📋
                </button>

                {/* Image Generation Section for each prompt */}
                <div className="mt-6 pt-4 border-t border-purple-700 flex flex-col items-center">
                  <button
                    onClick={() => handleGenerateImageForPrompt(prompt, index)}
                    disabled={imageLoadingStates[index] || isGeneratingAllImages}
                    className={`px-6 py-3 rounded-full text-white font-semibold text-lg shadow-lg hover:shadow-xl transform transition-all duration-300 hover:scale-105 active:scale-95
                      ${imageLoadingStates[index] || isGeneratingAllImages
                        ? 'bg-gradient-to-r from-gray-600 to-gray-700 cursor-not-allowed shadow-md'
                        : 'bg-gradient-to-r from-lime-500 to-green-500 hover:from-lime-600 hover:to-green-600 focus:outline-none focus:ring-4 focus:ring-green-300'
                      }`}
                    aria-label={`Gerar imagem para o prompt ${index + 1}`}
                  >
                    {imageLoadingStates[index] ? 'Gerando Imagem...' : '✨ Gerar Imagem'}
                  </button>

                  {imageLoadingStates[index] && (
                    <div className="mt-4 w-full">
                      <LoadingSpinner message="Gerando imagem para este prompt..." />
                    </div>
                  )}

                  {imageErrors[index] && (
                    <div className="bg-red-800 border border-red-600 text-red-200 px-4 py-3 rounded-lg relative mt-4 w-full text-sm" role="alert">
                      <strong className="font-bold">Erro na imagem: </strong>
                      <span className="block sm:inline">{renderErrorContent(imageErrors[index]!)}</span>
                    </div>
                  )}

                  {generatedImages[index] && !imageLoadingStates[index] && (
                    <div className="mt-4 bg-gray-800 p-4 rounded-xl shadow-inner border border-purple-700 w-full flex flex-col items-center">
                      <img
                        src={generatedImages[index]!}
                        alt={`Imagem gerada para o prompt ${index + 1}`}
                        className="max-w-full h-auto rounded-lg shadow-md max-h-[400px]"
                      />
                      <button
                        onClick={() => handleDownloadImage(generatedImages[index]!, index)}
                        className="mt-4 px-6 py-3 rounded-full bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-300 text-white font-semibold text-lg shadow-lg hover:shadow-xl transform transition-all duration-300 hover:scale-105 active:scale-95 flex items-center justify-center space-x-2"
                        aria-label={`Baixar imagem da cena ${index + 1}`}
                        title="Baixar imagem"
                      >
                        <span className="text-xl">⬇️</span>
                        <span>Baixar Imagem</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto flex justify-center">
        <button
          onClick={handleGeneratePrompt}
          disabled={isFormInvalid || isLoading || isGeneratingAllImages}
          className={`px-8 py-4 rounded-full text-white font-semibold text-xl shadow-lg hover:shadow-xl transform transition-all duration-300 hover:scale-105 active:scale-95
            ${isFormInvalid || isLoading || isGeneratingAllImages
              ? 'bg-gradient-to-r from-gray-600 to-gray-700 cursor-not-allowed shadow-md'
              : 'bg-gradient-to-r from-fuchsia-600 to-purple-700 hover:from-fuchsia-700 hover:to-purple-800 focus:outline-none focus:ring-4 focus:ring-fuchsia-400'
            }`}
          aria-label="Gerar Prompt(s)"
        >
          {isLoading ? 'Gerando Prompt(s)...' : 'Gerar Prompt(s)'}
        </button>
      </div>
    </div>
  );
};

export default PromptCreator;