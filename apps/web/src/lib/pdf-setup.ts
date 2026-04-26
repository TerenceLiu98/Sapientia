// `?url` tells Vite to emit the worker as a static asset and give us its
// final URL. This works in dev and survives a production build, where
// `new URL("pdfjs-dist/...", import.meta.url)` does not.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import { pdfjs } from "react-pdf"

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
