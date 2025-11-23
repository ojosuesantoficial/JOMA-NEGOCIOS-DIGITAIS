import React, { useState, Suspense } from 'react';
import LoadingSpinner from './components/LoadingSpinner';
import FeatureSelectionMenu from './components/FeatureSelectionMenu'; // Import FeatureSelectionMenu

// Use React.lazy for code splitting
const StoryGenerator = React.lazy(() => import('./components/StoryGenerator'));
const AudioGenerator = React.lazy(() => import('./components/AudioGenerator'));
const ImageGenerator = React.lazy(() => import('./components/ImageGenerator'));
const TitleGenerator = React.lazy(() => import('./components/TitleGenerator'));
// const TitleReducer = React.lazy(() => import('./components/TitleReducer')); // Removido
const PromptCreator = React.lazy(() => import('./components/PromptCreator'));
// const MovImageGenerator = React.lazy(() => import('./components/MovImageGenerator')); // Removido
const StoryFromImageGenerator = React.lazy(() => import('./components/StoryFromImageGenerator')); // NOVO componente

type Feature = 'story' | 'audio' | 'image' | 'title' | 'promptCreator' | 'storyFromImage'; // Atualizado

const App: React.FC = () => {
  const [activeFeature, setActiveFeature] = useState<Feature>('story');

  const renderActiveFeature = () => {
    switch (activeFeature) {
      case 'story':
        return <StoryGenerator />;
      case 'audio':
        return <AudioGenerator />;
      case 'image':
        return <ImageGenerator />;
      case 'title':
        return <TitleGenerator />;
      // case 'titleReducer': // Removido
      //   return <TitleReducer />;
      case 'promptCreator':
        return <PromptCreator />;
      // case 'movImage': // Removido
      //   return <MovImageGenerator />;
      case 'storyFromImage': // NOVO caso para StoryFromImageGenerator
        return <StoryFromImageGenerator />;
      default:
        return <StoryGenerator />;
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-fuchsia-700 via-purple-900 to-indigo-900 text-white">
      {/* Top Header/Feature Selection */}
      <header className="relative w-full z-50 p-4 bg-purple-950 bg-opacity-80 backdrop-filter backdrop-blur-lg shadow-xl mb-8 md:mb-12 rounded-b-3xl">
        <h1 className="text-4xl sm:text-5xl font-extrabold text-white text-center leading-tight drop-shadow-lg mb-4">
          JOMA AI Studio
        </h1>
        <p className="text-lg text-purple-300 text-center mb-6 drop-shadow">Explore suas criações com IA</p>
        <FeatureSelectionMenu activeFeature={activeFeature} onSelectFeature={setActiveFeature} />
      </header>

      {/* Main Content Area with Suspense for lazy loaded components */}
      <main className="flex-grow container mx-auto max-w-5xl bg-gray-900 bg-opacity-80 rounded-3xl shadow-3xl p-6 sm:p-8 flex flex-col border border-purple-700 mb-12 min-h-[600px]">
        <Suspense fallback={<LoadingSpinner message="Carregando funcionalidade..." />}>
          {renderActiveFeature()}
        </Suspense>
      </main>
    </div>
  );
};

export default App;