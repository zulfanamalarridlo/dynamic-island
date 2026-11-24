import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SettingsWindow from "./components/SettingsWindow";
import { initializeAppSettings } from "./lib/storage";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Elemen root aplikasi tidak ditemukan.");
const root = ReactDOM.createRoot(rootElement);
const isSettingsView = new URLSearchParams(window.location.search).get("view") === "settings";

void initializeAppSettings()
  .then(() => {
    root.render(
      <React.StrictMode>
        {isSettingsView ? <SettingsWindow /> : <App />}
      </React.StrictMode>,
    );
  })
  .catch((error: unknown) => {
    console.error("Gagal memuat settings.json:", error);
    root.render(
      <main role="alert" style={{ padding: 24, color: "#fca5a5", fontFamily: "sans-serif" }}>
        Gagal memuat settings.json. Restart aplikasi setelah memperbaiki file pengaturan.
      </main>,
    );
  });
