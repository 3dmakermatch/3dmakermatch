import sgMail from '@sendgrid/mail';
import jwt from 'jsonwebtoken';

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@3dmakermatch.dev';
const IS_MOCK = !SENDGRID_API_KEY;

if (SENDGRID_API_KEY) sgMail.setApiKey(SENDGRID_API_KEY);

export interface EmailPreferences {
  bids?: boolean;
  orders?: boolean;
  messages?: boolean;
  reviews?: boolean;
  marketing?: boolean;
  jobAlerts?: string;
}

function shouldSend(prefs: EmailPreferences, category: string): boolean {
  if (!prefs || Object.keys(prefs).length === 0) return true;
  return (prefs as Record<string, unknown>)[category] !== false;
}

export function generateUnsubscribeToken(userId: string, category: string): string {
  return jwt.sign(
    { userId, category, type: 'unsubscribe' },
    process.env.JWT_SECRET || 'dev-secret',
    { expiresIn: '30d' },
  );
}

export function verifyUnsubscribeToken(token: string): { userId: string; category: string } | null {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret') as {
      userId: string;
      category: string;
      type: string;
    };
    if (payload.type !== 'unsubscribe') return null;
    return { userId: payload.userId, category: payload.category };
  } catch {
    return null;
  }
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  category: string;
  userId: string;
  userPrefs: EmailPreferences;
}): Promise<void> {
  const { to, subject, html, category, userId, userPrefs } = params;

  if (!shouldSend(userPrefs, category)) {
    if (IS_MOCK) console.log(`[MOCK EMAIL] SKIPPED (pref disabled) To: ${to} Subject: ${subject}`);
    return;
  }

  const unsubToken = generateUnsubscribeToken(userId, category);
  const unsubUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/unsubscribe?token=${unsubToken}&category=${category}`;

  if (IS_MOCK) {
    console.log(`[MOCK EMAIL] To: ${to} Subject: ${subject} Category: ${category}`);
    console.log(`[MOCK EMAIL] Unsubscribe: ${unsubUrl}`);
    return;
  }

  await sgMail.send({
    to,
    from: FROM_EMAIL,
    subject,
    html:
      html +
      `<hr><p style="font-size:12px;color:#999;">
      <a href="${unsubUrl}">Unsubscribe from ${category} notifications</a>
    </p>`,
    headers: {
      'List-Unsubscribe': `<${unsubUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
}
