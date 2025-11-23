
import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

const Button: React.FC<ButtonProps> = ({ children, className, ...props }) => {
  return (
    <button
      {...props}
      className={`
        relative overflow-hidden group flex items-center justify-center px-6 py-3 border border-transparent 
        text-sm font-semibold rounded-full text-white
        bg-gradient-to-r from-purple-600 to-sky-600
        hover:from-purple-500 hover:to-sky-500
        focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#050505] focus:ring-sky-500
        disabled:opacity-50 disabled:cursor-not-allowed disabled:grayscale transition-all duration-300
        ${className}
      `}
    >
      {/* Subtle shine effect overlay */}
      <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent z-0" />
      <span className="relative z-10 flex items-center justify-center w-full">{children}</span>
    </button>
  );
};

export default Button;