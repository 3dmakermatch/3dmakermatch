# 3dMakerMatch

Hyper-local 3D printing marketplace connecting designers with expert printer operators through competitive bidding.

## Project Structure

- `app/client/` - React 19 + Vite + TypeScript + Tailwind frontend
- `app/server/` - Fastify + TypeScript + Prisma backend
- `app/shared/types/` - Shared TypeScript interfaces
- `research/` - Market research and planning docs
- `marketing/` - Landing page

## Tech Stack

- **Backend:** Fastify, TypeScript, Prisma, PostgreSQL + PostGIS, Redis, BullMQ
- **Frontend:** React 19, Vite, TypeScript, Tailwind CSS, React Router
- **Payments:** Stripe Connect (Express accounts, Separate Charges and Transfers)
- **Auth:** JWT (access 15min / refresh 7d httpOnly cookie) + Google OAuth

## Development

```bash
docker compose up -d        # Start PostgreSQL + Redis
cd app/server && npm run dev  # Start API server (port 3000)
cd app/client && npm run dev  # Start Vite dev server (port 5173)
```

## Database

```bash
cd app/server
npx prisma migrate dev       # Run migrations
npx prisma studio            # Browse data
```

## API

All routes prefixed with `/api/v1/`. See `research/mvp-plan.md` Part 6 for full API design.

## Conventions

- Conventional Commits for all commit messages
- Never reference AI tools in commits, PRs, or code comments
- Run Snyk scan after completing each sprint
