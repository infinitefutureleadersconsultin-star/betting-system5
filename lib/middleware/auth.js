// lib/middleware/auth.js
// Authentication with 1 device limit + billing access for canceled users

import { verifyToken, clerkClient } from '@clerk/clerk-sdk-node';
import crypto from 'crypto';

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const DEVICE_LIMIT = 1;

const deviceStore = new Map();

function generateDeviceId(req) {
  const ua = req.headers['user-agent'] || 'unknown';
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
  
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
    return {
      allowed: false,
      isNew: true,
      limit: DEVICE_LIMIT,
      current: devices.size,
      message: `Device limit reached. You can only use one device at a time. Log out from your other device first.`
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
    const isCanceled = userMeta?.subscriptionStatus === 'canceled';
    const deviceId = generateDeviceId(req);
    
    // Allow access to account/billing routes even if canceled
    const accountRoutes = ['/api/account', '/api/billing', '/api/subscription', '/api/stripe'];
    const isAccountRoute = accountRoutes.some(route => req.url?.startsWith(route));
    
    if (isAccountRoute) {
      req.user = {
        id: userId,
        email: payload.email,
        tier: tier || null,
        deviceId,
        stripeCustomerId: userMeta?.stripeCustomerId,
        suspended: false,
        canceled: isCanceled
      };
      return next();
    }
    
    // Block prop evaluation if no active subscription
    if (!tier || !['basic', 'pro', 'admin'].includes(tier) || isCanceled) {
      return res.status(402).json({
        error: 'Subscription required',
        message: 'Active subscription required to evaluate props. Manage subscription at /billing',
        subscribeUrl: '/pricing',
        billingUrl: '/billing'
      });
    }
    
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
        helpText: 'Log out from your other device or contact support.'
      });
    }
    
    req.user = {
      id: userId,
      email: payload.email,
      tier,
      deviceId,
      isNewDevice: deviceCheck.isNew,
      stripeCustomerId: userMeta?.stripeCustomerId,
      suspended: false,
      canceled: false
    };
    
    if (deviceCheck.isNew) {
      console.log(`[Auth] New device: user=${userId}, device=${deviceId}, tier=${tier}`);
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
  try {
    const user = await clerkClient.users.getUser(userId);
    return user.publicMetadata || {};
  } catch (err) {
    console.error('[getUserMetadata] Error:', err);
    return {};
  }
}

export async function updateUserMetadata(userId, updates) {
  try {
    await clerkClient.users.updateUserMetadata(userId, {
      publicMetadata: updates
    });
    return updates;
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
  console.log(`[Auth] All devices revoked: user=${userId}, count=${count}`);
  return count;
}

export function getUserDevices(userId) {
  const devices = deviceStore.get(userId);
  return devices ? Array.from(devices) : [];
}
