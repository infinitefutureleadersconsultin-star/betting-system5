// api/stripe/webhook.js
// Enhanced with monthly signal reset on renewal

import Stripe from 'stripe';
import { updateUserMetadata } from '../../lib/middleware/auth.js';
import { resetUsage } from '../../lib/middleware/usageTracker.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export const config = {
  api: {
    bodyParser: false,
  },
};

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];

  let event;

  try {
    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  console.log('[Stripe Webhook] Event received:', event.type);

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const userId = subscription.metadata?.userId;
        
        if (!userId) {
          console.warn('[Stripe Webhook] No userId in subscription metadata');
          break;
        }

        const priceId = subscription.items.data[0]?.price.id;
        let tier = 'basic';
        
        if (priceId === process.env.STRIPE_PRICE_BASIC) {
          tier = 'basic';
        } else if (priceId === process.env.STRIPE_PRICE_PRO) {
          tier = 'pro';
        }

        await updateUserMetadata(userId, {
          tier,
          stripeCustomerId: subscription.customer,
          stripeSubscriptionId: subscription.id,
          subscriptionStatus: subscription.status,
          currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
          currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString()
        });

        // Reset usage on new subscription or renewal
        if (event.type === 'customer.subscription.created') {
          await resetUsage(userId);
        }

        console.log(`[Stripe Webhook] Updated user ${userId} to tier: ${tier}`);
        break;
      }

      case 'invoice.paid': {
        // Reset signals on successful payment (monthly renewal)
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        
        if (subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const userId = subscription.metadata?.userId;
          
          if (userId) {
            await resetUsage(userId);
            console.log(`[Stripe Webhook] Reset signals for user ${userId} (monthly renewal)`);
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const userId = subscription.metadata?.userId;
        
        if (!userId) break;

        await updateUserMetadata(userId, {
          tier: null,
          subscriptionStatus: 'canceled',
          canceledAt: new Date().toISOString()
        });

        console.log(`[Stripe Webhook] Canceled subscription for user ${userId}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const userId = invoice.subscription_details?.metadata?.userId;
        
        if (!userId) break;

        console.warn(`[Stripe Webhook] Payment failed for user ${userId}`);
        break;
      }

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[Stripe Webhook] Handler error:', err);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
}
