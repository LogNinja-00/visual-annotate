#!/usr/bin/env bash
set -e

echo "=== Visual Annotate Setup ==="
echo ""

if ! command -v node &>/dev/null; then
  echo "Error: Node.js not found."
  exit 1
fi

if [ ! -f "package.json" ]; then
  echo "Error: Run this from your project root (where package.json is)."
  echo "  cd /path/to/your-project && bash /path/to/setup.sh"
  exit 1
fi

PROJECT_ROOT="$(pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Locate the tool source:
#  A) setup.sh lives inside the package (visual-annotate-main or cloned repo)
#  B) setup.sh lives next to a visual-annotate/ folder (New Tools layout)
if [ -f "$SCRIPT_DIR/src/browser.js" ]; then
  VA_SRC="$SCRIPT_DIR"
elif [ -d "$SCRIPT_DIR/visual-annotate" ] && [ -f "$SCRIPT_DIR/visual-annotate/src/browser.js" ]; then
  VA_SRC="$SCRIPT_DIR/visual-annotate"
else
  echo "Error: Cannot find visual-annotate source next to setup.sh"
  echo "  Expected $SCRIPT_DIR/src/browser.js or $SCRIPT_DIR/visual-annotate/"
  exit 1
fi

# React client component template (bundled with the package)
if [ -f "$SCRIPT_DIR/react/VisualAnnotate.tsx" ]; then
  REACT_SRC="$SCRIPT_DIR/react/VisualAnnotate.tsx"
elif [ -f "$VA_SRC/react/VisualAnnotate.tsx" ]; then
  REACT_SRC="$VA_SRC/react/VisualAnnotate.tsx"
else
  REACT_SRC=""
fi

VA_DIR="$PROJECT_ROOT/visual-annotate"
REACT_DIR="$PROJECT_ROOT/react"
PUBLIC_DIR="$PROJECT_ROOT/public"

# Resolve for comparison (avoid re-copying package onto itself)
VA_SRC_ABS="$(cd "$VA_SRC" && pwd)"
VA_DIR_ABS=""
if [ -d "$VA_DIR" ]; then
  VA_DIR_ABS="$(cd "$VA_DIR" && pwd)"
fi

# 1. Copy visual-annotate folder into the project
if [ "$VA_SRC_ABS" != "$VA_DIR_ABS" ]; then
  if [ ! -d "$VA_DIR" ]; then
    echo "Copying visual-annotate..."
    cp -r "$VA_SRC" "$VA_DIR"
  else
    echo "visual-annotate/ already exists — keeping it"
  fi
else
  echo "Running from inside the package — visual-annotate/ already in place"
fi

# 2. Copy react component
mkdir -p "$REACT_DIR"
if [ ! -f "$REACT_DIR/VisualAnnotate.tsx" ]; then
  echo "Copying React component..."
  if [ -n "$REACT_SRC" ]; then
    cp "$REACT_SRC" "$REACT_DIR/VisualAnnotate.tsx"
  else
    cat > "$REACT_DIR/VisualAnnotate.tsx" << 'EOF'
'use client';

import { useEffect } from 'react';

export default function VisualAnnotate() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    import('../visual-annotate/src/browser.js')
      .then(({ initAnnotator }) => {
        initAnnotator();
      })
      .catch((err) => {
        console.error('[VA] Failed to load:', err);
      });
  }, []);

  return null;
}
EOF
  fi
else
  echo "react/VisualAnnotate.tsx already exists"
fi

# 3. html2canvas must be served from the site root (screenshots depend on it)
#    browser.js loads script.src = '/html2canvas.min.js'
if [ ! -f "$VA_DIR/src/html2canvas.min.js" ] && [ -f "$VA_SRC/src/html2canvas.min.js" ]; then
  mkdir -p "$VA_DIR/src"
  cp "$VA_SRC/src/html2canvas.min.js" "$VA_DIR/src/html2canvas.min.js"
fi
if [ -f "$VA_DIR/src/html2canvas.min.js" ]; then
  mkdir -p "$PUBLIC_DIR"
  cp "$VA_DIR/src/html2canvas.min.js" "$PUBLIC_DIR/html2canvas.min.js"
  echo "Copied html2canvas.min.js → public/"
else
  echo "Warning: html2canvas.min.js not found — screenshots will not work until you add it to public/"
fi

# 4. Install deps
echo "Installing dependencies..."
(cd "$VA_DIR" && npm install --silent 2>/dev/null || npm install --silent)
cd "$PROJECT_ROOT"

# 5. Create .env
if [ ! -f ".env" ]; then
  cp "$VA_DIR/.env.example" ".env"
  echo ""
  echo ">>> Edit .env with your GitHub token, owner, and repo <<<"
  echo ""
fi

# 6. Add .env to gitignore
if [ -f ".gitignore" ]; then
  grep -q "^\.env$" .gitignore 2>/dev/null || echo ".env" >> .gitignore
else
  echo ".env" > .gitignore
fi

# 7. Add scripts to package.json
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
if (!pkg.scripts) pkg.scripts = {};
let changed = false;
if (!pkg.scripts.va) {
  pkg.scripts.va = 'node visual-annotate/bin/cli.js';
  changed = true;
}
if (pkg.scripts.dev && !pkg.scripts.dev.includes('visual-annotate')) {
  pkg.scripts.dev = pkg.scripts.dev + ' & node visual-annotate/bin/cli.js';
  changed = true;
}
if (changed) {
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  console.log('Updated package.json scripts');
}
" 2>/dev/null || true

# 8. Wire VisualAnnotate into the root layout with a correct relative import
LAYOUT=""
for f in src/app/layout.tsx src/app/layout.js src/app/layout.jsx app/layout.tsx app/layout.js app/layout.jsx; do
  if [ -f "$f" ]; then LAYOUT="$f"; break; fi
done

if [ -n "$LAYOUT" ]; then
  if ! grep -q "VisualAnnotate" "$LAYOUT" 2>/dev/null; then
    REL_IMPORT="$(node -e "
const path = require('path');
const from = path.dirname(path.resolve('$LAYOUT'));
const to = path.resolve('react');
let rel = path.relative(from, to).split(path.sep).join('/');
if (!rel.startsWith('.')) rel = './' + rel;
console.log(rel + '/VisualAnnotate');
")"
    # Insert import after the first import line (or at top)
    if grep -q "^import " "$LAYOUT"; then
      sed -i "0,/^import/{s|^import|import VisualAnnotate from '$REL_IMPORT';\nimport|}" "$LAYOUT" 2>/dev/null || true
    else
      sed -i "1i import VisualAnnotate from '$REL_IMPORT';" "$LAYOUT" 2>/dev/null || true
    fi
    # Add <VisualAnnotate /> before </body>
    if grep -q "</body>" "$LAYOUT"; then
      sed -i 's|</body>|<VisualAnnotate />\n      </body>|' "$LAYOUT" 2>/dev/null || true
    fi
    echo "Added VisualAnnotate to $LAYOUT (import: $REL_IMPORT)"
  else
    echo "VisualAnnotate already in $LAYOUT"
  fi
else
  echo "No Next.js layout found — add this manually:"
  echo "  import VisualAnnotate from './react/VisualAnnotate';"
  echo "  ... <VisualAnnotate /> inside <body>"
fi

echo ""
echo "=== Done ==="
echo ""
echo "1. Edit .env:"
echo "   GITHUB_TOKEN=ghp_xxx"
echo "   GITHUB_OWNER=your-username"
echo "   GITHUB_REPO=your-repo"
echo ""
echo "2. Open the app on localhost (not a LAN IP):"
echo "   npm run dev"
echo ""
echo "3. Press Alt+Shift+A → click element → write → Submit to GitHub"
echo ""
echo "Notes:"
echo "  - Tool only activates on localhost/127.0.0.1 (by design)."
echo "  - Screenshots need public/html2canvas.min.js (setup copies it)."
echo "  - VA server runs on :4545 via the npm run va / dev script."
