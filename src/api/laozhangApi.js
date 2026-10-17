import axios from 'axios';

/**
 * 🍌 Banana AI - GRSAI API Service
 * 严格按照最新国内直连节点文档实现
 */

// API 配置 - GRSAI 国内直连节点
// API 配置 - 优先读取环境变量
const API_BASE_URL = import.meta.env.VITE_GRSAI_API_BASE_URL || 'https://grsai.dakka.com.cn';
// 从环境变量获取 API Key（在 Cloudflare Pages 后台设置）
const API_KEY = import.meta.env.VITE_GRSAI_API_KEY || '';
const API_ENDPOINT = '/v1/api/generate'; // 绘画生成接口 (apifox 文档 452392911e0)
const RESULT_ENDPOINT = '/v1/api/result';  // 异步结果查询接口 (GET ?id=任务id)
const MODEL_NAME = import.meta.env.VITE_GRSAI_MODEL_NAME || 'nano-banana-2.1';        // 用户指定的模型

// 检查 API Key 是否配置
if (!API_KEY) {
  console.warn('⚠️ VITE_GRSAI_API_KEY 环境变量未设置，请在 Cloudflare Pages 后台配置');
}

// 创建 axios 实例
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`,
  },
  timeout: 60000,
});

/**
 * 压缩图片并转为 Base64
 */
export const compressImage = (file, maxWidth = 1024, maxHeight = 1024, quality = 0.8) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
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
          if (height > maxHeight) {
            width *= maxHeight / height;
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const base64 = dataUrl.split(',')[1];
        resolve(base64);
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
};



/**
 * 通用生成函数 (适配 GRSAI 最新文档)
 */
const generateContent = async ({ prompt, images = [], aspectRatio, resolution }) => {
  // 分辨率处理: 默认 1K
  const imageSize = resolution ? resolution.toUpperCase() : '1K';

  // 构造请求 Body (严格遵循最新 apifox 文档)
  const body = {
    model: MODEL_NAME,
    prompt: prompt,
    aspectRatio: aspectRatio || '1:1',
    imageSize: imageSize,
    replyType: 'async'   // 异步轮询: 提交后立即返回任务 id
  };

  // 处理参考图 (images 支持 base64 与 url 链接)
  if (images && images.length > 0) {
    const imageUrls = await Promise.all(images.map(async img => {
      // 如果已经是公网 URL，直接返回
      if (typeof img === 'string' && img.startsWith('http')) return img;

      // 如果是 Base64 (带前缀)，直接返回
      if (typeof img === 'string' && img.startsWith('data:')) {
        return img;
      }

      // 如果是纯 Base64 (来自 compressImage)，补充前缀
      return `data:image/jpeg;base64,${img}`;
    }));
    body.images = imageUrls;
  }

  try {
    // 1. 提交任务
    console.log('🚀 正在提交 GRSAI 任务:', body);
    const response = await apiClient.post(API_ENDPOINT, body);
    const data = response.data;

    // 2. 新接口直接返回 { id, status, results } (无 code 包装)
    if (data.id) {
      // 若接口直接返回成品图，则无需轮询
      if (data.status === 'succeeded' && data.results?.[0]?.url) {
        return {
          success: true,
          data: data,
          imageUrl: data.results[0].url,
        };
      }

      console.log('📝 任务已创建, ID:', data.id);

      // 3. 轮询异步结果
      const imageUrl = await pollTaskResult(data.id);

      return {
        success: true,
        data: data,
        imageUrl: imageUrl,
      };
    }

    throw new Error(data.message || data.error || data.msg || '提交绘画任务失败');

  } catch (error) {
    console.error('❌ Generation Error (GRSAI):', error.response?.data || error.message);
    const errData = error.response?.data;
    return {
      success: false,
      error: errData?.message || errData?.error || errData?.msg || error.message || '生成失败，请检查配置',
    };
  }
};

/**
 * 轮询任务结果 (GET /v1/api/result?id=任务id)
 */
const pollTaskResult = async (taskId, maxAttempts = 60, interval = 3000) => {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // 等待间隔
      if (attempt > 0) await new Promise(resolve => setTimeout(resolve, interval));

      // GET /v1/api/result?id=xxxxxx
      const response = await apiClient.get(RESULT_ENDPOINT, { params: { id: taskId } });
      const taskData = response.data;
      const status = taskData.status;
      const progress = taskData.progress;

      console.log(`⏳ 任务进度: ${progress}%, 状态: ${status}`);

      if (status === 'succeeded') {
        const resultImg = taskData.results?.[0]?.url;
        if (resultImg) return resultImg;
        throw new Error('未获取到生成的图片地址');
      } else if (status === 'failed' || status === 'violation') {
        const reason = taskData.error || (status === 'violation' ? '内容违规' : '任务失败');
        throw new Error(`生成失败: ${reason}`);
      }
      // status 为 "running" 时继续轮询

    } catch (error) {
      // 如果是明确的失败（业务失败），不再重试
      if (error.message.startsWith('生成失败:')) throw error;

      if (attempt === maxAttempts - 1) throw error;
      console.warn(`轮询尝试 ${attempt} 异常:`, error.message);
    }
  }
  throw new Error('获取结果超时，请尝试刷新页面重试');
};

/**
 * 文本生成图像
 */
export const textToImage = async ({ prompt, negativePrompt = '', aspectRatio = '1:1', resolution = '1k' }) => {
  const fullPrompt = negativePrompt ? `${prompt} --no ${negativePrompt}` : prompt;
  return generateContent({ prompt: fullPrompt, images: [], aspectRatio, resolution });
};

/**
 * 图像生成图像 / 多图融合
 */
export const imageToImage = async ({
  images = [],
  prompt,
  strength = 0.75,
  aspectRatio = '1:1',
  resolution = '1k'
}) => {
  return generateContent({
    prompt,
    images: images,
    aspectRatio,
    resolution
  });
};

/**
 * 多图融合
 */
export const multiFusion = async ({
  images,
  prompt = '',
  mode = 'blend',
  aspectRatio = '1:1',
  resolution = '1k'
}) => {
  const fusionPrompt = prompt || `mode: ${mode}`;
  return generateContent({
    prompt: fusionPrompt,
    images: images,
    aspectRatio,
    resolution
  });
};

/**
 * 文件转 Base64
 */
export const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export default {
  textToImage,
  imageToImage,
  multiFusion,
  fileToBase64,
};
