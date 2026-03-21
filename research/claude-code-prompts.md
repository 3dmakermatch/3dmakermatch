# PrintBid — Ready to Build

All 3 phases of research are COMPLETE. This file summarizes what's been done and what's next.

---

## Research Completed

### Phase 1: Market Validation
- Core keyword research (34,050/mo addressable volume)
- Competitor domain analysis (8 competitors profiled)
- Content gap analysis
- Advertising landscape ($3-5 avg CPC)
- Long-tail keyword opportunities
- Deep competitive analysis (Gemini)
- Business model validation (10-15% take rate)
- Technical feasibility assessment
- Legal & compliance framework
- Go-to-market strategy

### Phase 2: Deep Dives
- Backlink gap analysis (link-building targets identified)
- SERP feature analysis (content format recommendations per keyword)
- Seasonal trends (September peak, August launch window)
- Boston local keyword research (4,730/mo, all KD < 27)
- Content pillar planning (5 pillars, ~120K/mo total potential)
- Pricing algorithm design (7-step formula with cold-start solution)
- Quality assurance framework (Trust Index 0-1000, torture test, dispute resolution)
- MVP feature prioritization via RICE (7 features, 23 dev-weeks for Phase 1)
- Competitive moat analysis (5 moats rated)
- Financial model (24-month projections, $6.8M cumulative GMV)

### Phase 3: Pre-Build Specs
- Competitor ad copy analysis (differentiation angles identified)
- Treatstock/Shapeways decline confirmed (~93K monthly visitors up for grabs)
- PostgreSQL database schema (complete SQL with PostGIS)
- Stripe Connect implementation (code + flows + error handling)
- File upload & validation pipeline (BullMQ + Manifold WASM + PrusaSlicer)
- Real-time bidding architecture (uWebSockets + Redis Pub/Sub + anti-sniping)
- Trust Index algorithm (SQL queries + decay functions + gaming prevention)
- Boston 90-day launch playbook ($3,750 budget)
- REST API design (33 endpoints across 7 groups)
- DevOps infrastructure ($29/mo MVP → $605/mo at scale)

---

## Deliverables Created

| File | Description |
|------|-------------|
| `3d-print-marketplace-report.html` | Master research report with all 3 phases |
| `3d-print-marketplace-landing.html` | Marketing landing page prototype |
| `research-results.md` | Phase 1 raw research data |
| `research-results-phase2.md` | Phase 2 raw research data |
| `research-results-phase3.md` | Phase 3 raw research data |

---

## Next Steps: Build the MVP

### Sprint 1 (Weeks 1-2): Foundation
- [ ] Initialize repo (React + Node.js/Express + TypeScript)
- [ ] Set up PostgreSQL + Prisma ORM (use schema from Phase 3)
- [ ] User auth (JWT + OAuth with Google)
- [ ] Basic printer profile CRUD
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Deploy to DigitalOcean App Platform

### Sprint 2 (Weeks 3-4): Core Upload & Bidding
- [ ] File upload service (S3 + BullMQ + Manifold validation)
- [ ] Print job creation flow
- [ ] Basic bidding system (REST, not real-time yet)
- [ ] Job listing and search

### Sprint 3 (Weeks 5-7): Payments & Messaging
- [ ] Stripe Connect onboarding for printers
- [ ] Escrow payment flow (charge → hold → release after QC)
- [ ] Buyer-printer messaging
- [ ] Order tracking dashboard

### Sprint 4 (Weeks 8-9): Trust & Polish
- [ ] Review/rating system
- [ ] Trust Index v1 (basic scoring without decay)
- [ ] QC photo upload flow
- [ ] Email notifications (SendGrid)

### Sprint 5 (Weeks 10-11): Launch Prep
- [ ] Landing page deployment
- [ ] Google Business Profile (Boston)
- [ ] Founding Printer recruitment (r/3Dprintmything, Artisan's Asylum)
- [ ] "The First Layer" campaign setup
- [ ] Load testing and security review

### Target: Launch Boston MVP by mid-June 2026

---

## Claude Code Commands for Build Phase

When you're ready to start building, here are prompts to use in Claude Code:

### Initialize the Project
```
Create a new PrintBid project with: React 19 frontend (Vite + TypeScript + Tailwind), Node.js backend (Express + TypeScript), Prisma ORM with PostgreSQL. Set up the monorepo structure with /client and /server directories. Initialize the database schema using the PostgreSQL schema from the PrintBid research (users, printers, print_jobs, bids, orders, reviews, messages, disputes, printer_benchmarks tables). Include Docker Compose for local dev with PostgreSQL + Redis.
```

### Build the Auth System
```
Implement the authentication system for PrintBid: JWT access tokens (15 min) + refresh tokens (7 days) stored in httpOnly cookies. Routes: POST /auth/register, POST /auth/login, POST /auth/refresh, POST /auth/logout. Google OAuth via passport-google-oauth20. User roles: buyer, printer, admin. Middleware for route protection. Rate limiting: 5 registrations/hr, 10 logins/min.
```

### Build the File Pipeline
```
Implement the 3D file upload and validation pipeline for PrintBid using BullMQ. Steps: (1) Accept STL/3MF/OBJ upload via presigned S3 URL, (2) Queue for processing, (3) Worker validates mesh with manifold-3d WASM, (4) Auto-repair with ADMesh if non-manifold, (5) Extract metadata (bounding box, volume, polygon count), (6) Estimate print time via PrusaSlicer CLI, (7) Generate thumbnail, (8) Return printability score. Store results in print_jobs table.
```

### Build the Bidding System
```
Implement the bidding system for PrintBid. Printers can submit bids on open print jobs with: price (cents), estimated days, shipping cost, and a message. One bid per printer per job (UNIQUE constraint). Buyers see all bids sorted by price/rating/speed. Accepting a bid creates an order and triggers Stripe payment. Use uWebSockets.js + Redis Pub/Sub for real-time bid updates. Implement dynamic soft close (5-min extension on late bids) to prevent sniping.
```
