import { useState, useEffect, useRef } from 'react';
import { Wand2, Download, Loader2, Paperclip, X, FileText } from 'lucide-react';
import { textToImage, imageToImage } from '../api/laozhangApi';
import { extractFileContent } from '../utils/fileExtractor';
import './TextToImage.css';

const ASPECT_RATIOS = [
    { value: '1:1', label: '1:1 (正方形)' },
    { value: '16:9', label: '16:9 (横屏)' },
    { value: '9:16', label: '9:16 (竖屏)' },
    { value: '3:2', label: '3:2 (横屏)' },
    { value: '2:3', label: '2:3 (竖屏)' },
    { value: '4:3', label: '4:3 (横向)' },
    { value: '3:4', label: '3:4 (竖向)' },
];

const RESOLUTIONS = [
    { value: '1k', label: '1K (快速)' },
    { value: '2k', label: '2K (标准)' },
    { value: '4k', label: '4K (高清)' },
];

const STORAGE_KEY = 'banana_ai_text_v1';

function TextToImage() {
    // 从 localStorage 初始化状态
    const savedState = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');

    const [prompt, setPrompt] = useState(savedState.prompt || '');
    const [negativePrompt, setNegativePrompt] = useState(savedState.negativePrompt || '');
    const [aspectRatio, setAspectRatio] = useState(savedState.aspectRatio || '1:1');
    const [resolution, setResolution] = useState(savedState.resolution || '2k');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(savedState.result || null);
    const [error, setError] = useState(null);
    const [refinePrompt, setRefinePrompt] = useState('');

    // 文件上传相关状态
    const [attachedFile, setAttachedFile] = useState(null);
    const [fileContent, setFileContent] = useState('');
    const [isExtracting, setIsExtracting] = useState(false);
    const fileInputRef = useRef(null);

    // 监听状态变化并同步到 localStorage
    useEffect(() => {
        const stateToSave = {
            prompt,
            negativePrompt,
            aspectRatio,
            resolution,
            result
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
    }, [prompt, negativePrompt, aspectRatio, resolution, result]);

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // 验证文件大小 (5MB)
        if (file.size > 5 * 1024 * 1024) {
            setError('文档大小不能超过 5MB');
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
        }

        setAttachedFile(file);
        setIsExtracting(true);
        setError(null);

        try {
            const content = await extractFileContent(file);
            setFileContent(content);
            console.log('Extracted content length:', content.length);
        } catch (err) {
            console.error('Extraction failed:', err);
            setError(err.message || '文档解析失败');
            setAttachedFile(null);
            setFileContent('');
        } finally {
            setIsExtracting(false);
        }
    };

    const clearFile = (e) => {
        e.stopPropagation();
        setAttachedFile(null);
        setFileContent('');
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleGenerate = async () => {
        if (!prompt.trim() && !fileContent) {
            setError('请输入提示词或上传参考文档');
            return;
        }

        setLoading(true);
        setError(null);
        setResult(null);

        try {
            // 组合提示词
            let finalPrompt = prompt;
            if (fileContent) {
                // 截取前 2000 个字符作为上下文，避免过长
                const context = fileContent.slice(0, 2000);
                finalPrompt = `参考以下文档内容设计画面:\n${context}\n\n画面描述: ${prompt}`;
            }

            const response = await textToImage({
                prompt: finalPrompt,
                negativePrompt,
                aspectRatio,
                resolution,
            });

            if (response.success) {
                setResult(response);
            } else {
                setError(response.error);
            }
        } catch (err) {
            setError('生成失败,请稍后重试');
        } finally {
            setLoading(false);
        }
    };

    // 新增: 精修处理函数
    const handleRefine = async () => {
        if (!result?.imageUrl) return;
        if (!refinePrompt.trim()) {
            setError('请输入修改提示词');
            return;
        }

        setLoading(true);
        setError(null);

        const currentResultImage = result.imageUrl;
        setResult(null);

        try {
            // 直接传递 URL，laozhangApi 内部会自动处理 (支持 HTTP URL 或 Base64)
            // 这里的 currentResultImage 是 API 返回的链接，不依赖 ImgBB
            const response = await imageToImage({
                images: [currentResultImage],
                prompt: refinePrompt,
                strength: 0.75,
                aspectRatio,
                resolution,
            });

            if (response.success) {
                setResult(response);
                setRefinePrompt('');
            } else {
                setError(response.error);
            }
        } catch (err) {
            setError('修改失败,请稍后重试');
        } finally {
            setLoading(false);
        }
    };

    const handleDownload = async () => {
        if (!result?.imageUrl) return;

        try {
            // 使用 fetch 获取图片 Blob，避开 Canvas 跨域污染问题
            const response = await fetch(result.imageUrl);

            if (!response.ok) throw new Error('Network response was not ok');

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `banana-ai-${Date.now()}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Download failed, falling back to window.open:', error);
            window.open(result.imageUrl, '_blank');
        }
    };

    return (
        <div className="text-to-image">
            <div className="generation-panel glass-card">
                <h2 className="panel-title">
                    <Wand2 size={24} />
                    文本生成图像
                </h2>

                {/* 参考文档上传 */}
                <div className="form-group">
                    <label className="label">参考文档 (可选)</label>
                    <div
                        className={`upload-area ${attachedFile ? 'has-file' : ''}`}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden-input"
                            accept=".pdf,.doc,.docx,.txt,.md"
                            onChange={handleFileChange}
                        />

                        {attachedFile ? (
                            <div className="file-preview">
                                <div className="file-icon">
                                    {isExtracting ? (
                                        <Loader2 size={24} className="spinner" />
                                    ) : (
                                        <FileText size={24} />
                                    )}
                                </div>
                                <div className="file-info">
                                    <span className="file-name">{attachedFile.name}</span>
                                    <span className="file-status">
                                        {isExtracting ? '正在提取内容...' : `已提取 ${fileContent.length} 字`}
                                    </span>
                                </div>
                                <button className="btn-icon btn-remove" onClick={clearFile}>
                                    <X size={16} />
                                </button>
                            </div>
                        ) : (
                            <div className="upload-placeholder">
                                <Paperclip size={24} className="upload-icon" />
                                <span className="upload-text">点击或拖拽上传文档 (PDF, Word, TXT, MD)</span>
                                <span className="upload-subtext">最大 5MB • 智能提取内容辅助生图</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* 提示词输入 */}
                <div className="form-group">
                    <label className="label">提示词 *</label>
                    <textarea
                        className="input textarea"
                        placeholder="描述你想要生成的图像,例如:一只可爱的橙色小猫在花园里玩耍,阳光明媚,高质量,细节丰富"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        rows={4}
                    />
                </div>

                {/* 负面提示词 */}
                <div className="form-group">
                    <label className="label">负面提示词(可选)</label>
                    <input
                        type="text"
                        className="input"
                        placeholder="描述你不想要的元素,例如:模糊,低质量,变形"
                        value={negativePrompt}
                        onChange={(e) => setNegativePrompt(e.target.value)}
                    />
                </div>

                {/* 参数选择 */}
                <div className="params-grid">
                    {/* 宽高比 */}
                    <div className="form-group">
                        <label className="label">宽高比</label>
                        <div className="radio-group">
                            {ASPECT_RATIOS.map((ratio) => (
                                <label key={ratio.value} className="radio-label">
                                    <input
                                        type="radio"
                                        name="text-aspectRatio"
                                        value={ratio.value}
                                        checked={aspectRatio === ratio.value}
                                        onChange={(e) => setAspectRatio(e.target.value)}
                                    />
                                    <span className="radio-custom">{ratio.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* 分辨率 */}
                    <div className="form-group">
                        <label className="label">分辨率</label>
                        <div className="radio-group">
                            {RESOLUTIONS.map((res) => (
                                <label key={res.value} className="radio-label">
                                    <input
                                        type="radio"
                                        name="text-resolution"
                                        value={res.value}
                                        checked={resolution === res.value}
                                        onChange={(e) => setResolution(e.target.value)}
                                    />
                                    <span className="radio-custom">{res.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                </div>

                {/* 生成按钮 */}
                <button
                    className="btn btn-primary btn-generate"
                    onClick={handleGenerate}
                    disabled={loading || (!prompt.trim() && !fileContent)}
                >
                    {loading ? (
                        <>
                            <Loader2 size={20} className="spinner" />
                            生成中...
                        </>
                    ) : (
                        <>
                            <Wand2 size={20} />
                            开始生成
                        </>
                    )}
                </button>

                {/* 错误提示 */}
                {error && (
                    <div className="error-message slide-up">
                        ⚠️ {error}
                    </div>
                )}
            </div>

            {/* 结果展示或加载占位 */}
            {(loading || result) && (
                <div className="result-column fade-in">
                    {loading && !result ? (
                        <div className="result-panel glass-card">
                            <div className="result-header">
                                <h3>正在生成...</h3>
                            </div>
                            <div className="result-image-container">
                                <div className="skeleton-loading">
                                    <Loader2 size={48} className="spinner" />
                                    <p className="loading-text-dynamic">
                                        {['正在捕捉灵感...', '正在画布上落笔...', '魔法正在发生...', '正在调色中...', '细节雕刻中...'][Math.floor(Date.now() / 2000) % 5]}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="result-panel glass-card">
                            <div className="result-header">
                                <h3>生成结果</h3>
                                <button className="btn btn-secondary" onClick={handleDownload}>
                                    <Download size={18} />
                                    下载图像
                                </button>
                            </div>
                            <div className="result-image-container">
                                <img
                                    src={result.imageUrl}
                                    alt="Generated"
                                    className="result-image"
                                />
                            </div>
                            <div className="result-info">
                                <p><strong>提示词:</strong> {prompt}</p>
                                <p><strong>参数:</strong> {aspectRatio} • {resolution.toUpperCase()}</p>
                            </div>
                        </div>
                    )}

                    {/* 精修面板 (仅在生成成功后显示) */}
                    {result && !loading && (
                        <div className="refine-panel glass-card">
                            <h4 className="refine-title">✨ 再次修改 (基于当前结果)</h4>
                            <div className="refine-input-group">
                                <input
                                    type="text"
                                    className="input"
                                    placeholder="例如: 增加一些灯光效果..."
                                    value={refinePrompt}
                                    onChange={(e) => setRefinePrompt(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleRefine()}
                                />
                                <button
                                    className="btn btn-primary btn-refine"
                                    onClick={handleRefine}
                                    disabled={loading || !refinePrompt.trim()}
                                >
                                    {loading ? <Loader2 size={18} className="spinner" /> : '发送'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default TextToImage;
