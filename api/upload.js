export default async function handler(req, res) {
    // 设置 CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const { base64 } = req.body;
        if (!base64) {
            return res.status(400).json({ message: 'Missing base64 data' });
        }

        // 剔除前缀
        const cleanBase64 = base64.replace(/^data:image\/\w+;base64,/, "");

        // 使用 freeimage.host 的免费 API（无需 Key）
        const response = await fetch('https://freeimage.host/api/1/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                key: '6d207e02198a847aa98d0a2a901485a5', // 公共免费 key
                source: cleanBase64,
                format: 'json'
            })
        });

        const data = await response.json();

        if (data.success && data.image && data.image.url) {
            return res.status(200).json({ success: true, url: data.image.url });
        } else {
            return res.status(500).json({ success: false, error: data });
        }
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
}
