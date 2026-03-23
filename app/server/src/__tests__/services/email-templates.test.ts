import { describe, it, expect, beforeAll } from 'vitest';
import {
  welcomeEmail,
  newBidEmail,
  bidAcceptedEmail,
  bidRejectedEmail,
  orderStatusEmail,
  newMessageEmail,
  jobDigestEmail,
  jobAlertEmail,
  reviewReceivedEmail,
} from '../../services/email-templates.js';

// ── Helpers ────────────────────────────────────────────────────────────────────
function expectNonEmpty(result: { subject: string; html: string }) {
  expect(result.subject).toBeTruthy();
  expect(result.html).toBeTruthy();
  expect(result.html.length).toBeGreaterThan(0);
}

// ── welcomeEmail ───────────────────────────────────────────────────────────────
describe('welcomeEmail()', () => {
  it('returns non-empty subject and html', () => {
    expectNonEmpty(welcomeEmail('Alice'));
  });

  it('includes the user name in html', () => {
    const { html } = welcomeEmail('Bob Smith');
    expect(html).toContain('Bob Smith');
  });

  it('includes dashboard link', () => {
    const { html } = welcomeEmail('Carol');
    expect(html).toContain('/dashboard');
  });

  it('subject contains "Welcome"', () => {
    const { subject } = welcomeEmail('Dave');
    expect(subject.toLowerCase()).toContain('welcome');
  });

  it('html is valid HTML structure with DOCTYPE', () => {
    const { html } = welcomeEmail('Eve');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });
});

// ── newBidEmail ────────────────────────────────────────────────────────────────
describe('newBidEmail()', () => {
  it('returns non-empty subject and html', () => {
    expectNonEmpty(newBidEmail('My Print Job', 49.99, 'PrinterPro'));
  });

  it('subject contains job title', () => {
    const { subject } = newBidEmail('Cool Widget', 25, 'MakerBot');
    expect(subject).toContain('Cool Widget');
  });

  it('html contains printer name', () => {
    const { html } = newBidEmail('Widget', 10, 'FastPrint');
    expect(html).toContain('FastPrint');
  });

  it('html contains bid amount formatted to 2 decimal places', () => {
    const { html } = newBidEmail('Widget', 123.5, 'Printer');
    expect(html).toContain('123.50');
  });

  it('html contains job title', () => {
    const { html } = newBidEmail('My Special Print', 50, 'Maker');
    expect(html).toContain('My Special Print');
  });
});

// ── bidAcceptedEmail ───────────────────────────────────────────────────────────
describe('bidAcceptedEmail()', () => {
  it('returns non-empty subject and html', () => {
    expectNonEmpty(bidAcceptedEmail('Print Job Alpha'));
  });

  it('subject contains job title', () => {
    const { subject } = bidAcceptedEmail('My Job');
    expect(subject).toContain('My Job');
  });

  it('html contains job title', () => {
    const { html } = bidAcceptedEmail('My Job');
    expect(html).toContain('My Job');
  });

  it('html contains link to /orders', () => {
    const { html } = bidAcceptedEmail('J');
    expect(html).toContain('/orders');
  });
});

// ── bidRejectedEmail ───────────────────────────────────────────────────────────
describe('bidRejectedEmail()', () => {
  it('returns non-empty subject and html', () => {
    expectNonEmpty(bidRejectedEmail('Rejected Job'));
  });

  it('subject contains job title', () => {
    const { subject } = bidRejectedEmail('Some Job');
    expect(subject).toContain('Some Job');
  });

  it('html contains job title', () => {
    const { html } = bidRejectedEmail('Some Job');
    expect(html).toContain('Some Job');
  });

  it('html contains Browse Jobs link', () => {
    const { html } = bidRejectedEmail('J');
    expect(html).toContain('/jobs');
  });
});

// ── orderStatusEmail ───────────────────────────────────────────────────────────
describe('orderStatusEmail()', () => {
  const knownStatuses = ['printing', 'shipped', 'delivered', 'cancelled'];

  for (const status of knownStatuses) {
    it(`returns non-empty result for status="${status}"`, () => {
      expectNonEmpty(orderStatusEmail('My Print', status));
    });

    it(`subject is non-empty for status="${status}"`, () => {
      const { subject } = orderStatusEmail('My Print', status);
      expect(subject).toBeTruthy();
      expect(subject.length).toBeGreaterThan(0);
    });
  }

  it('includes tracking number in html when status=shipped and tracking provided', () => {
    const { html } = orderStatusEmail('Widget', 'shipped', 'TRACK123');
    expect(html).toContain('TRACK123');
  });

  it('does not include tracking number text when not provided', () => {
    const { html } = orderStatusEmail('Widget', 'shipped');
    expect(html).not.toContain('Tracking number:');
  });

  it('handles unknown status with fallback message', () => {
    const { subject, html } = orderStatusEmail('Widget', 'pending_review');
    expect(subject).toBeTruthy();
    expect(html).toContain('pending_review');
  });

  it('html contains job title', () => {
    const { html } = orderStatusEmail('Fancy Widget', 'printing');
    expect(html).toContain('Fancy Widget');
  });
});

// ── newMessageEmail ────────────────────────────────────────────────────────────
describe('newMessageEmail()', () => {
  it('returns non-empty subject and html', () => {
    expectNonEmpty(newMessageEmail('My Job', 'Alice'));
  });

  it('subject contains job title', () => {
    const { subject } = newMessageEmail('Widget Print', 'Bob');
    expect(subject).toContain('Widget Print');
  });

  it('html contains sender name', () => {
    const { html } = newMessageEmail('Job X', 'Charlie');
    expect(html).toContain('Charlie');
  });

  it('html contains job title', () => {
    const { html } = newMessageEmail('Special Job', 'Dave');
    expect(html).toContain('Special Job');
  });
});

// ── jobDigestEmail ─────────────────────────────────────────────────────────────
describe('jobDigestEmail()', () => {
  const sampleJobs = [
    { title: 'Widget A', id: 'job-1', materials: ['PLA', 'ABS'] },
    { title: 'Widget B', id: 'job-2', materials: ['PETG'] },
  ];

  it('returns non-empty subject and html', () => {
    expectNonEmpty(jobDigestEmail('Alice Printer', sampleJobs));
  });

  it('subject includes job count', () => {
    const { subject } = jobDigestEmail('Alice', sampleJobs);
    expect(subject).toContain('2');
  });

  it('uses plural "jobs" when multiple', () => {
    const { subject } = jobDigestEmail('Alice', sampleJobs);
    expect(subject).toContain('jobs');
  });

  it('uses singular "job" when one job', () => {
    const { subject } = jobDigestEmail('Alice', [sampleJobs[0]]);
    expect(subject).toContain('job');
    // Should not contain "2" or plural "jobs" in a plural sense
    expect(subject).toMatch(/1 new print job\b/);
  });

  it('html contains printer name', () => {
    const { html } = jobDigestEmail('FastPrint Pro', sampleJobs);
    expect(html).toContain('FastPrint Pro');
  });

  it('html contains all job titles', () => {
    const { html } = jobDigestEmail('Alice', sampleJobs);
    expect(html).toContain('Widget A');
    expect(html).toContain('Widget B');
  });

  it('html contains job links', () => {
    const { html } = jobDigestEmail('Alice', sampleJobs);
    expect(html).toContain('/jobs/job-1');
    expect(html).toContain('/jobs/job-2');
  });

  it('html shows "Any material" for jobs with no required materials', () => {
    const jobs = [{ title: 'No Material Job', id: 'job-3', materials: [] }];
    const { html } = jobDigestEmail('Alice', jobs);
    expect(html).toContain('Any material');
  });

  it('html shows materials for jobs that have them', () => {
    const { html } = jobDigestEmail('Alice', sampleJobs);
    expect(html).toContain('PLA');
    expect(html).toContain('ABS');
  });
});

// ── jobAlertEmail ──────────────────────────────────────────────────────────────
describe('jobAlertEmail()', () => {
  it('returns non-empty subject and html', () => {
    expectNonEmpty(jobAlertEmail('Dave', 'Robot Arm', 'job-99', 85, ['Supports PLA']));
  });

  it('subject contains job title', () => {
    const { subject } = jobAlertEmail('Dave', 'Rocket Part', 'job-1', 90, []);
    expect(subject).toContain('Rocket Part');
  });

  it('html contains printer name', () => {
    const { html } = jobAlertEmail('MakerJane', 'Part X', 'job-1', 80, []);
    expect(html).toContain('MakerJane');
  });

  it('html contains job title', () => {
    const { html } = jobAlertEmail('Alice', 'Special Widget', 'job-1', 75, []);
    expect(html).toContain('Special Widget');
  });

  it('html contains match score', () => {
    const { html } = jobAlertEmail('Alice', 'Widget', 'job-1', 92, []);
    expect(html).toContain('92');
  });

  it('html contains match reasons', () => {
    const reasons = ['Supports PLA', 'High trust score'];
    const { html } = jobAlertEmail('Alice', 'Widget', 'job-1', 85, reasons);
    expect(html).toContain('Supports PLA');
    expect(html).toContain('High trust score');
  });

  it('html contains job link', () => {
    const { html } = jobAlertEmail('Alice', 'Widget', 'job-42', 80, []);
    expect(html).toContain('/jobs/job-42');
  });

  it('handles empty match reasons list', () => {
    const { html } = jobAlertEmail('Alice', 'Widget', 'job-1', 70, []);
    expect(html).toBeTruthy();
  });
});

// ── reviewReceivedEmail ────────────────────────────────────────────────────────
describe('reviewReceivedEmail()', () => {
  it('returns non-empty subject and html', () => {
    expectNonEmpty(reviewReceivedEmail('My Job', 5));
  });

  it('subject says "new review"', () => {
    const { subject } = reviewReceivedEmail('My Job', 4);
    expect(subject.toLowerCase()).toContain('review');
  });

  it('html contains the job title', () => {
    const { html } = reviewReceivedEmail('Fancy Print', 3);
    expect(html).toContain('Fancy Print');
  });

  it('html contains the numeric rating', () => {
    const { html } = reviewReceivedEmail('Job X', 4);
    expect(html).toContain('4');
  });

  it('html contains star characters for a 5-star review', () => {
    const { html } = reviewReceivedEmail('Job X', 5);
    // 5 filled stars, 0 empty
    expect(html).toContain('★★★★★');
  });

  it('html contains star characters for a 1-star review', () => {
    const { html } = reviewReceivedEmail('Job X', 1);
    expect(html).toContain('★');
    expect(html).toContain('☆☆☆☆');
  });

  it('html contains mixed stars for a 3-star review', () => {
    const { html } = reviewReceivedEmail('Job X', 3);
    expect(html).toContain('★★★');
    expect(html).toContain('☆☆');
  });

  it('html contains dashboard link', () => {
    const { html } = reviewReceivedEmail('Job X', 5);
    expect(html).toContain('/dashboard');
  });
});
