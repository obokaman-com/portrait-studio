
import React from 'react';

interface StyleSelectorProps {
  onSelect: (scenarioTheme: string) => void;
  isGenerating?: boolean;
}

const SCENARIOS = [
  {
    label: "Movie Set",
    theme: "A specific, iconic Hollywood blockbuster movie set. Pick a SPECIFIC FAMOUS MOVIE (e.g., Star Wars, Pulp Fiction, Jurassic Park, Matrix, Titanic) and place the characters in a recognizable scene with iconic props/costumes."
  },
  {
    label: "Time Travel",
    theme: "A specific, famous historical event or moment. Pick a SPECIFIC EVENT (e.g., The sinking of the Titanic, Woodstock 1969, The Moon Landing, Crossing the Delaware, The Last Supper)."
  },
  {
    label: "Magazine Cover",
    theme: "A specific real-world magazine cover style. Pick a SPECIFIC MAGAZINE BRAND and describe its iconic visual identity (e.g., TIME Red Border, National Geographic Yellow Border, Vogue Typography, Rolling Stone)."
  },
  {
    label: "Pop Culture",
    theme: "A specific TV show or Pop Culture universe. Pick a SPECIFIC SHOW (e.g., Friends (Central Perk), Game of Thrones (Iron Throne), The Office (Talking Head), Stranger Things, Breaking Bad)."
  },
  {
    label: "Impossible",
    theme: "A surreal, specific, named location or concept. (e.g., The Grand Budapest Hotel lobby, Alice in Wonderland's Tea Party, Dalí's melting clocks landscape, Inside a Van Gogh painting)."
  },
  {
    label: "Cosplay",
    theme: "Dressed as specific superheroes or video game characters. Pick a SPECIFIC FRANCHISE (e.g., Marvel Avengers, Batman & Robin, Mario Kart racers, Zelda, Cyberpunk 2077)."
  },
  {
    label: "Fine Art",
    theme: "Inside a specific famous painting or art style. Pick a SPECIFIC MASTERPIECE (e.g., Van Gogh's Starry Night, American Gothic, The Mona Lisa background, A Renaissance Oil Painting, Andy Warhol Pop Art)."
  },
  {
    label: "Album Cover",
    theme: "Recreating a specific, iconic music album cover. Pick a SPECIFIC ALBUM (e.g., The Beatles' Abbey Road crossing, Nirvana's Nevermind pool, Queen II shadow pose, Pink Floyd Prism)."
  }
];

const StyleSelector: React.FC<StyleSelectorProps> = ({ onSelect, isGenerating }) => {
  return (
    <div className="flex flex-col gap-2 mt-3">
        <span className="text-[10px] uppercase text-gray-500 font-semibold tracking-wider flex justify-between">
            <span>Suggest a Scene</span>
            <span className="text-[9px] text-gray-600 normal-case tracking-normal">(AI Generated)</span>
        </span>
        <div className="flex flex-wrap gap-2">
        {SCENARIOS.map((scenario) => (
            <button
            key={scenario.label}
            onClick={() => onSelect(scenario.theme)}
            disabled={isGenerating}
            className="px-3 py-1.5 text-[10px] font-medium rounded-lg border border-white/5 bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 hover:border-sky-500/30 hover:shadow-[0_0_10px_rgba(14,165,233,0.1)] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
            title={`Generate a random ${scenario.label} scenario`}
            >
            {scenario.label}
            </button>
        ))}
        </div>
    </div>
  );
};

export default StyleSelector;
