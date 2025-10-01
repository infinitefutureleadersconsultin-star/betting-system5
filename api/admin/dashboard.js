// api/admin/dashboard.js
// Admin dashboard for user management

import { authMiddleware, requireAdmin, updateUserMetadata, revokeDevice, revokeAllDevices, getUserDevices } from '../../lib/middleware/auth.js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const userActivityLog = new Map();

function logActivity(userId, action, details = {}) {
  const log = userActivityLog.get(userId) || [];
  log.push({
    timestamp: new Date().toISOString(),
    action,
    ...details
  });
  userActivityLog.set(userId, log.slice(-100));
}

export default async function handler(req, res) {
  await new Promise((resolve, reject) => {
    authMiddleware(req, res, (err) => err ? reject(err) : resolve());
  });

  await new Promise((resolve, reject) => {
    requireAdmin(req, res, (err) => err ? reject(err) : resolve());
  });

  const { method } = req;
  const { action } = req.query;

  try {
    switch (method) {
      case 'GET':
        if (action === 'users') return await handleGetUsers(req, res);
        if (action === 'activity') return await handleGetActivity(req, res);
        if (action === 'stats') return await handleGetStats(req, res);
        if (action === 'devices') return await handleGetDevices(req, res);
        return res.status(400).json({ error: 'Invalid action' });

      case 'POST':
        if (action === 'suspend') return await handleSuspendUser(req, res);
        if (action === 'unsuspend') return await handleUnsuspendUser(req, res);
        if (action === 'refund') return await handleRefund(req, res);
        if (action === 'update-tier') return await handleUpdateTier(req, res);
        if (action === 'revoke-device') return await handleRevokeDevice(req, res);
        if (action === 'revoke-all-devices') return await handleRevokeAllDevices(req, res);
        return res.status(400).json({ error: 'Invalid action' });

      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('[Admin Dashboard] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function handleGetUsers(req, res) {
  return res.status(200).json({ 
    users: [],
    total: 0,
    message: 'User list endpoint ready - integrate with your user database'
  });
}

async function handleGetActivity(req, res) {
  const { userId } = req.query;
  
  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }
  
  const activity = userActivityLog.get(userId) || [];
  
  return res.status(200).json({ 
    userId,
    activity,
    count: activity.length
  });
}

async function handleGetStats(req, res) {
  return res.status(200).json({
    totalUsers: 0,
    activeSubscriptions: 0,
    monthlyRevenue: 0,
    apiCallsToday: 0,
    cacheHitRate: 0,
    message: 'Stats endpoint ready - integrate with your metrics'
  });
}

async function handleGetDevices(req, res) {
  const { userId } = req.query;
  
  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }
  
  const devices = getUserDevices(userId);
  
  return res.status(200).json({ 
    userId,
    devices,
    count: devices.length,
    limit: 1
  });
}

async function handleSuspendUser(req, res) {
  const { userId, reason } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }
  
  await updateUserMetadata(userId, {
    suspended: true,
    suspendedAt: new Date().toISOString(),
    suspensionReason: reason || 'Admin action',
    suspendedBy: req.user.id
  });
  
  logActivity(userId, 'SUSPENDED', { reason, by: req.user.id });
  
  return res.status(200).json({ 
    success: true,
    message: `User ${userId} suspended`,
    userId
  });
}

async function handleUnsuspendUser(req, res) {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }
  
  await updateUserMetadata(userId, {
    suspended: false,
    unsuspendedAt: new Date().toISOString(),
    suspensionReason: null,
    unsuspendedBy: req.user.id
  });
  
  logActivity(userId, 'UNSUSPENDED', { by: req.user.id });
  
  return res.status(200).json({ 
    success: true,
    message: `User ${userId} unsuspended`,
    userId
  });
}

async function handleRefund(req, res) {
  const { userId, subscriptionId, reason } = req.body;
  
  if (!userId || !subscriptionId) {
    return res.status(400).json({ error: 'userId and subscriptionId required' });
  }
  
  try {
    const invoices = await stripe.invoices.list({
      subscription: subscriptionId,
      limit: 1
    });
    
    if (!invoices.data.length) {
      return res.status(404).json({ error: 'No invoice found' });
    }
    
    const invoice = invoices.data[0];
    
    if (!invoice.charge) {
      return res.status(400).json({ error: 'No charge to refund' });
    }
    
    const refund = await stripe.refunds.create({
      charge: invoice.charge,
      reason: 'requested_by_customer',
      metadata: {
        userId,
        reason: reason || 'Admin refund',
        processedBy: req.user.id
      }
    });
    
    logActivity(userId, 'REFUNDED', { 
      amount: refund.amount / 100,
      reason,
      refundId: refund.id,
      by: req.user.id 
    });
    
    return res.status(200).json({ 
      success: true,
      message: 'Refund processed',
      refund: {
        id: refund.id,
        amount: refund.amount / 100,
        status: refund.status
      }
    });
    
  } catch (err) {
    console.error('[Admin] Refund error:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function handleUpdateTier(req, res) {
  const { userId, tier } = req.body;
  
  if (!userId || !tier) {
    return res.status(400).json({ error: 'userId and tier required' });
  }
  
  if (!['basic', 'pro', 'admin'].includes(tier)) {
    return res.status(400).json({ error: 'Invalid tier' });
  }
  
  await updateUserMetadata(userId, {
    tier,
    tierUpdatedAt: new Date().toISOString(),
    tierUpdatedBy: req.user.id
  });
  
  logActivity(userId, 'TIER_UPDATED', { 
    newTier: tier,
    by: req.user.id 
  });
  
  return res.status(200).json({ 
    success: true,
    message: `User ${userId} updated to ${tier} tier`,
    userId,
    tier
  });
}

async function handleRevokeDevice(req, res) {
  const { userId, deviceId } = req.body;
  
  if (!userId || !deviceId) {
    return res.status(400).json({ error: 'userId and deviceId required' });
  }
  
  const revoked = await revokeDevice(userId, deviceId);
  
  if (!revoked) {
    return res.status(404).json({ error: 'Device not found' });
  }
  
  logActivity(userId, 'DEVICE_REVOKED', { 
    deviceId,
    by: req.user.id 
  });
  
  return res.status(200).json({ 
    success: true,
    message: 'Device revoked',
    userId,
    deviceId
  });
}

async function handleRevokeAllDevices(req, res) {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }
  
  const count = await revokeAllDevices(userId);
  
  logActivity(userId, 'ALL_DEVICES_REVOKED', { 
    count,
    by: req.user.id 
  });
  
  return res.status(200).json({ 
    success: true,
    message: `All devices revoked for user ${userId}`,
    userId,
    count
  });
}
