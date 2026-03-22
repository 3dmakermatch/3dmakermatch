const BRAND_COLOR = '#7c3aed'; // purple/brand-600

function baseLayout(content: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>3dMakerMatch</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="background:${BRAND_COLOR};padding:24px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">3dMakerMatch</h1>
              <p style="margin:4px 0 0;color:#ede9fe;font-size:13px;">The 3D Printing Marketplace</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="background:#f3f4f6;padding:16px 32px;text-align:center;">
              <p style="margin:0;color:#6b7280;font-size:12px;">
                &copy; ${new Date().getFullYear()} 3dMakerMatch. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();
}

function button(text: string, href: string): string {
  return `<a href="${href}" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;font-size:14px;">${text}</a>`;
}

export function welcomeEmail(fullName: string): { subject: string; html: string } {
  const subject = 'Welcome to 3dMakerMatch!';
  const html = baseLayout(`
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;">Welcome, ${fullName}!</h2>
    <p style="color:#374151;line-height:1.6;">
      We're excited to have you join 3dMakerMatch — the fastest way to connect with
      expert 3D printer operators in your area.
    </p>
    <p style="color:#374151;line-height:1.6;">
      Whether you're here to get your designs printed or to offer your printing services,
      you're in the right place.
    </p>
    <p style="margin:24px 0;">
      ${button('Go to Dashboard', `${process.env.CLIENT_URL || 'http://localhost:5173'}/dashboard`)}
    </p>
    <p style="color:#6b7280;font-size:13px;">
      If you have any questions, just reply to this email — we're always happy to help.
    </p>
  `);
  return { subject, html };
}

export function newBidEmail(
  jobTitle: string,
  bidAmount: number,
  printerName: string,
): { subject: string; html: string } {
  const subject = `New bid on "${jobTitle}"`;
  const html = baseLayout(`
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;">You received a new bid!</h2>
    <p style="color:#374151;line-height:1.6;">
      <strong>${printerName}</strong> placed a bid of
      <strong style="color:${BRAND_COLOR};">$${bidAmount.toFixed(2)}</strong>
      on your job <strong>"${jobTitle}"</strong>.
    </p>
    <p style="color:#374151;line-height:1.6;">
      Log in to review the bid and compare it with other offers.
    </p>
    <p style="margin:24px 0;">
      ${button('View Bids', `${process.env.CLIENT_URL || 'http://localhost:5173'}/jobs`)}
    </p>
  `);
  return { subject, html };
}

export function bidAcceptedEmail(jobTitle: string): { subject: string; html: string } {
  const subject = `Your bid was accepted for "${jobTitle}"`;
  const html = baseLayout(`
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;">Congratulations! Your bid was accepted.</h2>
    <p style="color:#374151;line-height:1.6;">
      Great news — your bid for <strong>"${jobTitle}"</strong> has been accepted.
      The customer is ready to move forward with you.
    </p>
    <p style="color:#374151;line-height:1.6;">
      Log in to view order details and get started.
    </p>
    <p style="margin:24px 0;">
      ${button('View Order', `${process.env.CLIENT_URL || 'http://localhost:5173'}/orders`)}
    </p>
  `);
  return { subject, html };
}

export function bidRejectedEmail(jobTitle: string): { subject: string; html: string } {
  const subject = `Bid update for "${jobTitle}"`;
  const html = baseLayout(`
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;">Bid update for "${jobTitle}"</h2>
    <p style="color:#374151;line-height:1.6;">
      Thank you for bidding on <strong>"${jobTitle}"</strong>. Unfortunately,
      the customer has decided to go with another printer for this job.
    </p>
    <p style="color:#374151;line-height:1.6;">
      Don't be discouraged — there are plenty of new jobs posted every day.
    </p>
    <p style="margin:24px 0;">
      ${button('Browse Jobs', `${process.env.CLIENT_URL || 'http://localhost:5173'}/jobs`)}
    </p>
  `);
  return { subject, html };
}

export function orderStatusEmail(
  jobTitle: string,
  status: string,
  trackingNumber?: string,
): { subject: string; html: string } {
  const statusMessages: Record<string, { subject: string; body: string }> = {
    printing: {
      subject: `Your order is being printed — "${jobTitle}"`,
      body: 'Your printer has started working on your job. We\'ll notify you when it\'s on its way.',
    },
    shipped: {
      subject: `Your order has shipped — "${jobTitle}"`,
      body: trackingNumber
        ? `Your print is on its way! Tracking number: <strong>${trackingNumber}</strong>.`
        : 'Your print is on its way!',
    },
    delivered: {
      subject: `Your order has been delivered — "${jobTitle}"`,
      body: 'Your print has been delivered. We hope everything looks great! Please leave a review for your printer.',
    },
    cancelled: {
      subject: `Order cancelled — "${jobTitle}"`,
      body: 'Your order has been cancelled. If you have questions, please contact support.',
    },
  };

  const msg = statusMessages[status] || {
    subject: `Order update for "${jobTitle}"`,
    body: `Your order status has been updated to <strong>${status}</strong>.`,
  };

  const html = baseLayout(`
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;">${msg.subject}</h2>
    <p style="color:#374151;line-height:1.6;">${msg.body}</p>
    <p style="margin:24px 0;">
      ${button('View Order', `${process.env.CLIENT_URL || 'http://localhost:5173'}/orders`)}
    </p>
  `);
  return { subject: msg.subject, html };
}

export function newMessageEmail(
  jobTitle: string,
  senderName: string,
): { subject: string; html: string } {
  const subject = `New message about "${jobTitle}"`;
  const html = baseLayout(`
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;">You have a new message</h2>
    <p style="color:#374151;line-height:1.6;">
      <strong>${senderName}</strong> sent you a message regarding
      <strong>"${jobTitle}"</strong>.
    </p>
    <p style="color:#374151;line-height:1.6;">
      Log in to read and reply to the message.
    </p>
    <p style="margin:24px 0;">
      ${button('Read Message', `${process.env.CLIENT_URL || 'http://localhost:5173'}/jobs`)}
    </p>
  `);
  return { subject, html };
}

export function jobDigestEmail(
  printerName: string,
  jobs: Array<{ title: string; id: string; materials: string[] }>,
): { subject: string; html: string } {
  const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
  const jobList = jobs
    .map(
      j =>
        `<li><a href="${CLIENT_URL}/jobs/${j.id}">${j.title}</a> — ${j.materials.join(', ') || 'Any material'}</li>`,
    )
    .join('');
  return {
    subject: `${jobs.length} new print job${jobs.length > 1 ? 's' : ''} matching your skills`,
    html: baseLayout(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:22px;">Hi ${printerName},</h2>
      <p style="color:#374151;line-height:1.6;">Here are new print jobs that match your capabilities:</p>
      <ul style="color:#374151;line-height:1.8;">${jobList}</ul>
      <p style="margin:24px 0;">
        ${button('View All Jobs', `${CLIENT_URL}/jobs`)}
      </p>
    `),
  };
}

export function jobAlertEmail(
  printerName: string,
  jobTitle: string,
  jobId: string,
  matchScore: number,
  matchReasons: string[],
): { subject: string; html: string } {
  const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
  const reasonList = matchReasons.map((r) => `<li>${r}</li>`).join('');
  const subject = `New print job matching your capabilities: "${jobTitle}"`;
  const html = baseLayout(`
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;">Hi ${printerName}, a new job matches your capabilities!</h2>
    <p style="color:#374151;line-height:1.6;">
      A new print job has been posted that's a great fit for you:
      <strong>"${jobTitle}"</strong>
    </p>
    <p style="color:#374151;line-height:1.6;">
      <strong>Match score:</strong> ${matchScore}/100
    </p>
    ${reasonList ? `<ul style="color:#374151;line-height:1.8;">${reasonList}</ul>` : ''}
    <p style="margin:24px 0;">
      ${button('View Job', `${CLIENT_URL}/jobs/${jobId}`)}
    </p>
    <p style="color:#6b7280;font-size:13px;">
      Place your bid before this job expires to secure the work.
    </p>
  `);
  return { subject, html };
}

export function reviewReceivedEmail(
  jobTitle: string,
  rating: number,
): { subject: string; html: string } {
  const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
  const subject = 'You received a new review';
  const html = baseLayout(`
    <h2 style="margin:0 0 16px;color:#111827;font-size:22px;">You received a new review!</h2>
    <p style="color:#374151;line-height:1.6;">
      A customer left a <strong>${rating}-star</strong> review
      <span style="color:#f59e0b;font-size:18px;">${stars}</span>
      for your work on <strong>"${jobTitle}"</strong>.
    </p>
    <p style="color:#374151;line-height:1.6;">
      Reviews help build your reputation on 3dMakerMatch. Keep up the great work!
    </p>
    <p style="margin:24px 0;">
      ${button('View Profile', `${process.env.CLIENT_URL || 'http://localhost:5173'}/dashboard`)}
    </p>
  `);
  return { subject, html };
}
