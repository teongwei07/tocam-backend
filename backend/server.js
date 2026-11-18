/**
 * ============================================================
 * 🍊 TỔ CAM - PAYMENT & DNS BACKEND SERVER (FREE / AUTO-ACTIVATE)
 * Lược bỏ hoàn toàn bước thanh toán, tự động cấp file .mobileconfig
 * và xác thực trực tiếp qua Username Locket.
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

// Chống cache tĩnh trên trình duyệt điện thoại
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
// CẤU HÌNH HỆ THỐNG
// =============================================
const CONFIG = {
  PORT: process.env.PORT || 3000,
  LOCKET_SECRET_KEY: process.env.LOCKET_SECRET_KEY || 'sk_a6f8887c53d6baa3f90a7929e85b693b7dddc82bfd4ecfb233efa75dd7551df7',
  LOCKET_API_BASE: process.env.LOCKET_API_BASE || 'https://locket.2707226.xyz',
};

const TX_FILE = path.join(__dirname, 'transactions.json');
const USERS_FILE = path.join(__dirname, 'users.json');

const KNOWN_AVATARS = {
  'ney_ihnn': 'https://cdn2.locketcamera.com/v0/b/locket-img/o/users%2FTmSHu7R3CnYENbOk4roifJlWdD12%2Fpublic%2Fprofile_pic.webp?alt=media&token=19a21efb-5e7c-4c62-9a51-c8a24d1f25cd',
  'kienviet': 'https://cdn2.locketcamera.com/v0/b/locket-img/o/users%2Ft9iNECEtx2dJE9n36VvYb9xoMxy2%2Fpublic%2Fprofile_pic.webp?alt=media&token=dd907711-a017-4c82-8069-21154ec58e21',
  'hna.gnoud_l': 'https://cdn2.locketcamera.com/v0/b/locket-img/o/users%2FPnqkZk51svW7NPzpCnSLy0nCAoz2%2Fpublic%2Fprofile_pic.webp?alt=media&token=e7d7986f-5b13-4c06-99fb-2b716dcb4750',
  'xtien287': 'https://cdn2.locketcamera.com/v0/b/locket-img/o/users%2F2s6uO8UpjmhKvHLlbjUsYrFaXqu1%2Fpublic%2Fprofile_pic.webp?alt=media&token=d7da47c5-a379-46f9-8c22-ffc0874a4f6b',
  'nth05': 'https://cdn2.locketcamera.com/v0/b/locket-img/o/users%2Fzs4QAybLYGeCojbRg7ZYNeS1g9b2%2Fpublic%2Fprofile_pic.webp?alt=media&token=5ffdaa57-d5ac-4e06-8f7d-974a45d4aea8'
};

function normalizeUsername(str) {
  return (str || '').toLowerCase().trim().replace('@', '').replace(/[^a-z0-9]/gi, '');
}

const KNOWN_CANONICAL_ALIASES = {
  'neyihnn': 'ney_ihnn',
  'hnagnoudl': 'hna.gnoud_l',
  'ynnt': 'yn.nt',
  'dwyhiu23': 'dwyhiu_23',
  'hiembe': 'hi_embe',
  'truongphutrong': 'truongphutrong',
  'phutrong07': 'phutrong07'
};

function cleanLocketUsername(str) {
  if (!str) return '';
  let u = String(str).toLowerCase().trim().replace('@', '');
  if (u.includes('locket.cam/')) {
    u = u.split('locket.cam/')[1].split(/[/?#]/)[0];
  } else if (u.includes('locketcam')) {
    u = u.replace(/.*locketcam/, '');
  }
  u = u.replace(/[\._\s-]*(ct|ibft|chuyentien).*$/i, '');
  u = u.trim();
  return KNOWN_CANONICAL_ALIASES[u] || u;
}

function resolveCanonicalUsername(rawUser) {
  if (!rawUser) return '';
  const cleaned = cleanLocketUsername(rawUser);
  const norm = normalizeUsername(cleaned);
  if (KNOWN_CANONICAL_ALIASES[norm]) return KNOWN_CANONICAL_ALIASES[norm];
  if (KNOWN_CANONICAL_ALIASES[cleaned]) return KNOWN_CANONICAL_ALIASES[cleaned];
  
  try {
    const users = loadUsers();
    if (users[cleaned]) return users[cleaned].username || cleaned;
    for (const [k, v] of Object.entries(users)) {
      if (normalizeUsername(k) === norm) return v.username || k;
    }
  } catch (e) {}

  return cleaned;
}

function isValidLocketUsername(str) {
  if (!str || typeof str !== 'string') return false;
  const clean = cleanLocketUsername(str);
  if (!clean) return false;
  return /^[a-zA-Z0-9._-]+$/.test(clean);
}

// =============================================
// QUẢN LÝ JSON STORE
// =============================================
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

    const newItem = {
      username: cleanUser,
      plan: txItem.plan || 'LIFETIME',
      amount: 0,
      time: txItem.time || new Date().toISOString(),
      txId: txItem.txId || `free_${Date.now()}`,
      status: 'success',
      avatarUrl: txItem.avatarUrl || KNOWN_AVATARS[cleanUser] || null
    };

    list.unshift(newItem);
    if (list.length > 100) list.pop();
    fs.writeFileSync(TX_FILE, JSON.stringify(list, null, 2), 'utf-8');
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

    const existing = users[cleanUser] || {
      username: cleanUser,
      createdAt: new Date().toISOString(),
      history: []
    };

    const updated = {
      ...existing,
      ...userData,
      username: cleanUser,
      updatedAt: new Date().toISOString()
    };

    users[cleanUser] = updated;
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
    return updated;
  } catch (e) {
    return null;
  }
}

// =============================================
// HELPER: Gọi Locket API
// =============================================
function locketRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    if (!CONFIG.LOCKET_SECRET_KEY) {
      return reject(new Error('LOCKET_SECRET_KEY chưa được cấu hình.'));
    }

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
        const contentType = res.headers['content-type'] || '';

        if (contentType.includes('apple-aspen-config') || contentType.includes('octet-stream')) {
          resolve({ statusCode: res.statusCode, headers: res.headers, buffer: rawBuffer, isFile: true });
        } else {
          try {
            resolve({ statusCode: res.statusCode, headers: res.headers, data: JSON.parse(rawBuffer.toString()), isFile: false });
          } catch {
            resolve({ statusCode: res.statusCode, headers: res.headers, data: rawBuffer.toString(), isFile: false });
          }
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// =============================================
// API ENDPOINTS (FREE & AUTO-ACTIVATE)
// =============================================
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'TỔ CAM Free DNS Backend',
    time: new Date().toISOString()
  });
});

// Bỏ qua thanh toán, check luôn trả về thành công
app.get('/check-payment', (req, res) => {
  const raw = (req.query.username || '').toLowerCase().trim().replace('@', '');
  const username = resolveCanonicalUsername(raw) || cleanLocketUsername(raw);

  if (!username) {
    return res.status(400).json({ error: 'Thiếu username' });
  }

  return res.json({
    paid: true,
    consumed: false,
    plan: 'LIFETIME',
    amount: 0,
    username,
    locketStatus: 'success',
    expiresAt: 'Vĩnh Viễn'
  });
});

// Proxy kiểm tra username Locket & tự động lưu hồ sơ miễn phí
app.get('/api/locket/uid/check', async (req, res) => {
  const rawUser = (req.query.username || '').trim().replace('@', '');
  const username = resolveCanonicalUsername(rawUser) || cleanLocketUsername(rawUser);

  if (!username) {
    return res.status(400).json({ ok: false, message: 'Thiếu username' });
  }

  const cleanUser = username.toLowerCase();
  const users = loadUsers();
  let existingUser = users[cleanUser];

  if (CONFIG.LOCKET_SECRET_KEY) {
    try {
      const result = await locketRequest('GET`, `/api/uid/check?username=${encodeURIComponent(username)}`);
      if (result.statusCode === 200 && result.data) {
        const d = result.data.data || result.data;
        const verifiedUid = d?.uid?.uidString || d?.uid || null;
        const verifiedUser = d?.username || username;

        if (verifiedUid) {
          existingUser = saveUser({
            username: verifiedUser,
            uid: verifiedUid,
            avatarUrl: d?.avatarUrl || undefined,
            status: 'ACTIVE',
            currentPlan: 'LIFETIME',
            expiresAt: 'Vĩnh Viễn'
          });

          return res.json({
            ok: true,
            found: true,
            data: {
              username: verifiedUser,
              uid: verifiedUid,
              avatarUrl: d.avatarUrl || existingUser?.avatarUrl || null,
              active: true,
              status: 'ACTIVE',
              expiresAt: 'Vĩnh Viễn'
            }
          });
        }
      }
    } catch (err) {}
  }

  // Nếu không gọi được API Cụ Cam hoặc user tồn tại local
  if (!existingUser) {
    existingUser = saveUser({
      username: cleanUser,
      uid: `free_uid_${Date.now()}`,
      status: 'ACTIVE',
      currentPlan: 'LIFETIME',
      expiresAt: 'Vĩnh Viễn',
      avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(cleanUser)}&background=FFA033&color=fff&size=128&bold=true`
    });
  }

  return res.json({
    ok: true,
    found: true,
    data: {
      username: existingUser.username,
      uid: existingUser.uid,
      avatarUrl: existingUser.avatarUrl,
      active: true,
      status: 'ACTIVE',
      expiresAt: 'Vĩnh Viễn'
    }
  });
});

// API Tải file mobileconfig riêng biệt cho từng user
app.all('/api/locket/profile/download', async (req, res) => {
  const username = req.body?.username || req.query?.username;
  if (!username) {
    return res.status(400).json({ ok: false, message: 'Thiếu username' });
  }

  const cleanUser = resolveCanonicalUsername(username) || cleanLocketUsername(username);
  
  // Tạo nội dung file .mobileconfig tùy chỉnh tên riêng của user
  const profileXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>PayloadDescription</key>
	<string>Cấu hình Locket Gold VIP (Camera Filter) dành riêng cho @${cleanUser}. Cài xong: Cài đặt -> Cài đặt chung -> Giới thiệu -> Cài đặt tin cậy chứng nhận -> Bật "LocketProxy CA".</string>
	<key>PayloadDisplayName</key>
	<string>Locket Gold VIP [${cleanUser}]</string>
	<key>PayloadIdentifier</key>
	<string>com.tocam.locketgold.${cleanUser}</string>
	<key>PayloadType</key>
	<string>Configuration</string>
	<key>PayloadUUID</key>
	<string>7B8394AA-C211-4F12-8822-${Date.now().toString().slice(-8)}</string>
	<key>PayloadVersion</key>
	<integer>1</integer>
	<key>PayloadContent</key>
	<array>
		<dict>
			<key>PayloadDescription</key>
			<string>Cấu hình DNS DoH bảo mật Tổ Cam</string>
			<key>PayloadDisplayName</key>
			<string>DNS DoH Locket Gold</string>
			<key>PayloadIdentifier</key>
			<string>com.tocam.dns.${cleanUser}</string>
			<key>PayloadType</key>
			<string>com.apple.dnsSettings.managed</string>
			<key>PayloadUUID</key>
			<string>9F8211BC-3D44-4E51-99CC-${Date.now().toString().slice(-8)}</string>
			<key>PayloadVersion</key>
			<integer>1</integer>
			<key>DNSSettings</key>
			<dict>
				<key>ServerAddresses</key>
				<array>
					<string>1.1.1.1</string>
					<string>8.8.8.8</string>
				</array>
			</dict>
		</dict>
	</array>
</dict>
</plist>`;

  res.setHeader('Content-Type', 'application/x-apple-aspen-config');
  res.setHeader('Content-Disposition', `attachment; filename="LocketGold_${cleanUser}.mobileconfig"`);
  return res.send(Buffer.from(profileXML, 'utf-8'));
});

// API Kích hoạt nhanh không cần coin
app.post('/api/activate', async (req, res) => {
  const { username, plan } = req.body || {};
  const u = resolveCanonicalUsername(username) || cleanLocketUsername(username);

  if (!u) {
    return res.status(400).json({ ok: false, message: 'Thiếu username' });
  }

  saveUser({
    username: u,
    currentPlan: plan || 'LIFETIME',
    status: 'ACTIVE',
    expiresAt: 'Vĩnh Viễn',
    lastRenewedAt: new Date().toISOString()
  });

  saveTransactionToHistory({
    username: u,
    plan: plan || 'LIFETIME',
    time: new Date().toISOString()
  });

  return res.json({
    ok: true,
    message: 'Kích hoạt thành công!',
    uid: `free_uid_${u}`,
    expiresAt: 'Vĩnh Viễn',
    plan: plan || 'LIFETIME'
  });
});

// API Tra cứu hồ sơ & lịch sử
app.post('/api/user/lookup', async (req, res) => {
  const { username } = req.body || {};
  const u = resolveCanonicalUsername(username) || cleanLocketUsername(username);

  if (!u) {
    return res.status(400).json({ ok: false, message: 'Vui lòng nhập Username Locket!' });
  }

  const users = loadUsers();
  let user = users[u] || {
    username: u,
    currentPlan: 'LIFETIME',
    status: 'ACTIVE',
    expiresAt: 'Vĩnh Viễn',
    avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(u)}&background=FFA033&color=fff&size=128&bold=true`,
    history: [{ txId: `tx_${u}`, plan: 'LIFETIME', amount: 0, time: new Date().toISOString(), status: 'success' }]
  };

  const host = req.get('host') || 'localhost:3000';
  const protocol = req.protocol || 'http';
  const dnsDownloadUrl = `${protocol}://${host}/api/locket/profile/download?username=${encodeURIComponent(u)}`;

  return res.json({
    ok: true,
    user: {
      username: user.username,
      avatarUrl: user.avatarUrl,
      hasPin: false,
      uid: user.uid || `free_uid_${u}`,
      status: 'ACTIVE',
      currentPlan: user.currentPlan || 'LIFETIME',
      expiresAt: 'Vĩnh Viễn',
      history: user.history || [{ txId: `tx_${u}`, plan: 'LIFETIME', amount: 0, time: new Date().toISOString(), status: 'success' }],
      dnsDownloadUrl
    }
  });
});

app.get('/api/recent-transactions', (req, res) => {
  const list = loadSavedTransactions();
  res.json({ ok: true, data: list });
});

// =============================================
// KHỞI ĐỘNG SERVER
// =============================================
app.listen(CONFIG.PORT, () => {
  console.log(`
🍊 ====================================
   TỔ CAM Free DNS Server - ONLINE
   Port: ${CONFIG.PORT}
   Mode: MIỄN PHÍ HOÀN TOÀN (Tự động cấp DNS)
====================================
  `);
});
