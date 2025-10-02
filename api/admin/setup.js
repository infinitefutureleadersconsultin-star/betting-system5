// api/admin/setup.js
// ONE-TIME USE: Make yourself admin
// ⚠️ DELETE THIS FILE AFTER USING IT ONCE ⚠️

import { updateUserMetadata } from '../../lib/middleware/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, secret } = req.body;
  
  // CHANGE THIS TO YOUR OWN SECRET
  if (secret !== 'CHANGE_THIS_SECRET_NOW_12345') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }
  
  await updateUserMetadata(userId, {
    tier: 'admin',
    setupAt: new Date().toISOString()
  });
  
  return res.status(200).json({ 
    success: true,
    message: '✅ You are now admin. DELETE THIS FILE FROM GITHUB NOW.'
  });
}
