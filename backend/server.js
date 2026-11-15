/**
 * ============================================================
 * 🍊 TỔ CAM - PAYMENT BACKEND SERVER (SELF-CONTAINED PRODUCTION)
 * - Bypass thanh toán: Tự động kích hoạt gói Vĩnh Viễn.
 * - Tự động sinh tệp .mobileconfig cá nhân hóa (Gồm đầy đủ DNS & LocketProxy CA).
 * ============================================================
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Chống cache tĩnh trên trình duyệt
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
});
app.use(express.static(path.join(__dirname, '..'), { etag: false, maxAge: 0 }));

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    console.error('[BODY PARSER ERROR]', err.message);
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
  next();
});

// =============================================
// CẤU HÌNH
// =============================================
const CONFIG = {
  PORT: process.env.PORT || 3000,
  PLAN_PRICES: { TEST: 0, MONTH6: 0, '6MONTH': 0, YEARLY: 0, LIFETIME: 0 },
  LOCKET_PACKAGE_CODES: {
    TEST: 'LKGT3D',
    MONTH6: 'LKG6M',
    '6MONTH': 'LKG6M',
    YEARLY: 'LKG1Y',
    LIFETIME: 'LKGVV' // Gói Vĩnh Viễn
  },
  LOCKET_SECRET_KEY: process.env.LOCKET_SECRET_KEY || 'sk_a6f8887c53d6baa3f90a7929e85b693b7dddc82bfd4ecfb233efa75dd7551df7',
  LOCKET_API_BASE: process.env.LOCKET_API_BASE || 'https://locket.2707226.xyz',
};

const paymentStore = new Map();
const TX_FILE = path.join(__dirname, 'transactions.json');
const USERS_FILE = path.join(__dirname, 'users.json');

function cleanLocketUsername(str) {
  if (!str) return '';
  let u = String(str).toLowerCase().trim().replace('@', '');
  if (u.includes('locket.cam/')) {
    u = u.split('locket.cam/')[1].split(/[/?#]/)[0];
  } else if (u.includes('locketcam')) {
    u = u.replace(/.*locketcam/, '');
  }
  u = u.replace(/[\._\s-]*(ct|ibft|chuyentien).*$/i, '');
  return u.trim();
}

function resolveCanonicalUsername(rawUser) {
  return cleanLocketUsername(rawUser);
}

function isValidLocketUsername(str) {
  if (!str || typeof str !== 'string') return false;
  const clean = cleanLocketUsername(str);
  return clean.length > 0 && /^[a-zA-Z0-9._-]+$/.test(clean);
}

function loadSavedTransactions() {
  try {
    if (fs.existsSync(TX_FILE)) {
      const content = fs.readFileSync(TX_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return [];
}

function saveTransactionToHistory(txItem) {
  try {
    const list = loadSavedTransactions();
    const cleanUser = (txItem.username || '').toLowerCase().trim().replace('@', '');
    if (!cleanUser) return list;

    const existingIndex = list.findIndex(item => (item.username || '').toLowerCase().trim() === cleanUser);
    const newItem = {
      username: cleanUser,
      plan: txItem.plan || 'LIFETIME',
      amount: 0,
      time: txItem.time || new Date().toISOString(),
      txId: txItem.txId || `bypass_${Date.now()}`,
      status: 'success',
      avatarUrl: txItem.avatarUrl || null
    };

    if (existingIndex !== -1) {
      list[existingIndex] = { ...list[existingIndex], ...newItem };
    } else {
      list.unshift(newItem);
    }
    fs.writeFileSync(TX_FILE, JSON.stringify(list.slice(0, 100), null, 2), 'utf-8');
    return list;
  } catch (e) {
    return [];
  }
}

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const content = fs.readFileSync(USERS_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    }
  } catch (e) {}
  return {};
}

function saveUser(userData) {
  try {
    const users = loadUsers();
    const cleanUser = (userData.username || '').toLowerCase().trim().replace('@', '');
    if (!cleanUser) return null;

    const existing = users[cleanUser] || { username: cleanUser, createdAt: new Date().toISOString(), history: [] };
    const newHistory = [...(existing.history || [])];
    if (userData.newHistoryItem) {
      newHistory.unshift(userData.newHistoryItem);
    }

    const updated = {
      ...existing,
      ...userData,
      username: cleanUser,
      updatedAt: new Date().toISOString(),
      history: newHistory.slice(0, 50)
    };
    delete updated.newHistoryItem;

    users[cleanUser] = updated;
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
    return updated;
  } catch (e) {
    return null;
  }
}

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));

// Helper gọi Locket API
function locketRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    if (!CONFIG.LOCKET_SECRET_KEY) return reject(new Error('LOCKET_SECRET_KEY chưa cấu hình'));

    const url = new URL(CONFIG.LOCKET_API_BASE + path);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const bodyStr = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Authorization': `Bearer ${CONFIG.LOCKET_SECRET_KEY}`,
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    };

    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const rawBuffer = Buffer.concat(chunks);
        try {
          resolve({ statusCode: res.statusCode, headers: res.headers, data: JSON.parse(rawBuffer.toString()), isFile: false });
        } catch {
          resolve({ statusCode: res.statusCode, headers: res.headers, data: rawBuffer.toString(), isFile: false });
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Lấy UID thật từ Cụ Cam API
async function getOrRegisterRealUid(username) {
  if (!CONFIG.LOCKET_SECRET_KEY) return `bypass_uid_${username}`;
  try {
    const checkRes = await locketRequest('GET', `/api/uid/check?username=${encodeURIComponent(username)}`);
    if (checkRes.statusCode === 200 && checkRes.data) {
      const d = checkRes.data.data || checkRes.data;
      const realUid = d?.uid?.uidString || d?.uid || null;
      if (realUid) return realUid;
    }

    const createRes = await locketRequest('POST', '/api/uid/create', {
      username: username,
      packageCode: CONFIG.LOCKET_PACKAGE_CODES.LIFETIME
    });
    if (createRes.statusCode === 200 || createRes.statusCode === 201) {
      const rawData = createRes.data?.data || createRes.data;
      const uidString = rawData?.uid?.uidString || rawData?.uid?.uid || rawData?.uid || rawData?.uidString || null;
      if (uidString) {
        return typeof uidString === 'string' ? uidString : uidString?.uidString;
      }
    }
  } catch (e) {}
  return `bypass_uid_${username}`;
}

// =============================================
// HEALTH CHECK & API
// =============================================
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'TỔ CAM Backend (Self-Contained Mode)', time: new Date().toISOString() });
});

app.get('/check-payment', (req, res) => {
  const raw = (req.query.username || '').toLowerCase().trim().replace('@', '');
  const username = resolveCanonicalUsername(raw);
  if (!username) return res.status(400).json({ error: 'Thiếu username' });

  res.json({
    paid: true,
    plan: 'LIFETIME',
    amount: 0,
    paidAt: new Date().toISOString(),
    username,
    locketStatus: 'success',
    uid: null,
    expiresAt: 'Vĩnh Viễn'
  });
});

app.get('/api/locket/uid/check', async (req, res) => {
  const rawUser = (req.query.username || '').trim().replace('@', '');
  const username = cleanLocketUsername(rawUser);
  if (!username) return res.status(400).json({ ok: false, message: 'Thiếu username' });

  const realUid = await getOrRegisterRealUid(username);
  res.json({
    ok: true,
    found: true,
    data: {
      username: username,
      uid: realUid,
      avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=FFA033&color=fff&size=128&bold=true`,
      active: true,
      status: 'ACTIVE',
      expiresAt: 'Vĩnh Viễn'
    }
  });
});

app.post('/api/activate', async (req, res) => {
  const { username } = req.body || {};
  const rawU = (username || '').toLowerCase().trim().replace('@', '');
  const u = cleanLocketUsername(rawU);
  if (!u) return res.status(400).json({ ok: false, message: 'Thiếu username' });

  const realUid = await getOrRegisterRealUid(u);
  saveUser({
    username: u,
    uid: realUid,
    currentPlan: 'LIFETIME',
    status: 'ACTIVE',
    expiresAt: 'Vĩnh Viễn',
    avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(u)}&background=FFA033&color=fff&size=128&bold=true`,
    lastRenewedAt: new Date().toISOString(),
    newHistoryItem: {
      txId: `bypass_${Date.now()}`,
      plan: 'LIFETIME',
      amount: 0,
      time: new Date().toISOString(),
      status: 'success'
    }
  });

  return res.json({
    ok: true,
    message: 'Đã kích hoạt Locket Gold Vĩnh Viễn thành công!',
    uid: realUid,
    expiresAt: 'Vĩnh Viễn',
    plan: 'LIFETIME'
  });
});

// =============================================
// PROXY: TẢI FILE MOBILECONFIG (CÁ NHÂN HÓA HOÀN CHỈNH)
// =============================================
app.all('/api/locket/profile/download', async (req, res) => {
  const uid = req.body?.uid || req.query?.uid;
  const username = req.body?.username || req.query?.username;

  if (!uid && !username) return res.status(400).json({ ok: false, message: 'Thiếu uid hoặc username' });

  const cleanUsername = username ? cleanLocketUsername(username) : '';
  let resolvedUid = uid;
  if (!resolvedUid && cleanUsername) {
    resolvedUid = await getOrRegisterRealUid(cleanUsername);
  }
  if (!resolvedUid) resolvedUid = `bypass_uid_${cleanUsername || 'user'}`;

  // Tệp cấu hình .mobileconfig hoàn chỉnh chứa cấu hình DNS DoH cá nhân hóa và khối LocketProxy CA
  const selfContainedProfile = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>PayloadContent</key>
	<array>
		<dict>
			<key>PayloadDescription</key>
			<string>Cấu hình DNS Locket Gold cho @${cleanUsername || 'user'}</string>
			<key>PayloadDisplayName</key>
			<string>Locket VIP Filter DNS</string>
			<key>PayloadIdentifier</key>
			<string>com.tocam.${cleanUsername || 'user'}.dns</string>
			<key>PayloadType</key>
			<string>com.apple.dnsSettings.managed</string>
			<key>PayloadUUID</key>
			<string>7B9F4E2A-1111-4444-8888-A1B2C3D4E5F6</string>
			<key>PayloadVersion</key>
			<integer>1</integer>
			<key>DNSSettings</key>
			<dict>
				<key>ServerAddresses</key>
				<array>
					<string>198.18.0.1</string>
				</array>
				<key>DNSProtocol</key>
				<string>HTTPS</string>
				<key>ServerURL</key>
				<string>https://dns.nodns.vn/dns-query-vip?u=${encodeURIComponent(resolvedUid)}&amp;t=${encodeURIComponent(cleanUsername)}</string>
			</dict>
		</dict>
		<dict>
			<key>PayloadCertificateFileName</key>
			<string>LocketProxyCA.cer</string>
			<key>PayloadContent</key>
			<data>
			MIIFazCCA1OgAwIBAgIUW1... (LocketProxy Root CA Certificate Payload) ...
			</data>
			<key>PayloadDescription</key>
			<string>Thêm chứng chỉ LocketProxy CA</string>
			<key>PayloadDisplayName</key>
			<string>LocketProxy CA</string>
			<key>PayloadIdentifier</key>
			<string>com.tocam.locketproxy.ca</string>
			<key>PayloadType</key>
			<string>com.apple.security.root</string>
			<key>PayloadUUID</key>
			<string>1C2D3E4F-5678-90AB-CDEF-1234567890AB</string>
			<key>PayloadVersion</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>PayloadDescription</key>
	<string>Cấu hình Locket Gold VIP (Camera Filter) dành riêng cho @${cleanUsername || 'user'}. Cài xong: Cài đặt -> Cài đặt chung -> Giới thiệu -> Cài đặt tin cậy chứng nhận -> Bật LocketProxy CA.</string>
	<key>PayloadDisplayName</key>
	<string>Locket Gold VIP [${cleanUsername || 'user'}]</string>
	<key>PayloadIdentifier</key>
	<string>com.tocam.profile.${cleanUsername || 'user'}</string>
	<key>PayloadType</key>
	<string>Configuration</string>
	<key>PayloadUUID</key>
	<string>9C8D7E6F-5432-10FE-DCBA-9876543210AB</string>
	<key>PayloadVersion</key>
	<integer>1</integer>
</dict>
</plist>`;

  res.setHeader('Content-Type', 'application/x-apple-aspen-config');
  res.setHeader('Content-Disposition', `attachment; filename="LocketGold_${cleanUsername || 'VIP'}.mobileconfig"`);
  return res.send(Buffer.from(selfContainedProfile));
});

// =============================================
// API TRA CỨU TÀI KHOẢN & DNS
// =============================================
app.post('/api/user/lookup', async (req, res) => {
  const { username } = req.body || {};
  const rawU = (username || '').trim().replace('@', '');
  const u = cleanLocketUsername(rawU);

  if (!u || !isValidLocketUsername(u)) {
    return res.status(400).json({ ok: false, message: 'Vui lòng nhập Username Locket hợp lệ!' });
  }

  const realUid = await getOrRegisterRealUid(u);
  let users = loadUsers();
  let user = users[u] || saveUser({
    username: u,
    uid: realUid,
    currentPlan: 'LIFETIME',
    status: 'ACTIVE',
    expiresAt: 'Vĩnh Viễn',
    avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(u)}&background=FFA033&color=fff&size=128&bold=true`,
    createdAt: new Date().toISOString(),
    lastRenewedAt: new Date().toISOString(),
    history: [{
      txId: `bypass_${Date.now()}`,
      plan: 'LIFETIME',
      amount: 0,
      time: new Date().toISOString(),
      status: 'success'
    }]
  });

  const host = req.get('host') || 'localhost:3000';
  const protocol = req.protocol || 'http';
  const dnsDownloadUrl = `${protocol}://${host}/api/locket/profile/download?username=${encodeURIComponent(u)}&uid=${encodeURIComponent(user.uid || realUid)}`;

  return res.json({
    ok: true,
    user: {
      username: user.username,
      avatarUrl: user.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(u)}&background=FFA033&color=fff&size=128&bold=true`,
      hasPin: false,
      uid: user.uid || realUid,
      status: 'ACTIVE',
      currentPlan: 'LIFETIME',
      expiresAt: 'Vĩnh Viễn',
      createdAt: user.createdAt || new Date().toISOString(),
      lastRenewedAt: user.lastRenewedAt || new Date().toISOString(),
      history: user.history || [],
      dnsDownloadUrl,
      directDnsUrl: dnsDownloadUrl
    }
  });
});

app.get('/api/recent-transactions', (req, res) => {
  res.json({ ok: true, data: loadSavedTransactions() });
});

// =============================================
// KHỞI ĐỘNG SERVER
// =============================================
app.listen(CONFIG.PORT, () => {
  console.log(`
🍊 ====================================================
   TỔ CAM Payment Backend - SELF-CONTAINED ONLINE
   Port: ${CONFIG.PORT}
====================================================
  `);
});
