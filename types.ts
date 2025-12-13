
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
  isQuotaError?: boolean; // Flag to indicate 429/quota errors
}

export interface UsageLog {
  id: string;
  timestamp: Date;
  action: string; // e.g., "Analyze Photo", "Generate Image"
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}
