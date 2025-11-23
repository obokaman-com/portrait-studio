
import React from 'react';

type Option = 2 | 4 | 8;

interface GenerationOptionsProps {
  selected: Option;
  onChange: (value: Option) => void;
}

const GenerationOptions: React.FC<GenerationOptionsProps> = ({ selected, onChange }) => {
  const options: Option[] = [2, 4, 8];

  return (
    <div className="flex bg-[#050505] p-1 rounded-full border border-white/10">
      {options.map((option) => (
        <button
          key={option}
          onClick={() => onChange(option)}
          className={`
            flex-1 py-1 text-[10px] font-bold rounded-full transition-all duration-200
            ${selected === option 
              ? 'bg-gray-800 text-white shadow-sm' 
              : 'text-gray-500 hover:text-gray-300'
            }
          `}
        >
          {option}
        </button>
      ))}
    </div>
  );
};

export default GenerationOptions;