import React from 'react';

interface LoadingSpinnerProps {
  message?: string;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ message = 'Carregando...' }) => {
  return (
    <div className="flex items-center justify-center p-4">
      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-fuchsia-400"></div>
      <p className="ml-3 text-lg text-fuchsia-400">{message}</p>
    </div>
  );
};

export default LoadingSpinner;