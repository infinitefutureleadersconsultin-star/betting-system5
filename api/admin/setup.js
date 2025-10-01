// api/admin/setup.js
// ONE-TIME USE: Make yourself admin
// DELETE THIS FILE AFTER USING IT

import { updateUserMetadata } from '../../lib/middleware/auth.js';

export default async function handler(req, res) {
  const { userId, secret } = req.body;
  
  // Change this to a secret only you know
  if (secret !== 'YOUR_SECRET_PASSWORD_HERE') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  await updateUserMetadata(userId, {
    tier: 'admin',
    setupAt: new Date().toISOString()
  });
  
  return res.status(200).json({ 
    success: true,
    message: 'You are now admin. DELETE THIS FILE NOW.'
  });
}
