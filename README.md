# Outbound Command Center — Milestone 1

This starter contains:

- Next.js App Router
- Tailwind CSS
- Supabase email/password authentication
- Private login page
- Protected dashboard
- Logout
- Placeholder panels for RB2B, Clay, Apify and HeyReach

## Requirements

- Node.js 20.9 or newer
- A Supabase account and project

## 1. Install packages

```bash
npm install
```

## 2. Create your environment file

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

In Supabase, open the project, choose **Connect**, and copy:

- Project URL
- Publishable key

Paste them into `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Do not use the secret/service-role key in either public variable.

## 3. Create your first user

In Supabase:

1. Authentication
2. Users
3. Add user
4. Create new user
5. Enter your work email and a temporary password
6. Turn on automatic email confirmation if the dashboard presents that option

## 4. Run locally

```bash
npm run dev
```

Open:

http://localhost:3000

You should be redirected to `/login`.

## 5. Check the production build

```bash
npm run build
```

## Next milestone

Create the organisations, team-members, leads, companies, visits and activity
tables with Row Level Security.
