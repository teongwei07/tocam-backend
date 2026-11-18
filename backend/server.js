/**
 * ============================================================
 * 🍊 TỔ CAM - PAYMENT & DNS BACKEND SERVER (FULL PRO - CA & DNS)
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

const CONFIG = {
  PORT: process.env.PORT || 3000,
  LOCKET_SECRET_KEY: process.env.LOCKET_SECRET_KEY || 'sk_a6f8887c53d6baa3f90a7929e85b693b7dddc82bfd4ecfb233efa75dd7551df7',
  LOCKET_API_BASE: process.env.LOCKET_API_BASE || 'https://locket.2707226.xyz',
};

const USERS_FILE = path.join(__dirname, 'users.json');

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
  const norm = cleaned.replace(/[^a-z0-9]/gi, '');
  if (KNOWN_CANONICAL_ALIASES[norm]) return KNOWN_CANONICAL_ALIASES[norm];
  return cleaned;
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
    users[cleanUser] = {
      ...(users[cleanUser] || {}),
      ...userData,
      username: cleanUser,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
    return users[cleanUser];
  } catch (e) {
    return null;
  }
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'TỔ CAM Full PRO Backend', time: new Date().toISOString() });
});

app.get('/check-payment', (req, res) => {
  const raw = (req.query.username || '').toLowerCase().trim().replace('@', '');
  const username = resolveCanonicalUsername(raw);
  if (!username) return res.status(400).json({ error: 'Thiếu username' });
  return res.json({ paid: true, plan: 'LIFETIME', username, locketStatus: 'success', expiresAt: 'Vĩnh Viễn' });
});

app.get('/api/locket/uid/check', async (req, res) => {
  const rawUser = (req.query.username || '').trim().replace('@', '');
  const username = resolveCanonicalUsername(rawUser);
  if (!username) return res.status(400).json({ ok: false, message: 'Thiếu username' });

  const cleanUser = username.toLowerCase();
  let existingUser = loadUsers()[cleanUser];

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

// API Tải file mobileconfig tích hợp chuẩn LocketProxy CA và DNS
app.all('/api/locket/profile/download', async (req, res) => {
  const username = req.body?.username || req.query?.username;
  if (!username) return res.status(400).json({ ok: false, message: 'Thiếu username' });

  const cleanUser = resolveCanonicalUsername(username);
  
  // Lấy chuỗi Base64 từ biến môi trường Render (Lưu ý: Không chứa khoảng trắng hoặc ký tự xuống dòng)
  const CERTIFICATE_BASE64 = (process.env.CA_CERT_BASE64 || "").trim();

  const profileXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>PayloadDescription</key>
	<string>Cấu hình Locket Gold VIP &amp; LocketProxy CA dành riêng cho @${cleanUser}.</string>
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
			<key>PayloadCertificateFileName</key>
			<string>LocketProxyCA.cer</string>
			<key>PayloadContent</key>
			<data>${CERTIFICATE_BASE64}</data>
			<key>PayloadDescription</key>
			<string>Cài đặt chứng chỉ LocketProxy CA</string>
			<key>PayloadDisplayName</key>
			<string>LocketProxy CA</string>
			<key>PayloadIdentifier</key>
			<string>com.tocam.cert.${cleanUser}</string>
			<key>PayloadType</key>
			<string>com.apple.security.root</string>
			<key>PayloadUUID</key>
			<string>3C8211BC-4D44-4E51-99CC-${Date.now().toString().slice(-8)}</string>
			<key>PayloadVersion</key>
			<integer>1</integer>
		</dict>
		<dict>
			<key>PayloadDescription</key>
			<string>Cấu hình DNS DoH bảo mật Tổ Cam</string>
			<key>PayloadDisplayName</key>
			<string>Locket VIP Filter DNS</string>
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

app.post('/api/user/lookup', async (req, res) => {
  const { username } = req.body || {};
  const u = resolveCanonicalUsername(username);
  if (!u) return res.status(400).json({ ok: false, message: 'Vui lòng nhập Username Locket!' });

  const host = req.get('host') || 'localhost:3000';
  const protocol = req.protocol || 'http';
  const dnsDownloadUrl = `${protocol}://${host}/api/locket/profile/download?username=${encodeURIComponent(u)}`;

  return res.json({
    ok: true,
    user: {
      username: u,
      avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(u)}&background=FFA033&color=fff&size=128&bold=true`,
      status: 'ACTIVE',
      currentPlan: 'LIFETIME',
      expiresAt: 'Vĩnh Viễn',
      dnsDownloadUrl
    }
  });
});

app.listen(CONFIG.PORT, () => {
  console.log(`Tổ Cam Full Server đang chạy tại cổng ${CONFIG.PORT}`);
});
