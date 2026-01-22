import React, { useState } from 'react';
import { Header } from './components/Header';
import { FileUpload } from './components/FileUpload';
import { ResultSection } from './components/ResultSection';
import { Button } from './components/Button';
import { PageSelector } from './components/PageSelector';
import { ImageCropper } from './components/ImageCropper';
import { FileData, Status } from './types';
import { extractContentWithSmartCrop, generateImageFromText } from './services/geminiService';
import { fileToCanvas, getPdfPageCount } from './services/pdfService';
import { ArrowRight, Sparkles, AlertCircle, ScanLine, Type as TypeIcon, Image as ImageIcon, Download, Crop, PlusCircle } from 'lucide-react';
import { useTheme, Theme } from './contexts/ThemeContext';

const App: React.FC = () => {
  // Tab State
  const [activeTab, setActiveTab] = useState<'convert' | 'generate'>('convert');

  // Converter State
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [status, setStatus] = useState<Status>(Status.IDLE);
  const [result, setResult] = useState<string | null>(null);
  const [fullImageBase64, setFullImageBase64] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState<string>("");
  const [isPreparingPreview, setIsPreparingPreview] = useState(false);
  
  // Page Selection & Cropping States
  const [showPageSelector, setShowPageSelector] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const [cropIntent, setCropIntent] = useState<'process' | 'insert'>('process'); // New state to distinguish crop actions
  const [totalPages, setTotalPages] = useState(0);
  const [pendingPdfFile, setPendingPdfFile] = useState<File | null>(null);

  // Image Generator State
  const [genPrompt, setGenPrompt] = useState('');
  const [genStatus, setGenStatus] = useState<Status>(Status.IDLE);
  const [genImage, setGenImage] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  
  const { theme, setTheme } = useTheme();

  // --- Converter Logic ---

  const handleFileSelect = async (data: FileData | null) => {
    if (!data) {
      setFileData(null);
      setResult(null);
      return;
    }

    // Reset previous states
    setFileData(null);
    setResult(null);
    setError(null);
    setFullImageBase64(undefined);
    setPendingPdfFile(null);

    try {
      if (data.type === 'pdf') {
        // Check page count first
        const pages = await getPdfPageCount(data.file);
        if (pages > 1) {
          setTotalPages(pages);
          setPendingPdfFile(data.file);
          setShowPageSelector(true);
          return;
        }
        // Single page PDF, process immediately
        await processFile(data.file, 'pdf', 1, 1);
      } else {
        // Image file
        await processFile(data.file, 'image');
      }
    } catch (err: any) {
      console.error(err);
      setError("Không thể đọc file. " + err.message);
      setIsPreparingPreview(false);
    }
  };

  const handlePageConfirm = (start: number, end: number) => {
    setShowPageSelector(false);
    if (pendingPdfFile) {
      processFile(pendingPdfFile, 'pdf', start, end);
    }
  };

  const handlePageCancel = () => {
    setShowPageSelector(false);
    setPendingPdfFile(null);
  };

  const processFile = async (file: File, type: 'pdf' | 'image', startPage?: number, endPage?: number) => {
    setIsPreparingPreview(true);
    setProgressMsg(type === 'pdf' 
      ? `Đang xử lý trang ${startPage || 1}${endPage ? '-' + endPage : ''}...` 
      : "Đang chuẩn bị ảnh...");

    try {
        let processedFile: File;
        let previewUrl: string;

        if (type === 'pdf') {
            // Render the PDF stitched within range
            const canvas = await fileToCanvas(file, startPage, endPage);
            
            // Convert canvas to blob/file
            await new Promise<void>((resolve) => {
                canvas.toBlob((blob) => {
                    if (blob) {
                        processedFile = new File([blob], "processed_document.jpg", { type: 'image/jpeg' });
                        previewUrl = URL.createObjectURL(blob);
                        
                        setFileData({
                            file: processedFile,
                            previewUrl: previewUrl,
                            type: 'image'
                        });
                    }
                    resolve();
                }, 'image/jpeg', 0.90);
            });
        } else {
            // Use original image
            processedFile = file;
            previewUrl = URL.createObjectURL(file);
            
            setFileData({
                file: processedFile,
                previewUrl: previewUrl,
                type: 'image'
            });
        }
    } catch (err: any) {
        console.error(err);
        setError("Lỗi khi xử lý file: " + err.message);
    } finally {
        setIsPreparingPreview(false);
    }
  };

  const handleCropConfirm = (croppedBlob: Blob) => {
      if (cropIntent === 'process') {
          // Standard flow: Crop replaces source for OCR
          const croppedFile = new File([croppedBlob], "cropped_image.jpg", { type: 'image/jpeg' });
          const previewUrl = URL.createObjectURL(croppedBlob);
          setFileData({
              file: croppedFile,
              previewUrl: previewUrl,
              type: 'image'
          });
          setIsCropping(false);
      } else {
          // Insert flow: Convert crop to Base64 and insert intelligently into result
          const reader = new FileReader();
          reader.readAsDataURL(croppedBlob);
          reader.onloadend = () => {
              const base64 = reader.result as string;
              
              // Create an HTML image tag for insertion
              const imgTag = `
<div class="inserted-image" style="text-align: center; margin: 1.5em 0;">
  <img src="${base64}" alt="Clipped Content" style="max-width: 100%; height: auto; border: 1px solid #e5e7eb; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);" />
</div>`;

              setResult(prev => {
                  if (!prev) return imgTag;
                  
                  // The exact placeholder string defined in geminiService
                  const placeholder = "<p style='color:red; font-style:italic; text-align:center;'>[Vị trí Hình ảnh/Biểu đồ - Hãy dùng nút 'Cắt & Chèn ảnh' để thêm vào đây]</p>";
                  
                  // Replaces the first occurrence of the placeholder found in the text
                  if (prev.includes(placeholder)) {
                      return prev.replace(placeholder, imgTag);
                  }
                  
                  // If no placeholder is found, append to the end
                  return prev + imgTag;
              });
              setIsCropping(false);
          };
      }
  };

  const handleConvert = async () => {
    if (!fileData) return;

    setStatus(Status.PROCESSING);
    setError(null);
    setResult(null);

    try {
      // Step 1: Analyze with Gemini
      setProgressMsg("Thầy Hồ Cang đang phân tích tài liệu...");
      const aiResponse = await extractContentWithSmartCrop(fileData.file);
      
      const finalHtml = aiResponse.html;

      // Step 2: Read base64 of the processed image for appending
      const reader = new FileReader();
      reader.readAsDataURL(fileData.file);
      reader.onloadend = () => {
          setFullImageBase64(reader.result as string);
      };

      setResult(finalHtml);
      setStatus(Status.SUCCESS);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Đã xảy ra lỗi không xác định.");
      setStatus(Status.ERROR);
    }
  };

  // --- Generator Logic ---

  const handleGenerateImage = async () => {
    if (!genPrompt.trim()) return;
    
    setGenStatus(Status.PROCESSING);
    setGenError(null);
    setGenImage(null);

    try {
      const base64Image = await generateImageFromText(genPrompt);
      setGenImage(base64Image);
      setGenStatus(Status.SUCCESS);
    } catch (err: any) {
      console.error(err);
      setGenError(err.message || "Không thể tạo hình ảnh.");
      setGenStatus(Status.ERROR);
    }
  };

  const handleDownloadImage = () => {
    if (!genImage) return;
    const a = document.createElement('a');
    a.href = genImage;
    a.download = `generated_image_${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const colors: { id: Theme; label: string; bg: string; }[] = [
    { id: 'red', label: 'Mặc định', bg: 'bg-red-500' },
    { id: 'teal', label: 'Xanh Teal', bg: 'bg-teal-500' },
    { id: 'blue', label: 'Xanh dương', bg: 'bg-blue-500' },
    { id: 'amber', label: 'Vàng đậm', bg: 'bg-amber-500' },
    { id: 'purple', label: 'Tím Huế', bg: 'bg-purple-500' },
    { id: 'lime', label: 'Vàng xanh', bg: 'bg-lime-500' },
  ];

  return (
    <div className="min-h-screen flex flex-col transition-colors duration-300">
      <Header />

      {/* Page Selection Modal */}
      {showPageSelector && (
        <PageSelector 
          totalPages={totalPages} 
          onConfirm={handlePageConfirm} 
          onCancel={handlePageCancel} 
        />
      )}

      {/* Image Cropper Modal */}
      {isCropping && fileData?.previewUrl && (
          <ImageCropper 
              imageSrc={fileData.previewUrl}
              onConfirm={handleCropConfirm}
              onCancel={() => setIsCropping(false)}
          />
      )}

      <main className="flex-grow p-4 md:p-8 max-w-7xl mx-auto w-full">
        {/* Theme Selector */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          {/* Tabs */}
          <div className="flex bg-white/50 p-1 rounded-xl border border-gray-200 shadow-sm backdrop-blur-sm">
            <button
              onClick={() => setActiveTab('convert')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                activeTab === 'convert' 
                  ? `bg-${theme}-600 text-white shadow-md` 
                  : 'text-gray-600 hover:bg-white/80'
              }`}
            >
              <TypeIcon className="w-4 h-4" />
              Chuyển đổi Tài liệu
            </button>
            <button
              onClick={() => setActiveTab('generate')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                activeTab === 'generate' 
                  ? `bg-${theme}-600 text-white shadow-md` 
                  : 'text-gray-600 hover:bg-white/80'
              }`}
            >
              <ImageIcon className="w-4 h-4" />
              Tạo Hình ảnh (AI)
            </button>
          </div>

          {/* Colors */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">Màu giao diện:</span>
            {colors.map((c) => (
              <button
                key={c.id}
                onClick={() => setTheme(c.id)}
                className={`w-6 h-6 rounded-full ${c.bg} hover:scale-110 transition-transform shadow-sm ring-2 ${theme === c.id ? 'ring-offset-2 ring-gray-400' : 'ring-transparent'}`}
                title={c.label}
                aria-label={c.label}
              />
            ))}
          </div>
        </div>

        {/* --- CONVERTER MODE --- */}
        {activeTab === 'convert' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-full animate-fade-in">
            
            {/* Left Column: Input */}
            <div className="flex flex-col gap-6">
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2 select-none">
                  <span className={`flex items-center justify-center w-8 h-8 rounded-full bg-${theme}-100 text-${theme}-700 text-sm font-bold`}>1</span>
                  Tải lên tài liệu
                </h2>
                <p className="text-gray-500 text-sm pl-10 select-none">
                  Hỗ trợ PDF (nhiều trang) và hình ảnh.
                </p>
              </div>

              {/* Upload Area */}
              {isPreparingPreview ? (
                  <div className="w-full h-[300px] flex flex-col items-center justify-center bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 select-none">
                      <div className={`w-12 h-12 border-4 border-${theme}-200 border-t-${theme}-600 rounded-full animate-spin mb-4`}></div>
                      <p className="text-gray-600 font-medium">{progressMsg || "Đang chuẩn bị..."}</p>
                      <p className="text-xs text-gray-400 mt-1">Vui lòng đợi trong giây lát.</p>
                  </div>
              ) : (
                  <FileUpload 
                      onFileSelect={handleFileSelect} 
                      selectedFile={fileData}
                      disabled={status === Status.PROCESSING}
                  />
              )}

              {fileData && status !== Status.SUCCESS && !isPreparingPreview && (
                <div className="flex flex-col gap-3 animate-fade-in">
                  <div className="flex gap-2">
                    <Button 
                      onClick={handleConvert} 
                      isLoading={status === Status.PROCESSING}
                      className="flex-grow text-lg px-8 py-3 shadow-lg shadow-blue-500/20"
                    >
                      <Sparkles className="w-5 h-5 mr-2" />
                      Bắt đầu xử lý
                    </Button>
                    <Button 
                      variant="secondary"
                      onClick={() => {
                        setCropIntent('process');
                        setIsCropping(true);
                      }}
                      disabled={status === Status.PROCESSING}
                      className="px-4"
                      title="Cắt ảnh để xử lý nội dung bên trong"
                    >
                      <Crop className="w-5 h-5" />
                    </Button>
                  </div>
                  <p className="text-xs text-center text-gray-400">
                    * Lưu ý: Nút Cắt (Crop) ở đây dùng để chọn vùng cần chuyển thành văn bản.
                  </p>
                </div>
              )}
              
              {(status === Status.ERROR || error) && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold">Đã xảy ra lỗi</p>
                    <p className="text-sm">{error}</p>
                  </div>
                </div>
              )}

              {/* Features Info */}
              {!result && (
                <div className={`mt-8 bg-${theme}-50 rounded-xl p-6 border border-${theme}-100 transition-colors duration-300 select-none`}>
                  <h3 className={`font-semibold text-${theme}-800 mb-3 flex items-center gap-2`}>
                    <ScanLine className="w-4 h-4" />
                    Tính năng chính
                  </h3>
                  <ul className={`space-y-3 text-${theme}-700 text-sm`}>
                    <li className="flex items-start gap-2">
                      <TypeIcon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>
                        <strong>OCR Chính xác:</strong> Nhận diện văn bản tiếng Việt và giữ nguyên định dạng.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <div className={`w-1.5 h-1.5 bg-${theme}-500 rounded-full mt-2`} />
                      <span>
                        <strong>Toán học LaTeX:</strong> Tự động chuyển công thức toán sang dạng LaTeX ($...$).
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <div className={`w-1.5 h-1.5 bg-${theme}-500 rounded-full mt-2`} />
                      <span>
                        <strong>Giữ nguyên ảnh:</strong> Sử dụng tính năng "Cắt & Chèn ảnh" để lấy hình gốc.
                      </span>
                    </li>
                  </ul>
                </div>
              )}
            </div>

            {/* Right Column: Output */}
            <div className="flex flex-col gap-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2 select-none">
                    <span className={`flex items-center justify-center w-8 h-8 rounded-full bg-${theme}-100 text-${theme}-700 text-sm font-bold`}>2</span>
                    Kết quả
                  </h2>
                  <p className="text-gray-500 text-sm pl-10 select-none hidden sm:block">
                    Văn bản và hình ảnh đã xử lý.
                  </p>
                </div>

                {/* Manual Image Insert Button */}
                {fileData && (
                    <Button 
                        variant="outline" 
                        className={`text-xs px-3 py-1 border-${theme}-200 text-${theme}-700 hover:bg-${theme}-50`}
                        onClick={() => {
                            setCropIntent('insert');
                            setIsCropping(true);
                        }}
                        title="Cắt một vùng ảnh từ file gốc và dán vào kết quả"
                    >
                        <PlusCircle className="w-4 h-4 mr-1.5" />
                        Cắt & Chèn ảnh
                    </Button>
                )}
              </div>

              {result ? (
                <ResultSection content={result} fileData={fileData} originalImageBase64={fullImageBase64} />
              ) : (
                <div className="flex-grow min-h-[400px] bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center text-gray-400 p-8 text-center select-none">
                  {status === Status.PROCESSING ? (
                    <div className="flex flex-col items-center gap-4">
                      <div className="relative">
                          <div className={`w-16 h-16 border-4 border-${theme}-200 border-t-${theme}-600 rounded-full animate-spin`}></div>
                      </div>
                      <p className={`text-${theme}-600 font-medium animate-pulse`}>{progressMsg}</p>
                    </div>
                  ) : (
                    <>
                      <ArrowRight className="w-12 h-12 mb-4 opacity-20" />
                      <p>Kết quả sẽ xuất hiện ở đây sau khi chuyển đổi</p>
                    </>
                  )}
                </div>
              )}
            </div>

          </div>
        )}

        {/* --- GENERATOR MODE --- */}
        {activeTab === 'generate' && (
           <div className="max-w-3xl mx-auto animate-fade-in flex flex-col gap-6">
              <div className="text-center space-y-2 mb-4">
                 <h2 className="text-3xl font-bold text-gray-800">AI Tạo Hình Ảnh</h2>
                 <p className="text-gray-500">Nhập mô tả và AI sẽ vẽ hình minh họa cho bạn.</p>
              </div>

              <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 space-y-4">
                  <label className="block text-sm font-medium text-gray-700">Mô tả hình ảnh (Prompt)</label>
                  <textarea
                    value={genPrompt}
                    onChange={(e) => setGenPrompt(e.target.value)}
                    placeholder="Ví dụ: Một chú mèo máy đang giải toán hình học trong không gian..."
                    className={`w-full p-4 rounded-xl border-2 border-gray-200 bg-white focus:border-${theme}-500 focus:ring-0 outline-none min-h-[120px] resize-none transition-colors text-gray-900 placeholder-gray-500`}
                  />
                  
                  <div className="flex justify-end">
                    <Button 
                      onClick={handleGenerateImage}
                      isLoading={genStatus === Status.PROCESSING}
                      disabled={!genPrompt.trim()}
                      className="px-8 py-3"
                    >
                       <Sparkles className="w-5 h-5 mr-2" />
                       Tạo hình ảnh
                    </Button>
                  </div>
              </div>

              {/* Generator Result */}
              {(genStatus === Status.PROCESSING || genImage || genError) && (
                 <div className="bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 min-h-[300px] flex flex-col items-center justify-center p-8">
                    
                    {genStatus === Status.PROCESSING && (
                        <div className="flex flex-col items-center gap-4">
                            <div className={`w-12 h-12 border-4 border-${theme}-200 border-t-${theme}-600 rounded-full animate-spin`}></div>
                            <p className="text-gray-500 font-medium">Đang vẽ hình...</p>
                        </div>
                    )}

                    {genStatus === Status.ERROR && (
                        <div className="text-center text-red-600">
                            <AlertCircle className="w-10 h-10 mx-auto mb-2" />
                            <p>{genError}</p>
                        </div>
                    )}

                    {genStatus === Status.SUCCESS && genImage && (
                        <div className="flex flex-col items-center gap-6 animate-fade-in w-full">
                            <div className="relative group w-full max-w-[512px] aspect-square bg-white shadow-lg rounded-xl overflow-hidden border border-gray-200">
                                <img src={genImage} alt="Generated AI Art" className="w-full h-full object-contain" />
                            </div>
                            <Button variant="secondary" onClick={handleDownloadImage}>
                                <Download className="w-4 h-4 mr-2" />
                                Tải xuống ảnh (.png)
                            </Button>
                        </div>
                    )}
                 </div>
              )}
           </div>
        )}

      </main>

      <footer className="py-4 text-center text-xs text-gray-400 border-t border-gray-100 mt-auto select-none">
          <p>© 2024 Thầy Hồ Cang - THPT Chu Văn An. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default App;