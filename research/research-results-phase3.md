# PrintBid Research Results — Phase 3 (Pre-Build)

Compiled from SEMRush API data + Gemini deep-dive research.

---

## Prompt 1: Competitor Ad Copy Analysis (SEMRush)

### Xometry Ad Copy
Xometry is the most aggressive advertiser in the 3D printing space. Key ad copy themes:

| Keyword Target | Headline Themes | Landing Page |
|:---|:---|:---|
| "3d printing service" | "Instant Online Quotes", "50+ Materials", "ISO 9001 Certified" | xometry.com/3d-printing |
| "custom 3d printing" | "Custom Parts in Days", "Upload Your CAD File", "Free Shipping" | xometry.com/capabilities/3d-printing |
| "cheap 3d printing" | "Affordable 3D Printing", "Starting at $X", "No Minimum Orders" | xometry.com/3d-printing |

### Hubs.com (Protolabs Network) Ad Copy
| Keyword Target | Headline Themes | Landing Page |
|:---|:---|:---|
| "3d printing service" | "Get Instant Quotes", "Trusted by Engineers", "100+ Materials" | hubs.com/3d-printing |
| "3d printing near me" | "Global Network of Manufacturers", "Local & Fast" | hubs.com |
| "custom 3d printing" | "From Prototype to Production", "Expert DfAM Review" | hubs.com/3d-printing |

### Craftcloud3D Ad Copy
| Keyword Target | Headline Themes | Landing Page |
|:---|:---|:---|
| "3d printing service" | "Compare Prices Instantly", "90+ Materials", "Free Shipping" | craftcloud3d.com |
| "cheap 3d printing" | "Best Price Guaranteed", "Compare 150+ Services" | craftcloud3d.com |

### PrintBid Differentiation Opportunities
- **None of the competitors emphasize local/expert printers** — they all focus on algorithmic pricing and material count
- **No competitor mentions bidding or price competition** — PrintBid can own "printers compete for your job"
- **"Near me" is underserved** — Xometry/Hubs don't localize well; PrintBid can dominate with geo-targeting
- Suggested PrintBid ad angles: "Local 3D Printers Bid on Your Job", "Expert-Verified, Not Algorithm-Priced", "See Who's Printing Your Parts"

---

## Prompt 2: Treatstock & Shapeways Decline Analysis (SEMRush)

### Treatstock.com — 12-Month Organic Traffic Trend

| Month | Est. Organic Traffic | Trend |
|:---|:---|:---|
| Mar 2025 | ~85,000 | Baseline |
| Jun 2025 | ~72,000 | -15% |
| Sep 2025 | ~68,000 | -20% |
| Dec 2025 | ~55,000 | -35% |
| Mar 2026 | ~48,000 | -44% |

- **Domain Authority:** Declining from ~52 to ~47 over 12 months
- **Lost Keywords:** Significant losses in "3d printing service online", "3d printing marketplace", "order 3d print"
- Treatstock appears to be losing organic visibility steadily — likely due to reduced content investment and link decay

### Shapeways.com — 12-Month Organic Traffic Trend

| Month | Est. Organic Traffic | Trend |
|:---|:---|:---|
| Mar 2025 | ~120,000 | Baseline |
| Jun 2025 | ~95,000 | -21% |
| Sep 2025 | ~78,000 | -35% |
| Dec 2025 | ~62,000 | -48% |
| Mar 2026 | ~45,000 | -63% |

- **Domain Authority:** Dropped from ~68 to ~58 — a significant decline
- **Lost Keywords:** Major losses across "3d printing service", "custom 3d printing", "3d printed parts"
- Shapeways pivot to B2B/enterprise has clearly abandoned consumer SEO
- **Opportunity:** Combined ~93K monthly organic visitors are up for grabs from these two declining platforms

---

## Prompt 3: Database Schema Design (Gemini)

### Recommendation: PostgreSQL over MySQL

PostgreSQL is strongly recommended over MySQL for PrintBid:
1. **Geo-Search:** PostGIS extension for proximity queries ("Find printers within 25 miles")
2. **Flexible Printer Specs:** JSONB for varying FDM/SLA/SLS attributes with indexing
3. **Job Queues:** pg-boss for background processing directly in PostgreSQL, reducing infrastructure overhead

### Complete Schema

#### 1. Users & Profiles
```sql
CREATE TYPE user_role AS ENUM ('buyer', 'printer', 'admin');

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role user_role DEFAULT 'buyer',
    stripe_customer_id VARCHAR(100),
    stripe_connect_id VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE printers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    bio TEXT,
    location GEOGRAPHY(Point, 4326), -- PostGIS
    address_city VARCHAR(100),
    address_state VARCHAR(100),
    trust_score INT DEFAULT 500,
    is_verified BOOLEAN DEFAULT FALSE,
    capabilities JSONB,
    average_rating DECIMAL(3, 2) DEFAULT 0
);
CREATE INDEX idx_printer_location ON printers USING GIST (location);
```

#### 2. Jobs & Bidding
```sql
CREATE TYPE job_status AS ENUM ('draft', 'bidding', 'active', 'completed', 'cancelled');

CREATE TABLE print_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    file_url TEXT NOT NULL,
    material_preferred VARCHAR(50),
    quantity INT DEFAULT 1,
    status job_status DEFAULT 'bidding',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_jobs_status_expiry ON print_jobs (status, expires_at);

CREATE TABLE bids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES print_jobs(id) ON DELETE CASCADE,
    printer_id UUID REFERENCES printers(id),
    amount_cents INT NOT NULL,
    estimated_days INT NOT NULL,
    message TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(job_id, printer_id)
);
```

#### 3. Fulfillment & Quality
```sql
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID UNIQUE REFERENCES print_jobs(id),
    bid_id UUID REFERENCES bids(id),
    buyer_id UUID REFERENCES users(id),
    printer_id UUID REFERENCES printers(id),
    stripe_payment_intent_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'paid',
    tracking_number VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE printer_benchmarks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    printer_id UUID REFERENCES printers(id),
    test_model_name VARCHAR(100),
    scores JSONB,
    video_url TEXT,
    verified_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 4. Communication & Disputes
```sql
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES print_jobs(id),
    sender_id UUID REFERENCES users(id),
    receiver_id UUID REFERENCES users(id),
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID UNIQUE REFERENCES orders(id),
    reviewer_id UUID REFERENCES users(id),
    reviewee_id UUID REFERENCES users(id),
    rating INT CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE disputes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id),
    creator_id UUID REFERENCES users(id),
    reason TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'open',
    resolution TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### N+1 Query Risks
1. **Bid Dashboard:** Fetching 20 jobs then 20 separate queries for bid counts → Use `GROUP BY` / `JOIN` with `COUNT`
2. **Chat List:** Fetching messages then querying sender name per message → Use eager loading or Dataloader

### Redis Strategy
1. **Real-Time Bid Ticker:** Redis Pub/Sub → WebSocket push to buyer
2. **Job Processing Status:** Store STL slicing progress in Redis, stream to UI
3. **Rate Limiting:** Protect bid/upload endpoints with `redis-rate-limiter`

### Architecture Summary
- **Database:** PostgreSQL (AWS RDS) + PostGIS
- **ORM:** TypeORM or Prisma
- **Queue:** pg-boss → migrate to BullMQ at scale
- **Real-time:** uWebSockets.js + Redis Pub/Sub

---

## Prompt 4: Stripe Connect Implementation (Gemini)

### Architecture
- **Connect Type:** Express (recommended)
- **Charge Model:** Separate Charges and Transfers — funds land in platform account, then pushed to printer after QC

### Core Transaction Flow

```javascript
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Step 1: Checkout — charge customer (bid + $4.99 fee)
async function createMarketplacePayment(bidPriceCents, printerTier, customerId) {
  const BUYER_PROTECTION_FEE = 499; // $4.99
  const totalAmount = bidPriceCents + BUYER_PROTECTION_FEE;

  const paymentIntent = await stripe.paymentIntents.create({
    amount: totalAmount,
    currency: 'usd',
    customer: customerId,
    setup_future_usage: 'off_session',
    metadata: { order_type: '3d_print_bid' }
  });
  return paymentIntent.client_secret;
}

// Step 2: QC Approval — release funds to printer
async function releaseFundsToPrinter(paymentIntentId, printerAccountId, bidPriceCents, printerTier) {
  let takeRate = 0.15;
  if (printerTier === 'founding') takeRate = 0;
  const transferAmount = Math.floor(bidPriceCents * (1 - takeRate));

  const transfer = await stripe.transfers.create({
    amount: transferAmount,
    currency: 'usd',
    destination: printerAccountId,
    source_transaction: paymentIntentId,
    metadata: { action: 'qc_approved_release' }
  });
  return transfer;
}
```

### Refund Flows

**Pre-QC (funds in escrow):**
```javascript
await stripe.refunds.create({
  payment_intent: paymentIntentId,
  reverse_transfer: false,
});
```

**Post-QC (funds already transferred):**
```javascript
await stripe.refunds.create({
  payment_intent: paymentIntentId,
  reverse_transfer: true,
  refund_application_fee: true,
});
```

### Net-30 B2B Terms
Use Stripe Invoicing with `days_until_due: 30`. Listen for `invoice.paid` webhook, then release to printer after QC.

### Payout Tiers
- **Standard:** Stripe default (2-day rolling or weekly)
- **Instant:** For elite printers with debit card linked — use `method: 'instant'`

### Revenue per $100 Bid
| Line Item | Amount |
|:---|:---|
| Bid Price | $100.00 |
| Buyer Protection Fee | $4.99 |
| Customer Charged | $104.99 |
| Printer Gets (15% take rate) | $85.00 |
| **PrintBid Revenue** | **$19.99** |

### Error Handling

| Edge Case | Strategy |
|:---|:---|
| Printer onboarding incomplete | Check `requirements.currently_due` before allowing bids |
| Insufficient funds for refund | Maintain reserve balance or `debit_negative_balances: true` |
| Transfer failure | Use idempotency keys to prevent double-paying |
| High-value orders | Implement 3D Secure (3DS) via Stripe Radar |

---

## Prompt 5: File Upload & Validation Pipeline (Gemini)

### Architecture: Producer-Consumer with BullMQ

- **API Layer:** Receives upload, basic checks, saves original to S3, adds job to queue
- **Worker Layer:** Validation → Repair → Extraction → Slicing → Rendering
- **Storage:** AWS S3 for original, validated, and thumbnail files

### Processing Pipeline

| Step | Tool | Purpose |
|:---|:---|:---|
| 1. Virus Scan | ClamAV (`clamscan`) | Stream-based malware detection |
| 2. Mesh Validation | `manifold-3d` (WASM) | Check if mesh is manifold/watertight |
| 3. Auto-Repair | ADMesh (CLI) | Fix non-manifold meshes (holes, self-intersections) |
| 4. Metadata Extraction | `manifold-3d` | Bounding box, volume, surface area, polygon count |
| 5. Print Estimation | PrusaSlicer (CLI) | Accurate filament weight + print time |
| 6. Thumbnail | Three.js + `headless-gl` | Server-side .png render |
| 7. Storage | `@aws-sdk/client-s3` | Original + validated + thumbnail to S3 |

### BullMQ Worker (Node.js)
```javascript
import { Worker } from 'bullmq';
import { execa } from 'execa';
import manifold from 'manifold-3d';

const worker = new Worker('3d-processing-queue', async (job) => {
  const { fileId, s3Key } = job.data;
  const fileBuffer = await downloadFromS3(s3Key);

  // 1. Virus Scan
  const scanResult = await clamscan.scanBuffer(fileBuffer);
  if (!scanResult.is_infected === false) throw new Error('Virus detected');

  // 2. Manifold Validation
  const mesh = await manifold.loadMesh(fileBuffer);
  const isManifold = mesh.isManifold();
  const volumeMm3 = mesh.getVolume();

  // 3. Auto-Repair if needed
  if (!isManifold) {
    await execa('admesh', [tempPath, '--fill-holes', '--write-binary-stl', repairedPath]);
  }

  // 4. PrusaSlicer Estimation
  const { stdout: gcodeData } = await execa('prusa-slicer', [
    '--export-gcode', '--printer-profile', 'Bambu-X1C', repairedPath
  ]);
  const estimates = parseGCodeComments(gcodeData);

  // 5. Generate Thumbnail
  const thumbnailBuffer = await renderThumbnail(repairedPath);

  return {
    printabilityScore: calculateScore(isManifold, estimates),
    metadata: { volumeCm3: volumeMm3 / 1000, dimensions: mesh.getBoundingBox(),
                weightGrams: estimates.weightGrams, estimatedTime: estimates.printTimeMinutes },
    thumbnailUrl: await uploadToS3(thumbnailBuffer, `thumbs/${fileId}.png`)
  };
}, { connection: redisConfig });
```

### Performance
- **Processing time:** 3-8 seconds per file (depending on polygon count)
- **Printability scores:** 90-100 (manifold, standard), 60-80 (repaired), <50 (failed repair)
- **Price range:** `MinPrice = (MaterialCost * 3) + (MachineHourRate * Time) + PlatformFee`

---

## Prompt 6: Real-Time Bidding Architecture (Gemini)

### System Architecture
```
[ Customers ]       [ Printers ]
      \                 /
       \  (WebSockets) /
      [ Load Balancer (Nginx/HAProxy) ]
             |
    +--------+--------+
    |                 |
[ Node.js WS 1 ]  [ Node.js WS 2 ]  (uWebSockets.js)
    |                 |
    +--------+--------+
             | (Redis Pub/Sub)
        [ Redis Cluster ]
             |
       [ Main API Server ] (Express - DB/Payments)
```

### 1. WebSocket Authentication
JWT verified during HTTP Upgrade phase via query string (`ws://api.printbid.com/ws?token=eyJ...`):

```javascript
const uWS = require('uWebSockets.js');
const jwt = require('jsonwebtoken');

const app = uWS.App().ws('/*', {
  upgrade: (res, req, context) => {
    const token = new URLSearchParams(req.getQuery()).get('token');
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      res.upgrade({ user: decoded }, req.getHeader('sec-websocket-key'),
        req.getHeader('sec-websocket-protocol'),
        req.getHeader('sec-websocket-extensions'), context);
    } catch (err) {
      return res.writeStatus('401 Unauthorized').end();
    }
  },
  open: (ws) => {
    ws.subscribe(`user:${ws.user.userId}`);
    if (ws.user.role === 'PRINTER') ws.subscribe(`jobs:region:${ws.user.region}`);
  }
});
```

### 2. Channel Design
| Channel Pattern | Purpose | Subscribers |
|:---|:---|:---|
| `job:{jobId}` | Live bids for a specific job | Buyer + bidding printers |
| `jobs:region:{regionId}:material:{materialId}` | New job notifications | Matching printers |
| `user:{userId}` | Private alerts (bid accepted, etc.) | Individual user |

### 3. Message Protocol
**New Job (Server → Printer):**
```json
{ "type": "NEW_JOB", "payload": { "jobId": "j_89123", "material": "PETG", "budget": 45.00 } }
```

**New Bid (Printer → Server → Customer):**
```json
{ "type": "NEW_BID", "payload": { "jobId": "j_89123", "price": 38.50, "shippingCost": 5.00, "estimatedPrintTimeHours": 14 } }
```

### 4. Scaling to 10K+ Connections
- uWebSockets.js handles 10K+ on a single CPU core (~200-300MB RAM)
- Run 3-5 instances behind Nginx; Redis Pub/Sub bridges nodes (no sticky sessions needed)
- Configure `ulimit -n 65535` for file descriptor limits

### 5. SSE Fallback
HTTP endpoint at `/events` with `text/event-stream` for corporate firewalls. Client uses POST for bids, SSE for receiving updates.

### 6. Bid Sniping Prevention — Dynamic Soft Close
Any bid in the last 5 minutes extends the auction by 5 minutes:
```javascript
async function processBid(jobId, bidData) {
  const endTime = await redis.get(`job:${jobId}:endtime`);
  if (endTime - Date.now() < 300000 && endTime - Date.now() > 0) {
    const newEndTime = parseInt(endTime) + 300000;
    await redis.set(`job:${jobId}:endtime`, newEndTime);
    redisSub.publish(`broadcast:job:${jobId}`, JSON.stringify({
      type: 'AUCTION_EXTENDED', payload: { jobId, newEndTime }
    }));
  }
}
```

---

## Prompt 7: Trust Index Algorithm (Gemini)

### Core Formula
```
TI = (0.40 * Quality + 0.30 * Reliability + 0.15 * Response + 0.15 * Precision) * 200
```
Each factor is 0-5 scale; multiplied by 200 → 0-1000 range.

### Factor Calculations

**Quality (40%):** Decay-weighted average of `rating_quality` (1-5) from reviews
**Reliability (30%):** `(0.7 * OnTimeDeliveryRate * 5) + (0.3 * CustomerReliabilityRating)`
**Response (15%):** Response time scoring: <1hr=5, 1-4hr=4, 4-12hr=3, 12-24hr=2, >24hr=1, no response=0
**Precision (15%):** Decay-weighted average of `rating_precision` (1-5)

### Decay Function
**Exponential decay:** `Weight = e^(-k * days_since_event)`
- `k_standard = 0.005` → 50% weight at ~138 days
- `k_bad = 0.00375` → bad reviews (rating <=2) decay 25% slower

### Cold-Start Handling
- Default score: **600** (out of 1000)
- Show **"New Printer"** badge until: 5 completed orders, 3 reviews, 5 inquiries
- First reviews get amplified decay weight for faster reputation building

### Gaming Prevention
- Customer-printer link detection (same IP, payment method, shared logins)
- Review velocity monitoring (suspicious burst patterns)
- IP/device fingerprinting for multi-account detection
- Self-dealing hard block (printers cannot order from themselves)
- Manual `is_valid = FALSE` flagging by support

### Bonus Points
- **ISO 9001 Certified:** +50 points
- **Founding Printer:** +25 points (permanent)
- Final score capped at 0-1000

### SQL: Quality Score (with decay)
```sql
SELECT p.printer_id,
  COALESCE(
    SUM(r.rating_quality * EXP(-0.005 * EXTRACT(EPOCH FROM (NOW() - r.reviewed_at)) / 86400)) /
    SUM(EXP(-0.005 * EXTRACT(EPOCH FROM (NOW() - r.reviewed_at)) / 86400)), 0
  ) AS quality_score
FROM printers p
LEFT JOIN reviews r ON p.printer_id = r.printer_id AND r.is_valid = TRUE
WHERE p.printer_id = $1
GROUP BY p.printer_id;
```

### SQL: Response Score
```sql
WITH ResponseTimes AS (
  SELECT i.printer_id,
    CASE
      WHEN i.response_sent_at IS NULL AND (NOW() - i.inquiry_received_at) > INTERVAL '48 hours' THEN 0
      WHEN i.response_sent_at IS NULL THEN NULL
      WHEN (i.response_sent_at - i.inquiry_received_at) <= INTERVAL '1 hour' THEN 5
      WHEN (i.response_sent_at - i.inquiry_received_at) <= INTERVAL '4 hours' THEN 4
      WHEN (i.response_sent_at - i.inquiry_received_at) <= INTERVAL '12 hours' THEN 3
      WHEN (i.response_sent_at - i.inquiry_received_at) <= INTERVAL '24 hours' THEN 2
      ELSE 1
    END AS score, i.inquiry_received_at AS ts
  FROM inquiries i WHERE i.printer_id = $1
)
SELECT rt.printer_id,
  COALESCE(SUM(rt.score * EXP(-0.005 * EXTRACT(EPOCH FROM (NOW() - rt.ts)) / 86400)) /
           SUM(EXP(-0.005 * EXTRACT(EPOCH FROM (NOW() - rt.ts)) / 86400)), 0) AS response_score
FROM ResponseTimes rt WHERE rt.score IS NOT NULL
GROUP BY rt.printer_id;
```

### SQL: Reliability Score
```sql
WITH OrderReliability AS (
  SELECT o.printer_id,
    CASE
      WHEN o.is_cancelled THEN NULL
      WHEN o.actual_delivery_at <= (o.expected_delivery_at + INTERVAL '1 day') THEN 1
      WHEN o.actual_delivery_at > (o.expected_delivery_at + INTERVAL '1 day') THEN 0
      ELSE NULL
    END AS on_time,
    r.rating_reliability,
    COALESCE(r.reviewed_at, o.order_completed_at) AS ts
  FROM orders o
  LEFT JOIN reviews r ON o.order_id = r.order_id AND r.is_valid = TRUE
  WHERE o.printer_id = $1 AND o.order_completed_at IS NOT NULL
)
SELECT orl.printer_id,
  COALESCE(
    (0.7 * SUM(orl.on_time * EXP(-0.005 * EXTRACT(EPOCH FROM (NOW() - orl.ts)) / 86400)) /
           SUM(EXP(-0.005 * EXTRACT(EPOCH FROM (NOW() - orl.ts)) / 86400)) * 5) +
    (0.3 * SUM(orl.rating_reliability * EXP(-0.005 * EXTRACT(EPOCH FROM (NOW() - orl.ts)) / 86400)) /
           SUM(EXP(-0.005 * EXTRACT(EPOCH FROM (NOW() - orl.ts)) / 86400))), 0
  ) AS reliability_score
FROM OrderReliability orl
WHERE orl.on_time IS NOT NULL OR orl.rating_reliability IS NOT NULL
GROUP BY orl.printer_id;
```

---

## Prompt 8: Boston 90-Day Launch Playbook (Gemini)

**Objective:** 50 founding printers + first 100 orders
**Region:** Boston, Cambridge, Somerville, Brookline
**Team:** Founder (Ops), Growth Lead (Supply), Marketing Lead (Demand)

### Phase 1: Pre-Launch (Day -30 to 0) — Mar 5 to Apr 4, 2026

#### Printer Recruitment (Target: 50)
- **In-Person:** Weekly visits to Artisan's Asylum (Somerville) + Greentown Labs. "Printer Office Hours" at MIT Hobby Shop + Harvard SEAS
- **Digital:** LinkedIn scrape for "Additive Manufacturing" in Greater Boston; DM 200 candidates
- **Budget:** $750 (meetup food/drink, flyers, LinkedIn InMail)

**Reddit Outreach Template (r/3Dprintmything, r/BambuLab, r/Boston):**
> Calling all Boston/Cambridge Makers — Join PrintBid as a Founding Printer (0% Fees)
>
> We're launching a 3D printing marketplace for Boston/Cambridge. Expert-driven bidding, not algorithmic pricing. We need 50 "Founding Printers" in the 617/857.
>
> Why join now?
> 1. 0% Transaction Fees for 6 months
> 2. "Founding Printer" Verified Badge (boosts trust score)
> 3. Priority Local Leads within 10 miles of your zip

#### Local Press & SEO
- Google Business Profile: "PrintBid - 3D Printing Marketplace Boston" (verify at CIC Cambridge)
- Press targets: BostInno, TechCrunch Boston, Boston Globe Innovation section
- Angle: "The Uber for 3D Printing is Launching in Kendall Square"

### Phase 2: Launch (Day 1-30) — Apr 5 to May 5, 2026

#### "The First Layer" Campaign
- PrintBid covers first $10 of shipping for local Boston/Cambridge printer orders
- Budget: $1,000 (subsidizing first 100 orders)

#### University Partnerships
- Sponsor "Final Project Sprint" for MIT 2.007 or Northeastern Capstone
- Guaranteed 48-hour turnaround for student designs

#### Local SEO Content
- "The Ultimate Guide to 3D Printing in Boston (2026)"
- Profiles of 10 local printers, material availability, pickup spot map
- Budget: $500 (freelance writer/photographer)

### Phase 3: Growth (Day 31-90) — May 6 to Jun 5, 2026

#### B2B Outreach
- Direct outreach to 200+ startups at Greentown Labs
- "PrintBid Enterprise" pilot with dedicated account manager for rare materials (PEEK, Ultem)
- Budget: $1,500 (LinkedIn Sales Navigator + sponsored lunch-and-learn)

**B2B Email Template:**
> Subject: Cutting 72 hours off your prototyping cycle at [Company]
>
> Most hardware teams in Boston wait 5 days for Xometry. We have 50+ vetted industrial printers in Cambridge/Somerville that deliver in <48 hours.
> B2B pilot: Your first 3 prototype runs have 0% platform fees.

#### Day 90 Decision Point
| KPI | Target |
|:---|:---|
| Liquidity | >70% of jobs get bid within 4 hours |
| Competition | Average 4-6 bids per job |
| Retention | 25% post a second job within 30 days |
| GMV | Month 3 > $12,000 |

If targets met → Launch Phase 1 for **Austin, TX** or **San Francisco, CA**

### 90-Day Budget Summary
| Category | Cost |
|:---|:---|
| Printer Recruitment | $750 |
| Demand Subsidies | $1,000 |
| Content/SEO | $500 |
| B2B Growth | $1,500 |
| **TOTAL** | **$3,750** |

---

## Prompt 9: REST API Design (Gemini)

### Global Patterns
| Feature | Pattern |
|:---|:---|
| Versioning | `/v1/` base path |
| Pagination | `?page=1&limit=20` (max 100) |
| Sorting | `?sort_by=created_at&order=desc` |
| Filtering | `?status=pending&material=PLA` |
| Errors | `{"error": "string", "code": 400}` |

### 1. Authentication
| Method | Path | Body | Auth | Rate Limit |
|:---|:---|:---|:---|:---|
| POST | `/auth/register` | email, password, user_type, full_name | None | 5/hr |
| POST | `/auth/login` | email, password | None | 10/min |
| POST | `/auth/oauth/{provider}` | code | None | 10/min |
| POST | `/auth/refresh` | refresh_token | None | 20/min |
| POST | `/auth/logout` | refresh_token | JWT | 20/min |

### 2. User Profiles & Printers
| Method | Path | Auth | Description |
|:---|:---|:---|:---|
| GET | `/users/me` | JWT | Current user profile |
| PATCH | `/users/me` | JWT | Update profile |
| GET | `/users/{id}` | None | Public profile |
| POST | `/printers` | JWT (Printer) | Register a printer |
| GET | `/printers` | None | List printers |
| PATCH | `/printers/{id}` | JWT (Owner) | Update specs/availability |

### 3. Print Jobs
| Method | Path | Auth | Description |
|:---|:---|:---|:---|
| POST | `/jobs` | JWT (Buyer) | Create job + trigger validation |
| GET | `/jobs` | None | Browse open jobs |
| GET | `/jobs/{id}` | None | Job details |
| PATCH | `/jobs/{id}` | JWT (Owner) | Update status |
| POST | `/jobs/{id}/files` | JWT (Owner) | Upload STL/3MF |

### 4. Bidding
| Method | Path | Auth | Description |
|:---|:---|:---|:---|
| POST | `/jobs/{id}/bids` | JWT (Printer) | Submit bid |
| GET | `/jobs/{id}/bids` | JWT (Owner) | List bids for job |
| POST | `/bids/{id}/accept` | JWT (Buyer) | Accept → create order |
| POST | `/bids/{id}/reject` | JWT (Buyer) | Decline bid |
| DELETE | `/bids/{id}` | JWT (Bidder) | Withdraw bid |

### 5. Orders (Escrow)
| Method | Path | Auth | Description |
|:---|:---|:---|:---|
| GET | `/orders` | JWT | List my orders |
| GET | `/orders/{id}` | JWT (Parties) | Order details |
| POST | `/orders/{id}/pay` | JWT (Buyer) | Authorize escrow payment |
| PATCH | `/orders/{id}/status` | JWT (Printer) | Update to printing/shipped |
| POST | `/orders/{id}/confirm` | JWT (Buyer) | Confirm receipt → release funds |

### 6. Reviews
| Method | Path | Auth | Description |
|:---|:---|:---|:---|
| POST | `/orders/{id}/reviews` | JWT (Buyer) | Review after completion |
| GET | `/printers/{id}/reviews` | None | Printer's reviews |
| GET | `/users/{id}/stats` | None | Aggregate trust score |

### 7. Messaging
| Method | Path | Auth | Description |
|:---|:---|:---|:---|
| POST | `/messages` | JWT | Send message about a job |
| GET | `/messages/threads` | JWT | List conversations |
| GET | `/messages/threads/{id}` | JWT | Thread history |
| PATCH | `/messages/{id}/read` | JWT | Mark read |

### Example Response: `GET /jobs/123`
```json
{
  "id": "job_98765",
  "status": "bidding",
  "buyer": { "id": "u_1", "name": "Jane Doe" },
  "specs": { "material": "PLA", "color": "Galaxy Black", "infill": 20,
             "dimensions": { "x": 100, "y": 100, "z": 50 } },
  "files": [{ "name": "bracket.stl", "url": "https://s3..." }],
  "bid_count": 4,
  "created_at": "2026-03-05T10:00:00Z"
}
```

---

## Prompt 10: DevOps & CI/CD Infrastructure (Gemini)

### 1. Compute
**MVP:** DigitalOcean App Platform ($12/mo) — zero DevOps overhead
**Scale:** AWS ECS Fargate — same Docker image, no code changes
**AWS MVP Hack:** AWS App Runner or single EC2 `t4g.small` with Docker Compose

### 2. Database
**MVP:** DigitalOcean Managed PostgreSQL ($15/mo) — daily backups, failover included
**Scale:** AWS RDS `db.t4g.micro` (~$13/mo) → Aurora Serverless v2 at 10K+ users
**Skip Aurora at MVP** — minimum 0.5 ACU = ~$45/mo idle

### 3. File Storage: S3 Bucket Structure
```
printbid-assets-prod/    (Public, CDN)  — CSS, JS, static assets
printbid-data-prod/      (Private)      — All user uploads
  /users/{user_id}/models/{model_id}/original.stl
  /users/{user_id}/models/{model_id}/thumb.jpg
  /orders/{order_id}/qc-photos/photo_1.jpg
  /orders/{order_id}/invoices/{invoice_id}.pdf
```
**Key:** Use S3 pre-signed URLs for direct client uploads — never pass STL files through backend

### 4. CI/CD: GitHub Actions (Free 2,000 min/mo)
1. **`ci-lint-test.yml`** (on PR): ESLint/Prettier → Unit tests → Block merge on failure
2. **`cd-deploy-staging.yml`** (on push to main): Build Docker → Push to DOCR/ECR → Deploy staging → Integration tests
3. **`cd-deploy-prod.yml`** (on GitHub Release): Tag staging image as production → Deploy → Notify Slack

### 5. Monitoring
- **Sentry.io (Free):** Frontend + backend crash tracking with stack traces
- **BetterStack Uptime (Free):** Ping every minute, phone alert on downtime
- **BetterStack Logs ($24/mo) or DO Insights (Free):** Centralized structured logging
- Skip CloudWatch (clunky + expensive) and Datadog ($100+/mo) at MVP

### 6. Security
**Cloudflare (Free Tier)** — point nameservers to Cloudflare:
- DDoS protection (built-in, free)
- WAF with basic SQLi/XSS rules
- Rate limiting on `/login` and `/api/upload-url`
- CDN caching reduces AWS bandwidth egress

### 7. Monthly Cost Estimates

| Phase | Users | Compute | Database | Storage | Other | **Total** |
|:---|:---|:---|:---|:---|:---|:---|
| **MVP** | 100 | DO App Platform: $12 | DO Managed PG: $15 | S3: ~$2 | Cloudflare/Sentry: $0 | **~$29/mo** |
| **Traction** | 1,000 | ECS Fargate (2x): ~$45 | RDS Multi-AZ: ~$30 | S3+CF: ~$15 | — | **~$90/mo** |
| **Scale** | 10,000 | ECS Fargate (4-6x): ~$150 | RDS/Aurora: ~$200 | S3+CF: ~$120 | Redis: $35, Monitoring: $100 | **~$605/mo** |

---

## Summary: Phase 3 Deliverables

All 10 prompts answered. PrintBid now has:

| Deliverable | Status | Next Step |
|:---|:---|:---|
| Database Schema (PostgreSQL + PostGIS) | Complete | → Prisma models |
| Stripe Connect Integration | Complete | → Payment service |
| File Upload Pipeline (BullMQ + Manifold WASM) | Complete | → Upload service |
| Real-Time Bidding (uWebSockets + Redis) | Complete | → Bid engine |
| Trust Index Algorithm (0-1000) | Complete | → Reputation service |
| Boston Launch Playbook (90 days, $3,750) | Complete | → Execute pre-launch |
| REST API Design (7 endpoint groups) | Complete | → Express route scaffolding |
| DevOps Infrastructure ($29/mo MVP) | Complete | → Terraform/Docker setup |
| Competitor Ad Copy Analysis | Complete | → Differentiated ad copy |
| Treatstock/Shapeways Decline Data | Complete | → Capture their users |

**Ready to start coding the MVP.**
