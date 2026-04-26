// `?url` tells Vite to emit the worker as a static asset and give us its
// final URL. This works in dev and survives a production build, where
// `new URL("pdfjs-dist/...", import.meta.url)` does not.
//
// pdfjs-dist must be pinned to the exact version react-pdf depends on,
// otherwise the worker (loaded from our direct dep) and the API
// (loaded from react-pdf's transitive copy) will mismatch and the
// console will surface "API version X does not match Worker version Y".
// When bumping react-pdf, look up the pinned pdfjs-dist version in
// node_modules/.pnpm/react-pdf@*/node_modules/react-pdf/package.json
// and update apps/web/package.json's "pdfjs-dist" entry to match.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import { pdfjs } from "react-pdf"

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
