import { useState, useEffect } from 'react';
import { ImagePlus, Download, Loader2, Upload, Plus, X } from 'lucide-react';
import { imageToImage, compressImage } from '../api/laozhangApi';
import './ImageToImage.css';

const ASPECT_RATIOS = [
    { value: '1:1', label: '1:1' },
    { value: '16:9', label: '16:9' },
    { value: '9:16', label: '9:16' },
    { value: '4:3', label: '4:3' },
    { value: '3:4', label: '3:4' },
];

const RESOLUTIONS = [
    { value: '1k', label: '1K' },
    { value: '2k', label: '2K' },
    { value: '4k', label: '4K' },
];

const STORAGE_KEY = 'banana_ai_image_v1';

function ImageToImage() {
    // 从 localStorage 初始化状态
    const savedState = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');

    const [images, setImages] = useState([]); // 源图不持久化，因容量限制
    const [prompt, setPrompt] = useState(savedState.prompt || '');
    const [strength, setStrength] = useState(savedState.strength || 0.75);
    const [aspectRatio, setAspectRatio] = useState(savedState.aspectRatio || '1:1');
    const [resolution, setResolution] = useState(savedState.resolution || '2k');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(savedState.result || null);
    const [error, setError] = useState(null);
    const [refinePrompt, setRefinePrompt] = useState('');

    // 监听状态变化并同步到 localStorage
    useEffect(() => {
        const stateToSave = {
            prompt,
            strength,
            aspectRatio,
            resolution,
            result
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
        } catch (e) {
            console.warn('LocalStorage save failed (possibly full):', e);
        }
    }, [prompt, strength, aspectRatio, resolution, result]);

    const handleImageUpload = (e) => {
        const files = Array.from(e.target.files || []);

        // 限制最多上传 10 张
        if (images.length + files.length > 10) {
            setError('最多只能上传 10 张图像');
            return;
        }

        files.forEach((file) => {
            if (!file.type.startsWith('image/')) {
                setError('请上传图像文件');
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                setImages((prev) => [
                    ...prev,
                    {
                        id: Date.now() + Math.random(),
                        file,
                        preview: e.target.result,
                    },
                ]);
            };
            reader.readAsDataURL(file);
        });

        setError(null);
        e.target.value = null; // 重置 input 以允许重复上传同一文件
    };

    const removeImage = (id) => {
        setImages((prev) => prev.filter((img) => img.id !== id));
    };

    const handleGenerate = async () => {
        if (images.length === 0) {
            setError('请至少上传 1 张图像');
            return;
        }

        if (!prompt.trim()) {
            setError('请输入提示词');
            return;
        }

        setLoading(true);
        setError(null);
        setResult(null);

        try {
            // 压缩并转换所有图片为 Base64 (限制 1024 尺寸，使用 JPEG 格式)
            const imageBase64Array = await Promise.all(
                images.map((img) => compressImage(img.file, 1024, 1024, 0.8))
            );

            // 调用 API (传入图片数组)
            const response = await imageToImage({
                images: imageBase64Array,
                prompt,
                strength,
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


    const handleRefine = async () => {
        if (!result?.imageUrl) return;
        if (!refinePrompt.trim()) {
            setError('请输入修改提示词');
            return;
        }

        setLoading(true);
        setError(null);

        // 保存上一张结果作为临时预览(可选,这里直接用结果图)
        const currentResultImage = result.imageUrl;
        setResult(null); // 清空结果以显示加载状态

        try {
            // 直接将生成结果的 URL 传回 API，无需转换，效率最高且避免 500
            const response = await imageToImage({
                images: [currentResultImage],
                prompt: refinePrompt,
                strength: strength,
                aspectRatio,
                resolution,
            });

            if (response.success) {
                setResult(response);
                setRefinePrompt(''); // 清空输入框
            } else {
                setError(response.error);
                // 如果失败, 恢复显示上一张图? 这里简单处理,报错即可,用户需重新生成
            }
        } catch (err) {
            setError('修改失败,请稍后重试');
        } finally {
            setLoading(false);
        }
    };
    const handleDownload = () => {
        if (!result?.imageUrl) return;

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = result.imageUrl;

        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            const dataURL = canvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.href = dataURL;
            link.download = `banana-ai-gen-${Date.now()}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        };

        img.onerror = () => {
            console.error('Canvas download failed, falling back to window.open');
            window.open(result.imageUrl, '_blank');
        };
    };

    return (
        <div className="image-to-image">
            <div className="generation-panel glass-card">
                <h2 className="panel-title">
                    <ImagePlus size={24} />
                    图生图 / 多图融合
                </h2>

                {/* 图像上传区域 - 仿照参考 UI */}
                <div className="form-group">
                    <label className="label">上传参考图像 (支持多图)</label>

                    <div className="images-upload-grid">
                        {/* 已上传的图片列表 */}
                        {images.map((img) => (
                            <div key={img.id} className="image-card">
                                <img src={img.preview} alt="Upload" />
                                <button
                                    className="btn-delete"
                                    onClick={() => removeImage(img.id)}
                                    title="删除"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ))}

                        {/* 加图按钮 */}
                        {images.length < 10 && (
                            <label htmlFor="multi-upload" className="add-image-btn">
                                <Plus size={32} />
                                <span>加图</span>
                                <input
                                    id="multi-upload"
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    onChange={handleImageUpload}
                                    style={{ display: 'none' }}
                                />
                            </label>
                        )}
                    </div>

                    <p className="upload-hint">支持上传 1-10 张图片。多图时将根据提示词进行自动融合。</p>
                </div>

                {/* 提示词 */}
                <div className="form-group">
                    <label className="label">提示词 *</label>
                    <textarea
                        className="input textarea"
                        placeholder="描述生成效果。如果是多图，这类描述:'混合这两张图的风格' 或 '用图1的构图和图2的色彩' 会很有效。"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        rows={3}
                    />
                </div>

                {/* 参数选择 */}
                <div className="params-grid">
                    <div className="form-group">
                        <label className="label">宽高比</label>
                        <div className="radio-group">
                            {ASPECT_RATIOS.map((ratio) => (
                                <label key={ratio.value} className="radio-label">
                                    <input
                                        type="radio"
                                        name="image-aspectRatio"
                                        value={ratio.value}
                                        checked={aspectRatio === ratio.value}
                                        onChange={(e) => setAspectRatio(e.target.value)}
                                    />
                                    <span className="radio-custom">{ratio.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="label">分辨率</label>
                        <div className="radio-group">
                            {RESOLUTIONS.map((res) => (
                                <label key={res.value} className="radio-label">
                                    <input
                                        type="radio"
                                        name="image-resolution"
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

                {/* 强度控制 - 放在底部作为高级选项 */}
                <div className="form-group">
                    <label className="label">
                        参考强度: {(strength * 100).toFixed(0)}%
                    </label>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={strength}
                        onChange={(e) => setStrength(parseFloat(e.target.value))}
                        className="slider"
                    />
                    <div className="slider-labels">
                        <span>更多创意</span>
                        <span>忠于原图</span>
                    </div>
                </div>

                {/* 生成按钮 */}
                <button
                    className="btn btn-primary btn-generate"
                    onClick={handleGenerate}
                    disabled={loading || images.length === 0 || !prompt.trim()}
                >
                    {loading ? (
                        <>
                            <Loader2 size={20} className="spinner" />
                            生成中...
                        </>
                    ) : (
                        <>
                            <ImagePlus size={20} />
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
                                <img src={result.imageUrl} alt="Generated" className="result-image" />
                            </div>
                            <div className="result-info">
                                <p><strong>提示词:</strong> {prompt}</p>
                                {refinePrompt && <p><strong>修改指令:</strong> {refinePrompt}</p>}
                                <p><strong>源图:</strong> {images.length} 张 • <strong>参数:</strong> {aspectRatio} • {resolution.toUpperCase()}</p>
                            </div>
                        </div>
                    )}

                    {/* 再次修改面板 (仅在完成生成后显示) */}
                    {result && !loading && (
                        <div className="refine-panel glass-card">
                            <h4 className="refine-title">✨ 再次修改</h4>
                            <div className="refine-input-group">
                                <input
                                    type="text"
                                    className="input"
                                    placeholder="例如: 把背景换成星空, 或者让色彩更暖一点..."
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

export default ImageToImage;
