
// This tells TypeScript that JSZip is available as a global variable.
declare var JSZip: any;

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
};

/**
 * Resizes an image file to a maximum dimension using HTML Canvas.
 * Returns the base64 string (without the data:image/... prefix if requested, but usually includes it for display).
 * Optimized for Gemini Vision input (max 1536px is usually sufficient/optimal).
 */
export const resizeImageToBase64 = (file: File, maxWidth: number = 1536): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height *= maxWidth / width;
                        width = maxWidth;
                    }
                } else {
                    if (height > maxWidth) {
                        width *= maxWidth / height;
                        height = maxWidth;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error("Could not get canvas context"));
                    return;
                }
                
                ctx.drawImage(img, 0, 0, width, height);
                // Return generic jpeg/png base64
                resolve(canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9));
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
};

export const createAndDownloadZip = async (
  base64Images: string[], 
  zipFilename: string,
  filePrefix: string,
  metadata?: string
) => {
  if (typeof JSZip === 'undefined') {
    console.error("JSZip library is not loaded.");
    return;
  }

  const zip = new JSZip();

  // Add Metadata file if provided
  if (metadata) {
      zip.file("generation_info.txt", metadata);
  }

  base64Images.forEach((base64, index) => {
    // Extract mime type and data
    const match = base64.match(/^data:(image\/(.+));base64,(.*)$/);
    if (match) {
        const fileExtension = match[2] === 'jpeg' ? 'jpg' : match[2]; // Normalize jpg
        const imageData = match[3];
        // Use the prefix + index + unique hash ensures no collisions even if unzipped in same folder
        zip.file(`${filePrefix}_${index + 1}.${fileExtension}`, imageData, { base64: true });
    }
  });

  try {
    const content = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(content);
    link.download = zipFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  } catch(err) {
    console.error("Failed to create or download zip file:", err);
  }
};
