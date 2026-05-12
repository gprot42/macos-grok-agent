import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { hookDOMPurifyLinks } from "./lib/sanitize";

// Install DOMPurify link hook once at startup
hookDOMPurifyLinks();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
