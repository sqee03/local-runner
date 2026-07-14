import { useEffect, useRef, useState } from "react";
import {
  configSections,
  getValueAtPath,
  removeValueAtPath,
  setValueAtPath
} from "./config-fields";

function App() {
  const frontendWindowRef = useRef(null);
  const [page, setPage] = useState(() =>
    window.location.pathname.startsWith("/config") ? "config" : "home"
  );
  const [configData, setConfigData] = useState(null);
  const [formState, setFormState] = useState(null);
  const [configStatus, setConfigStatus] = useState("Loading configuration...");
  const [saveState, setSaveState] = useState("idle");
  const [runtimeState, setRuntimeState] = useState({
    isRunning: false,
    isTransitioning: false,
    lastError: null
  });
  const [runtimeActionState, setRuntimeActionState] = useState("idle");
  const [copyState, setCopyState] = useState("idle");

  useEffect(() => {
    const onPopState = () => {
      setPage(window.location.pathname.startsWith("/config") ? "config" : "home");
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    async function loadConfig() {
      try {
        const response = await fetch("/api/config");
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load config.");
        }

        setConfigData(payload);
        setFormState(payload.userOverrides);
        setConfigStatus("Configuration loaded.");
      } catch (error) {
        setConfigStatus(error.message);
      }
    }

    loadConfig();
  }, []);

  useEffect(() => {
    async function loadRuntime() {
      try {
        const response = await fetch("/api/runtime");
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load runtime status.");
        }

        setRuntimeState(payload);
      } catch (error) {
        setRuntimeState((current) => ({
          ...current,
          lastError: error.message
        }));
      }
    }

    loadRuntime();
    const timer = window.setInterval(loadRuntime, 2000);
    return () => window.clearInterval(timer);
  }, []);

  function tryOpenFrontend(url) {
    const openedWindow = window.open(url, "package-runner-fe");
    frontendWindowRef.current = openedWindow;
    return openedWindow;
  }

  function navigate(nextPage) {
    const nextPath = nextPage === "config" ? "/config" : "/";
    window.history.pushState({}, "", nextPath);
    setPage(nextPage);
  }

  function handleFieldChange(path, rawValue, type) {
    if (!formState) {
      return;
    }

    if (type === "checkbox") {
      setFormState((current) => setValueAtPath(current, path, rawValue));
      setSaveState("idle");
      return;
    }

    if (rawValue === "") {
      setFormState((current) => removeValueAtPath(current, path));
      setSaveState("idle");
      return;
    }

    const parsedValue =
      type === "number" ? Number(rawValue) : rawValue;

    setFormState((current) => setValueAtPath(current, path, parsedValue));
    setSaveState("idle");
  }

  async function saveConfig(event) {
    event.preventDefault();
    setSaveState("saving");

    try {
      const response = await fetch("/api/config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ userOverrides: formState })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save config.");
      }

      setConfigData(payload);
      setFormState(payload.userOverrides);
      setSaveState("saved");
    } catch (error) {
      setSaveState(error.message);
    }
  }

  async function toggleRuntime() {
    const nextAction = runtimeState.isRunning ? "stop" : "start";
    setRuntimeActionState(nextAction === "start" ? "starting" : "stopping");

    try {
      const response = await fetch(`/api/runtime/${nextAction}`, {
        method: "POST"
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? `Failed to ${nextAction} runtime.`);
      }

      if (nextAction === "start" && payload.currentConfig?.frontendAppUrl) {
        tryOpenFrontend(payload.currentConfig.frontendAppUrl);
      }

      if (nextAction === "stop" && frontendWindowRef.current && !frontendWindowRef.current.closed) {
        frontendWindowRef.current.close();
        frontendWindowRef.current = null;
      }

      setRuntimeState(payload);
      setRuntimeActionState("idle");
    } catch (error) {
      setRuntimeActionState(error.message);
      setRuntimeState((current) => ({
        ...current,
        lastError: error.message
      }));
    }
  }

  async function copyFrontendUrl() {
    if (!runtimeState.currentConfig?.frontendAppUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(runtimeState.currentConfig.frontendAppUrl);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 1600);
    }
  }

  const currentConfigPath = configData?.filePaths?.userConfig ?? "Loading...";
  const defaultConfigPath = configData?.filePaths?.defaultConfig ?? "Loading...";

  return (
    <main className="page-shell">
      <div className="top-actions">
        {page === "home" ? (
          <button className="ghost-button" type="button" onClick={() => navigate("config")}>
            Config
          </button>
        ) : (
          <button className="ghost-button" type="button" onClick={() => navigate("home")}>
            Back
          </button>
        )}
      </div>

      {page === "home" ? (
        <section className="hero-card">
          <p className="eyebrow">Runner control tool</p>
          <h1>Package Runner</h1>
          <p className="lede">
            This runner controls separate FE, BE, and MQTT packages. The frontend
            package launches on its own port as an injected application.
          </p>

          <div className="runner-actions">
            <div className="runner-action-row">
              <button
                className={runtimeState.isRunning ? "runner-button stop" : "runner-button start"}
                type="button"
                onClick={toggleRuntime}
                disabled={runtimeState.isTransitioning}
              >
                {runtimeState.isTransitioning
                  ? runtimeState.isRunning
                    ? "Stopping..."
                    : "Starting..."
                  : runtimeState.isRunning
                    ? "Stop"
                    : "Start"}
              </button>

              {runtimeState.isRunning && runtimeState.currentConfig?.frontendAppUrl ? (
                <div className="app-ready">
                  <span>
                    App ready at{" "}
                    <a
                      href={runtimeState.currentConfig.frontendAppUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {runtimeState.currentConfig.frontendAppUrl}
                    </a>
                  </span>
                  <button
                    className="copy-button"
                    type="button"
                    onClick={copyFrontendUrl}
                    aria-label="Copy app URL"
                    title={copyState === "copied" ? "Copied" : "Copy URL"}
                  >
                    {copyState === "copied" ? "Copied" : "Copy"}
                  </button>
                </div>
              ) : null}
            </div>
            <p className="runner-hint">
              {runtimeState.lastError
                ? `Runner error: ${runtimeState.lastError}`
                : runtimeState.isRunning
                  ? "Injected FE, BE, and MQTT packages are active."
                  : "Runner UI is loaded. Press Start to launch FE, BE, and MQTT packages."}
            </p>
          </div>

          <div className="status-grid">
            <article className="status-card">
              <h2>Frontend Package</h2>
              <p
                className={
                  runtimeState.packageStatus?.fe === "running"
                    ? "status-ok"
                    : "status-warn"
                }
              >
                {runtimeState.packageStatus?.fe ?? "stopped"}
              </p>
            </article>
            <article className="status-card">
              <h2>MQTT Package</h2>
              <p
                className={
                  runtimeState.packageStatus?.mqtt === "running"
                    ? "status-ok"
                    : "status-warn"
                }
              >
                {runtimeState.packageStatus?.mqtt ?? "stopped"}
              </p>
            </article>
            <article className="status-card">
              <h2>Backend Package</h2>
              <p
                className={
                  runtimeState.packageStatus?.be === "running"
                    ? "status-ok"
                    : "status-warn"
                }
              >
                {runtimeState.packageStatus?.be ?? "stopped"}
              </p>
            </article>
          </div>
        </section>
      ) : (
        <section className="config-card">
          <p className="eyebrow">Runner Settings</p>
          <h1>Config</h1>
          <p className="lede">
            Defaults ship in one JSON file, and your local machine-specific overrides
            are saved separately for the next launch.
          </p>

          <div className="config-meta">
            <p><strong>Defaults:</strong> {defaultConfigPath}</p>
            <p><strong>User overrides:</strong> {currentConfigPath}</p>
            <p><strong>Status:</strong> {configStatus}</p>
          </div>

          {formState ? (
            <form className="config-form" onSubmit={saveConfig}>
              {configSections.map((section) => (
                <section className="config-section" key={section.title}>
                  <div className="config-section-copy">
                    <h2>{section.title}</h2>
                    <p>{section.description}</p>
                  </div>

                  <div className="field-grid">
                    {section.fields.map((field) => {
                      const overrideValue = getValueAtPath(formState, field.path);
                      const effectiveValue = getValueAtPath(
                        configData?.effective ?? {},
                        field.path
                      );
                      const inputValue =
                        field.type === "checkbox"
                          ? Boolean(
                              overrideValue === undefined
                                ? effectiveValue
                                : overrideValue
                            )
                          : overrideValue === undefined
                            ? ""
                            : String(overrideValue);

                      return (
                        <label className="field-card" key={field.path}>
                          <span>{field.label}</span>
                          {field.type === "checkbox" ? (
                            <input
                              className="toggle-input"
                              type="checkbox"
                              checked={inputValue}
                              onChange={(event) =>
                                handleFieldChange(
                                  field.path,
                                  event.target.checked,
                                  field.type
                                )
                              }
                            />
                          ) : (
                            <input
                              type={field.type}
                              value={inputValue}
                              placeholder={field.placeholder ?? String(effectiveValue ?? "")}
                              onChange={(event) =>
                                handleFieldChange(
                                  field.path,
                                  event.target.value,
                                  field.type
                                )
                              }
                            />
                          )}
                          <small>Current effective value: {String(effectiveValue ?? "")}</small>
                        </label>
                      );
                    })}
                  </div>
                </section>
              ))}

              <div className="config-actions">
                <p className="config-hint">
                  Saved values apply on the next runner start because ports and process
                  paths are used during boot.
                </p>
                <button className="primary-button" type="submit">
                  Save overrides
                </button>
                <span className="save-status">
                  {saveState === "idle"
                    ? "No unsaved status."
                    : saveState === "saving"
                      ? "Saving..."
                      : saveState === "saved"
                        ? "Saved."
                        : saveState}
                </span>
              </div>
            </form>
          ) : (
            <article className="message-card">
              <h2>Configuration</h2>
              <pre>{configStatus}</pre>
            </article>
          )}
        </section>
      )}
    </main>
  );
}

export default App;
