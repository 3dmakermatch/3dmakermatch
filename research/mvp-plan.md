# 3dMakerMatch MVP Plan

## Context

3dMakerMatch (formerly PrintBid) is a hyper-local 3D printing marketplace connecting designers/buyers with expert printer operators through a competitive bidding model. Three phases of research have been completed covering market validation, competitive analysis, database schema, API design, payment flows, real-time architecture, and a Boston launch playbook. The project needs to go from research-only to a working MVP.

The repository currently has only an `init/` directory with research files. We need to:
1. Restructure into the standard repo format (research/, app/, marketing/, docker-compose.yml, dev-master.json)
2. Plan the MVP build with the right feature scope and build order

---

## Part 1: Repository Restructuring

### Target Structure
```
3dmakermatch/
├── research/                          # Research docs (from init/)
│   ├── research-results.md
│   ├── research-results-phase2.md
│   ├── research-results-phase3.md
│   ├── 3d-print-marketplace-report.html
│   └── claude-code-prompts.md
├── marketing/                         # Landing page
│   └── 3d-print-marketplace-landing.html
├── app/                               # Application source
│   ├── client/                        # React 19 + Vite + TypeScript + Tailwind
│   │   ├── src/
│   │   ├── public/
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   └── tailwind.config.ts
│   ├── server/                        # Fastify + TypeScript + Prisma
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   ├── middleware/
│   │   │   └── index.ts
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── shared/                        # Shared types/constants
│       └── types/
├── docker-compose.yml                 # Traefik-labeled services
├── Dockerfile                         # Multi-stage build
├── dev-master.json                    # Dashboard manifest
├── .gitignore
├── CLAUDE.md                          # Project-level instructions
└── init/                              # Keep as archive reference
    └── .claude/settings.local.json
```

### Key Decisions
- **Fastify over Express**: Better TypeScript support, schema-based validation, superior perf for eventual uWebSockets.js integration
- **Simple app/client + app/server structure**: No monorepo tooling (Nx/Turborepo) - too much overhead for small team
- **app/shared/types/**: Shared TypeScript interfaces between client and server (job, bid, user types)
- **Prisma ORM**: Type-safe database access, migration management, matches research recommendation
- **Landing page goes in marketing/**: Dashboard auto-detects and serves it at marketing.3dmakermatch.dev.christofferson.family

### dev-master.json
```json
{
  "name": "3dMakerMatch",
  "description": "Hyper-local 3D printing marketplace connecting designers with expert printer operators",
  "research": {
    "path": "./research",
    "enabled": true
  },
  "app": {
    "enabled": true,
    "compose_service": "app",
    "port": 3000,
    "health_check": "/api/health"
  },
  "marketing": {
    "enabled": true
  },
  "default_branch": "main",
  "build_command": "docker compose up -d --build"
}
```

### docker-compose.yml
Based on the fullstack template from dev-master-site, with:
- `app` service: Multi-stage build (Vite frontend + Fastify backend in one container)
- `db` service: postgis/postgis:16-3.4 (PostgreSQL + PostGIS for geo queries)
- `redis` service: redis:7-alpine (session cache, job queue, future real-time)
- All on `proxy-net` external network
- Traefik labels: `app.3dmakermatch.dev.christofferson.family`
- OAuth middleware applied via `oauth-auth`
- Memory limit: 1g for app

---

## Part 2: MVP Feature Scope

### Minimum Viable Loop (The Core Transaction)
The absolute minimum to prove the marketplace works:

**Buyer uploads file -> Printers bid -> Buyer accepts bid -> Payment captured -> Printer prints & ships -> Buyer confirms -> Funds released**

### MVP Features (Streamlined from Research's 23 dev-weeks)

| # | Feature | Scope | Notes |
|---|---------|-------|-------|
| 1 | Auth & User Profiles | JWT + Google OAuth, buyer/printer roles, printer profile with capabilities | Foundation - build first |
| 2 | STL/3MF Upload & Validation | S3 presigned upload, BullMQ worker, manifold-3d WASM validation, metadata extraction, thumbnail | Technical heart - unblocks bidding |
| 3 | Print Job Creation & Browsing | Create job from uploaded file, browse/filter open jobs, job detail page | Connects upload to bidding |
| 4 | Bidding System | Submit bids (price, est. days, message), view bids on your job, accept/reject | Core marketplace mechanic |
| 5 | Stripe Connect Payments | Printer onboarding, escrow charge on bid accept, fund release on buyer confirm | Enables real transactions |
| 6 | Order Lifecycle | Status tracking (paid -> printing -> shipped -> delivered -> confirmed), basic status updates | Completes the loop |
| 7 | Bid Messaging | Simple message thread per bid (not full chat) - enables DfAM advice | Key differentiator, lightweight |
| 8 | Reviews & Ratings | Post-order review (1-5 stars + comment), display on printer profile | Trust building for launch |

### What's Deferred to Phase 2
- Real-time bid notifications (WebSocket/uWebSockets.js)
- 3D file preview in browser (Three.js / react-three-fiber)
- Client-side STL repair & simplification — scan incoming files before upload, detect mesh errors (manifold-3d WASM) and high triangle counts (>1M). Prompt the user with what was found and ask permission before repairing or simplifying. If the user approves and the resulting file is under 50MB, substitute it for upload; otherwise show an error that the file is still too large even after optimization.
- Trust Index algorithm (use simple avg rating for now)
- Geographic search/filtering with map (use city-based filtering for now)
- Admin moderation tools
- Printer capability matching algorithm
- Anti-sniping soft close on bids

### What's Deferred to Phase 3
- Thingiverse/MyMiniFactory integration
- Auto-pricing suggestions (ML model)
- Shipping label generation
- Print time estimation via PrusaSlicer CLI
- "Instant Quote" widget for printers' own sites

---

## Part 3: Build Order (Sprints)

### Sprint 1: Foundation (Weeks 1-2)
**Goal: Scaffolding + Auth + Profiles**
- Initialize repo structure per Part 1
- Set up Docker Compose (app + db + redis)
- Prisma schema from research Phase 3 (users, printers, print_jobs, bids, orders, reviews, messages)
- Auth system: JWT (access 15min / refresh 7d in httpOnly cookie), Google OAuth
- User registration (buyer/printer), login, profile CRUD
- Printer profile: bio, location (city/state), capabilities (JSONB), machine list
- API routes: /auth/*, /users/*, /printers/*
- Basic React app shell with routing, auth context, protected routes

### Sprint 2: Upload & Jobs (Weeks 3-4)
**Goal: File upload pipeline + job creation**
- S3 presigned URL upload endpoint
- BullMQ processing queue with Redis
- Worker: virus scan (ClamAV), manifold-3d WASM validation, auto-repair (ADMesh), metadata extraction (dimensions, volume, polygon count)
- Thumbnail generation (server-side Three.js or @scalenc/stl-to-png)
- Print job CRUD: create from validated file, browse open jobs, job detail
- Job listing page with filters (material, status, location)
- API routes: /jobs/*, /jobs/{id}/files

### Sprint 3: Bidding & Messaging (Weeks 5-7)
**Goal: Core marketplace interaction**
- Bid submission (price, estimated days, shipping cost, message)
- Bid listing per job (sorted by price/rating)
- Accept/reject/withdraw bids
- Simple bid-thread messaging (text messages attached to a bid/job)
- Email notifications: new bid on your job, bid accepted, new message (SendGrid)
- API routes: /jobs/{id}/bids, /bids/{id}/*, /messages/*

### Sprint 4: Payments & Orders (Weeks 8-10)
**Goal: Complete the transaction loop**
- Stripe Connect Express onboarding for printers
- Payment flow: buyer accepts bid -> create PaymentIntent (escrow) -> charge
- Order lifecycle: paid -> printing -> shipped (tracking #) -> delivered -> buyer confirms -> release funds via Transfer
- Refund flows: pre-QC (full refund) and post-QC (reverse transfer)
- Buyer protection fee ($4.99) added at checkout
- Order dashboard: list orders, status timeline, action buttons
- API routes: /orders/*, /orders/{id}/pay, /orders/{id}/confirm

### Sprint 5: Trust & Polish (Weeks 11-12)
**Goal: Reviews + launch readiness**
- Review system: post-order review with rating + comment
- Display reviews on printer profiles, calculate average rating
- Basic search/filter improvements
- Email notifications for order status changes
- Error handling, loading states, empty states
- Landing page deployment (marketing/)
- Security review + Snyk scanning
- API routes: /orders/{id}/reviews, /printers/{id}/reviews

---

## Part 4: Tech Stack Summary

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS | Modern, fast dev, research-recommended |
| Backend | Fastify, TypeScript | Better TS support than Express, schema validation, faster |
| Database | PostgreSQL 16 + PostGIS | Geo queries for "near me", JSONB for printer capabilities |
| ORM | Prisma | Type-safe, great migrations, research-recommended |
| Cache/Queue | Redis 7 + BullMQ | Job processing queue, session cache |
| Payments | Stripe Connect (Express) | Escrow via Separate Charges and Transfers |
| File Storage | S3-compatible (presigned URLs) | Direct client upload, never through backend |
| Auth | JWT + passport-google-oauth20 | Research-recommended, refresh token rotation |
| Email | SendGrid | Transactional notifications |
| 3D Validation | manifold-3d (WASM) + ADMesh | Mesh validation + auto-repair |
| Container | Docker + Docker Compose | Matches dev dashboard infrastructure |
| Routing | Traefik (via proxy-net) | Auto-discovery, dashboard integration |

---

## Part 5: Database Schema

Use the PostgreSQL schema from research Phase 3 as the starting point for Prisma models:
- **users**: id, email, password_hash, full_name, role (buyer/printer/admin), stripe IDs
- **printers**: id, user_id, bio, location (PostGIS Point), address, trust_score, capabilities (JSONB), avg_rating
- **print_jobs**: id, user_id, title, description, file_url, material, quantity, status, expires_at
- **bids**: id, job_id, printer_id, amount_cents, estimated_days, shipping_cost_cents, message, status, UNIQUE(job_id, printer_id)
- **orders**: id, job_id, bid_id, buyer_id, printer_id, stripe_payment_intent_id, status, tracking_number
- **reviews**: id, order_id, reviewer_id, reviewee_id, rating (1-5), comment
- **messages**: id, job_id, sender_id, receiver_id, content, is_read
- **disputes**: id, order_id, creator_id, reason, status, resolution

PostGIS GIST index on printers.location for proximity queries.

---

## Part 6: API Design

Follow the REST API design from research Phase 3 (33 endpoints across 7 groups):
- `/v1/auth/*` - Registration, login, OAuth, refresh, logout
- `/v1/users/*` - Profile CRUD
- `/v1/printers/*` - Printer registration, listing, profile
- `/v1/jobs/*` - Job CRUD, file upload, browse
- `/v1/jobs/{id}/bids` + `/v1/bids/*` - Bidding
- `/v1/orders/*` - Order lifecycle, payment, confirmation
- `/v1/messages/*` - Bid/job messaging threads
- `/v1/orders/{id}/reviews` - Post-order reviews

Global patterns: pagination (?page=&limit=), sorting, filtering, standard error format.

---

## Part 7: Verification Plan

After each sprint, verify:

1. **Sprint 1**: Register user, create printer profile, login/logout, Google OAuth flow, view profiles
2. **Sprint 2**: Upload STL file, see it validated, view job listing, create a print job
3. **Sprint 3**: Submit bid on a job, view bids, accept a bid, send/receive messages
4. **Sprint 4**: Complete Stripe Connect onboarding, make a payment, track order through lifecycle, release funds
5. **Sprint 5**: Leave a review, see ratings on profiles, full end-to-end transaction test

**Security**: Run Snyk code scan after each sprint. Run full security scan before launch.

**Infrastructure**: Verify docker-compose up works, Traefik routing resolves, dashboard detects the repo.
