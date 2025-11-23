
export interface CharacterDetail {
  id: string; // e.g., photoId-1
  name: string;
  description: string;
  isDescriptionLoading: boolean;
}

export interface UploadedPhoto {
  id: string;
  file: File;
  preview: string;
  characters: CharacterDetail[];
}

export interface GenerationResult {
  id: string;
  status: 'pending' | 'success' | 'error' | 'cancelled';
  imageUrl?: string;
  errorMessage?: string;
}
