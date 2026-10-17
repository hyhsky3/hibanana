import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
// 设置 pdf.worker.js 的路径
// 注意: 在 Vite 中通常需要处理 worker 路径，这里尝试使用 CDN 或者本地构建后的路径
// 如果是 npm 安装，通常需要 import worker from 'pdfjs-dist/build/pdf.worker.entry';
// 但为了兼容性，我们先尝试标准导入
import mammoth from 'mammoth';

// 设置 PDF worker
// 注意: 这里是一个常见坑点，Vite 环境下可能需要显式引入 worker
try {
    // 尝试动态引入 worker (Vite way)
    // pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    //     'pdfjs-dist/build/pdf.worker.mjs',
    //     import.meta.url
    // ).toString();
    // 暂时使用 cdn 兜底，或者假设用户构建环境能处理
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
} catch (e) {
    console.warn('PDF Worker setup warning:', e);
}

/**
 * 提取文件内容
 * @param {File} file 
 * @returns {Promise<string>} 提取的文本内容
 */
export const extractFileContent = async (file) => {
    const fileType = file.type;
    const fileName = file.name.toLowerCase();

    try {
        if (fileName.endsWith('.txt') || fileName.endsWith('.md')) {
            return await readTextFile(file);
        } else if (fileName.endsWith('.pdf')) {
            return await readPdfFile(file);
        } else if (fileName.endsWith('.docx') || fileName.endsWith('.doc')) {
            return await readWordFile(file);
        } else {
            throw new Error('不支持的文件类型');
        }
    } catch (error) {
        console.error('File extraction error:', error);
        throw new Error('读取文件失败: ' + error.message);
    }
};

const readTextFile = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
    });
};

const readPdfFile = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    let fullText = '';
    const numPages = pdf.numPages;

    // 限制最大页数以防过大
    const maxPages = Math.min(numPages, 10); 

    for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += pageText + '\n';
    }

    if (numPages > maxPages) {
        fullText += `\n... (仅读取了前 ${maxPages} 页)`;
    }

    return fullText;
};

const readWordFile = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    // mammoth 针对 docx
    const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    return result.value;
};
