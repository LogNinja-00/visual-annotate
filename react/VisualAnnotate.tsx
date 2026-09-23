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
