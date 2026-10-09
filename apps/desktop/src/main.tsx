import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import RehearsalApp from "./rehearsal/RehearsalApp";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).has("rehearsal") ? <RehearsalApp/> : <App/>}
  </React.StrictMode>,
);
