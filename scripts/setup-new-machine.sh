#!/usr/bin/env bash
#
# Portfolio AI — new machine setup.
# Installs required tooling, clones the repo, installs deps, and scaffolds
# .env.local. Safe to re-run (idempotent): it skips anything already present.
#
#   bash setup-new-machine.sh
#
set -euo pipefail

REPO_URL="https://github.com/Investportfolioai/portfolio-ai-app.git"
REPO_DIR="portfolio-ai-app"

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

bold "Portfolio AI — new machine setup"
OS="$(uname -s)"

# ---------------------------------------------------------------------------
# 1. Required tooling: node, npm, git, gh CLI, vercel CLI
# ---------------------------------------------------------------------------

# Install a brew/apt package; bail with guidance if neither is available.
install_pkg() {
  local pkg="$1"
  if have brew; then
    brew install "$pkg"
  elif have apt-get; then
    sudo apt-get update -y && sudo apt-get install -y "$pkg"
  else
    echo "  ⚠️  Could not auto-install '$pkg' (no Homebrew or apt found). Install it manually."
    return 1
  fi
}

# Homebrew (macOS) — needed to install the rest.
if [ "$OS" = "Darwin" ] && ! have brew; then
  bold "Installing Homebrew…"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# git
if have git; then echo "✓ git $(git --version | awk '{print $3}')"; else bold "Installing git…"; install_pkg git; fi

# node + npm
if have node && have npm; then
  echo "✓ node $(node -v), npm $(npm -v)"
else
  bold "Installing Node.js (includes npm)…"
  if have brew; then install_pkg node
  elif have apt-get; then sudo apt-get update -y && sudo apt-get install -y nodejs npm
  else echo "  ⚠️  Install Node.js manually from https://nodejs.org"; fi
fi

# GitHub CLI
if have gh; then echo "✓ gh $(gh --version | head -1 | awk '{print $3}')"; else bold "Installing GitHub CLI…"; install_pkg gh; fi

# Vercel CLI (via npm)
if have vercel; then echo "✓ vercel $(vercel --version 2>/dev/null | head -1)"; else bold "Installing Vercel CLI…"; npm install -g vercel; fi

# ---------------------------------------------------------------------------
# 2. Clone the repo (skip if we're already inside it or it already exists)
# ---------------------------------------------------------------------------
if [ -f "package.json" ] && grep -q '"portfolio-ai-app"' package.json 2>/dev/null; then
  bold "Already inside the repo — skipping clone."
elif [ -d "$REPO_DIR" ]; then
  bold "$REPO_DIR/ already exists — skipping clone."
  cd "$REPO_DIR"
else
  bold "Cloning $REPO_URL…"
  git clone "$REPO_URL"
  cd "$REPO_DIR"
fi

# ---------------------------------------------------------------------------
# 3. Install dependencies
# ---------------------------------------------------------------------------
bold "Installing dependencies (npm install)…"
npm install

# ---------------------------------------------------------------------------
# 4. .env.local template (never overwrite real secrets)
# ---------------------------------------------------------------------------
if [ -f ".env.local" ]; then
  bold ".env.local already exists — leaving it untouched."
else
  bold "Creating .env.local template…"
  cat > .env.local <<'ENVEOF'
# Portfolio AI — environment variables.
# Fill these in with values from the Vercel dashboard:
#   Vercel → portfolio-ai-prod → Settings → Environment Variables
# Or, after `vercel login` + linking the project: `vercel env pull .env.local`
# NOTE: keys are case-sensitive and must not contain line breaks.

# Supabase (project ref: zpzeylfiojsjuhhnujet)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# AI underwriting (Anthropic)
ANTHROPIC_API_KEY=

# Transactional email (Resend)
RESEND_API_KEY=

# Zillow AVM (RapidAPI)
RAPIDAPI_KEY=

# Cron auth — any long random string; must match the value set in Vercel
CRON_SECRET=

# Optional — base URL used in outbound email links (defaults to relative if unset)
NEXT_PUBLIC_APP_URL=https://app.investportfolio.ai
ENVEOF
fi

# ---------------------------------------------------------------------------
# 5. Next steps
# ---------------------------------------------------------------------------
echo ""
bold "✅ Setup complete. Next steps:"
cat <<'MSG'
  1. Fill in .env.local with your values from the Vercel dashboard
     (or run: vercel env pull .env.local)
  2. Run: vercel login
  3. Run: gh auth login
  4. Run: npm run dev          # start local dev at http://localhost:3000
  5. Run: npx vercel --prod    # deploy to production
MSG
