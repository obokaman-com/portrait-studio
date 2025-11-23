
import React, { useState, useCallback } from 'react';
import { UploadIcon } from './icons';

interface FileUploadProps {
  onFilesChange: (files: File[]) => void;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFilesChange }) => {
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
          flex flex-col items-center justify-center w-full h-24 
          rounded-xl border transition-all duration-300 cursor-pointer
          ${isDragging 
            ? 'border-sky-500 bg-sky-500/10' 
            : 'border-white/10 bg-[#0f0f0f] hover:border-white/20 hover:bg-[#151515]'
          }
        `}
      >
        <div className="flex items-center gap-3 text-gray-500 group-hover:text-gray-300">
          <UploadIcon className={`w-5 h-5 transition-transform duration-300 ${isDragging ? '-translate-y-1 text-sky-400' : ''}`} />
          <p className="text-xs font-medium">
            <span className="text-gray-300">Click to upload</span> or drag photos
          </p>
        </div>
        <input id="dropzone-file" type="file" multiple accept="image/*" className="hidden" onChange={handleFileSelect} />
      </label>
    </div>
  );
};

export default FileUpload;