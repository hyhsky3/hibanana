import axios from 'axios';

// API 配置 - 速创API
const API_BASE_URL = 'https://api.wuyinkeji.com';
const API_KEY = 'tLdPCRBfuA4nK1Exu9h9lNh2a6';
const API_ENDPOINT = '/api/img/nanoBanana-pro'; // 速创API端点

// 创建 axios 实例
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json;charset=utf-8',
  },
  timeout: 60000,
});

/**
 * 压缩图片并转为 Base64
 * @param {File} file 文件对象
 * @param {number} maxWidth 最大宽度
 * @param {number} maxHeight 最大高度
 * @param {number} quality 质量 (0-1)
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

        // 计算缩放比例
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

        // 导出为 jpeg (通常比 png 小得多)
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        // 移除前缀
        const base64 = dataUrl.split(',')[1];
        resolve(base64);
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
};

/**
 * 将图片上传并获取 URL
 * 【终极回归版】：通过本站 API 中转，解决跨域并确性能。
 */
export const uploadImage = async (base64) => {
  try {
    // 强制调用本站 Vercel 提供的后端中转接口
    const uploadUrl = '/api/upload';

    const response = await axios.post(uploadUrl, {
      base64: base64
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    if (response.data && response.data.success && response.data.url) {
      console.log('✅ 内部上传成功:', response.data.url);
      return response.data.url;
    }

    throw new Error('中转服务器返回异常');
  } catch (error) {
    console.error('❌ 上传失败:', error.response?.data || error.message);
    throw new Error('上传参考图失败：服务器线路波动，请重试');
  }
};

// 通用生成函数
const generateContent = async ({ prompt, images = [], aspectRatio, resolution }) => {
  // 映射分辨率到 imageSize (1k/2k/4k -> 1K/2K/4K)
  const imageSize = resolution ? resolution.toUpperCase() : '1K';

  // 构造请求 Body (按文档要求使用 JSON 格式)
  const body = {
    key: API_KEY,
    prompt: prompt,
    aspectRatio: aspectRatio || '1:1',
    imageSize: imageSize
  };

  // 添加图片参数 (如果有)
  if (images && images.length > 0) {
    // 关键修复：确保所有 Base64 都在发送给速创 API 之前转为外网 URL
    const imageUrls = await Promise.all(images.map(async img => {
      // 如果已经是公开 HTTP URL，保持不变
      if (typeof img === 'string' && img.startsWith('http')) {
        return img;
      }

      // 如果是 Base64 (裸串或 Data URI)，先上传到图床
      let base64ToUpload = img;
      if (img.startsWith('data:')) {
        base64ToUpload = img.split(',')[1];
      }

      return await uploadImage(base64ToUpload);
    }));

    body.img_url = imageUrls;
  }

  try {
    // 【关键优化】：将鉴权信息同时放入 Header 和 Query 参数中，对齐官方“授权管理”说明
    const response = await apiClient.post(`${API_ENDPOINT}?key=${API_KEY}`, body, {
      headers: {
        'Authorization': API_KEY
      }
    });

    // 解析速创API响应格式
    const data = response.data;

    // 检查响应状态
    if (data.code !== 200) {
      throw new Error(data.msg || '生成失败');
    }

    // 检查是否返回了任务ID(异步模式)
    if (data.data && data.data.id && !data.data.image_url && !data.data.url) {
      const taskId = data.data.id;

      // 轮询获取结果
      const imageUrl = await pollTaskResult(taskId);

      return {
        success: true,
        data: data,
        imageUrl: imageUrl,
      };
    }

    // 获取图片URL - 尝试多种可能的路径(同步模式)
    const imageUrl = data.data?.image_url || data.data?.url || data.image_url || data.url;

    if (!imageUrl) {
      throw new Error('API 响应中未找到图像数据');
    }

    return {
      success: true,
      data: data,
      imageUrl: imageUrl, // 速创API返回的是图片URL,不是base64
    };

  } catch (error) {
    console.error('Generation Error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.msg || error.message || '生成失败',
    };
  }
};

// 轮询任务结果
const pollTaskResult = async (taskId, maxAttempts = 60, interval = 2000) => {
  const RESULT_ENDPOINT = '/api/img/drawDetail'; // 正确的查询详情接口

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // 等待一段时间再查询
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, interval));
      }

      const params = new URLSearchParams();
      params.append('key', API_KEY);
      params.append('id', taskId);

      const response = await apiClient.get(`${RESULT_ENDPOINT}?${params.toString()}`);
      const data = response.data;

      if (data.code === 200 && data.data) {
        const taskData = data.data;

        // 检查任务状态: 0:排队中，1:生成中，2:成功，3:失败
        if (taskData.status === 2) {
          // 成功,获取图片URL
          const imageUrl = taskData.image_url;
          if (imageUrl) {
            return imageUrl;
          }
        } else if (taskData.status === 3) {
          // 失败
          const reason = taskData.fail_reason || '图片生成失败';
          throw new Error(reason);
        }
        // 0:排队中，1:生成中 - 继续轮询
      }
    } catch (error) {
      // 如果是明确的失败错误,直接抛出
      if (error.message && error.message !== '图片生成失败') {
        throw error;
      }
    }
  }

  throw new Error('获取图片超时,请稍后重试');
};

/**
 * 文本生成图像
 */
export const textToImage = async ({ prompt, negativePrompt = '', aspectRatio = '1:1', resolution = '1k' }) => {
  // 将负面提示词合并到 Prompt 中
  const fullPrompt = negativePrompt
    ? `${prompt}, 负面提示词: ${negativePrompt}`
    : prompt;

  return generateContent({ prompt: fullPrompt, images: [], aspectRatio, resolution });
};

/**
 * 图像生成图像 / 多图融合 (支持 1-10 张图片)
 */
export const imageToImage = async ({
  images = [],
  prompt,
  strength = 0.75,
  aspectRatio = '1:1',
  resolution = '1k'
}) => {
  // 速创API不直接支持strength参数,可以通过提示词来控制
  const enhancedPrompt = prompt;

  return generateContent({
    prompt: enhancedPrompt,
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
  // 融合模式通过提示词表达
  const fusionPrompt = `融合模式: ${mode}. ${prompt}`;

  return generateContent({
    prompt: fusionPrompt,
    images: images,
    aspectRatio,
    resolution
  });
};

/**
 * 将图像文件转换为 Base64 (仅数据部分)
 */
export const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // 移除 data:image/...;base64, 前缀
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
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
