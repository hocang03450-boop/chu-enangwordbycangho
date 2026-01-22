import * as pdfjsLib from 'pdfjs-dist';

// Set worker source explicitly
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.mjs';

/**
 * Gets the total number of pages in a PDF file.
 */
export const getPdfPageCount = async (file: File): Promise<number> => {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  return pdf.numPages;
};

/**
 * Converts a File object (Image or PDF) to an HTMLImageElement or Canvas for processing.
 * If PDF, it renders pages stitched vertically within the specified range.
 */
export const fileToCanvas = async (file: File, startPage: number = 1, endPage?: number): Promise<HTMLCanvasElement> => {
  if (file.type.startsWith('image/')) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          resolve(canvas);
        } else {
          reject(new Error("Could not get canvas context"));
        }
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  } else if (file.type === 'application/pdf') {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    const actualEndPage = endPage && endPage <= pdf.numPages ? endPage : pdf.numPages;
    const actualStartPage = Math.max(1, Math.min(startPage, actualEndPage));
    const pageCountToRender = actualEndPage - actualStartPage + 1;

    // Determine scale based on page count to avoid canvas height limits (approx 32k pixels)
    let scale = 1.5;
    if (pageCountToRender > 10) scale = 1.0;
    if (pageCountToRender > 25) scale = 0.8;

    const pagesInfo = [];
    let totalHeight = 0;
    let maxWidth = 0;

    // First pass: Calculate dimensions for the requested range
    for (let i = actualStartPage; i <= actualEndPage; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale });
        pagesInfo.push({ page, viewport });
        totalHeight += viewport.height;
        if (viewport.width > maxWidth) maxWidth = viewport.width;
    }

    // Safety check for browser canvas limits
    if (totalHeight > 32000) {
        // Recalculate with smaller scale if too big
        const reductionFactor = 30000 / totalHeight;
        scale = scale * reductionFactor;
        
        // Reset and recalculate
        pagesInfo.length = 0;
        totalHeight = 0;
        maxWidth = 0;
        for (let i = actualStartPage; i <= actualEndPage; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale });
            pagesInfo.push({ page, viewport });
            totalHeight += viewport.height;
            if (viewport.width > maxWidth) maxWidth = viewport.width;
        }
    }

    const canvas = document.createElement('canvas');
    canvas.width = maxWidth;
    canvas.height = totalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Canvas context missing");

    // Second pass: Render and Stitch
    let currentY = 0;
    
    // Render sequentially
    for (const info of pagesInfo) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = info.viewport.width;
        tempCanvas.height = info.viewport.height;
        const tempCtx = tempCanvas.getContext('2d');
        
        if (tempCtx) {
            await info.page.render({
                canvasContext: tempCtx,
                viewport: info.viewport
            } as any).promise;
            
            // Draw to main canvas
            ctx.drawImage(tempCanvas, 0, currentY);
        }
        
        // Cleanup
        info.page.cleanup(); 
        currentY += info.viewport.height;
    }

    return canvas;
  }
  throw new Error("Unsupported file type");
};

/**
 * Helper to get a Base64 string directly from a PDF file.
 */
export const pdfToImageBase64 = async (file: File): Promise<string> => {
  // Note: This helper now generally processes the first page or handled externally via fileToCanvas
  // For the AI service, we usually use the cropped canvas result, so this might be legacy or for single page defaults.
  // We will update it to use fileToCanvas default behavior (all pages or handled by caller)
  const canvas = await fileToCanvas(file); 
  const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
  return dataUrl.split(',')[1];
};
