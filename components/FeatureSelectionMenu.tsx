import React from 'react';

type Feature = 'story' | 'audio' | 'image' | 'title' | 'promptCreator' | 'storyFromImage'; // Atualizado

interface FeatureSelectionMenuProps {
  activeFeature: Feature;
  onSelectFeature: (feature: Feature) => void;
}

const FeatureSelectionMenu: React.FC<FeatureSelectionMenuProps> = ({ activeFeature, onSelectFeature }) => {
  const features: { id: Feature; name: string; icon: string }[] = [
    { id: 'story', name: 'História', icon: '📖' },
    { id: 'storyFromImage', name: 'História da Imagem', icon: '📸' },
    { id: 'audio', name: 'Áudio', icon: '🔊' },
    { id: 'image', name: 'Imagem', icon: '🖼️' },
    { id: 'title', name: 'Título', icon: '📝' },
    // { id: 'titleReducer', name: 'Redutor de Titulo', icon: '✂️' }, // Removido
    { id: 'promptCreator', name: 'Criador de Prompt', icon: '✨' },
    // { id: 'movImage', name: 'Mov Image', icon: '🎥' }, // Removido
  ];

  return (
    <div className="flex flex-wrap justify-center gap-4 p-4 rounded-2xl bg-gray-800 bg-opacity-30 backdrop-blur-sm shadow-inner mx-auto max-w-4xl">
      {features.map((feature) => (
        <button
          key={feature.id}
          onClick={() => onSelectFeature(feature.id)}
          className={`
            flex items-center justify-center px-6 py-3 rounded-full text-lg font-semibold
            shadow-md transition-all duration-300 ease-in-out
            ${activeFeature === feature.id
              ? 'bg-gradient-to-r from-purple-500 to-indigo-600 text-white shadow-xl scale-105'
              : 'bg-gray-800 bg-opacity-30 text-purple-200 hover:bg-opacity-40 hover:scale-105 hover:shadow-lg focus:ring-purple-400'
            }
            focus:outline-none focus:ring-2 focus:ring-opacity-75
            max-w-[160px] w-full sm:w-auto
          `}
          aria-pressed={activeFeature === feature.id}
        >
          <span className="text-2xl mr-2">{feature.icon}</span>
          <span>{feature.name}</span>
        </button>
      ))}

      {/* Plus Button */}
      <button
        className="flex items-center justify-center bg-gradient-to-r from-fuchsia-500 to-pink-600 hover:from-fuchsia-600 hover:to-pink-700 text-white text-3xl font-bold rounded-full w-14 h-14 shadow-lg transform transition-all duration-300 hover:scale-110 active:scale-90 focus:outline-none focus:ring-2 focus:ring-pink-300 focus:ring-opacity-75"
        aria-label="Adicionar nova funcionalidade (em breve)"
        title="Adicionar nova funcionalidade (em breve)"
      >
        +
      </button>
    </div>
  );
};

export default FeatureSelectionMenu;