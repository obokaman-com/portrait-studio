
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

export const createAndDownloadZip = async (base64Images: string[], fileName: string) => {
  if (typeof JSZip === 'undefined') {
    console.error("JSZip library is not loaded.");
    return;
  }

  const zip = new JSZip();

  base64Images.forEach((base64, index) => {
    // Extract mime type and data
    const match = base64.match(/^data:(image\/(.+));base64,(.*)$/);
    if (match) {
        const fileExtension = match[2];
        const imageData = match[3];
        zip.file(`portrait_${index + 1}.${fileExtension}`, imageData, { base64: true });
    }
  });

  try {
    const content = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(content);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  } catch(err) {
    console.error("Failed to create or download zip file:", err);
  }
};
