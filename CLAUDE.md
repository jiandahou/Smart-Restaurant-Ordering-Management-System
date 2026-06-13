# DineFlow — Smart Restaurant Ordering & Management System

## Project Summary

Full-stack restaurant platform: QR-code table ordering, digital menu, order lifecycle management, Stripe payments, real-time notifications, and an AI voice-ordering feature. Targets small-to-medium restaurants.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Backend | .NET 8 Web API (4-layer architecture) |
| Database | PostgreSQL (port **5433** locally via Docker) |
| ORM | Entity Framework Core 8 (Npgsql) |
| Auth | ASP.NET Identity + JWT + Google OAuth + Passkeys + TOTP MFA |
| Payments | Stripe Checkout + Webhooks |
| Real-time | SignalR / WebSockets (planned) |
| AI | OpenAI API (planned) |
| Deployment | Docker, AWS ECS + RDS + S3 + CloudFront |

---

## Repository Structure

```
/
├── backend/dineflow/
│   ├── DineFlow.Api/           # Controllers, Contracts (DTOs), Program.cs
│   ├── DineFlow.Application/   # Use cases, interfaces (mostly thin for now)
│   ├── DineFlow.Domain/        # Domain models (lightweight)
│   ├── DineFlow.Infrastructure/# EF entities, DbContext, Identity, seeders
│   │   ├── Identity/           # ApplicationUser, IdentitySeeder, roles
│   │   ├── Menu/               # MenuCategory, MenuItem
│   │   ├── Order/              # Order, OrderItem, OrderStatusHistory
│   │   ├── Payments/           # Payment, TestPaymentOrder
│   │   ├── Persistence/        # AppDbContext, old migrations folder
│   │   ├── Restaurant/         # Restaurant, RestaurantTable
│   │   └── Migrations/         # Active EF migrations (main location)
│   └── DineFlow.sln
├── frontend/dineflow-web/
│   └── src/
│       ├── api/                # API client functions
│       ├── auth/               # Auth context and hooks
│       ├── components/         # Shared UI components (shadcn wrappers)
│       ├── layout/             # AppLayout, sidebar/nav
│       ├── pages/              # One file per page/route
│       ├── routes/             # ProtectedRoute
│       ├── store.ts            # Global state
│       ├── App.tsx             # Route definitions
│       └── index.css           # CSS variables (light + dark theme)
├── .env                        # Real secrets — never commit
├── .env.example                # Template with placeholder values
├── docker-compose.yml          # Postgres + backend + frontend services
└── docs/                       # Deployment and product docs
```

---

## Local Development Setup

### 1. Start the database
```bash
docker-compose up -d postgres
```
PostgreSQL runs on **port 5433** (not 5432) to avoid conflicts.

### 2. Configure secrets
Copy `.env.example` to `.env` and fill in real values. The backend reads from `.env` via docker-compose or `appsettings.Development.json` locally.

> `appsettings.Development.json` is **gitignored** — create it locally and populate from `.env`. Never commit real secrets.

### 3. Run database migrations
```bash
cd backend/dineflow
dotnet ef database update --project DineFlow.Infrastructure --startup-project DineFlow.Api
```

### 4. Run the backend
```bash
cd backend/dineflow/DineFlow.Api
dotnet run
# Listens on http://localhost:5000
```

### 5. Run the frontend
```bash
cd frontend/dineflow-web
npm install
npm run dev
# Listens on http://localhost:5173
# Proxies /api and /health to http://localhost:5000
```

---

## Key Conventions

### Backend

- **Namespace conflict**: `DineFlow.Infrastructure.Restaurant` is both a namespace and a class name. Always alias it:
  ```csharp
  using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;
  ```
- **DTOs** live in `DineFlow.Api/Contracts/<Domain>/` as `*Request.cs` and `*Response.cs`.
- **Controllers** inject `AppDbContext` and `ILogger<T>` directly — no repository layer for now.
- **FK strategy**: `MenuCategory` and `AspNetUsers` have real FK constraints to `Restaurants`. `Order.RestaurantId` and `RestaurantTable.RestaurantId` are plain `Guid?` columns with no FK constraint.
- **Identity seeder** (`IdentitySeeder.cs`) seeds in this order: Roles → Restaurants → Tables → MenuCategories → MenuItems → Orders → Users. Restaurants must be seeded before users because `AspNetUsers` has a FK to `Restaurants`.
- **Migrations** live in `DineFlow.Infrastructure/Migrations/` (not `Persistence/Migrations/`).

### Frontend

- **Theme**: Light theme by default. Dark mode follows OS preference via `@media (prefers-color-scheme: dark)` in `index.css`. Do not force either mode.
- **CSS variables** are defined in `index.css` under `:root`. Always use `var(--border)`, `var(--panel-bg)` etc. — never hardcode colours.
- **Routing**: All routes are defined in `App.tsx`. Protected routes use `<ProtectedRoute>` with optional `roles` prop.
- **API calls** go through functions in `src/api/` — do not call `fetch` directly from page components.

---

## Common EF Commands

```bash
# Add a new migration
dotnet ef migrations add <MigrationName> --project DineFlow.Infrastructure --startup-project DineFlow.Api

# Apply migrations
dotnet ef database update --project DineFlow.Infrastructure --startup-project DineFlow.Api

# Drop the database (destructive!)
dotnet ef database drop --project DineFlow.Infrastructure --startup-project DineFlow.Api
```

---

## Git Branches

| Branch | Purpose |
|---|---|
| `main` | Stable / staging |
| `laxman` | Laxman's feature branch (restaurant model, CRUD, seeding) |

Always rebase or merge `main` into your feature branch before opening a PR.

---

## Seed Data (Static GUIDs)

| Entity | ID |
|---|---|
| Restaurant One ("The DineFlow Kitchen") | `11111111-1111-1111-1111-111111111111` |
| Restaurant Two ("Spice Garden") | `22222222-2222-2222-2222-222222222222` |

Use these GUIDs when writing manual SQL or test payloads so foreign key references are consistent.

---

## Environment Variables Reference

See `.env.example` for all variables. Key ones:

| Variable | Used by |
|---|---|
| `POSTGRES_PASSWORD` | Docker Compose, connection string |
| `JWT_SECRET_KEY` | Token signing (min 32 chars) |
| `STRIPE_SECRET_KEY` | Stripe API calls |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification |
| `RESEND_API_KEY` | Transactional email |
| `GOOGLE_CLIENT_ID/SECRET` | OAuth login |
