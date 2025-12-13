
import React from 'react';
import { GenerationResult } from '../types';
import Spinner from './Spinner';
import { AlertTriangleIcon, CloseIcon, RefreshIcon } from './icons';

interface ImageGridProps {
  results: GenerationResult[];
  onImageClick?: (result: GenerationResult) => void;
  onErrorClick?: (result: GenerationResult) => void;
  onRetry?: (result: GenerationResult) => void;
}

const ImageGrid: React.FC<ImageGridProps> = ({ results, onImageClick, onErrorClick, onRetry }) => {
  // Use a masonry-like feel or just a clean responsive grid
  const gridClass = results.length === 2 ? 'grid-cols-1 sm:grid-cols-2' : 
                    results.length === 4 ? 'grid-cols-2' : 
                    'grid-cols-2 md:grid-cols-4';

  return (
    <div className={`grid ${gridClass} gap-4 w-full`}>
      {results.map((result, index) => {
        if (result.status === 'pending') {
            return (
                <div key={result.id} className="aspect-square bg-[#151515] rounded-xl border border-white/5 flex flex-col items-center justify-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-transparent animate-[shimmer_2s_infinite]" />
                    <Spinner text="Rendering..." />
                </div>
            )
        }

        if (result.status === 'error') {
            return (
                <div
                    key={result.id}
                    className="aspect-square bg-[#1a0f0f] rounded-xl border border-red-500/20 flex flex-col items-center justify-center group relative"
                >
                    <AlertTriangleIcon className="w-8 h-8 text-red-500 mb-2 opacity-80" />
                    <span className="text-xs text-red-400 font-medium">Generation Failed</span>

                    <div className="flex gap-2 mt-3">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onErrorClick && onErrorClick(result);
                            }}
                            className="text-[10px] text-red-400 hover:text-red-300 underline underline-offset-2 transition-colors"
                        >
                            Details
                        </button>
                        {onRetry && (
                            <>
                                <span className="text-red-500/30">•</span>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onRetry(result);
                                    }}
                                    className="text-[10px] text-sky-400 hover:text-sky-300 underline underline-offset-2 transition-colors flex items-center gap-1"
                                >
                                    <RefreshIcon className="w-3 h-3" />
                                    Retry
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )
        }

        if (result.status === 'cancelled') {
          return (
              <div key={result.id} className="aspect-square bg-[#101010] rounded-xl border border-white/5 flex flex-col items-center justify-center opacity-60">
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center mb-2">
                     <CloseIcon className="w-4 h-4 text-gray-500" />
                  </div>
                  <span className="text-xs text-gray-500 font-medium">Cancelled</span>
              </div>
          )
      }

        // Success state
        return (
            <div 
              key={result.id} 
              onClick={() => onImageClick && onImageClick(result)}
              className={`
                group relative aspect-square bg-[#151515] rounded-xl overflow-hidden border border-white/5 
                hover:border-white/20 transition-all duration-500 hover:shadow-2xl hover:shadow-purple-900/10
                ${onImageClick ? 'cursor-zoom-in' : ''}
              `}
            >
              {result.imageUrl && (
                  <img
                    src={result.imageUrl}
                    alt={`Portrait ${index + 1}`}
                    className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-700 ease-out"
                  />
              )}
              {/* Subtle overlay on hover */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300 pointer-events-none" />
            </div>
        );
      })}
    </div>
  );
};

export default ImageGrid;
