import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { initNotifications } from "./ui/notifications";
import "./index.css";

// Warm up the notification service worker for players who already opted in, so
// the first turn ping can display without a registration race.
initNotifications();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
