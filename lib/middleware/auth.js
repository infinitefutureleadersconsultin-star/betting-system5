// lib/middleware/auth.js
// Authentication with 1 device limit for ALL plans
// Simple and effective anti-sharing

import { verifyToken } from '@clerk/clerk-sdk-node';

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

const DEVICE_LIMIT = 1; // ALL PLANS GET 1 DEVICE ONLY

const userMetadataStore = new Map();
const deviceStore = new Map();

function generateDeviceId(req) {
  const ua = req.headers['user-agent'] || 'unknown';
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
  
  const crypto = require('crypto');
  return crypto
    .createHash('md5')
    .update(`${ua}-${ip}`)
    .digest('hex')
    .substring(0, 16);
}

async function checkDeviceLimit(userId, deviceId, tier) {
  if (!['basic', 'pro', 'admin'].includes(tier)) {
    return {
      allowed: false,
      requiresSubscription: true,
      message: 'Active subscription required. Please subscribe to continue.'
    };
  }
  
  let devices = deviceStore.get(userId);
  if (!devices) {
    devices = new Set();
    deviceStore.set(userId, devices);
  }
  
  if (devices.has(deviceId)) {
    return { allowed: true, isNew: false };
  }
  
  if (devices.size >= DEVICE_LIMIT) {
    const deviceList = Array.from(devices);
    return {
      allowed: false,
      isNew: true,
      limit: DEVICE_LIMIT,
      current: devices.size,
      message: `Device limit reached. You can only use one device at a time. Log out from your other device first.`,
      currentDevice: deviceList[0]
    };
  }
  
  devices.add(deviceId);
  deviceStore.set(userId, devices);
  
  return { 
    allowed: true, 
    isNew: true,
    current: devices.size,
    limit: DEVICE_LIMIT
  };
}

export async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Missing or invalid authorization header' 
      });
    }
    
    const token = authHeader.substring(7);
    
    const payload = await verifyToken(token, {
      secretKey: CLERK_SECRET_KEY,
    });
    
    if (!payload || !payload.sub) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Invalid token' 
      });
    }
    
    const userId = payload.sub;
    const userMeta = await getUserMetadata(userId);
    
    if (userMeta?.suspended) {
      return res.status(403).json({
        error: 'Account suspended',
        message: 'Your account has been suspended. Contact support.',
        suspendedAt: userMeta.suspendedAt,
        reason: userMeta.suspensionReason
      });
    }
    
    const tier = userMeta?.tier;
    
    if (!tier || !['basic', 'pro', 'admin'].includes(tier)) {
      return res.status(402).json({
        error: 'Subscription required',
        message: 'Active subscription required to use this service.',
        subscribeUrl: '/pricing'
      });
    }
    
    const deviceId = generateDeviceId(req);
    const deviceCheck = await checkDeviceLimit(userId, deviceId, tier);
    
    if (!deviceCheck.allowed) {
      if (deviceCheck.requiresSubscription) {
        return res.status(402).json({
          error: 'Subscription required',
          message: deviceCheck.message,
          subscribeUrl: '/pricing'
        });
      }
      
      return res.status(429).json({
        error: 'Device limit exceeded',
        message: deviceCheck.message,
        limit: deviceCheck.limit,
        current: deviceCheck.current,
        helpText: 'Log out from your other device or contact support to reset devices.'
      });
    }
    
    req.user = {
      id: userId,
      email: payload.email,
      tier,
      deviceId,
      isNewDevice: deviceCheck.isNew,
      stripeCustomerId: userMeta?.stripeCustomerId,
      suspended: false
    };
    
    if (deviceCheck.isNew) {
      console.log(`[Auth] New device login: user=${userId}, device=${deviceId}, tier=${tier}`);
    }
    
    next();
    
  } catch (err) {
    console.error('[authMiddleware] Error:', err);
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Token verification failed' 
    });
  }
}

async function getUserMetadata(userId) {
  return userMetadataStore.get(userId) || null;
}

export async function updateUserMetadata(userId, updates) {
  try {
    const current = await getUserMetadata(userId) || {};
    const updated = { ...current, ...updates, updatedAt: new Date().toISOString() };
    userMetadataStore.set(userId, updated);
    return updated;
  } catch (err) {
    console.error('[updateUserMetadata] Error:', err);
    throw err;
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.tier !== 'admin') {
    return res.status(403).json({ 
      error: 'Forbidden',
      message: 'Admin access required' 
    });
  }
  next();
}

export async function revokeDevice(userId, deviceId) {
  const devices = deviceStore.get(userId);
  if (!devices) return false;
  
  const removed = devices.delete(deviceId);
  if (removed) {
    deviceStore.set(userId, devices);
    console.log(`[Auth] Device revoked: user=${userId}, device=${deviceId}`);
  }
  return removed;
}

export async function revokeAllDevices(userId) {
  const devices = deviceStore.get(userId);
  if (!devices) return 0;
  
  const count = devices.size;
  devices.clear();
  deviceStore.set(userId, devices);
  console.log(`[Auth] All devices revoked for user=${userId}, count=${count}`);
  return count;
}

export function getUserDevices(userId) {
  const devices = deviceStore.get(userId);
  return devices ? Array.from(devices) : [];
}
