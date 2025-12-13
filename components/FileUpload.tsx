
import React, { useState, useCallback } from 'react';
import { UploadIcon } from './icons';

interface FileUploadProps {
  onFilesChange: (files: File[]) => void;
  inputRef?: React.RefObject<HTMLInputElement>;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFilesChange, inputRef }) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = useCallback((files: FileList | null) => {
    if (files) {
      const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
      if(imageFiles.length > 0) {
        onFilesChange(imageFiles);
      }
    }
  }, [onFilesChange]);

  const handleDragEnter = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };
  
  const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };
  
  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };
  
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
    e.target.value = '';
  };

  return (
    <div>
      <label
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`
          flex flex-col items-center justify-center w-full h-28 
          rounded-xl border border-dashed transition-all duration-300 cursor-pointer
          ${isDragging 
            ? 'border-sky-500 bg-sky-500/10' 
            : 'border-white/10 bg-[#0f0f0f] hover:border-white/20 hover:bg-[#151515]'
          }
        `}
      >
        <div className="flex flex-col items-center gap-2 text-gray-500 group-hover:text-gray-300 px-4 text-center">
          <UploadIcon className={`w-6 h-6 transition-transform duration-300 ${isDragging ? '-translate-y-1 text-sky-400' : ''}`} />
          <div className="space-y-0.5">
             <p className="text-sm font-medium text-gray-300">
                Upload Subject Photos
             </p>
             <p className="text-[10px] text-gray-500">
                Drag & drop clear photos of the <br/>people you want in the portrait.
             </p>
          </div>
        </div>
        <input 
            ref={inputRef}
            id="dropzone-file" 
            type="file" 
            multiple 
            accept="image/*" 
            className="hidden" 
            onChange={handleFileSelect} 
        />
      </label>
    </div>
  );
};

export default FileUpload;
